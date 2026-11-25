#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace diorama_bedrock::gpu {

/// Experimental Direct3D 12 path. Off by default; %APPDATA%\minimap2\gpu.txt lines:
///   test=1  magenta square (hook test)
///   fog=1   animated fog overlay drawn by a pixel shader (HLSL) into the game's back buffer
using LogFn = void (*)(std::string const&);
bool install(LogFn logFn);
void uninstall();

/// True once the GPU fog pipeline was built successfully (the CPU fog must then not be drawn).
bool fogActive();

/// One fog draw for the current frame. Units: GUI units (same as the HUD draw calls).
struct FogDraw {
    int   view = 0; // 0 = minimap, 1 = big map
    float guiW = 1, guiH = 1;
    float scrCx = 0, scrCy = 0, pxPerBlock = 1, curCx = 0, curCz = 0;
    float clipX0 = 0, clipY0 = 0, clipX1 = 0, clipY1 = 0;
    bool  round = false;
    float roundCx = 0, roundCy = 0, roundR = 0;
    float ky = 0.5f, hs = 0.8f;
};

/// mask = G*G*3 floats (soft, known, lift) built for the world frame (cx, cz, blocks).
void fogSetMask(int view, int G, float cx, float cz, float blocks, float const* mask);
/// noise = N*N*3 floats in [0,1], tileable.
void fogSetNoise(float const* noise, int N);
/// Asks for the fog to be drawn in this frame's Present (valid for ~2 presents).
void fogRequest(FogDraw const& d);


// ---- GPU shading of map tiles (GpuBake.cpp); enabled by "tilebake=1" in gpu.txt ----
struct BakeIn {
    int W = 0, gn = 0, m = 0, mx = 0, rowsHalf = 0, x0 = 0, cz = 0, maxH = 0;
    uint32_t const* col = nullptr; // gn*m cells, 0 = unknown
    int32_t const*  h   = nullptr;
    float const*    sky = nullptr;
    uint32_t const* rec = nullptr; // 4 samples * W*W records * 6 uints (cell, a, b, y, colour, type); cell = 0xFFFFFFFF none
};
void bakeSetDevice(void* d3d12Device, LogFn logFn);
bool bakeAvailable();
void bakeDisable();
void bakeLog(std::string const& m);
bool bakeShade(BakeIn const& in, std::vector<uint32_t>& px, std::vector<int16_t>& hb);

} // namespace diorama_bedrock::gpu
