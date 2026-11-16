/* CLAUDE-MAP-BEGIN
 FILE: blocks/armchair.js  (1 KB, 23 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: blocks/rz_parts.js
 IMPORTED BY: blocks/block_orientation.js, blocks/car_orientation.js, blocks/index.js, main.js
 EXPORTS: ARMCHAIR_COLORS, PASSENGER_ARMCHAIR_IDS, isArmchairBlock, registerArmchairBlock
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): registerArmchairBlock@10(13L); isArmchairBlock@6(3L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { RZ_SEAT_IDS } from "./rz_parts.js";
export const ARMCHAIR_COLORS = ["white", "light_gray", "gray", "black", "brown", "red", "orange", "yellow", "lime", "green", "cyan", "light_blue", "blue", "purple", "magenta", "pink"];
// пассажирские кресла: те же кресла, но механика пассажирских сидений (id начинается с phys:seat_passenger - за рулём не управляют)
export const PASSENGER_ARMCHAIR_IDS = ARMCHAIR_COLORS.map(color => `phys:seat_passenger_armchair_${color}`);
const armchairIds = new Set([...ARMCHAIR_COLORS.map(color => color === "red" ? "create_physics:armchair" : `create_physics:armchair_${color}`), ...RZ_SEAT_IDS, ...PASSENGER_ARMCHAIR_IDS]);
export function isArmchairBlock(typeId) {
  return armchairIds.has(typeId);
}

export function registerArmchairBlock(registry, services) {
  registry.registerCustomComponent("create_physics:armchair_interact", {
    onPlace({ block }) {
      // Create the hidden seat immediately so nearby mobs can occupy it too.
      if (block) services.run(() => services.sit(block));
    },
    onPlayerInteract(interaction) {
      if (!interaction.block || !interaction.player) return;
      if (services.isHoldingGlue(interaction.player)) services.useGlue(interaction.player, interaction.block, interaction.face ?? services.upDirection);
      else services.run(() => services.sit(interaction.block, interaction.player));
    }
  });
}
