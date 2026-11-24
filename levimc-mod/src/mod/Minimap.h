#pragma once

class MinecraftUIRenderContext;
class IClientInstance;

namespace diorama_bedrock::minimap {

/// Draw the minimap (top-right) or the big map (toggled with M). Called every HUD frame.
void draw(::MinecraftUIRenderContext& ctx, ::IClientInstance& client);

/// Forget cached terrain (call when leaving a world).
void reset();

/// Stop the background bake thread (call on mod disable).
void shutdown();

} // namespace diorama_bedrock::minimap
