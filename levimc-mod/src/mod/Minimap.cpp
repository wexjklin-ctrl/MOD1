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
#include "mc/world/level/block/Block.h"
#include "mc/world/level/block/BlockType.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
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
        ::mce::Color mc = block->getBlockType().getMapColor(region, pos, *block);
        float r = mc.r, g = mc.g, b = mc.b;
        if (mc.a < 0.02f || std::max({r, g, b}) < 0.02f) {
            // transparent / unknown map colour: stable pseudo-colour from the block name
            uint32_t hh = 2166136261u;
            for (char ch : name) hh = (hh ^ uint8_t(ch)) * 16777619u;
            r = 0.30f + float(hh & 255) / 255.0f * 0.30f;
            g = 0.30f + float((hh >> 8) & 255) / 255.0f * 0.30f;
            b = 0.30f + float((hh >> 16) & 255) / 255.0f * 0.30f;
        }
        // lift very dark blocks so roofs/asphalt never turn into black holes
        col = pack(0.09f + r * 0.91f, 0.09f + g * 0.91f, 0.09f + b * 0.91f);
    }
    h = int16_t(y);
    return true;
}

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
            }
        }
    }
    cd.scanned  = true;
    cd.lastScan = gFrame;
    if (changed) ++gVersion;
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

// --- baked map: merged rectangles, rebuilt only when needed ---
struct CellRect {
    int      x0, z0, x1, z1;
    uint32_t col;
};

struct Baked {
    int                   cx = INT32_MIN, cz = INT32_MIN, n = 0, step = 0;
    uint64_t              version = 0, frame = 0;
    std::vector<CellRect> rects;
};

uint32_t shadedPacked(Sampler& s, int x, int z, int step) {
    ChunkData* c = s.get(x, z);
    if (!c) return FOG;
    int idx = (z & 15) * 16 + (x & 15);
    uint32_t col = c->color[idx];
    if (!col) return FOG;
    int h = c->height[idx];
    int d = 0;
    if (ChunkData* cn = s.get(x, z - step)) {
        int i2 = ((z - step) & 15) * 16 + (x & 15);
        if (cn->color[i2]) d += h - cn->height[i2];
    }
    if (ChunkData* cw = s.get(x - step, z)) {
        int i2 = (z & 15) * 16 + ((x - step) & 15);
        if (cw->color[i2]) d += h - cw->height[i2];
    }
    d = std::clamp(d, -4, 4);
    if (d == 0) return col;
    float k = 1.0f + float(d) * 0.065f;
    auto  m = [k](uint32_t v) { return std::min(255.0f, float(v) * k) + 0.5f; };
    return 0xFF000000u | (uint32_t(m((col >> 16) & 255)) << 16) | (uint32_t(m((col >> 8) & 255)) << 8) | uint32_t(m(col & 255));
}

void bake(Baked& b, int cx, int cz, int n, int step) {
    b.cx = cx; b.cz = cz; b.n = n; b.step = step;
    b.version = gVersion; b.frame = gFrame;
    b.rects.clear();
    int x0 = cx - (n * step) / 2;
    int z0 = cz - (n * step) / 2;
    Sampler s;
    std::vector<uint32_t> row(size_t(n));
    std::unordered_map<uint64_t, int> prev, cur;
    for (int j = 0; j < n; ++j) {
        for (int i = 0; i < n; ++i) row[size_t(i)] = shadedPacked(s, x0 + i * step, z0 + j * step, step);
        cur.clear();
        int i = 0;
        while (i < n) {
            int e = i + 1;
            while (e < n && row[size_t(e)] == row[size_t(i)]) ++e;
            uint32_t col = row[size_t(i)];
            if (col != FOG) {
                uint64_t k  = (uint64_t(uint32_t(i)) << 32) | uint32_t(e);
                auto     it = prev.find(k);
                if (it != prev.end() && b.rects[size_t(it->second)].col == col) {
                    b.rects[size_t(it->second)].z1 = j + 1;
                    cur[k]                         = it->second;
                } else {
                    b.rects.push_back({i, j, e, j + 1, col});
                    cur[k] = int(b.rects.size()) - 1;
                }
            }
            i = e;
        }
        std::swap(prev, cur);
    }
}

void ensureBaked(Baked& b, int cx, int cz, int n, int step, uint64_t minInterval) {
    bool geom = b.cx != cx || b.cz != cz || b.n != n || b.step != step;
    bool dirty = b.version != gVersion && gFrame - b.frame >= minInterval;
    if (geom || dirty) bake(b, cx, cz, n, step);
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

void drawBaked(::MinecraftUIRenderContext& ctx, Baked const& b, float sx, float sy, float size) {
    float cell = size / float(b.n);
    for (auto const& r : b.rects) {
        rect(ctx, sx + float(r.x0) * cell, sy + float(r.z0) * cell, sx + float(r.x1) * cell + 0.4f,
             sy + float(r.z1) * cell + 0.4f, toColor(r.col));
    }
}

// Dark frame with light bevel, drop shadow, corner studs (Diorama-like).
void frame(::MinecraftUIRenderContext& ctx, float x, float y, float size) {
    ::mce::Color dark{0.04f, 0.04f, 0.05f, 1.0f};
    ::mce::Color edge{0.78f, 0.80f, 0.86f, 1.0f};
    ::mce::Color mid{0.30f, 0.31f, 0.36f, 1.0f};
    rect(ctx, x - 2, y - 2, x + size + 8, y + size + 8, ::mce::Color{0, 0, 0, 1}, 0.30f); // shadow
    rect(ctx, x - 6, y - 6, x + size + 6, y + size + 6, dark);
    rect(ctx, x - 5, y - 5, x + size + 5, y + size + 5, mid);
    rect(ctx, x - 4, y - 4, x + size + 4, y + size + 4, dark);
    rect(ctx, x - 6, y - 6, x + size + 6, y - 5, edge, 0.9f);
    rect(ctx, x - 6, y + size + 5, x + size + 6, y + size + 6, edge, 0.9f);
    rect(ctx, x - 6, y - 6, x - 5, y + size + 6, edge, 0.9f);
    rect(ctx, x + size + 5, y - 6, x + size + 6, y + size + 6, edge, 0.9f);
    rect(ctx, x, y, x + size, y + size, toColor(FOG)); // unexplored background
    for (float cxp : {x - 6, x + size + 3})
        for (float cyp : {y - 6, y + size + 3}) rect(ctx, cxp, cyp, cxp + 3, cyp + 3, edge);
}

// Soft inner vignette over the terrain edges.
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

// Player marker with a short facing indicator (yaw in degrees, 0 = +Z / south).
void marker(::MinecraftUIRenderContext& ctx, float cx, float cy, float s, float yawDeg) {
    float rad = yawDeg * 3.14159265f / 180.0f;
    float dx = -std::sin(rad), dy = std::cos(rad);
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
bool gBigMap     = false;
bool gMWasDown   = false;
int  gBigBlocks  = 160;
int  gPanX       = 0;
int  gPanZ       = 0;

bool windowFocused() {
    HWND fg = GetForegroundWindow();
    if (!fg) return false;
    DWORD pid = 0;
    GetWindowThreadProcessId(fg, &pid);
    return pid == GetCurrentProcessId();
}

bool down(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }

void pollInput() {
    if (!windowFocused()) {
        gMWasDown = false;
        return;
    }
    bool m = down('M');
    if (m && !gMWasDown) {
        gBigMap = !gBigMap;
        gPanX = gPanZ = 0;
    }
    gMWasDown = m;
    if (!gBigMap) return;
    if (down(VK_OEM_PLUS) || down(VK_ADD)) gBigBlocks = std::max(32, gBigBlocks - 2);
    if (down(VK_OEM_MINUS) || down(VK_SUBTRACT)) gBigBlocks = std::min(320, gBigBlocks + 2);
    int step = std::max(1, gBigBlocks / 60);
    if (down(VK_LEFT)) gPanX -= step;
    if (down(VK_RIGHT)) gPanX += step;
    if (down(VK_UP)) gPanZ -= step;
    if (down(VK_DOWN)) gPanZ += step;
    if (down(VK_HOME)) gPanX = gPanZ = 0;
}

} // namespace

void reset() {
    gCache.clear();
    gMini = Baked{};
    gBig  = Baked{};
    ++gVersion;
    gBigMap    = false;
}

void draw(::MinecraftUIRenderContext& ctx, ::IClientInstance& client) {
    ::LocalPlayer* player = client.getLocalPlayer();
    ::BlockSource* region = client.getRegion();
    if (!player || !region) return;
    if (int(region->getDimensionId()) != 0) return; // Overworld only

    ++gFrame;
    auto const& pos = player->getPosition();
    int         px  = int(std::floor(pos.x));
    int         pz  = int(std::floor(pos.z));
    float       yaw = player->getRotation().y;

    updateCache(*region, px, pz);
    pollInput();

    ::RectangleArea screen = ctx.getFullClippingRectangle();
    float           sw     = float(screen._x1) - float(screen._x0);
    float           sh     = float(screen._y1) - float(screen._y0);
    if (sw < 50.0f || sh < 50.0f) return;

    if (gBigMap) {
        float size = std::min(sw, sh) * 0.86f;
        float x    = (sw - size) * 0.5f;
        float y    = (sh - size) * 0.5f;
        int   step = std::max(1, (gBigBlocks + 127) / 128);
        int   n    = gBigBlocks / step;
        int   cx   = px + gPanX, cz = pz + gPanZ;
        ensureBaked(gBig, cx, cz, n, step, 10);
        rect(ctx, 0, 0, sw, sh, ::mce::Color{0.0f, 0.0f, 0.0f, 1.0f}, 0.55f);
        frame(ctx, x, y, size);
        drawBaked(ctx, gBig, x, y, size);
        vignette(ctx, x, y, size);
        float cell = size / float(n);
        float mx   = x + (float(pos.x) - float(cx - (n * step) / 2)) / float(step) * cell;
        float my   = y + (float(pos.z) - float(cz - (n * step) / 2)) / float(step) * cell;
        if (mx > x && mx < x + size && my > y && my < y + size) marker(ctx, mx, my, 2.5f, yaw);
    } else {
        constexpr float SIZE   = 96.0f;
        constexpr int   BLOCKS = 64;
        float           x      = sw - SIZE - 12.0f;
        float           y      = 12.0f;
        ensureBaked(gMini, px, pz, BLOCKS, 1, 6);
        frame(ctx, x, y, SIZE);
        drawBaked(ctx, gMini, x, y, SIZE);
        vignette(ctx, x, y, SIZE);
        float cell = SIZE / float(BLOCKS);
        marker(ctx, x + (float(pos.x) - float(px - BLOCKS / 2)) * cell, y + (float(pos.z) - float(pz - BLOCKS / 2)) * cell, 1.5f, yaw);
    }
}

} // namespace diorama_bedrock::minimap
