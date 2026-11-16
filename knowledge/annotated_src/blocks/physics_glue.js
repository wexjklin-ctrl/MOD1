/* CLAUDE-MAP-BEGIN
 FILE: blocks/physics_glue.js  (1 KB, 31 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: @minecraft/server
 IMPORTED BY: blocks/index.js, main.js
 EXPORTS: damagePhysicsGlue, registerPhysicsGlueItem
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): damagePhysicsGlue@3(17L); registerPhysicsGlueItem@21(10L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { GameMode } from "@minecraft/server";

export function damagePhysicsGlue(player) {
  if (player.getGameMode() === GameMode.Creative) return;
  const inventory=player.getComponent("minecraft:inventory")?.container;
  const slot=player.selectedSlotIndex;
  const item=inventory?.getItem(slot);
  if (item?.typeId !== "create_physics:physics_glue") return;
  const updated=item.clone();
  const durability=updated.getComponent("minecraft:durability");
  if (!durability) return;
  if (durability.damage+1 >= durability.maxDurability) {
    inventory.setItem(slot,undefined);
    try { player.dimension.playSound("random.break",player.location,{volume:0.8,pitch:1}); } catch {}
  } else {
    durability.damage++;
    inventory.setItem(slot,updated);
  }
}

export function registerPhysicsGlueItem(registry, services) {
  registry.registerCustomComponent("create_physics:physics_glue_use", {
    onUseOn(interaction) {
      const block = interaction.block;
      const player = interaction.source;
      if (!block || !player || block.typeId === services.controllerTypeId) return;
      services.useGlue(player, block, interaction.blockFace);
    }
  });
}
