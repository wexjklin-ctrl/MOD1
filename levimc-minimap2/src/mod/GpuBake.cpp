// GPU shading of map tiles (D3D12 compute). The CPU still builds the height field and the per-pixel "visible record" lists;
// this file shades them (AO, sky, sun shadows, grade, outlines) on the GPU and reads the finished pixels back.
// Off unless %APPDATA%\minimap2\gpu.txt contains tilebake=1. Any failure falls back to the CPU painter.
#include "mod/GpuHook.h"

#include <windows.h>

#include <d3d12.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <string>
#include <vector>

namespace diorama_bedrock::gpu {
namespace {

constexpr UINT kMaxW = 768, kMaxNP = kMaxW * kMaxW, kMaxCells = 300 * 800;
constexpr UINT64 kRecBytes = UINT64(kMaxNP) * 4 * 24;

std::mutex      gMx;
ID3D12Device*   gDev = nullptr;
LogFn           gLogF = nullptr;
bool            gCfgRead = false, gOn = false, gBroken = false, gInit = false, gSrvState = false;
ID3D12CommandQueue* gQ = nullptr; ID3D12CommandAllocator* gAl = nullptr; ID3D12GraphicsCommandList* gL = nullptr;
ID3D12Fence* gFence = nullptr; HANDLE gEv = nullptr; UINT64 gFv = 0;
ID3D12RootSignature* gRS = nullptr; ID3D12PipelineState *gP1 = nullptr, *gP2 = nullptr;
ID3D12Resource *upCell = nullptr, *upRec = nullptr, *dCol = nullptr, *dH = nullptr, *dSky = nullptr, *dRec = nullptr, *dRes = nullptr, *dPx = nullptr, *dHb = nullptr, *rb = nullptr;
uint8_t *upCellP = nullptr, *upRecP = nullptr;

void log(std::string const& m) { if (gLogF) gLogF(m); }

void readCfg() {
    if (gCfgRead) return;
    gCfgRead = true;
    char  buf[MAX_PATH] = {};
    DWORD n = GetEnvironmentVariableA("APPDATA", buf, MAX_PATH);
    if (!n || n >= MAX_PATH) return;
    std::ifstream f(std::filesystem::path(std::string(buf, n)) / "minimap2" / "gpu.txt");
    std::string   line;
    while (std::getline(f, line)) if (line.find("tilebake=1") != std::string::npos) gOn = true;
}

const char* kHlsl = R"HLSL(
cbuffer C : register(b0) { uint W; int gn; int m; int mx; int rowsHalf; int x0; int cz; int maxH; };
StructuredBuffer<uint>  gCol : register(t0);
StructuredBuffer<int>   gH   : register(t1);
StructuredBuffer<float> gSky : register(t2);
StructuredBuffer<uint>  gRec : register(t3);
RWStructuredBuffer<float4> gRes : register(u0);
RWStructuredBuffer<uint>   gPx  : register(u1);
RWStructuredBuffer<int>    gHb  : register(u2);

static const float kSinP = 0.5299, kCosP = 0.8480;
static const float kSunX = 0.7880108 * -0.878, kSunY = 0.6156615, kSunZ = 0.7880108 * 0.479;
static const float3 kJit[4] = { float3(0.03, 0.0, -0.02), float3(-0.02, 0.0, 0.03), float3(0.02, 0.0, 0.02), float3(-0.03, 0.0, -0.03) };
static const float kAmbient = 0.34, kSunStr = 0.62, kHeightShade = 0.22, kCornerOcc = 1.5, kSkyOcc = 0.85;
static const float kSat = 1.35, kExposure = 1.16, kOutline = 0.38, kOutlineDepth = 1.5, kSideK = 0.82;
static const float3 kSunTint = float3(1.14, 1.0, 0.8), kShadowTint = float3(0.74, 0.86, 1.18);
static const float kAo[4] = { 0.6, 0.74, 0.87, 1.0 };
static const int NOH = -1000000;

int lr(float v) { return v >= 0.0 ? int(floor(v + 0.5)) : -int(floor(-v + 0.5)); }
bool knownAt(int gi, int r) { return !(gi < 0 || gi >= gn || r < 0 || r >= m) && gCol[uint(r) * uint(gn) + uint(gi)] != 0; }
int  hAt(int gi, int r) { return knownAt(gi, r) ? gH[uint(r) * uint(gn) + uint(gi)] : NOH; }
bool occ(int gi, int r, int y) { return hAt(gi, r) >= y; }
float aoCorner(bool a, bool b, bool d) { if (a && b) return kAo[0]; return kAo[3 - (a ? 1 : 0) - (b ? 1 : 0) - (d ? 1 : 0)]; }
float bil(float a, float b, float c, float d, float fx, float fy) { float t = a + (b - a) * fx, u = c + (d - c) * fx; return t + (u - t) * fy; }
float skyS(int a, int c, float own) { return knownAt(a, c) ? gSky[uint(c) * uint(gn) + uint(a)] : own; }
float skyBilinear(int gi, int r, float fx, float fz) {
    float px = fx - 0.5, pz = fz - 0.5;
    int i0 = gi + (px < 0 ? -1 : 0), r0 = r + (pz < 0 ? -1 : 0);
    float tx = px < 0 ? px + 1.0 : px, tz = pz < 0 ? pz + 1.0 : pz;
    float own = gSky[uint(r) * uint(gn) + uint(gi)];
    return bil(skyS(i0, r0, own), skyS(i0 + 1, r0, own), skyS(i0, r0 + 1, own), skyS(i0 + 1, r0 + 1, own), tx, tz);
}
float skyAtHeight(int gi, int r, float Y) {
    static const float2 dirs[5] = { float2(1, 0), float2(0.7071, 0.7071), float2(0, 1), float2(-0.7071, 0.7071), float2(-1, 0) };
    static const float dists[4] = { 1, 3, 6, 12 };
    int blocked = 0;
    [loop] for (int a = 0; a < 5; ++a) {
        [loop] for (int b = 0; b < 4; ++b) {
            int hn = hAt(gi + lr(dirs[a].x * dists[b]), r + lr(dirs[a].y * dists[b]));
            if (hn != NOH && float(hn) + 1.0 > Y + dists[b] * 0.7 + 0.2) { ++blocked; break; }
        }
    }
    return 1.0 - 0.9 * float(blocked) / 5.0;
}
bool inShadow(float X, float Y, float Z, float3 d) {
    float t = 0.35;
    [loop] while (t < 40.0) {
        float py = Y + d.y * t;
        if (py > float(maxH) + 1.0) return false;
        int gi = int(floor(X + d.x * t - float(x0))) + mx;
        int r  = int(floor(Z + d.z * t - float(cz))) + rowsHalf;
        if (gi < 0 || gi >= gn || r < 0 || r >= m) return false;
        uint k = uint(r) * uint(gn) + uint(gi);
        if (gCol[k] != 0 && py < float(gH[k]) + 1.0) return true;
        t += (t < 4.0 ? 0.5 : 1.0);
    }
    return false;
}
float lin8(uint c) { float v = float(c) / 255.0; return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4); }
uint outq(float v) {
    int i = clamp(int(v * 4095.0), 0, 4095);
    float vv = float(i) / 4095.0;
    float s = vv <= 0.0031308 ? vv * 12.92 : 1.055 * pow(vv, 1.0 / 2.4) - 0.055;
    return uint(clamp(s, 0.0, 1.0) * 255.0 + 0.5);
}

[numthreads(8, 8, 1)]
void CS1(uint3 id : SV_DispatchThreadID) {
    if (id.x >= W || id.y >= W) return;
    uint p = id.y * W + id.x, NP = W * W;
    float3 acc = float3(0, 0, 0); float dsum = 0.0; int cnt = 0; int hs = 0;
    [loop] for (int s = 0; s < 4; ++s) {
        uint b = (uint(s) * NP + p) * 6;
        uint cell = gRec[b];
        if (cell == 0xFFFFFFFFu) continue;
        float fx = asfloat(gRec[b + 1]), fb = asfloat(gRec[b + 2]), Y = asfloat(gRec[b + 3]);
        uint albedo = gRec[b + 4], type = gRec[b + 5];
        int gi = int(cell % uint(gn)), r = int(cell / uint(gn)), j = r - rowsHalf;
        bool top = type == 1;
        float X = float(x0) + (float(gi - mx) + fx);
        float Zc, ao, sky, lambert;
        float3 sun = float3(kSunX + kJit[s].x, kSunY + kJit[s].y, kSunZ + kJit[s].z);
        if (top) {
            float fz = fb;
            Zc = float(cz) + (float(j) + fz);
            int y1 = int(ceil(Y - 1e-3));
            bool nn = occ(gi, r - 1, y1), ss = occ(gi, r + 1, y1), ww = occ(gi - 1, r, y1), ee = occ(gi + 1, r, y1);
            float nw = aoCorner(ww, nn, occ(gi - 1, r - 1, y1)), ne = aoCorner(ee, nn, occ(gi + 1, r - 1, y1));
            float sw = aoCorner(ww, ss, occ(gi - 1, r + 1, y1)), se = aoCorner(ee, ss, occ(gi + 1, r + 1, y1));
            ao = bil(nw, ne, sw, se, fx, fz);
            sky = skyBilinear(gi, r, fx, fz);
            lambert = 1.0;
        } else {
            Zc = float(cz) + float(j + 1);
            int by = int(floor(Y - 1e-4)); float fy = Y - float(by);
            int rf = r + 1;
            bool up = occ(gi, rf, by + 1), dn = occ(gi, rf, by - 1), ww = occ(gi - 1, rf, by), ee = occ(gi + 1, rf, by);
            float tw = aoCorner(ww, up, occ(gi - 1, rf, by + 1)), te = aoCorner(ee, up, occ(gi + 1, rf, by + 1));
            float bw = aoCorner(ww, dn, occ(gi - 1, rf, by - 1)), be = aoCorner(ee, dn, occ(gi + 1, rf, by - 1));
            ao = bil(tw, te, bw, be, fx, 1.0 - fy);
            sky = skyAtHeight(gi, rf, Y);
            lambert = max(0.0, sun.z) / sun.y;
        }
        bool shadowed = lambert > 0.0 && inShadow(X, Y + 1e-4, Zc + (top ? 0.0 : 1e-4), sun);
        float aoSun = max(0.0, 1.0 - kCornerOcc * (1.0 - ao)), aoSky = min(ao, aoSun);
        float direct = (lambert > 0.0 && !shadowed) ? kSunStr * lambert * aoSun : 0.0;
        float ambient = kAmbient * aoSky * (1.0 - kSkyOcc * (1.0 - (0.15 + 0.85 * sky)));
        float3 L = ambient * kShadowTint + direct * kSunTint;
        float hsh = 1.0 + kHeightShade * clamp((Y - 64.0) / 64.0, -1.0, 1.0);
        float face = top ? 1.0 : kSideK;
        float3 alb = float3(lin8((albedo >> 16) & 255u), lin8((albedo >> 8) & 255u), lin8(albedo & 255u));
        acc += alb * L * hsh * face;
        dsum += -(Y * kSinP + Zc * kCosP);
        hs = int(floor(Y));
        ++cnt;
    }
    if (cnt == 0) { gRes[p] = float4(0, 0, 0, 1e30); gPx[p] = 0; gHb[p] = -32768; return; }
    float3 c3 = acc / float(cnt);
    float l = 0.2126 * c3.r + 0.7152 * c3.g + 0.0722 * c3.b;
    c3 = (float3(l, l, l) + (c3 - float3(l, l, l)) * kSat) * kExposure;
    gRes[p] = float4(float(outq(c3.r)), float(outq(c3.g)), float(outq(c3.b)), dsum / float(cnt));
    gHb[p] = hs;
}

[numthreads(8, 8, 1)]
void CS2(uint3 id : SV_DispatchThreadID) {
    if (id.x >= W || id.y >= W) return;
    int x = int(id.x), y = int(id.y); uint w = W;
    uint p = id.y * w + id.x;
    float4 me = gRes[p];
    if (me.w >= 1e29) { gPx[p] = 0; return; }
    bool edge = false;
    if (x > 0)          { float d = gRes[p - 1].w; if (d < 1e29 && me.w - d > kOutlineDepth) edge = true; }
    if (x < int(w) - 1) { float d = gRes[p + 1].w; if (d < 1e29 && me.w - d > kOutlineDepth) edge = true; }
    if (y > 0)          { float d = gRes[p - w].w; if (d < 1e29 && me.w - d > kOutlineDepth) edge = true; }
    if (y < int(w) - 1) { float d = gRes[p + w].w; if (d < 1e29 && me.w - d > kOutlineDepth) edge = true; }
    float f = edge ? (1.0 - kOutline) : 1.0;
    uint r = uint(me.x * f + (edge ? 0.5 : 0.0)), g = uint(me.y * f + (edge ? 0.5 : 0.0)), b = uint(me.z * f + (edge ? 0.5 : 0.0));
    gPx[p] = 0xFF000000u | (r << 16) | (g << 8) | b;
}
)HLSL";

using D3DCompileFn = HRESULT(WINAPI*)(LPCVOID, SIZE_T, LPCSTR, const void*, void*, LPCSTR, LPCSTR, UINT, UINT, ID3DBlob**, ID3DBlob**);

ID3DBlob* compile(D3DCompileFn fn, char const* entry) {
    ID3DBlob *code = nullptr, *err = nullptr;
    HRESULT hr = fn(kHlsl, std::strlen(kHlsl), "tilebake", nullptr, nullptr, entry, "cs_5_0", (1u << 15), 0, &code, &err);
    if (FAILED(hr) || !code) {
        std::string msg = err ? std::string(static_cast<char const*>(err->GetBufferPointer()), err->GetBufferSize()) : std::string("unknown");
        if (msg.size() > 600) msg.resize(600);
        log(std::string("GPU tilebake: shader compile failed (") + entry + "): " + msg);
        if (err) err->Release();
        return nullptr;
    }
    if (err) err->Release();
    return code;
}

ID3D12Resource* mkBuf(D3D12_HEAP_TYPE ht, UINT64 size, D3D12_RESOURCE_FLAGS fl, D3D12_RESOURCE_STATES st) {
    D3D12_HEAP_PROPERTIES hp{}; hp.Type = ht;
    D3D12_RESOURCE_DESC rd{};
    rd.Dimension = D3D12_RESOURCE_DIMENSION_BUFFER; rd.Width = size; rd.Height = 1; rd.DepthOrArraySize = 1; rd.MipLevels = 1;
    rd.Format = DXGI_FORMAT_UNKNOWN; rd.SampleDesc.Count = 1; rd.Layout = D3D12_TEXTURE_LAYOUT_ROW_MAJOR; rd.Flags = fl;
    ID3D12Resource* r = nullptr;
    if (FAILED(gDev->CreateCommittedResource(&hp, D3D12_HEAP_FLAG_NONE, &rd, st, nullptr, IID_PPV_ARGS(&r)))) return nullptr;
    return r;
}

void barrier(ID3D12Resource* r, D3D12_RESOURCE_STATES a, D3D12_RESOURCE_STATES b) {
    if (a == b) return;
    D3D12_RESOURCE_BARRIER bb{};
    bb.Type = D3D12_RESOURCE_BARRIER_TYPE_TRANSITION; bb.Transition.pResource = r; bb.Transition.Subresource = D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES;
    bb.Transition.StateBefore = a; bb.Transition.StateAfter = b;
    gL->ResourceBarrier(1, &bb);
}

bool init() {
    gInit = true;
    HMODULE m = LoadLibraryA("d3dcompiler_47.dll");
    auto fn = m ? reinterpret_cast<D3DCompileFn>(GetProcAddress(m, "D3DCompile")) : nullptr;
    if (!fn) { log("GPU tilebake: D3DCompile unavailable."); return false; }
    ID3DBlob* c1 = compile(fn, "CS1"); ID3DBlob* c2 = compile(fn, "CS2");
    if (!c1 || !c2) return false;
    D3D12_ROOT_PARAMETER rp[8]{};
    rp[0].ParameterType = D3D12_ROOT_PARAMETER_TYPE_32BIT_CONSTANTS; rp[0].Constants.ShaderRegister = 0; rp[0].Constants.Num32BitValues = 8;
    for (UINT i = 1; i <= 4; ++i) { rp[i].ParameterType = D3D12_ROOT_PARAMETER_TYPE_SRV; rp[i].Descriptor.ShaderRegister = i - 1; }
    for (UINT i = 5; i <= 7; ++i) { rp[i].ParameterType = D3D12_ROOT_PARAMETER_TYPE_UAV; rp[i].Descriptor.ShaderRegister = i - 5; }
    D3D12_ROOT_SIGNATURE_DESC rsd{}; rsd.NumParameters = 8; rsd.pParameters = rp;
    ID3DBlob *sig = nullptr, *err = nullptr;
    if (FAILED(D3D12SerializeRootSignature(&rsd, D3D_ROOT_SIGNATURE_VERSION_1, &sig, &err)) || !sig) { log("GPU tilebake: root signature serialize failed."); return false; }
    if (FAILED(gDev->CreateRootSignature(0, sig->GetBufferPointer(), sig->GetBufferSize(), IID_PPV_ARGS(&gRS)))) { log("GPU tilebake: root signature failed."); return false; }
    D3D12_COMPUTE_PIPELINE_STATE_DESC pd{}; pd.pRootSignature = gRS;
    pd.CS = {c1->GetBufferPointer(), c1->GetBufferSize()};
    if (FAILED(gDev->CreateComputePipelineState(&pd, IID_PPV_ARGS(&gP1)))) { log("GPU tilebake: pipeline 1 failed."); return false; }
    pd.CS = {c2->GetBufferPointer(), c2->GetBufferSize()};
    if (FAILED(gDev->CreateComputePipelineState(&pd, IID_PPV_ARGS(&gP2)))) { log("GPU tilebake: pipeline 2 failed."); return false; }
    D3D12_COMMAND_QUEUE_DESC qd{}; qd.Type = D3D12_COMMAND_LIST_TYPE_DIRECT;
    if (FAILED(gDev->CreateCommandQueue(&qd, IID_PPV_ARGS(&gQ)))) { log("GPU tilebake: queue failed."); return false; }
    if (FAILED(gDev->CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_DIRECT, IID_PPV_ARGS(&gAl)))) return false;
    if (FAILED(gDev->CreateCommandList(0, D3D12_COMMAND_LIST_TYPE_DIRECT, gAl, nullptr, IID_PPV_ARGS(&gL)))) return false;
    gL->Close();
    if (FAILED(gDev->CreateFence(0, D3D12_FENCE_FLAG_NONE, IID_PPV_ARGS(&gFence)))) return false;
    gEv = CreateEventA(nullptr, FALSE, FALSE, nullptr);
    if (!gEv) return false;
    const UINT64 cellB = UINT64(kMaxCells) * 4;
    upCell = mkBuf(D3D12_HEAP_TYPE_UPLOAD, cellB * 3, D3D12_RESOURCE_FLAG_NONE, D3D12_RESOURCE_STATE_GENERIC_READ);
    upRec  = mkBuf(D3D12_HEAP_TYPE_UPLOAD, kRecBytes, D3D12_RESOURCE_FLAG_NONE, D3D12_RESOURCE_STATE_GENERIC_READ);
    dCol = mkBuf(D3D12_HEAP_TYPE_DEFAULT, cellB, D3D12_RESOURCE_FLAG_NONE, D3D12_RESOURCE_STATE_COPY_DEST);
    dH   = mkBuf(D3D12_HEAP_TYPE_DEFAULT, cellB, D3D12_RESOURCE_FLAG_NONE, D3D12_RESOURCE_STATE_COPY_DEST);
    dSky = mkBuf(D3D12_HEAP_TYPE_DEFAULT, cellB, D3D12_RESOURCE_FLAG_NONE, D3D12_RESOURCE_STATE_COPY_DEST);
    dRec = mkBuf(D3D12_HEAP_TYPE_DEFAULT, kRecBytes, D3D12_RESOURCE_FLAG_NONE, D3D12_RESOURCE_STATE_COPY_DEST);
    dRes = mkBuf(D3D12_HEAP_TYPE_DEFAULT, UINT64(kMaxNP) * 16, D3D12_RESOURCE_FLAG_ALLOW_UNORDERED_ACCESS, D3D12_RESOURCE_STATE_UNORDERED_ACCESS);
    dPx  = mkBuf(D3D12_HEAP_TYPE_DEFAULT, UINT64(kMaxNP) * 4, D3D12_RESOURCE_FLAG_ALLOW_UNORDERED_ACCESS, D3D12_RESOURCE_STATE_UNORDERED_ACCESS);
    dHb  = mkBuf(D3D12_HEAP_TYPE_DEFAULT, UINT64(kMaxNP) * 4, D3D12_RESOURCE_FLAG_ALLOW_UNORDERED_ACCESS, D3D12_RESOURCE_STATE_UNORDERED_ACCESS);
    rb   = mkBuf(D3D12_HEAP_TYPE_READBACK, UINT64(kMaxNP) * 8, D3D12_RESOURCE_FLAG_NONE, D3D12_RESOURCE_STATE_COPY_DEST);
    if (!upCell || !upRec || !dCol || !dH || !dSky || !dRec || !dRes || !dPx || !dHb || !rb) { log("GPU tilebake: buffer allocation failed."); return false; }
    D3D12_RANGE none{0, 0};
    if (FAILED(upCell->Map(0, &none, reinterpret_cast<void**>(&upCellP))) || FAILED(upRec->Map(0, &none, reinterpret_cast<void**>(&upRecP)))) return false;
    gSrvState = false;
    log("GPU tilebake: pipeline ready.");
    return true;
}

} // namespace

void bakeSetDevice(void* dev, LogFn logFn) {
    std::lock_guard<std::mutex> lk(gMx);
    if (!gDev) { gDev = static_cast<ID3D12Device*>(dev); gLogF = logFn; }
}

bool bakeAvailable() {
    std::lock_guard<std::mutex> lk(gMx);
    readCfg();
    return gOn && !gBroken && gDev != nullptr;
}

void bakeLog(std::string const& m) { log(m); }

void bakeDisable() {
    std::lock_guard<std::mutex> lk(gMx);
    gBroken = true;
    log("GPU tilebake: disabled (using the CPU painter).");
}

bool bakeShade(BakeIn const& in, std::vector<uint32_t>& px, std::vector<int16_t>& hb) {
    std::lock_guard<std::mutex> lk(gMx);
    readCfg();
    if (!gOn || gBroken || !gDev) return false;
    UINT cells = UINT(in.gn) * UINT(in.m), W = UINT(in.W), NP = W * W;
    if (W > kMaxW || cells > kMaxCells) return false;
    if (!gInit && !init()) { gBroken = true; log("GPU tilebake: init failed, using the CPU painter."); return false; }
    if (gBroken) return false;
    std::memcpy(upCellP, in.col, size_t(cells) * 4);
    std::memcpy(upCellP + size_t(kMaxCells) * 4, in.h, size_t(cells) * 4);
    std::memcpy(upCellP + size_t(kMaxCells) * 8, in.sky, size_t(cells) * 4);
    UINT64 recBytes = UINT64(NP) * 4 * 24;
    std::memcpy(upRecP, in.rec, size_t(recBytes));
    if (FAILED(gAl->Reset()) || FAILED(gL->Reset(gAl, nullptr))) { gBroken = true; return false; }
    const auto SRV = D3D12_RESOURCE_STATE_NON_PIXEL_SHADER_RESOURCE;
    if (gSrvState) { barrier(dCol, SRV, D3D12_RESOURCE_STATE_COPY_DEST); barrier(dH, SRV, D3D12_RESOURCE_STATE_COPY_DEST); barrier(dSky, SRV, D3D12_RESOURCE_STATE_COPY_DEST); barrier(dRec, SRV, D3D12_RESOURCE_STATE_COPY_DEST); }
    gL->CopyBufferRegion(dCol, 0, upCell, 0, UINT64(cells) * 4);
    gL->CopyBufferRegion(dH, 0, upCell, UINT64(kMaxCells) * 4, UINT64(cells) * 4);
    gL->CopyBufferRegion(dSky, 0, upCell, UINT64(kMaxCells) * 8, UINT64(cells) * 4);
    gL->CopyBufferRegion(dRec, 0, upRec, 0, recBytes);
    barrier(dCol, D3D12_RESOURCE_STATE_COPY_DEST, SRV); barrier(dH, D3D12_RESOURCE_STATE_COPY_DEST, SRV);
    barrier(dSky, D3D12_RESOURCE_STATE_COPY_DEST, SRV); barrier(dRec, D3D12_RESOURCE_STATE_COPY_DEST, SRV);
    gL->SetComputeRootSignature(gRS);
    int cb[8] = {int(W), in.gn, in.m, in.mx, in.rowsHalf, in.x0, in.cz, in.maxH};
    gL->SetComputeRoot32BitConstants(0, 8, cb, 0);
    gL->SetComputeRootShaderResourceView(1, dCol->GetGPUVirtualAddress());
    gL->SetComputeRootShaderResourceView(2, dH->GetGPUVirtualAddress());
    gL->SetComputeRootShaderResourceView(3, dSky->GetGPUVirtualAddress());
    gL->SetComputeRootShaderResourceView(4, dRec->GetGPUVirtualAddress());
    gL->SetComputeRootUnorderedAccessView(5, dRes->GetGPUVirtualAddress());
    gL->SetComputeRootUnorderedAccessView(6, dPx->GetGPUVirtualAddress());
    gL->SetComputeRootUnorderedAccessView(7, dHb->GetGPUVirtualAddress());
    UINT groups = (W + 7) / 8;
    gL->SetPipelineState(gP1);
    gL->Dispatch(groups, groups, 1);
    D3D12_RESOURCE_BARRIER ub{}; ub.Type = D3D12_RESOURCE_BARRIER_TYPE_UAV; ub.UAV.pResource = nullptr;
    gL->ResourceBarrier(1, &ub);
    gL->SetPipelineState(gP2);
    gL->Dispatch(groups, groups, 1);
    gL->ResourceBarrier(1, &ub);
    barrier(dPx, D3D12_RESOURCE_STATE_UNORDERED_ACCESS, D3D12_RESOURCE_STATE_COPY_SOURCE);
    barrier(dHb, D3D12_RESOURCE_STATE_UNORDERED_ACCESS, D3D12_RESOURCE_STATE_COPY_SOURCE);
    gL->CopyBufferRegion(rb, 0, dPx, 0, UINT64(NP) * 4);
    gL->CopyBufferRegion(rb, UINT64(NP) * 4, dHb, 0, UINT64(NP) * 4);
    barrier(dPx, D3D12_RESOURCE_STATE_COPY_SOURCE, D3D12_RESOURCE_STATE_UNORDERED_ACCESS);
    barrier(dHb, D3D12_RESOURCE_STATE_COPY_SOURCE, D3D12_RESOURCE_STATE_UNORDERED_ACCESS);
    if (FAILED(gL->Close())) { gBroken = true; return false; }
    gSrvState = true;
    ID3D12CommandList* lists[1] = {gL};
    gQ->ExecuteCommandLists(1, lists);
    UINT64 v = ++gFv;
    gQ->Signal(gFence, v);
    if (gFence->GetCompletedValue() < v) {
        gFence->SetEventOnCompletion(v, gEv);
        if (WaitForSingleObject(gEv, 8000) != WAIT_OBJECT_0) { gBroken = true; log("GPU tilebake: timeout, using the CPU painter."); return false; }
    }
    if (FAILED(gDev->GetDeviceRemovedReason())) { gBroken = true; log("GPU tilebake: device removed."); return false; }
    uint8_t* p = nullptr;
    D3D12_RANGE rr{0, size_t(NP) * 8};
    if (FAILED(rb->Map(0, &rr, reinterpret_cast<void**>(&p))) || !p) { gBroken = true; return false; }
    px.resize(NP); hb.resize(NP);
    std::memcpy(px.data(), p, size_t(NP) * 4);
    int32_t const* hp = reinterpret_cast<int32_t const*>(p + size_t(NP) * 4);
    for (UINT i = 0; i < NP; ++i) hb[i] = int16_t(hp[i]);
    D3D12_RANGE nw{0, 0};
    rb->Unmap(0, &nw);
    return true;
}

} // namespace diorama_bedrock::gpu
