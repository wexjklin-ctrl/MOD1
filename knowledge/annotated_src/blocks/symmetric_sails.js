/* CLAUDE-MAP-BEGIN
 FILE: blocks/symmetric_sails.js  (0 KB, 11 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: -
 IMPORTED BY: blocks/airplane_math.js, blocks/airplane_wing_control.js, blocks/block_orientation.js, blocks/hot_air_envelope.js, blocks/propeller_bearing.js, blocks/rz_air_mode.js, blocks/rz_air_rig.js, blocks/vehicle_systems.js, blocks/windmill_sails.js, contraptions/ContraptionRenderer.js, contraptions/Contrapt
 EXPORTS: SAIL_COLORS, SAIL_MATERIALS, SYMMETRIC_SAIL_IDS, symmetricSailBase, symmetricSailProperties
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): symmetricSailBase@9(1L); symmetricSailProperties@10(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
export const SAIL_COLORS = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"];
// Материалы обшивки крыла помимо 16 цветов шерсти: медь, железо, незерит (индексы 16..18).
export const SAIL_MATERIALS = [...SAIL_COLORS, "copper", "iron", "netherite"];
const sailTypes = new Map();
for (const base of ["create_physics:symmetric_sail", "create_physics:symmetric_sail_side"]) {
  SAIL_MATERIALS.forEach((color, index) => sailTypes.set(index === 0 ? base : `${base}_${color}`, { base, index }));
}
export const SYMMETRIC_SAIL_IDS = new Set(sailTypes.keys());
export function symmetricSailBase(typeId) { return sailTypes.get(typeId)?.base ?? typeId; }
export function symmetricSailProperties(typeId) { return { "create_physics:sail_color": sailTypes.get(typeId)?.index ?? 0 }; }
