// Diorama (Bedrock) - minimap + big map (stage 3/4/7 first version).
// Terrain is scanned column by column from the loaded chunks into a persistent cache,
// then drawn as merged horizontal colour runs with MinecraftUIRenderContext::fillRectangle.
// Visual style follows Diorama (MIT, (c) Dara Adedeji): dark frame, relief shading, fog for unknown areas.

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

constexpr uint32_t FOG = 0xFF0D0F17u;

// Wall profile: colour of the block at (top - depth) for each depth; used to paint real building/cliff faces.
constexpr int NW = 8;
constexpr int kWallDepth[NW] = {0, 1, 2, 4, 7, 11, 16, 24};

struct ChunkData {
    std::array<uint32_t, 256> color{}; // 0 = unknown, else 0xFFRRGGBB
    std::array<int16_t, 256>  height{};
    std::array<uint32_t, 256 * NW> wall{};
    bool                      scanned  = false;
    bool                      dirty    = false;
    uint64_t                  lastScan = 0;
    uint64_t                  lastTry  = 0;
};


std::unordered_map<int64_t, ChunkData> gCache;
std::mutex                             gMapMx; // guards the STRUCTURE of gCache (insert/clear on main thread vs. find on the bake worker)
uint64_t                               gFrame   = 0;
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

uint32_t colorOfBlock(::BlockSource& region, ::BlockPos const& pos, ::Block const& block) {
    auto it = gBlockCol.find(&block);
    if (it != gBlockCol.end()) return it->second;
    std::string const& name = block.getTypeName();
    uint32_t           col;
    uint32_t           rgb = blockRgb(name);
    if (rgb) {
        col = 0xFF000000u | rgb;
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
    }
    gBlockCol[&block] = col;
    return col;
}

bool scanColumn(::BlockSource& region, int x, int z, uint32_t& col, int16_t& h, uint32_t* wall) {
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
        for (int k2 = 0; k2 < NW; ++k2) wall[k2] = col;
    } else {
        col = colorOfBlock(region, pos, *block);
        uint32_t prev = col;
        wall[0]       = col;
        for (int k = 1; k < NW; ++k) {
            int yy = y - kWallDepth[k];
            if (yy < minH) { wall[k] = prev; continue; }
            ::BlockPos p2{x, yy, z};
            ::Block const& b2 = region.getBlock(p2);
            if (b2.isAir() || isWater(b2.getTypeName())) { wall[k] = prev; continue; }
            prev    = colorOfBlock(region, p2, b2);
            wall[k] = prev;
        }
    }
    h = int16_t(y);
    return true;
}

void markDirty(int cx, int cz);

bool scanChunk(::BlockSource& region, int cx, int cz, ChunkData& cd) {
    ::BlockPos probe{cx * 16 + 8, 64, cz * 16 + 8};
    if (!region.getChunkAt(probe)) return false;
    bool changed = false;
    for (int lz = 0; lz < 16; ++lz) {
        for (int lx = 0; lx < 16; ++lx) {
            uint32_t col = 0;
            int16_t  h   = 0;
            uint32_t w[NW];
            if (!scanColumn(region, cx * 16 + lx, cz * 16 + lz, col, h, w)) continue;
            int idx = lz * 16 + lx;
            if (cd.color[idx] != col || cd.height[idx] != h || std::memcmp(&cd.wall[size_t(idx) * NW], w, sizeof(w)) != 0) {
                cd.color[idx]  = col;
                cd.height[idx] = h;
                std::memcpy(&cd.wall[size_t(idx) * NW], w, sizeof(w));
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
    gRoot = base / "diorama-bedrock";
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
    f.write("DBM3", 4);
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
            f.write(reinterpret_cast<char const*>(it->second.wall.data()), 256 * NW * 4);
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
        if (!f.read(magic, 4) || (std::string(magic, 4) != "DBM2" && std::string(magic, 4) != "DBM3") || !f.read(reinterpret_cast<char*>(&count), 4)) continue;
        for (uint32_t i = 0; i < count && i < 1024; ++i) {
            int       cx = 0, cz = 0;
            ChunkData cd;
            if (!f.read(reinterpret_cast<char*>(&cx), 4) || !f.read(reinterpret_cast<char*>(&cz), 4)) break;
            if (!f.read(reinterpret_cast<char*>(cd.color.data()), 256 * 4)) break;
            if (!f.read(reinterpret_cast<char*>(cd.height.data()), 256 * 2)) break;
            if (magic[3] == '3') {
                if (!f.read(reinterpret_cast<char*>(cd.wall.data()), 256 * NW * 4)) break;
            } else {
                for (int i = 0; i < 256; ++i)
                    for (int k = 0; k < NW; ++k) cd.wall[size_t(i) * NW + k] = cd.color[i];
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

void switchWorld(std::string const& k) {
    saveAll();
    asyncQuiesce(); // the bake worker must not touch gCache while it is cleared
    resetSlots();
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
constexpr float KY  = 0.75f; // 3 px per row at 4 px/cell: pixel-exact so re-bakes are invisible
constexpr float HS  = 1.0f;  // 4 px lift per block at step 1
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

bool sample(Sampler& s, int x, int z, uint32_t& col, int& h, uint32_t const** wall = nullptr) {
    ChunkData* c = s.get(x, z);
    if (!c) return false;
    int idx = (z & 15) * 16 + (x & 15);
    if (!c->color[idx]) return false;
    col = c->color[idx];
    h   = c->height[idx];
    if (wall) *wall = &c->wall[size_t(idx) * NW];
    return true;
}

int groundHeight(int x, int z, int fallback) {
    Sampler s;
    uint32_t c;
    int      h;
    return sample(s, x, z, c, h) ? h : fallback;
}

// One map cell. For step>1 it averages 2x2 columns spread over the cell (less aliasing / detail loss when zoomed out).
bool sampleCell(Sampler& s, int x, int z, int step, uint32_t& col, int& h, uint32_t const** wall) {
    if (step <= 1) return sample(s, x, z, col, h, wall);
    int      half = std::max(1, step / 2);
    int      cnt = 0, hs = 0;
    uint32_t r = 0, g = 0, bl = 0;
    for (int oz = 0; oz < 2; ++oz)
        for (int ox = 0; ox < 2; ++ox) {
            uint32_t c; int hh; uint32_t const* w = nullptr;
            if (!sample(s, x + ox * half, z + oz * half, c, hh, &w)) continue;
            if (!cnt && wall) *wall = w;
            r += (c >> 16) & 255; g += (c >> 8) & 255; bl += c & 255; hs += hh; ++cnt;
        }
    if (!cnt) return false;
    col = 0xFF000000u | ((r / cnt) << 16) | ((g / cnt) << 8) | (bl / cnt);
    h   = int(std::lround(float(hs) / float(cnt)));
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
    int   rowsHalf = int(float(n) / (2.0f * KY)) + 28;
    int   x0 = cx - (n / 2) * step;
    Sampler s;
    struct Row { std::vector<uint32_t> col; std::vector<int> h; std::vector<uint32_t const*> wp; };
    auto fill = [&](Row& r, int z) {
        r.col.assign(size_t(n), 0u); r.h.assign(size_t(n), 0); r.wp.assign(size_t(n), nullptr);
        for (int i = 0; i < n; ++i) {
            uint32_t c = 0; int h = 0; uint32_t const* w = nullptr;
            if (sampleCell(s, x0 + i * step, z, step, c, h, &w)) { r.col[size_t(i)] = c; r.h[size_t(i)] = h; r.wp[size_t(i)] = w; }
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
            if (nxt.col[size_t(i)] && h > nxt.h[size_t(i)]) d = std::min(h - nxt.h[size_t(i)], 48);
            dh[size_t(i)] = d;
            uint32_t const* wp = cur.wp[size_t(i)];
            if (d > 0 && wp) {
                std::memcpy(wl[size_t(i)].data(), wp, sizeof(uint32_t) * NW);
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
    {'Q', 0b010101101111011}, {'J', 0b001001001101010}};

void drawPixText(::MinecraftUIRenderContext& ctx, std::string const& t, float x, float y, float px, ::mce::Color const& col) {
    float cx = x;
    for (char ch : t) {
        char u = char(std::toupper(uint8_t(ch)));
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

// px layout: 0xAARRGGBB (A=0 unknown). Returns pixels (W x W).
void rasterize(Baked const& b, int W, std::vector<uint32_t>& px, bool soft) {
    px.assign(size_t(W) * W, 0u);
    std::vector<int16_t> hb(size_t(W) * W, INT16_MIN);
    float sc = float(W) / float(b.n);
    for (auto const& r : b.rects) {
        int x0 = std::max(0, int(std::floor(r.x0 * sc))), x1 = std::min(W, int(std::ceil(r.x1 * sc)));
        int y0 = std::max(0, int(std::floor(r.y0 * sc))), y1 = std::min(W, int(std::ceil(r.y1 * sc)));
        for (int y = y0; y < y1; ++y)
            for (int x = x0; x < x1; ++x) {
                px[size_t(y) * W + x] = r.col | 0xFF000000u;
                hb[size_t(y) * W + x] = r.h;
            }
    }
    // soft rounded blocks: convex corners of colour regions are blended with their neighbours, region edges get a light blend
    {
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
    for (int y = 1; y < W; ++y)
        for (int x = 1; x < W; ++x) {
            size_t i = size_t(y) * W + x;
            if (!(px[i] >> 24)) continue;
            int  h = hb[i], hu = hb[i - W], hl = hb[i - 1];
            bool edge = (hu != INT16_MIN && std::abs(h - hu) >= 2 && h < hu) || (hl != INT16_MIN && std::abs(h - hl) >= 2 && h < hl);
            if (edge) px[i] = shade(px[i], 0.72f);
        }
    // soft fog edge: unknown pixels take fog colour, alpha is blurred so the explored area fades out smoothly
    uint32_t fogRgb = FOG & 0x00FFFFFFu;
    for (auto& p : px)
        if (!(p >> 24)) p = fogRgb;
    bool anyUnknown = false;
    for (size_t i = 0; i < hb.size(); ++i) if (hb[i] == INT16_MIN) { anyUnknown = true; break; }
    if (soft && anyUnknown) blurAlpha(px, W, std::max(2, int(sc * 1.0f)));
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
        t.name[h] = "textures/diorama_bedrock/" + std::string(&t == &gMiniTex ? "mini" : "big") + "_" + std::to_string(W) + "_" + std::to_string(t.gen);
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

void marker(::MinecraftUIRenderContext& ctx, float cx, float cy, float s, float yawDeg) {
    float rad = yawDeg * 3.14159265f / 180.0f;
    float dx = -std::sin(rad), dy = std::cos(rad) * KY;
    for (int t = 1; t <= 3; ++t) {
        float px = cx + dx * s * 1.8f * float(t), py = cy + dy * s * 1.8f * float(t);
        float hs = s * 0.55f;
        rect(ctx, px - hs - 0.8f, py - hs - 0.8f, px + hs + 0.8f, py + hs + 0.8f, ::mce::Color{0, 0, 0, 1});
        rect(ctx, px - hs, py - hs, px + hs, py + hs, ::mce::Color{1.0f, 0.85f, 0.25f, 1.0f});
    }
    rect(ctx, cx - s - 1, cy - s - 1, cx + s + 1, cy + s + 1, ::mce::Color{0.0f, 0.0f, 0.0f, 1.0f});
    rect(ctx, cx - s, cy - s, cx + s, cy + s, ::mce::Color{1.0f, 1.0f, 1.0f, 1.0f});
}

// --- input (polled, edge detected; only while our window is focused) ---
bool gBigMap    = false;
bool gMWasDown  = false;
int  gBigBlocks = 256;
int  gBigBias   = 0;      // extra sampling step when the rectangle budget is exceeded
int  gBigLastBlocks = 256;
constexpr size_t kBigBudget = 60000;
int  gPanX      = 0;
int  gPanZ      = 0;

bool windowFocused() {
    HWND fg = GetForegroundWindow();
    if (!fg) return false;
    DWORD pid = 0;
    GetWindowThreadProcessId(fg, &pid);
    return pid == GetCurrentProcessId();
}

bool down(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }

void pollInput() {
    if (!windowFocused()) { gMWasDown = false; return; }
    bool m = down('M');
    if (m && !gMWasDown) { gBigMap = !gBigMap; gPanX = gPanZ = 0; }
    gMWasDown = m;
    if (!gBigMap) return;
    if (down(VK_OEM_PLUS) || down(VK_ADD)) gBigBlocks = std::max(32, gBigBlocks - 4);
    if (down(VK_OEM_MINUS) || down(VK_SUBTRACT)) gBigBlocks = std::min(768, gBigBlocks + 4);
    int step = std::max(1, gBigBlocks / 60) * (down(VK_SHIFT) ? 3 : 1);
    if (down(VK_LEFT)) gPanX -= step;
    if (down(VK_RIGHT)) gPanX += step;
    if (down(VK_UP)) gPanZ -= step;
    if (down(VK_DOWN)) gPanZ += step;
    if (down(VK_HOME)) gPanX = gPanZ = 0;
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

struct Scroll { float u0, v0, uw, vh, pcx, pcy; int nb, nview, step, cx, cz, h0; bool ready; };

// Window geometry of an already baked map (b) and the smooth target (tx,tz,smoothH): sub-cell scrolling is a UV crop.
Scroll makeScroll(Baked const& b, float tx, float tz, float smoothH) {
    Scroll sc{};
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
    bake(res, j.cx, j.cz, j.h0, j.n, j.step, j.version, j.frame, j.epoch);
    res.view = j.view;
    if (j.epoch && gEpoch.load() != j.epoch) return false;
    rasterize(res, j.W, px, true);
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

void asyncQuiesce() {
    ++gEpoch; // running jobs abort at the next row, queued/finished ones are dropped
    std::unique_lock<std::mutex> lk(gAsyncMx);
    for (auto& s : gSlots) { s.queued = false; s.done = false; }
    gIdleCv.wait(lk, [] { return !gSlots[0].busy && !gSlots[1].busy; });
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

int gH0Mini = 64, gH0Big = 64;
float gSmoothH = -99999.0f;
float gBigSH = -99999.0f;

} // namespace

void shutdown() {
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

void draw(::MinecraftUIRenderContext& ctx, ::IClientInstance& client) {
    ::LocalPlayer* player = client.getLocalPlayer();
    ::BlockSource* region = client.getRegion();
    if (!player || !region) return;
    if (int(region->getDimensionId()) != 0) return; // Overworld only

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

    if (gBigMap) {
        // fullscreen like Java Diorama: map fills the screen, top bar with coords + chunk count, bottom hint
        float size = std::max(sw, sh);
        float x    = (sw - size) * 0.5f;
        float y    = (sh - size) * 0.5f;
        if (gBigBlocks != gBigLastBlocks) { gBigLastBlocks = gBigBlocks; gBigBias = 0; }
        int   step  = std::max(1, (gBigBlocks + 191) / 192) + gBigBias;
        int   nview = std::min(192, gBigBlocks / step) & ~1;
        int   nb    = nview + 32;
        float tx    = gSX + float(gPanX), tz = gSZ + float(gPanZ);
        float sH    = gSY - 1.6f; // eye -> feet
        {
            int g = groundHeight(int(std::floor(tx)), int(std::floor(tz)), gH0Big);
            gH0Big = g;
            if (gBigSH < -1000.0f || gap) gBigSH = float(g);
            gBigSH += (float(g) - gBigSH) * (1.0f - std::exp(-dtf / 0.25f));
            (void)sH;
        }
        if (!gCfgRead) readConfig();
        Scroll sc{};
        bool   texOk = false;
        rect(ctx, 0, 0, sw, sh, toColor(FOG), 1.0f);
        if (gTexEnabled && !gTexFailed) {
            sc = prepareAsync(gSlots[1], gBigTex, client, nb, nview, step, tx, tz, gBigSH, 90, 8);
            if (!gTexFailed) {
                if (!sc.ready) texOk = true; // first bake still running in the background: fog only
                else texOk = drawTexAsync(ctx, gBigTex, x, y, size, sc.u0, sc.v0, sc.uw, sc.vh);
            }
        }
        if (!texOk) {
            // fallback: rectangles (synchronous bake)
            sc = prepareScroll(gBig, nb, nview, step, tx, tz, gBigSH, 90, 8);
            if (gBig.rects.size() > kBigBudget && gBigBias < 6) ++gBigBias;
            float k = size / float(nview);
            drawBaked(ctx, gBig, x - sc.u0 * float(nb) * k, y - sc.v0 * float(nb) * k, k * float(nb));
        }
        // player marker: smoothed position relative to the same view window
        if (sc.ready) {
            float cell = size / float(sc.nview);
            float ppx = float(sc.nb) * 0.5f + (gSX - float(sc.cx)) / float(sc.step);
            float ppy = float(sc.nb) * 0.5f + (gSZ - float(sc.cz)) / float(sc.step) * KY - (gSY - 1.6f - float(sc.h0)) * HS / float(sc.step);
            float mx = x + (ppx - sc.u0 * float(sc.nb)) * cell, my = y + (ppy - sc.v0 * float(sc.nb)) * cell;
            if (mx > 0 && mx < sw && my > 0 && my < sh) marker(ctx, mx, my, 3.5f, yaw);
        }
        // top bar
        float bar = 30.0f;
        rect(ctx, 0, 0, sw, bar, ::mce::Color{0.02f, 0.03f, 0.05f, 1.0f}, 0.72f);
        rect(ctx, 6, 5, 6 + 92, 25, ::mce::Color{0.05f, 0.07f, 0.10f, 1.0f}, 0.95f);
        rect(ctx, 6, 24, 98, 26, ::mce::Color{0.95f, 0.97f, 1.0f, 1.0f}, 1.0f);
        ::mce::Color white{0.95f, 0.97f, 1.0f, 1.0f};
        drawPixText(ctx, "SURFACE", 12, 9, 2.0f, white);
        char info[96];
        std::snprintf(info, sizeof(info), "%d, %d, %d   CHUNKS: %d", px, int(pos.y), pz, int(gCache.size()));
        drawPixText(ctx, info, 120, 9, 2.0f, white);
        // bottom hint
        rect(ctx, 0, sh - 22, sw, sh, ::mce::Color{0.02f, 0.03f, 0.05f, 1.0f}, 0.72f);
        drawPixText(ctx, "ARROWS - MOVE   +/- - ZOOM   HOME - CENTER   M - CLOSE", 8, sh - 16, 2.0f, white);
    } else {
        constexpr float SIZE   = 96.0f;
        constexpr int   VIEW   = 64;          // blocks visible
        constexpr int   NB     = 84;          // blocks baked (10 block margin each side: rare re-bakes)
        float           x      = sw - SIZE - 20.0f;
        float           y      = 22.0f;
        if (gap || gSmoothH < -1000.0f) gSmoothH = float(groundPlayer);
        gSmoothH += (float(groundPlayer) - gSmoothH) * (1.0f - std::exp(-dtf / 0.25f));
        if (!gCfgRead) readConfig();
        gH0Mini = groundPlayer;
        bool drawn = false;
        if (gTexEnabled && !gTexFailed) {
            Scroll sc = prepareAsync(gSlots[0], gMiniTex, client, NB, VIEW, 1, gSX, gSZ, gSmoothH, 24, 6);
            if (!gTexFailed) {
                frame(ctx, x, y, SIZE);
                if (!sc.ready) {
                    vignette(ctx, x, y, SIZE); // first bake still running in the background
                    drawn = true;
                } else if (drawTexAsync(ctx, gMiniTex, x, y, SIZE, sc.u0, sc.v0, sc.uw, sc.vh)) {
                    vignette(ctx, x, y, SIZE);
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
