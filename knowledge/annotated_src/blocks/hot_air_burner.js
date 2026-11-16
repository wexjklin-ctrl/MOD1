/* CLAUDE-MAP-BEGIN
 FILE: blocks/hot_air_burner.js  (0 KB, 17 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: -
 IMPORTED BY: blocks/index.js
 EXPORTS: registerHotAirBurnerBlock
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): registerHotAirBurnerBlock@1(16L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
export function registerHotAirBurnerBlock(registry, services) {
  registry.registerCustomComponent("create_physics:hot_air_burner_interact", {
    onPlayerInteract(interaction) {
      const block = interaction.block;
      const player = interaction.player;
      if (!block || !player) return;
      if (services.isHoldingGlue(player)) services.useGlue(player, block, interaction.face ?? services.upDirection);
      else services.run(() => services.openControl(block, player));
    }
  });
  registry.registerCustomComponent("create_physics:hot_air_burner_flame_tick", {
    onTick(interaction) {
      if (interaction.block) services.syncFlame(interaction.block);
    }
  });
}
