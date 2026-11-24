#pragma once

namespace diorama_bedrock::hud {

/// Install the HUD render hook. Returns false if it could not be installed.
bool install();

/// Remove the HUD render hook.
void uninstall();

} // namespace diorama_bedrock::hud
