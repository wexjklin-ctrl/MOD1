/* CLAUDE-MAP-BEGIN
 FILE: blocks/index.js  (0 KB, 18 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: blocks/armchair.js, blocks/controller.js, blocks/handles.js, blocks/hot_air_burner.js, blocks/physics_glue.js, blocks/portable_engine.js, blocks/throttle_lever.js
 IMPORTED BY: main.js
 EXPORTS: THROTTLE_LEVER_BLOCK_ID, THROTTLE_LEVER_ENTITY_ID, showThrottleLeverControl, syncThrottleLeverEntities, registerPhysicsGlueItem, registerControllerBlock, registerHotAirBurnerBlock, registerArmchairBlock, registerHandlesBlock, PORTABLE_ENGINE_BLOCK_ID, interactWithPortableEngine, portableEngineFuelFromPermutation, syncPortableEngineEntities
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
export {
  THROTTLE_LEVER_BLOCK_ID,
  THROTTLE_LEVER_ENTITY_ID,
  showThrottleLeverControl,
  syncThrottleLeverEntities
} from "./throttle_lever.js";
export { registerPhysicsGlueItem } from "./physics_glue.js";
export { registerControllerBlock } from "./controller.js";
export { registerHotAirBurnerBlock } from "./hot_air_burner.js";
export { registerArmchairBlock } from "./armchair.js";
export { registerHandlesBlock } from "./handles.js";
export {
  PORTABLE_ENGINE_BLOCK_ID,
  interactWithPortableEngine,
  portableEngineFuelFromPermutation,
  syncPortableEngineEntities
} from "./portable_engine.js";
