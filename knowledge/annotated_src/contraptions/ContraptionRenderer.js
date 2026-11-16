/* CLAUDE-MAP-BEGIN
 FILE: contraptions/ContraptionRenderer.js  (6 KB, 109 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: blocks/symmetric_sails.js
 IMPORTED BY: contraptions/ContraptionInteraction.js, physics.js
 EXPORTS: BATCH_ENTITY, TOWER_BATCH_ENTITY, BATCH_SLOTS, BATCH_EDGE, BATCH_POSITION_VALUES, encodeBatchSlot, BATCH_PALETTE, shouldRebatchContraption, batchTextureIndex, planContraptionVisuals, createContraptionBatch, hideContraptionSlot
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): planContraptionVisuals@47(38L); createContraptionBatch@85(21L); batchTextureIndex@35(12L); encodeBatchSlot@7(7L); shouldRebatchContraption@30(5L); hideContraptionSlot@106(3L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { SAIL_COLORS } from "../blocks/symmetric_sails.js";
export const BATCH_ENTITY = "create_physics:contraption_batch";
export const TOWER_BATCH_ENTITY = "create_physics:tower_batch";   // шаг 149: пачка головы башни, вращается вокруг оси башни
export const BATCH_SLOTS = 20;
export const BATCH_EDGE = 64;
export const BATCH_POSITION_VALUES = BATCH_EDGE ** 3;
export function encodeBatchSlot(type, x, y, z) {
  if (!Number.isInteger(type) || type < 1 || type > BATCH_PALETTE.length ||
      ![x, y, z].every(value => Number.isInteger(value) && value >= 0 && value < BATCH_EDGE))
    throw new RangeError("Invalid packed contraption slot.");
  // <2^24: exact even when Molang evaluates it as a 32-bit float.
  return type * BATCH_POSITION_VALUES + x + y * BATCH_EDGE + z * BATCH_EDGE ** 2;
}
// Fixed cube textures only. Special geometry, directional and animated blocks
// continue through the existing renderer. Indices are shared with RP arrays.
export const BATCH_PALETTE = [
  ["minecraft:stone", "stone"], ["minecraft:cobblestone", "cobblestone"],
  ["minecraft:bricks", "brick"], ["minecraft:iron_block", "iron_block"],
  ["minecraft:gold_block", "gold_block"], ["minecraft:diamond_block", "diamond_block"],
  ["minecraft:emerald_block", "emerald_block"], ["minecraft:coal_block", "coal_block"],
  ["minecraft:obsidian", "obsidian"], ["minecraft:glass", "glass"],
  ...["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"]
    .flatMap(color => [[`minecraft:${color}_wool`, `wool_colored_${color === "light_gray" ? "silver" : color}`],
      [`minecraft:${color}_concrete`, `concrete_${color === "light_gray" ? "silver" : color}`]]),
  ...SAIL_COLORS.map(color => [color === "white" ? "create_physics:hot_air_envelope" : `create_physics:hot_air_envelope_${color}`,
    `textures/blocks/hot_air_envelope/hot_air_envelope${color === "white" ? "" : "_"+(color === "magenta" ? "margente" : color)}`])
];
const palette = new Map(BATCH_PALETTE.map(([id], index) => [id, index + 1]));
const pendingBatchBlocks = new WeakMap();
export function shouldRebatchContraption(assembly, additions) {
  const count = (pendingBatchBlocks.get(assembly) ?? 0) + additions.filter(block => batchTextureIndex(block)).length;
  pendingBatchBlocks.set(assembly, count % BATCH_SLOTS);
  return count >= BATCH_SLOTS;
}
export function batchTextureIndex(block) {

  // Envelopes retain the original per-block renderer and interaction box.
  if (block.typeId?.startsWith("create_physics:hot_air_envelope")) return 0;
  if (block.typeId === "minecraft:stone" && Object.entries(block.contraptionStates ?? {})
      .some(([name, value]) => name !== "stone_type" || value !== "stone")) return 0;
  if (block.visualAttachment || block.visual || Object.keys(block.visualProperties ?? {}).length ||
      block.visualEntityTypeId && block.visualEntityTypeId !== "create_physics:physics_block" ||
      block.itemTypeId && block.itemTypeId !== block.typeId) return 0;
  if (["x", "y", "z"].some(axis => Math.abs(block.rotation?.[axis] ?? 0) % 360 > 0.001)) return 0;
  return palette.get(block.typeId) ?? 0;
}
export function planContraptionVisuals(blocks, anchor, fallbackSlots = 2) {
  const buckets = new Map(), fallback = [], result = [];
  // Frequent textures get a shared mesh pass. Rare mixed blocks retain the
  // flexible per-slot path rather than allocating a tiny actor for every type.
  const repeated=new Map();
  for(const block of blocks){
    const type=batchTextureIndex(block);
    const id=type?`cube|${type}`:undefined;
    if(id)repeated.set(id,(repeated.get(id)??0)+1);
  }
  for (const block of blocks) {
    const offsets = ["x", "y", "z"].map(axis => block.localLocation[axis] - anchor[axis]);
    const type=batchTextureIndex(block);
    const repeatedId=`cube|${type}`;
    const bucket=type ? block.towerKey ? `tower|${block.towerKey}` : (repeated.get(repeatedId)??0)>=6?repeatedId:"cubes" : undefined;   // шаг 149: голова башни - свои пачки
    if (bucket && offsets.every(value => Number.isInteger(value) && Math.abs(value) <= 384)) {
      let members=buckets.get(bucket);if(!members)buckets.set(bucket,members=[]);members.push(block);
    }
    else fallback.push(block);
  }
  for (const eligible of buckets.values()) {
  let group = [], minimum, maximum;
  const flush = () => { if (group.length) result.push({ batch: true, tower: group[0].towerKey ? true : undefined, blocks: group }); group = []; };
  for (const block of eligible) {
    const p = block.localLocation;
    if (group.length && (group.length === BATCH_SLOTS || ["x", "y", "z"].some(axis =>
        Math.max(maximum[axis], p[axis]) - Math.min(minimum[axis], p[axis]) >= BATCH_EDGE))) flush();
    if (!group.length) { minimum = { ...p }; maximum = { ...p }; }
    else for (const axis of ["x", "y", "z"]) {
      minimum[axis] = Math.min(minimum[axis], p[axis]); maximum[axis] = Math.max(maximum[axis], p[axis]);
    }
    group.push(block);
  }
  flush();
  }
  for (let i = 0; i < fallback.length; i += fallbackSlots) result.push({ batch: false, blocks: fallback.slice(i, i + fallbackSlots) });
  return result;
}
export function createContraptionBatch(dimension, body, anchor, blocks, tags, rotation, tower) {
  if (!blocks.length || blocks.length > BATCH_SLOTS) throw new Error("Invalid contraption batch size.");
  const entity = dimension.spawnEntity(tower ? TOWER_BATCH_ENTITY : BATCH_ENTITY, body.localPointToWorld(anchor));
  try {
    for (const tag of tags) if (!entity.addTag(tag)) throw new Error("Could not tag contraption batch.");
    const angles = rotation ?? body.getVisualRotation();
    for (const [axis, name] of [["x", "pitch"], ["y", "yaw"], ["z", "roll"]])
      entity.setProperty(`create_physics:${name}`, ((angles[axis] % 360) + 540) % 360 - 180);
    const origin = Object.fromEntries(["x", "y", "z"].map(axis => [axis, Math.min(...blocks.map(block => block.localLocation[axis]))]));
    for (const axis of ["x", "y", "z"]) entity.setProperty(`create_physics:batch_${axis}`, origin[axis] - anchor[axis]);
    const firstType=batchTextureIndex(blocks[0]);
    entity.setProperty("create_physics:uniform_type",!tower&&blocks.every(block=>batchTextureIndex(block)===firstType)?firstType:0);
    blocks.forEach((block, slot) => {
      const type = batchTextureIndex(block);
      if (!type) throw new Error("Unsupported block in contraption batch.");
      entity.setProperty(`create_physics:b${slot}_data`, encodeBatchSlot(type,
        block.localLocation.x - origin.x, block.localLocation.y - origin.y, block.localLocation.z - origin.z));
    });
    return entity;
  } catch (error) { if (entity.isValid) entity.remove(); throw error; }
}
export function hideContraptionSlot(entity, slot) {
  if (entity.isValid) entity.setProperty(`create_physics:b${slot}_data`, 0);
}
