#include "mod/HudHook.h"

#include "mod/DioramaMod.h"

#include "ll/api/memory/Hook.h"

#include "mc/client/gui/controls/renderers/HotBarSlotsRenderer.h"
#include "mod/Minimap.h"
#include "mc/client/renderer/screen/MinecraftUIRenderContext.h"
#include "mc/deps/core/math/Color.h"
#include "mc/deps/input/RectangleArea.h"

#include <memory>

namespace diorama_bedrock::hud {

namespace {
bool gFirstCall = true;
} // namespace

// Hook the vanilla hotbar renderer (drawn in every game mode), call the original, then draw the map on top.
LL_TYPE_INSTANCE_HOOK(
    HotbarHook,
    ll::memory::HookPriority::Normal,
    HotBarSlotsRenderer,
    &HotBarSlotsRenderer::$render,
    void,
    ::MinecraftUIRenderContext& renderContext,
    ::IClientInstance&          client,
    ::UIControl&                owner,
    int                         pass
) {
    origin(renderContext, client, owner, pass);

    if (gFirstCall) {
        gFirstCall = false;
        DioramaMod::getInstance().getSelf().getLogger().info("HUD hook fired (hotbar, minimap active).");
    }

    minimap::draw(renderContext, client);
}

namespace {
std::unique_ptr<ll::memory::HookRegistrar<HotbarHook>> gRegistrar;
} // namespace

bool install() {
    if (gRegistrar) return true;
    gRegistrar = std::make_unique<ll::memory::HookRegistrar<HotbarHook>>();
    return true;
}

void uninstall() {
    gRegistrar.reset();
    minimap::reset();
}

} // namespace diorama_bedrock::hud
