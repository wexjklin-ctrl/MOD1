#pragma once

#include "ll/api/mod/NativeMod.h"

namespace diorama_bedrock {

class DioramaMod {

public:
    static DioramaMod& getInstance();

    DioramaMod() : mSelf(*ll::mod::NativeMod::current()) {}

    [[nodiscard]] ll::mod::NativeMod& getSelf() const { return mSelf; }

    /// @return True if the mod is loaded successfully.
    bool load();

    /// @return True if the mod is enabled successfully.
    bool enable();

    /// @return True if the mod is disabled successfully.
    bool disable();

private:
    ll::mod::NativeMod& mSelf;
};

} // namespace diorama_bedrock
