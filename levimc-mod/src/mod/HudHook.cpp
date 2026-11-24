#include "mod/HudHook.h"

#include "mod/DioramaMod.h"

#include "ll/api/memory/Hook.h"

#include "mc/client/gui/controls/renderers/HudHeartRenderer.h"
#include "mc/client/renderer/screen/MinecraftUIRenderContext.h"
#include "mc/deps/core/math/Color.h"
#include "mc/deps/input/RectangleArea.h"

#include <memory>

namespace diorama_bedrock::hud {

namespace {
bool gFirstCall = true;
} // namespace

// Stage 2 test: hook the vanilla hearts renderer (same function MelonRind hooks),
// call the original, then draw a magenta test square on top.
LL_TYPE_INSTANCE_HOOK(
    HudHeartHook,
    ll::memory::HookPriority::Normal,
    HudHeartRenderer,
    &HudHeartRenderer::$render,
    void,
    ::MinecraftUIRenderContext& renderContext,
    ::IClientInstance&          client,
    ::UIControl&                owner,
    int                         pass
) {
    origin(renderContext, client, owner, pass);

    if (gFirstCall) {
        gFirstCall = false;
        DioramaMod::getInstance().getSelf().getLogger().info("HUD hook fired (stage 2).");
    }

    ::RectangleArea rect{};
    rect._x0 = 20.0f;
    rect._x1 = 60.0f;
    rect._y0 = 20.0f;
    rect._y1 = 60.0f;
    ::mce::Color magenta{1.0f, 0.0f, 1.0f, 1.0f};
    renderContext.fillRectangle(rect, magenta, 1.0f);
}

namespace {
std::unique_ptr<ll::memory::HookRegistrar<HudHeartHook>> gRegistrar;
} // namespace

bool install() {
    if (gRegistrar) return true;
    gRegistrar = std::make_unique<ll::memory::HookRegistrar<HudHeartHook>>();
    return true;
}

void uninstall() { gRegistrar.reset(); }

} // namespace diorama_bedrock::hud
