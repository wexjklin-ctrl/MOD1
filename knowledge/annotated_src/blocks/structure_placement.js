/* CLAUDE-MAP-BEGIN
 FILE: blocks/structure_placement.js  (1 KB, 29 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: blocks/structure_plants.js
 IMPORTED BY: main.js
 EXPORTS: isBlockedStructureItem
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): isBlockedStructureItem@18(11L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { isStructurePlant } from "./structure_plants.js";

const unsupported = new Set([
  "campfire", "soul_campfire",
  "candle", "candle_cake", "torch", "soul_torch", "redstone_torch", "unlit_redstone_torch",
  "underwater_torch", "colored_torch_bp", "colored_torch_rg", "lantern", "soul_lantern",
  "bed", "sea_pickle", "copper_golem", "copper_golem_statue", "exposed_copper_golem_statue",
  "weathered_copper_golem_statue", "oxidized_copper_golem_statue", "sign", "standing_sign",
  "wall_sign", "item_frame", "frame", "glow_item_frame", "glow_frame", "painting", "hopper",
  "redstone", "redstone_wire", "repeater", "powered_repeater", "unpowered_repeater",
  "comparator", "powered_comparator", "unpowered_comparator", "lever", "tripwire", "trip_wire",
  "tripwire_hook", "string", "daylight_detector", "daylight_detector_inverted",
  "cauldron", "water_cauldron", "lava_cauldron", "powder_snow_cauldron", "brewing_stand",
  "web", "cobweb", "bell", "lightning_rod", "flower_pot", "rail", "golden_rail",
  "powered_rail", "detector_rail", "activator_rail"
]);

export function isBlockedStructureItem(typeId) {
  if (typeId === "create_physics:disassembly_wrench") return true;
  if (typeId === "create:potato_cannon") return true;
  if (isStructurePlant(typeId)) return true;
  if (!typeId?.startsWith("minecraft:")) return false;
  const name=typeId.slice(10);
  return unsupported.has(name) || name.endsWith("_candle") || name.endsWith("_candle_cake") ||
    name.endsWith("_bed") || name.endsWith("_sign") || name.endsWith("_button") ||
    name.endsWith("_pressure_plate") || name.endsWith("_copper_golem_statue") ||
    name.endsWith("_rail");
}
