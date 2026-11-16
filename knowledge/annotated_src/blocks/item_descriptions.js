/* CLAUDE-MAP-BEGIN
 FILE: blocks/item_descriptions.js  (1 KB, 29 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: @minecraft/server
 IMPORTED BY: main.js
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { system, world } from "@minecraft/server";

const items = new Set(["create_physics:handles", "create_physics:physics_glue"]);
const previousDescriptions = new Set([
  "\u00a7r\u00a7cMove physical structures",
  "\u00a7r\u00a7cJoin blocks into a physical structure",
  "\u00a7r\u00a7cGrab and move physical structures",
  "\u00a7r\u00a7cGlue blocks together into a structure"
]);

// Descriptions now belong to the resource pack's native display names, so
// Creative stacks show them too. Remove only our old script-added lore.
system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    try {
      const inventory = player.getComponent("minecraft:inventory")?.container;
      if (!inventory) continue;
      for (let slot = 0; slot < inventory.size; slot++) {
        const item = inventory.getItem(slot);
        if (!items.has(item?.typeId)) continue;
        const lore = item.getLore();
        if (!lore.some(line => previousDescriptions.has(line))) continue;
        item.setLore(lore.filter(line => !previousDescriptions.has(line)));
        inventory.setItem(slot, item);
      }
    } catch { /* Retry when the player's inventory is accessible again. */ }
  }
}, 20);
