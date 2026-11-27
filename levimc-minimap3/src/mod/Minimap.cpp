// Diorama (Bedrock) - minimap + big map (stage 3/4/7 first version).
// Terrain is scanned column by column from the loaded chunks into a persistent cache,
// then drawn as merged horizontal colour runs with MinecraftUIRenderContext::fillRectangle.
// Visual style follows Diorama (MIT, (c) Dara Adedeji): dark frame, relief shading, fog for unknown areas.

#include "ll/api/service/ServerInfo.h"
#include <climits>
#include <unordered_map>
#include "mod/VanillaColors.h"
#include <set>
#include <sstream>
#include "mod/GpuHook.h"
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
#include "mc/world/level/ChunkBlockPos.h"
#include "mc/world/level/chunk/LevelChunk.h"
#include "mc/world/level/Level.h"
#include "mc/world/level/block/Block.h"
#include "mc/world/level/block/BlockType.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <condition_variable>
#include <deque>
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

constexpr uint32_t FOG = 0xFFD2D7E4u; // white fog of war (unexplored / not saved)

// Wall profile: colour of the block at (top - depth) for each depth; used to paint real building/cliff faces.
constexpr int NW = 96; // per-block wall profile down to 96 blocks below the top (tall buildings keep every floor and window)
struct IdDepth { constexpr int operator[](int k) const { return k; } };
constexpr IdDepth kWallDepth{}; // depth of profile entry k is k

// Wall profile of one chunk, stored sparsely (minimap3). Per column only the explicit entries are kept: len bits 0..6 = count,
// bit 7 = the tail repeats the last explicit entry (otherwise the tail is 0 = air). Immutable once published: a rescan builds a new
// blob and swaps the pointer, so bake threads always see one consistent version.
struct WallBlob {
    std::array<uint16_t, 256> off{};
    std::array<uint8_t, 256>  len{};
    std::vector<uint8_t>      bytes;
};
struct ChunkData {
    std::array<uint32_t, 256> color{}; // 0 = unknown, else 0xFFRRGGBB
    std::array<int16_t, 256>  height{};
    std::shared_ptr<WallBlob> walls;   // palette index per (column, depth); null = no walls yet
    std::array<uint32_t, 256>     pal{};    // per-chunk palette of wall colours (+shape in alpha); pal[0] = 0 (air)
    int                           palN = 1;
    bool                      scanned  = false;
    bool                      dirty    = false;
    uint64_t                  lastScan = 0;
    uint64_t                  lastTry  = 0;
    uint8_t                   partial  = 0; // scans that found the chunk only partly loaded
    uint8_t                   lastNok  = 0; // columns found by the previous partial scan (retry only while this grows)
};

inline bool colsKnown(uint32_t const* c) { int n = 0; for (int q = 0; q < 256; ++q) n += c[q] != 0; return n >= 200; }

inline uint8_t const kZeroByte = 0;
struct WRef { // view of one column's wall profile
    uint8_t const*  id  = nullptr;
    uint32_t const* pal = nullptr;
    uint8_t         len = 0;
    explicit operator bool() const { return id != nullptr; }
    uint32_t operator[](int k) const {
        int n = len & 0x7F;
        if (k < n) return pal[id[k]];
        return ((len & 0x80) && n) ? pal[id[n - 1]] : 0u;
    }
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
// colour profile of one column -> palette ids (ids[NW])
void encodeColumn(ChunkData& cd, uint32_t const* w, uint8_t* ids) {
    for (int k = 0; k < NW; ++k) {
        if (k > 0 && w[k] == w[k - 1]) { ids[k] = ids[k - 1]; continue; }
        ids[k] = encodePal(cd, w[k]);
    }
}
// ids[NW] -> canonical compact form: appends the explicit entries to dst, returns the len byte
uint8_t compactColumn(uint8_t const* ids, std::vector<uint8_t>& dst) {
    uint8_t last = ids[NW - 1];
    int     m    = NW - 1;
    while (m > 0 && ids[m - 1] == last) --m; // ids[m..NW-1] all equal `last`
    int n = last == 0 ? m : m + 1;
    for (int k = 0; k < n; ++k) dst.push_back(ids[k]);
    return uint8_t(n | (last != 0 ? 0x80 : 0));
}
void expandColumn(WallBlob const* b, int idx, uint8_t* out) {
    std::memset(out, 0, NW);
    if (!b) return;
    int     n    = b->len[idx] & 0x7F;
    uint8_t const* src = b->bytes.data() + b->off[idx];
    for (int k = 0; k < n; ++k) out[k] = src[k];
    if ((b->len[idx] & 0x80) && n) for (int k = n; k < NW; ++k) out[k] = src[n - 1];
}

std::unordered_map<int64_t, ChunkData> gCache;
// Chunks with map data (fog + counter), independent of what is in RAM. One 1024-bit mask per 32x32-chunk region instead of a hash node
// per chunk (~48 B -> 0.125 B per chunk), so even a huge explored world costs little RAM.
class KnownSet {
    std::unordered_map<int64_t, std::array<uint64_t, 16>> m_;
    size_t                                                n_ = 0;
    static void split(int64_t k, int64_t& rk, int& bit) {
        int cx = int(int32_t(uint32_t(uint64_t(k) >> 32))), cz = int(int32_t(uint32_t(uint64_t(k) & 0xFFFFFFFFu)));
        rk  = (int64_t(cx >> 5) << 32) ^ int64_t(uint32_t(cz >> 5));
        bit = ((cz & 31) << 5) | (cx & 31);
    }
public:
    struct Res { bool second; };
    Res insert(int64_t k) {
        int64_t rk; int bit; split(k, rk, bit);
        auto& a = m_[rk];
        uint64_t& w = a[size_t(bit >> 6)]; uint64_t b = uint64_t(1) << (bit & 63);
        if (w & b) return {false};
        w |= b; ++n_; return {true};
    }
    size_t erase(int64_t k) {
        int64_t rk; int bit; split(k, rk, bit);
        auto it = m_.find(rk);
        if (it == m_.end()) return 0;
        uint64_t& w = it->second[size_t(bit >> 6)]; uint64_t b = uint64_t(1) << (bit & 63);
        if (!(w & b)) return 0;
        w &= ~b; --n_;
        bool empty = true; for (uint64_t x : it->second) if (x) { empty = false; break; }
        if (empty) m_.erase(it);
        return 1;
    }
    size_t count(int64_t k) const {
        int64_t rk; int bit; split(k, rk, bit);
        auto it = m_.find(rk);
        return it != m_.end() && ((it->second[size_t(bit >> 6)] >> (bit & 63)) & 1u) ? 1 : 0;
    }
    size_t size() const { return n_; }
    size_t bytes() const { return m_.size() * (sizeof(std::array<uint64_t, 16>) + 64); }
    void   clear() { m_.clear(); n_ = 0; }
    template <class F> void forEach(F&& f) const {
        for (auto const& kv : m_) {
            int rcx = int(int32_t(uint32_t(uint64_t(kv.first) >> 32))), rcz = int(int32_t(uint32_t(uint64_t(kv.first) & 0xFFFFFFFFu)));
            for (int bit = 0; bit < 1024; ++bit)
                if ((kv.second[size_t(bit >> 6)] >> (bit & 63)) & 1u) {
                    int cx = (rcx << 5) | (bit & 31), cz = (rcz << 5) | (bit >> 5);
                    f((int64_t(cx) << 32) ^ int64_t(uint32_t(cz)));
                }
        }
    }
};
KnownSet                               gKnown;
std::unordered_map<int64_t, uint64_t>  gRegions;      // regions currently loaded into gCache -> last use frame (main thread only)
std::unordered_set<int64_t>            gDiskRegions;  // region files that exist on disk
std::vector<std::pair<int, int>>       gLegacyPending; // regions without an .idx sidecar: loaded once to build it
std::unordered_set<int64_t>            gTileDisk;     // tile images that exist on disk
size_t                                 gRegionCap = 6, gTexCap = 56, gPxCap = 48; // minimap3: caps adjusted at run time by the memory governor (budget 500 MB)
int64_t tkey(int l, int i, int j);
bool    regionReady(int rx, int rz, bool allowLoad);
bool    loadingBusy();
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

// Replaced wall blobs stay alive for a while: a bake thread may still hold a pointer into one (freed from the main thread, ~10 s later).
std::vector<std::pair<uint64_t, std::shared_ptr<WallBlob>>> gRetiredWalls;
void pumpRetiredWalls() {
    if (gRetiredWalls.empty()) return;
    size_t w = 0;
    for (size_t i = 0; i < gRetiredWalls.size(); ++i)
        if (gFrame - gRetiredWalls[i].first <= 600) { if (w != i) gRetiredWalls[w] = std::move(gRetiredWalls[i]); ++w; }
    gRetiredWalls.resize(w);
}
// Builds the compact walls of a chunk from freshly scanned columns (ok[idx]; the rest keep their old profile).
// colChanged[idx] = this column's profile differs from the stored one. Returns true when anything changed.
bool commitWalls(ChunkData& cd, uint8_t const* ids, bool const* ok, bool* colChanged) {
    WallBlob const* old = cd.walls.get();
    auto            nb  = std::make_shared<WallBlob>();
    nb->bytes.reserve(size_t(256) * 28);
    uint8_t tmp[NW];
    bool    any = false;
    for (int idx = 0; idx < 256; ++idx) {
        uint8_t const* src;
        if (ok[idx]) src = ids + size_t(idx) * NW;
        else { expandColumn(old, idx, tmp); src = tmp; }
        size_t before = nb->bytes.size();
        nb->off[size_t(idx)] = uint16_t(before);
        nb->len[size_t(idx)] = compactColumn(src, nb->bytes);
        bool ch = ok[idx];
        if (old) {
            int n = nb->len[size_t(idx)] & 0x7F;
            ch = ok[idx] && (old->len[size_t(idx)] != nb->len[size_t(idx)] ||
                             std::memcmp(old->bytes.data() + old->off[size_t(idx)], nb->bytes.data() + before, size_t(n)) != 0);
        }
        colChanged[idx] = ch;
        any |= ch;
    }
    if (!any && old) return false;
    nb->bytes.shrink_to_fit();
    if (cd.walls) gRetiredWalls.emplace_back(gFrame, std::move(cd.walls));
    cd.walls = std::move(nb);
    return true;
}
// whole chunk from 256 x NW palette ids (disk format)
void setWallsFromFull(ChunkData& cd, uint8_t const* full) {
    bool ok[256], ch[256];
    for (int i = 0; i < 256; ++i) ok[i] = true;
    cd.walls.reset();
    commitWalls(cd, full, ok, ch);
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
        for (int i = 0; i < minimap3::vanilla::kBlockCount; ++i) r[minimap3::vanilla::kBlocks[i].name] = minimap3::vanilla::kBlocks[i].look;
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
    if (kind == 1) return minimap3::vanilla::kMap_grass[y * 64 + x];
    if (kind == 2) return minimap3::vanilla::kMap_foliage[y * 64 + x];
    if (kind == 3) return minimap3::vanilla::kMap_dry_foliage[y * 64 + x];
    if (kind == 4) return 0x3F76E4;
    return 0xFFFFFF;
}
// returns 0 when the block is not in the table
uint32_t vanillaRgb(std::string const& bedrockName, bool side) {
    auto& idx = vanillaIndex();
    auto  it  = idx.find(bedrockToJava(bedrockName));
    if (it == idx.end()) return 0;
    auto const& L = minimap3::vanilla::kLooks[it->second];
    if (L.kind == 0) return 0;
    if (L.kind == 2 && bedrockName.find("water") == std::string::npos && bedrockName.find("bubble") == std::string::npos) return 0; // Java table maps walls/signs/rails to the water look: ignore, use name colours
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
        uint32_t kw = 0;
        {
            auto has = [&](char const* t) { return name.find(t) != std::string::npos; };
            if (has("mossy_stone_brick")) kw = 0x6F7B5C; else if (has("mossy")) kw = 0x6B7D4F;
            else if (has("red_nether_brick")) kw = 0x450709; else if (has("nether_brick")) kw = 0x2C151A;
            else if (has("end_stone_brick")) kw = 0xDBDE9E; else if (has("mud_brick")) kw = 0x8B6B53;
            else if (has("deepslate")) kw = 0x4B4B50; else if (has("blackstone")) kw = 0x2A2328; else if (has("prismarine")) kw = 0x63A194;
            else if (has("granite")) kw = 0x95674F; else if (has("diorite")) kw = 0xBFBFC1; else if (has("andesite")) kw = 0x888889;
            else if (has("tuff")) kw = 0x6C6D67; else if (has("red_sandstone")) kw = 0xBA6A1E; else if (has("sandstone")) kw = 0xDBCF9D;
            else if (has("stone_brick") || has("stonebrick")) kw = 0x7B7B7B; else if (has("brick")) kw = 0x96513F; else if (has("cobble")) kw = 0x7A7A7A;
            else if (has("fence") || has("planks")) kw = 0x9C7F4E;
            else if (has("_wall") && !has("wall_")) kw = 0x7A7A7A;
        }
        if (kw) { gBlockCol[&block] = 0xFF000000u | kw; logUnmapped(name, 0xFF000000u | kw); return 0xFF000000u | kw; }
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
    if ((n.find("fence") != std::string::npos) || (n.find("_wall") != std::string::npos && n.find("wall_") == std::string::npos) || n.find("iron_bars") != std::string::npos) return 0xE3; // thin post
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

// per-block-state classification cache: no string work per block in the hot scan loop
struct BlkInfo { uint8_t kind; uint32_t side; }; // kind: 0 solid, 1 skip (air/water/small plant)
std::unordered_map<::Block const*, BlkInfo> gBlkInfo;
BlkInfo const& blkInfo(::BlockSource& region, ::BlockPos const& p, ::Block const& b) {
    auto it = gBlkInfo.find(&b);
    if (it != gBlkInfo.end()) return it->second;
    BlkInfo bi{0, 0};
    if (b.isAir()) bi.kind = 1;
    else {
        std::string const& n = b.getTypeName();
        if (isWater(n) || isSmallPlant(n)) bi.kind = 1;
        else bi.side = withShape(colorOfBlockSide(region, p, b), shapeAlpha(n));
    }
    return gBlkInfo.emplace(&b, bi).first->second;
}
constexpr int kScanFloorY = 50; // do not scan below this (caves / mines are not shown)

// need < 0: only colour/height (cheap); else also the wall profile down to `need` blocks (deeper entries repeat the last colour)
bool scanColumn(::BlockSource& region, int x, int z, uint32_t& col, int16_t& h, uint32_t* wall, int need, ::LevelChunk* lc = nullptr) {
    int minH = region.getMinHeight();
    // read blocks straight from the chunk (no BlockSource chunk lookup per block)
    auto getB = [&](::BlockPos const& p) -> ::Block const& {
        if (lc && p.y >= minH && p.y < minH + 384) return lc->getBlock(::ChunkBlockPos(p, short(minH)));
        return region.getBlock(p);
    };
    int y    = int(region.getAboveTopSolidBlock(x, z, true, true)) - 1;
    if (y < minH) return false;
    ::BlockPos pos{x, y, z};
    ::Block const* block = &getB(pos);
    for (int guard = 0; block->isAir() && y > minH && guard < 24; ++guard) {
        --y;
        pos   = ::BlockPos{x, y, z};
        block = &getB(pos);
    }
    if (block->isAir()) return false;

    std::string const& name = block->getTypeName();
    if (isWater(name)) {
        int depth = 0;
        for (int yy = y - 1; depth < 6 && yy > minH; --yy) {
            ::BlockPos p2{x, yy, z};
            if (!isWater(getB(p2).getTypeName())) break;
            ++depth;
        }
        float k = 1.0f - float(depth) * 0.08f;
        col     = pack(0.16f * k, 0.34f * k, 0.84f * k);
        if (wall) for (int k2 = 0; k2 < NW; ++k2) wall[k2] = col;
    } else {
        col = colorOfBlock(region, pos, *block);
        if (wall) {
            int floorY    = std::min(kScanFloorY, y - 3); // columns whose top is already low still get a short profile
            wall[0]       = blkInfo(region, pos, *block).kind ? withShape(colorOfBlockSide(region, pos, *block), shapeAlpha(name)) : blkInfo(region, pos, *block).side;
            uint32_t prev = wall[0];
            for (int k = 1; k < NW; ++k) {
                int yy = y - k;
                if (k > need || yy < minH || yy < floorY) { wall[k] = 0u; continue; }
                ::BlockPos p2{x, yy, z};
                ::Block const& b2 = getB(p2);
                BlkInfo const& bi = blkInfo(region, p2, b2);
                if (bi.kind) { wall[k] = 0u; continue; } // 0 = air gap (open window, space under a roof or canopy)
                prev    = bi.side;
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
    ::LevelChunk* lc = region.getChunkAt(probe);
    // pass 1: colour + height of every column (cheap)
    uint32_t cols[256]; int16_t hs[256]; bool ok[256];
    for (int lz = 0; lz < 16; ++lz)
        for (int lx = 0; lx < 16; ++lx) {
            int idx = lz * 16 + lx;
            ok[idx] = scanColumn(region, cx * 16 + lx, cz * 16 + lz, cols[idx], hs[idx], nullptr, -1, lc);
        }
    int chunkMinH = INT_MAX;
    for (int q = 0; q < 256; ++q) if (ok[q]) chunkMinH = std::min(chunkMinH, int(hs[q]));
    // pass 2: wall profile, only as deep as the wall below the column can be seen (height difference to the southern neighbour)
    static thread_local std::vector<uint8_t> idsBuf;
    idsBuf.assign(size_t(256) * NW, 0);
    bool     okc[256] = {}; uint32_t ncol[256] = {}; int16_t nh[256] = {};
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
            if (int(hs[idx]) - hSouth >= 3 || int(hs[idx]) - chunkMinH >= 6) need = NW - 1; // facades, cliffs, trees: full depth (balconies hide gaps below the south neighbour's top)
            else need = std::max(need, 24);
            uint32_t col = 0; int16_t h = 0;
            uint32_t w[NW];
            if (!scanColumn(region, cx * 16 + lx, cz * 16 + lz, col, h, w, need, lc)) continue;
            encodeColumn(cd, w, &idsBuf[size_t(idx) * NW]);
            okc[idx] = true; ncol[idx] = col; nh[idx] = h;
        }
    }
    {   // sparse wall storage: one rebuild per chunk, only when some profile really changed
        bool wch[256];
        commitWalls(cd, idsBuf.data(), okc, wch);
        for (int idx = 0; idx < 256; ++idx) {
            if (!okc[idx]) continue;
            if (cd.color[idx] != ncol[idx] || cd.height[idx] != nh[idx] || wch[idx]) {
                cd.color[idx]  = ncol[idx];
                cd.height[idx] = nh[idx];
                changed        = true;
                cd.dirty       = true;
            }
        }
    }
    {   // a chunk the client only received partly (fast flight) must be retried soon, not after 600-3600 frames
        int nok = 0;
        for (int q = 0; q < 256; ++q) nok += ok[q] ? 1 : 0;
        // retry only while each scan finds more columns (a chunk that never gets complete must not be rescanned forever)
        if (nok < 240 && cd.partial < 6 && (cd.partial == 0 || nok > int(cd.lastNok))) { ++cd.partial; cd.scanned = false; }
        else cd.scanned = true;
        cd.lastNok = uint8_t(std::min(nok, 255));
    }
    cd.lastScan = gFrame;
    {
        bool any = false;
        any = colsKnown(cd.color.data());
        if (any) { std::lock_guard<std::mutex> lk(gMapMx); if (gKnown.insert(key(cx, cz)).second) markDirty(cx, cz); }
    }
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
    // time budget instead of a fixed chunk count: new chunks appear much faster when scanning is cheap, frames stay short when it is not
    LARGE_INTEGER qf, q0;
    QueryPerformanceFrequency(&qf);
    QueryPerformanceCounter(&q0);
    double kBudgetMs = loadingBusy() ? 1.2 : 3.0; // keep frames short while the saved map streams in
    int              budget    = 24;
    // pass 0: chunks never scanned (retried every 8 frames: while flying fast the client keeps a chunk only briefly);
    // pass 1: rescans of known chunks, only with the budget that is left
    for (int pass = 0; pass < 2; ++pass)
        for (auto const& [dx, dz] : chunkOffsets()) {
            if (budget <= 0) return;
            {
                LARGE_INTEGER qn;
                QueryPerformanceCounter(&qn);
                if (double(qn.QuadPart - q0.QuadPart) * 1000.0 / double(qf.QuadPart) > kBudgetMs) return;
            }
            int cx = pcx + dx, cz = pcz + dz;
            if (!regionReady(cx >> 5, cz >> 5, true)) continue; // never create chunks in a region that is not loaded (the file would be overwritten)
            ChunkData* cdp;
            {
                std::lock_guard<std::mutex> lk(gMapMx);
                cdp = &gCache[key(cx, cz)];
            }
            auto& cd = *cdp;
            if ((pass == 0) == cd.scanned) continue;
            bool need = cd.scanned ? (gFrame - cd.lastScan >= (dx * dx + dz * dz <= 36 ? 600u : 3600u)) : (gFrame - cd.lastTry >= (cd.partial ? 24u : 8u) || cd.lastTry == 0);
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
    gRoot = base / "minimap3";
    return gRoot;
}

std::filesystem::path worldDir() { return rootDir() / gWorldKey; }

// the same perf:/mem: lines also go to %APPDATA%\minimap3\mem.log (own file, easy to find; cut when it passes 1 MB)
void fileLog(std::string const& m) {
    try {
        auto p = rootDir() / "mem.log";
        std::error_code ec;
        auto sz = std::filesystem::exists(p, ec) ? std::filesystem::file_size(p, ec) : 0;
        std::ofstream f(p, (sz > (1u << 20)) ? std::ios::trunc : std::ios::app);
        f << GetTickCount64() / 1000 << "s " << m << "\n";
    } catch (...) {}
}

std::filesystem::path regionFile(int rx, int rz) {
    return worldDir() / ("r." + std::to_string(rx) + "." + std::to_string(rz) + ".bin");
}

// ---- byte-oriented LZ4 block codec (regions and tile images are stored compressed) ----
std::vector<uint8_t> lz4Compress(uint8_t const* src, size_t n) {
    std::vector<uint8_t> out;
    out.reserve(n / 2 + 64);
    std::vector<int32_t> ht(1u << 14, -1);
    auto rd32  = [&](size_t p) { uint32_t v; std::memcpy(&v, src + p, 4); return v; };
    auto hashf = [](uint32_t v) { return (v * 2654435761u) >> (32 - 14); };
    auto emitLen = [&](size_t len) { while (len >= 255) { out.push_back(255); len -= 255; } out.push_back(uint8_t(len)); };
    size_t ip = 0, anchor = 0;
    if (n >= 13) {
        size_t limit = n - 12;
        while (ip < limit) {
            uint32_t h = hashf(rd32(ip));
            int32_t  ref = ht[h];
            ht[h] = int32_t(ip);
            if (ref >= 0 && ip - size_t(ref) < 65536 && rd32(size_t(ref)) == rd32(ip)) {
                size_t ml = 4, maxm = n - 5 - ip;
                while (ml < maxm && src[size_t(ref) + ml] == src[ip + ml]) ++ml;
                size_t lit = ip - anchor, mlc = ml - 4;
                out.push_back(uint8_t(((lit >= 15 ? 15 : lit) << 4) | (mlc >= 15 ? 15 : mlc)));
                if (lit >= 15) emitLen(lit - 15);
                out.insert(out.end(), src + anchor, src + ip);
                uint16_t off = uint16_t(ip - size_t(ref));
                out.push_back(uint8_t(off & 255)); out.push_back(uint8_t(off >> 8));
                if (mlc >= 15) emitLen(mlc - 15);
                ip += ml; anchor = ip;
            } else ++ip;
        }
    }
    size_t lit = n - anchor;
    out.push_back(uint8_t((lit >= 15 ? 15 : lit) << 4));
    if (lit >= 15) emitLen(lit - 15);
    out.insert(out.end(), src + anchor, src + n);
    return out;
}

bool lz4Decompress(uint8_t const* src, size_t cn, uint8_t* dst, size_t rawN) {
    size_t ip = 0, op = 0;
    while (ip < cn) {
        uint8_t tok = src[ip++];
        size_t  lit = tok >> 4;
        if (lit == 15) { uint8_t b; do { if (ip >= cn) return false; b = src[ip++]; lit += b; } while (b == 255); }
        if (ip + lit > cn || op + lit > rawN) return false;
        std::memcpy(dst + op, src + ip, lit); ip += lit; op += lit;
        if (ip >= cn) break;
        if (ip + 2 > cn) return false;
        size_t off = size_t(src[ip]) | (size_t(src[ip + 1]) << 8); ip += 2;
        if (off == 0 || off > op) return false;
        size_t ml = tok & 15;
        if (ml == 15) { uint8_t b; do { if (ip >= cn) return false; b = src[ip++]; ml += b; } while (b == 255); }
        ml += 4;
        if (op + ml > rawN) return false;
        for (size_t k = 0; k < ml; ++k) { dst[op] = dst[op - off]; ++op; }
    }
    return op == rawN;
}

std::filesystem::path regionIdxFile(int rx, int rz) {
    return worldDir() / ("r." + std::to_string(rx) + "." + std::to_string(rz) + ".idx");
}

void putBytes(std::vector<uint8_t>& v, void const* p, size_t n) {
    auto const* b = static_cast<uint8_t const*>(p);
    v.insert(v.end(), b, b + n);
}

// DBM7: header (magic, chunk count, raw size, compressed size) + one LZ4 block holding the DBM6 chunk records.
// Next to it r.X.Z.idx: 1024-bit map of the chunks that have data, so the "known chunks" list loads without reading the region.
struct RegionRaw { std::vector<uint8_t> raw; uint32_t count = 0; uint8_t idx[128] = {}; };

void buildRegionRaw(int rx, int rz, std::function<ChunkData*(int, int)> const& get, RegionRaw& out) {
    out.raw.clear();
    out.raw.reserve(size_t(4) << 20);
    out.count = 0;
    std::memset(out.idx, 0, sizeof(out.idx));
    for (int dz = 0; dz < 32; ++dz)
        for (int dx = 0; dx < 32; ++dx) {
            int  cx = rx * 32 + dx, cz = rz * 32 + dz;
            ChunkData* cp = get(cx, cz);
            if (!cp) continue;
            ChunkData& cd = *cp;
            ++out.count;
            putBytes(out.raw, &cx, 4); putBytes(out.raw, &cz, 4);
            putBytes(out.raw, cd.color.data(), 256 * 4);
            putBytes(out.raw, cd.height.data(), 256 * 2);
            uint16_t pn = uint16_t(cd.palN);
            putBytes(out.raw, &pn, 2);
            putBytes(out.raw, cd.pal.data(), size_t(pn) * 4);
            {   // disk format stays the full 256 x NW ids (LZ4 squeezes the repeats); expand the sparse columns
                size_t at = out.raw.size();
                out.raw.resize(at + size_t(256) * NW);
                for (int q = 0; q < 256; ++q) expandColumn(cd.walls.get(), q, &out.raw[at + size_t(q) * NW]);
            }
            cd.dirty = false;
            if (colsKnown(cd.color.data())) { int bit = dz * 32 + dx; out.idx[bit >> 3] |= uint8_t(1u << (bit & 7)); }
        }
}

// compress + write (safe on any thread: only touches the given paths)
bool writeRegionRaw(std::filesystem::path const& path, std::filesystem::path const& idxPath, RegionRaw const& r) {
    std::error_code      ec;
    std::vector<uint8_t> comp = lz4Compress(r.raw.data(), r.raw.size());
    auto                 tmp  = path; tmp += ".tmp";
    {
        std::ofstream f(tmp, std::ios::binary | std::ios::trunc);
        if (!f) return false;
        uint32_t rs = uint32_t(r.raw.size()), cs = uint32_t(comp.size());
        f.write("DBM7", 4);
        f.write(reinterpret_cast<char const*>(&r.count), 4);
        f.write(reinterpret_cast<char const*>(&rs), 4);
        f.write(reinterpret_cast<char const*>(&cs), 4);
        f.write(reinterpret_cast<char const*>(comp.data()), std::streamsize(comp.size()));
        if (!f) return false;
    }
    std::filesystem::rename(tmp, path, ec);
    if (ec) return false;
    std::ofstream f(idxPath, std::ios::binary | std::ios::trunc);
    if (f) f.write(reinterpret_cast<char const*>(r.idx), 128);
    return true;
}

bool writeRegion(int rx, int rz, std::function<ChunkData*(int, int)> const& get) {
    if (gWorldKey.empty()) return false;
    std::error_code ec;
    std::filesystem::create_directories(worldDir(), ec);
    RegionRaw r;
    buildRegionRaw(rx, rz, get, r);
    return writeRegionRaw(regionFile(rx, rz), regionIdxFile(rx, rz), r);
}

// ---- background writer for the periodic saves (the render thread only copies the chunk data) ----
struct SaveJob { std::filesystem::path bin, idx; RegionRaw r; };
struct Saver {
    std::mutex              mx;
    std::condition_variable cv;
    std::deque<SaveJob>     q;
    bool                    busy = false, started = false;
};
Saver gSaver;

void saverMain() {
    for (;;) {
        SaveJob j;
        {
            std::unique_lock<std::mutex> lk(gSaver.mx);
            gSaver.cv.wait(lk, [] { return !gSaver.q.empty(); });
            j = std::move(gSaver.q.front()); gSaver.q.pop_front();
            gSaver.busy = true;
        }
        try { writeRegionRaw(j.bin, j.idx, j.r); } catch (...) {}
        std::lock_guard<std::mutex> lk(gSaver.mx);
        gSaver.busy = false;
    }
}

void saverDrain() { // wait until every queued write has reached the disk
    for (;;) {
        {
            std::lock_guard<std::mutex> lk(gSaver.mx);
            if (gSaver.q.empty() && !gSaver.busy) return;
        }
        Sleep(1);
    }
}

void saveRegionAsync(int rx, int rz) {
    if (gWorldKey.empty()) return;
    std::error_code ec;
    std::filesystem::create_directories(worldDir(), ec);
    SaveJob j;
    j.bin = regionFile(rx, rz); j.idx = regionIdxFile(rx, rz);
    buildRegionRaw(rx, rz, [](int cx, int cz) -> ChunkData* { auto it = gCache.find(key(cx, cz)); return it == gCache.end() ? nullptr : &it->second; }, j.r);
    gDiskRegions.insert(key(rx, rz));
    {
        std::lock_guard<std::mutex> lk(gSaver.mx);
        gSaver.q.push_back(std::move(j));
        if (!gSaver.started) { gSaver.started = true; std::thread(saverMain).detach(); }
    }
    gSaver.cv.notify_one();
}

void saveRegion(int rx, int rz) {
    if (writeRegion(rx, rz, [](int cx, int cz) -> ChunkData* { auto it = gCache.find(key(cx, cz)); return it == gCache.end() ? nullptr : &it->second; })) gDiskRegions.insert(key(rx, rz));
}

void saveAll() {
    saverDrain();
    for (int64_t k : gDirtyRegions) {
        int rx = int(k >> 32), rz = int(int32_t(uint32_t(k & 0xFFFFFFFFu)));
        if (gRegions.count(k)) saveRegion(rx, rz); // only regions that are in RAM can be dirty
    }
    gDirtyRegions.clear();
}

void markTilesForChunk(int cx, int cz, bool init);
using ChunkSink = std::unordered_map<int64_t, ChunkData>;
void loadRegionStream(std::istream& f, char ver, uint32_t count, ChunkSink* sink = nullptr) {
    for (uint32_t i = 0; i < count && i < 1024; ++i) {
        int       cx = 0, cz = 0;
        ChunkData cd;
        if (!f.read(reinterpret_cast<char*>(&cx), 4) || !f.read(reinterpret_cast<char*>(&cz), 4)) break;
        if (!f.read(reinterpret_cast<char*>(cd.color.data()), 256 * 4)) break;
        if (!f.read(reinterpret_cast<char*>(cd.height.data()), 256 * 2)) break;
        if (ver >= '6') {
            uint16_t pn = 0;
            if (!f.read(reinterpret_cast<char*>(&pn), 2) || pn < 1 || pn > 255) break;
            if (!f.read(reinterpret_cast<char*>(cd.pal.data()), pn * 4)) break;
            std::vector<uint8_t> full(size_t(256) * NW);
            if (!f.read(reinterpret_cast<char*>(full.data()), std::streamsize(full.size()))) break;
            cd.palN = pn;
            setWallsFromFull(cd, full.data());
        } else {
            // old formats: wall profile of 32/16/8 u32 entries per column; convert (top colour for the whole depth when unknown)
            int oldN = ver == '5' ? 32 : (ver == '4' ? 16 : (ver == '3' ? 8 : 0));
            static constexpr int d5[32] = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 26, 29, 32, 36, 40, 48, 56, 64};
            static constexpr int d4[16] = {0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 17, 21, 26, 32};
            static constexpr int d3[8]  = {0, 1, 2, 4, 7, 11, 16, 24};
            std::vector<uint32_t> old(size_t(256) * size_t(std::max(oldN, 1)), 0u);
            if (oldN && !f.read(reinterpret_cast<char*>(old.data()), std::streamsize(old.size() * 4))) break;
            int const* dt = oldN == 32 ? d5 : (oldN == 16 ? d4 : d3);
            std::vector<uint8_t> fullIds(size_t(256) * NW, 0);
            for (int i2 = 0; i2 < 256; ++i2) {
                uint32_t w[NW];
                for (int k = 0; k < NW; ++k) {
                    if (!oldN) { w[k] = cd.color[i2]; continue; }
                    int o = 0;
                    while (o + 1 < oldN && dt[o + 1] <= k) ++o;
                    w[k] = old[size_t(i2) * size_t(oldN) + size_t(o)];
                }
                encodeColumn(cd, w, &fullIds[size_t(i2) * NW]);
            }
            setWallsFromFull(cd, fullIds.data());
        }
        cd.scanned = false; // will be refreshed when the chunk is loaded again
        bool any = false;
        any = colsKnown(cd.color.data());
        if (sink) { (*sink)[key(cx, cz)] = std::move(cd); continue; }
        std::lock_guard<std::mutex> lk(gMapMx);
        if (gCache.emplace(key(cx, cz), std::move(cd)).second && any) gKnown.insert(key(cx, cz));
    }
}

bool loadRegionFile(int rx, int rz, ChunkSink* sink = nullptr) {
    std::ifstream f(regionFile(rx, rz), std::ios::binary);
    char          magic[4] = {};
    uint32_t      count    = 0;
    if (!f.read(magic, 4) || std::string(magic, 3) != "DBM" || magic[3] < '2' || magic[3] > '7' || !f.read(reinterpret_cast<char*>(&count), 4)) return false;
    if (magic[3] == '7') {
        uint32_t rs = 0, cs = 0;
        if (!f.read(reinterpret_cast<char*>(&rs), 4) || !f.read(reinterpret_cast<char*>(&cs), 4) || rs > (1u << 28) || cs > (1u << 28)) return false;
        std::vector<uint8_t> comp(cs);
        if (!f.read(reinterpret_cast<char*>(comp.data()), std::streamsize(cs))) return false;
        std::string raw(rs, '\0');
        if (!lz4Decompress(comp.data(), cs, reinterpret_cast<uint8_t*>(raw.data()), rs)) return false;
        std::istringstream is(std::move(raw), std::ios::binary);
        loadRegionStream(is, '7', count, sink);
    } else loadRegionStream(f, magic[3], count, sink);
    return true;
}

// Old-format regions (no .idx): converted by a background thread (read, parse, rewrite compressed + .idx), never on the render thread.
struct MigState {
    std::mutex              mx;
    std::condition_variable cv;
    bool                    have = false, stop = false;
    int                     rx = 0, rz = 0;
    std::vector<int64_t>    known;
    std::thread             th;
    bool                    started = false;
};
MigState                gMig;
std::atomic<bool>       gMigBusy{false}, gMigDone{false};
std::atomic<int64_t>    gMigKey{INT64_MIN};

void migMain() {
    for (;;) {
        int rx, rz;
        {
            std::unique_lock<std::mutex> lk(gMig.mx);
            gMig.cv.wait(lk, [] { return gMig.have || gMig.stop; });
            if (gMig.stop) return;
            rx = gMig.rx; rz = gMig.rz; gMig.have = false;
        }
        std::vector<int64_t> known;
        try {
            ChunkSink sink;
            if (loadRegionFile(rx, rz, &sink) && !sink.empty()) {
                for (auto& kv : sink) {
                    bool any = false;
                    any = colsKnown(kv.second.color.data());
                    if (any) known.push_back(kv.first);
                }
                writeRegion(rx, rz, [&](int cx, int cz) -> ChunkData* { auto it = sink.find(key(cx, cz)); return it == sink.end() ? nullptr : &it->second; });
            }
        } catch (...) {}
        { std::lock_guard<std::mutex> lk(gMig.mx); gMig.known = std::move(known); }
        gMigDone = true;
    }
}

void migQuiesce() { // wait for the background conversion and drop its result (the world is changing)
    while (gMigBusy.load() && !gMigDone.load()) Sleep(5);
    gMigDone = false; gMigBusy = false; gMigKey = INT64_MIN;
    std::lock_guard<std::mutex> lk(gMig.mx);
    gMig.known.clear();
}

// ---- asynchronous region loading: files are read and parsed on a worker thread, chunks are merged into gCache a few per frame ----
struct LoadRes { int rx = 0, rz = 0; bool ok = false; ChunkSink sink; };
struct Loader {
    std::mutex              mx;
    std::condition_variable cv;
    std::deque<std::pair<int, int>> q;
    std::deque<LoadRes>     done;
    bool                    busy = false, started = false;
    std::thread             th;
};
Loader                       gLoader;
std::unordered_set<int64_t>  gLoading; // requested, not merged yet (main thread)
struct MergeJob { int64_t k = 0; bool active = false; ChunkSink sink; ChunkSink::iterator it; };
MergeJob gMerge;
struct IdxResult { std::unordered_set<int64_t> disk, tiles; std::vector<std::pair<int, int>> legacy; };
std::mutex          gIdxMx;
IdxResult           gIdxRes;
std::atomic<bool>   gIndexReady{false}, gIdxBusy{false}, gIdxDone{false};

void loaderMain() {
    for (;;) {
        std::pair<int, int> r;
        {
            std::unique_lock<std::mutex> lk(gLoader.mx);
            gLoader.cv.wait(lk, [] { return !gLoader.q.empty(); });
            r = gLoader.q.front(); gLoader.q.pop_front();
            gLoader.busy = true;
        }
        LoadRes res; res.rx = r.first; res.rz = r.second;
        try { res.ok = loadRegionFile(r.first, r.second, &res.sink); } catch (...) { res.ok = false; }
        {
            std::lock_guard<std::mutex> lk(gLoader.mx);
            gLoader.done.push_back(std::move(res));
            gLoader.busy = false;
        }
    }
}

bool loadingBusy() { return gMerge.active || !gLoading.empty() || !gIndexReady.load(); }

void idxQuiesce() { while (gIdxBusy.load()) Sleep(2); gIdxDone = false; }

void loadQuiesce() { // drop queued/finished loads of the old world
    for (;;) {
        {
            std::lock_guard<std::mutex> lk(gLoader.mx);
            gLoader.q.clear();
            if (!gLoader.busy) { gLoader.done.clear(); break; }
        }
        Sleep(2);
    }
    gLoading.clear();
    gMerge.active = false; gMerge.sink.clear();
}

// per frame: adopt the finished disk index, merge a slice of a loaded region into gCache
void pumpLoads() {
    if (gIdxDone.exchange(false)) {
        std::lock_guard<std::mutex> lk(gIdxMx);
        gDiskRegions.swap(gIdxRes.disk); gTileDisk.swap(gIdxRes.tiles); gLegacyPending.swap(gIdxRes.legacy);
        gIdxRes = IdxResult{};
        gIndexReady = true; ++gVersion;
    }
    if (!gMerge.active) {
        LoadRes r; bool have = false;
        {
            std::lock_guard<std::mutex> lk(gLoader.mx);
            if (!gLoader.done.empty()) { r = std::move(gLoader.done.front()); gLoader.done.pop_front(); have = true; }
        }
        if (have) {
            int64_t k = key(r.rx, r.rz);
            if (!r.ok) { // unreadable: keep the file as .bad and start the region empty
                std::error_code ec;
                std::filesystem::rename(regionFile(r.rx, r.rz), regionFile(r.rx, r.rz).string() + ".bad", ec);
                gDiskRegions.erase(k); gLoading.erase(k); gRegions[k] = gFrame;
            } else {
                gMerge.k = k; gMerge.sink = std::move(r.sink); gMerge.active = true;
            }
        }
    }
    if (gMerge.active) {
        int                         n = 0;
        std::vector<int64_t>        added;
        std::unique_lock<std::mutex> lk(gMapMx);
        while (!gMerge.sink.empty() && n < 300) {
            auto nh  = gMerge.sink.extract(gMerge.sink.begin()); // moves the node: no copy of the 27 KB chunk
            bool any = false;
            any = colsKnown(nh.mapped().color.data());
            nh.mapped().scanned = false;
            int64_t kk = nh.key();
            auto    ir = gCache.insert(std::move(nh));
            if (ir.inserted && any && gKnown.insert(kk).second) added.push_back(kk);
            else if (ir.inserted && !any) gKnown.erase(kk); // partial chunk from an older index: not known yet
            ++n;
        }
        lk.unlock();
        if (gTilesInit) for (int64_t k : added) markTilesForChunk(int(int32_t(uint32_t(uint64_t(k) >> 32))), int(int32_t(uint32_t(k & 0xFFFFFFFFu))), true);
        if (gMerge.sink.empty()) {
            gRegions[gMerge.k] = gFrame; gLoading.erase(gMerge.k);
            gMerge.active = false; gMerge.sink.clear();
        }
    }
}

// Lazy loading: a region is requested when something needs its chunks (scanning near the player, baking a tile); false until it is in RAM.
bool regionReady(int rx, int rz, bool allowLoad) {
    int64_t k  = key(rx, rz);
    auto    it = gRegions.find(k);
    if (it != gRegions.end()) { it->second = gFrame; return true; }
    if (!gIndexReady.load()) return false;
    if (!gDiskRegions.count(k)) { gRegions[k] = gFrame; return true; } // no file: empty region
    if (!allowLoad || k == gMigKey.load() || gLoading.count(k)) return false;
    gLoading.insert(k);
    {
        std::lock_guard<std::mutex> lk(gLoader.mx);
        gLoader.q.push_back({rx, rz});
        if (!gLoader.started) { gLoader.started = true; gLoader.th = std::thread(loaderMain); gLoader.th.detach(); }
    }
    gLoader.cv.notify_one();
    return false;
}

// Startup: a worker thread lists the region files, their .idx bitmaps (-> known chunks for the fog) and the tile images; nothing blocks the game.
void loadWorld() {
    if (gWorldKey.empty()) return;
    gKnown.clear(); gRegions.clear(); gDiskRegions.clear(); gLegacyPending.clear(); gTileDisk.clear();
    gIndexReady = false; gIdxDone = false; gIdxBusy = true;
    std::filesystem::path wd = worldDir();
    std::thread([wd] {
        IdxResult             r;
        std::error_code       ec;
        std::vector<int64_t>  batch;
        auto flush = [&] { if (batch.empty()) return; std::lock_guard<std::mutex> lk(gMapMx); for (int64_t k : batch) gKnown.insert(k); batch.clear(); };
        for (auto const& e : std::filesystem::directory_iterator(wd, ec)) {
            if (ec) break;
            std::string name = e.path().filename().string();
            int         rx = 0, rz = 0; char tail[8] = {};
            if (std::sscanf(name.c_str(), "r.%d.%d.%7s", &rx, &rz, tail) != 3 || std::string(tail) != "bin") continue;
            r.disk.insert(key(rx, rz));
            std::ifstream f(wd / ("r." + std::to_string(rx) + "." + std::to_string(rz) + ".idx"), std::ios::binary);
            uint8_t       idx[128] = {};
            if (f.read(reinterpret_cast<char*>(idx), 128)) {
                for (int bit = 0; bit < 1024; ++bit)
                    if (idx[bit >> 3] & (1u << (bit & 7))) batch.push_back(key(rx * 32 + (bit & 31), rz * 32 + (bit >> 5)));
                if (batch.size() > 8192) flush();
            } else r.legacy.push_back({rx, rz});
        }
        flush();
        for (auto const& e : std::filesystem::directory_iterator(wd / "tiles3", ec)) {
            if (ec) break;
            std::string name = e.path().filename().string();
            int         l = 0, i = 0, j = 0; char tail[8] = {};
            if (std::sscanf(name.c_str(), "t%d.%d.%d.%7s", &l, &i, &j, tail) == 4 && std::string(tail) == "dtl") r.tiles.insert(tkey(l, i, j));
        }
        { std::lock_guard<std::mutex> lk(gIdxMx); gIdxRes = std::move(r); }
        gIdxDone = true;
        gIdxBusy = false;
    }).detach();
    ++gVersion;
}

// Stable key: remote server -> "host_port" (LeviLamina's world data root), local world -> its folder. The engine level id/seed are random or shared on servers.
std::string stableWorldKey() {
    try {
        auto root = ll::getWorldDataRoot();
        if (!root) return {};
        std::filesystem::path p = *root;
        std::string full = p.generic_string();
        uint64_t h = 1469598103934665603ull;
        for (char c : full) { h ^= uint8_t(c); h *= 1099511628211ull; }
        std::string tail;
        for (auto it = p.begin(); it != p.end(); ++it) {
            std::string part = it->string();
            if (part.find('_') != std::string::npos && std::isdigit(uint8_t(part.back()))) tail = part; // host_port
        }
        if (tail.empty()) tail = p.parent_path().filename().string();
        std::string t;
        for (char c : tail) if ((std::isalnum(uint8_t(c)) || c == '_' || c == '.') && t.size() < 40) t += c;
        char hx[20];
        std::snprintf(hx, sizeof(hx), "%08x", unsigned(h ^ (h >> 32)));
        return "w" + std::string(hx) + "_" + t;
    } catch (...) { return {}; }
}

std::string computeWorldKey(::Level& level) {
    { std::string k = stableWorldKey(); if (!k.empty()) return k; }
    std::string id = level.getLevelId();
    std::string s;
    for (char c : id)
        if (std::isalnum(uint8_t(c)) && s.size() < 40) s += c;
    char seed[16];
    std::snprintf(seed, sizeof(seed), "%08x", unsigned(level.getSeed()));
    return std::string(seed) + "_" + s;
}

struct FogChunk { float k = 0.0f; bool mem = false; uint64_t stamp = 0; };
std::unordered_map<int64_t, FogChunk> gFogChunks, gFogChunksBig; // minimap / big map (the big map waits for its tiles)
uint64_t gFogEpoch = 0;

void asyncQuiesce();
void resetSlots();
void clearTiles();

void switchWorld(std::string const& k) {
    migQuiesce();
    idxQuiesce();
    loadQuiesce();
    saveAll();
    asyncQuiesce(); // the bake worker must not touch gCache while it is cleared
    resetSlots();
    clearTiles();
    {
        std::lock_guard<std::mutex> lk(gMapMx);
        gCache.clear();
    }
    gDirtyRegions.clear();
    gKnown.clear(); gRegions.clear(); gDiskRegions.clear(); gLegacyPending.clear(); gTileDisk.clear();
    gWorldKey = k;
    gFogChunks.clear();
    gFogChunksBig.clear();
    gFogEpoch = gFrame;
    loadWorld();
}

// ---------- oblique "diorama" projection, baked to merged rectangles ----------
// Units: 1 unit = one map cell horizontally. Rows are squashed by KY, heights lift by HS per block.
constexpr float KY  = 0.5f; // pitch ~48.6 deg; KY*PPC must stay an integer (3 px) // 3 px per row at 4 px/cell: pixel-exact so re-bakes are invisible
constexpr float HS  = 0.80f; // sharper camera (~32 deg pitch): taller walls, tree trunks and facades visible. Old: KY=0.75, HS=0.63. NOTE KY*PPC must be an integer (2 px)
// (old value kept for reference: 0.63) // lift per block (Java: cos/sin * KY = 0.63)
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
    if (wall) {
        WallBlob const* wb = c->walls.get();
        if (wb && !wb->bytes.empty()) *wall = WRef{wb->bytes.data() + wb->off[size_t(idx)], c->pal.data(), wb->len[size_t(idx)]};
        else *wall = WRef{&kZeroByte, c->pal.data(), 0};
    }
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
    int   rowsHalf = int(float(n) / (2.0f * KY)) + 160;
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
constexpr float kSinP = 0.5299f, kCosP = 0.8480f; // Java pitch 50 deg (used for depth only)
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
    std::vector<uint8_t>                ov; // 1 = column has an air gap between solid blocks (overhang/balcony/canopy)
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
    g.rowsHalf = int(float(b.n) / (2.0f * KY)) + 160;
    g.m        = 2 * g.rowsHalf + 1;
    g.mx       = int(std::ceil(40.0f * 0.7f / float(b.step))) + 2;
    g.gn       = g.n + g.mx;
    g.x0       = b.cx - (b.n / 2) * b.step;
    size_t N   = size_t(g.gn) * size_t(g.m);
    g.col.assign(N, 0u); g.h.assign(N, 0); g.wp.assign(N, WRef{}); g.sky.assign(N, 1.0f); g.ov.assign(N, 0);
    Sampler s;
    for (int gi = 0; gi < g.gn; ++gi) {
        int X = g.x0 + (gi - g.mx) * g.step;
        for (int r = 0; r < g.m; ++r) {
            int Z = g.cz + (r - g.rowsHalf) * g.step;
            uint32_t c = 0; int hh = 0; WRef w;
            if (sampleCell(s, X, Z, g.step, c, hh, &w)) {
                size_t k = g.id(gi, r);
                g.col[k] = c | 0xFF000000u; g.h[k] = int16_t(hh); g.wp[k] = w;
                if (w) {
                    bool seenSolid = false, airAfter = false;
                    for (int q = 0; q < NW; ++q) {
                        if (w[q] >> 24) { if (airAfter) { g.ov[k] = 1; break; } seenSolid = true; }
                        else if (seenSolid) airAfter = true;
                    }
                }
                g.maxH = std::max(g.maxH, hh);
            }
        }
    }
    // sky visibility per cell (a few short rays over the height field instead of Java's 13 voxel rays)
    static constexpr float dirs[8][2] = {{1, 0}, {0.7071f, 0.7071f}, {0, 1}, {-0.7071f, 0.7071f}, {-1, 0}, {-0.7071f, -0.7071f}, {0, -1}, {0.7071f, -0.7071f}};
    static constexpr float dists[7] = {1, 2, 3, 4, 6, 9, 12};
    int skyOff[8][7][2];
    for (int di = 0; di < 8; ++di)
        for (int dj = 0; dj < 7; ++dj) { skyOff[di][dj][0] = int(std::lround(dirs[di][0] * dists[dj] / float(g.step))); skyOff[di][dj][1] = int(std::lround(dirs[di][1] * dists[dj] / float(g.step))); }
    for (int gi = 0; gi < g.gn; ++gi)
        for (int r = 0; r < g.m; ++r) {
            size_t k = g.id(gi, r);
            if (!g.col[k]) continue;
            float y0 = float(g.h[k]) + 1.0f; int blocked = 0;
            for (int di = 0; di < 8; ++di) {
                for (int dj = 0; dj < 7; ++dj) {
                    int hn = g.hAt(gi + skyOff[di][dj][0], r + skyOff[di][dj][1]);
                    if (hn != INT_MIN && float(hn) + 1.0f > y0 + dists[dj] * 0.7f + 0.2f) { ++blocked; break; }
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

struct VRun { int yt, yb, k0; float topFrac; bool thin = false; };
constexpr int kMaxRuns = 48;
// Builds runs of solid blocks (top-down) from a column profile: entry alpha 0 = air gap, 0xE1 = slab, 0xE2 = stair, else full block.
int buildRuns(WRef wp, int h, VRun* out) {
    if (!wp) { out[0] = {h, h - 2, 0, 1.0f}; return 1; }
    int n = 0, k = 0;
    while (k < NW && n < kMaxRuns) {
        if (!(wp[k] >> 24)) { ++k; continue; }
        int k0 = k;
        bool thin0 = (wp[k0] >> 24) == 0xE3;
        while (k + 1 < NW && (wp[k + 1] >> 24) && (((wp[k + 1] >> 24) == 0xE3) == thin0)) ++k;
        int   lastDepth = (k + 1 < NW) ? kWallDepth[k + 1] - 1 : 95;
        uint32_t a = wp[k0] >> 24;
        out[n++] = {h - kWallDepth[k0], h - lastDepth, k0, a == 0xE1 ? 0.5f : (a == 0xE2 ? 0.75f : 1.0f), thin0};
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
void paintHeightfield(Baked const& b, int W, std::vector<uint32_t>& px, std::vector<int16_t>& hb, uint64_t epoch, bool cpuOnly = false) {
    SrgbTables const& T = srgb();
    HField g;
    buildHField(g, b);
    size_t NP = size_t(W) * size_t(W);
    // GPU shading (GpuBake.cpp): the CPU paints the visible records, the GPU shades them. Falls back to the CPU shading below.
    bool useGpu = !cpuOnly && g.step == 1 && gpu::bakeAvailable();
    std::vector<uint32_t> gpuRec;
    if (useGpu) gpuRec.assign(size_t(4) * NP * 6, 0xFFFFFFFFu);
    float  sc = float(W) / float(b.n);
    std::vector<Rec>     rec(NP);
    std::vector<float>   accR(NP, 0), accG(NP, 0), accB(NP, 0), dsum(NP, 0);
    std::vector<uint8_t> cnt(NP, 0);
    std::vector<int16_t> hsum(NP, 0);
    float KYv = KY, HSs = HS / float(b.step);
    float halfN = float(b.n) * 0.5f;
    std::vector<uint32_t> runOff(g.col.size(), 0u);
    std::vector<uint8_t>  runN(g.col.size(), 0);
    std::vector<VRun>     runPool;
    runPool.reserve(g.col.size() + g.col.size() / 4);
    for (size_t k = 0; k < g.col.size(); ++k) {
        if (!g.col[k]) continue;
        VRun tmp[kMaxRuns];
        int  n = buildRuns(g.wp[k], g.h[k], tmp);
        runOff[k] = uint32_t(runPool.size()); runN[k] = uint8_t(n);
        runPool.insert(runPool.end(), tmp, tmp + n);
    }
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
                VRun const* runs = &runPool[runOff[k]]; int nr = runN[k];
                int hn = g.known(gi, r + 1) ? int(g.h[g.id(gi, r + 1)]) : hh - 2;
                for (int q = 0; q + 1 < nr; ++q) { // narrow air gaps (1-3 blocks: windows, floors) get a darkened wall colour; wide gaps stay open (canopies, arches)
                    float gTop = float(runs[q + 1].yt) + 1.0f, gBot = float(runs[q].yb); // gap spans Y in [gTop, gBot]
                    float gap = gBot - gTop;
                    if (gap < 0.5f || gap > 3.5f) continue;
                    float Yt0 = float(runs[0].yt) + runs[0].topFrac;
                    float vA = halfN + float(j) * KYv - (Yt0 - float(g.h0)) * HSs + KYv;
                    int   wa0 = std::max(0, int(std::ceil((vA + (Yt0 - gBot) * HSs) * sc - sy))), wb0 = std::min(W, int(std::ceil((vA + (Yt0 - gTop) * HSs) * sc - sy)));
                    uint32_t base = wallColorAt(wp, hh, gBot + 0.5f, g.col[k]);
                    uint32_t dk = 0xFF000000u | (((base >> 16 & 255) * 5 / 10) << 16) | (((base >> 8 & 255) * 5 / 10) << 8) | ((base & 255) * 5 / 10);
                    for (int y = wa0; y < wb0; ++y) {
                        float vS = (float(y) + sy) / sc;
                        Rec& R = rec[size_t(y) * W + x];
                        R.cell = int32_t(k); R.type = 2; R.a = fx; R.b = 0.0f; R.y = Yt0 - std::max(0.0f, (vS - vA) / HSs);
                        R.col = dk;
                    }
                }
                for (int q = nr - 1; q >= 0; --q) { // runs are listed top-down; paint bottom-up
                    VRun const& R0 = runs[q];
                    if (R0.thin && (fx < 0.3f || fx > 0.7f)) continue; // fence/wall/bars: only the central post is drawn
                    float Ytop = float(R0.yt) + R0.topFrac;
                    float vTop0 = halfN + float(j) * KYv - (Ytop - float(g.h0)) * HSs, vTop1 = vTop0 + KYv;
                    uint32_t topCol = (R0.k0 == 0) ? g.col[k] : ((wp ? wp[R0.k0] : g.col[k]) | 0xFF000000u);
                    int ya = std::max(0, int(std::ceil(vTop0 * sc - sy))), yb = std::min(W, int(std::ceil(vTop1 * sc - sy)));
                    for (int y = ya; y < yb; ++y) {
                        float vS = (float(y) + sy) / sc;
                        Rec& R = rec[size_t(y) * W + x];
                        R.cell = int32_t(k); R.type = 1; R.a = fx; R.b = std::clamp((vS - vTop0) / KYv, 0.0f, 0.9999f); R.y = Ytop; R.col = topCol;
                    }
                    bool  sOv  = g.known(gi, r + 1) && g.ov[g.id(gi, r + 1)];
                    float lowY = sOv ? float(R0.yb) : std::max(float(R0.yb), float(hn + 1)); // under an overhang of the south column the facade continues
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
        if (useGpu) { // hand the records of this sample to the GPU instead of shading them here
            uint32_t* o = gpuRec.data() + size_t(s) * NP * 6;
            for (size_t p = 0; p < NP; ++p) {
                Rec const& R = rec[p];
                if (R.cell < 0) continue;
                o[p * 6 + 0] = uint32_t(R.cell);
                std::memcpy(&o[p * 6 + 1], &R.a, 4); std::memcpy(&o[p * 6 + 2], &R.b, 4); std::memcpy(&o[p * 6 + 3], &R.y, 4);
                o[p * 6 + 4] = R.col; o[p * 6 + 5] = R.type;
            }
            continue;
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
    if (useGpu) {
        std::vector<int32_t> h32(g.h.begin(), g.h.end());
        gpu::BakeIn in;
        in.W = W; in.gn = g.gn; in.m = g.m; in.mx = g.mx; in.rowsHalf = g.rowsHalf; in.x0 = g.x0; in.cz = g.cz; in.maxH = g.maxH == INT_MIN ? 0 : g.maxH;
        in.col = g.col.data(); in.h = h32.data(); in.sky = g.sky.data(); in.rec = gpuRec.data();
        std::vector<uint32_t> gp; std::vector<int16_t> gh;
        if (gpu::bakeShade(in, gp, gh)) {
            static std::atomic<int> verified{0};
            if (verified.load() < 2) { // compare the first two tiles with the CPU result; a bad GPU path is switched off
                ++verified;
                std::vector<uint32_t> cp; std::vector<int16_t> ch;
                paintHeightfield(b, W, cp, ch, epoch, true);
                if (cp.size() == gp.size()) {
                    double sum = 0; size_t n = 0, mism = 0;
                    for (size_t i = 0; i < gp.size(); ++i) {
                        bool ka = (gp[i] >> 24) != 0, kb = (cp[i] >> 24) != 0;
                        if (ka != kb) { ++mism; continue; }
                        if (ka) for (int sh = 0; sh <= 16; sh += 8) { sum += std::abs(int((gp[i] >> sh) & 255) - int((cp[i] >> sh) & 255)); ++n; }
                    }
                    double mean = n ? sum / double(n) : 0.0;
                    gpu::bakeLog("GPU tilebake check: mean difference " + std::to_string(mean) + " levels, " + std::to_string(mism) + " coverage mismatches of " + std::to_string(gp.size()) + " px.");
                    if (mean > 4.0 || mism > gp.size() / 50) { gpu::bakeDisable(); px = std::move(cp); hb = std::move(ch); return; }
                }
            }
            px = std::move(gp); hb = std::move(gh);
            return;
        }
        paintHeightfield(b, W, px, hb, epoch, true); // GPU unavailable for this tile: shade on the CPU
        return;
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
    // unknown area: flat fog colour. The animated volumetric fog (port of Diorama fog.fsh) is a separate overlay (FogView).
    for (auto& p : px) if (!(p >> 24)) p = FOG;
    for (auto& p : px) p |= 0xFF000000u;
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
        // new unique name (re-uploading an existing name is not safe). The texture this slot held before is released,
        // otherwise every failed in-place update leaks a whole image (1-4 MB) for the rest of the session.
        if (t.created[h] && !t.name[h].empty()) {
            ::ResourceLocation old(::Core::PathView(t.name[h]), ::ResourceFileSystem::UserPackage);
            tg->unloadTexture(old, false);
            t.created[h] = false;
        }
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
    if (dat->mIsMissingTexture == ::IsMissingTexture::Yes) return false; // engine placeholder (magenta checker): not uploaded yet
    ctx.drawImage(dat->mClientTexture.get(), ::glm::vec2{x, y}, ::glm::vec2{size, size}, ::glm::vec2{u0, v0}, ::glm::vec2{uw, vh}, false);
    ctx.flushImages(::mce::Color{1.0f, 1.0f, 1.0f, 1.0f}, 1.0f, ::HashedString(gMaterial));
    if (!gTexLogged) gTexLogged = true;
    return true;
}

// Dark frame with light bevel, drop shadow, corner studs (Diorama-like).
void frame(::MinecraftUIRenderContext& ctx, float x, float y, float size) {
    rect(ctx, x, y, x + size, y + size, toColor(FOG)); // unexplored background only (no frame)
}

// thin stone border: 2 px ring of grey blocks with a little noise
void stoneBorder(::MinecraftUIRenderContext& ctx, float x, float y, float size) {
    auto shade = [](int a, int b) { uint32_t h = uint32_t(a) * 73856093u ^ uint32_t(b) * 19349663u; h = (h ^ (h >> 13)) * 1274126177u; return 0.30f + 0.26f * float((h >> 8) & 255) / 255.0f; };
    for (int ring = 0; ring < 2; ++ring) {
        float o = float(ring + 1);
        float x0 = x - o, y0 = y - o, x1 = x + size + o, y1 = y + size + o;
        int   k = 0;
        for (float px = x0; px < x1; px += 3.0f, ++k) {
            float w = std::min(3.0f, x1 - px), v = shade(k, ring);
            rect(ctx, px, y0, px + w, y0 + 1.0f, ::mce::Color{v, v, v * 1.04f, 1.0f});
            v = shade(k + 50, ring);
            rect(ctx, px, y1 - 1.0f, px + w, y1, ::mce::Color{v, v, v * 1.04f, 1.0f});
        }
        for (float py = y0 + 1.0f; py < y1 - 1.0f; py += 3.0f, ++k) {
            float h2 = std::min(3.0f, y1 - 1.0f - py), v = shade(k + 100, ring);
            rect(ctx, x0, py, x0 + 1.0f, py + h2, ::mce::Color{v, v, v * 1.04f, 1.0f});
            v = shade(k + 150, ring);
            rect(ctx, x1 - 1.0f, py, x1, py + h2, ::mce::Color{v, v, v * 1.04f, 1.0f});
        }
    }
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
    float r = size * 0.5f, cx = x + r, cy = y + r;
    for (float ys = y; ys < y + size; ys += 1.0f) {
        float d = ys + 0.5f - cy, w = std::sqrt(std::max(0.0f, r * r - d * d));
        if (w > 0) rect(ctx, cx - w, ys, cx + w, ys + 1.0f, toColor(FOG));
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
    if (!windowFocused()) { gMWasDown = false; gF7WasDown = false; if (gBigMap) { gBigMap = false; gPanX = gPanZ = 0.0f; gDragging = false; gWheel = 0; } return; }
    installWheelHook();
    {
        static bool escWas = false;
        bool        esc    = down(VK_ESCAPE);
        if (esc && !escWas && gBigMap) { gBigMap = false; gPanX = gPanZ = 0.0f; gDragging = false; gWheel = 0; } // Esc closes the map (the game menu opens as usual)
        escWas = esc;
    }
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
constexpr int   kTileX = 128, kTileZ = 255;
constexpr int   kHRef = 64, kLMax = 3, kBakeN = 192, kBakeW = 768;
constexpr float kLiftPx = HS * float(PPC);
static_assert(kTileZ * 2 == kTH, "tile rows must be pixel exact");

int fdiv(int a, int b) { int q = a / b; if ((a % b != 0) && ((a < 0) != (b < 0))) --q; return q; }
int64_t tkey(int l, int i, int j) { return (int64_t(l) << 58) | (int64_t(uint32_t(i) & 0x1FFFFFFFu) << 29) | int64_t(uint32_t(j) & 0x1FFFFFFFu); }

struct TileJob { int i = 0, j = 0; uint64_t epoch = 0; };
struct TileResult { int i = 0, j = 0; uint64_t epoch = 0; std::vector<uint32_t> px; };
std::mutex               gTileMx;
std::condition_variable  gTileCv, gTileIdleCv;
std::vector<TileJob>     gTileQueue;
std::vector<TileResult>  gTileDone;
std::vector<std::thread> gTileThreads;
int                      gTileBusyN = 0;
bool                     gTileStop = false, gTileStarted = false;
bool                     gEvictHold = false; // set by the main thread while it wants to evict regions: bakers finish their job and take no new one

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
            gTileCv.wait(lk, [] { return gTileStop || (!gTileQueue.empty() && !gEvictHold); });
            if (gTileStop) return;
            job = gTileQueue.front();
            gTileQueue.erase(gTileQueue.begin());
            ++gTileBusyN;
        }
        TileResult r; r.i = job.i; r.j = job.j; r.epoch = job.epoch;
        bool ok = false;
        ULONGLONG t0 = GetTickCount64();
        try { ok = (gEpoch.load() == job.epoch) && bakeTilePixels(job.i, job.j, job.epoch, r.px); } catch (...) { ok = false; }
        if (ok) {
            static std::atomic<uint64_t> sumMs{0}; static std::atomic<int> nBake{0};
            sumMs += uint64_t(GetTickCount64() - t0);
            if (++nBake % 25 == 0) { gpu::bakeLog("perf: tile bake avg " + std::to_string(sumMs.load() / 25) + " ms over 25 tiles (gpu shading " + (gpu::bakeAvailable() ? "on" : "off") + ")"); sumMs = 0; }
        }
        {
            std::lock_guard<std::mutex> lk(gTileMx);
            --gTileBusyN;
            if (ok && gEpoch.load() == job.epoch) gTileDone.push_back(std::move(r));
        }
        gTileIdleCv.notify_all();
        // duty cycle: rest ~60% of the bake time so the big map never pins the CPU (game thread keeps its cores)
        ULONGLONG el = GetTickCount64() - t0;
        Sleep(DWORD(std::min<ULONGLONG>(el * 3 / 10 + 2, 120)));
    }
}

void startTileWorker() {
    if (gTileStarted) return;
    gTileStarted = true;
    gTileStop    = false;
    unsigned hc = std::thread::hardware_concurrency();
    int      n  = std::clamp(int(hc) / 2, 2, 4); // parallel baking: tiles are independent
    for (int i = 0; i < n; ++i) gTileThreads.emplace_back(tileWorkerMain);
}

void tileQuiesce() {
    std::unique_lock<std::mutex> lk(gTileMx);
    gTileQueue.clear();
    gTileDone.clear();
    gTileIdleCv.wait(lk, [] { return gTileBusyN == 0; });
}

// Region housekeeping (main thread, every frame): finish legacy regions, drop the least recently used regions from RAM.
void pumpRegions() {
    pumpRetiredWalls();
    if (gMigDone.exchange(false)) {
        std::vector<int64_t> kn;
        { std::lock_guard<std::mutex> lk(gMig.mx); kn.swap(gMig.known); }
        std::vector<int64_t> added;
        { std::lock_guard<std::mutex> lk(gMapMx); for (int64_t k : kn) if (gKnown.insert(k).second) added.push_back(k); }
        if (gTilesInit) for (int64_t k : added) markTilesForChunk(int(int32_t(uint32_t(uint64_t(k) >> 32))), int(int32_t(uint32_t(k & 0xFFFFFFFFu))), true);
        gMigKey = INT64_MIN; gMigBusy = false; ++gVersion;
    }
    if (!gMigBusy.load() && !gLegacyPending.empty()) {
        auto c = gLegacyPending.back(); gLegacyPending.pop_back();
        int64_t k = key(c.first, c.second);
        if (gLoading.count(k)) gLegacyPending.insert(gLegacyPending.begin(), c);
        else if (gRegions.count(k)) markDirty(c.first * 32, c.second * 32); // already loaded by the player: .idx is written when it is saved
        else {
            if (!gMig.started) { gMig.started = true; gMig.th = std::thread(migMain); gMig.th.detach(); }
            gMigKey = k; gMigBusy = true;
            { std::lock_guard<std::mutex> lk(gMig.mx); gMig.rx = c.first; gMig.rz = c.second; gMig.have = true; }
            gMig.cv.notify_one();
        }
    }
    if (gRegions.size() <= gRegionCap) {
        bool was; { std::lock_guard<std::mutex> lk(gTileMx); was = gEvictHold; gEvictHold = false; }
        if (was) gTileCv.notify_all();
        return;
    }
    {
        // bakers read chunk data: stop them taking new jobs, evict once the running ones have finished (no longer waits for an empty queue)
        std::lock_guard<std::mutex> lk(gTileMx);
        gEvictHold = true;
        if (gTileBusyN != 0) return;
    }
    struct HoldOff { ~HoldOff() { { std::lock_guard<std::mutex> lk(gTileMx); gEvictHold = false; } gTileCv.notify_all(); } } holdOff;
    while (gRegions.size() > gRegionCap) {
        int64_t best = 0; uint64_t bu = UINT64_MAX;
        for (auto const& kv : gRegions) if (kv.second + 3 < gFrame && kv.second < bu) { bu = kv.second; best = kv.first; }
        if (bu == UINT64_MAX) break;
        int rx = int(best >> 32), rz = int(int32_t(uint32_t(best & 0xFFFFFFFFu)));
        saverDrain(); // an older queued write must not land after this one
        if (gDirtyRegions.count(best)) { saveRegion(rx, rz); gDirtyRegions.erase(best); }
        {
            std::lock_guard<std::mutex> lk(gMapMx);
            for (int dz = 0; dz < 32; ++dz)
                for (int dx = 0; dx < 32; ++dx) gCache.erase(key(rx * 32 + dx, rz * 32 + dz));
        }
        gRegions.erase(best);
    }
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
    int                   miss = 0;
    uint64_t              diskVer = 0; // pxVer that is stored on disk
    bool                  diskTried = false;
    bool                  freed = false; // pixels dropped from RAM after they were stored (texture stays)
    int                   hole = 0;      // consecutive observations: nothing drawn over known terrain
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

// ---- tile images on disk: LZ4 over byte planes (all B, all G, all R, all A) ----
constexpr uint32_t kTileFmt = 1; // bump whenever the painter output changes: older images are then ignored and baked again

std::filesystem::path tileFile(int l, int i, int j) {
    return worldDir() / "tiles3" / ("t" + std::to_string(l) + "." + std::to_string(i) + "." + std::to_string(j) + ".dtl");
}

bool writeTileFile(int l, int i, int j, std::vector<uint32_t> const& px) {
    if (gWorldKey.empty() || px.empty()) return false;
    size_t               N = px.size();
    std::vector<uint8_t> raw(N * 4);
    for (size_t q = 0; q < N; ++q) {
        uint32_t v = px[q];
        raw[q] = uint8_t(v); raw[N + q] = uint8_t(v >> 8); raw[2 * N + q] = uint8_t(v >> 16); raw[3 * N + q] = uint8_t(v >> 24);
    }
    std::vector<uint8_t> comp = lz4Compress(raw.data(), raw.size());
    std::error_code      ec;
    auto                 path = tileFile(l, i, j);
    std::filesystem::create_directories(path.parent_path(), ec);
    auto tmp = path; tmp += ".tmp";
    {
        std::ofstream f(tmp, std::ios::binary | std::ios::trunc);
        if (!f) return false;
        uint32_t hdr[3] = {kTileFmt, uint32_t(N), uint32_t(comp.size())};
        f.write("DTL1", 4);
        f.write(reinterpret_cast<char const*>(hdr), 12);
        f.write(reinterpret_cast<char const*>(comp.data()), std::streamsize(comp.size()));
        if (!f) return false;
    }
    std::filesystem::rename(tmp, path, ec);
    return !ec;
}

bool readTileFile(int l, int i, int j, std::vector<uint32_t>& px) {
    std::ifstream f(tileFile(l, i, j), std::ios::binary);
    char          m[4] = {};
    uint32_t      hdr[3] = {};
    if (!f.read(m, 4) || std::memcmp(m, "DTL1", 4) != 0 || !f.read(reinterpret_cast<char*>(hdr), 12)) return false;
    size_t N = size_t(kTW) * size_t(kTexH);
    if (hdr[0] != kTileFmt || hdr[1] != N || hdr[2] > (1u << 26)) return false;
    std::vector<uint8_t> comp(hdr[2]), raw(N * 4);
    if (!f.read(reinterpret_cast<char*>(comp.data()), std::streamsize(comp.size()))) return false;
    if (!lz4Decompress(comp.data(), comp.size(), raw.data(), raw.size())) return false;
    px.resize(N);
    for (size_t q = 0; q < N; ++q) px[q] = uint32_t(raw[q]) | (uint32_t(raw[N + q]) << 8) | (uint32_t(raw[2 * N + q]) << 16) | (uint32_t(raw[3 * N + q]) << 24);
    return true;
}

bool tileLoadBudget() {
    static uint64_t at = UINT64_MAX; static int n = 0;
    if (at != gFrame) { at = gFrame; n = 0; }
    return n++ < 2; // at most two disk loads per frame
}

// Loads a tile that exists only on disk (nothing in RAM yet).
Tile* tileFromDisk(int l, int i, int j) {
    if (!gTileDisk.count(tkey(l, i, j)) || !tileLoadBudget()) return nullptr;
    std::vector<uint32_t> px;
    if (!readTileFile(l, i, j, px)) { gTileDisk.erase(tkey(l, i, j)); return nullptr; }
    Tile& t = tileAt(l, i, j);
    t.px = std::move(px); t.pxVer = 1; t.propVer = 1; t.diskVer = 1; t.baked = true; t.content = true; t.diskTried = true; t.pxFrame = gFrame;
    return &t;
}

// Existing in-RAM entry without pixels (created by a chunk change, or its pixels were freed): bring the stored image back.
void ensureTilePx(Tile& t, bool force = false) {
    if (!t.px.empty() || !gTileDisk.count(tkey(t.l, t.i, t.j))) return;
    if (!force && (t.diskTried || t.freed)) return;
    if (!force && !tileLoadBudget()) return;
    t.diskTried = true;
    std::vector<uint32_t> px;
    if (!readTileFile(t.l, t.i, t.j, px)) return;
    t.px = std::move(px); t.pxVer += 1; t.propVer = t.pxVer; t.diskVer = t.pxVer; t.pxFrame = gFrame; t.freed = false;
}

void clearTiles() {
    gTiles.clear();
    gTilesInit = false;
    gChangedChunks.clear();
}

// A changed chunk can show up in every level-0 tile whose bake window (x -32..+32 blocks, z rows -40..+110 for lifted roofs) reaches it.
void markTilesForChunk(int cx, int cz, bool init = false) {
    int x0 = cx * 16, z0 = cz * 16;
    for (int i = fdiv(x0 - 160, kTileX); i <= fdiv(x0 + 48, kTileX); ++i) {
        if (!(kTileX * i - 32 < x0 + 16 && kTileX * i + kTileX + 32 > x0)) continue;
        for (int j = fdiv(z0 - 480, kTileZ); j <= fdiv(z0 + 82, kTileZ); ++j) {
            if (!(kTileZ * j - 65 < z0 + 16 && kTileZ * j + kTileZ + 65 + 160 > z0)) continue;
            if (init && gTileDisk.count(tkey(0, i, j))) continue; // already stored: no bake needed
            Tile& t = tileAt(0, i, j);
            t.content = true; t.stale = true; t.staleFrame = gFrame;
        }
    }
}

void initTilesFromCache() {
    std::vector<std::pair<int, int>> cs;
    {
        std::lock_guard<std::mutex> lk(gMapMx);
        cs.reserve(gKnown.size());
        gKnown.forEach([&](int64_t k) { cs.push_back({int(int32_t(uint32_t(uint64_t(k) >> 32))), int(int32_t(uint32_t(k & 0xFFFFFFFFu)))}); });
    }
    for (auto const& c : cs) markTilesForChunk(c.first, c.second, true);
    gTilesInit = true;
}

void contributeToParent(Tile const& c) {
    Tile& p = tileAt(c.l + 1, fdiv(c.i, 2), fdiv(c.j, 2));
    ensureTilePx(p, true); // keep the other three quarters from the stored image
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

// Video memory: tile textures that have not been drawn for a while are unloaded (the image stays on disk and is reloaded on demand).
size_t gLiveTexCount = 0;
void evictTileTextures(::IClientInstance& client) {
    if (gFrame % 30 != 0) return;
    {   // the second (hidden) buffer of a tile that is not being updated is only a duplicate: release it
        auto tg0 = client.getTextureGroup();
        if (tg0)
            for (auto& kv : gTiles) {
                Tile& t = kv.second;
                int   o = 1 - t.tex.cur;
                if (!t.tex.created[o] || t.tex.pending || !t.tex.created[t.tex.cur] || gFrame - t.pxFrame < 300) continue;
                ::ResourceLocation loc(::Core::PathView(t.tex.name[o]), ::ResourceFileSystem::UserPackage);
                tg0->unloadTexture(loc, false);
                t.tex.created[o] = false;
            }
    }
    size_t                              live = 0;
    std::vector<std::pair<uint64_t, Tile*>> cand;
    for (auto& kv : gTiles) {
        Tile& t = kv.second;
        if (!t.tex.created[0] && !t.tex.created[1]) continue;
        ++live;
        // a tile whose pixels are still in RAM can always be re-uploaded; one without them needs its stored copy on disk
        if (t.tex.pending || gFrame - t.lastUse < 300 || (t.px.empty() && (t.diskVer != t.pxVer || !gTileDisk.count(kv.first)))) continue;
        cand.push_back({t.lastUse, &t});
    }
    gLiveTexCount = live;
    if (live <= gTexCap || cand.empty()) return;
    auto tg = client.getTextureGroup();
    if (!tg) return;
    std::sort(cand.begin(), cand.end(), [](auto const& a, auto const& b) { return a.first < b.first; });
    size_t n = std::min<size_t>(std::min<size_t>(live - gTexCap, 24), cand.size());
    for (size_t q = 0; q < n; ++q) {
        Tile& t = *cand[q].second;
        for (int k = 0; k < 2; ++k)
            if (t.tex.created[k]) {
                ::ResourceLocation loc(::Core::PathView(t.tex.name[k]), ::ResourceFileSystem::UserPackage);
                tg->unloadTexture(loc, false);
                t.tex.created[k] = false;
            }
        t.shown = false; t.tex.pending = false; t.miss = 0;
        if (!t.px.empty()) t.upVer = t.pxVer + 1; // upload again when it is drawn
        else { t.diskTried = false; t.freed = false; } // draw path reloads it from disk
    }
}

void tileTick(float tx, float tz, bool bigOpen) {
    for (auto const& c : gChangedChunks) markTilesForChunk(c.first, c.second);
    gChangedChunks.clear();
    if (!bigOpen || !gTexEnabled || gTexFailed) return;
    if (!gTilesInit && gIndexReady.load() && !gMerge.active) initTilesFromCache();
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
    // schedule bakes: nearest to the view first. The chunk data a tile needs is loaded from disk first (a few regions at a time).
    if (gFrame % 4 == 0 && gRegions.size() <= gRegionCap + 4) {
        size_t queued;
        { std::lock_guard<std::mutex> lk(gTileMx); queued = gTileQueue.size(); }
        if (queued < 4) {
            std::vector<std::pair<float, Tile*>> cand;
            for (auto& kv : gTiles) {
                Tile& t = kv.second;
                if (t.l != 0 || !t.content || t.queued) continue;
                if (t.baked && !(t.stale && gFrame - t.staleFrame >= 45)) continue;
                float dx = float(t.i * kTileX + kTileX / 2) - tx, dz = float(t.j * kTileZ + kTileZ / 2) - tz;
                cand.push_back({dx * dx + dz * dz + (t.baked ? 4.0e6f : 0.0f), &t}); // never-baked tiles (white holes) before refreshes of baked ones
            }
            std::sort(cand.begin(), cand.end(), [](auto const& a, auto const& b) { return a.first < b.first; });
            size_t              take = std::min<size_t>(cand.size(), 4 - queued);
            std::vector<Tile*>  pick;
            for (size_t k = 0; k < cand.size() && k < 40 && pick.size() < take; ++k) { // not only the nearest few: tiles behind the player must not starve
                Tile* t = cand[k].second;
                bool  ready = true;
                for (int rx = (kTileX * t->i - 72) >> 9; rx <= (kTileX * t->i + 164) >> 9; ++rx)
                    for (int rz = (kTileZ * t->j - 232) >> 9; rz <= (kTileZ * t->j + 484) >> 9; ++rz)
                        if (!regionReady(rx, rz, true)) ready = false;
                if (ready) pick.push_back(t);
            }
            std::lock_guard<std::mutex> lk(gTileMx);
            for (Tile* t : pick) {
                t->queued = true; t->stale = false;
                gTileQueue.push_back({t->i, t->j, gEpoch.load()});
            }
            if (!pick.empty()) gTileCv.notify_all();
        }
    }
    // store finished tiles (one per pass): compressed images on disk, so they are never baked twice
    if (gFrame % 20 == 0) {
        for (auto& kv : gTiles) {
            Tile& t = kv.second;
            if (t.px.empty() || t.diskVer == t.pxVer || t.queued || gFrame - t.pxFrame < 90) continue;
            if (writeTileFile(t.l, t.i, t.j, t.px)) { t.diskVer = t.pxVer; gTileDisk.insert(kv.first); }
            break;
        }
    }
    // keep RAM bounded: level-0 pixel copies that are already on the GPU and propagated can be dropped
    if (gFrame % 60 == 0) {
        int cnt = 0;
        for (auto& kv : gTiles) if (!kv.second.px.empty()) ++cnt;
        while (size_t(cnt) > gPxCap) {
            Tile* old = nullptr;
            for (auto& kv : gTiles) {
                Tile& t = kv.second;
                if (t.px.empty() || t.propVer != t.pxVer || t.diskVer != t.pxVer || t.tex.pending) continue;
                bool uploaded = t.shown && t.upVer == t.pxVer;
                if (!uploaded && gFrame - t.lastUse < 120) continue; // wanted soon: keep the pixels for the upload
                if (!old || t.lastUse < old->lastUse) old = &t;
            }
            if (!old) break;
            bool wasUp = old->shown && old->upVer == old->pxVer;
            old->px.clear(); old->px.shrink_to_fit();
            if (wasUp) old->freed = true; // its texture stays; the stored image comes back when needed
            else { old->freed = false; old->diskTried = false; } // never uploaded: the draw path loads it from disk again
            --cnt;
        }
    }
}

int gDrawL = 0; // tile level the big map is drawn with right now

bool tileShown(Tile const& t) { return t.shown && t.tex.created[t.tex.cur]; }

// The big map shows this chunk's terrain: its level-0 tile is baked after the chunk's last change, uploaded and on screen.
bool fogChunkReady(int cx, int cz) {
    // the area is on screen when a tile of the drawn level (or a coarser stand-in) covers it and is shown
    for (int l = gDrawL; l <= kLMax; ++l) {
        Tile* t = findTile(l, fdiv(cx * 16, kTileX << l), fdiv(cz * 16, kTileZ << l));
        if (!t || !t->shown || !t->tex.created[t->tex.cur] || t->tex.pending) continue;
        if (l == 0 && (!t->baked || t->stale || t->queued || t->upVer != t->pxVer)) continue;
        if (l > 0) { // a coarse tile only holds what its children have contributed so far
            int   i0 = fdiv(cx * 16, kTileX), j0 = fdiv(cz * 16, kTileZ);
            Tile* t0 = findTile(0, i0, j0);
            bool  ok = (t0 && t0->baked && !t0->stale && t0->propVer == t0->pxVer) || gTileDisk.count(tkey(0, i0, j0));
            if (!ok) continue;
        }
        return true;
    }
    return false;
}

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
    if (dat->mIsMissingTexture == ::IsMissingTexture::Yes) return false; // never show the magenta placeholder
    ctx.drawImage(dat->mClientTexture.get(), ::glm::vec2{x, y}, ::glm::vec2{w, h}, ::glm::vec2{u0, v0}, ::glm::vec2{uw, vh}, false);
    ctx.flushImages(::mce::Color{1.0f, 1.0f, 1.0f, 1.0f}, 1.0f, ::HashedString(gMaterial));
    return true;
}

// does this tile cover terrain the map knows? (a few sample points)
bool tileKnownArea(int l, int i, int j) {
    float x0 = float(i * (kTileX << l)), z0 = float(j * (kTileZ << l)), w = float(kTileX << l), h = float(kTileZ << l);
    std::lock_guard<std::mutex> lk(gMapMx);
    for (int a = 0; a < 3; ++a)
        for (int b = 0; b < 3; ++b)
            if (gKnown.count(key(floorDiv16(int(std::floor(x0 + w * (0.2f + 0.3f * float(a))))), floorDiv16(int(std::floor(z0 + h * (0.2f + 0.3f * float(b)))))))) return true;
    return false;
}

// a blank hole over known terrain: reset the tile so it is loaded/uploaded/baked again
void healTile(Tile& h) {
    h.diskTried = false; h.freed = false; h.shown = false; h.tex.pending = false;
    h.tex.created[0] = h.tex.created[1] = false;
    if (!h.px.empty()) { h.upVer = h.pxVer + 1; return; }
    if (gTileDisk.count(tkey(h.l, h.i, h.j))) return; // the draw path reloads it
    if (h.l == 0) { h.content = true; h.baked = false; h.stale = true; h.staleFrame = 0; return; }
    int k = 1 << h.l; // rebuild from the detailed tiles underneath
    for (int jj = h.j * k; jj < (h.j + 1) * k; ++jj)
        for (int ii = h.i * k; ii < (h.i + 1) * k; ++ii) {
            Tile* c = findTile(0, ii, jj);
            if (!c) { if (!tileKnownArea(0, ii, jj)) continue; c = &tileAt(0, ii, jj); }
            c->content = true; c->baked = false; c->stale = true; c->staleFrame = 0;
        }
}

void drawTileCell(::MinecraftUIRenderContext& ctx, ::IClientInstance& client, int l, int i, int j, float x, float y, float w, float h, int& uploads) {
    constexpr float kV = float(kTH) / float(kTexH);
    float ow = w + 0.75f, oh = h + 0.75f; // tiny overlap hides hairline seams between neighbours
    Tile* t = findTile(l, i, j);
    if (!t) t = tileFromDisk(l, i, j); else ensureTilePx(*t);
    if (t) {
        tileUpload(client, *t, uploads);
        if (tileShown(*t)) {
            if (drawTileTex(ctx, t->tex, x, y, ow, oh, 0.0f, 0.0f, 1.0f, kV)) { t->lastUse = gFrame; t->miss = 0; t->hole = 0; return; }
            if (++t->miss > 90) { // placeholder never went away: drop the texture and upload/bake again
                t->miss = 0; t->shown = false; t->tex.pending = false; t->diskTried = false; t->freed = false;
                t->tex.created[0] = t->tex.created[1] = false;
                if (!t->px.empty()) t->upVer = t->pxVer + 1;
                else { t->baked = false; t->queued = false; t->content = true; t->stale = true; t->staleFrame = 0; }
            }
        }
    }
    // stand-in: the same area from a coarser level (never empty holes while the detailed tile is still baking)
    for (int l2 = l + 1; l2 <= kLMax; ++l2) {
        int k = 1 << (l2 - l), ai = fdiv(i, k), aj = fdiv(j, k);
        Tile* a = findTile(l2, ai, aj);
        if (!a) a = tileFromDisk(l2, ai, aj); else ensureTilePx(*a);
        if (!a) continue;
        tileUpload(client, *a, uploads);
        if (!tileShown(*a)) continue;
        float ox = float(i - ai * k) / float(k), oy = float(j - aj * k) / float(k);
        if (drawTileTex(ctx, a->tex, x, y, ow, oh, ox, oy * kV, 1.0f / float(k), kV / float(k))) { a->lastUse = gFrame; return; }
    }
    // nothing could be drawn: if the area is known terrain this is a hole; heal it after it persisted for a while
    if ((gFrame + uint64_t(i * 7 + j * 13 + l)) % 45 == 0 && tileKnownArea(l, i, j)) {
        Tile& hl = tileAt(l, i, j);
        if (++hl.hole > 3) { hl.hole = 0; healTile(hl); }
    }
}

// Whole big map from tiles. (tx,tz) = world point at the screen centre, cH = ground height there.
void drawTileMap(::MinecraftUIRenderContext& ctx, ::IClientInstance& client, float sw, float sh, float size, float tx, float tz, float cH, float yaw) {
    float s    = size / (gZoom * float(PPC));         // GUI units per level-0 pixel
    float pcx  = tx * float(PPC), pcy = tz * KY * float(PPC) - (cH - float(kHRef)) * kLiftPx;
    float halfW = sw * 0.5f / s, halfH = sh * 0.5f / s;
    float dens  = size / gZoom * 2.2f;                // ~ physical pixels per block
    int   L     = std::clamp(int(std::floor(std::log2(float(PPC) / std::max(dens, 0.01f)))), 0, kLMax);
    gDrawL = L;
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


// ---------- big map tools: draw, markers, route point, trash ----------
struct OvMarker { int type; float x, z, h; };
struct OvStroke { int col; std::vector<std::array<float, 3>> pts; };
std::vector<OvMarker> gOvMarkers;
std::vector<OvStroke> gOvStrokes;
bool        gOvRoute = false;
float       gOvRX = 0, gOvRZ = 0, gOvRH = 64;
int         gTool = 0;            // 0 none, 1 draw, 2 marker, 3 route point
int         gMarkType = -1, gDrawCol = 0, gLmbOwner = 0; // owner: 1 ui, 2 tool, 3 pan
bool        gMenuMarker = false, gDeleteMode = false, gLmbPrev = false, gStrokeActive = false, gOvDirty = false;
std::string gOvKey;

constexpr int kMarkerTypes = 8;
// 7x7 pixel shapes: house, star, diamond, cross, circle, heart, triangle, square
const uint8_t kMarkBits[kMarkerTypes][7] = {
    {0x08, 0x1C, 0x3E, 0x7F, 0x36, 0x36, 0x36}, {0x08, 0x08, 0x7F, 0x3E, 0x1C, 0x36, 0x22}, {0x08, 0x1C, 0x3E, 0x7F, 0x3E, 0x1C, 0x08},
    {0x41, 0x22, 0x14, 0x08, 0x14, 0x22, 0x41}, {0x1C, 0x3E, 0x7F, 0x7F, 0x7F, 0x3E, 0x1C}, {0x36, 0x7F, 0x7F, 0x7F, 0x3E, 0x1C, 0x08},
    {0x08, 0x08, 0x1C, 0x1C, 0x3E, 0x3E, 0x7F}, {0x7F, 0x41, 0x5D, 0x55, 0x5D, 0x41, 0x7F}};
const float kMarkCol[kMarkerTypes][3] = {{0.88f, 0.25f, 0.25f}, {0.96f, 0.82f, 0.13f}, {0.19f, 0.82f, 0.94f}, {1.0f, 1.0f, 1.0f},
                                         {0.25f, 0.88f, 0.38f}, {1.0f, 0.44f, 0.69f}, {1.0f, 0.56f, 0.13f}, {0.63f, 0.38f, 0.94f}};
constexpr int   kDrawCols = 6;
const float     kDrawCol[kDrawCols][3] = {{0.95f, 0.2f, 0.2f}, {0.98f, 0.8f, 0.1f}, {0.2f, 0.85f, 0.35f}, {0.2f, 0.7f, 0.98f}, {0.75f, 0.35f, 0.95f}, {1.0f, 1.0f, 1.0f}};
// 9x9 button icons
const char* const kIcoPencil[9] = {".......##", "......###", ".....###.", "....###..", "...###...", "..###....", ".###.....", ".##......", "##......."};
const char* const kIcoPin[9]    = {"..#####..", ".#######.", ".###.###.", ".###.###.", ".#######.", "..#####..", "...###...", "....#....", "....#...."};
const char* const kIcoFlag[9]   = {".#.......", ".######..", ".#######.", ".######..", ".#.......", ".#.......", ".#.......", ".#.......", "###......"};
const char* const kIcoTrash[9]  = {"...###...", "#########", ".#######.", ".#.#.#.#.", ".#.#.#.#.", ".#.#.#.#.", ".#.#.#.#.", ".#######.", ".#######."};

std::filesystem::path ovFile() { return worldDir() / "overlay.bin"; }

void ovSave() {
    gOvDirty = false;
    if (gWorldKey.empty()) return;
    std::error_code ec;
    std::filesystem::create_directories(worldDir(), ec);
    std::ofstream f(ovFile(), std::ios::binary | std::ios::trunc);
    if (!f) return;
    uint32_t nm = uint32_t(gOvMarkers.size()), ns = uint32_t(gOvStrokes.size());
    f.write("OVL1", 4);
    f.write(reinterpret_cast<char const*>(&nm), 4);
    for (auto const& m : gOvMarkers) { int32_t t = m.type; f.write(reinterpret_cast<char const*>(&t), 4); f.write(reinterpret_cast<char const*>(&m.x), 12); }
    f.write(reinterpret_cast<char const*>(&ns), 4);
    for (auto const& st : gOvStrokes) {
        int32_t c = st.col; uint32_t n = uint32_t(st.pts.size());
        f.write(reinterpret_cast<char const*>(&c), 4); f.write(reinterpret_cast<char const*>(&n), 4);
        f.write(reinterpret_cast<char const*>(st.pts.data()), std::streamsize(n) * 12);
    }
    uint32_t r = gOvRoute ? 1u : 0u;
    f.write(reinterpret_cast<char const*>(&r), 4);
    f.write(reinterpret_cast<char const*>(&gOvRX), 12);
}

void ovEnsureLoaded() {
    if (gOvKey == gWorldKey) return;
    gOvKey = gWorldKey; gOvDirty = false;
    gOvMarkers.clear(); gOvStrokes.clear(); gOvRoute = false;
    gTool = 0; gMarkType = -1; gMenuMarker = false; gDeleteMode = false;
    if (gWorldKey.empty()) return;
    std::ifstream f(ovFile(), std::ios::binary);
    char          m[4] = {};
    uint32_t      nm = 0, ns = 0, r = 0;
    if (!f.read(m, 4) || std::memcmp(m, "OVL1", 4) != 0 || !f.read(reinterpret_cast<char*>(&nm), 4) || nm > 100000) return;
    for (uint32_t i = 0; i < nm; ++i) { OvMarker mk{}; int32_t t = 0; if (!f.read(reinterpret_cast<char*>(&t), 4) || !f.read(reinterpret_cast<char*>(&mk.x), 12)) return; mk.type = t; gOvMarkers.push_back(mk); }
    if (!f.read(reinterpret_cast<char*>(&ns), 4) || ns > 100000) return;
    for (uint32_t i = 0; i < ns; ++i) {
        OvStroke st; int32_t c = 0; uint32_t n = 0;
        if (!f.read(reinterpret_cast<char*>(&c), 4) || !f.read(reinterpret_cast<char*>(&n), 4) || n > 1000000) return;
        st.col = c; st.pts.resize(n);
        if (!f.read(reinterpret_cast<char*>(st.pts.data()), std::streamsize(n) * 12)) return;
        gOvStrokes.push_back(std::move(st));
    }
    if (f.read(reinterpret_cast<char*>(&r), 4) && f.read(reinterpret_cast<char*>(&gOvRX), 12)) gOvRoute = r != 0;
}

// surface height of a column from the chunk cache (INT_MIN when unknown)
int cachedTop(int x, int z) {
    auto it = gCache.find(key(floorDiv16(x), floorDiv16(z)));
    if (it == gCache.end()) return INT_MIN;
    int idx = (z & 15) * 16 + (x & 15);
    return it->second.color[idx] ? int(it->second.height[idx]) + 1 : INT_MIN;
}

struct Proj { float sw, sh, s, pcx, pcy; };
Proj makeProj(float sw, float sh, float size, float tx, float tz, float cH) {
    Proj p; p.sw = sw; p.sh = sh;
    p.s = size / (gZoom * float(PPC)); p.pcx = tx * float(PPC); p.pcy = tz * KY * float(PPC) - (cH - float(kHRef)) * kLiftPx;
    return p;
}
constexpr int kOvW = 1024;
Tex                   gOvTex;
std::vector<uint32_t> gOvBuf;
uint64_t              gOvHash = 0;
bool                  gOvHas  = false;
Proj                  gOvP{0, 0, 0, 0, 0}, gOvPendP{0, 0, 0, 0, 0}; // view of the shown / pending overlay raster

void projWorld(Proj const& p, float X, float Z, float h, float& sx, float& sy) {
    sx = p.sw * 0.5f + (X * float(PPC) - p.pcx) * p.s;
    sy = p.sh * 0.5f + (Z * KY * float(PPC) - (h - float(kHRef)) * kLiftPx - p.pcy) * p.s;
}
// screen point -> world point on the terrain surface drawn there (a few iterations because of the height lift)
void unprojScreen(Proj const& p, float cH, float mx, float my, float& X, float& Z, float& h) {
    h = cH; X = 0; Z = 0;
    for (int it = 0; it < 4; ++it) {
        X = (p.pcx + (mx - p.sw * 0.5f) / p.s) / float(PPC);
        Z = (p.pcy + (my - p.sh * 0.5f) / p.s + (h - float(kHRef)) * kLiftPx) / (KY * float(PPC));
        int t = cachedTop(int(std::floor(X)), int(std::floor(Z)));
        if (t == INT_MIN) break;
        h = float(t);
    }
}

struct BtnR { float x0, y0, x1, y1; };
BtnR btnRect(int i, float sw, float sh) {
    constexpr float B = 24.0f;
    float y0 = sh - B - 4.0f;
    float x0 = i == 3 ? sw - B - 8.0f : 8.0f + float(i) * (B + 6.0f);
    return {x0, y0, x0 + B, y0 + B};
}
bool inR(BtnR const& r, float x, float y) { return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1; }
BtnR markPanel(float sw, float sh) { BtnR b = btnRect(1, sw, sh); return {b.x0, b.y0 - 8.0f - 2 * 22.0f - 6.0f, b.x0 + 4 * 22.0f + 6.0f, b.y0 - 6.0f}; }
BtnR colPanel(float sw, float sh) { BtnR b = btnRect(0, sw, sh); return {b.x0, b.y0 - 8.0f - 22.0f, b.x0 + float(kDrawCols) * 22.0f + 6.0f, b.y0 - 6.0f}; }

void bigMapInput(float sw, float sh, float size, float mx, float my, bool mv, bool focused, float cH) {
    bool lmb = mv && focused && down(VK_LBUTTON);
    bool press = lmb && !gLmbPrev, release = !lmb && gLmbPrev;
    gLmbPrev = lmb;
    Proj pr = makeProj(sw, sh, size, gSX + gPanX, gSZ + gPanZ, cH);
    if (press) {
        gLmbOwner = 1;
        BtnR bm = markPanel(sw, sh), bc = colPanel(sw, sh);
        if (inR(btnRect(0, sw, sh), mx, my)) { gTool = gTool == 1 ? 0 : 1; gMenuMarker = false; gDeleteMode = false; }
        else if (inR(btnRect(1, sw, sh), mx, my)) { gMenuMarker = !gMenuMarker; gDeleteMode = false; if (gMenuMarker) gTool = 0; }
        else if (inR(btnRect(2, sw, sh), mx, my)) { gTool = gTool == 3 ? 0 : 3; gMenuMarker = false; gDeleteMode = false; }
        else if (inR(btnRect(3, sw, sh), mx, my)) {
            if (gTool != 0 || gMenuMarker || gMarkType >= 0) { if (gTool == 3) gOvRoute = false, gOvDirty = true; gTool = 0; gMenuMarker = false; gMarkType = -1; gDeleteMode = false; }
            else gDeleteMode = !gDeleteMode;
        } else if (gMenuMarker && inR(bm, mx, my)) {
            int c = int((mx - bm.x0 - 3.0f) / 22.0f), r = int((my - bm.y0 - 3.0f) / 22.0f);
            if (c >= 0 && c < 4 && r >= 0 && r < 2) { gMarkType = r * 4 + c; gTool = 2; gMenuMarker = false; }
        } else if (gMenuMarker) gMenuMarker = false;
        else if (gTool == 1 && inR(bc, mx, my)) {
            int c = int((mx - bc.x0 - 3.0f) / 22.0f);
            if (c >= 0 && c < kDrawCols) gDrawCol = c;
        } else if (my > 26.0f && my < sh - 34.0f) {
            float X, Z, h;
            unprojScreen(pr, cH, mx, my, X, Z, h);
            if (gDeleteMode) {
                gLmbOwner = 2;
                float bestD = 100.0f; int kind = 0; size_t bi = 0; // 1 marker, 2 route, 3 stroke
                for (size_t i = 0; i < gOvMarkers.size(); ++i) {
                    float sx, sy; projWorld(pr, gOvMarkers[i].x, gOvMarkers[i].z, gOvMarkers[i].h, sx, sy);
                    float d = (sx - mx) * (sx - mx) + (sy - my) * (sy - my);
                    if (d < bestD) { bestD = d; kind = 1; bi = i; }
                }
                if (gOvRoute) { float sx, sy; projWorld(pr, gOvRX, gOvRZ, gOvRH, sx, sy); float d = (sx - mx) * (sx - mx) + (sy - my) * (sy - my); if (d < bestD) { bestD = d; kind = 2; } }
                for (size_t i = 0; i < gOvStrokes.size(); ++i)
                    for (auto const& q : gOvStrokes[i].pts) {
                        float sx, sy; projWorld(pr, q[0], q[1], q[2], sx, sy);
                        float d = (sx - mx) * (sx - mx) + (sy - my) * (sy - my);
                        if (d < std::min(bestD, 36.0f)) { bestD = d; kind = 3; bi = i; }
                    }
                if (kind == 1) gOvMarkers.erase(gOvMarkers.begin() + long(bi));
                else if (kind == 2) gOvRoute = false;
                else if (kind == 3) gOvStrokes.erase(gOvStrokes.begin() + long(bi));
                if (kind) gOvDirty = true;
            } else if (gTool == 1) {
                gLmbOwner = 2; gStrokeActive = true;
                OvStroke st; st.col = gDrawCol; st.pts.push_back({X, Z, h});
                gOvStrokes.push_back(std::move(st));
            } else if (gTool == 2 && gMarkType >= 0) {
                gLmbOwner = 2; gOvMarkers.push_back({gMarkType, X, Z, h}); gOvDirty = true;
            } else if (gTool == 3) {
                gLmbOwner = 2; gOvRoute = true; gOvRX = X; gOvRZ = Z; gOvRH = h; gTool = 0; gOvDirty = true;
            } else gLmbOwner = 3;
        }
    }
    if (lmb && gStrokeActive && !gOvStrokes.empty() && my > 26.0f && my < sh - 34.0f) {
        auto& st = gOvStrokes.back();
        float lx, ly; projWorld(pr, st.pts.back()[0], st.pts.back()[1], st.pts.back()[2], lx, ly);
        if ((lx - mx) * (lx - mx) + (ly - my) * (ly - my) > 2.5f && st.pts.size() < 20000) {
            float X, Z, h; unprojScreen(pr, cH, mx, my, X, Z, h);
            st.pts.push_back({X, Z, h});
        }
    }
    if (release) {
        if (gStrokeActive) { gStrokeActive = false; gOvDirty = true; if (!gOvStrokes.empty() && gOvStrokes.back().pts.size() < 2) gOvStrokes.pop_back(); }
        gLmbOwner = 0;
    }
}

void drawBits(::MinecraftUIRenderContext& ctx, uint8_t const* rows, float cx, float cy, float px, ::mce::Color const& c, bool outline) {
    float x0 = cx - 3.5f * px, y0 = cy - 3.5f * px;
    auto  pass = [&](float ox, float oy, ::mce::Color const& cc, float a) {
        for (int r = 0; r < 7; ++r)
            for (int q = 0; q < 7; ++q)
                if (rows[r] & (1 << (6 - q))) rect(ctx, x0 + float(q) * px + ox, y0 + float(r) * px + oy, x0 + float(q + 1) * px + ox, y0 + float(r + 1) * px + oy, cc, a);
    };
    if (outline) { ::mce::Color k{0.0f, 0.0f, 0.0f, 1.0f}; pass(-0.7f, 0, k, 0.85f); pass(0.7f, 0, k, 0.85f); pass(0, -0.7f, k, 0.85f); pass(0, 0.7f, k, 0.85f); }
    pass(0, 0, c, 1.0f);
}

void drawIcon(::MinecraftUIRenderContext& ctx, char const* const* ico, BtnR const& b, ::mce::Color const& c) {
    float px = 1.6f, x0 = (b.x0 + b.x1) * 0.5f - 4.5f * px, y0 = (b.y0 + b.y1) * 0.5f - 4.5f * px;
    for (int r = 0; r < 9; ++r)
        for (int q = 0; q < 9; ++q)
            if (ico[r][q] == '#') rect(ctx, x0 + float(q) * px, y0 + float(r) * px, x0 + float(q + 1) * px, y0 + float(r + 1) * px, c, 1.0f);
}

void bigMapOverlayDraw(::MinecraftUIRenderContext& ctx, ::IClientInstance& client, float sw, float sh, float size, float tx, float tz, float cH, float mx, float my, bool mv) {
    Proj pr = makeProj(sw, sh, size, tx, tz, cH);
    // strokes, route line/flag and markers: rasterised into ONE texture (a few hundred rect calls per frame made the map crawl).
    // The texture is re-made only when the data changes or the view moved far from it; in between it is reprojected (affine) onto the current view.
    bool anyOv = !gOvStrokes.empty() || !gOvMarkers.empty() || gOvRoute;
    if (anyOv) {
        constexpr float kM = 0.25f;
        float           u0 = -kM * sw, v0 = -kM * sh, Wu = (1.0f + 2.0f * kM) * sw, Hu = (1.0f + 2.0f * kM) * sh;
        uint64_t        hsh = 1469598103934665603ull;
        auto            mix = [&](uint32_t v) { hsh = (hsh ^ v) * 1099511628211ull; };
        auto            fb  = [](float f) { uint32_t u; std::memcpy(&u, &f, 4); return u; };
        mix(uint32_t(gOvStrokes.size())); mix(uint32_t(gOvMarkers.size())); mix(gOvRoute ? 1u : 0u);
        for (auto const& st : gOvStrokes) { mix(uint32_t(st.pts.size())); mix(uint32_t(st.col)); if (!st.pts.empty()) { mix(fb(st.pts.back()[0])); mix(fb(st.pts.back()[1])); } }
        for (auto const& m : gOvMarkers) { mix(uint32_t(m.type)); mix(fb(m.x)); mix(fb(m.z)); }
        if (gOvRoute) { mix(fb(gOvRX)); mix(fb(gOvRZ)); mix(fb(gSX)); mix(fb(gSZ)); }
        float r1 = pr.s / (gOvP.s > 0 ? gOvP.s : pr.s);
        float dxu = (gOvP.pcx - pr.pcx) * pr.s, dyu = (gOvP.pcy - pr.pcy) * pr.s;
        bool  drift = !gOvHas || r1 < 0.85f || r1 > 1.18f || std::fabs(dxu) > 0.2f * sw || std::fabs(dyu) > 0.2f * sh;
        if ((hsh != gOvHash || drift) && !gOvTex.pending) {
            gOvBuf.assign(size_t(kOvW) * kOvW, 0u);
            float kx = float(kOvW) / Wu, ky = float(kOvW) / Hu;
            auto  fill = [&](float x0, float y0, float x1, float y1, uint32_t col) {
                int ix0 = std::max(0, int(std::floor((x0 - u0) * kx))), ix1 = std::min(kOvW, int(std::ceil((x1 - u0) * kx)));
                int iy0 = std::max(0, int(std::floor((y0 - v0) * ky))), iy1 = std::min(kOvW, int(std::ceil((y1 - v0) * ky)));
                for (int yy = iy0; yy < iy1; ++yy) for (int xx = ix0; xx < ix1; ++xx) gOvBuf[size_t(yy) * kOvW + size_t(xx)] = col;
            };
            auto packc = [](float r, float g, float b) { return 0xFF000000u | (uint32_t(std::clamp(r, 0.0f, 1.0f) * 255.0f) << 16) | (uint32_t(std::clamp(g, 0.0f, 1.0f) * 255.0f) << 8) | uint32_t(std::clamp(b, 0.0f, 1.0f) * 255.0f); };
            for (auto const& st : gOvStrokes) {
                uint32_t col = packc(kDrawCol[st.col % kDrawCols][0], kDrawCol[st.col % kDrawCols][1], kDrawCol[st.col % kDrawCols][2]);
                float px0 = 0, py0 = 0; bool have = false;
                for (auto const& q : st.pts) {
                    float sx, sy; projWorld(pr, q[0], q[1], q[2], sx, sy);
                    if (have) {
                        float d = std::sqrt((sx - px0) * (sx - px0) + (sy - py0) * (sy - py0));
                        int   n = std::clamp(int(d / 0.8f) + 1, 1, 600);
                        for (int k = 0; k <= n; ++k) {
                            float t = float(k) / float(n), cx = px0 + (sx - px0) * t, cy = py0 + (sy - py0) * t;
                            if (cx > u0 - 4 && cx < u0 + Wu + 4 && cy > v0 - 4 && cy < v0 + Hu + 4) fill(cx - 1.0f, cy - 1.0f, cx + 1.0f, cy + 1.0f, col);
                        }
                    }
                    px0 = sx; py0 = sy; have = true;
                }
            }
            auto bits = [&](uint8_t const* rows, float cx, float cy, float pxs, uint32_t col, bool outline) {
                float x0 = cx - 3.5f * pxs, y0 = cy - 3.5f * pxs;
                for (int pass = outline ? 0 : 1; pass < 2; ++pass)
                    for (int r = 0; r < 7; ++r)
                        for (int q = 0; q < 7; ++q)
                            if (rows[r] & (1 << (6 - q))) {
                                float e = pass == 0 ? 0.55f : 0.0f;
                                fill(x0 + float(q) * pxs - e, y0 + float(r) * pxs - e, x0 + float(q + 1) * pxs + e, y0 + float(r + 1) * pxs + e, pass == 0 ? 0xFF000000u : col);
                            }
            };
            if (gOvRoute) {
                float fx, fy, ax, ay;
                projWorld(pr, gOvRX, gOvRZ, gOvRH, fx, fy);
                projWorld(pr, gSX, gSZ, gSY - 1.6f, ax, ay);
                float d = std::sqrt((fx - ax) * (fx - ax) + (fy - ay) * (fy - ay));
                int   n = std::clamp(int(d / 7.0f), 0, 400);
                uint32_t oc = packc(1.0f, 0.62f, 0.12f);
                for (int k = 1; k < n; ++k) {
                    float t = float(k) / float(n), cx = ax + (fx - ax) * t, cy = ay + (fy - ay) * t;
                    if (cx > u0 && cx < u0 + Wu && cy > v0 && cy < v0 + Hu) fill(cx - 1.0f, cy - 1.0f, cx + 1.0f, cy + 1.0f, oc);
                }
                for (int pass = 0; pass < 2; ++pass)
                    for (int r = 0; r < 9; ++r)
                        for (int q = 0; q < 9; ++q)
                            if (kIcoFlag[r][q] == '#') {
                                float e = pass == 0 ? 0.55f : 0.0f, x0 = fx - 5.0f + float(q) * 1.3f, y0 = fy - 11.0f + float(r) * 1.3f;
                                fill(x0 - e, y0 - e, x0 + 1.3f + e, y0 + 1.3f + e, pass == 0 ? 0xFF000000u : packc(1.0f, 0.55f, 0.1f));
                            }
            }
            for (auto const& m : gOvMarkers) {
                float sx, sy; projWorld(pr, m.x, m.z, m.h, sx, sy);
                int t = std::clamp(m.type, 0, kMarkerTypes - 1);
                bits(kMarkBits[t], sx, sy - 4.0f, 1.5f, packc(kMarkCol[t][0], kMarkCol[t][1], kMarkCol[t][2]), true);
            }
            if (uploadImage(client, gOvTex, gOvBuf, kOvW)) { gOvTex.pending = true; gOvTex.pendFrame = gFrame; gOvHash = hsh; gOvPendP = pr; gOvHas = true; }
        }
        if (gOvTex.pending && gFrame - gOvTex.pendFrame >= 2) { gOvTex.cur = 1 - gOvTex.cur; gOvTex.pending = false; gOvP = gOvPendP; }
        if (gOvTex.created[gOvTex.cur] && gOvP.s > 0) {
            float rr = pr.s / gOvP.s;
            float qx = sw * 0.5f + (u0 - sw * 0.5f) * rr + (gOvP.pcx - pr.pcx) * pr.s;
            float qy = sh * 0.5f + (v0 - sh * 0.5f) * rr + (gOvP.pcy - pr.pcy) * pr.s;
            drawTileTex(ctx, gOvTex, qx, qy, Wu * rr, Hu * rr, 0.0f, 0.0f, 1.0f, 1.0f);
        }
    } else { gOvHash = 0; gOvHas = false; }
    // ghost of the marker that is about to be placed
    if (mv && gTool == 2 && gMarkType >= 0 && my > 26.0f && my < sh - 34.0f) {
        int t = gMarkType;
        drawBits(ctx, kMarkBits[t], mx, my - 4.0f, 1.5f, ::mce::Color{kMarkCol[t][0], kMarkCol[t][1], kMarkCol[t][2], 0.6f}, false);
    }
    // bottom bar with the tool buttons
    rect(ctx, 0, sh - 32.0f, sw, sh, ::mce::Color{0.02f, 0.03f, 0.05f, 1.0f}, 0.72f);
    ::mce::Color ink{0.93f, 0.95f, 0.98f, 1.0f}, dark{0.06f, 0.08f, 0.11f, 1.0f}, act{0.22f, 0.36f, 0.55f, 1.0f}, red{0.80f, 0.14f, 0.14f, 1.0f};
    char const* const* icons[4] = {kIcoPencil, kIcoPin, kIcoFlag, kIcoTrash};
    for (int i = 0; i < 4; ++i) {
        BtnR b = btnRect(i, sw, sh);
        bool active = (i == 0 && gTool == 1) || (i == 1 && (gMenuMarker || gTool == 2)) || (i == 2 && gTool == 3);
        bool hot    = mv && inR(b, mx, my);
        ::mce::Color bg = (i == 3 && gDeleteMode) ? red : (active ? act : dark);
        rect(ctx, b.x0 - 1, b.y0 - 1, b.x1 + 1, b.y1 + 1, ink, hot ? 0.9f : 0.45f);
        rect(ctx, b.x0, b.y0, b.x1, b.y1, bg, 1.0f);
        drawIcon(ctx, icons[i], b, ink);
    }
    if (gMenuMarker) {
        BtnR p = markPanel(sw, sh);
        rect(ctx, p.x0 - 1, p.y0 - 1, p.x1 + 1, p.y1 + 1, ink, 0.5f);
        rect(ctx, p.x0, p.y0, p.x1, p.y1, dark, 0.96f);
        for (int t = 0; t < kMarkerTypes; ++t) {
            float cx = p.x0 + 3.0f + float(t % 4) * 22.0f + 11.0f, cy = p.y0 + 3.0f + float(t / 4) * 22.0f + 11.0f;
            if (mv && mx >= cx - 11 && mx <= cx + 11 && my >= cy - 11 && my <= cy + 11) rect(ctx, cx - 11, cy - 11, cx + 11, cy + 11, act, 0.8f);
            drawBits(ctx, kMarkBits[t], cx, cy, 2.0f, ::mce::Color{kMarkCol[t][0], kMarkCol[t][1], kMarkCol[t][2], 1.0f}, true);
        }
    }
    if (gTool == 1) {
        BtnR p = colPanel(sw, sh);
        rect(ctx, p.x0 - 1, p.y0 - 1, p.x1 + 1, p.y1 + 1, ink, 0.5f);
        rect(ctx, p.x0, p.y0, p.x1, p.y1, dark, 0.96f);
        for (int c = 0; c < kDrawCols; ++c) {
            float x0 = p.x0 + 3.0f + float(c) * 22.0f;
            if (c == gDrawCol) rect(ctx, x0 - 1, p.y0 + 2, x0 + 21, p.y1 - 2, ink, 0.9f);
            rect(ctx, x0 + 2, p.y0 + 5, x0 + 18, p.y1 - 5, ::mce::Color{kDrawCol[c][0], kDrawCol[c][1], kDrawCol[c][2], 1.0f}, 1.0f);
        }
    }
}

// ---------- animated volumetric fog overlay: port of Diorama fog.fsh (CPU, worker thread, one texture per view) ----------
// Known share per cell comes from the chunk cache: freshly scanned chunks ease from 0 to 1 (the fog parts as chunks load);
// chunks only remembered from disk keep a low haze that thins out as they are scanned again. The fog is a height field marched
// through the tilted camera in 8 layers, shaded from the north-west, with noise that drifts over time.
constexpr int kFogNT = 256;
std::vector<float> gFogNoise; // kFogNT*kFogNT*3, tileable

void fogInitNoise() {
    if (!gFogNoise.empty()) return;
    gFogNoise.assign(size_t(kFogNT) * kFogNT * 3, 0.5f);
    const int Ls[3] = {4, 8, 16};
    uint32_t  rs    = 0x9E3779B9u;
    auto      rnd   = [&]() { rs = rs * 1664525u + 1013904223u; return float((rs >> 8) & 0xFFFF) / 65535.0f; };
    for (int c = 0; c < 3; ++c) {
        int                L = Ls[c];
        std::vector<float> lat(size_t(L) * L);
        for (auto& v : lat) v = rnd();
        for (int y = 0; y < kFogNT; ++y)
            for (int x = 0; x < kFogNT; ++x) {
                float fx = float(x) * float(L) / float(kFogNT), fy = float(y) * float(L) / float(kFogNT);
                int   ix = int(fx), iy = int(fy);
                float tx = fx - float(ix), ty = fy - float(iy);
                tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
                int   x1 = (ix + 1) % L, y1 = (iy + 1) % L;
                float a0 = lat[size_t(iy) * L + ix], b0 = lat[size_t(iy) * L + x1], c0 = lat[size_t(y1) * L + ix], d0 = lat[size_t(y1) * L + x1];
                gFogNoise[(size_t(y) * kFogNT + x) * 3 + c] = (a0 + (b0 - a0) * tx) * (1 - ty) + (c0 + (d0 - c0) * tx) * ty;
            }
    }
}

float fogSamp(int ch, float u, float v) {
    u -= std::floor(u); v -= std::floor(v);
    float x = u * float(kFogNT) - 0.5f, y = v * float(kFogNT) - 0.5f;
    float fx = std::floor(x), fy = std::floor(y);
    float tx = x - fx, ty = y - fy;
    int   x0 = int(fx) & (kFogNT - 1), y0 = int(fy) & (kFogNT - 1), x1 = (x0 + 1) & (kFogNT - 1), y1 = (y0 + 1) & (kFogNT - 1);
    auto  at = [&](int xx, int yy) { return gFogNoise[(size_t(yy) * kFogNT + xx) * 3 + ch]; };
    return (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty;
}

inline float fSstep(float a, float b, float x) { float t = std::clamp((x - a) / (b - a), 0.0f, 1.0f); return t * t * (3.0f - 2.0f * t); }

void fogBoxBlur(std::vector<float>& a, int G, int r) {
    if (r < 1) return;
    std::vector<float> t(a.size()), line(size_t(G) + 2 * r), pre(size_t(G) + 2 * r + 1);
    auto pass = [&](bool horiz, std::vector<float> const& src, std::vector<float>& dst) {
        for (int l = 0; l < G; ++l) {
            for (int k = 0; k < G + 2 * r; ++k) { int sidx = std::clamp(k - r, 0, G - 1); line[size_t(k)] = horiz ? src[size_t(l) * G + sidx] : src[size_t(sidx) * G + l]; }
            pre[0] = 0.0f;
            for (int k = 0; k < G + 2 * r; ++k) pre[size_t(k) + 1] = pre[size_t(k)] + line[size_t(k)];
            for (int k = 0; k < G; ++k) {
                float v = (pre[size_t(k) + 2 * r + 1] - pre[size_t(k)]) / float(2 * r + 1);
                if (horiz) dst[size_t(l) * G + k] = v; else dst[size_t(k) * G + l] = v;
            }
        }
    };
    pass(true, a, t);
    pass(false, t, a);
}

struct FogJob {
    int                G = 0;
    float              cx = 0, cz = 0, blocks = 64;
    bool               round = false, gpu = false;
    float              seconds = 0;
    std::vector<float> known, lift;
};

// GPU fog path: the CPU only prepares the blurred masks (soft, known, lift per cell); the pixel shader does the rest.
void fogMasks(FogJob const& j, std::vector<float>& m) {
    const int    G = j.G;
    const size_t N = size_t(G) * G;
    const float  cellB = j.blocks / float(G);
    const float  stepsF = std::max(0.0f, std::log2(j.blocks / 320.0f)), fogScale = std::exp2(stepsF);
    std::vector<float> nearK = j.known, wideK = j.known, lift = j.lift;
    fogBoxBlur(nearK, G, std::clamp(int(std::lround(7.0f * fogScale / cellB)), 1, 24));
    fogBoxBlur(wideK, G, std::clamp(int(std::lround(18.0f * fogScale / cellB)), 2, 48));
    fogBoxBlur(lift, G, 1);
    m.resize(N * 3);
    for (size_t i = 0; i < N; ++i) { m[i * 3] = j.known[i] < 0.5f ? std::min(0.5f * (nearK[i] + wideK[i]), 0.25f) : 0.5f * (nearK[i] + wideK[i]); m[i * 3 + 1] = j.known[i]; m[i * 3 + 2] = lift[i]; }
}

void fogCompute(FogJob const& j, std::vector<uint32_t>& out) {
    fogInitNoise();
    const int G = j.G;
    const size_t N = size_t(G) * G;
    out.assign(N, 0);
    const float cellB = j.blocks / float(G);
    const float stepsF = std::max(0.0f, std::log2(j.blocks / 320.0f)), steps = std::floor(stepsF), frac = stepsF - steps, fogScale = std::exp2(stepsF);
    const float fogHeight = 10.0f;
    std::vector<float> nearK = j.known, wideK = j.known, lift = j.lift;
    fogBoxBlur(nearK, G, std::clamp(int(std::lround(7.0f * fogScale / cellB)), 1, 24));
    fogBoxBlur(wideK, G, std::clamp(int(std::lround(18.0f * fogScale / cellB)), 2, 48));
    fogBoxBlur(lift, G, 1);
    std::vector<float> soft(N);
    for (size_t i = 0; i < N; ++i) soft[i] = j.known[i] < 0.5f ? std::min(0.5f * (nearK[i] + wideK[i]), 0.25f) : 0.5f * (nearK[i] + wideK[i]);

    auto bil = [&](std::vector<float> const& g, float fx, float fy) {
        fx = std::clamp(fx - 0.5f, 0.0f, float(G - 1)); fy = std::clamp(fy - 0.5f, 0.0f, float(G - 1));
        int   x0 = int(fx), y0 = int(fy), x1 = std::min(x0 + 1, G - 1), y1 = std::min(y0 + 1, G - 1);
        float tx = fx - float(x0), ty = fy - float(y0);
        return (g[size_t(y0) * G + x0] * (1 - tx) + g[size_t(y0) * G + x1] * tx) * (1 - ty) + (g[size_t(y1) * G + x0] * (1 - tx) + g[size_t(y1) * G + x1] * tx) * ty;
    };
    const float t = std::fmod(j.seconds, 1200.0f) / 1200.0f;
    auto layerN = [&](float nx, float nz) {
        float a = fogSamp(0, nx + 5.0f * t, nz + 2.0f * t), b = fogSamp(1, nx - 8.0f * t, nz + 3.0f * t), c = fogSamp(2, nx + 13.0f * t, nz - 9.0f * t);
        float n = a * 0.55f + b * 0.30f + c * 0.15f;
        return std::clamp(0.5f + (n - 0.5f) * 1.9f, 0.0f, 1.0f);
    };
    const float inv = 1.0f / (512.0f * std::exp2(steps + 1.0f));
    auto noiseAt = [&](float wx, float wz) {
        float cx = wx * inv, cz = wz * inv;
        float fine = layerN(cx * 2.0f, cz * 2.0f);
        return frac == 0.0f ? fine : fine + (layerN(cx, cz) - fine) * frac;
    };
    auto thicknessFrom = [&](float known, float n, float lf) {
        float unknown = 1.0f - known;
        float edge    = fSstep(0.0f, 0.35f, unknown);
        float amount  = fSstep(0.12f, 0.75f, unknown + (n - 0.5f) * 1.5f * edge);
        return fogHeight * (0.12f + 0.88f * lf) * amount * (0.45f + 0.75f * n);
    };
    auto thicknessAt = [&](float gx, float gy) {
        float known = bil(soft, gx, gy);
        if (known >= 0.95f) return 0.0f;
        float wx = j.cx + (gx - float(G) * 0.5f) * cellB, wz = j.cz + (gy - float(G) * 0.5f) * cellB / KY;
        return thicknessFrom(known, noiseAt(wx, wz), bil(lift, gx, gy));
    };
    auto h2 = [](int x, int y) { uint32_t h = uint32_t(x) * 374761393u + uint32_t(y) * 668265263u; h = (h ^ (h >> 13)) * 1274126177u; return float((h ^ (h >> 16)) & 0xFFFF) / 65535.0f; };
    const float lg = std::log2(std::max(cellB, 1e-3f)), q0 = std::exp2(std::floor(lg)), tq = lg - std::floor(lg);
    const float vx[3] = {0.97f, 0.97f, 0.99f}, vs[3] = {0.48f, 0.55f, 0.67f};
    const int   LAYERS = 8;
    const float sunDx = -9.0f * fogScale / cellB, sunDy = -0.4f * 9.0f * fogScale / cellB;
    const float rad = float(G) * 0.5f;
    for (int jy = 0; jy < G; ++jy)
        for (int ix = 0; ix < G; ++ix) {
            size_t idx = size_t(jy) * G + ix;
            float  px = float(ix) + 0.5f, py = float(jy) + 0.5f;
            float  softHere = soft[idx], knownHere = j.known[idx], liftHere = bil(lift, px, py);
            float  wx = j.cx + (px - rad) * cellB, wz = j.cz + (py - rad) * cellB / KY;
            float  jit = (h2(int(std::floor(wx / q0)), int(std::floor(wz / q0))) * (1.0f - tq) + h2(int(std::floor(wx / (q0 * 2))), int(std::floor(wz / (q0 * 2)))) * tq) - 0.5f;
            float  cr = 0, cg = 0, cb = 0, alpha = 0;
            if (softHere < 0.999f || bil(soft, px, py + fogHeight * HS / cellB) < 0.95f) {
                for (int L = 0; L < LAYERS; ++L) {
                    float h  = fogHeight * (1.0f - (float(L) + 0.5f + jit * 0.6f) / float(LAYERS));
                    float gy = py + h * HS / cellB;
                    float th = thicknessAt(px, gy);
                    float a  = fSstep(h - 1.4f, h + 1.4f, th);
                    if (a <= 0.002f) continue;
                    float toward = thicknessAt(px + sunDx, gy + sunDy);
                    float occ    = std::clamp((toward - th) / fogHeight * 2.2f, 0.0f, 1.0f);
                    float light  = std::clamp(0.2f + 0.7f * (h / fogHeight) + 0.3f - occ * 0.7f, 0.0f, 1.0f);
                    float la     = a * 0.45f;
                    float k      = (1.0f - alpha) * la;
                    cr += k * (vs[0] + (vx[0] - vs[0]) * light); cg += k * (vs[1] + (vx[1] - vs[1]) * light); cb += k * (vs[2] + (vx[2] - vs[2]) * light);
                    alpha += k;
                    if (alpha > 0.985f) break;
                }
                float floorFog = fSstep(0.5f, 2.5f, thicknessAt(px, py)) * fSstep(0.3f, 0.9f, liftHere);
                cr += (1 - alpha) * floorFog * vs[0]; cg += (1 - alpha) * floorFog * vs[1]; cb += (1 - alpha) * floorFog * vs[2];
                alpha += (1 - alpha) * floorFog;
                alpha *= 1.0f - 0.85f * fSstep(0.45f, 0.95f, softHere);
                float empty = (1.0f - fSstep(0.3f, 0.85f, knownHere)) * fSstep(0.7f, 1.0f, liftHere);
                float ccr = alpha > 0.02f ? cr / alpha : vs[0] + (vx[0] - vs[0]) * 0.7f, ccg = alpha > 0.02f ? cg / alpha : vs[1] + (vx[1] - vs[1]) * 0.7f,
                      ccb = alpha > 0.02f ? cb / alpha : vs[2] + (vx[2] - vs[2]) * 0.7f;
                cr += (1 - alpha) * empty * ccr; cg += (1 - alpha) * empty * ccg; cb += (1 - alpha) * empty * ccb;
                alpha += (1 - alpha) * empty;
            }
            if (j.round) {
                float dx = px - rad, dy = py - rad, d = std::sqrt(dx * dx + dy * dy);
                alpha *= std::clamp((rad - d) / 1.5f, 0.0f, 1.0f) * 1.0f;
            }
            float or_ = vs[0] + (vx[0] - vs[0]) * 0.7f, og = vs[1] + (vx[1] - vs[1]) * 0.7f, ob = vs[2] + (vx[2] - vs[2]) * 0.7f;
            if (alpha > 0.002f) { or_ = cr / alpha; og = cg / alpha; ob = cb / alpha; } else alpha = 0.0f;
            auto b8 = [](float v) { return uint32_t(std::clamp(v, 0.0f, 1.0f) * 255.0f + 0.5f); };
            out[idx] = (b8(alpha) << 24) | (b8(or_) << 16) | (b8(og) << 8) | b8(ob);
        }
}

struct FogView {
    Tex                   tex;
    bool                  jobReady = false, running = false, resultReady = false, shown = false;
    FogJob                job;
    std::vector<uint32_t> out;
    std::vector<float>    maskOut;
    bool                  resultGpu = false;
    int                   G = 0;
    float                 rCx = 0, rCz = 0, rBl = 64;    // params of the finished result
    float                 pCx = 0, pCz = 0, pBl = 64;    // of the upload in flight
    float                 sCx = 0, sCz = 0, sBl = 64;    // of the displayed texture
    uint64_t              lastReq = 0, lastBuildTick = 0;
};
FogView                 gFogMini, gFogBig;
std::mutex              gFogMx;
std::condition_variable gFogCv;
std::thread             gFogThread;
bool                    gFogStop = false, gFogStarted = false;
uint64_t                gFogStamp = 0;

void fogWorkerMain() {
    for (;;) {
        FogView* v = nullptr;
        FogJob   job;
        {
            std::unique_lock<std::mutex> lk(gFogMx);
            gFogCv.wait(lk, [] { return gFogStop || gFogMini.jobReady || gFogBig.jobReady; });
            if (gFogStop) return;
            v   = gFogBig.jobReady ? &gFogBig : &gFogMini;
            job = std::move(v->job);
            v->jobReady = false;
            v->running  = true;
        }
        std::vector<uint32_t> out;
        std::vector<float>    masks;
        try { if (job.gpu) fogMasks(job, masks); else fogCompute(job, out); } catch (...) { out.clear(); masks.clear(); }
        {
            std::lock_guard<std::mutex> lk(gFogMx);
            if (!out.empty() || !masks.empty()) {
                v->out = std::move(out); v->maskOut = std::move(masks); v->resultGpu = job.gpu;
                v->G = job.G; v->rCx = job.cx; v->rCz = job.cz; v->rBl = job.blocks; v->resultReady = true;
            }
            v->running = false;
        }
    }
}

void fogBuildMask(FogJob& j, int G, float cx, float cz, float blocks, bool round, float dt, bool gate) {
    auto& chunks = gate ? gFogChunksBig : gFogChunks;
    j.G = G; j.cx = cx; j.cz = cz; j.blocks = blocks; j.round = round;
    size_t N = size_t(G) * G;
    j.known.assign(N, 0.0f);
    j.lift.assign(N, 1.0f);
    float cellB = blocks / float(G);
    float ease  = 1.0f - std::exp(-std::clamp(dt, 0.0f, 0.5f) / 0.45f);
    ++gFogStamp;
    std::lock_guard<std::mutex> lk(gMapMx);
    int64_t lastKey = INT64_MIN; float lk_ = 0.0f, ll_ = 1.0f;
    std::unordered_map<int64_t, char> rdyCache; // readiness is per tile, not per chunk: ~64x fewer tile lookups
    for (int jy = 0; jy < G; ++jy)
        for (int ix = 0; ix < G; ++ix) {
            float wx = cx + (float(ix) + 0.5f - float(G) * 0.5f) * cellB, wz = cz + (float(jy) + 0.5f - float(G) * 0.5f) * cellB / KY;
            int   ccx = floorDiv16(int(std::floor(wx))), ccz = floorDiv16(int(std::floor(wz)));
            int64_t kk = key(ccx, ccz);
            if (kk != lastKey) {
                lastKey = kk; lk_ = 0.0f; ll_ = 1.0f;
                if (gKnown.count(kk)) { // fog only over chunks without any map data
                    auto fi = chunks.find(kk);
                    bool rdy = true;
                    if (gate) {
                        int64_t tk = key(fdiv(ccx * 16, kTileX), fdiv(ccz * 16, kTileZ));
                        auto    ri = rdyCache.find(tk);
                        if (ri == rdyCache.end()) ri = rdyCache.emplace(tk, fogChunkReady(ccx, ccz) ? 1 : 0).first;
                        rdy = ri->second != 0;
                    }
                    if (fi == chunks.end()) {
                        FogChunk fc;
                        fc.k = (rdy && gFrame - gFogEpoch >= 600) ? 1.0f : 0.0f;
                        fi   = chunks.emplace(kk, fc).first;
                    }
                    FogChunk& fc = fi->second;
                    if (fc.stamp != gFogStamp) {
                        fc.stamp = gFogStamp;
                        if (rdy) fc.k += (1.0f - fc.k) * ease;
                    }
                    lk_ = fc.k;
                }
            }
            j.known[size_t(jy) * G + ix] = lk_;
            j.lift[size_t(jy) * G + ix]  = ll_;
        }
    // grow the unknown area by one cell: small holes and the border get a full cloud instead of a thin veil
    {
        std::vector<float> o = j.known;
        for (int y = 0; y < G; ++y)
            for (int x = 0; x < G; ++x) {
                size_t i = size_t(y) * G + x;
                float  m = j.known[i];
                if (x > 0) m = std::min(m, j.known[i - 1]);
                if (x < G - 1) m = std::min(m, j.known[i + 1]);
                if (y > 0) m = std::min(m, j.known[i - G]);
                if (y < G - 1) m = std::min(m, j.known[i + G]);
                o[i] = m;
            }
        j.known.swap(o);
    }
}

// Uploads a finished fog image, swaps buffers and queues the next job. (cx,cz) = world point at the view centre.
void fogTick(::IClientInstance& client, FogView& v, int G, float cx, float cz, float blocks, bool round, float dt, bool gate) {
    if (!gFogStarted) { gFogStarted = true; gFogStop = false; gFogThread = std::thread(fogWorkerMain); }
    static bool noiseSent = false;
    if (!noiseSent) { noiseSent = true; fogInitNoise(); gpu::fogSetNoise(gFogNoise.data(), kFogNT); }
    const bool gpuMode = gpu::fogActive();
    const int  viewIdx = (&v == &gFogBig) ? 1 : 0;
    if (v.tex.pending && gFrame - v.tex.pendFrame >= 2) { v.tex.cur = 1 - v.tex.cur; v.tex.pending = false; v.shown = true; v.sCx = v.pCx; v.sCz = v.pCz; v.sBl = v.pBl; }
    if (!v.tex.pending) {
        std::vector<uint32_t> img; std::vector<float> msk; float rcx = 0, rcz = 0, rbl = 64; int rg = 0; bool resGpu = false;
        {
            std::lock_guard<std::mutex> lk(gFogMx);
            if (v.resultReady) { img = std::move(v.out); msk = std::move(v.maskOut); resGpu = v.resultGpu; rg = v.G; rcx = v.rCx; rcz = v.rCz; rbl = v.rBl; v.resultReady = false; }
        }
        if (resGpu) {
            if (gpuMode && !msk.empty()) { gpu::fogSetMask(viewIdx, rg, rcx, rcz, rbl, msk.data()); v.shown = true; v.sCx = rcx; v.sCz = rcz; v.sBl = rbl; }
        } else if (!gpuMode && !img.empty() && uploadImage(client, v.tex, img, rg)) { v.tex.pending = true; v.tex.pendFrame = gFrame; v.pCx = rcx; v.pCz = rcz; v.pBl = rbl; }
    }
    bool busy;
    { std::lock_guard<std::mutex> lk(gFogMx); busy = v.jobReady || v.running; }
    if (!busy && gFrame - v.lastReq >= (gate ? 6u : 3u)) { // the big map rebuilds its mask less often (cost grows with the view)
        uint64_t now = GetTickCount64();
        float    el  = v.lastBuildTick ? float(now - v.lastBuildTick) / 1000.0f : 0.1f;
        v.lastBuildTick = now;
        FogJob job;
        job.seconds = float(std::fmod(double(now) / 1000.0, 1200.0));
        job.gpu = gpuMode;
        fogBuildMask(job, G, cx, cz, blocks, round, el, gate);
        v.lastReq = gFrame;
        { std::lock_guard<std::mutex> lk(gFogMx); v.job = std::move(job); v.jobReady = true; }
        gFogCv.notify_one();
    }
}

// Draws the displayed fog texture where its world area lies now (it may be a few frames old), cropped to (cx0,cy0,cx1,cy1).
void fogDraw(::MinecraftUIRenderContext& ctx, FogView& v, float scrCx, float scrCy, float pxPerBlock, float curCx, float curCz,
             float cx0, float cy0, float cx1, float cy1, float guiW, float guiH, bool round) {
    if (gpu::fogActive()) {
        // the pixel shader draws the fog in this frame's Present, at full screen resolution
        if (!v.shown) return;
        gpu::FogDraw d;
        d.view = (&v == &gFogBig) ? 1 : 0;
        d.guiW = guiW; d.guiH = guiH; d.scrCx = scrCx; d.scrCy = scrCy; d.pxPerBlock = pxPerBlock; d.curCx = curCx; d.curCz = curCz;
        d.clipX0 = cx0; d.clipY0 = cy0; d.clipX1 = cx1; d.clipY1 = cy1;
        d.round = round; d.roundCx = (cx0 + cx1) * 0.5f; d.roundCy = (cy0 + cy1) * 0.5f; d.roundR = (cx1 - cx0) * 0.5f - 1.0f;
        d.ky = KY; d.hs = HS;
        gpu::fogRequest(d);
        return;
    }
    if (!v.shown || !v.tex.created[v.tex.cur]) return;
    float sz = v.sBl * pxPerBlock;
    float x0 = scrCx + (v.sCx - curCx) * pxPerBlock - sz * 0.5f, y0 = scrCy + (v.sCz - curCz) * KY * pxPerBlock - sz * 0.5f;
    float ax = std::max(x0, cx0), ay = std::max(y0, cy0), bx = std::min(x0 + sz, cx1), by = std::min(y0 + sz, cy1);
    if (bx <= ax || by <= ay) return;
    drawTileTex(ctx, v.tex, ax, ay, bx - ax, by - ay, (ax - x0) / sz, (ay - y0) / sz, (bx - ax) / sz, (by - ay) / sz);
}

int gH0Mini = 64, gH0Big = 64;
float gSmoothH = -99999.0f;
float gBigSH = -99999.0f;

} // namespace

void shutdown() {
    removeWheelHook();
    {
        std::lock_guard<std::mutex> lk(gFogMx);
        gFogStop = true;
    }
    gFogCv.notify_all();
    if (gFogThread.joinable()) gFogThread.join();
    gFogStarted = false;
    gFogStop    = false;
    {
        std::lock_guard<std::mutex> lk(gTileMx);
        gTileStop = true;
    }
    gTileCv.notify_all();
    for (auto& th : gTileThreads) if (th.joinable()) th.join();
    gTileThreads.clear();
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
    migQuiesce();
    idxQuiesce();
    loadQuiesce();
    saveAll();
    asyncQuiesce();
    resetSlots();
    clearTiles();
    {
        std::lock_guard<std::mutex> lk(gMapMx);
        gCache.clear();
    }
    gKnown.clear(); gRegions.clear(); gDiskRegions.clear(); gLegacyPending.clear(); gTileDisk.clear();
    gMini = Baked{};
    gBig  = Baked{};
    gWorldKey.clear();
    ++gVersion;
    gBigMap = false;
}

bool gHudHidden = false;
// ---- memory governor: the mod keeps its own RAM under a fixed budget (500 MB) ----
// Every structure is bounded: regions (gRegionCap), tile pixels (gPxCap), live textures (gTexCap), the known-chunk set is a bitmask per region,
// stale fog entries are pruned. The estimate below is checked every 120 frames and the caps are tightened when it nears the budget.
constexpr double kBudgetMB = 500.0;
void memoryGovernor() {
    if (gFrame % 120 != 0) return;
    constexpr double MB = 1048576.0;
    double chunkB = 0; size_t nc = 0, fogS = 0, fogB = 0;
    uint64_t knownB = 0;
    {
        std::lock_guard<std::mutex> lk(gMapMx);
        for (auto const& kv : gCache) {
            chunkB += double(sizeof(ChunkData));
            if (auto const* w = kv.second.walls.get()) chunkB += double(sizeof(WallBlob) + w->bytes.capacity() + 32);
        }
        nc = gCache.size();
        auto prune = [](std::unordered_map<int64_t, FogChunk>& m) { // a pruned entry comes back fully faded: no visual change
            if (gFogStamp < 400) return;
            for (auto it = m.begin(); it != m.end();) { if (it->second.stamp + 400 < gFogStamp) it = m.erase(it); else ++it; }
        };
        prune(gFogChunks); prune(gFogChunksBig);
        fogS = gFogChunks.size(); fogB = gFogChunksBig.size();
        knownB = gKnown.bytes();
    }
    double pxB = 0; for (auto const& kv : gTiles) pxB += double(kv.second.px.capacity()) * 4.0;
    double texB  = double(gLiveTexCount) * 3.0 * MB; // GPU image + the engine's CPU copy, hidden buffer mostly released
    double miscB = double(knownB) + double(fogS + fogB) * 80.0 + double(gTiles.size()) * double(sizeof(Tile) + 64) + 40.0 * MB; // 40 MB: minimap/fog textures, slots, queues
    double est   = (chunkB + pxB + texB + miscB) / MB;
    if (est > kBudgetMB * 0.85) {
        if (gRegionCap > 3) --gRegionCap; else if (gTexCap > 24) gTexCap -= 8; else if (gPxCap > 12) gPxCap -= 6;
    } else if (est < kBudgetMB * 0.5) {
        if (gRegionCap < 6) ++gRegionCap;
        if (gTexCap < 56) gTexCap += 4;
        if (gPxCap < 48) gPxCap += 3;
    }
    if (gFrame % 600 == 0) {
        char b[260];
        std::snprintf(b, sizeof(b), "budget: est %.0f of %.0f MB (chunks %.0f [%zu], tile px %.0f, textures %.0f, other %.0f), caps regions %zu, textures %zu, tile px %zu",
                      est, kBudgetMB, chunkB / MB, nc, pxB / MB, texB / MB, miscB / MB, gRegionCap, gTexCap, gPxCap);
        DioramaMod::getInstance().getSelf().getLogger().info(std::string(b)); fileLog(std::string(b));
    }
}

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

    pumpLoads();
    updateCache(*region, px, pz);
    pumpRegions();
    memoryGovernor();
    if (!gDirtyRegions.empty() && gFrame - gLastSaveFrame >= 600) {
        gLastSaveFrame = gFrame;
        int64_t k = *gDirtyRegions.begin();
        gDirtyRegions.erase(gDirtyRegions.begin());
        if (gRegions.count(k)) saveRegionAsync(int(k >> 32), int(int32_t(uint32_t(k & 0xFFFFFFFFu)))); // never write a region that is not in RAM
    }
    pollInput();
    setBigMapHud(client, gBigMap);
    if (gBigMap != gInputLocked) { client.setDisableInput(gBigMap); client.setSuspendDirectionalInput(gBigMap); gInputLocked = gBigMap; }
    if (!gBigMap && gMouseReleased) { client.grabMouse(); gMouseReleased = false; gDragging = false; }
    float dtf = frameDt();
    {
        static float maxDt = 0, sumDt = 0;
        static int   nDt = 0;
        static bool once = false;
        if (!once) { once = true; fileLog(std::string("minimap3 started, build ") + __DATE__ + " " + __TIME__ + ", dll in use"); }
        maxDt = std::max(maxDt, dtf); sumDt += dtf; ++nDt;
        if (nDt >= 600) {
            char m[200];
            std::snprintf(m, sizeof(m), "perf: %d hook calls, avg dt %.1f ms, max dt %.1f ms, uploads %llu, in-place failed %llu, max upload %.1f ms, bigmap=%d",
                          nDt, 1000.0f * sumDt / float(nDt), 1000.0f * maxDt, (unsigned long long)gPerfUploads, (unsigned long long)gPerfInPlaceFail, gPerfMaxUploadMs, int(gBigMap));
            DioramaMod::getInstance().getSelf().getLogger().info(std::string(m)); fileLog(std::string(m));
            {   // memory report: shows which structure grows (process private bytes vs. what the mod itself holds)
                struct PMC { DWORD cb, pf; SIZE_T peakWs, ws, a, b, c, d, pagefile, peakPf, priv; };
                using Fn = BOOL(WINAPI*)(HANDLE, PMC*, DWORD);
                static Fn fn = reinterpret_cast<Fn>(GetProcAddress(GetModuleHandleA("kernel32.dll"), "K32GetProcessMemoryInfo"));
                PMC pm{}; pm.cb = sizeof(pm);
                double privMb = (fn && fn(GetCurrentProcess(), &pm, sizeof(pm))) ? double(pm.priv) / 1048576.0 : -1.0;
                size_t nCache, nKnown, nFogS, nFogB;
                { std::lock_guard<std::mutex> lk(gMapMx); nCache = gCache.size(); nKnown = gKnown.size(); nFogS = gFogChunks.size(); nFogB = gFogChunksBig.size(); }
                size_t nPx = 0; for (auto& kv : gTiles) if (!kv.second.px.empty()) ++nPx;
                char mm[300];
                std::snprintf(mm, sizeof(mm), "mem: process private %.0f MB, chunks in RAM %zu (~%.0f MB), regions %zu, known %zu, tiles %zu (px in RAM %zu, live textures %zu), fog %zu/%zu",
                              privMb, nCache, double(nCache) * (double(sizeof(ChunkData)) + 7000.0) / 1048576.0, gRegions.size(), nKnown, gTiles.size(), nPx, gLiveTexCount, nFogS, nFogB);
                DioramaMod::getInstance().getSelf().getLogger().info(std::string(mm)); fileLog(std::string(mm));
            }
            maxDt = sumDt = 0; nDt = 0; gPerfMaxUploadMs = 0;
        }
    }
    smoothPlayer(float(pos.x), float(pos.y), float(pos.z), gap, dtf);

    ::RectangleArea screen = ctx.getFullClippingRectangle();
    float           sw     = float(screen._x1) - float(screen._x0);
    float           sh     = float(screen._y1) - float(screen._y0);
    if (sw < 50.0f || sh < 50.0f) return;

    int groundPlayer = groundHeight(px, pz, int(pos.y) - 2);

    ovEnsureLoaded();
    {
        static bool        wasOpen = false, baseMenu = false;
        static std::string baseName;
        if (gBigMap) {
            std::string tn; bool menu = false;
            try { tn = client.getTopScreenName(); menu = client.isShowingMenu(); } catch (...) {}
            if (!wasOpen) { baseName = tn; baseMenu = menu; gpu::bakeLog("big map opened: screen=" + tn + ", menu=" + (menu ? "1" : "0")); }
            else if ((menu && !baseMenu) || tn != baseName) {
                gpu::bakeLog("big map closed: screen is now " + tn + ", menu=" + (menu ? "1" : "0"));
                gBigMap = false; gPanX = gPanZ = 0.0f; gDragging = false; gWheel = 0;
            }
        }
        wasOpen = gBigMap;
    }
    if (!gBigMap) {
        if (gOvDirty) ovSave();
        gTool = 0; gMarkType = -1; gMenuMarker = false; gDeleteMode = false; gLmbOwner = 0; gLmbPrev = false; gStrokeActive = false;
    } else if (gOvDirty && gFrame % 120 == 0 && !gStrokeActive) ovSave();
    if (!gBigMap) tileTick(gSX, gSZ, false);
    evictTileTextures(client);
    if (gBigMap) {
        // fullscreen like Java Diorama: map fills the screen, top bar with coords + chunk count, bottom hint
        float size = std::max(sw, sh);
        float x    = (sw - size) * 0.5f;
        float y    = (sh - size) * 0.5f;
        // --- input: wheel zoom (toward the cursor), left-drag pan ---
        {
            {
                static DWORD lastTick = 0; static POINT lastPos{0, 0}; static bool have = false;
                LASTINPUTINFO lii{sizeof(LASTINPUTINFO), 0};
                POINT         cur{};
                if (GetLastInputInfo(&lii) && GetCursorPos(&cur)) {
                    bool physical = lii.dwTime != lastTick;
                    lastTick = lii.dwTime;
                    RECT  r0{}; POINT cc{};
                    bool  haveC = gHwnd && GetClientRect(gHwnd, &r0) && r0.right > 0;
                    if (haveC) { cc = POINT{r0.right / 2, r0.bottom / 2}; haveC = ClientToScreen(gHwnd, &cc) != 0; }
                    bool toCenter = have && haveC && std::abs(cur.x - cc.x) <= 2 && std::abs(cur.y - cc.y) <= 2 && std::abs(lastPos.x - cc.x) > r0.right / 10;
                    if (have && !physical && (cur.x != lastPos.x || cur.y != lastPos.y)) SetCursorPos(lastPos.x, lastPos.y); // game drift, not the user
                    else if (toCenter) SetCursorPos(lastPos.x, lastPos.y); // the game re-centres the cursor at the side edges: put it back
                    else lastPos = cur;
                    have = true;
                }
            }
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
            bool foc = windowFocused();
            bigMapInput(sw, sh, size, mx, my, mv, foc, gBigSH < -1000.0f ? float(groundPlayer) : gBigSH);
            bool rmb = mv && foc && down(VK_RBUTTON);
            bool panNow = mv && foc && ((gLmbOwner == 3 && down(VK_LBUTTON)) || rmb);
            if (panNow) {
                if (gDragging) {
                    gPanX -= (mx - gLastMX) * gZoom / size;
                    gPanZ -= (my - gLastMY) * gZoom / (size * KY);
                }
                gDragging = true;
                gLastMX = mx; gLastMY = my;
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
            bool panned = std::fabs(gPanX) > 0.01f || std::fabs(gPanZ) > 0.01f;
            int g = panned ? groundPlayer : groundHeight(int(std::floor(tx)), int(std::floor(tz)), gH0Big);
            gH0Big = g;
            if (gBigSH < -1000.0f || gap) gBigSH = float(g);
            { float dH = (float(g) - gBigSH) * (1.0f - std::exp(-dtf / 0.9f)); float mx = 8.0f * dtf; gBigSH += std::clamp(dH, -mx, mx); }
            (void)sH;
        }
        if (!gCfgRead) readConfig();
        Scroll sc{};
        bool   texOk = false;
        { // every frame: the game takes the cursor back otherwise. The call itself nudges the cursor: put it back where it was
            POINT before{}, after{};
            bool  gb = GetCursorPos(&before);
            client.releaseMouse(); gMouseReleased = true;
            if (gb && GetCursorPos(&after) && (after.x != before.x || after.y != before.y)) SetCursorPos(before.x, before.y);
        }
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
        if (texOk) {
            fogTick(client, gFogBig, 256, tx, tz, gZoom * 1.5f, false, dtf, true);
            fogDraw(ctx, gFogBig, sw * 0.5f, sh * 0.5f, size / gZoom, tx, tz, 0.0f, 0.0f, sw, sh, sw, sh, false);
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
        float bar = 26.0f;
        rect(ctx, 0, 0, sw, bar, ::mce::Color{0.02f, 0.03f, 0.05f, 1.0f}, 0.72f); // top bar
        float tabW = textWidth("ПОВЕРХНОСТЬ", 1.5f) + 12.0f;
        rect(ctx, 6, 5, 6 + tabW, 25, ::mce::Color{0.05f, 0.07f, 0.10f, 1.0f}, 0.95f);
        rect(ctx, 6, 24, 6 + tabW, 26, ::mce::Color{0.95f, 0.97f, 1.0f, 1.0f}, 1.0f);
        ::mce::Color white{0.95f, 0.97f, 1.0f, 1.0f};
        drawPixText(ctx, "ПОВЕРХНОСТЬ", 12, 9, 1.5f, white);
        char info[96];
        std::snprintf(info, sizeof(info), "%d, %d, %d   ЧАНКОВ: %d", px, int(pos.y), pz, int(gKnown.size()));
        drawPixText(ctx, info, tabW + 20.0f, 9, 1.5f, white);
        if (gOvRoute) {
            char rt[48];
            std::snprintf(rt, sizeof(rt), "ТОЧКА: %d", int(std::sqrt((gOvRX - gSX) * (gOvRX - gSX) + (gOvRZ - gSZ) * (gOvRZ - gSZ))));
            drawPixText(ctx, rt, sw - textWidth(rt, 1.5f) - 10.0f, 9, 1.5f, ::mce::Color{1.0f, 0.62f, 0.12f, 1.0f});
        }
        {
            POINT cp2{}; RECT cr2{};
            bool  mv2 = gHwnd && GetCursorPos(&cp2) && ScreenToClient(gHwnd, &cp2) && GetClientRect(gHwnd, &cr2) && cr2.right > 0 && cr2.bottom > 0;
            float mx2 = mv2 ? float(cp2.x) * sw / float(cr2.right) : 0.0f, my2 = mv2 ? float(cp2.y) * sh / float(cr2.bottom) : 0.0f;
            bigMapOverlayDraw(ctx, client, sw, sh, size, tx, tz, gBigSH, mx2, my2, mv2);
        }
    } else {
        constexpr float SIZE   = 76.0f;
        constexpr int   VIEW   = 64;          // blocks visible
        constexpr int   NB     = 84;          // blocks baked (10 block margin each side: rare re-bakes)
        float           x      = sw - SIZE - 8.0f;
        float           y      = 7.0f;
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
        if (drawn) {
            constexpr float kFogBlocks = 80.0f; // a margin around the 64 visible blocks, so a slightly old image still covers the window
            fogTick(client, gFogMini, 96, gSX, gSZ, kFogBlocks, gRound, dtf, false);
            fogDraw(ctx, gFogMini, x + SIZE * 0.5f, y + SIZE * 0.5f, SIZE / float(VIEW), gSX, gSZ, x, y, x + SIZE, y + SIZE, sw, sh, gRound);
        }
        if (gOvRoute) { // route point: dot at its position, or on the edge towards it
            float cell = SIZE / float(VIEW), hx = SIZE * 0.5f - 3.0f;
            float ox = (gOvRX - gSX) * cell, oy = (gOvRZ - gSZ) * KY * cell;
            float k = std::max(std::fabs(ox) / hx, std::fabs(oy) / hx);
            bool  inside = k <= 1.0f;
            if (!inside) { ox /= k; oy /= k; }
            float cx = x + SIZE * 0.5f + ox, cy = y + SIZE * 0.5f + oy;
            rect(ctx, cx - 3.0f, cy - 3.0f, cx + 3.0f, cy + 3.0f, ::mce::Color{0.0f, 0.0f, 0.0f, 1.0f}, 0.9f);
            rect(ctx, cx - 2.0f, cy - 2.0f, cx + 2.0f, cy + 2.0f, ::mce::Color{1.0f, 0.55f, 0.1f, 1.0f}, inside ? 1.0f : 0.8f);
        }
        if (!gRound) stoneBorder(ctx, x, y, SIZE);
    }
}

} // namespace diorama_bedrock::minimap
