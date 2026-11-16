/* CLAUDE-MAP-BEGIN
 FILE: blocks/controller.js  (0 KB, 11 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: -
 IMPORTED BY: blocks/index.js
 EXPORTS: registerControllerBlock
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): registerControllerBlock@1(10L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
export function registerControllerBlock(registry, services) {
  registry.registerCustomComponent("create_physics:controller_interact", {
    onPlayerInteract(interaction) {
      const block = interaction.block;
      const player = interaction.player;
      if (!block || !player || !services.acceptInteraction(player, block)) return;
      services.toggle(block);
    }
  });
}
