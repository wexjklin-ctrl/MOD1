// Experimental GPU path, step 1: prove that we can draw into the game's own Direct3D 12 back buffer.
// We hook IDXGISwapChain::Present/Present1 and ID3D12CommandQueue::ExecuteCommandLists (vtable addresses are read from a
// throw-away device + swap chain), then clear a 64x64 rectangle with ClearRenderTargetView on the game's queue.
// If the square appears (top-left, magenta), the real tile/fog shaders can be moved here (step 2).
#include "mod/GpuHook.h"

#include "mod/DioramaMod.h"

#include "ll/api/memory/Hook.h"

#include <windows.h>

#include <d3d12.h>
#include <dxgi1_4.h>

#include <atomic>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <string>
#include <unordered_set>

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

void log(std::string const& m) {
    try { DioramaMod::getInstance().getSelf().getLogger().info(m); } catch (...) {}
}

bool initCtx(ID3D12Device* dev, ID3D12CommandQueue*) {
    gC.dev = dev;
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

void drawSquare(IDXGISwapChain* sc) {
    static bool first = true;
    ID3D12CommandQueue* q;
    { std::lock_guard<std::mutex> lk(gQMx); q = gQueue; }
    if (!q) return;
    IDXGISwapChain3* sc3 = nullptr;
    if (FAILED(sc->QueryInterface(IID_PPV_ARGS(&sc3))) || !sc3) { gFailed = true; log("GPU test: swap chain is not IDXGISwapChain3, disabled."); return; }
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
    if (gC.ok && dev == gC.dev) {
        UINT f = gC.frame++ % kFrames;
        if (gC.fence->GetCompletedValue() < gC.frameVal[f]) { gC.fence->SetEventOnCompletion(gC.frameVal[f], gC.ev); WaitForSingleObject(gC.ev, 100); }
        gC.alloc[f]->Reset();
        gC.list->Reset(gC.alloc[f], nullptr);
        D3D12_CPU_DESCRIPTOR_HANDLE h = gC.rtv->GetCPUDescriptorHandleForHeapStart();
        h.ptr += SIZE_T(idx % 8) * gC.rtvInc;
        D3D12_RENDER_TARGET_VIEW_DESC rv{};
        rv.Format = rtvFormat(rd.Format); rv.ViewDimension = D3D12_RTV_DIMENSION_TEXTURE2D;
        dev->CreateRenderTargetView(bb, &rv, h);
        D3D12_RESOURCE_BARRIER b{};
        b.Type = D3D12_RESOURCE_BARRIER_TYPE_TRANSITION; b.Transition.pResource = bb; b.Transition.Subresource = D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES;
        b.Transition.StateBefore = D3D12_RESOURCE_STATE_PRESENT; b.Transition.StateAfter = D3D12_RESOURCE_STATE_RENDER_TARGET;
        gC.list->ResourceBarrier(1, &b);
        const FLOAT col[4] = {1.0f, 0.0f, 1.0f, 1.0f};
        D3D12_RECT r{20, 20, 84, 84};
        gC.list->ClearRenderTargetView(h, col, 1, &r);
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

bool testEnabled() {
    char  buf[MAX_PATH] = {};
    DWORD n = GetEnvironmentVariableA("APPDATA", buf, MAX_PATH);
    if (!n || n >= MAX_PATH) return false;
    std::ifstream f(std::filesystem::path(std::string(buf, n)) / "minimap2" / "gpu.txt");
    std::string   line;
    while (std::getline(f, line)) if (line.find("test=1") != std::string::npos) return true;
    return false;
}

} // namespace

bool install() {
    if (gInstalled) return true;
    if (!testEnabled()) { log("GPU path off (create %APPDATA%\\minimap2\\gpu.txt with the line test=1 to try the Direct3D 12 experiment)."); return false; }
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
    log("GPU test: hooks installed (Execute=" + std::to_string(r1) + ", Present=" + std::to_string(r2) + ", Present1=" + std::to_string(r3) + "). Expect a magenta square at the top-left.");
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

} // namespace diorama_bedrock::gpu
