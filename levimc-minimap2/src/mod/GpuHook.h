#pragma once

namespace diorama_bedrock::gpu {

/// Experimental Direct3D 12 path (step 1: draw a coloured square over the frame from a Present hook).
/// Off by default; enable with %APPDATA%\minimap2\gpu.txt containing "test=1".
bool install();
void uninstall();

} // namespace diorama_bedrock::gpu
