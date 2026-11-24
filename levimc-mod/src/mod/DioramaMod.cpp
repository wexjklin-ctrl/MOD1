#include "mod/DioramaMod.h"

#include "ll/api/mod/RegisterHelper.h"

namespace diorama_bedrock {

DioramaMod& DioramaMod::getInstance() {
    static DioramaMod instance;
    return instance;
}

bool DioramaMod::load() {
    getSelf().getLogger().info("Diorama (Bedrock) loaded. Stage 1: skeleton only.");
    return true;
}

bool DioramaMod::enable() {
    getSelf().getLogger().info("Diorama (Bedrock) enabled.");
    // Stage 2: HUD hook goes here (see ../../HANDOFF.md).
    return true;
}

bool DioramaMod::disable() {
    getSelf().getLogger().info("Diorama (Bedrock) disabled.");
    return true;
}

} // namespace diorama_bedrock

LL_REGISTER_MOD(diorama_bedrock::DioramaMod, diorama_bedrock::DioramaMod::getInstance());
