/* CLAUDE-MAP-BEGIN
 FILE: ponder/settings.js  (1 KB, 32 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: @minecraft/server
 IMPORTED BY: main.js
 EXPORTS: VEHICLE_CAMERA_DISTANCES, vehicleCameraDistance, saveVehicleCameraDistance, configurePonderSettings, showPonderSettings, normalizeStructureDistance, structureStreamOutDistance, structureStreamInDistance, saveStructureDistance
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): vehicleCameraDistance@6(4L); normalizeStructureDistance@18(4L); structureStreamInDistance@25(4L); saveVehicleCameraDistance@10(3L); showPonderSettings@15(3L); structureStreamOutDistance@22(3L); saveStructureDistance@29(3L); configurePonderSettings@14(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { world } from "@minecraft/server";

const DISTANCE_PROPERTY = "create_physics:structure_stream_distance";
const CAMERA_PROPERTY = "create_physics:vehicle_camera_distance";
export const VEHICLE_CAMERA_DISTANCES = [0, 4, 6, 10, 16, 24, 32, 48, 64];
export function vehicleCameraDistance() {
  const value = world.getDynamicProperty(CAMERA_PROPERTY);
  return VEHICLE_CAMERA_DISTANCES.includes(value) ? value : 0;
}
export function saveVehicleCameraDistance(value) {
  world.setDynamicProperty(CAMERA_PROPERTY, VEHICLE_CAMERA_DISTANCES.includes(value) ? value : 0);
}
let openSettings;
export function configurePonderSettings(callback) { openSettings = callback; }
export async function showPonderSettings(player) {
  if (openSettings) await openSettings(player);
}
export function normalizeStructureDistance(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(32, Math.min(320, Math.round(value / 16) * 16)) : 192;
}
export function structureStreamOutDistance() {
  return normalizeStructureDistance(world.getDynamicProperty(DISTANCE_PROPERTY));
}
export function structureStreamInDistance() {
  // Keep separate thresholds so structures do not flicker at the boundary.
  return Math.max(16, structureStreamOutDistance() - 32);
}
export function saveStructureDistance(value) {
  world.setDynamicProperty(DISTANCE_PROPERTY, normalizeStructureDistance(value));
}
