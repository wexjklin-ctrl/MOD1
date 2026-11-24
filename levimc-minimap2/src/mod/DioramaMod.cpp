// build: session 30 (publish retry)
#include "mod/DioramaMod.h"

#include "mod/HudHook.h"
#include "mod/Minimap.h"

#include "ll/api/mod/RegisterHelper.h"

namespace diorama_bedrock {

DioramaMod& DioramaMod::getInstance() {
    static DioramaMod instance;
    return instance;
}

bool DioramaMod::load() {
    getSelf().getLogger().info("Minimap 2 loaded. Minimap + big map (M).");
    return true;
}

bool DioramaMod::enable() {
    getSelf().getLogger().info("Minimap 2 enabled.");
    if (hud::install()) {
        getSelf().getLogger().info("HUD hook installed.");
    } else {
        getSelf().getLogger().error("Could not install HUD hook.");
    }
    return true;
}

bool DioramaMod::disable() {
    hud::uninstall();
    minimap::shutdown();
    getSelf().getLogger().info("Minimap 2 disabled.");
    return true;
}

} // namespace diorama_bedrock

LL_REGISTER_MOD(diorama_bedrock::DioramaMod, diorama_bedrock::DioramaMod::getInstance());
