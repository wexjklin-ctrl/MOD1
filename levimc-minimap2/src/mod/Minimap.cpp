// Diorama (Bedrock) - minimap + big map (stage 3/4/7 first version).
// Terrain is scanned column by column from the loaded chunks into a persistent cache,
// then drawn as merged horizontal colour runs with MinecraftUIRenderContext::fillRectangle.
// Visual style follows Diorama (MIT, (c) Dara Adedeji): dark frame, relief shading, fog for unknown areas.

#include <climits>
#include <unordered_map>
#include "mod/VanillaColors.h"
#include <set>
#include "mod/Minimap.h"
#include "mod/DioramaMod.h"

#include "mc/client/game/IClientInstance.h"
#include "mc/client/player/LocalPlayer.h"
#include "mc/client/renderer/screen/MinecraftUIRenderContext.h"
#include "mc/deps/core/math/Color.h"
#include "mc/deps/input/RectangleArea.h"
#include "mc/client/renderer/TextureGroup.h"
#include "mc/deps/core/image/Image.h"
#include "mc/deps/core_graphics/ImageBuffer.h"
#include "mc/deps/core/file/PathView.h"
#include "mc/deps/core/resource/ResourceLocation.h"
#include "mc/deps/core/string/HashedString.h"
#include "mc/deps/minecraft_renderer/renderer/TexturePtr.h"
#include "mc/deps/minecraft_renderer/renderer/BedrockTextureData.h"
#include "mc/deps/minecraft_renderer/resources/ClientTexture.h"
#include "mc/client/gui/GuiData.h"
#include "mc/util/HudElement.h"
#include "mc/util/HudVisibility.h"
#include "mc/world/level/BlockPos.h"
#include "mc/world/level/BlockSource.h"
#include "mc/world/level/Level.h"
#include "mc/world/level/block/Block.h"
#include "mc/world/level/block/BlockType.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <condition_variable>
#include <mutex>
#include <thread>
#include <cmath>
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <unordered_set>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

namespace diorama_bedrock::minimap {

namespace {

constexpr uint32_t FOG = 0xFFE8EBF0u; // white fog of war (unexplored / not saved)

// Wall profile: colour of the block at (top - depth) for each depth; used to paint real building/cliff faces.
constexpr int NW = 96; // per-block wall profile down to 96 blocks below the top (tall buildings keep every floor and window)
struct IdDepth { constexpr int operator[](int k) const { return k; } };
constexpr IdDepth kWallDepth{}; // depth of profile entry k is k

struct ChunkData {
    std::array<uint32_t, 256> color{}; // 0 = unknown, else 0xFFRRGGBB
    std::array<int16_t, 256>  height{};
    std::array<uint8_t, 256 * NW> wallId{}; // palette index per (column, depth); 0 = air gap
    std::array<uint32_t, 256>     pal{};    // per-chunk palette of wall colours (+shape in alpha); pal[0] = 0 (air)
    int                           palN = 1;
    bool                      scanned  = false;
    bool                      dirty    = false;
    uint64_t                  lastScan = 0;
    uint64_t                  lastTry  = 0;
};

struct WRef { // view of one column's wall profile
    uint8_t const*  id  = nullptr;
    uint32_t const* pal = nullptr;
    explicit operator bool() const { return id != nullptr; }
    uint32_t operator[](int k) const { return pal[id[k]]; }
};

uint8_t encodePal(ChunkData& cd, uint32_t v) {
    if (v == 0) return 0;
    for (int i = 1; i < cd.palN; ++i) if (cd.pal[size_t(i)] == v) return uint8_t(i);
    if (cd.palN < 255) { cd.pal[size_t(cd.palN)] = v; return uint8_t(cd.palN++); }
    int best = 1; long bd = LONG_MAX; // palette full: nearest colour
    for (int i = 1; i < cd.palN; ++i) {
        uint32_t p = cd.pal[size_t(i)];
        long dr = long((p >> 16) & 255) - long((v >> 16) & 255), dg = long((p >> 8) & 255) - long((v >> 8) & 255), db = long(p & 255) - long(v & 255);
        long d = dr * dr + dg * dg + db * db + (((p >> 24) != (v >> 24)) ? 3000 : 0);
        if (d < bd) { bd = d; best = i; }
    }
    return uint8_t(best);
}
// stores one column profile; returns true when it differs from what was stored
bool storeWall(ChunkData& cd, int idx, uint32_t const* w) {
    uint8_t ids[NW];
    int     prevK = -1; uint8_t prevId = 0;
    for (int k = 0; k < NW; ++k) {
        if (k > 0 && w[k] == w[k - 1]) { ids[k] = ids[k - 1]; continue; }
        (void)prevK; (void)prevId;
        ids[k] = encodePal(cd, w[k]);
    }
    uint8_t* dst = &cd.wallId[size_t(idx) * NW];
    if (std::memcmp(dst, ids, NW) == 0) return false;
    std::memcpy(dst, ids, NW);
    return true;
}

std::unordered_map<int64_t, ChunkData> gCache;
std::mutex                             gMapMx; // guards the STRUCTURE of gCache (insert/clear on main thread vs. find on the bake worker)
uint64_t                               gFrame   = 0;
std::vector<std::pair<int, int>>        gChangedChunks; // chunks whose pixels changed (tile invalidation)
bool                                   gTilesInit = false;
uint64_t                               gVersion = 1; // bumped when any cached pixel changes

int64_t key(int cx, int cz) { return (int64_t(cx) << 32) ^ int64_t(uint32_t(cz)); }
int     floorDiv16(int v) { return v >> 4; }

uint32_t pack(float r, float g, float b) {
    auto c = [](float v) { return uint32_t(std::clamp(v, 0.0f, 1.0f) * 255.0f + 0.5f); };
    return 0xFF000000u | (c(r) << 16) | (c(g) << 8) | c(b);
}

// Chunk lookup with a one-entry cache (neighbouring cells almost always share a chunk).
struct Sampler {
    int        lcx = INT32_MIN, lcz = INT32_MIN;
    ChunkData* c   = nullptr;
    ChunkData* get(int x, int z) {
        int cx = floorDiv16(x), cz = floorDiv16(z);
        if (cx != lcx || cz != lcz) {
            lcx    = cx;
            lcz    = cz;
            std::lock_guard<std::mutex> lk(gMapMx);
            auto it = gCache.find(key(cx, cz));
            c       = it == gCache.end() ? nullptr : &it->second;
        }
        return c;
    }
};


// ---------- block colours (approximate Java Diorama look: average texture colours) ----------
bool has(std::string const& n, char const* s) { return n.find(s) != std::string::npos; }

struct NamedRgb { char const* key; uint32_t rgb; };

uint32_t dyeRgb(std::string const& n, bool& found) {
    static constexpr NamedRgb dyes[] = {
        {"light_blue", 0x3AAFD9}, {"light_gray", 0x8E8E86}, {"silver", 0x8E8E86}, {"white", 0xE9ECEC},
        {"orange", 0xF07613}, {"magenta", 0xBD44B3}, {"yellow", 0xF8C627}, {"lime", 0x70B919},
        {"pink", 0xED8DAC}, {"gray", 0x3E4447}, {"cyan", 0x158991}, {"purple", 0x792AAC},
        {"blue", 0x35399D}, {"brown", 0x724728}, {"green", 0x546D1B}, {"red", 0xA12722}, {"black", 0x141519}};
    for (auto const& d : dyes)
        if (has(n, d.key)) { found = true; return d.rgb; }
    found = false;
    return 0;
}

uint32_t scaleRgb(uint32_t c, float k) {
    auto m = [k](uint32_t v) { return uint32_t(std::min(255.0f, float(v) * k)); };
    return (m((c >> 16) & 255) << 16) | (m((c >> 8) & 255) << 8) | m(c & 255);
}

// returns 0 when the block is not in the table (caller falls back to the engine map colour)
uint32_t blockRgb(std::string const& full) {
    std::string n = full.rfind("minecraft:", 0) == 0 ? full.substr(10) : full;

    // wood families: {log colour, planks colour, leaves colour}
    struct Wood { char const* key; uint32_t log, plank, leaf; };
    static constexpr Wood woods[] = {
        {"dark_oak", 0x3E2A14, 0x4A3018, 0x2E5A1E}, {"spruce", 0x5A3E22, 0x7A5A34, 0x3A5E3A},
        {"birch", 0xD8D2B0, 0xC8B77A, 0x6A9A45},    {"jungle", 0x7A5A2A, 0xA07850, 0x2F8A1F},
        {"acacia", 0xA85A32, 0xBA683B, 0x4F8A2A},   {"cherry", 0xE5B5C0, 0xE2B2A8, 0xE8A0C0},
        {"mangrove", 0x7A3A32, 0x773636, 0x4A7A2A}, {"pale_oak", 0xC9C2B6, 0xE3D6D1, 0x9AA088},
        {"crimson", 0x6A2A44, 0x65313F, 0x8A1F1F},  {"warped", 0x2A7A74, 0x2B6C66, 0x1F8A7A},
        {"bamboo", 0x7A9A2A, 0xC2AC55, 0x7A9A2A},   {"azalea", 0x8A6A3A, 0xA27B49, 0x5A8A2E},
        {"oak", 0x8A6A3A, 0xA27B49, 0x3F7F2A}};
    for (auto const& w : woods) {
        if (!has(n, w.key)) continue;
        if (has(n, "leaves")) return w.leaf;
        if (has(n, "log") || has(n, "wood") || has(n, "stem") || has(n, "hyphae")) return w.log;
        if (has(n, "planks") || has(n, "stairs") || has(n, "slab") || has(n, "fence") || has(n, "door") ||
            has(n, "sign") || has(n, "pressure") || has(n, "button") || has(n, "shelf") || has(n, "mosaic"))
            return w.plank;
    }
    if (n == "leaves" || n == "leaves2") return 0x3F7F2A;
    if (n == "log" || n == "log2") return 0x8A6A3A;
    if (n == "planks" || n == "wooden_slab" || n == "wooden_door") return 0xA27B49;

    bool dye = false;
    if (has(n, "terracotta") || has(n, "hardened_clay")) {
        uint32_t d = dyeRgb(n, dye);
        return dye ? scaleRgb(d, 0.68f) : 0x985E43;
    }
    if (has(n, "concrete") || has(n, "wool") || has(n, "carpet") || has(n, "glazed") || has(n, "stained") ||
        has(n, "shulker") || has(n, "candle") || has(n, "banner") || has(n, "bed")) {
        uint32_t d = dyeRgb(n, dye);
        if (dye) return d;
    }

    static constexpr NamedRgb rules[] = {
        {"brick_block", 0xA0574A}, {"red_nether_brick", 0x450709}, {"stonebrick", 0x7B7B7B}, {"purpur", 0xA77BA7},
        {"end_stone", 0xDBDE9E}, {"end_brick", 0xDBDE9E}, {"bookshelf", 0x6B5230}, {"polished_blackstone", 0x353036},
        {"chiseled_deepslate", 0x3A3A3E}, {"deepslate_brick", 0x474749}, {"deepslate_tile", 0x363638},
        {"smooth_red_sandstone", 0xB6652A}, {"cut_sandstone", 0xD9CF9B}, {"cut_red_sandstone", 0xB6652A},
        {"stone_stairs", 0x7F7F7F}, {"cobblestone_wall", 0x7A7A7A}, {"nether_wart_block", 0x730E0E}, {"warped_wart", 0x167E86},
        {"glowstone", 0xAB8654}, {"sea_lantern", 0xACC7BC}, {"shroomlight", 0xF09340}, {"bone_block", 0xE3DFC8},
        {"honeycomb", 0xE5A31A}, {"slime", 0x70C05A}, {"sponge", 0xC4C14A}, {"tnt", 0xC03A2A},
        {"grass_block", 0x62A83A}, {"grass_path", 0x95804A}, {"dirt_path", 0x95804A}, {"mycelium", 0x6F6369},
        {"podzol", 0x5B4020}, {"farmland", 0x6A4A2E}, {"coarse_dirt", 0x77553B}, {"rooted_dirt", 0x80583F},
        {"mud_brick", 0x8A6B5A}, {"mud", 0x3C3A3F}, {"dirt", 0x866043}, {"moss", 0x596E2C},
        {"tall_grass", 0x5FA13A}, {"short_grass", 0x5FA13A}, {"fern", 0x4F8F32}, {"vine", 0x3F7F2A},
        {"lily", 0x2E7A2A}, {"cactus", 0x3E7A2A}, {"pumpkin", 0xC07615}, {"melon", 0x8CA026}, {"hay", 0xB69A12},
        {"soul_sand", 0x51402F}, {"soul_soil", 0x4B3A2D}, {"red_sandstone", 0xB6652A}, {"sandstone", 0xD9CF9B},
        {"red_sand", 0xBE6621}, {"sand", 0xDBD3A0}, {"gravel", 0x837F7E}, {"powder_snow", 0xF8FDFD},
        {"snow", 0xF8FDFD}, {"packed_ice", 0x8DB4F5}, {"blue_ice", 0x74A8FD}, {"ice", 0x91B8FE},
        {"bedrock", 0x555555}, {"clay", 0xA0A6B3}, {"lava", 0xE25F12}, {"magma", 0x8A3A1A},
        {"obsidian", 0x14121E}, {"netherrack", 0x6F3535}, {"nether_brick", 0x2C161A}, {"basalt", 0x4A4A4E},
        {"blackstone", 0x2B2429}, {"cobbled_deepslate", 0x4D4D51}, {"deepslate", 0x4C4C50}, {"tuff", 0x6C6D64},
        {"calcite", 0xE0E0DA}, {"dripstone", 0x7E6454}, {"andesite", 0x888888}, {"diorite", 0xBDBDBD},
        {"granite", 0x9A6B58}, {"mossy_cobblestone", 0x6E8A5A}, {"cobblestone", 0x7A7A7A},
        {"stone_brick", 0x7B7B7B}, {"smooth_stone", 0x9E9E9E}, {"stone", 0x7F7F7F}, {"brick", 0x966A5A},
        {"quartz", 0xEAE5DE}, {"prismarine", 0x63A0A0}, {"glass", 0xC5E6EE}, {"iron_block", 0xDCDCDC},
        {"gold_block", 0xF6D03E}, {"oxidized", 0x4FA88A}, {"weathered", 0x6BA38A}, {"exposed", 0xA17E68},
        {"copper", 0xC06A4C}, {"diamond_block", 0x62EDE4}, {"emerald_block", 0x2ACB58}, {"lapis_block", 0x1F4A9A},
        {"coal_block", 0x111111}, {"bamboo", 0x7A9A2A}, {"grass", 0x5FA13A}};
    for (auto const& r : rules)
        if (has(n, r.key)) return r.rgb;
    return 0;
}

bool isWater(std::string const& n) { return n == "minecraft:water" || n == "minecraft:flowing_water"; }

std::unordered_map<::Block const*, uint32_t> gBlockCol; // per-block-state colour cache (avoids string work per column)

std::filesystem::path rootDir();
std::set<std::string> gLoggedNames;
void logUnmapped(std::string const& name, uint32_t col) {
    if (gLoggedNames.size() > 600 || !gLoggedNames.insert(name).second) return;
    std::error_code ec;
    std::filesystem::create_directories(rootDir(), ec);
    std::ofstream f(rootDir() / "unmapped_blocks.txt", std::ios::app);
    if (f) { char b[64]; std::snprintf(b, sizeof(b), " -> %06X (engine map colour)\n", unsigned(col & 0xFFFFFF)); f << name << b; }
}


// ---------- Java Diorama colour table (vanilla_looks.dat) ----------
std::unordered_map<std::string, uint16_t>& vanillaIndex() {
    static std::unordered_map<std::string, uint16_t> m = [] {
        std::unordered_map<std::string, uint16_t> r;
        for (int i = 0; i < minimap2::vanilla::kBlockCount; ++i) r[minimap2::vanilla::kBlocks[i].name] = minimap2::vanilla::kBlocks[i].look;
        return r;
    }();
    return m;
}
std::string bedrockToJava(std::string n) {
    if (n.rfind("minecraft:", 0) == 0) n = n.substr(10);
    static const std::pair<char const*, char const*> alias[] = {
        {"brick_block", "bricks"}, {"stonebrick", "stone_bricks"}, {"red_nether_brick", "red_nether_bricks"},
        {"nether_brick", "nether_bricks"}, {"grass_path", "dirt_path"}, {"snow_layer", "snow"}, {"web", "cobweb"},
        {"flowing_water", "water"}, {"flowing_lava", "lava"}, {"mossy_stone_brick", "mossy_stone_bricks"},
        {"quartz_bricks", "quartz_bricks"}, {"sea_lantern", "sea_lantern"}, {"magma", "magma_block"},
        {"hardened_clay", "terracotta"}, {"concretepowder", "white_concrete_powder"}, {"reeds", "sugar_cane"},
        {"waterlily", "lily_pad"}, {"tallgrass", "short_grass"}, {"short_grass", "short_grass"}, {"grass", "grass_block"},
        {"mob_spawner", "spawner"}, {"stone_stairs", "cobblestone_stairs"}, {"stone_brick_stairs", "stone_brick_stairs"}};
    for (auto const& a : alias) if (n == a.first) return a.second;
    return n;
}
uint32_t mulTint(uint32_t base, uint32_t tint) {
    uint32_t r = ((base >> 16) & 255) * ((tint >> 16) & 255) / 255, g = ((base >> 8) & 255) * ((tint >> 8) & 255) / 255, b = (base & 255) * (tint & 255) / 255;
    return (r << 16) | (g << 8) | b;
}
// plains-like fixed biome tint (temperature 0.8, downfall 0.4); real per-biome tint is a TODO
uint32_t biomeTint(int kind) {
    float temp = 0.8f, down = 0.4f * temp;
    int   x = std::clamp(int((1.0f - temp) * 63.0f), 0, 63), y = std::clamp(int((1.0f - down) * 63.0f), 0, 63);
    if (kind == 1) return minimap2::vanilla::kMap_grass[y * 64 + x];
    if (kind == 2) return minimap2::vanilla::kMap_foliage[y * 64 + x];
    if (kind == 3) return minimap2::vanilla::kMap_dry_foliage[y * 64 + x];
    if (kind == 4) return 0x3F76E4;
    return 0xFFFFFF;
}
// returns 0 when the block is not in the table
uint32_t vanillaRgb(std::string const& bedrockName, bool side) {
    auto& idx = vanillaIndex();
    auto  it  = idx.find(bedrockToJava(bedrockName));
    if (it == idx.end()) return 0;
    auto const& L = minimap2::vanilla::kLooks[it->second];
    if (L.kind == 0) return 0;
    uint32_t base = side ? L.side : L.top, tinted = side ? L.sideTinted : L.topTinted;
    float    w    = side ? L.sideW : L.topW;
    uint32_t rgb  = base & 0xFFFFFF;
    if (w > 0.0f) {
        // as TileBaker.albedo/tint: kind 0 = constant tint (spruce/birch leaves etc.; 0xFFFFFFFF = white), else biome map
        uint32_t tint = (L.tint == 0) ? (L.constTint == 0xFFFFFFFFu ? 0xFFFFFFu : (L.constTint & 0xFFFFFFu)) : biomeTint(L.tint);
        auto lin = [](uint32_t c) { float f = float(c) / 255.0f; return f <= 0.04045f ? f / 12.92f : std::pow((f + 0.055f) / 1.055f, 2.4f); };
        auto enc = [](float f) { f = std::clamp(f, 0.0f, 1.0f); float v = f <= 0.0031308f ? f * 12.92f : 1.055f * std::pow(f, 1.0f / 2.4f) - 0.055f; return uint32_t(v * 255.0f + 0.5f); };
        uint32_t out = 0;
        for (int sh = 16; sh >= 0; sh -= 8) {
            float bl = lin((rgb >> sh) & 255), tl = lin((tinted >> sh) & 255) * lin((tint >> sh) & 255);
            out |= enc(bl * (1.0f - w) + tl * w) << sh;
        }
        rgb = out;
    }
    {
        uint32_t r0 = (rgb >> 16) & 255, g0 = (rgb >> 8) & 255, b0 = rgb & 255;
        bool plantish = bedrockName.find("leaves") != std::string::npos || bedrockName.find("vine") != std::string::npos;
        if (plantish && (r0 * 2126 + g0 * 7152 + b0 * 722) / 10000 < 28) {
            uint32_t f = biomeTint(2); // darkened foliage colour instead of black
            rgb = (((f >> 16) & 255) * 7 / 10 << 16) | (((f >> 8) & 255) * 7 / 10 << 8) | ((f & 255) * 7 / 10);
        }
    }
    return rgb ? rgb : 0x010101;
}
std::unordered_map<::Block const*, uint32_t> gBlockSide;

std::set<std::string> gLoggedColors;
void logBlockColor(std::string const& name, uint32_t col) {
    if (gLoggedColors.size() > 1500 || !gLoggedColors.insert(name).second) return;
    std::error_code ec;
    std::filesystem::create_directories(rootDir(), ec);
    std::ofstream f(rootDir() / "block_colors.txt", std::ios::app);
    if (f) { char b[48]; std::snprintf(b, sizeof(b), " -> %06X\n", unsigned(col & 0xFFFFFF)); f << name << b; }
}

uint32_t colorOfBlock(::BlockSource& region, ::BlockPos const& pos, ::Block const& block) {
    auto it = gBlockCol.find(&block);
    if (it != gBlockCol.end()) return it->second;
    std::string const& name = block.getTypeName();
    uint32_t           col;
    uint32_t           rgb = vanillaRgb(name, false);
    if (!rgb) rgb = blockRgb(name);
    if (rgb) {
        col = 0xFF000000u | rgb;
        logBlockColor(name, col);
    } else {
        ::mce::Color mc = block.getBlockType().getMapColor(region, pos, block);
        float r = mc.r, g = mc.g, b = mc.b;
        if (mc.a < 0.02f || std::max({r, g, b}) < 0.02f) {
            uint32_t hh = 2166136261u;
            for (char ch : name) hh = (hh ^ uint8_t(ch)) * 16777619u;
            r = 0.30f + float(hh & 255) / 255.0f * 0.30f;
            g = 0.30f + float((hh >> 8) & 255) / 255.0f * 0.30f;
            b = 0.30f + float((hh >> 16) & 255) / 255.0f * 0.30f;
        }
        col = pack(0.09f + r * 0.91f, 0.09f + g * 0.91f, 0.09f + b * 0.91f);
        logUnmapped(name, col);
    }
    gBlockCol[&block] = col;
    return col;
}


uint32_t colorOfBlockSide(::BlockSource& region, ::BlockPos const& pos, ::Block const& block) {
    auto it = gBlockSide.find(&block);
    if (it != gBlockSide.end()) return it->second;
    uint32_t rgb = vanillaRgb(block.getTypeName(), true);
    uint32_t col = rgb ? (0xFF000000u | rgb) : colorOfBlock(region, pos, block);
    gBlockSide[&block] = col;
    return col;
}

uint32_t shapeAlpha(std::string const& n) {
    if (n.find("slab") != std::string::npos) return 0xE1;
    if (n.find("stairs") != std::string::npos) return 0xE2;
    return 0xFF;
}
uint32_t withShape(uint32_t c, uint32_t a) { return (c & 0xFFFFFFu) | (a << 24); }
bool isSmallPlant(std::string const& n) {
    static char const* keys[] = {"short_grass", "tall_grass", "fern", "tulip", "poppy", "dandelion", "orchid", "allium", "azure_bluet", "cornflower",
                                 "lily_of_the_valley", "oxeye", "sapling", "torch", "rail", "button", "lever", "sign", "flower", "vine", "lichen", "sweet_berry",
                                 "wheat", "carrots", "potatoes", "beetroots", "dead_bush", "seagrass", "kelp", "pointed_dripstone", "lantern", "candle"};
    for (char const* k : keys) if (n.find(k) != std::string::npos) return true;
    return false;
}

// need < 0: only colour/height (cheap); else also the wall profile down to `need` blocks (deeper entries repeat the last colour)
bool scanColumn(::BlockSource& region, int x, int z, uint32_t& col, int16_t& h, uint32_t* wall, int need) {
    int minH = region.getMinHeight();
    int y    = int(region.getAboveTopSolidBlock(x, z, true, true)) - 1;
    if (y < minH) return false;
    ::BlockPos pos{x, y, z};
    ::Block const* block = &region.getBlock(pos);
    for (int guard = 0; block->isAir() && y > minH && guard < 24; ++guard) {
        --y;
        pos   = ::BlockPos{x, y, z};
        block = &region.getBlock(pos);
    }
    if (block->isAir()) return false;

    std::string const& name = block->getTypeName();
    if (isWater(name)) {
        int depth = 0;
        for (int yy = y - 1; depth < 6 && yy > minH; --yy) {
            ::BlockPos p2{x, yy, z};
            if (!isWater(region.getBlock(p2).getTypeName())) break;
            ++depth;
        }
        float k = 1.0f - float(depth) * 0.08f;
        col     = pack(0.16f * k, 0.34f * k, 0.84f * k);
        if (wall) for (int k2 = 0; k2 < NW; ++k2) wall[k2] = col;
    } else {
        col = colorOfBlock(region, pos, *block);
        if (wall) {
            wall[0]       = withShape(colorOfBlockSide(region, pos, *block), shapeAlpha(name));
            uint32_t prev = wall[0];
            for (int k = 1; k < NW; ++k) {
                int yy = y - k;
                if (k > need || yy < minH) { wall[k] = prev; continue; }
                ::BlockPos p2{x, yy, z};
                ::Block const& b2 = region.getBlock(p2);
                if (b2.isAir() || isWater(b2.getTypeName()) || isSmallPlant(b2.getTypeName())) {
                    wall[k] = 0u; // 0 = air gap (open window, space under a roof or canopy)
                    continue;
                }
                prev    = withShape(colorOfBlockSide(region, p2, b2), shapeAlpha(b2.getTypeName()));
                wall[k] = prev;
            }
        }
    }
    h = int16_t(y);
    return true;
}

void markDirty(int cx, int cz);

bool scanChunk(::BlockSource& region, int cx, int cz, ChunkData& cd) {
    ::BlockPos probe{cx * 16 + 8, 64, cz * 16 + 8};
    if (!region.getChunkAt(probe)) return false;
    bool    changed = false;
    int     minH    = region.getMinHeight();
    // pass 1: colour + height of every column (cheap)
    uint32_t cols[256]; int16_t hs[256]; bool ok[256];
    for (int lz = 0; lz < 16; ++lz)
        for (int lx = 0; lx < 16; ++lx) {
            int idx = lz * 16 + lx;
            ok[idx] = scanColumn(region, cx * 16 + lx, cz * 16 + lz, cols[idx], hs[idx], nullptr, -1);
        }
    // pass 2: wall profile, only as deep as the wall below the column can be seen (height difference to the southern neighbour)
    for (int lz = 0; lz < 16; ++lz) {
        for (int lx = 0; lx < 16; ++lx) {
            int idx = lz * 16 + lx;
            if (!ok[idx]) continue;
            int hSouth;
            if (lz < 15 && ok[idx + 16]) hSouth = hs[idx + 16];
            else {
                int t = int(region.getAboveTopSolidBlock(cx * 16 + lx, cz * 16 + lz + 1, true, true)) - 1;
                hSouth = t > minH ? t : int(hs[idx]) - 24;
            }
            int need = std::clamp(int(hs[idx]) - hSouth + 3, 2, NW - 1);
            uint32_t col = 0; int16_t h = 0;
            uint32_t w[NW];
            if (!scanColumn(region, cx * 16 + lx, cz * 16 + lz, col, h, w, need)) continue;
            bool wallChanged = storeWall(cd, idx, w);
            if (cd.color[idx] != col || cd.height[idx] != h || wallChanged) {
                cd.color[idx]  = col;
                cd.height[idx] = h;
                changed        = true;
                cd.dirty       = true;
            }
        }
    }
    cd.scanned  = true;
    cd.lastScan = gFrame;
    if (changed) {
        ++gVersion;
        markDirty(cx, cz);
        if (gChangedChunks.size() < 20000) gChangedChunks.push_back({cx, cz});
    }
    return true;
}

// Chunk offsets sorted by distance: nearest chunks are scanned first.
std::vector<std::pair<int, int>> const& chunkOffsets() {
    static std::vector<std::pair<int, int>> v = [] {
        constexpr int CR = 13;
        std::vector<std::pair<int, int>> o;
        for (int dz = -CR; dz <= CR; ++dz)
            for (int dx = -CR; dx <= CR; ++dx) o.emplace_back(dx, dz);
        std::sort(o.begin(), o.end(), [](auto& a, auto& b) {
            return a.first * a.first + a.second * a.second < b.first * b.first + b.second * b.second;
        });
        return o;
    }();
    return v;
}

void updateCache(::BlockSource& region, int px, int pz) {
    int pcx = floorDiv16(px), pcz = floorDiv16(pz);
    int budget = 3; // chunks scanned per frame
    for (auto const& [dx, dz] : chunkOffsets()) {
        if (budget <= 0) break;
        int  cx = pcx + dx, cz = pcz + dz;
        ChunkData* cdp;
        {
            std::lock_guard<std::mutex> lk(gMapMx);
            cdp = &gCache[key(cx, cz)];
        }
        auto& cd = *cdp;
        bool need = cd.scanned ? (gFrame - cd.lastScan >= 900) : (gFrame - cd.lastTry >= 60 || cd.lastTry == 0);
        if (!need) continue;
        cd.lastTry = gFrame;
        if (scanChunk(region, cx, cz, cd)) --budget;
    }
}


// ---------- persistence: one file per 32x32-chunk region, per world ----------
std::string                    gWorldKey;
std::filesystem::path          gRoot;
std::unordered_set<int64_t>    gDirtyRegions;
uint64_t                       gLastSaveFrame = 0;
uint64_t                       gLastDrawTick  = 0;

int floorDiv32(int v) { return v >> 5; }

void markDirty(int cx, int cz) { gDirtyRegions.insert(key(floorDiv32(cx), floorDiv32(cz))); }

std::filesystem::path rootDir() {
    if (!gRoot.empty()) return gRoot;
    char  buf[MAX_PATH] = {};
    DWORD n             = GetEnvironmentVariableA("APPDATA", buf, MAX_PATH);
    std::filesystem::path base = (n > 0 && n < MAX_PATH) ? std::filesystem::path(std::string(buf, n)) : std::filesystem::path(".");
    gRoot = base / "minimap2";
    return gRoot;
}

std::filesystem::path worldDir() { return rootDir() / gWorldKey; }

std::filesystem::path regionFile(int rx, int rz) {
    return worldDir() / ("r." + std::to_string(rx) + "." + std::to_string(rz) + ".bin");
}

void saveRegion(int rx, int rz) {
    if (gWorldKey.empty()) return;
    std::error_code ec;
    std::filesystem::create_directories(worldDir(), ec);
    std::ofstream f(regionFile(rx, rz), std::ios::binary | std::ios::trunc);
    if (!f) return;
    uint32_t count = 0;
    for (int dz = 0; dz < 32; ++dz)
        for (int dx = 0; dx < 32; ++dx) {
            auto it = gCache.find(key(rx * 32 + dx, rz * 32 + dz));
            if (it != gCache.end()) { ++count; }
        }
    f.write("DBM6", 4);
    f.write(reinterpret_cast<char const*>(&count), 4);
    for (int dz = 0; dz < 32; ++dz)
        for (int dx = 0; dx < 32; ++dx) {
            int  cx = rx * 32 + dx, cz = rz * 32 + dz;
            auto it = gCache.find(key(cx, cz));
            if (it == gCache.end()) continue;
            f.write(reinterpret_cast<char const*>(&cx), 4);
            f.write(reinterpret_cast<char const*>(&cz), 4);
            f.write(reinterpret_cast<char const*>(it->second.color.data()), 256 * 4);
            f.write(reinterpret_cast<char const*>(it->second.height.data()), 256 * 2);
            uint16_t pn = uint16_t(it->second.palN);
            f.write(reinterpret_cast<char const*>(&pn), 2);
            f.write(reinterpret_cast<char const*>(it->second.pal.data()), pn * 4);
            f.write(reinterpret_cast<char const*>(it->second.wallId.data()), 256 * NW);
            it->second.dirty = false;
        }
}

void saveAll() {
    for (int64_t k : gDirtyRegions) saveRegion(int(k >> 32), int(int32_t(uint32_t(k & 0xFFFFFFFFu))));
    gDirtyRegions.clear();
}

void loadWorld() {
    if (gWorldKey.empty()) return;
    std::error_code ec;
    for (auto const& e : std::filesystem::directory_iterator(worldDir(), ec)) {
        if (ec) break;
        std::ifstream f(e.path(), std::ios::binary);
        char          magic[4] = {};
        uint32_t      count    = 0;
        if (!f.read(magic, 4) || std::string(magic, 2) != "DB" || magic[2] != 'M' || magic[3] < '2' || magic[3] > '6' || !f.read(reinterpret_cast<char*>(&count), 4)) continue;
        for (uint32_t i = 0; i < count && i < 1024; ++i) {
            int       cx = 0, cz = 0;
            ChunkData cd;
            if (!f.read(reinterpret_cast<char*>(&cx), 4) || !f.read(reinterpret_cast<char*>(&cz), 4)) break;
            if (!f.read(reinterpret_cast<char*>(cd.color.data()), 256 * 4)) break;
            if (!f.read(reinterpret_cast<char*>(cd.height.data()), 256 * 2)) break;
            if (magic[3] == '6') {
                uint16_t pn = 0;
                if (!f.read(reinterpret_cast<char*>(&pn), 2) || pn < 1 || pn > 255) break;
                if (!f.read(reinterpret_cast<char*>(cd.pal.data()), pn * 4)) break;
                if (!f.read(reinterpret_cast<char*>(cd.wallId.data()), 256 * NW)) break;
                cd.palN = pn;
            } else {
                // old formats: wall profile of 32/16/8 u32 entries per column; convert (top colour for the whole depth when unknown)
                int oldN = magic[3] == '5' ? 32 : (magic[3] == '4' ? 16 : (magic[3] == '3' ? 8 : 0));
                static constexpr int d5[32] = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 26, 29, 32, 36, 40, 48, 56, 64};
                static constexpr int d4[16] = {0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 17, 21, 26, 32};
                static constexpr int d3[8]  = {0, 1, 2, 4, 7, 11, 16, 24};
                std::vector<uint32_t> old(size_t(256) * size_t(std::max(oldN, 1)), 0u);
                if (oldN && !f.read(reinterpret_cast<char*>(old.data()), std::streamsize(old.size() * 4))) break;
                int const* dt = oldN == 32 ? d5 : (oldN == 16 ? d4 : d3);
                for (int i2 = 0; i2 < 256; ++i2) {
                    uint32_t w[NW];
                    for (int k = 0; k < NW; ++k) {
                        if (!oldN) { w[k] = cd.color[i2]; continue; }
                        int o = 0;
                        while (o + 1 < oldN && dt[o + 1] <= k) ++o;
                        w[k] = old[size_t(i2) * size_t(oldN) + size_t(o)];
                    }
                    storeWall(cd, i2, w);
                }
            }
            cd.scanned = false; // will be refreshed when the chunk is loaded again
            std::lock_guard<std::mutex> lk(gMapMx);
            gCache[key(cx, cz)] = cd;
        }
    }
    ++gVersion;
}

std::string computeWorldKey(::Level& level) {
    std::string id = level.getLevelId();
    std::string s;
    for (char c : id)
        if (std::isalnum(uint8_t(c)) && s.size() < 40) s += c;
    char seed[16];
    std::snprintf(seed, sizeof(seed), "%08x", unsigned(level.getSeed()));
    return std::string(seed) + "_" + s;
}

void asyncQuiesce();
void resetSlots();
void clearTiles();

void switchWorld(std::string const& k) {
    saveAll();
    asyncQuiesce(); // the bake worker must not touch gCache while it is cleared
    resetSlots();
    clearTiles();
    {
        std::lock_guard<std::mutex> lk(gMapMx);
        gCache.clear();
    }
    gDirtyRegions.clear();
    gWorldKey = k;
    loadWorld();
}

// ---------- oblique "diorama" projection, baked to merged rectangles ----------
// Units: 1 unit = one map cell horizontally. Rows are squashed by KY, heights lift by HS per block.
constexpr float KY  = 0.75f; // pitch ~48.6 deg; KY*PPC must stay an integer (3 px) // 3 px per row at 4 px/cell: pixel-exact so re-bakes are invisible
constexpr float HS  = 0.63f; // lift per block (Java: cos/sin * KY = 0.63)
constexpr int   PPC = 4;     // texture pixels per map cell

struct Rect {
    float    x0, y0, x1, y1;
    uint32_t col;
    int16_t  h; // block height of this surface (used for depth outlines in the texture path)
};

struct Baked {
    int                cx = INT32_MIN, cz = INT32_MIN, h0 = INT32_MIN, n = 0, step = 0, view = 0;
    uint64_t           version = 0, frame = 0, bakeId = 0;
    std::vector<Rect>  rects;
};

uint32_t shade(uint32_t col, float k) {
    auto m = [k](uint32_t v) { return uint32_t(std::min(255.0f, float(v) * k) + 0.5f); };
    return 0xFF000000u | (m((col >> 16) & 255) << 16) | (m((col >> 8) & 255) << 8) | m(col & 255);
}

bool sample(Sampler& s, int x, int z, uint32_t& col, int& h, WRef* wall = nullptr) {
    ChunkData* c = s.get(x, z);
    if (!c) return false;
    int idx = (z & 15) * 16 + (x & 15);
    if (!c->color[idx]) return false;
    col = c->color[idx];
    h   = c->height[idx];
    if (wall) *wall = WRef{&c->wallId[size_t(idx) * NW], c->pal.data()};
    return true;
}

int groundHeight(int x, int z, int fallback) {
    Sampler s;
    uint32_t c;
    int      h;
    return sample(s, x, z, c, h) ? h : fallback;
}

// One map cell. For step>1 it averages 2x2 columns spread over the cell (less aliasing / detail loss when zoomed out).
bool sampleCell(Sampler& s, int x, int z, int step, uint32_t& col, int& h, WRef* wall) {
    if (step <= 1) return sample(s, x, z, col, h, wall);
    int      g   = std::min(step, 4);          // g x g samples spread over the cell
    int      cnt = 0, hs = 0, hmax = INT_MIN;
    uint32_t r = 0, gg = 0, bl = 0;
    uint32_t topCol = 0; WRef topWall;
    for (int oz = 0; oz < g; ++oz)
        for (int ox = 0; ox < g; ++ox) {
            uint32_t c; int hh; WRef w;
            if (!sample(s, x + (ox * step) / g, z + (oz * step) / g, c, hh, &w)) continue;
            if (hh > hmax) { hmax = hh; topCol = c; topWall = w; }
            r += (c >> 16) & 255; gg += (c >> 8) & 255; bl += c & 255; hs += hh; ++cnt;
        }
    if (!cnt) return false;
    // blend average colour with the highest column so buildings/trees keep their look at distance
    uint32_t ar = r / cnt, ag = gg / cnt, ab = bl / cnt;
    uint32_t tr = (topCol >> 16) & 255, tg = (topCol >> 8) & 255, tb = topCol & 255;
    col = 0xFF000000u | (((ar + tr) / 2) << 16) | (((ag + tg) / 2) << 8) | ((ab + tb) / 2);
    h   = int(std::lround(0.5f * float(hs) / float(cnt) + 0.5f * float(hmax)));
    if (wall) *wall = topWall;
    return true;
}

// epoch != 0: abort early (result is discarded by the caller) when gEpoch moves on (world switch).
std::atomic<uint64_t> gEpoch{1};

void bake(Baked& b, int cx, int cz, int h0, int n, int step, uint64_t version, uint64_t frame, uint64_t epoch) {
    b.cx = cx; b.cz = cz; b.h0 = h0; b.n = n; b.step = step;
    b.version = version; b.frame = frame; ++b.bakeId;
    b.rects.clear();
    // lift in integer pixels: L(h) = floor(h*PPC*HS/step); h0 is a multiple of step so L(h0) is exact -> mapping independent of the bake origin
    auto L = [&](int h) { return std::floor(float(h) * HS * float(PPC) / float(step)); };
    float L0 = L(h0);
    int   rowsHalf = int(float(n) / (2.0f * KY)) + 96;
    int   x0 = cx - (n / 2) * step;
    Sampler s;
    struct Row { std::vector<uint32_t> col; std::vector<int> h; std::vector<WRef> wp; };
    auto fill = [&](Row& r, int z) {
        r.col.assign(size_t(n), 0u); r.h.assign(size_t(n), 0); r.wp.assign(size_t(n), WRef{});
        for (int i = 0; i < n; ++i) {
            uint32_t c = 0; int h = 0; WRef w;
            if (sampleCell(s, x0 + i * step, z, step, c, h, &w)) {
                // sun shadows (like Diorama): sun to the west / slightly south; a taller block towards the sun darkens this cell
                float m = -1e9f;
                for (int d = step; d <= 12; d += step) {
                    int ox = x0 + i * step + int(std::lround(-0.878f * float(d))), oz = z + int(std::lround(0.479f * float(d)));
                    uint32_t c2; int h2;
                    if (!sample(s, ox, oz, c2, h2)) continue;
                    m = std::max(m, float(h2 - h) - float(d) * 0.9f);
                }
                if (m >= 2.0f) c = shade(c, 0.72f); else if (m >= 0.5f) c = shade(c, 0.85f);
                r.col[size_t(i)] = c; r.h[size_t(i)] = h; r.wp[size_t(i)] = w;
            }
        }
    };
    std::vector<uint32_t> wh(size_t(n), 0u);
    std::vector<int>      dh(size_t(n), 0);
    std::vector<std::array<uint32_t, NW>> wl(static_cast<size_t>(n));
    Row cur, nxt;
    fill(nxt, cz + (-rowsHalf) * step);
    for (int j = -rowsHalf; j <= rowsHalf; ++j) {
        if (epoch && gEpoch.load() != epoch) return;
        std::swap(cur, nxt);
        fill(nxt, cz + (j + 1) * step);
        for (int i = 0; i < n; ++i) {
            wh[size_t(i)] = 0; dh[size_t(i)] = 0;
            if (!cur.col[size_t(i)]) continue;
            int h = cur.h[size_t(i)];
            int d = 0;
            if (nxt.col[size_t(i)] && h > nxt.h[size_t(i)]) d = std::min(h - nxt.h[size_t(i)], 96);
            dh[size_t(i)] = d;
            WRef wp = cur.wp[size_t(i)];
            if (d > 0 && wp) {
                for (int q = 0; q < NW; ++q) wl[size_t(i)][size_t(q)] = wp[q];
                uint32_t hs = 2166136261u;
                int used = 0;
                while (used + 1 < NW && kWallDepth[used + 1] < d) ++used;
                for (int k = 0; k <= used; ++k) hs = (hs ^ wp[k]) * 16777619u;
                wh[size_t(i)] = hs | 1u;
            }
        }
        float rowY = float(n) * 0.5f + float(j) * KY;
        int i = 0;
        while (i < n) {
            if (!cur.col[size_t(i)]) { ++i; continue; }
            int e = i + 1;
            while (e < n && cur.col[size_t(e)] == cur.col[size_t(i)] && cur.h[size_t(e)] == cur.h[size_t(i)] &&
                   dh[size_t(e)] == dh[size_t(i)] && wh[size_t(e)] == wh[size_t(i)])
                ++e;
            int   hh   = cur.h[size_t(i)];
            float Lh   = L(hh);
            float yTop = rowY - (Lh - L0) / float(PPC);
            float yBot = yTop + KY;
            auto  push = [&](float ya, float yb, uint32_t c, int hv) {
                if (yb <= 0.0f || ya >= float(n)) return;
                b.rects.push_back({float(i), std::max(ya, 0.0f), float(e), std::min(yb, float(n)), c, int16_t(hv)});
            };
            push(yTop, yBot, cur.col[size_t(i)], hh);
            int d = dh[size_t(i)];
            if (d > 0) {
                int t0 = 0, k = 0;
                while (t0 < d) {
                    while (k + 1 < NW && kWallDepth[k + 1] <= t0) ++k;
                    int t1 = (k + 1 < NW) ? std::min(kWallDepth[k + 1], d) : d;
                    uint32_t wc = wl[size_t(i)][size_t(k)];
                    push(yBot + (Lh - L(hh - t0)) / float(PPC), yBot + (Lh - L(hh - t1)) / float(PPC), shade(wc ? wc : cur.col[size_t(i)], 0.62f), hh - t0);
                    t0 = t1;
                }
            }
            i = e;
        }
    }
}

void ensureBaked(Baked& b, int cx, int cz, int h0, int n, int step, uint64_t minInterval) {
    bool geom  = b.cx != cx || b.cz != cz || b.h0 != h0 || b.n != n || b.step != step;
    bool dirty = b.version != gVersion && gFrame - b.frame >= minInterval;
    if (geom || dirty) bake(b, cx, cz, h0, n, step, gVersion, gFrame, 0);
}

Baked gMini, gBig;

::mce::Color toColor(uint32_t c) {
    return ::mce::Color{((c >> 16) & 255) / 255.0f, ((c >> 8) & 255) / 255.0f, (c & 255) / 255.0f, 1.0f};
}

void rect(::MinecraftUIRenderContext& ctx, float x0, float y0, float x1, float y1, ::mce::Color const& c, float a = 1.0f) {
    ::RectangleArea r{};
    r._x0 = x0;
    r._y0 = y0;
    r._x1 = x1;
    r._y1 = y1;
    ctx.fillRectangle(r, c, a);
}


// ---------- tiny 3x5 pixel font (no engine font access needed) ----------
// each glyph: 5 rows x 3 bits, row-major, MSB = left pixel
struct Glyph { char ch; uint16_t bits; };
constexpr Glyph kGlyphs[] = {
    {'0', 0b111101101101111}, {'1', 0b010110010010111}, {'2', 0b111001111100111}, {'3', 0b111001111001111},
    {'4', 0b101101111001001}, {'5', 0b111100111001111}, {'6', 0b111100111101111}, {'7', 0b111001001001001},
    {'8', 0b111101111101111}, {'9', 0b111101111001111}, {'-', 0b000000111000000}, {',', 0b000000000010100},
    {'.', 0b000000000000010}, {':', 0b000010000010000}, {'+', 0b000010111010000}, {' ', 0},
    {'A', 0b010101111101101}, {'B', 0b110101110101110}, {'C', 0b011100100100011}, {'D', 0b110101101101110},
    {'E', 0b111100110100111}, {'F', 0b111100110100100}, {'G', 0b011100101101011}, {'H', 0b101101111101101},
    {'I', 0b111010010010111}, {'K', 0b101101110101101}, {'L', 0b100100100100111}, {'M', 0b101111111101101},
    {'N', 0b110101101101101}, {'O', 0b010101101101010}, {'P', 0b110101110100100}, {'R', 0b110101110101101},
    {'S', 0b011100010001110}, {'T', 0b111010010010010}, {'U', 0b101101101101111}, {'V', 0b101101101101010},
    {'W', 0b101101111111101}, {'Y', 0b101101010010010}, {'Z', 0b111001010100111}, {'X', 0b101101010101101},
    {'Q', 0b010101101111011}, {'J', 0b001001001101010}, {'|', 0b010010010010010},
    // Cyrillic letters that differ from Latin (А В Е К М Н О Р С Т Х are mapped to Latin ones in drawPixText)
    {'\x01', 0b111101101101101}, /* П */ {'\x02', 0b011101101111101}, /* Д */ {'\x03', 0b101010111010101}, /* Ж */
    {'\x04', 0b011101101101101}, /* Л */ {'\x05', 0b101101111001001}, /* Ч */ {'\x06', 0b101101101111001}, /* Ц */
    {'\x07', 0b100100110101110}, /* Ь */ {'\x08', 0b111100111101111}, /* Б */ {'\x09', 0b111001011001111}, /* З */
    {'\x0B', 0b101101111011101}, /* И */ {'\x0C', 0b011101011101101}, /* Я */ {'\x0E', 0b101101111001110}, /* У */
    {'\x0F', 0b101101101101111}, /* Ш */};

// decode UTF-8 to glyph keys (Latin upper-case, Cyrillic mapped to Latin look-alikes or private keys 0x01..0x0F)
std::vector<char> glyphKeys(std::string const& t) {
    std::vector<char> out;
    for (size_t i = 0; i < t.size();) {
        uint8_t c = uint8_t(t[i]);
        if (c < 0x80) { out.push_back(char(std::toupper(c))); ++i; continue; }
        if ((c == 0xD0 || c == 0xD1) && i + 1 < t.size()) {
            int cp = ((c & 0x1F) << 6) | (uint8_t(t[i + 1]) & 0x3F);
            i += 2;
            if (cp >= 0x430 && cp <= 0x44F) cp -= 0x20; // lower -> upper
            switch (cp) {
            case 0x410: out.push_back('A'); break; case 0x412: out.push_back('B'); break; case 0x415: out.push_back('E'); break;
            case 0x41A: out.push_back('K'); break; case 0x41C: out.push_back('M'); break; case 0x41D: out.push_back('H'); break;
            case 0x41E: out.push_back('O'); break; case 0x420: out.push_back('P'); break; case 0x421: out.push_back('C'); break;
            case 0x422: out.push_back('T'); break; case 0x425: out.push_back('X'); break;
            case 0x41F: out.push_back('\x01'); break; case 0x414: out.push_back('\x02'); break; case 0x416: out.push_back('\x03'); break;
            case 0x41B: out.push_back('\x04'); break; case 0x427: out.push_back('\x05'); break; case 0x426: out.push_back('\x06'); break;
            case 0x42C: out.push_back('\x07'); break; case 0x411: out.push_back('\x08'); break; case 0x417: out.push_back('\x09'); break;
            case 0x418: out.push_back('\x0B'); break; case 0x42F: out.push_back('\x0C'); break; case 0x423: out.push_back('\x0E'); break;
            case 0x428: out.push_back('\x0F'); break;
            case 0x42B: out.push_back('\x07'); out.push_back('|'); break; // Ы = Ь + bar
            default: out.push_back(' '); break;
            }
            continue;
        }
        ++i; // skip unknown byte
    }
    return out;
}

float textWidth(std::string const& t, float px) { return float(glyphKeys(t).size()) * 4.0f * px; }

void drawPixText(::MinecraftUIRenderContext& ctx, std::string const& t, float x, float y, float px, ::mce::Color const& col) {
    float cx = x;
    for (char u : glyphKeys(t)) {
        for (auto const& g : kGlyphs) {
            if (g.ch != u) continue;
            for (int r = 0; r < 5; ++r)
                for (int c = 0; c < 3; ++c)
                    if (g.bits & (1 << (14 - (r * 3 + c))))
                        rect(ctx, cx + float(c) * px, y + float(r) * px, cx + float(c + 1) * px, y + float(r + 1) * px, col, 1.0f);
            break;
        }
        cx += 4.0f * px;
    }
}

// letter in a small dark box (N/E/S/W around the minimap, like Diorama)
void compassLetter(::MinecraftUIRenderContext& ctx, char ch, float cx, float cy, bool red) {
    constexpr float px = 2.0f;
    float w = 3 * px + 6, h = 5 * px + 6;
    ::mce::Color bg = red ? ::mce::Color{0.55f, 0.18f, 0.16f, 1.0f} : ::mce::Color{0.16f, 0.17f, 0.20f, 1.0f};
    rect(ctx, cx - w / 2 - 1, cy - h / 2 - 1, cx + w / 2 + 1, cy + h / 2 + 1, ::mce::Color{0.85f, 0.87f, 0.92f, 1.0f}, 1.0f);
    rect(ctx, cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, bg, 1.0f);
    drawPixText(ctx, std::string(1, ch), cx - 1.5f * px, cy - 2.5f * px, px, ::mce::Color{0.96f, 0.96f, 0.98f, 1.0f});
}

void drawBaked(::MinecraftUIRenderContext& ctx, Baked const& b, float sx, float sy, float size) {
    float cell = size / float(b.n);
    for (auto const& r : b.rects) {
        rect(ctx, sx + std::floor(r.x0 * cell), sy + std::floor(r.y0 * cell), sx + std::ceil(r.x1 * cell),
             sy + std::ceil(r.y1 * cell), toColor(r.col));
    }
}


// ---------- texture path: rasterise baked rects into ONE RGBA image (outlines + soft fog edge), draw with 1 drawImage ----------
bool        gTexEnabled = true;   // render.txt: mode=rects disables
bool        gTexFailed  = false;  // runtime fallback to rects
bool        gCfgRead    = false;
std::string gMaterial   = "ui_textured_and_glcolor"; // render.txt: material=...
bool        gTexLogged  = false;

void readConfig() {
    gCfgRead = true;
    try {
        std::ifstream f(rootDir() / "render.txt");
        std::string   line;
        while (std::getline(f, line)) {
            while (!line.empty() && (line.back() == '\r' || line.back() == ' ')) line.pop_back();
            if (line == "mode=rects") gTexEnabled = false;
            if (line.rfind("material=", 0) == 0 && line.size() > 9) gMaterial = line.substr(9);
        }
    } catch (...) {}
}

// Double buffered: new bakes are uploaded into the hidden texture and shown 2 frames later, so a half-uploaded
// or not yet resident texture is never drawn (that produced flashes / jumps).
struct Tex {
    uint64_t    bakeId  = 0;
    int         W[2]    = {0, 0};
    int         gen     = 0;
    bool        created[2] = {false, false};
    std::string name[2];
    int         cur       = 0;
    bool        pending   = false;
    uint64_t    pendFrame = 0;
};
Tex gMiniTex, gBigTex;

void blurAlpha(std::vector<uint32_t>& px, int W, int r) {
    if (r < 1) return;
    std::vector<float> a(size_t(W) * W), t(size_t(W) * W);
    for (size_t i = 0; i < a.size(); ++i) a[i] = float(px[i] >> 24);
    float inv = 1.0f / float(2 * r + 1);
    for (int y = 0; y < W; ++y) { // horizontal
        float acc = 0;
        for (int x = -r; x <= r; ++x) acc += a[size_t(y) * W + std::clamp(x, 0, W - 1)];
        for (int x = 0; x < W; ++x) {
            t[size_t(y) * W + x] = acc * inv;
            acc += a[size_t(y) * W + std::min(x + r + 1, W - 1)] - a[size_t(y) * W + std::max(x - r, 0)];
        }
    }
    for (int x = 0; x < W; ++x) { // vertical
        float acc = 0;
        for (int y = -r; y <= r; ++y) acc += t[size_t(std::clamp(y, 0, W - 1)) * W + x];
        for (int y = 0; y < W; ++y) {
            a[size_t(y) * W + x] = acc * inv;
            acc += t[size_t(std::min(y + r + 1, W - 1)) * W + x] - t[size_t(std::max(y - r, 0)) * W + x];
        }
    }
    for (size_t i = 0; i < px.size(); ++i) {
        uint32_t al = uint32_t(std::clamp(a[i], 0.0f, 255.0f) + 0.5f);
        px[i]       = (px[i] & 0x00FFFFFFu) | (al << 24);
    }
}

// ---------- Java-Diorama style renderer on a height field (port of TileBaker.shade/bakePixels, see HANDOFF) ----------
// Camera: pitch 50 deg; screen v = z*KY - y*HS (cells, per step). Far rows are painted first, nearer rows over them.
constexpr float kSinP = 0.7660444f, kCosP = 0.6427876f; // Java pitch 50 deg (used for depth only)
constexpr float kCosE = 0.7880108f, kSinE = 0.6156615f; // sun elevation 38 deg
constexpr float kSunX = kCosE * -0.878f, kSunY = kSinE, kSunZ = kCosE * 0.479f;
constexpr float kJit[4][3] = {{0.03f, 0.0f, -0.02f}, {-0.02f, 0.0f, 0.03f}, {0.02f, 0.0f, 0.02f}, {-0.03f, 0.0f, -0.03f}};
constexpr float kSmp[4][2] = {{0.375f, 0.125f}, {0.875f, 0.375f}, {0.125f, 0.625f}, {0.625f, 0.875f}};
constexpr float kAmbient = 0.34f, kSunStr = 0.62f, kHeightShade = 0.22f, kCornerOcc = 1.5f, kSkyOcc = 0.85f;
constexpr float kSat = 1.35f, kExposure = 1.16f, kOutline = 0.38f, kOutlineDepth = 1.5f, kSideK = 0.82f;
constexpr float kSunTint[3] = {1.14f, 1.0f, 0.8f}, kShadowTint[3] = {0.74f, 0.86f, 1.18f};
constexpr float kAo[4] = {0.6f, 0.74f, 0.87f, 1.0f};

struct SrgbTables {
    float lin[256];
    uint8_t out[4096];
    SrgbTables() {
        for (int i = 0; i < 256; ++i) { double v = i / 255.0; lin[i] = float(v <= 0.04045 ? v / 12.92 : std::pow((v + 0.055) / 1.055, 2.4)); }
        for (int i = 0; i < 4096; ++i) {
            double v = i / 4095.0, s = v <= 0.0031308 ? v * 12.92 : 1.055 * std::pow(v, 1 / 2.4) - 0.055;
            out[i] = uint8_t(std::lround(std::clamp(s, 0.0, 1.0) * 255.0));
        }
    }
};
SrgbTables const& srgb() { static SrgbTables t; return t; }

struct HField {
    int n = 0, step = 1, gn = 0, m = 0, mx = 0, rowsHalf = 0, h0 = 0, cx = 0, cz = 0, x0 = 0;
    int maxH = INT_MIN;
    std::vector<uint32_t>               col;
    std::vector<int16_t>                h;
    std::vector<WRef>                   wp;
    std::vector<float>                  sky;
    size_t id(int gi, int r) const { return size_t(r) * size_t(gn) + size_t(gi); }
    bool   inside(int gi, int r) const { return gi >= 0 && gi < gn && r >= 0 && r < m; }
    bool   known(int gi, int r) const { return inside(gi, r) && col[id(gi, r)] != 0; }
    int    hAt(int gi, int r) const { return known(gi, r) ? int(h[id(gi, r)]) : INT_MIN; }
    bool   occ(int gi, int r, int y) const { return hAt(gi, r) >= y; }
};

float aoCorner(bool a, bool b, bool d) {
    if (a && b) return kAo[0];
    return kAo[3 - (a ? 1 : 0) - (b ? 1 : 0) - (d ? 1 : 0)];
}
float bil(float a, float b, float c, float d, float fx, float fy) {
    float t = a + (b - a) * fx, u = c + (d - c) * fx;
    return t + (u - t) * fy;
}

void buildHField(HField& g, Baked const& b) {
    g.n = b.n; g.step = b.step; g.h0 = b.h0; g.cx = b.cx; g.cz = b.cz;
    g.rowsHalf = int(float(b.n) / (2.0f * KY)) + 96;
    g.m        = 2 * g.rowsHalf + 1;
    g.mx       = int(std::ceil(40.0f * 0.7f / float(b.step))) + 2;
    g.gn       = g.n + g.mx;
    g.x0       = b.cx - (b.n / 2) * b.step;
    size_t N   = size_t(g.gn) * size_t(g.m);
    g.col.assign(N, 0u); g.h.assign(N, 0); g.wp.assign(N, WRef{}); g.sky.assign(N, 1.0f);
    Sampler s;
    for (int gi = 0; gi < g.gn; ++gi) {
        int X = g.x0 + (gi - g.mx) * g.step;
        for (int r = 0; r < g.m; ++r) {
            int Z = g.cz + (r - g.rowsHalf) * g.step;
            uint32_t c = 0; int hh = 0; WRef w;
            if (sampleCell(s, X, Z, g.step, c, hh, &w)) {
                size_t k = g.id(gi, r);
                g.col[k] = c | 0xFF000000u; g.h[k] = int16_t(hh); g.wp[k] = w;
                g.maxH = std::max(g.maxH, hh);
            }
        }
    }
    // sky visibility per cell (a few short rays over the height field instead of Java's 13 voxel rays)
    static constexpr float dirs[8][2] = {{1, 0}, {0.7071f, 0.7071f}, {0, 1}, {-0.7071f, 0.7071f}, {-1, 0}, {-0.7071f, -0.7071f}, {0, -1}, {0.7071f, -0.7071f}};
    static constexpr float dists[7] = {1, 2, 3, 4, 6, 9, 12};
    for (int gi = 0; gi < g.gn; ++gi)
        for (int r = 0; r < g.m; ++r) {
            size_t k = g.id(gi, r);
            if (!g.col[k]) continue;
            float y0 = float(g.h[k]) + 1.0f; int blocked = 0;
            for (auto const& d : dirs) {
                for (float dist : dists) {
                    int hn = g.hAt(gi + int(std::lround(d[0] * dist / float(g.step))), r + int(std::lround(d[1] * dist / float(g.step))));
                    if (hn != INT_MIN && float(hn) + 1.0f > y0 + dist * 0.7f + 0.2f) { ++blocked; break; }
                }
            }
            g.sky[k] = 1.0f - 0.9f * float(blocked) / 8.0f;
        }
}

bool inShadow(HField const& g, float X, float Y, float Z, float dx, float dy, float dz) {
    float base = std::max(1.0f, float(g.step) * 0.5f);
    float t    = 0.35f * base;
    while (t < 40.0f) {
        float py = Y + dy * t;
        if (py > float(g.maxH) + 1.0f) return false;
        int gi = int(std::floor((X + dx * t - float(g.x0)) / float(g.step))) + g.mx;
        int r  = int(std::floor((Z + dz * t - float(g.cz)) / float(g.step))) + g.rowsHalf;
        if (!g.inside(gi, r)) return false;
        size_t k = g.id(gi, r);
        if (g.col[k] && py < float(g.h[k]) + 1.0f) return true;
        t += (t < 4.0f ? 0.5f : 1.0f) * base;
    }
    return false;
}

float skyBilinear(HField const& g, int gi, int r, float fx, float fz) {
    float px = fx - 0.5f, pz = fz - 0.5f;
    int   i0 = gi + (px < 0 ? -1 : 0), r0 = r + (pz < 0 ? -1 : 0);
    float tx = px < 0 ? px + 1.0f : px, tz = pz < 0 ? pz + 1.0f : pz;
    float own = g.sky[g.id(gi, r)];
    auto  S = [&](int a, int c) { return g.known(a, c) ? g.sky[g.id(a, c)] : own; };
    return bil(S(i0, r0), S(i0 + 1, r0), S(i0, r0 + 1), S(i0 + 1, r0 + 1), tx, tz);
}

// sky visibility of a wall face (normal = south) at height Y: only the south-facing half of the horizon counts
float skyAtHeight(HField const& g, int gi, int r, float Y) {
    static constexpr float dirs[5][2] = {{1, 0}, {0.7071f, 0.7071f}, {0, 1}, {-0.7071f, 0.7071f}, {-1, 0}};
    static constexpr float dists[4]   = {1, 3, 6, 12};
    int blocked = 0;
    for (auto const& d : dirs)
        for (float dist : dists) {
            int hn = g.hAt(gi + int(std::lround(d[0] * dist / float(g.step))), r + int(std::lround(d[1] * dist / float(g.step))));
            if (hn != INT_MIN && float(hn) + 1.0f > Y + dist * 0.7f + 0.2f) { ++blocked; break; }
        }
    return 1.0f - 0.9f * float(blocked) / 5.0f;
}

struct VRun { int yt, yb, k0; float topFrac; };
constexpr int kMaxRuns = 48;
// Builds runs of solid blocks (top-down) from a column profile: entry alpha 0 = air gap, 0xE1 = slab, 0xE2 = stair, else full block.
int buildRuns(WRef wp, int h, VRun* out) {
    if (!wp) { out[0] = {h, h - 2, 0, 1.0f}; return 1; }
    int n = 0, k = 0;
    while (k < NW && n < kMaxRuns) {
        if (!(wp[k] >> 24)) { ++k; continue; }
        int k0 = k;
        while (k + 1 < NW && (wp[k + 1] >> 24)) ++k;
        int   lastDepth = (k + 1 < NW) ? kWallDepth[k + 1] - 1 : 95;
        uint32_t a = wp[k0] >> 24;
        out[n++] = {h - kWallDepth[k0], h - lastDepth, k0, a == 0xE1 ? 0.5f : (a == 0xE2 ? 0.75f : 1.0f)};
        ++k;
    }
    if (!n) { out[0] = {h, h - 2, 0, 1.0f}; n = 1; }
    return n;
}
uint32_t wallColorAt(WRef wp, int h, float Y, uint32_t fallback) {
    if (!wp) return fallback;
    int by = int(std::floor(Y - 1e-4f)), d = std::max(0, h - by), kk = 0;
    while (kk + 1 < NW && kWallDepth[kk + 1] <= d) ++kk;
    for (int q = kk; q >= 0; --q) if (wp[q] >> 24) return wp[q] | 0xFF000000u;
    return fallback;
}

struct Rec { int32_t cell; float a, b, y; uint32_t col; uint8_t type; }; // type 1 top (a=fx,b=fz), 2 south wall (a=fx,b=depth below the top surface)

// px: 0xAARRGGBB (A=0 unknown); hb: surface height per pixel (for hole filling)
void paintHeightfield(Baked const& b, int W, std::vector<uint32_t>& px, std::vector<int16_t>& hb, uint64_t epoch) {
    SrgbTables const& T = srgb();
    HField g;
    buildHField(g, b);
    size_t NP = size_t(W) * size_t(W);
    float  sc = float(W) / float(b.n);
    std::vector<Rec>     rec(NP);
    std::vector<float>   accR(NP, 0), accG(NP, 0), accB(NP, 0), dsum(NP, 0);
    std::vector<uint8_t> cnt(NP, 0);
    std::vector<int16_t> hsum(NP, 0);
    float KYv = KY, HSs = HS / float(b.step);
    float halfN = float(b.n) * 0.5f;
    for (int s = 0; s < 4; ++s) {
        if (epoch && gEpoch.load() != epoch) return;
        for (auto& r : rec) r.cell = -1;
        float sx = kSmp[s][0], sy = kSmp[s][1];
        // ---- paint: far to near; inside a column the runs of solid blocks go bottom to top (overhangs, gaps, shapes) ----
        for (int x = 0; x < W; ++x) {
            float u  = (float(x) + sx) / sc;
            int   i  = int(std::floor(u));
            if (i < 0 || i >= b.n) continue;
            float fx = u - float(i);
            int   gi = i + g.mx;
            for (int r = 0; r < g.m; ++r) {
                size_t k = g.id(gi, r);
                if (!g.col[k]) continue;
                int   j  = r - g.rowsHalf;
                int   hh = g.h[k];
                WRef wp = g.wp[k];
                VRun runs[kMaxRuns]; int nr = buildRuns(wp, hh, runs);
                int hn = g.known(gi, r + 1) ? int(g.h[g.id(gi, r + 1)]) : hh - 2;
                for (int q = nr - 1; q >= 0; --q) { // runs are listed top-down; paint bottom-up
                    VRun const& R0 = runs[q];
                    float Ytop = float(R0.yt) + R0.topFrac;
                    float vTop0 = halfN + float(j) * KYv - (Ytop - float(g.h0)) * HSs, vTop1 = vTop0 + KYv;
                    uint32_t topCol = (R0.k0 == 0) ? g.col[k] : ((wp ? wp[R0.k0] : g.col[k]) | 0xFF000000u);
                    int ya = std::max(0, int(std::ceil(vTop0 * sc - sy))), yb = std::min(W, int(std::ceil(vTop1 * sc - sy)));
                    for (int y = ya; y < yb; ++y) {
                        float vS = (float(y) + sy) / sc;
                        Rec& R = rec[size_t(y) * W + x];
                        R.cell = int32_t(k); R.type = 1; R.a = fx; R.b = std::clamp((vS - vTop0) / KYv, 0.0f, 0.9999f); R.y = Ytop; R.col = topCol;
                    }
                    float lowY = std::max(float(R0.yb), float(hn + 1));
                    float wallH = std::min(Ytop - lowY, 96.0f);
                    if (wallH <= 0.0f) continue;
                    float vW1 = vTop1 + wallH * HSs;
                    int   wa = std::max(0, int(std::ceil(vTop1 * sc - sy))), wb = std::min(W, int(std::ceil(vW1 * sc - sy)));
                    for (int y = wa; y < wb; ++y) {
                        float vS = (float(y) + sy) / sc;
                        float Yh = Ytop - std::max(0.0f, (vS - vTop1) / HSs);
                        Rec& R = rec[size_t(y) * W + x];
                        R.cell = int32_t(k); R.type = 2; R.a = fx; R.b = 0.0f; R.y = Yh;
                        R.col = wallColorAt(wp, hh, Yh, g.col[k]);
                    }
                }
            }
        }
        // ---- shade each visible sample once ----
        float sunx = kSunX + kJit[s][0], suny = kSunY + kJit[s][1], sunz = kSunZ + kJit[s][2];
        float lambertSide = std::max(0.0f, sunz) / suny;
        for (size_t p = 0; p < NP; ++p) {
            Rec const& R = rec[p];
            if (R.cell < 0) continue;
            size_t k  = size_t(R.cell);
            int    gi = int(k % size_t(g.gn)), r = int(k / size_t(g.gn));
            int    hh = g.h[k], j = r - g.rowsHalf;
            bool   top = R.type == 1;
            float  fx = R.a;
            float  Y, Zc, ao, sky, lambert;
            uint32_t albedo;
            float  X = float(g.x0) + (float(gi - g.mx) + fx) * float(g.step);
            if (top) {
                float fz = R.b;
                Y  = R.y;
                Zc = float(g.cz) + (float(j) + fz) * float(g.step);
                albedo = R.col;
                int y1 = int(std::ceil(Y - 1e-3f));
                bool nn = g.occ(gi, r - 1, y1), ss = g.occ(gi, r + 1, y1), ww = g.occ(gi - 1, r, y1), ee = g.occ(gi + 1, r, y1);
                float nw = aoCorner(ww, nn, g.occ(gi - 1, r - 1, y1)), ne = aoCorner(ee, nn, g.occ(gi + 1, r - 1, y1));
                float sw = aoCorner(ww, ss, g.occ(gi - 1, r + 1, y1)), se = aoCorner(ee, ss, g.occ(gi + 1, r + 1, y1));
                ao = bil(nw, ne, sw, se, fx, fz);
                sky = skyBilinear(g, gi, r, fx, fz);
                lambert = 1.0f;
            } else {
                Y  = R.y;
                Zc = float(g.cz) + float(j + 1) * float(g.step);
                albedo = R.col;
                int by = int(std::floor(Y - 1e-4f)); float fy = Y - float(by);
                int rf = r + 1;
                bool up = g.occ(gi, rf, by + 1), dn = g.occ(gi, rf, by - 1), ww = g.occ(gi - 1, rf, by), ee = g.occ(gi + 1, rf, by);
                float tw = aoCorner(ww, up, g.occ(gi - 1, rf, by + 1)), te = aoCorner(ee, up, g.occ(gi + 1, rf, by + 1));
                float bw = aoCorner(ww, dn, g.occ(gi - 1, rf, by - 1)), be = aoCorner(ee, dn, g.occ(gi + 1, rf, by - 1));
                ao = bil(tw, te, bw, be, fx, 1.0f - fy);
                sky = skyAtHeight(g, gi, rf, Y);
                lambert = lambertSide;
            }
            bool shadowed = lambert > 0.0f && inShadow(g, X, Y + 1e-4f, Zc + (top ? 0.0f : 1e-4f), sunx, suny, sunz);
            float aoSun = std::max(0.0f, 1.0f - kCornerOcc * (1.0f - ao)), aoSky = std::min(ao, aoSun);
            float direct = (lambert > 0.0f && !shadowed) ? kSunStr * lambert * aoSun : 0.0f;
            float ambient = kAmbient * aoSky * (1.0f - kSkyOcc * (1.0f - (0.15f + 0.85f * sky)));
            float lr = ambient * kShadowTint[0] + direct * kSunTint[0];
            float lg = ambient * kShadowTint[1] + direct * kSunTint[1];
            float lb = ambient * kShadowTint[2] + direct * kSunTint[2];
            float hs = 1.0f + kHeightShade * std::clamp((Y - 64.0f) / 64.0f, -1.0f, 1.0f);
            float face = top ? 1.0f : kSideK;
            float cr = T.lin[(albedo >> 16) & 255] * lr * hs * face, cg = T.lin[(albedo >> 8) & 255] * lg * hs * face, cb = T.lin[albedo & 255] * lb * hs * face;
            accR[p] += cr; accG[p] += cg; accB[p] += cb;
            dsum[p] += -(Y * kSinP + Zc * kCosP);
            hsum[p] = int16_t(std::floor(Y));
            ++cnt[p];
        }
    }
    // ---- resolve samples, grade ----
    px.assign(NP, 0u);
    hb.assign(NP, INT16_MIN);
    std::vector<float> depth(NP, std::nanf(""));
    for (size_t p = 0; p < NP; ++p) {
        int c = cnt[p];
        if (!c) continue;
        float r = accR[p] / float(c), gg = accG[p] / float(c), bb = accB[p] / float(c);
        float l = 0.2126f * r + 0.7152f * gg + 0.0722f * bb;
        r  = (l + (r - l) * kSat) * kExposure; gg = (l + (gg - l) * kSat) * kExposure; bb = (l + (bb - l) * kSat) * kExposure;
        auto q = [&](float v) { return uint32_t(T.out[std::clamp(int(v * 4095.0f), 0, 4095)]); };
        px[p] = 0xFF000000u | (q(r) << 16) | (q(gg) << 8) | q(bb);
        hb[p] = hsum[p];
        depth[p] = dsum[p] / float(c);
    }
    // ---- outlines: a pixel next to a clearly nearer surface is darkened (TileBaker.bakePixels) ----
    std::vector<uint32_t> src = px;
    for (int y = 0; y < W; ++y)
        for (int x = 0; x < W; ++x) {
            size_t i = size_t(y) * W + x;
            if (!(src[i] >> 24)) continue;
            float here = depth[i];
            auto  nearer = [&](size_t jx) { float d = depth[jx]; return !std::isnan(d) && here - d > kOutlineDepth; };
            if ((x > 0 && nearer(i - 1)) || (x < W - 1 && nearer(i + 1)) || (y > 0 && nearer(i - W)) || (y < W - 1 && nearer(i + W))) {
                float f = 1.0f - kOutline;
                auto  m2 = [&](int sh) { return uint32_t(float((src[i] >> sh) & 255) * f + 0.5f); };
                px[i] = 0xFF000000u | (m2(16) << 16) | (m2(8) << 8) | m2(0);
            }
        }
}

// px layout: 0xAARRGGBB (A=0 unknown). Returns pixels (W x W).
void rasterize(Baked const& b, int W, std::vector<uint32_t>& px, bool soft, uint64_t epoch = 0, bool painter = false) {
    std::vector<int16_t> hb;
    float sc = float(W) / float(b.n);
    if (painter) {
        paintHeightfield(b, W, px, hb, epoch);
        if (px.size() != size_t(W) * size_t(W)) return;
    } else {
        px.assign(size_t(W) * W, 0u);
        hb.assign(size_t(W) * W, INT16_MIN);
    }
    for (auto const& r : b.rects) {
        int x0 = std::max(0, int(std::floor(r.x0 * sc))), x1 = std::min(W, int(std::ceil(r.x1 * sc)));
        int y0 = std::max(0, int(std::floor(r.y0 * sc))), y1 = std::min(W, int(std::ceil(r.y1 * sc)));
        for (int y = y0; y < y1; ++y)
            for (int x = x0; x < x1; ++x) {
                px[size_t(y) * W + x] = r.col | 0xFF000000u;
                hb[size_t(y) * W + x] = r.h;
            }
    }
    // fill small enclosed unknown areas (chunks not loaded yet inside explored terrain) from their surroundings
    {
        std::vector<int8_t> lab(size_t(W) * W, 0);
        size_t              maxArea = size_t(std::pow(24.0f * sc, 2.0f));
        std::vector<size_t> stack, comp;
        for (size_t st = 0; st < px.size(); ++st) {
            if ((px[st] >> 24) || lab[st]) continue;
            comp.clear(); stack.assign(1, st); lab[st] = 1;
            bool border = false;
            while (!stack.empty()) {
                size_t i = stack.back(); stack.pop_back(); comp.push_back(i);
                int x = int(i % size_t(W)), y = int(i / size_t(W));
                if (x == 0 || y == 0 || x == W - 1 || y == W - 1) border = true;
                size_t nbs[4]; int cnt = 0;
                if (x > 0) nbs[cnt++] = i - 1;
                if (x < W - 1) nbs[cnt++] = i + 1;
                if (y > 0) nbs[cnt++] = i - W;
                if (y < W - 1) nbs[cnt++] = i + W;
                for (int k = 0; k < cnt; ++k) if (!(px[nbs[k]] >> 24) && !lab[nbs[k]]) { lab[nbs[k]] = 1; stack.push_back(nbs[k]); }
            }
            if (border || comp.size() > maxArea) continue;
            std::vector<size_t> todo = comp;
            std::vector<std::pair<size_t, std::pair<uint32_t, int16_t>>> pend;
            while (!todo.empty()) {
                pend.clear();
                std::vector<size_t> rest;
                for (size_t i : todo) {
                    int x = int(i % size_t(W)), y = int(i / size_t(W));
                    uint32_t r = 0, g = 0, bl = 0; int hs = 0, c = 0;
                    auto add = [&](size_t j) { if (px[j] >> 24) { r += (px[j] >> 16) & 255; g += (px[j] >> 8) & 255; bl += px[j] & 255; hs += hb[j]; ++c; } };
                    if (x > 0) add(i - 1);
                    if (x < W - 1) add(i + 1);
                    if (y > 0) add(i - W);
                    if (y < W - 1) add(i + W);
                    if (c) pend.push_back({i, {0xFF000000u | ((r / c) << 16) | ((g / c) << 8) | (bl / c), int16_t(hs / c)}});
                    else rest.push_back(i);
                }
                if (pend.empty()) break;
                for (auto& p : pend) { px[p.first] = p.second.first; hb[p.first] = p.second.second; }
                todo.swap(rest);
            }
        }
    }
    // soft rounded blocks: convex corners of colour regions are blended with their neighbours, region edges get a light blend
    if (!painter) {
        std::vector<uint32_t> src = px;
        auto mix = [](uint32_t a, uint32_t c, float t) {
            auto ch = [&](int sh) { return uint32_t(float((a >> sh) & 255) * (1 - t) + float((c >> sh) & 255) * t + 0.5f); };
            return 0xFF000000u | (ch(16) << 16) | (ch(8) << 8) | ch(0);
        };
        for (int y = 1; y < W - 1; ++y)
            for (int x = 1; x < W - 1; ++x) {
                size_t i = size_t(y) * W + x;
                uint32_t p = src[i];
                if (!(p >> 24)) continue;
                uint32_t nb4[4] = {src[i - 1], src[i + 1], src[i - W], src[i + W]};
                bool dif[4];
                for (int k = 0; k < 4; ++k) dif[k] = (nb4[k] >> 24) && ((nb4[k] ^ p) & 0xFFFFFFu);
                bool corner = (dif[0] && dif[2]) || (dif[0] && dif[3]) || (dif[1] && dif[2]) || (dif[1] && dif[3]);
                uint32_t out = p;
                int cnt = 0; uint32_t r = 0, g = 0, bl = 0;
                for (int k = 0; k < 4; ++k) if (dif[k]) { r += (nb4[k] >> 16) & 255; g += (nb4[k] >> 8) & 255; bl += nb4[k] & 255; ++cnt; }
                if (cnt) {
                    uint32_t avg = 0xFF000000u | ((r / cnt) << 16) | ((g / cnt) << 8) | (bl / cnt);
                    out = mix(p, avg, corner ? 0.55f : 0.20f);
                }
                px[i] = out;
            }
    }
    // depth outlines: neighbouring surfaces at clearly different height get a dark line (Diorama draws outlines by depth)
    if (!painter) for (int y = 1; y < W; ++y)
        for (int x = 1; x < W; ++x) {
            size_t i = size_t(y) * W + x;
            if (!(px[i] >> 24)) continue;
            int  h = hb[i], hu = hb[i - W], hl = hb[i - 1];
            bool edge = (hu != INT16_MIN && std::abs(h - hu) >= 2 && h < hu) || (hl != INT16_MIN && std::abs(h - hl) >= 2 && h < hl);
            if (edge) px[i] = shade(px[i], 0.72f);
        }
    // ---- volumetric cartoon fog ----
    // chamfer distance from explored pixels to the unknown area; the edge is eroded by world-anchored noise, shaded as puffy clouds
    {
        size_t N = size_t(W) * W;
        bool   any = false;
        for (size_t i = 0; i < N; ++i) if (!(px[i] >> 24)) { any = true; break; }
        if (any) {
            std::vector<float> dIn(N); // for known px: distance to nearest unknown px
            {
                const float INF = 1e9f, D1 = 1.0f, D2 = 1.4142f;
                for (size_t i = 0; i < N; ++i) dIn[i] = (px[i] >> 24) ? INF : 0.0f;
                for (int y = 0; y < W; ++y)
                    for (int x = 0; x < W; ++x) {
                        size_t i = size_t(y) * W + x; float v = dIn[i];
                        if (x > 0) v = std::min(v, dIn[i - 1] + D1);
                        if (y > 0) { v = std::min(v, dIn[i - W] + D1); if (x > 0) v = std::min(v, dIn[i - W - 1] + D2); if (x < W - 1) v = std::min(v, dIn[i - W + 1] + D2); }
                        dIn[i] = v;
                    }
                for (int y = W - 1; y >= 0; --y)
                    for (int x = W - 1; x >= 0; --x) {
                        size_t i = size_t(y) * W + x; float v = dIn[i];
                        if (x < W - 1) v = std::min(v, dIn[i + 1] + D1);
                        if (y < W - 1) { v = std::min(v, dIn[i + W] + D1); if (x < W - 1) v = std::min(v, dIn[i + W + 1] + D2); if (x > 0) v = std::min(v, dIn[i + W - 1] + D2); }
                        dIn[i] = v;
                    }
            }
            auto hash = [](int x, int y) { uint32_t h = uint32_t(x) * 374761393u + uint32_t(y) * 668265263u; h = (h ^ (h >> 13)) * 1274126177u; return float((h ^ (h >> 16)) & 0xFFFF) / 65535.0f; };
            auto vnoise = [&](float fx, float fy) {
                int ix = int(std::floor(fx)), iy = int(std::floor(fy)); float tx = fx - float(ix), ty = fy - float(iy);
                tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
                float a0 = hash(ix, iy), b2 = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
                return (a0 + (b2 - a0) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
            };
            int   wx0 = b.cx - (b.n / 2) * b.step, wz0 = b.cz - (b.n / 2) * b.step;
            float ws  = float(b.step) / float(PPC);
            std::vector<float> H(N);
            for (int y = 0; y < W; ++y)
                for (int x = 0; x < W; ++x) {
                    float wxp = float(wx0) + float(x) * ws, wzp = float(wz0) + float(y) * ws / KY;
                    H[size_t(y) * W + x] = 0.55f * vnoise(wxp * 0.035f, wzp * 0.035f) + 0.30f * vnoise(wxp * 0.09f, wzp * 0.09f) + 0.15f * vnoise(wxp * 0.21f, wzp * 0.21f);
                }
            float fadeW = 16.0f * sc, amp = 8.0f * sc; // pixels
            for (int y = 0; y < W; ++y)
                for (int x = 0; x < W; ++x) {
                    size_t i     = size_t(y) * W + x;
                    bool   known = (px[i] >> 24) != 0;
                    float  f     = 1.0f; // fog coverage
                    if (known) {
                        float t = (dIn[i] + (H[i] - 0.5f) * 2.0f * amp) / fadeW;
                        t       = std::clamp(t, 0.0f, 1.0f);
                        f       = 1.0f - t * t * (3.0f - 2.0f * t);
                        if (f <= 0.003f) continue;
                    }
                    // puffy 3D shading: light from north-west on the noise height field
                    float hx  = H[i + (x < W - 1 ? 1 : 0)] - H[i - (x > 0 ? 1 : 0)];
                    float hy  = H[i + (y < W - 1 ? size_t(W) : 0)] - H[i - (y > 0 ? size_t(W) : 0)];
                    float lit = std::clamp(1.0f - (hx + hy) * 9.0f, 0.80f, 1.10f);
                    float k   = (0.91f + 0.12f * H[i]) * lit;
                    float fr = float((FOG >> 16) & 255) * k, fg = float((FOG >> 8) & 255) * k, fb = float(FOG & 255) * std::min(1.0f, k + 0.04f);
                    float tr = known ? float((px[i] >> 16) & 255) : fr, tg = known ? float((px[i] >> 8) & 255) : fg, tb = known ? float(px[i] & 255) : fb;
                    auto  mixc = [&](float a1, float b1) { return uint32_t(std::clamp(a1 + (b1 - a1) * f, 0.0f, 255.0f)); };
                    px[i] = 0xFF000000u | (mixc(tr, fr) << 16) | (mixc(tg, fg) << 8) | mixc(tb, fb);
                }
        }
        for (auto& p : px) p |= 0xFF000000u;
    }
    (void)soft;
}

bool fillImage(::mce::Image& img, std::vector<uint32_t> const& px, int W) {
    if (img.mImageBytes.size() < size_t(W) * W * 4) img.resizeImageBytesToFitImageDescription();
    if (img.mImageBytes.size() < size_t(W) * W * 4) return false;
    uint8_t* d = img.mImageBytes.data();
    for (size_t i = 0; i < px.size(); ++i) {
        uint32_t p = px[i];
        d[i * 4 + 0] = uint8_t((p >> 16) & 255);
        d[i * 4 + 1] = uint8_t((p >> 8) & 255);
        d[i * 4 + 2] = uint8_t(p & 255);
        d[i * 4 + 3] = uint8_t(p >> 24);
    }
    return true;
}

uint64_t gPerfUploads = 0, gPerfInPlaceFail = 0;
double   gPerfMaxUploadMs = 0;
uint64_t gTexSerial = 0;

bool uploadImage(::IClientInstance& client, Tex& t, std::vector<uint32_t> const& px, int W) {
    auto tg = client.getTextureGroup();
    if (!tg) return false;
    LARGE_INTEGER f, c0, c1;
    QueryPerformanceFrequency(&f);
    QueryPerformanceCounter(&c0);
    int  h  = 1 - t.cur; // hidden buffer
    bool ok = false;
    if (t.created[h] && t.W[h] == W) {
        ::mce::Image img(uint32_t(W), uint32_t(W), ::mce::ImageFormat::RGBA8Unorm, ::mce::ImageUsage::SRGB);
        if (!fillImage(img, px, W)) return false;
        ::cg::ImageBuffer buf(std::move(img));
        ::ResourceLocation loc(::Core::PathView(t.name[h]), ::ResourceFileSystem::UserPackage);
        ok = tg->updateTextureInPlace(loc, std::move(buf));
        if (!ok) ++gPerfInPlaceFail;
    }
    if (!ok) {
        // new unique name (re-uploading an existing name is not safe)
        ++t.gen;
        t.name[h] = "textures/diorama_bedrock/" + std::string(&t == &gMiniTex ? "mini" : "big") + "_" + std::to_string(W) + "_" + std::to_string(t.gen) + "_" + std::to_string(++gTexSerial);
        ::mce::Image img(uint32_t(W), uint32_t(W), ::mce::ImageFormat::RGBA8Unorm, ::mce::ImageUsage::SRGB);
        if (!fillImage(img, px, W)) return false;
        ::cg::ImageBuffer buf(std::move(img));
        ::ResourceLocation loc(::Core::PathView(t.name[h]), ::ResourceFileSystem::UserPackage);
        tg->uploadTexture(loc, std::move(buf));
        t.created[h] = true;
        t.W[h]       = W;
    }
    QueryPerformanceCounter(&c1);
    double ms = double(c1.QuadPart - c0.QuadPart) * 1000.0 / double(f.QuadPart);
    ++gPerfUploads;
    if (ms > gPerfMaxUploadMs) gPerfMaxUploadMs = ms;
    return true;
}

// Draws the texture that was last uploaded (the displayed bake); baking itself happens on the worker thread.
bool drawTexAsync(::MinecraftUIRenderContext& ctx, Tex const& t, float x, float y, float size, float u0, float v0, float uw, float vh) {
    if (!gCfgRead) readConfig();
    if (!gTexEnabled || gTexFailed || !t.created[t.cur]) return false;
    ::ResourceLocation loc(::Core::PathView(t.name[t.cur]), ::ResourceFileSystem::UserPackage);
    ::mce::TexturePtr  tp  = ctx.getTexture(loc, false);
    auto const*        dat = tp.mClientTexture.get();
    if (!dat) { gTexFailed = true; return false; }
    ctx.drawImage(dat->mClientTexture.get(), ::glm::vec2{x, y}, ::glm::vec2{size, size}, ::glm::vec2{u0, v0}, ::glm::vec2{uw, vh}, false);
    ctx.flushImages(::mce::Color{1.0f, 1.0f, 1.0f, 1.0f}, 1.0f, ::HashedString(gMaterial));
    if (!gTexLogged) gTexLogged = true;
    return true;
}

// Dark frame with light bevel, drop shadow, corner studs (Diorama-like).
void frame(::MinecraftUIRenderContext& ctx, float x, float y, float size) {
    ::mce::Color dark{0.04f, 0.04f, 0.05f, 1.0f};
    ::mce::Color edge{0.78f, 0.80f, 0.86f, 1.0f};
    ::mce::Color mid{0.30f, 0.31f, 0.36f, 1.0f};
    rect(ctx, x - 2, y - 2, x + size + 8, y + size + 8, ::mce::Color{0, 0, 0, 1}, 0.30f);
    rect(ctx, x - 6, y - 6, x + size + 6, y + size + 6, dark);
    rect(ctx, x - 5, y - 5, x + size + 5, y + size + 5, mid);
    rect(ctx, x - 4, y - 4, x + size + 4, y + size + 4, dark);
    rect(ctx, x - 6, y - 6, x + size + 6, y - 5, edge, 0.9f);
    rect(ctx, x - 6, y + size + 5, x + size + 6, y + size + 6, edge, 0.9f);
    rect(ctx, x - 6, y - 6, x - 5, y + size + 6, edge, 0.9f);
    rect(ctx, x + size + 5, y - 6, x + size + 6, y + size + 6, edge, 0.9f);
    // unexplored background: deep blue-grey like Diorama's fog
    rect(ctx, x, y, x + size, y + size, toColor(FOG));
    for (float cxp : {x - 6, x + size + 3})
        for (float cyp : {y - 6, y + size + 3}) rect(ctx, cxp, cyp, cxp + 3, cyp + 3, edge);
}

void vignette(::MinecraftUIRenderContext& ctx, float x, float y, float size) {
    ::mce::Color k{0, 0, 0, 1};
    for (int i = 0; i < 3; ++i) {
        float a = 0.32f - 0.10f * float(i);
        float o = float(i) * 2.0f;
        rect(ctx, x + o, y + o, x + size - o, y + o + 2, k, a);
        rect(ctx, x + o, y + size - o - 2, x + size - o, y + size - o, k, a);
        rect(ctx, x + o, y + o + 2, x + o + 2, y + size - o - 2, k, a);
        rect(ctx, x + size - o - 2, y + o + 2, x + size - o, y + size - o - 2, k, a);
    }
}

struct V2 { float x, y; };

// filled triangle drawn as thin horizontal strips
void fillTri(::MinecraftUIRenderContext& ctx, V2 p0, V2 p1, V2 p2, ::mce::Color const& col) {
    V2 p[3] = {p0, p1, p2};
    float ymin = std::min({p0.y, p1.y, p2.y}), ymax = std::max({p0.y, p1.y, p2.y});
    constexpr float H = 0.5f;
    for (float y = std::floor(ymin / H) * H; y < ymax; y += H) {
        float yc = y + H * 0.5f, xl = 1e9f, xr = -1e9f;
        for (int i = 0; i < 3; ++i) {
            V2 a = p[i], b = p[(i + 1) % 3];
            if ((a.y <= yc && b.y > yc) || (b.y <= yc && a.y > yc)) {
                float x = a.x + (yc - a.y) / (b.y - a.y) * (b.x - a.x);
                xl = std::min(xl, x); xr = std::max(xr, x);
            }
        }
        if (xr > xl) rect(ctx, xl, y, xr, y + H, col, 1.0f);
    }
}

// arrow-head player marker pointing where the player looks (like Diorama): white with dark outline
void marker(::MinecraftUIRenderContext& ctx, float cx, float cy, float s, float yawDeg) {
    float rad = yawDeg * 3.14159265f / 180.0f;
    V2    f{-std::sin(rad), std::cos(rad)}; // forward on the map (x, z)
    V2    q{-f.y, f.x};
    float r = s * 3.4f;
    auto  poly = [&](float k, V2 out[4]) {
        out[0] = {cx + f.x * r * 1.15f * k, cy + f.y * r * 1.15f * k};                                   // tip
        out[1] = {cx - f.x * r * 0.75f * k + q.x * r * 0.80f * k, cy - f.y * r * 0.75f * k + q.y * r * 0.80f * k}; // right
        out[2] = {cx - f.x * r * 0.25f * k, cy - f.y * r * 0.25f * k};                                    // notch
        out[3] = {cx - f.x * r * 0.75f * k - q.x * r * 0.80f * k, cy - f.y * r * 0.75f * k - q.y * r * 0.80f * k}; // left
    };
    V2 o[4], i[4];
    poly(1.35f, o);
    poly(1.0f, i);
    ::mce::Color dark{0.05f, 0.06f, 0.08f, 1.0f}, white{1.0f, 1.0f, 1.0f, 1.0f};
    fillTri(ctx, o[0], o[1], o[2], dark); fillTri(ctx, o[0], o[2], o[3], dark);
    fillTri(ctx, i[0], i[1], i[2], white); fillTri(ctx, i[0], i[2], i[3], white);
}

// ---- round minimap: texture drawn as 1px strips clipped to a circle ----
bool drawTexRound(::MinecraftUIRenderContext& ctx, Tex const& t, float x, float y, float size, float u0, float v0, float uw, float vh) {
    if (!gCfgRead) readConfig();
    if (!gTexEnabled || gTexFailed || !t.created[t.cur]) return false;
    ::ResourceLocation loc(::Core::PathView(t.name[t.cur]), ::ResourceFileSystem::UserPackage);
    ::mce::TexturePtr  tp  = ctx.getTexture(loc, false);
    auto const*        dat = tp.mClientTexture.get();
    if (!dat) { gTexFailed = true; return false; }
    float r = size * 0.5f, cy = y + r, cx = x + r;
    for (float ys = y; ys < y + size; ys += 2.0f) {
        float dy = ys + 1.0f - cy;
        float w  = std::sqrt(std::max(0.0f, r * r - dy * dy));
        if (w < 1.0f) continue;
        float xs = cx - w, wd = 2.0f * w;
        ctx.drawImage(dat->mClientTexture.get(), ::glm::vec2{xs, ys}, ::glm::vec2{wd, 2.0f},
                      ::glm::vec2{u0 + (xs - x) / size * uw, v0 + (ys - y) / size * vh}, ::glm::vec2{wd / size * uw, 2.0f / size * vh}, false);
        ctx.flushImages(::mce::Color{1.0f, 1.0f, 1.0f, 1.0f}, 1.0f, ::HashedString(gMaterial));
    }
    return true;
}

void frameRound(::MinecraftUIRenderContext& ctx, float x, float y, float size) {
    ::mce::Color dark{0.04f, 0.04f, 0.05f, 1.0f}, edge{0.78f, 0.80f, 0.86f, 1.0f}, mid{0.30f, 0.31f, 0.36f, 1.0f};
    float r = size * 0.5f, cx = x + r, cy = y + r;
    auto  chord = [&](float rad, float yc) { float d = yc - cy; return std::sqrt(std::max(0.0f, rad * rad - d * d)); };
    for (float ys = y - 7.0f; ys < y + size + 7.0f; ys += 1.0f) {
        float yc = ys + 0.5f;
        float w1 = chord(r + 6.0f, yc), w2 = chord(r + 5.0f, yc), w3 = chord(r + 4.0f, yc), wi = chord(r, yc);
        if (w1 > 0) rect(ctx, cx - w1, ys, cx + w1, ys + 1.0f, edge, 0.9f);
        if (w2 > 0) rect(ctx, cx - w2, ys, cx + w2, ys + 1.0f, dark);
        if (w3 > 0) rect(ctx, cx - w3, ys, cx + w3, ys + 1.0f, mid);
        if (wi > 0) rect(ctx, cx - wi, ys, cx + wi, ys + 1.0f, toColor(FOG));
    }
}

// --- input (polled, edge detected; only while our window is focused) ---
bool gBigMap    = false;
bool gRound     = false; // F7: square <-> round minimap (rotating modes: TODO)
bool gF7WasDown = false;
bool gMWasDown  = false;
float gZoom = 256.0f; // blocks visible across the big map (continuous: wheel zoom)
std::atomic<int> gWheel{0};
HWND    gHwnd     = nullptr;
WNDPROC gOldProc  = nullptr;
bool    gHwndUni  = true;
bool    gDragging = false, gMouseReleased = false, gInputLocked = false;
float   gLastMX = 0, gLastMY = 0;
int  gBigBias   = 0;      // extra sampling step when the rectangle budget is exceeded
int  gBigLastQ = 0;
constexpr size_t kBigBudget = 60000;
float gPanX = 0.0f;
float gPanZ = 0.0f;

bool windowFocused() {
    HWND fg = GetForegroundWindow();
    if (!fg) return false;
    DWORD pid = 0;
    GetWindowThreadProcessId(fg, &pid);
    return pid == GetCurrentProcessId();
}

LRESULT CALLBACK wheelProc(HWND h, UINT m, WPARAM w, LPARAM l) {
    if (m == WM_MOUSEWHEEL && gBigMap) { // swallow: the hotbar must not scroll while the map is open
        gWheel += int(GET_WHEEL_DELTA_WPARAM(w));
        return 0;
    }
    return gHwndUni ? CallWindowProcW(gOldProc, h, m, w, l) : CallWindowProcA(gOldProc, h, m, w, l);
}

void installWheelHook() {
    if (gHwnd) return;
    HWND fg = GetForegroundWindow();
    if (!fg) return;
    gHwndUni = IsWindowUnicode(fg) != 0;
    LONG_PTR old = gHwndUni ? SetWindowLongPtrW(fg, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(&wheelProc))
                            : SetWindowLongPtrA(fg, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(&wheelProc));
    if (!old) return;
    gOldProc = reinterpret_cast<WNDPROC>(old);
    gHwnd    = fg;
}

void removeWheelHook() {
    if (!gHwnd || !gOldProc) return;
    LONG_PTR cur = gHwndUni ? GetWindowLongPtrW(gHwnd, GWLP_WNDPROC) : GetWindowLongPtrA(gHwnd, GWLP_WNDPROC);
    if (cur == reinterpret_cast<LONG_PTR>(&wheelProc)) {
        if (gHwndUni) SetWindowLongPtrW(gHwnd, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(gOldProc));
        else SetWindowLongPtrA(gHwnd, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(gOldProc));
    }
    gHwnd = nullptr; gOldProc = nullptr;
}

bool down(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }

void pollInput() {
    if (!windowFocused()) { gMWasDown = false; gF7WasDown = false; return; }
    installWheelHook();
    bool f7 = down(VK_F7);
    if (f7 && !gF7WasDown) gRound = !gRound;
    gF7WasDown = f7;
    bool m = down('M');
    if (m && !gMWasDown) { gBigMap = !gBigMap; gPanX = gPanZ = 0.0f; gDragging = false; gWheel = 0; }
    gMWasDown = m;
    if (!gBigMap) return;
    if (down(VK_OEM_PLUS) || down(VK_ADD)) gZoom = std::max(40.0f, gZoom * 0.975f);
    if (down(VK_OEM_MINUS) || down(VK_SUBTRACT)) gZoom = std::min(2400.0f, gZoom * 1.025f);
    float step = std::max(1.0f, gZoom / 60.0f) * (down(VK_SHIFT) ? 3.0f : 1.0f);
    if (down(VK_LEFT)) gPanX -= step;
    if (down(VK_RIGHT)) gPanX += step;
    if (down(VK_UP)) gPanZ -= step;
    if (down(VK_DOWN)) gPanZ += step;
    if (down(VK_HOME)) gPanX = gPanZ = 0.0f;
}


// ---------- smooth player position (game position only changes every tick -> jitter) ----------
float    gSX = 0, gSY = 0, gSZ = 0;
bool     gSInit = false;
int64_t  gLastQpc = 0;

float frameDt() {
    LARGE_INTEGER f, c;
    QueryPerformanceFrequency(&f);
    QueryPerformanceCounter(&c);
    float dt = gLastQpc ? float(double(c.QuadPart - gLastQpc) / double(f.QuadPart)) : 0.016f;
    gLastQpc = c.QuadPart;
    return std::clamp(dt, 0.001f, 0.1f);
}

// Game position changes only on ticks (20 Hz). Like the engine's partial-tick interpolation: glide from the
// currently drawn position to the newest tick position over the measured tick interval -> constant speed, no sawtooth.
// Position-with-velocity extrapolation: at each tick we learn the per-tick step; between ticks the target keeps moving
// with that velocity (so it is continuous at the next tick when speed is constant), then a short low-pass removes the
// residual frame-timing noise.
float gCurX = 0, gCurY = 0, gCurZ = 0, gVX = 0, gVZ = 0, gSince = 0;

void smoothPlayer(float x, float y, float z, bool reset, float dt) {
    if (reset || !gSInit || std::fabs(x - gCurX) > 8.0f || std::fabs(z - gCurZ) > 8.0f) {
        gSX = gCurX = x; gSY = gCurY = y; gSZ = gCurZ = z;
        gVX = gVZ = 0; gSince = 0; gSInit = true;
        return;
    }
    if (x != gCurX || y != gCurY || z != gCurZ) {
        gVX = (x - gCurX) / 0.05f;
        gVZ = (z - gCurZ) / 0.05f;
        gCurX = x; gCurY = y; gCurZ = z;
        gSince = 0;
    } else {
        gSince += dt;
    }
    float e  = gSince < 0.1f ? std::min(gSince, 0.05f) : 0.0f;
    float tx = gCurX + (gSince < 0.1f ? gVX * e : 0.0f);
    float tz = gCurZ + (gSince < 0.1f ? gVZ * e : 0.0f);
    float a  = 1.0f - std::exp(-dt / 0.035f);
    gSX += (tx - gSX) * a;
    gSZ += (tz - gSZ) * a;
    gSY += (gCurY - gSY) * a;
}

struct Scroll { float u0, v0, uw, vh, pcx, pcy; int nb, nview, step, cx, cz, h0; bool ready; float vcells; };

// Show exactly viewBlocks blocks of an already baked window: a pure UV crop, the GPU scales it (no re-bake while zooming).
void retarget(Scroll& sc, float viewBlocks) {
    if (!sc.ready) { sc.vcells = float(sc.nview); return; }
    float vc  = std::min(viewBlocks / float(sc.step), float(sc.nb));
    sc.vcells = vc;
    sc.uw = sc.vh = vc / float(sc.nb);
    sc.u0 = std::clamp((sc.pcx - vc * 0.5f) / float(sc.nb), 0.0f, 1.0f - sc.uw);
    sc.v0 = std::clamp((sc.pcy - vc * 0.5f) / float(sc.nb), 0.0f, 1.0f - sc.vh);
}

// Window geometry of an already baked map (b) and the smooth target (tx,tz,smoothH): sub-cell scrolling is a UV crop.
Scroll makeScroll(Baked const& b, float tx, float tz, float smoothH) {
    Scroll sc{};
    sc.vcells = float(b.view);
    sc.ready = b.cx != INT32_MIN && b.n > 0 && b.view > 0;
    if (!sc.ready) { sc.nb = b.n; sc.nview = b.view; sc.step = 1; return sc; }
    sc.nb = b.n; sc.nview = b.view; sc.step = b.step; sc.cx = b.cx; sc.cz = b.cz; sc.h0 = b.h0;
    sc.pcx = float(b.n) * 0.5f + (tx - float(b.cx)) / float(b.step);
    sc.pcy = float(b.n) * 0.5f + (tz - float(b.cz)) / float(b.step) * KY - (smoothH - float(b.h0)) * HS / float(b.step);
    sc.uw  = float(b.view) / float(b.n);
    sc.vh  = sc.uw;
    sc.u0  = std::clamp((sc.pcx - float(b.view) * 0.5f) / float(b.n), 0.0f, 1.0f - sc.uw);
    sc.v0  = std::clamp((sc.pcy - float(b.view) * 0.5f) / float(b.n), 0.0f, 1.0f - sc.vh);
    return sc;
}

// Synchronous variant (only used by the rectangle fallback when textures are unavailable).
Scroll prepareScroll(Baked& b, int nb, int nview, int step, float tx, float tz, float smoothH, uint64_t minInterval, int drift0) {
    float drift = float(drift0) * float(step);
    bool  need  = b.n != nb || b.step != step || b.cx == INT32_MIN || std::fabs(tx - float(b.cx)) > drift || std::fabs(tz - float(b.cz)) > drift ||
                 std::fabs(smoothH - float(b.h0)) > 4.0f * float(step);
    int bcx = b.cx, bcz = b.cz, bh = b.h0;
    if (need) {
        bcx = int(std::floor(tx / float(step))) * step;
        bcz = int(std::floor(tz / float(step))) * step;
        bh  = int(std::lround(smoothH / float(step))) * step;
    }
    ensureBaked(b, bcx, bcz, bh, nb, step, minInterval);
    b.view = nview;
    return makeScroll(b, tx, tz, smoothH);
}

// ---------- background baking: sampling + rasterizing a window is heavy; doing it on the render thread caused a hitch at every re-bake ----------
struct Job { int cx = 0, cz = 0, h0 = 0, n = 0, step = 1, view = 0, W = 0; uint64_t version = 0, frame = 0, epoch = 0; };

struct Slot {
    Baked                 disp;   // parameters of the bake currently shown (no rects)
    Baked                 pendDisp; // parameters of the bake uploaded into the hidden texture
    Job                   job;
    bool                  queued = false, busy = false, done = false;
    Baked                 res;
    std::vector<uint32_t> px;
    uint64_t              resEpoch = 0;
};
Slot                     gSlots[2];       // 0 = minimap, 1 = big map
std::mutex               gAsyncMx;
std::condition_variable  gCv, gIdleCv;
std::thread              gThread;
bool                     gStop = false, gWorkerStarted = false, gWorkerOk = false;
uint64_t                 gBakeCounter = 0;

// returns false if aborted
bool runJob(Job const& j, Baked& res, std::vector<uint32_t>& px) {
    res.cx = j.cx; res.cz = j.cz; res.h0 = j.h0; res.n = j.n; res.step = j.step; res.version = j.version; res.frame = j.frame; ++res.bakeId;
    res.rects.clear();
    res.view = j.view;
    if (j.epoch && gEpoch.load() != j.epoch) return false;
    rasterize(res, j.W, px, true, j.epoch, true);
    if (j.epoch && gEpoch.load() != j.epoch) return false;
    res.rects.clear();
    res.rects.shrink_to_fit();
    return true;
}

void workerMain() {
    SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_BELOW_NORMAL);
    for (;;) {
        int idx = -1;
        Job job;
        {
            std::unique_lock<std::mutex> lk(gAsyncMx);
            gCv.wait(lk, [] { return gStop || gSlots[0].queued || gSlots[1].queued; });
            if (gStop) return;
            idx = gSlots[0].queued ? 0 : 1;
            gSlots[idx].queued = false;
            gSlots[idx].busy   = true;
            job                = gSlots[idx].job;
        }
        Baked                 res;
        std::vector<uint32_t> px;
        bool                  ok = runJob(job, res, px);
        {
            std::lock_guard<std::mutex> lk(gAsyncMx);
            Slot& s = gSlots[idx];
            s.busy  = false;
            if (ok && gEpoch.load() == job.epoch) {
                s.res      = std::move(res);
                s.px       = std::move(px);
                s.resEpoch = job.epoch;
                s.done     = true;
            }
        }
        gIdleCv.notify_all();
    }
}

void startWorker() {
    if (gWorkerStarted) return;
    gWorkerStarted = true;
    gStop          = false;
    gThread        = std::thread(workerMain);
    gWorkerOk      = gThread.joinable();
}

// ---------- seamless world tiles (one global picture; zooming only scales/crops it) ----------
// Level-0 tile: 128 blocks wide x 170 z-rows (= 510 px: KY*PPC = 3 px per row), 512x510 px content, global reference height kHRef.
// Level L tile = 2x2 box-filtered children, same 512x510 px, covers 2^L times more world.
constexpr int   kTW = 512, kTH = 510, kTexH = 512;
constexpr int   kTileX = 128, kTileZ = 170;
constexpr int   kHRef = 64, kLMax = 3, kBakeN = 160, kBakeW = 640;
constexpr float kLiftPx = HS * float(PPC);
static_assert(kTileZ * 3 == kTH, "tile rows must be pixel exact");

int fdiv(int a, int b) { int q = a / b; if ((a % b != 0) && ((a < 0) != (b < 0))) --q; return q; }
int64_t tkey(int l, int i, int j) { return (int64_t(l) << 58) | (int64_t(uint32_t(i) & 0x1FFFFFFFu) << 29) | int64_t(uint32_t(j) & 0x1FFFFFFFu); }

struct TileJob { int i = 0, j = 0; uint64_t epoch = 0; };
struct TileResult { int i = 0, j = 0; uint64_t epoch = 0; std::vector<uint32_t> px; };
std::mutex               gTileMx;
std::condition_variable  gTileCv, gTileIdleCv;
std::vector<TileJob>     gTileQueue;
std::vector<TileResult>  gTileDone;
std::thread              gTileThread;
bool                     gTileStop = false, gTileStarted = false, gTileBusy = false;

bool bakeTilePixels(int ti, int tj, uint64_t epoch, std::vector<uint32_t>& out) {
    Baked b;
    b.cx = ti * kTileX + kTileX / 2; b.cz = tj * kTileZ + kTileZ / 2; b.h0 = kHRef; b.n = kBakeN; b.step = 1; b.view = kBakeN;
    b.version = gVersion; ++b.bakeId;
    std::vector<uint32_t> px;
    rasterize(b, kBakeW, px, true, epoch, true);
    if (epoch && gEpoch.load() != epoch) return false;
    if (px.size() < size_t(kBakeW) * size_t(kBakeW)) return false;
    int ox = (kBakeW - kTW) / 2, oy = kBakeW / 2 - kTH / 2;
    out.assign(size_t(kTW) * size_t(kTexH), 0u);
    for (int y = 0; y < kTH; ++y)
        std::memcpy(&out[size_t(y) * kTW], &px[size_t(y + oy) * kBakeW + size_t(ox)], sizeof(uint32_t) * kTW);
    return true;
}

void tileWorkerMain() {
    SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_BELOW_NORMAL);
    for (;;) {
        TileJob job;
        {
            std::unique_lock<std::mutex> lk(gTileMx);
            gTileCv.wait(lk, [] { return gTileStop || !gTileQueue.empty(); });
            if (gTileStop) return;
            job = gTileQueue.front();
            gTileQueue.erase(gTileQueue.begin());
            gTileBusy = true;
        }
        TileResult r; r.i = job.i; r.j = job.j; r.epoch = job.epoch;
        bool ok = false;
        try { ok = (gEpoch.load() == job.epoch) && bakeTilePixels(job.i, job.j, job.epoch, r.px); } catch (...) { ok = false; }
        {
            std::lock_guard<std::mutex> lk(gTileMx);
            gTileBusy = false;
            if (ok && gEpoch.load() == job.epoch) gTileDone.push_back(std::move(r));
        }
        gTileIdleCv.notify_all();
    }
}

void startTileWorker() {
    if (gTileStarted) return;
    gTileStarted = true;
    gTileStop    = false;
    gTileThread  = std::thread(tileWorkerMain);
}

void tileQuiesce() {
    std::unique_lock<std::mutex> lk(gTileMx);
    gTileQueue.clear();
    gTileDone.clear();
    gTileIdleCv.wait(lk, [] { return !gTileBusy; });
}

void asyncQuiesce() {
    ++gEpoch; // running jobs abort at the next row, queued/finished ones are dropped
    std::unique_lock<std::mutex> lk(gAsyncMx);
    for (auto& s : gSlots) { s.queued = false; s.done = false; }
    gIdleCv.wait(lk, [] { return !gSlots[0].busy && !gSlots[1].busy; });
    tileQuiesce();
}

void resetSlots() {
    for (auto& s : gSlots) { s.disp = Baked{}; s.pendDisp = Baked{}; }
    gMiniTex.bakeId = gBigTex.bakeId = 0;
    gMiniTex.pending = gBigTex.pending = false;
}

// Take a finished bake from the worker (if any) and upload it as the displayed texture.
void commitPending(Slot& s, Tex& t) {
    if (t.pending && gFrame - t.pendFrame >= 2) {
        t.cur     = 1 - t.cur;
        t.pending = false;
        s.disp    = std::move(s.pendDisp);
        t.bakeId  = ++gBakeCounter;
    }
}

void pollAsync(Slot& s, Tex& t, ::IClientInstance& client) {
    commitPending(s, t);
    if (t.pending) return; // previous upload not shown yet; the finished bake waits in the slot
    Baked                 res;
    std::vector<uint32_t> px;
    {
        std::lock_guard<std::mutex> lk(gAsyncMx);
        if (!s.done) return;
        s.done = false;
        if (s.resEpoch != gEpoch.load()) return;
        res = std::move(s.res);
        px  = std::move(s.px);
    }
    if (!uploadImage(client, t, px, res.n * PPC)) { gTexFailed = true; return; }
    t.pending   = true;
    t.pendFrame = gFrame;
    s.pendDisp  = std::move(res);
}

void requestBake(Slot& s, Tex& t, ::IClientInstance& client, Job const& j) {
    if (!gWorkerStarted) startWorker();
    if (gWorkerOk) {
        {
            std::lock_guard<std::mutex> lk(gAsyncMx);
            if (s.busy || s.queued || s.done) return;
            s.job    = j;
            s.queued = true;
        }
        gCv.notify_all();
        return;
    }
    // no worker thread available: bake inline (old behaviour)
    Baked                 res;
    std::vector<uint32_t> px;
    if (!runJob(j, res, px)) return;
    if (t.pending) return;
    if (!uploadImage(client, t, px, j.W)) { gTexFailed = true; return; }
    t.pending   = true;
    t.pendFrame = gFrame;
    s.pendDisp  = std::move(res);
}

// Decide (against the DISPLAYED bake) whether a new bake is needed, request it in the background and return the scroll for what is shown now.
Scroll prepareAsync(Slot& s, Tex& t, ::IClientInstance& client, int nb, int nview, int step, float tx, float tz, float smoothH, uint64_t minInterval, int drift0) {
    pollAsync(s, t, client);
    Baked const& d     = s.disp;
    bool         valid = d.cx != INT32_MIN;
    bool         geom  = !valid || d.n != nb || d.step != step || d.view != nview;
    float        drift = float(drift0) * float(step);
    bool         farAway   = valid && (std::fabs(tx - float(d.cx)) > drift || std::fabs(tz - float(d.cz)) > drift || std::fabs(smoothH - float(d.h0)) > 4.0f * float(step));
    bool         dirty = valid && d.version != gVersion && gFrame - d.frame >= minInterval;
    if (geom || farAway || dirty) {
        Job j;
        if (geom || farAway) {
            j.cx = int(std::floor(tx / float(step))) * step;
            j.cz = int(std::floor(tz / float(step))) * step;
            j.h0 = int(std::lround(smoothH / float(step))) * step;
        } else {
            j.cx = d.cx; j.cz = d.cz; j.h0 = d.h0;
        }
        j.n = nb; j.step = step; j.view = nview; j.W = nb * PPC;
        j.version = gVersion; j.frame = gFrame; j.epoch = gEpoch.load();
        requestBake(s, t, client, j);
    }
    return makeScroll(s.disp, tx, tz, smoothH);
}

// ---------- tile manager (main thread) ----------
struct Tile {
    bool                  inited = false;
    int                   l = 0, i = 0, j = 0;
    Tex                   tex;
    std::vector<uint32_t> px;
    uint64_t              pxVer = 0, upVer = 0, propVer = 0, pxFrame = 0, staleFrame = 0, lastUse = 0;
    bool                  baked = false, queued = false, stale = false, content = false, shown = false;
};
std::unordered_map<int64_t, Tile> gTiles;

Tile& tileAt(int l, int i, int j) {
    Tile& t = gTiles[tkey(l, i, j)];
    if (!t.inited) { t.inited = true; t.l = l; t.i = i; t.j = j; }
    return t;
}
Tile* findTile(int l, int i, int j) {
    auto it = gTiles.find(tkey(l, i, j));
    return it == gTiles.end() ? nullptr : &it->second;
}

void clearTiles() {
    gTiles.clear();
    gTilesInit = false;
    gChangedChunks.clear();
}

// A changed chunk can show up in every level-0 tile whose bake window (x -32..+32 blocks, z rows -40..+110 for lifted roofs) reaches it.
void markTilesForChunk(int cx, int cz) {
    int x0 = cx * 16, z0 = cz * 16;
    for (int i = fdiv(x0 - 160, kTileX); i <= fdiv(x0 + 48, kTileX); ++i) {
        if (!(kTileX * i - 32 < x0 + 16 && kTileX * i + kTileX + 32 > x0)) continue;
        for (int j = fdiv(z0 - 280, kTileZ); j <= fdiv(z0 + 56, kTileZ); ++j) {
            if (!(kTileZ * j - 40 < z0 + 16 && kTileZ * j + kTileZ + 110 > z0)) continue;
            Tile& t = tileAt(0, i, j);
            t.content = true; t.stale = true; t.staleFrame = gFrame;
        }
    }
}

void initTilesFromCache() {
    std::vector<std::pair<int, int>> cs;
    {
        std::lock_guard<std::mutex> lk(gMapMx);
        for (auto const& [k, cd] : gCache) {
            bool any = false;
            for (int q = 0; q < 256; ++q) if (cd.color[q]) { any = true; break; }
            if (any) cs.push_back({int(int32_t(uint32_t(k >> 32))), int(int32_t(uint32_t(k & 0xFFFFFFFFu)))});
        }
    }
    for (auto const& c : cs) markTilesForChunk(c.first, c.second);
    gTilesInit = true;
}

void contributeToParent(Tile const& c) {
    Tile& p = tileAt(c.l + 1, fdiv(c.i, 2), fdiv(c.j, 2));
    if (p.px.empty()) p.px.assign(size_t(kTW) * size_t(kTexH), 0u);
    int qx = (c.i & 1) * (kTW / 2), qy = (c.j & 1) * (kTH / 2);
    for (int y = 0; y < kTH / 2; ++y)
        for (int x = 0; x < kTW / 2; ++x) {
            uint32_t const* r0 = &c.px[size_t(2 * y) * kTW + size_t(2 * x)];
            uint32_t const* r1 = r0 + kTW;
            uint32_t        q[4] = {r0[0], r0[1], r1[0], r1[1]};
            uint32_t        a = 0, rs = 0, gs = 0, bs = 0;
            for (uint32_t v : q) {
                uint32_t al = v >> 24;
                a += al; rs += ((v >> 16) & 255) * al; gs += ((v >> 8) & 255) * al; bs += (v & 255) * al;
            }
            uint32_t out = 0;
            if (a) out = ((a / 4) << 24) | ((rs / a) << 16) | ((gs / a) << 8) | (bs / a);
            p.px[size_t(qy + y) * kTW + size_t(qx + x)] = out;
        }
    ++p.pxVer;
    p.pxFrame = gFrame;
}

void tileTick(float tx, float tz, bool bigOpen) {
    for (auto const& c : gChangedChunks) markTilesForChunk(c.first, c.second);
    gChangedChunks.clear();
    if (!bigOpen || !gTexEnabled || gTexFailed) return;
    if (!gTilesInit) initTilesFromCache();
    startTileWorker();
    // finished bakes
    std::vector<TileResult> done;
    {
        std::lock_guard<std::mutex> lk(gTileMx);
        done.swap(gTileDone);
    }
    for (auto& r : done) {
        if (r.epoch != gEpoch.load()) continue;
        Tile& t = tileAt(0, r.i, r.j);
        t.queued = false; t.px = std::move(r.px); t.baked = true; ++t.pxVer; t.pxFrame = gFrame;
    }
    // propagate finished tiles into their parent level (box filter)
    int work = 3;
    for (auto& kv : gTiles) {
        Tile& t = kv.second;
        if (work <= 0) break;
        if (t.px.empty() || t.propVer == t.pxVer || gFrame - t.pxFrame < 6) continue;
        if (t.l < kLMax) { contributeToParent(t); --work; }
        t.propVer = t.pxVer;
    }
    // schedule bakes: nearest to the view first
    if (gFrame % 12 == 0) {
        size_t queued;
        { std::lock_guard<std::mutex> lk(gTileMx); queued = gTileQueue.size(); }
        if (queued < 3) {
            std::vector<std::pair<float, Tile*>> cand;
            for (auto& kv : gTiles) {
                Tile& t = kv.second;
                if (t.l != 0 || !t.content || t.queued) continue;
                if (t.baked && !(t.stale && gFrame - t.staleFrame >= 45)) continue;
                float dx = float(t.i * kTileX + kTileX / 2) - tx, dz = float(t.j * kTileZ + kTileZ / 2) - tz;
                cand.push_back({dx * dx + dz * dz, &t});
            }
            std::sort(cand.begin(), cand.end(), [](auto const& a, auto const& b) { return a.first < b.first; });
            size_t take = std::min<size_t>(cand.size(), 3 - queued);
            std::lock_guard<std::mutex> lk(gTileMx);
            for (size_t k = 0; k < take; ++k) {
                Tile* t = cand[k].second;
                t->queued = true; t->stale = false;
                gTileQueue.push_back({t->i, t->j, gEpoch.load()});
            }
            if (take) gTileCv.notify_all();
        }
    }
    // keep RAM bounded: level-0 pixel copies that are already on the GPU and propagated can be dropped
    if (gFrame % 60 == 0) {
        int cnt = 0;
        for (auto& kv : gTiles) if (kv.second.l == 0 && !kv.second.px.empty()) ++cnt;
        while (cnt > 64) {
            Tile* old = nullptr;
            for (auto& kv : gTiles) {
                Tile& t = kv.second;
                if (t.l != 0 || t.px.empty() || !t.shown || t.upVer != t.pxVer || t.propVer != t.pxVer || t.tex.pending) continue;
                if (!old || t.lastUse < old->lastUse) old = &t;
            }
            if (!old) break;
            old->px.clear(); old->px.shrink_to_fit();
            --cnt;
        }
    }
}

bool tileShown(Tile const& t) { return t.shown && t.tex.created[t.tex.cur]; }

void tileUpload(::IClientInstance& client, Tile& t, int& uploads) {
    if (t.tex.pending && gFrame - t.tex.pendFrame >= 2) { t.tex.cur = 1 - t.tex.cur; t.tex.pending = false; t.shown = true; }
    if (!t.tex.pending && !t.px.empty() && t.upVer != t.pxVer && gFrame - t.pxFrame >= (t.l ? 10u : 1u) && uploads < 3) {
        if (uploadImage(client, t.tex, t.px, kTW)) { t.tex.pending = true; t.tex.pendFrame = gFrame; t.upVer = t.pxVer; ++uploads; }
        else gTexFailed = true;
    }
}

bool drawTileTex(::MinecraftUIRenderContext& ctx, Tex const& t, float x, float y, float w, float h, float u0, float v0, float uw, float vh) {
    ::ResourceLocation loc(::Core::PathView(t.name[t.cur]), ::ResourceFileSystem::UserPackage);
    ::mce::TexturePtr  tp  = ctx.getTexture(loc, false);
    auto const*        dat = tp.mClientTexture.get();
    if (!dat) return false;
    ctx.drawImage(dat->mClientTexture.get(), ::glm::vec2{x, y}, ::glm::vec2{w, h}, ::glm::vec2{u0, v0}, ::glm::vec2{uw, vh}, false);
    ctx.flushImages(::mce::Color{1.0f, 1.0f, 1.0f, 1.0f}, 1.0f, ::HashedString(gMaterial));
    return true;
}

void drawTileCell(::MinecraftUIRenderContext& ctx, ::IClientInstance& client, int l, int i, int j, float x, float y, float w, float h, int& uploads) {
    constexpr float kV = float(kTH) / float(kTexH);
    float ow = w + 0.75f, oh = h + 0.75f; // tiny overlap hides hairline seams between neighbours
    if (Tile* t = findTile(l, i, j)) {
        tileUpload(client, *t, uploads);
        if (tileShown(*t) && drawTileTex(ctx, t->tex, x, y, ow, oh, 0.0f, 0.0f, 1.0f, kV)) { t->lastUse = gFrame; return; }
    }
    // stand-in: the same area from a coarser level (never empty holes while the detailed tile is still baking)
    for (int l2 = l + 1; l2 <= kLMax; ++l2) {
        int k = 1 << (l2 - l), ai = fdiv(i, k), aj = fdiv(j, k);
        Tile* a = findTile(l2, ai, aj);
        if (!a) continue;
        tileUpload(client, *a, uploads);
        if (!tileShown(*a)) continue;
        float ox = float(i - ai * k) / float(k), oy = float(j - aj * k) / float(k);
        if (drawTileTex(ctx, a->tex, x, y, ow, oh, ox, oy * kV, 1.0f / float(k), kV / float(k))) { a->lastUse = gFrame; return; }
    }
}

// Whole big map from tiles. (tx,tz) = world point at the screen centre, cH = ground height there.
void drawTileMap(::MinecraftUIRenderContext& ctx, ::IClientInstance& client, float sw, float sh, float size, float tx, float tz, float cH, float yaw) {
    float s    = size / (gZoom * float(PPC));         // GUI units per level-0 pixel
    float pcx  = tx * float(PPC), pcy = tz * KY * float(PPC) - (cH - float(kHRef)) * kLiftPx;
    float halfW = sw * 0.5f / s, halfH = sh * 0.5f / s;
    float dens  = size / gZoom * 2.2f;                // ~ physical pixels per block
    int   L     = std::clamp(int(std::floor(std::log2(float(PPC) / std::max(dens, 0.01f)))), 0, kLMax);
    float tw = float(kTW << L), th = float(kTH << L);
    int   i0 = int(std::floor((pcx - halfW) / tw)), i1 = int(std::floor((pcx + halfW) / tw));
    int   j0 = int(std::floor((pcy - halfH) / th)), j1 = int(std::floor((pcy + halfH) / th));
    int   uploads = 0;
    for (int j = j0; j <= j1; ++j)
        for (int i = i0; i <= i1; ++i) {
            float x = sw * 0.5f + (float(i) * tw - pcx) * s, y = sh * 0.5f + (float(j) * th - pcy) * s;
            drawTileCell(ctx, client, L, i, j, x, y, tw * s, th * s, uploads);
        }
    // player marker (same global projection)
    float mpx = gSX * float(PPC), mpy = gSZ * KY * float(PPC) - (gSY - 1.6f - float(kHRef)) * kLiftPx;
    float mx  = sw * 0.5f + (mpx - pcx) * s, my = sh * 0.5f + (mpy - pcy) * s;
    if (mx > 0 && mx < sw && my > 0 && my < sh) marker(ctx, mx, my, std::clamp(3.5f * std::pow(256.0f / gZoom, 0.5f), 1.1f, 4.0f), yaw);
}

int gH0Mini = 64, gH0Big = 64;
float gSmoothH = -99999.0f;
float gBigSH = -99999.0f;

} // namespace

void shutdown() {
    removeWheelHook();
    {
        std::lock_guard<std::mutex> lk(gTileMx);
        gTileStop = true;
    }
    gTileCv.notify_all();
    if (gTileThread.joinable()) gTileThread.join();
    gTileStarted = false;
    gTileStop    = false;
    {
        std::lock_guard<std::mutex> lk(gAsyncMx);
        gStop = true;
    }
    gCv.notify_all();
    if (gThread.joinable()) gThread.join();
    gWorkerStarted = false;
    gWorkerOk      = false;
    gStop          = false;
}

void reset() {
    saveAll();
    asyncQuiesce();
    resetSlots();
    clearTiles();
    {
        std::lock_guard<std::mutex> lk(gMapMx);
        gCache.clear();
    }
    gMini = Baked{};
    gBig  = Baked{};
    gWorldKey.clear();
    ++gVersion;
    gBigMap = false;
}

bool gHudHidden = false;
void setBigMapHud(::IClientInstance& client, bool hide) {
    if (gHudHidden == hide) return;
    gHudHidden = hide;
    auto gui = client.getGuiData();
    // Crosshair stays visible: our draw hook runs inside the crosshair renderer
    std::vector<::HudElement> els = {::HudElement::HotBar,       ::HudElement::Health,        ::HudElement::Hunger,
                                     ::HudElement::Armor,        ::HudElement::ProgressBar,   ::HudElement::AirBubbles,
                                     ::HudElement::HorseHealth,  ::HudElement::StatusEffects, ::HudElement::ItemText,
                                     ::HudElement::ToolTips,     ::HudElement::PaperDoll};
    gui->setHudVisibilityState(els, hide ? ::HudVisibility::Hide : ::HudVisibility::Reset);
}

void draw(::MinecraftUIRenderContext& ctx, ::IClientInstance& client) {
    ::LocalPlayer* player = client.getLocalPlayer();
    ::BlockSource* region = client.getRegion();
    if (!player || !region) return;
    if (int(region->getDimensionId()) != 0) { setBigMapHud(client, false); if (gMouseReleased) { client.grabMouse(); gMouseReleased = false; } if (gInputLocked) { client.setDisableInput(false); client.setSuspendDirectionalInput(false); gInputLocked = false; } return; } // Overworld only

    ++gFrame;
    uint64_t tick = GetTickCount64();
    bool     gap  = tick - gLastDrawTick > 3000; // we were not drawing (menu / other world / other dimension)
    gLastDrawTick = tick;
    if (gWorldKey.empty() || gap || gFrame % 600 == 0) {
        std::string k = computeWorldKey(player->getLevel());
        if (k != gWorldKey) switchWorld(k);
    }

    auto const& pos = player->getPosition();
    int         px  = int(std::floor(pos.x));
    int         pz  = int(std::floor(pos.z));
    float       yaw = player->getRotation().y;

    updateCache(*region, px, pz);
    if (!gDirtyRegions.empty() && gFrame - gLastSaveFrame >= 300) {
        gLastSaveFrame = gFrame;
        int64_t k = *gDirtyRegions.begin();
        gDirtyRegions.erase(gDirtyRegions.begin());
        saveRegion(int(k >> 32), int(int32_t(uint32_t(k & 0xFFFFFFFFu))));
    }
    pollInput();
    setBigMapHud(client, gBigMap);
    if (gBigMap != gInputLocked) { client.setDisableInput(gBigMap); client.setSuspendDirectionalInput(gBigMap); gInputLocked = gBigMap; }
    if (!gBigMap && gMouseReleased) { client.grabMouse(); gMouseReleased = false; gDragging = false; }
    float dtf = frameDt();
    {
        static float maxDt = 0, sumDt = 0;
        static int   nDt = 0;
        maxDt = std::max(maxDt, dtf); sumDt += dtf; ++nDt;
        if (nDt >= 600) {
            char m[200];
            std::snprintf(m, sizeof(m), "perf: %d hook calls, avg dt %.1f ms, max dt %.1f ms, uploads %llu, in-place failed %llu, max upload %.1f ms, bigmap=%d",
                          nDt, 1000.0f * sumDt / float(nDt), 1000.0f * maxDt, (unsigned long long)gPerfUploads, (unsigned long long)gPerfInPlaceFail, gPerfMaxUploadMs, int(gBigMap));
            DioramaMod::getInstance().getSelf().getLogger().info(std::string(m));
            maxDt = sumDt = 0; nDt = 0; gPerfMaxUploadMs = 0;
        }
    }
    smoothPlayer(float(pos.x), float(pos.y), float(pos.z), gap, dtf);

    ::RectangleArea screen = ctx.getFullClippingRectangle();
    float           sw     = float(screen._x1) - float(screen._x0);
    float           sh     = float(screen._y1) - float(screen._y0);
    if (sw < 50.0f || sh < 50.0f) return;

    int groundPlayer = groundHeight(px, pz, int(pos.y) - 2);

    if (!gBigMap) tileTick(gSX, gSZ, false);
    if (gBigMap) {
        // fullscreen like Java Diorama: map fills the screen, top bar with coords + chunk count, bottom hint
        float size = std::max(sw, sh);
        float x    = (sw - size) * 0.5f;
        float y    = (sh - size) * 0.5f;
        // --- input: wheel zoom (toward the cursor), left-drag pan ---
        {
            POINT cp{}; RECT cr{};
            bool  mv = gHwnd && GetCursorPos(&cp) && ScreenToClient(gHwnd, &cp) && GetClientRect(gHwnd, &cr) && cr.right > 0 && cr.bottom > 0;
            float mx = mv ? float(cp.x) * sw / float(cr.right) : sw * 0.5f, my = mv ? float(cp.y) * sh / float(cr.bottom) : sh * 0.5f;
            int   wh = gWheel.exchange(0);
            if (wh != 0) {
                float nz = std::clamp(gZoom * std::pow(0.87f, float(wh) / 120.0f), 40.0f, 2400.0f);
                gPanX += (mx - sw * 0.5f) * (gZoom - nz) / size;
                gPanZ += (my - sh * 0.5f) * (gZoom - nz) / (size * KY);
                gZoom = nz;
            }
            bool lmb = mv && down(VK_LBUTTON) && windowFocused();
            if (lmb && my > 30.0f && my < sh - 22.0f) {
                if (gDragging) {
                    gPanX -= (mx - gLastMX) * gZoom / size;
                    gPanZ -= (my - gLastMY) * gZoom / (size * KY);
                }
                gDragging = true; gLastMX = mx; gLastMY = my;
            } else gDragging = false;
        }
        // bake geometry follows a ladder (x1.5): between rungs the baked picture is only cropped/scaled, so zooming never re-bakes
        constexpr float kLadder[] = {64, 96, 144, 216, 324, 486, 729, 1094, 1640, 2461};
        int Q = 2461;
        for (float q : kLadder) if (gZoom <= q) { Q = int(q); break; }
        if (Q != gBigLastQ) { gBigLastQ = Q; gBigBias = 0; }
        int   step  = std::max(1, (Q + 191) / 192) + gBigBias;
        int   nview = std::min(192, ((Q + step - 1) / step + 1) & ~1);
        int   nb    = nview + 32;
        float tx    = gSX + gPanX, tz = gSZ + gPanZ;
        float sH    = gSY - 1.6f; // eye -> feet
        {
            int g = groundHeight(int(std::floor(tx)), int(std::floor(tz)), gH0Big);
            gH0Big = g;
            if (gBigSH < -1000.0f || gap) gBigSH = float(g);
            { float dH = (float(g) - gBigSH) * (1.0f - std::exp(-dtf / 0.9f)); float mx = 8.0f * dtf; gBigSH += std::clamp(dH, -mx, mx); }
            (void)sH;
        }
        if (!gCfgRead) readConfig();
        Scroll sc{};
        bool   texOk = false;
        client.releaseMouse(); // free cursor for dragging
        gMouseReleased = true;
        rect(ctx, 0, 0, sw, sh, toColor(FOG), 1.0f);
        if (gTexEnabled && !gTexFailed) {
            tileTick(tx, tz, true);
            if (!gTexFailed) {
                drawTileMap(ctx, client, sw, sh, size, tx, tz, gBigSH, yaw);
                texOk = !gTexFailed;
            }
        }
        if (!texOk) {
            // fallback: rectangles (synchronous bake)
            sc = prepareScroll(gBig, nb, nview, step, tx, tz, gBigSH, 90, 8);
            retarget(sc, gZoom);
            if (gBig.rects.size() > kBigBudget && gBigBias < 6) ++gBigBias;
            float k = size / sc.vcells;
            drawBaked(ctx, gBig, x - sc.u0 * float(nb) * k, y - sc.v0 * float(nb) * k, k * float(nb));
        }
        // player marker: smoothed position relative to the same view window
        if (sc.ready) {
            float cell = size / sc.vcells;
            float ppx = float(sc.nb) * 0.5f + (gSX - float(sc.cx)) / float(sc.step);
            float ppy = float(sc.nb) * 0.5f + (gSZ - float(sc.cz)) / float(sc.step) * KY - (gSY - 1.6f - float(sc.h0)) * HS / float(sc.step);
            float mx = x + (ppx - sc.u0 * float(sc.nb)) * cell, my = y + (ppy - sc.v0 * float(sc.nb)) * cell;
            if (mx > 0 && mx < sw && my > 0 && my < sh) marker(ctx, mx, my, std::clamp(3.5f * std::pow(256.0f / gZoom, 0.5f), 1.1f, 4.0f), yaw);
        }
        // top bar
        float bar = 30.0f;
        rect(ctx, 0, 0, sw, bar, ::mce::Color{0.02f, 0.03f, 0.05f, 1.0f}, 0.72f);
        float tabW = textWidth("ПОВЕРХНОСТЬ", 2.0f) + 12.0f;
        rect(ctx, 6, 5, 6 + tabW, 25, ::mce::Color{0.05f, 0.07f, 0.10f, 1.0f}, 0.95f);
        rect(ctx, 6, 24, 6 + tabW, 26, ::mce::Color{0.95f, 0.97f, 1.0f, 1.0f}, 1.0f);
        ::mce::Color white{0.95f, 0.97f, 1.0f, 1.0f};
        drawPixText(ctx, "ПОВЕРХНОСТЬ", 12, 9, 2.0f, white);
        char info[96];
        std::snprintf(info, sizeof(info), "%d, %d, %d   ЧАНКОВ: %d", px, int(pos.y), pz, int(gCache.size()));
        drawPixText(ctx, info, tabW + 20.0f, 9, 2.0f, white);
        // bottom hint
        rect(ctx, 0, sh - 22, sw, sh, ::mce::Color{0.02f, 0.03f, 0.05f, 1.0f}, 0.72f);
        drawPixText(ctx, "КОЛЕСО - МАСШТАБ   ЛКМ - ПЕРЕТАСКИВАНИЕ   HOME - В ЦЕНТР   M - ЗАКРЫТЬ", 8, sh - 16, 2.0f, white);
    } else {
        constexpr float SIZE   = 76.0f;
        constexpr int   VIEW   = 64;          // blocks visible
        constexpr int   NB     = 84;          // blocks baked (10 block margin each side: rare re-bakes)
        float           x      = sw - SIZE - 20.0f;
        float           y      = 22.0f;
        if (gap || gSmoothH < -1000.0f) gSmoothH = float(groundPlayer);
        { float dH = (float(groundPlayer) - gSmoothH) * (1.0f - std::exp(-dtf / 0.9f)); float mx = 5.0f * dtf; gSmoothH += std::clamp(dH, -mx, mx); }
        if (!gCfgRead) readConfig();
        gH0Mini = groundPlayer;
        bool drawn = false;
        if (gTexEnabled && !gTexFailed) {
            Scroll sc = prepareAsync(gSlots[0], gMiniTex, client, NB, VIEW, 1, gSX, gSZ, gSmoothH, 24, 6);
            if (!gTexFailed) {
                if (gRound) frameRound(ctx, x, y, SIZE); else frame(ctx, x, y, SIZE);
                if (!sc.ready) {
                    if (!gRound) vignette(ctx, x, y, SIZE); // first bake still running in the background
                    drawn = true;
                } else if (gRound ? drawTexRound(ctx, gMiniTex, x, y, SIZE, sc.u0, sc.v0, sc.uw, sc.vh) : drawTexAsync(ctx, gMiniTex, x, y, SIZE, sc.u0, sc.v0, sc.uw, sc.vh)) {
                    if (!gRound) vignette(ctx, x, y, SIZE);
                    float cell = SIZE / float(sc.nview);
                    marker(ctx, x + (sc.pcx - sc.u0 * float(sc.nb)) * cell, y + (sc.pcy - sc.v0 * float(sc.nb)) * cell, 1.3f, yaw);
                    drawn = true;
                }
            }
        }
        if (!drawn) {
            constexpr int BLOCKS = 56;
            ensureBaked(gMini, px, pz, groundPlayer, BLOCKS, 1, 6);
            frame(ctx, x, y, SIZE);
            drawBaked(ctx, gMini, x, y, SIZE);
            vignette(ctx, x, y, SIZE);
            float cell = SIZE / float(BLOCKS);
            float ux   = float(BLOCKS) * 0.5f + (float(pos.x) - float(px));
            float uy   = float(BLOCKS) * 0.5f + (float(pos.z) - float(pz)) * KY;
            marker(ctx, x + ux * cell, y + uy * cell, 1.3f, yaw);
        }
        compassLetter(ctx, 'N', x + SIZE / 2, y - 10, true);
        compassLetter(ctx, 'S', x + SIZE / 2, y + SIZE + 10, false);
        compassLetter(ctx, 'W', x - 10, y + SIZE / 2, false);
        compassLetter(ctx, 'E', x + SIZE + 10, y + SIZE / 2, false);
    }
}

} // namespace diorama_bedrock::minimap
