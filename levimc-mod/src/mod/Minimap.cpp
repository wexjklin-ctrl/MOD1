// Diorama (Bedrock) - minimap + big map (stage 3/4/7 first version).
// Terrain is scanned column by column from the loaded chunks into a persistent cache,
// then drawn as merged horizontal colour runs with MinecraftUIRenderContext::fillRectangle.
// Visual style follows Diorama (MIT, (c) Dara Adedeji): dark frame, relief shading, fog for unknown areas.

#include "mod/Minimap.h"

#include "mc/client/game/IClientInstance.h"
#include "mc/client/player/LocalPlayer.h"
#include "mc/client/renderer/screen/MinecraftUIRenderContext.h"
#include "mc/deps/core/math/Color.h"
#include "mc/deps/input/RectangleArea.h"
#include "mc/world/level/BlockPos.h"
#include "mc/world/level/BlockSource.h"
#include "mc/world/level/Level.h"
#include "mc/world/level/block/Block.h"
#include "mc/world/level/block/BlockType.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cctype>
#include <cstdint>
#include <cstdio>
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

struct ChunkData {
    std::array<uint32_t, 256> color{}; // 0 = unknown, else 0xFFRRGGBB
    std::array<int16_t, 256>  height{};
    bool                      scanned  = false;
    bool                      dirty    = false;
    uint64_t                  lastScan = 0;
    uint64_t                  lastTry  = 0;
};


std::unordered_map<int64_t, ChunkData> gCache;
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

bool scanColumn(::BlockSource& region, int x, int z, uint32_t& col, int16_t& h) {
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
    } else {
        uint32_t rgb = blockRgb(name);
        if (rgb) {
            col = 0xFF000000u | rgb;
        } else {
            ::mce::Color mc = block->getBlockType().getMapColor(region, pos, *block);
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
            if (!scanColumn(region, cx * 16 + lx, cz * 16 + lz, col, h)) continue;
            int idx = lz * 16 + lx;
            if (cd.color[idx] != col || cd.height[idx] != h) {
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
    }
    return true;
}

// Chunk offsets sorted by distance: nearest chunks are scanned first.
std::vector<std::pair<int, int>> const& chunkOffsets() {
    static std::vector<std::pair<int, int>> v = [] {
        constexpr int CR = 8;
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
    int budget = 2; // chunks scanned per frame
    for (auto const& [dx, dz] : chunkOffsets()) {
        if (budget <= 0) break;
        int  cx = pcx + dx, cz = pcz + dz;
        auto& cd = gCache[key(cx, cz)];
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
    f.write("DBM2", 4);
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
        if (!f.read(magic, 4) || std::string(magic, 4) != "DBM2" || !f.read(reinterpret_cast<char*>(&count), 4)) continue;
        for (uint32_t i = 0; i < count && i < 1024; ++i) {
            int       cx = 0, cz = 0;
            ChunkData cd;
            if (!f.read(reinterpret_cast<char*>(&cx), 4) || !f.read(reinterpret_cast<char*>(&cz), 4)) break;
            if (!f.read(reinterpret_cast<char*>(cd.color.data()), 256 * 4)) break;
            if (!f.read(reinterpret_cast<char*>(cd.height.data()), 256 * 2)) break;
            cd.scanned = false; // will be refreshed when the chunk is loaded again
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

void switchWorld(std::string const& k) {
    saveAll();
    gCache.clear();
    gDirtyRegions.clear();
    gWorldKey = k;
    loadWorld();
}

// ---------- oblique "diorama" projection, baked to merged rectangles ----------
// Units: 1 unit = one map cell horizontally. Rows are squashed by KY, heights lift by HS per block.
constexpr float KY = 0.62f;
constexpr float HS = 0.85f;

struct Rect {
    float    x0, y0, x1, y1;
    uint32_t col;
};

struct Baked {
    int                cx = INT32_MIN, cz = INT32_MIN, h0 = INT32_MIN, n = 0, step = 0;
    uint64_t           version = 0, frame = 0;
    std::vector<Rect>  rects;
};

uint32_t shade(uint32_t col, float k) {
    auto m = [k](uint32_t v) { return uint32_t(std::min(255.0f, float(v) * k) + 0.5f); };
    return 0xFF000000u | (m((col >> 16) & 255) << 16) | (m((col >> 8) & 255) << 8) | m(col & 255);
}

bool sample(Sampler& s, int x, int z, uint32_t& col, int& h) {
    ChunkData* c = s.get(x, z);
    if (!c) return false;
    int idx = (z & 15) * 16 + (x & 15);
    if (!c->color[idx]) return false;
    col = c->color[idx];
    h   = c->height[idx];
    return true;
}

int groundHeight(int x, int z, int fallback) {
    Sampler s;
    uint32_t c;
    int      h;
    return sample(s, x, z, c, h) ? h : fallback;
}

void bake(Baked& b, int cx, int cz, int h0, int n, int step) {
    b.cx = cx; b.cz = cz; b.h0 = h0; b.n = n; b.step = step;
    b.version = gVersion; b.frame = gFrame;
    b.rects.clear();
    float hsu = HS / float(step);
    int   rowsHalf = int(float(n) / (2.0f * KY)) + 28;
    int   x0 = cx - (n / 2) * step;
    Sampler s;
    std::vector<uint32_t> col(size_t(n), 0u);
    std::vector<int>      hh(size_t(n), 0), dh(size_t(n), 0);
    for (int j = -rowsHalf; j <= rowsHalf; ++j) {
        int z = cz + j * step;
        for (int i = 0; i < n; ++i) {
            int      x = x0 + i * step;
            uint32_t c = 0, c2 = 0;
            int      h = 0, h2 = 0;
            if (!sample(s, x, z, c, h)) { col[size_t(i)] = 0; continue; }
            col[size_t(i)] = c;
            hh[size_t(i)]  = h;
            int d = 0;
            if (sample(s, x, z + step, c2, h2) && h > h2) d = std::min(h - h2, 48);
            dh[size_t(i)] = d;
        }
        float rowY = float(n) * 0.5f + float(j) * KY;
        int i = 0;
        while (i < n) {
            if (!col[size_t(i)]) { ++i; continue; }
            int e = i + 1;
            while (e < n && col[size_t(e)] == col[size_t(i)] && hh[size_t(e)] == hh[size_t(i)] && dh[size_t(e)] == dh[size_t(i)]) ++e;
            float yTop = rowY - float(hh[size_t(i)] - h0) * hsu;
            float yBot = yTop + KY;
            auto  push = [&](float ya, float yb, uint32_t c) {
                if (yb <= 0.0f || ya >= float(n)) return;
                b.rects.push_back({float(i), std::max(ya, 0.0f), float(e), std::min(yb, float(n)), c});
            };
            push(yTop, yBot, col[size_t(i)]);
            if (dh[size_t(i)] > 0) push(yBot, yBot + float(dh[size_t(i)]) * hsu, shade(col[size_t(i)], 0.62f));
            i = e;
        }
    }
}

void ensureBaked(Baked& b, int cx, int cz, int h0, int n, int step, uint64_t minInterval) {
    bool geom  = b.cx != cx || b.cz != cz || b.h0 != h0 || b.n != n || b.step != step;
    bool dirty = b.version != gVersion && gFrame - b.frame >= minInterval;
    if (geom || dirty) bake(b, cx, cz, h0, n, step);
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
int  gBigBlocks = 160;
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
    if (down(VK_OEM_PLUS) || down(VK_ADD)) gBigBlocks = std::max(32, gBigBlocks - 2);
    if (down(VK_OEM_MINUS) || down(VK_SUBTRACT)) gBigBlocks = std::min(400, gBigBlocks + 2);
    int step = std::max(1, gBigBlocks / 60) * (down(VK_SHIFT) ? 3 : 1);
    if (down(VK_LEFT)) gPanX -= step;
    if (down(VK_RIGHT)) gPanX += step;
    if (down(VK_UP)) gPanZ -= step;
    if (down(VK_DOWN)) gPanZ += step;
    if (down(VK_HOME)) gPanX = gPanZ = 0;
}

int gH0Mini = 64, gH0Big = 64;

} // namespace

void reset() {
    saveAll();
    gCache.clear();
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
        int   step = std::max(1, (gBigBlocks + 111) / 112);
        int   n    = gBigBlocks / step;
        int   cx   = px + gPanX, cz = pz + gPanZ;
        int   h0   = groundHeight(cx, cz, gH0Big);
        gH0Big     = h0;
        ensureBaked(gBig, cx, cz, h0, n, step, 10);
        rect(ctx, 0, 0, sw, sh, toColor(FOG), 1.0f);
        drawBaked(ctx, gBig, x, y, size);
        float cell = size / float(n);
        float ux   = float(n) * 0.5f + (float(pos.x) - float(cx)) / float(step);
        float uy   = float(n) * 0.5f + (float(pos.z) - float(cz)) / float(step) * KY - float(groundPlayer - h0) * HS / float(step);
        float mx = x + ux * cell, my = y + uy * cell;
        if (mx > 0 && mx < sw && my > 0 && my < sh) marker(ctx, mx, my, 3.5f, yaw);
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
        constexpr float SIZE   = 112.0f;
        constexpr int   BLOCKS = 56;
        float           x      = sw - SIZE - 22.0f;
        float           y      = 24.0f;
        gH0Mini                = groundPlayer;
        ensureBaked(gMini, px, pz, groundPlayer, BLOCKS, 1, 6);
        frame(ctx, x, y, SIZE);
        drawBaked(ctx, gMini, x, y, SIZE);
        vignette(ctx, x, y, SIZE);
        float cell = SIZE / float(BLOCKS);
        float ux   = float(BLOCKS) * 0.5f + (float(pos.x) - float(px));
        float uy   = float(BLOCKS) * 0.5f + (float(pos.z) - float(pz)) * KY;
        marker(ctx, x + ux * cell, y + uy * cell, 1.5f, yaw);
        compassLetter(ctx, 'N', x + SIZE / 2, y - 10, true);
        compassLetter(ctx, 'S', x + SIZE / 2, y + SIZE + 10, false);
        compassLetter(ctx, 'W', x - 10, y + SIZE / 2, false);
        compassLetter(ctx, 'E', x + SIZE + 10, y + SIZE / 2, false);
    }
}

} // namespace diorama_bedrock::minimap
