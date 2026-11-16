/* CLAUDE-MAP-BEGIN
 FILE: blocks/restore_entity_visibility.js  (1 KB, 23 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (auto, from first comment) Native invisibility suppresses blob shadows. Physical visual entities use
 IMPORTS: -
 IMPORTED BY: main.js
 EXPORTS: restoreEntityVisibility
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): restoreEntityVisibility@13(10L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// Native invisibility suppresses blob shadows. Physical visual entities use
// renders_when_invisible so their block models and held items remain visible.
const noShadowVisuals = new Set([
  "airplane_throttle", "airplane_wing_control", "andesite_propeller", "andesite_propeller_on",
  "armchair", "chest", "physics_chest", "casing", "copycat_panel", "copycat_step", "girder", "guiding_wind", "handles",
  "handrail_lamp", "handrail_panel", "physics_bars", "physics_block", "physics_carpet", "physics_controller",
  "physics_fence", "physics_ladder", "physics_seat", "physics_slab", "physics_trapdoor",
  "physics_wall", "physics_wheel", "portable_engine", "propeller_bearing", "rope_hook",
  "steering_wheel", "symmetric_sail", "symmetric_sail_side", "windmill_sail", "throttle_lever", "vault", "tank", "tank_fluid", "hatch",
  "wall_lamp", "wheel_mount", "wheel_mount_iron", "wheel_mount_netherite", "mechanical_harvester", "mechanical_drill", "mechanical_saw", "deployer", "andesite_funnel", "brass_funnel", "steering_contro_wheel"
].map(name => `create_physics:${name}`));

export function restoreEntityVisibility(entity) {
  try {
    if (!entity?.isValid) return;
    if (noShadowVisuals.has(entity.typeId)) {
      if (!entity.getEffect("invisibility")) entity.addEffect("invisibility",20000000,{showParticles:false});
    } else if (entity.typeId === "create_physics:wheel" && entity.getEffect("invisibility")) {
      entity.removeEffect("invisibility");
    }
  } catch {}
}
