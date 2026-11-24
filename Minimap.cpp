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

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

namespace diorama_bedrock::minimap {

namespace {

struct ChunkData {
    std::array<uint32_t, 256> color{}; // 0 = unknown, else 0xFFRRGGBB
    std::array<int16_t, 256>  height{};
};

std::unordered_map<int64_t, ChunkData> gCache;

int64_t key(int cx, int cz) { return (int64_t(cx) << 32) ^ int64_t(uint32_t(cz)); }

int floorDiv16(int v) { return v >> 4; }

uint32_t pack(float r, float g, float b) {
    auto c = [](float v) { return uint32_t(std::clamp(v, 0.0f, 1.0f) * 255.0f + 0.5f); };
    return 0xFF000000u | (c(r) << 16) | (c(g) << 8) | c(b);
}

ChunkData* getChunk(int x, int z) {
    auto it = gCache.find(key(floorDiv16(x), floorDiv16(z)));
    return it == gCache.end() ? nullptr : &it->second;
}

uint32_t colorAt(int x, int z) {
    auto* c = getChunk(x, z);
    return c ? c->color[(z & 15) * 16 + (x & 15)] : 0;
}

bool heightAt(int x, int z, int& out) {
    auto* c = getChunk(x, z);
    if (!c || !c->color[(z & 15) * 16 + (x & 15)]) return false;
    out = c->height[(z & 15) * 16 + (x & 15)];
    return true;
}

void scanColumn(::BlockSource& region, int x, int z) {
    ::BlockPos probe{x, 64, z};
    if (!region.getChunkAt(probe)) return; // not loaded
    int y = int(region.getAboveTopSolidBlock(x, z, true, true)) - 1;
    if (y < region.getMinHeight()) return;
    ::BlockPos pos{x, y, z};
    ::Block const& block = region.getBlock(pos);
    if (block.isAir()) return;

    uint32_t col;
    std::string const& name = block.getTypeName();
    if (name == "minecraft:water" || name == "minecraft:flowing_water") {
        col = pack(0.18f, 0.36f, 0.85f);
    } else {
        ::mce::Color mc = block.getBlockType().getMapColor(region, pos, block);
        col             = pack(mc.r, mc.g, mc.b);
    }
    auto& chunk = gCache[key(floorDiv16(x), floorDiv16(z))];
    int   idx   = (z & 15) * 16 + (x & 15);
    chunk.color[idx]  = col;
    chunk.height[idx] = int16_t(y);
}

// Incremental scan around the player (budget per frame keeps the game smooth).
int gScanIndex = 0;
void updateCache(::BlockSource& region, int px, int pz) {
    constexpr int R      = 80;
    constexpr int SIDE   = R * 2;
    constexpr int BUDGET = 1400;
    for (int i = 0; i < BUDGET; ++i) {
        int idx = gScanIndex++;
        if (gScanIndex >= SIDE * SIDE) gScanIndex = 0;
        scanColumn(region, px - R + (idx % SIDE), pz - R + (idx / SIDE));
    }
}

// Pixel colour with relief shading (lighter if higher than the north-west neighbour).
::mce::Color shaded(int x, int z) {
    uint32_t c = colorAt(x, z);
    if (!c) return ::mce::Color{0.05f, 0.06f, 0.09f, 1.0f}; // fog / unexplored
    float r = ((c >> 16) & 255) / 255.0f, g = ((c >> 8) & 255) / 255.0f, b = (c & 255) / 255.0f;
    int   h = 0, hn = 0, hw = 0;
    float k = 1.0f;
    if (heightAt(x, z, h)) {
        int d = 0;
        if (heightAt(x, z - 1, hn)) d += h - hn;
        if (heightAt(x - 1, z, hw)) d += h - hw;
        k = 1.0f + std::clamp(d, -3, 3) * 0.07f;
    }
    return ::mce::Color{std::min(r * k, 1.0f), std::min(g * k, 1.0f), std::min(b * k, 1.0f), 1.0f};
}

void rect(::MinecraftUIRenderContext& ctx, float x0, float y0, float x1, float y1, ::mce::Color const& c, float a = 1.0f) {
    ::RectangleArea r{};
    r._x0 = x0;
    r._y0 = y0;
    r._x1 = x1;
    r._y1 = y1;
    ctx.fillRectangle(r, c, a);
}

// Draw the terrain square [cx-half, cx+half) x [cz-half, cz+half) into screen rect.
void drawTerrain(::MinecraftUIRenderContext& ctx, float sx, float sy, float size, int cx, int cz, int blocks) {
    float cell = size / float(blocks);
    int   x0   = cx - blocks / 2;
    int   z0   = cz - blocks / 2;
    for (int row = 0; row < blocks; ++row) {
        int z = z0 + row;
        int run = 0;
        ::mce::Color runColor{};
        for (int col = 0; col <= blocks; ++col) {
            ::mce::Color c{};
            bool         same = false;
            if (col < blocks) {
                c    = shaded(x0 + col, z);
                same = run > 0 && c.r == runColor.r && c.g == runColor.g && c.b == runColor.b;
            }
            if (same) {
                ++run;
                continue;
            }
            if (run > 0) {
                float rx1 = sx + float(col) * cell;
                float rx0 = rx1 - float(run) * cell;
                rect(ctx, rx0, sy + float(row) * cell, rx1, sy + float(row + 1) * cell + 0.5f, runColor);
            }
            runColor = c;
            run      = (col < blocks) ? 1 : 0;
        }
    }
}

void frame(::MinecraftUIRenderContext& ctx, float x, float y, float size) {
    ::mce::Color dark{0.04f, 0.04f, 0.05f, 1.0f};
    ::mce::Color edge{0.78f, 0.80f, 0.86f, 1.0f};
    rect(ctx, x - 4, y - 4, x + size + 4, y + size + 4, dark);
    // outer light edge + inner thin edge
    rect(ctx, x - 4, y - 4, x + size + 4, y - 3, edge, 0.9f);
    rect(ctx, x - 4, y + size + 3, x + size + 4, y + size + 4, edge, 0.9f);
    rect(ctx, x - 4, y - 4, x - 3, y + size + 4, edge, 0.9f);
    rect(ctx, x + size + 3, y - 4, x + size + 4, y + size + 4, edge, 0.9f);
}

void marker(::MinecraftUIRenderContext& ctx, float cx, float cy, float s) {
    rect(ctx, cx - s - 1, cy - s - 1, cx + s + 1, cy + s + 1, ::mce::Color{0.0f, 0.0f, 0.0f, 1.0f});
    rect(ctx, cx - s, cy - s, cx + s, cy + s, ::mce::Color{1.0f, 1.0f, 1.0f, 1.0f});
}

// --- input (polled, edge detected; only while our window is focused) ---
bool gBigMap     = false;
bool gMWasDown   = false;
int  gBigBlocks  = 160;
int  gPanX       = 0;
int  gPanZ       = 0;
bool gFirstDraw  = true;

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
    gScanIndex = 0;
    gBigMap    = false;
}

void draw(::MinecraftUIRenderContext& ctx, ::IClientInstance& client) {
    ::LocalPlayer* player = client.getLocalPlayer();
    ::BlockSource* region = client.getRegion();
    if (!player || !region) return;
    if (int(region->getDimensionId()) != 0) return; // Overworld only

    if (gFirstDraw) {
        gFirstDraw = false;
    }

    auto const& pos = player->getPosition();
    int         px  = int(std::floor(pos.x));
    int         pz  = int(std::floor(pos.z));

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
        rect(ctx, 0, 0, sw, sh, ::mce::Color{0.0f, 0.0f, 0.0f, 1.0f}, 0.55f);
        frame(ctx, x, y, size);
        drawTerrain(ctx, x, y, size, px + gPanX, pz + gPanZ, gBigBlocks);
        float cell = size / float(gBigBlocks);
        marker(ctx, x + size * 0.5f + float(-gPanX) * cell + 0.5f * cell,
               y + size * 0.5f + float(-gPanZ) * cell + 0.5f * cell, 2.5f);
    } else {
        constexpr float SIZE   = 96.0f;
        constexpr int   BLOCKS = 64;
        float           x      = sw - SIZE - 10.0f;
        float           y      = 10.0f;
        frame(ctx, x, y, SIZE);
        drawTerrain(ctx, x, y, SIZE, px, pz, BLOCKS);
        marker(ctx, x + SIZE * 0.5f, y + SIZE * 0.5f, 1.5f);
    }
}

} // namespace diorama_bedrock::minimap
