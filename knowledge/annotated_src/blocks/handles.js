/* CLAUDE-MAP-BEGIN
 FILE: blocks/handles.js  (0 KB, 19 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: -
 IMPORTED BY: blocks/index.js
 EXPORTS: registerHandlesBlock
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): registerHandlesBlock@1(18L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
export function registerHandlesBlock(registry, services) {
  registry.registerCustomComponent("create_physics:handles_link_interact", {
    onPlayerInteract(interaction) {
      const block = interaction.block;
      const player = interaction.player;
      if (!block || !player) return;
      if (services.isHoldingGlue(player)) services.useGlue(player, block, interaction.face ?? services.upDirection);
    }
  });
  registry.registerCustomComponent("create_physics:rope_hook_interact", {
    onPlayerInteract({ block, player, face }) {
      if (!block || !player) return;
      if (services.isHoldingGlue(player)) services.useGlue(player, block, face ?? services.upDirection);
      else if (services.isHoldingShears(player)) services.removeRopes(player, block);
      else if (services.isHoldingRope(player)) services.link(player, block);
    }
  });
}
