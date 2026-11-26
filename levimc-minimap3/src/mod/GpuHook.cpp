// Experimental GPU path, step 1: prove that we can draw into the game's own Direct3D 12 back buffer.
// We hook IDXGISwapChain::Present/Present1 and ID3D12CommandQueue::ExecuteCommandLists (vtable addresses are read from a
// throw-away device + swap chain), then clear a 64x64 rectangle with ClearRenderTargetView on the game's queue.
// If the square appears (top-left, magenta), the real tile/fog shaders can be moved here (step 2).
#include "mod/GpuHook.h"

// LeviLamina's predefine header declares empty stand-ins for a few d3d12.h types; rename them while it is included.
#define D3D12_FEATURE_DATA_D3D12_OPTIONS LL_Stub_D3D12_FEATURE_DATA_D3D12_OPTIONS
#define D3D12_FEATURE_DATA_ARCHITECTURE LL_Stub_D3D12_FEATURE_DATA_ARCHITECTURE
#define D3D12_RAYTRACING_GEOMETRY_DESC LL_Stub_D3D12_RAYTRACING_GEOMETRY_DESC
#include "ll/api/memory/Hook.h"
#undef D3D12_FEATURE_DATA_D3D12_OPTIONS
#undef D3D12_FEATURE_DATA_ARCHITECTURE
#undef D3D12_RAYTRACING_GEOMETRY_DESC

#include <windows.h>

#include <d3d12.h>
#include <dxgi1_4.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <string>
#include <unordered_set>
#include <vector>

namespace diorama_bedrock::gpu {

namespace {

using PresentFn  = HRESULT(STDMETHODCALLTYPE*)(IDXGISwapChain*, UINT, UINT);
using Present1Fn = HRESULT(STDMETHODCALLTYPE*)(IDXGISwapChain1*, UINT, UINT, DXGI_PRESENT_PARAMETERS const*);
using ExecFn     = void(STDMETHODCALLTYPE*)(ID3D12CommandQueue*, UINT, ID3D12CommandList* const*);

void* gPresentTarget = nullptr; void* gPresent1Target = nullptr; void* gExecTarget = nullptr;
PresentFn  gPresentOrig  = nullptr;
Present1Fn gPresent1Orig = nullptr;
ExecFn     gExecOrig     = nullptr;
bool       gInstalled = false, gFailed = false;

std::mutex              gQMx;
ID3D12CommandQueue*     gQueue = nullptr; // last DIRECT queue that executed work
std::unordered_set<void*> gDirectQueues, gOtherQueues;

constexpr UINT kFrames = 4;
struct Ctx {
    ID3D12Device*              dev = nullptr;
    ID3D12CommandAllocator*    alloc[kFrames] = {};
    ID3D12GraphicsCommandList* list = nullptr;
    ID3D12DescriptorHeap*      rtv = nullptr;
    UINT                       rtvInc = 0;
    ID3D12Fence*               fence = nullptr;
    UINT64                     fenceVal = 0, frameVal[kFrames] = {};
    HANDLE                     ev = nullptr;
    UINT                       frame = 0;
    bool                       ok = false;
} gC;

LogFn gLog = nullptr;
void log(std::string const& m) { if (gLog) gLog(m); }

bool initCtx(ID3D12Device* dev, ID3D12CommandQueue*) {
    gC.dev = dev;
    bakeSetDevice(dev, gLog);
    for (UINT i = 0; i < kFrames; ++i)
        if (FAILED(dev->CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_DIRECT, IID_PPV_ARGS(&gC.alloc[i])))) return false;
    if (FAILED(dev->CreateCommandList(0, D3D12_COMMAND_LIST_TYPE_DIRECT, gC.alloc[0], nullptr, IID_PPV_ARGS(&gC.list)))) return false;
    gC.list->Close();
    D3D12_DESCRIPTOR_HEAP_DESC hd{};
    hd.Type = D3D12_DESCRIPTOR_HEAP_TYPE_RTV; hd.NumDescriptors = 8;
    if (FAILED(dev->CreateDescriptorHeap(&hd, IID_PPV_ARGS(&gC.rtv)))) return false;
    gC.rtvInc = dev->GetDescriptorHandleIncrementSize(D3D12_DESCRIPTOR_HEAP_TYPE_RTV);
    if (FAILED(dev->CreateFence(0, D3D12_FENCE_FLAG_NONE, IID_PPV_ARGS(&gC.fence)))) return false;
    gC.ev = CreateEventA(nullptr, FALSE, FALSE, nullptr);
    gC.ok = gC.ev != nullptr;
    return gC.ok;
}

DXGI_FORMAT rtvFormat(DXGI_FORMAT f) {
    switch (f) {
    case DXGI_FORMAT_R8G8B8A8_TYPELESS: return DXGI_FORMAT_R8G8B8A8_UNORM;
    case DXGI_FORMAT_B8G8R8A8_TYPELESS: return DXGI_FORMAT_B8G8R8A8_UNORM;
    default: return f;
    }
}


// =====================================================================================================================
// GPU fog overlay: a pixel shader (port of Diorama fog.fsh via Minimap.cpp's CPU version) drawn into the back buffer.
// The CPU only supplies a small mask texture (soft/known/lift per map cell, RGBA16F) and a tileable noise texture.
// =====================================================================================================================
bool gTestSquare = false, gFogOn = false, gFogBroken = false, gFogWorks = false;

std::mutex gFogMx;
struct MaskSlot {
    int                   G = 0;
    float                 cx = 0, cz = 0, blocks = 64;
    std::vector<uint16_t> data;
    bool                  fresh = false;
    // GPU side (render thread only)
    ID3D12Resource*       tex = nullptr;
    ID3D12Resource*       up = nullptr;
    UINT64                upFence = 0;
    int                   texG = 0;
    D3D12_RESOURCE_STATES st = D3D12_RESOURCE_STATE_COPY_DEST;
    float                 uCx = 0, uCz = 0, uBlocks = 64; // frame of the mask currently on the GPU
    bool                  uValid = false;
} gMask[2];
struct ReqSlot { FogDraw d; int ttl = 0; } gReq[2];
std::vector<uint8_t> gNoiseData; int gNoiseN = 0; bool gNoiseFresh = false;

ID3D12Resource* gNoiseTex = nullptr; ID3D12Resource* gNoiseUp = nullptr; bool gNoiseOnGpu = false;
ID3D12RootSignature* gRS = nullptr; ID3D12PipelineState* gPSO = nullptr; DXGI_FORMAT gPsoFmt = DXGI_FORMAT_UNKNOWN;
ID3DBlob* gVS = nullptr; ID3DBlob* gPS = nullptr;
ID3D12DescriptorHeap* gSrvHeap = nullptr; UINT gSrvInc = 0;
bool gPipeInit = false;

uint16_t f2h(float f) {
    uint32_t x; std::memcpy(&x, &f, 4);
    uint32_t sign = (x >> 16) & 0x8000u;
    int32_t  e    = int32_t((x >> 23) & 0xFFu) - 127 + 15;
    uint32_t m    = x & 0x7FFFFFu;
    if (e <= 0) return uint16_t(sign);
    if (e >= 31) return uint16_t(sign | 0x7C00u);
    return uint16_t(sign | (uint32_t(e) << 10) | (m >> 13));
}

const char* kFogHlsl = R"HLSL(
cbuffer C : register(b0) { float4 V0; float4 V1; float4 V2; float4 V3; float4 V4; };
Texture2D<float4> gMask : register(t0);
Texture2D<float4> gNoise : register(t1);
SamplerState sClamp : register(s0);
SamplerState sWrap : register(s1);

#define GUIPX   V0.xy
#define SCRC    V0.zw
#define PXB     V1.x
#define CUR     V1.yz
#define GN      V1.w
#define MCX     V2.x
#define MCZ     V2.y
#define MB      V2.z
#define SECS    V2.w
#define KY      V3.x
#define HS      V3.y
#define ROUNDF  V3.z
#define ROUNDR  V3.w
#define ROUNDC  V4.xy

struct VSO { float4 pos : SV_Position; };
VSO VSMain(uint id : SV_VertexID) {
    VSO o;
    float2 uv = float2((id << 1) & 2, id & 2);
    o.pos = float4(uv * float2(2.0, -2.0) + float2(-1.0, 1.0), 0.0, 1.0);
    return o;
}

float sstep(float a, float b, float x) { float t = saturate((x - a) / (b - a)); return t * t * (3.0 - 2.0 * t); }
float h2(int x, int y) {
    uint h = asuint(x) * 374761393u + asuint(y) * 668265263u;
    h = (h ^ (h >> 13)) * 1274126177u;
    return float((h ^ (h >> 16)) & 0xFFFFu) / 65535.0;
}
float3 mk(float gx, float gy) { return gMask.SampleLevel(sClamp, float2(gx, gy) / GN, 0).rgb; }

float layerN(float nx, float nz, float t) {
    float a = gNoise.SampleLevel(sWrap, float2(nx + 5.0 * t, nz + 2.0 * t), 0).r;
    float b = gNoise.SampleLevel(sWrap, float2(nx - 8.0 * t, nz + 3.0 * t), 0).g;
    float c = gNoise.SampleLevel(sWrap, float2(nx + 13.0 * t, nz - 9.0 * t), 0).b;
    float n = a * 0.55 + b * 0.30 + c * 0.15;
    return saturate(0.5 + (n - 0.5) * 1.9);
}

float noiseAt(float wx, float wz) {
    float stepsF = max(0.0, log2(MB / 320.0));
    float steps = floor(stepsF), fr = stepsF - steps;
    float inv = 1.0 / (512.0 * exp2(steps + 1.0));
    float t = SECS / 1200.0;
    float cx = wx * inv, cz = wz * inv;
    float fine = layerN(cx * 2.0, cz * 2.0, t);
    return fr == 0.0 ? fine : fine + (layerN(cx, cz, t) - fine) * fr;
}

static const float fogHeight = 10.0;

float thicknessFrom(float known, float n, float lf) {
    float unknown = 1.0 - known;
    float edge = sstep(0.0, 0.35, unknown);
    float amount = sstep(0.12, 0.75, unknown + (n - 0.5) * 1.5 * edge);
    return fogHeight * (0.12 + 0.88 * lf) * amount * (0.45 + 0.75 * n);
}

float thicknessAt(float gx, float gy) {
    float3 m = mk(gx, gy);
    if (m.x >= 0.95) return 0.0;
    float cellB = MB / GN;
    float wx = MCX + (gx - GN * 0.5) * cellB;
    float wz = MCZ + (gy - GN * 0.5) * cellB / KY;
    return thicknessFrom(m.x, noiseAt(wx, wz), m.z);
}

float4 PSMain(float4 sp : SV_Position) : SV_Target {
    float2 gui = sp.xy * GUIPX;
    float wxv = CUR.x + (gui.x - SCRC.x) / PXB;
    float wzv = CUR.y + (gui.y - SCRC.y) / (KY * PXB);
    float cellB = MB / GN;
    float px = (wxv - MCX) / cellB + GN * 0.5;
    float py = (wzv - MCZ) * KY / cellB + GN * 0.5;
    if (px < 0.0 || py < 0.0 || px > GN || py > GN) discard;

    const float3 vx = float3(0.97, 0.97, 0.99);
    const float3 vs3 = float3(0.48, 0.55, 0.67);
    const int LAYERS = 8;
    float stepsF = max(0.0, log2(MB / 320.0));
    float fogScale = exp2(stepsF);
    float sunDx = -9.0 * fogScale / cellB, sunDy = -0.4 * 9.0 * fogScale / cellB;

    float3 mh = mk(px, py);
    float softHere = mh.x, liftHere = mh.z;
    float knownHere = gMask.Load(int3(clamp(int(floor(px)), 0, int(GN) - 1), clamp(int(floor(py)), 0, int(GN) - 1), 0)).g;

    float lg = log2(max(cellB, 1e-3));
    float q0 = exp2(floor(lg)), tq = lg - floor(lg);
    float jit = h2(int(floor(wxv / q0)), int(floor(wzv / q0))) * (1.0 - tq) + h2(int(floor(wxv / (q0 * 2.0))), int(floor(wzv / (q0 * 2.0)))) * tq - 0.5;

    float3 c = float3(0, 0, 0);
    float alpha = 0.0;
    if (softHere < 0.999 || mk(px, py + fogHeight * HS / cellB).x < 0.95) {
        [loop] for (int L = 0; L < LAYERS; ++L) {
            float h = fogHeight * (1.0 - (float(L) + 0.5 + jit * 0.6) / float(LAYERS));
            float gy = py + h * HS / cellB;
            float th = thicknessAt(px, gy);
            float a = sstep(h - 1.4, h + 1.4, th);
            if (a <= 0.002) continue;
            float toward = thicknessAt(px + sunDx, gy + sunDy);
            float occ = saturate((toward - th) / fogHeight * 2.2);
            float light = saturate(0.2 + 0.7 * (h / fogHeight) + 0.3 - occ * 0.7);
            float la = a * 0.45;
            float k = (1.0 - alpha) * la;
            c += k * lerp(vs3, vx, light);
            alpha += k;
            if (alpha > 0.985) break;
        }
        float floorFog = sstep(0.5, 2.5, thicknessAt(px, py)) * sstep(0.3, 0.9, liftHere);
        c += (1.0 - alpha) * floorFog * vs3;
        alpha += (1.0 - alpha) * floorFog;
        alpha *= 1.0 - 0.85 * sstep(0.45, 0.95, softHere);
        float empty = (1.0 - sstep(0.3, 0.85, knownHere)) * sstep(0.7, 1.0, liftHere);
        float3 cc = alpha > 0.02 ? c / alpha : lerp(vs3, vx, 0.7);
        c += (1.0 - alpha) * empty * cc;
        alpha += (1.0 - alpha) * empty;
    }
    float3 outc = lerp(vs3, vx, 0.7);
    if (alpha > 0.002) outc = c / alpha; else alpha = 0.0;
    if (ROUNDF > 0.5) {
        float d = length(gui - ROUNDC);
        alpha *= saturate((ROUNDR - d) / (1.5 * GUIPX.x));
    }
    return float4(saturate(outc), saturate(alpha));
}
)HLSL";

using D3DCompileFn = HRESULT(WINAPI*)(LPCVOID, SIZE_T, LPCSTR, const void*, void*, LPCSTR, LPCSTR, UINT, UINT, ID3DBlob**, ID3DBlob**);

bool compileShaders() {
    HMODULE m = LoadLibraryA("d3dcompiler_47.dll");
    if (!m) { log("GPU fog: d3dcompiler_47.dll not found."); return false; }
    auto fn = reinterpret_cast<D3DCompileFn>(GetProcAddress(m, "D3DCompile"));
    if (!fn) { log("GPU fog: D3DCompile missing."); return false; }
    ID3DBlob* err = nullptr;
    HRESULT   h1 = fn(kFogHlsl, std::strlen(kFogHlsl), "fog.hlsl", nullptr, nullptr, "VSMain", "vs_5_0", 1u << 15 /*OPTIMIZATION_LEVEL3*/, 0, &gVS, &err);
    if (FAILED(h1)) { log(std::string("GPU fog: VS compile failed: ") + (err ? static_cast<const char*>(err->GetBufferPointer()) : "?")); if (err) err->Release(); return false; }
    if (err) { err->Release(); err = nullptr; }
    HRESULT h2 = fn(kFogHlsl, std::strlen(kFogHlsl), "fog.hlsl", nullptr, nullptr, "PSMain", "ps_5_0", 1u << 15, 0, &gPS, &err);
    if (FAILED(h2)) { log(std::string("GPU fog: PS compile failed: ") + (err ? static_cast<const char*>(err->GetBufferPointer()) : "?")); if (err) err->Release(); return false; }
    if (err) err->Release();
    return true;
}

UINT64 alignUp(UINT64 v, UINT64 a) { return (v + a - 1) / a * a; }

ID3D12Resource* mkUpload(ID3D12Device* d, UINT64 size) {
    D3D12_HEAP_PROPERTIES hp{}; hp.Type = D3D12_HEAP_TYPE_UPLOAD;
    D3D12_RESOURCE_DESC rd{};
    rd.Dimension = D3D12_RESOURCE_DIMENSION_BUFFER; rd.Width = size; rd.Height = 1; rd.DepthOrArraySize = 1; rd.MipLevels = 1;
    rd.Format = DXGI_FORMAT_UNKNOWN; rd.SampleDesc.Count = 1; rd.Layout = D3D12_TEXTURE_LAYOUT_ROW_MAJOR;
    ID3D12Resource* r = nullptr;
    if (FAILED(d->CreateCommittedResource(&hp, D3D12_HEAP_FLAG_NONE, &rd, D3D12_RESOURCE_STATE_GENERIC_READ, nullptr, IID_PPV_ARGS(&r)))) return nullptr;
    return r;
}

ID3D12Resource* mkTex(ID3D12Device* d, UINT w, UINT h, DXGI_FORMAT f) {
    D3D12_HEAP_PROPERTIES hp{}; hp.Type = D3D12_HEAP_TYPE_DEFAULT;
    D3D12_RESOURCE_DESC rd{};
    rd.Dimension = D3D12_RESOURCE_DIMENSION_TEXTURE2D; rd.Width = w; rd.Height = h; rd.DepthOrArraySize = 1; rd.MipLevels = 1;
    rd.Format = f; rd.SampleDesc.Count = 1; rd.Layout = D3D12_TEXTURE_LAYOUT_UNKNOWN;
    ID3D12Resource* r = nullptr;
    if (FAILED(d->CreateCommittedResource(&hp, D3D12_HEAP_FLAG_NONE, &rd, D3D12_RESOURCE_STATE_COPY_DEST, nullptr, IID_PPV_ARGS(&r)))) return nullptr;
    return r;
}

void barrier(ID3D12GraphicsCommandList* l, ID3D12Resource* r, D3D12_RESOURCE_STATES a, D3D12_RESOURCE_STATES b) {
    if (a == b) return;
    D3D12_RESOURCE_BARRIER bb{};
    bb.Type = D3D12_RESOURCE_BARRIER_TYPE_TRANSITION; bb.Transition.pResource = r; bb.Transition.Subresource = D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES;
    bb.Transition.StateBefore = a; bb.Transition.StateAfter = b;
    l->ResourceBarrier(1, &bb);
}

// copies tightly packed rows (w*bpp bytes) into the upload buffer and records the copy into tex (tex must be in COPY_DEST)
bool recordUpload(ID3D12GraphicsCommandList* l, ID3D12Resource* tex, ID3D12Resource* up, UINT w, UINT h, UINT bpp, DXGI_FORMAT f, void const* data) {
    UINT64 pitch = alignUp(UINT64(w) * bpp, D3D12_TEXTURE_DATA_PITCH_ALIGNMENT);
    uint8_t* p = nullptr;
    D3D12_RANGE none{0, 0};
    if (FAILED(up->Map(0, &none, reinterpret_cast<void**>(&p))) || !p) return false;
    for (UINT y = 0; y < h; ++y) std::memcpy(p + pitch * y, static_cast<uint8_t const*>(data) + size_t(w) * bpp * y, size_t(w) * bpp);
    up->Unmap(0, nullptr);
    D3D12_TEXTURE_COPY_LOCATION dst{}, src{};
    dst.pResource = tex; dst.Type = D3D12_TEXTURE_COPY_TYPE_SUBRESOURCE_INDEX; dst.SubresourceIndex = 0;
    src.pResource = up; src.Type = D3D12_TEXTURE_COPY_TYPE_PLACED_FOOTPRINT;
    src.PlacedFootprint.Offset = 0; src.PlacedFootprint.Footprint.Format = f;
    src.PlacedFootprint.Footprint.Width = w; src.PlacedFootprint.Footprint.Height = h; src.PlacedFootprint.Footprint.Depth = 1;
    src.PlacedFootprint.Footprint.RowPitch = UINT(pitch);
    l->CopyTextureRegion(&dst, 0, 0, 0, &src, nullptr);
    return true;
}

void waitIdle() {
    if (!gC.fence || !gQueue) return;
    UINT64 v = ++gC.fenceVal;
    gQueue->Signal(gC.fence, v);
    if (gC.fence->GetCompletedValue() < v) { gC.fence->SetEventOnCompletion(v, gC.ev); WaitForSingleObject(gC.ev, 1000); }
}

bool buildRootSig(ID3D12Device* dev) {
    D3D12_DESCRIPTOR_RANGE range{};
    range.RangeType = D3D12_DESCRIPTOR_RANGE_TYPE_SRV; range.NumDescriptors = 2; range.BaseShaderRegister = 0;
    range.RegisterSpace = 0; range.OffsetInDescriptorsFromTableStart = D3D12_DESCRIPTOR_RANGE_OFFSET_APPEND;
    D3D12_ROOT_PARAMETER rp[2]{};
    rp[0].ParameterType = D3D12_ROOT_PARAMETER_TYPE_32BIT_CONSTANTS;
    rp[0].Constants.ShaderRegister = 0; rp[0].Constants.RegisterSpace = 0; rp[0].Constants.Num32BitValues = 20;
    rp[0].ShaderVisibility = D3D12_SHADER_VISIBILITY_PIXEL;
    rp[1].ParameterType = D3D12_ROOT_PARAMETER_TYPE_DESCRIPTOR_TABLE;
    rp[1].DescriptorTable.NumDescriptorRanges = 1; rp[1].DescriptorTable.pDescriptorRanges = &range;
    rp[1].ShaderVisibility = D3D12_SHADER_VISIBILITY_PIXEL;
    D3D12_STATIC_SAMPLER_DESC ss[2]{};
    for (int i = 0; i < 2; ++i) {
        ss[i].Filter = D3D12_FILTER_MIN_MAG_MIP_LINEAR;
        ss[i].AddressU = ss[i].AddressV = ss[i].AddressW = (i == 0 ? D3D12_TEXTURE_ADDRESS_MODE_CLAMP : D3D12_TEXTURE_ADDRESS_MODE_WRAP);
        ss[i].ComparisonFunc = D3D12_COMPARISON_FUNC_NEVER; ss[i].MaxLOD = D3D12_FLOAT32_MAX;
        ss[i].ShaderRegister = UINT(i); ss[i].ShaderVisibility = D3D12_SHADER_VISIBILITY_PIXEL;
    }
    D3D12_ROOT_SIGNATURE_DESC rsd{};
    rsd.NumParameters = 2; rsd.pParameters = rp; rsd.NumStaticSamplers = 2; rsd.pStaticSamplers = ss; rsd.Flags = D3D12_ROOT_SIGNATURE_FLAG_NONE;
    ID3DBlob *blob = nullptr, *err = nullptr;
    HRESULT   hr = D3D12SerializeRootSignature(&rsd, D3D_ROOT_SIGNATURE_VERSION_1, &blob, &err);
    if (FAILED(hr)) { log(std::string("GPU fog: root signature serialize failed: ") + (err ? static_cast<const char*>(err->GetBufferPointer()) : "?")); if (err) err->Release(); return false; }
    hr = dev->CreateRootSignature(0, blob->GetBufferPointer(), blob->GetBufferSize(), IID_PPV_ARGS(&gRS));
    blob->Release();
    if (err) err->Release();
    if (FAILED(hr)) { log("GPU fog: CreateRootSignature failed."); return false; }
    return true;
}

bool buildPso(ID3D12Device* dev, DXGI_FORMAT fmt) {
    D3D12_GRAPHICS_PIPELINE_STATE_DESC pd{};
    pd.pRootSignature = gRS;
    pd.VS = {gVS->GetBufferPointer(), gVS->GetBufferSize()};
    pd.PS = {gPS->GetBufferPointer(), gPS->GetBufferSize()};
    auto& rt = pd.BlendState.RenderTarget[0];
    rt.BlendEnable = TRUE;
    rt.SrcBlend = D3D12_BLEND_SRC_ALPHA; rt.DestBlend = D3D12_BLEND_INV_SRC_ALPHA; rt.BlendOp = D3D12_BLEND_OP_ADD;
    rt.SrcBlendAlpha = D3D12_BLEND_ONE; rt.DestBlendAlpha = D3D12_BLEND_INV_SRC_ALPHA; rt.BlendOpAlpha = D3D12_BLEND_OP_ADD;
    rt.RenderTargetWriteMask = D3D12_COLOR_WRITE_ENABLE_ALL;
    pd.SampleMask = 0xFFFFFFFFu;
    pd.RasterizerState.FillMode = D3D12_FILL_MODE_SOLID; pd.RasterizerState.CullMode = D3D12_CULL_MODE_NONE; pd.RasterizerState.DepthClipEnable = TRUE;
    pd.DepthStencilState.DepthEnable = FALSE; pd.DepthStencilState.StencilEnable = FALSE;
    pd.PrimitiveTopologyType = D3D12_PRIMITIVE_TOPOLOGY_TYPE_TRIANGLE;
    pd.NumRenderTargets = 1; pd.RTVFormats[0] = fmt; pd.SampleDesc.Count = 1;
    if (gPSO) { gPSO->Release(); gPSO = nullptr; }
    HRESULT hr = dev->CreateGraphicsPipelineState(&pd, IID_PPV_ARGS(&gPSO));
    if (FAILED(hr)) { log("GPU fog: CreateGraphicsPipelineState failed, hr=" + std::to_string(unsigned(hr))); return false; }
    gPsoFmt = fmt;
    return true;
}

bool fogEnsurePso(ID3D12Device* dev, DXGI_FORMAT fmt) {
    if (gPSO && gPsoFmt == fmt) return true;
    if (gPSO) waitIdle();
    return buildPso(dev, fmt);
}

bool fogPipeInit(ID3D12Device* dev) {
    gPipeInit = true;
    if (!compileShaders() || !buildRootSig(dev)) return false;
    D3D12_DESCRIPTOR_HEAP_DESC hd{};
    hd.Type = D3D12_DESCRIPTOR_HEAP_TYPE_CBV_SRV_UAV; hd.NumDescriptors = 4; hd.Flags = D3D12_DESCRIPTOR_HEAP_FLAG_SHADER_VISIBLE;
    if (FAILED(dev->CreateDescriptorHeap(&hd, IID_PPV_ARGS(&gSrvHeap)))) { log("GPU fog: descriptor heap failed."); return false; }
    gSrvInc = dev->GetDescriptorHandleIncrementSize(D3D12_DESCRIPTOR_HEAP_TYPE_CBV_SRV_UAV);
    return true;
}

void writeSrv(ID3D12Device* dev, UINT idx, ID3D12Resource* r, DXGI_FORMAT f) {
    D3D12_SHADER_RESOURCE_VIEW_DESC sd{};
    sd.Format = f; sd.ViewDimension = D3D12_SRV_DIMENSION_TEXTURE2D; sd.Shader4ComponentMapping = D3D12_DEFAULT_SHADER_4_COMPONENT_MAPPING;
    sd.Texture2D.MipLevels = 1;
    D3D12_CPU_DESCRIPTOR_HANDLE h = gSrvHeap->GetCPUDescriptorHandleForHeapStart();
    h.ptr += SIZE_T(idx) * gSrvInc;
    dev->CreateShaderResourceView(r, &sd, h);
}

// Uploads pending mask/noise data (record into list). Returns false on a fatal error.
bool fogUploads(ID3D12Device* dev, ID3D12GraphicsCommandList* l) {
    // noise (once)
    {
        std::vector<uint8_t> nd; int nn = 0;
        { std::lock_guard<std::mutex> lk(gFogMx); if (gNoiseFresh) { nd = gNoiseData; nn = gNoiseN; gNoiseFresh = false; } }
        if (!nd.empty() && !gNoiseOnGpu) {
            gNoiseTex = mkTex(dev, UINT(nn), UINT(nn), DXGI_FORMAT_R8G8B8A8_UNORM);
            gNoiseUp  = mkUpload(dev, alignUp(UINT64(nn) * 4, D3D12_TEXTURE_DATA_PITCH_ALIGNMENT) * UINT64(nn));
            if (!gNoiseTex || !gNoiseUp) return false;
            if (!recordUpload(l, gNoiseTex, gNoiseUp, UINT(nn), UINT(nn), 4, DXGI_FORMAT_R8G8B8A8_UNORM, nd.data())) return false;
            barrier(l, gNoiseTex, D3D12_RESOURCE_STATE_COPY_DEST, D3D12_RESOURCE_STATE_PIXEL_SHADER_RESOURCE);
            for (UINT s = 0; s < 2; ++s) writeSrv(dev, s * 2 + 1, gNoiseTex, DXGI_FORMAT_R8G8B8A8_UNORM);
            gNoiseOnGpu = true;
        }
    }
    for (int v = 0; v < 2; ++v) {
        MaskSlot& m = gMask[v];
        std::vector<uint16_t> d; int G = 0; float cx = 0, cz = 0, bl = 64;
        {
            std::lock_guard<std::mutex> lk(gFogMx);
            if (!m.fresh) continue;
            d = std::move(m.data); G = m.G; cx = m.cx; cz = m.cz; bl = m.blocks; m.fresh = false;
        }
        if (G <= 0 || d.size() < size_t(G) * G * 4) continue;
        if (m.tex && m.texG != G) { waitIdle(); m.tex->Release(); m.tex = nullptr; m.up->Release(); m.up = nullptr; m.uValid = false; }
        if (!m.tex) {
            m.tex = mkTex(dev, UINT(G), UINT(G), DXGI_FORMAT_R16G16B16A16_FLOAT);
            m.up  = mkUpload(dev, alignUp(UINT64(G) * 8, D3D12_TEXTURE_DATA_PITCH_ALIGNMENT) * UINT64(G));
            if (!m.tex || !m.up) return false;
            m.texG = G; m.st = D3D12_RESOURCE_STATE_COPY_DEST; m.upFence = 0;
            writeSrv(dev, UINT(v) * 2, m.tex, DXGI_FORMAT_R16G16B16A16_FLOAT);
        }
        // the previous copy out of this upload buffer must have finished before we overwrite it
        if (m.upFence && gC.fence->GetCompletedValue() < m.upFence) { gC.fence->SetEventOnCompletion(m.upFence, gC.ev); WaitForSingleObject(gC.ev, 100); }
        barrier(l, m.tex, m.st, D3D12_RESOURCE_STATE_COPY_DEST);
        if (!recordUpload(l, m.tex, m.up, UINT(G), UINT(G), 8, DXGI_FORMAT_R16G16B16A16_FLOAT, d.data())) return false;
        barrier(l, m.tex, D3D12_RESOURCE_STATE_COPY_DEST, D3D12_RESOURCE_STATE_PIXEL_SHADER_RESOURCE);
        m.st = D3D12_RESOURCE_STATE_PIXEL_SHADER_RESOURCE;
        m.uCx = cx; m.uCz = cz; m.uBlocks = bl; m.uValid = true;
        m.upFence = gC.fenceVal + 1; // the Signal after this list's execution
    }
    return true;
}

void fogDrawAll(ID3D12Device* dev, ID3D12GraphicsCommandList* l, D3D12_CPU_DESCRIPTOR_HANDLE rtv, UINT bbW, UINT bbH, DXGI_FORMAT fmt, FogDraw const* reqs, bool const* want) {
    if (!gNoiseOnGpu) return;
    (void)dev; (void)fmt;
    if (!gPSO) return;
    bool any = false;
    for (int v = 0; v < 2; ++v) any |= want[v] && gMask[v].uValid;
    if (!any) return;
    l->SetGraphicsRootSignature(gRS);
    l->SetPipelineState(gPSO);
    ID3D12DescriptorHeap* hs[1] = {gSrvHeap};
    l->SetDescriptorHeaps(1, hs);
    l->OMSetRenderTargets(1, &rtv, FALSE, nullptr);
    l->IASetPrimitiveTopology(D3D_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    D3D12_VIEWPORT vp{0.0f, 0.0f, float(bbW), float(bbH), 0.0f, 1.0f};
    l->RSSetViewports(1, &vp);
    double secs = std::fmod(double(GetTickCount64()) / 1000.0, 1200.0);
    for (int v = 0; v < 2; ++v) {
        if (!want[v] || !gMask[v].uValid) continue;
        FogDraw const& d = reqs[v];
        MaskSlot&      m = gMask[v];
        float sx = float(bbW) / std::max(d.guiW, 1.0f), sy = float(bbH) / std::max(d.guiH, 1.0f);
        D3D12_RECT sc{LONG(std::floor(d.clipX0 * sx)), LONG(std::floor(d.clipY0 * sy)), LONG(std::ceil(d.clipX1 * sx)), LONG(std::ceil(d.clipY1 * sy))};
        sc.left = std::max<LONG>(sc.left, 0); sc.top = std::max<LONG>(sc.top, 0); sc.right = std::min<LONG>(sc.right, LONG(bbW)); sc.bottom = std::min<LONG>(sc.bottom, LONG(bbH));
        if (sc.right <= sc.left || sc.bottom <= sc.top) continue;
        l->RSSetScissorRects(1, &sc);
        float c[20] = {
            1.0f / sx, 1.0f / sy, d.scrCx, d.scrCy,
            d.pxPerBlock, d.curCx, d.curCz, float(m.texG),
            m.uCx, m.uCz, m.uBlocks, float(secs),
            d.ky, d.hs, d.round ? 1.0f : 0.0f, d.roundR,
            d.roundCx, d.roundCy, 0.0f, 0.0f};
        l->SetGraphicsRoot32BitConstants(0, 20, c, 0);
        D3D12_GPU_DESCRIPTOR_HANDLE gh = gSrvHeap->GetGPUDescriptorHandleForHeapStart();
        gh.ptr += UINT64(v) * 2 * gSrvInc;
        l->SetGraphicsRootDescriptorTable(1, gh);
        l->DrawInstanced(3, 1, 0, 0);
    }
}

void drawSquare(IDXGISwapChain* sc) {
    static bool first = true;
    ID3D12CommandQueue* q;
    { std::lock_guard<std::mutex> lk(gQMx); q = gQueue; }
    if (!q) return;
    IDXGISwapChain3* sc3 = nullptr;
    if (FAILED(sc->QueryInterface(IID_PPV_ARGS(&sc3))) || !sc3) { gFailed = true; log("GPU: swap chain is not IDXGISwapChain3, disabled."); return; }
    UINT idx = sc3->GetCurrentBackBufferIndex();
    ID3D12Resource* bb = nullptr;
    if (FAILED(sc3->GetBuffer(idx, IID_PPV_ARGS(&bb))) || !bb) { sc3->Release(); gFailed = true; log("GPU test: GetBuffer failed, swap chain is not Direct3D 12? disabled."); return; }
    ID3D12Device* dev = nullptr;
    bb->GetDevice(IID_PPV_ARGS(&dev));
    D3D12_RESOURCE_DESC rd = bb->GetDesc();
    if (first) {
        first = false;
        log("GPU test: first Present, back buffer " + std::to_string(rd.Width) + "x" + std::to_string(rd.Height) + " format " + std::to_string(int(rd.Format)));
    }
    if (!gC.ok && dev) {
        if (!initCtx(dev, q)) { gFailed = true; log("GPU test: could not create command objects, disabled."); }
        else log("GPU test: command objects created.");
    }
    // gather this frame's fog requests
    FogDraw reqs[2]; bool want[2] = {false, false};
    if (gFogOn && !gFogBroken) {
        std::lock_guard<std::mutex> lk(gFogMx);
        for (int v = 0; v < 2; ++v)
            if (gReq[v].ttl > 0) { reqs[v] = gReq[v].d; want[v] = true; --gReq[v].ttl; }
    }
    bool wantAny = want[0] || want[1];
    if (gC.ok && dev == gC.dev && (gTestSquare || wantAny)) {
        UINT f = gC.frame++ % kFrames;
        if (gC.fence->GetCompletedValue() < gC.frameVal[f]) { gC.fence->SetEventOnCompletion(gC.frameVal[f], gC.ev); WaitForSingleObject(gC.ev, 100); }
        gC.alloc[f]->Reset();
        gC.list->Reset(gC.alloc[f], nullptr);
        bool fogOk = false;
        if (wantAny) {
            if (!gPipeInit && !fogPipeInit(dev)) { gFogBroken = true; log("GPU fog: pipeline init failed, falling back to the CPU fog."); }
            if (!gFogBroken && !fogEnsurePso(dev, rtvFormat(rd.Format))) { gFogBroken = true; log("GPU fog: pipeline state failed, falling back to the CPU fog."); }
            if (!gFogBroken) {
                if (!fogUploads(dev, gC.list)) { gFogBroken = true; log("GPU fog: texture upload failed, falling back to the CPU fog."); }
                else fogOk = true;
            }
        }
        D3D12_CPU_DESCRIPTOR_HANDLE h = gC.rtv->GetCPUDescriptorHandleForHeapStart();
        h.ptr += SIZE_T(idx % 8) * gC.rtvInc;
        D3D12_RENDER_TARGET_VIEW_DESC rv{};
        rv.Format = rtvFormat(rd.Format); rv.ViewDimension = D3D12_RTV_DIMENSION_TEXTURE2D;
        dev->CreateRenderTargetView(bb, &rv, h);
        D3D12_RESOURCE_BARRIER b{};
        b.Type = D3D12_RESOURCE_BARRIER_TYPE_TRANSITION; b.Transition.pResource = bb; b.Transition.Subresource = D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES;
        b.Transition.StateBefore = D3D12_RESOURCE_STATE_PRESENT; b.Transition.StateAfter = D3D12_RESOURCE_STATE_RENDER_TARGET;
        gC.list->ResourceBarrier(1, &b);
        if (fogOk) {
            fogDrawAll(dev, gC.list, h, UINT(rd.Width), UINT(rd.Height), rtvFormat(rd.Format), reqs, want);
            if (!gFogBroken && !gFogWorks) { gFogWorks = true; log("GPU fog: first fog frame drawn on the GPU (back buffer " + std::to_string(rd.Width) + "x" + std::to_string(rd.Height) + ")."); }
        }
        if (gTestSquare) {
            const FLOAT col[4] = {1.0f, 0.0f, 1.0f, 1.0f};
            D3D12_RECT r{20, 20, 84, 84};
            gC.list->ClearRenderTargetView(h, col, 1, &r);
        }
        std::swap(b.Transition.StateBefore, b.Transition.StateAfter);
        gC.list->ResourceBarrier(1, &b);
        gC.list->Close();
        ID3D12CommandList* ls[1] = {gC.list};
        q->ExecuteCommandLists(1, ls); // note: calls the hooked entry, which only records the queue
        q->Signal(gC.fence, ++gC.fenceVal);
        gC.frameVal[f] = gC.fenceVal;
    }
    if (dev) dev->Release();
    bb->Release();
    sc3->Release();
}

HRESULT STDMETHODCALLTYPE presentDetour(IDXGISwapChain* sc, UINT sync, UINT flags) {
    if (!gFailed) drawSquare(sc);
    return gPresentOrig(sc, sync, flags);
}
HRESULT STDMETHODCALLTYPE present1Detour(IDXGISwapChain1* sc, UINT sync, UINT flags, DXGI_PRESENT_PARAMETERS const* p) {
    if (!gFailed) drawSquare(sc);
    return gPresent1Orig(sc, sync, flags, p);
}
void STDMETHODCALLTYPE execDetour(ID3D12CommandQueue* q, UINT n, ID3D12CommandList* const* l) {
    {
        std::lock_guard<std::mutex> lk(gQMx);
        if (!gDirectQueues.count(q) && !gOtherQueues.count(q)) {
            D3D12_COMMAND_QUEUE_DESC d = q->GetDesc();
            (d.Type == D3D12_COMMAND_LIST_TYPE_DIRECT ? gDirectQueues : gOtherQueues).insert(q);
        }
        if (gDirectQueues.count(q)) gQueue = q;
    }
    gExecOrig(q, n, l);
}

bool readCfg() {
    char  buf[MAX_PATH] = {};
    DWORD n = GetEnvironmentVariableA("APPDATA", buf, MAX_PATH);
    gFogOn = true;
    if (!n || n >= MAX_PATH) return true;
    std::ifstream f(std::filesystem::path(std::string(buf, n)) / "minimap3" / "gpu.txt");
    std::string   line;
    gFogOn = true; // on by default; "fog=0" in gpu.txt turns the GPU fog off
    while (std::getline(f, line)) {
        if (line.find("test=1") != std::string::npos) gTestSquare = true;
        if (line.find("fog=0") != std::string::npos) gFogOn = false;
    }
    return gTestSquare || gFogOn;
}

} // namespace

bool install(LogFn logFn) {
    gLog = logFn;
    if (gInstalled) return true;
    if (!readCfg()) { log("GPU path off (create %APPDATA%\\minimap3\\gpu.txt with the line fog=1 to draw the fog on the GPU, or test=1 for the magenta square)."); return false; }
    HWND hw = CreateWindowExA(0, "STATIC", "dx12dummy", WS_OVERLAPPED, 0, 0, 100, 100, nullptr, nullptr, GetModuleHandleA(nullptr), nullptr);
    IDXGIFactory4* fac = nullptr; ID3D12Device* dev = nullptr; ID3D12CommandQueue* q = nullptr; IDXGISwapChain1* sc = nullptr;
    bool ok = false;
    do {
        if (!hw) break;
        if (FAILED(CreateDXGIFactory1(IID_PPV_ARGS(&fac)))) break;
        if (FAILED(D3D12CreateDevice(nullptr, D3D_FEATURE_LEVEL_11_0, IID_PPV_ARGS(&dev)))) break;
        D3D12_COMMAND_QUEUE_DESC qd{};
        if (FAILED(dev->CreateCommandQueue(&qd, IID_PPV_ARGS(&q)))) break;
        DXGI_SWAP_CHAIN_DESC1 sd{};
        sd.Width = 100; sd.Height = 100; sd.Format = DXGI_FORMAT_R8G8B8A8_UNORM; sd.SampleDesc.Count = 1;
        sd.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT; sd.BufferCount = 2; sd.SwapEffect = DXGI_SWAP_EFFECT_FLIP_DISCARD;
        if (FAILED(fac->CreateSwapChainForHwnd(q, hw, &sd, nullptr, nullptr, &sc))) break;
        void** sv = *reinterpret_cast<void***>(sc);
        void** qv = *reinterpret_cast<void***>(q);
        gPresentTarget = sv[8]; gPresent1Target = sv[22]; gExecTarget = qv[10];
        ok = true;
    } while (false);
    if (sc) sc->Release();
    if (q) q->Release();
    if (dev) dev->Release();
    if (fac) fac->Release();
    if (hw) DestroyWindow(hw);
    if (!ok) { log("GPU test: could not read Direct3D 12 vtables, disabled."); gFailed = true; return false; }
    int r1 = ll::memory::hook(gExecTarget, reinterpret_cast<void*>(&execDetour), reinterpret_cast<void**>(&gExecOrig), ll::memory::HookPriority::Normal);
    int r2 = ll::memory::hook(gPresentTarget, reinterpret_cast<void*>(&presentDetour), reinterpret_cast<void**>(&gPresentOrig), ll::memory::HookPriority::Normal);
    int r3 = ll::memory::hook(gPresent1Target, reinterpret_cast<void*>(&present1Detour), reinterpret_cast<void**>(&gPresent1Orig), ll::memory::HookPriority::Normal);
    log("GPU: hooks installed (Execute=" + std::to_string(r1) + ", Present=" + std::to_string(r2) + ", Present1=" + std::to_string(r3) + "), fog=" + std::to_string(int(gFogOn)) + ", test square=" + std::to_string(int(gTestSquare)) + ".");
    gInstalled = true;
    return true;
}

void uninstall() {
    if (!gInstalled) return;
    gFailed = true; // stop drawing before the hooks go away
    if (gPresent1Orig) ll::memory::unhook(gPresent1Target, reinterpret_cast<void*>(&present1Detour));
    if (gPresentOrig) ll::memory::unhook(gPresentTarget, reinterpret_cast<void*>(&presentDetour));
    if (gExecOrig) ll::memory::unhook(gExecTarget, reinterpret_cast<void*>(&execDetour));
    gInstalled = false;
}

bool fogActive() { return gFogOn && gFogWorks && !gFogBroken && !gFailed; }

void fogSetNoise(float const* noise, int N) {
    if (!noise || N <= 0) return;
    std::lock_guard<std::mutex> lk(gFogMx);
    if (!gNoiseData.empty()) return;
    gNoiseData.resize(size_t(N) * N * 4);
    for (size_t i = 0; i < size_t(N) * N; ++i) {
        for (int c = 0; c < 3; ++c) gNoiseData[i * 4 + size_t(c)] = uint8_t(std::min(255.0f, std::max(0.0f, noise[i * 3 + size_t(c)]) * 255.0f + 0.5f));
        gNoiseData[i * 4 + 3] = 255;
    }
    gNoiseN = N; gNoiseFresh = true;
}

void fogSetMask(int view, int G, float cx, float cz, float blocks, float const* mask) {
    if (view < 0 || view > 1 || G <= 0 || !mask) return;
    std::vector<uint16_t> d(size_t(G) * G * 4);
    for (size_t i = 0; i < size_t(G) * G; ++i) {
        d[i * 4 + 0] = f2h(mask[i * 3 + 0]); d[i * 4 + 1] = f2h(mask[i * 3 + 1]); d[i * 4 + 2] = f2h(mask[i * 3 + 2]); d[i * 4 + 3] = f2h(1.0f);
    }
    std::lock_guard<std::mutex> lk(gFogMx);
    MaskSlot& m = gMask[view];
    m.data = std::move(d); m.G = G; m.cx = cx; m.cz = cz; m.blocks = blocks; m.fresh = true;
}

void fogRequest(FogDraw const& d) {
    if (d.view < 0 || d.view > 1) return;
    std::lock_guard<std::mutex> lk(gFogMx);
    gReq[d.view].d = d; gReq[d.view].ttl = 2;
}

} // namespace diorama_bedrock::gpu
