/* CLAUDE-MAP-BEGIN
 FILE: blocks/wheel_mount_ids.js  (0 KB, 4 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (auto, from first comment) Крепления колёс: дерево (исходное), железо и незерит. Различаются только стойкостью к взрывам и массой.
 IMPORTS: -
 IMPORTED BY: blocks/car_directions.js, blocks/rz_drive.js, blocks/rz_susp.js, main.js
 EXPORTS: WHEEL_MOUNT_IDS, isWheelMountId
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): isWheelMountId@3(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// Крепления колёс: дерево (исходное), железо и незерит. Различаются только стойкостью к взрывам и массой.
export const WHEEL_MOUNT_IDS = new Set(["create_physics:wheel_mount", "create_physics:wheel_mount_iron", "create_physics:wheel_mount_netherite"]);
export function isWheelMountId(typeId) { return WHEEL_MOUNT_IDS.has(typeId); }
