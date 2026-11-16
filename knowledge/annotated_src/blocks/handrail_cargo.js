/* CLAUDE-MAP-BEGIN
 FILE: blocks/handrail_cargo.js  (8 KB, 204 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: @minecraft/server
 IMPORTED BY: main.js
 EXPORTS: configureHandrailCargo, ensureCargoVisual, moveCargo, cargoPathClear, captureCargo, queueCargoPlacement, settleCargo, forgetCargoVisual, releaseCargoFromBrokenPanel, removeStaleCargoVisual
 DYN-PROPS: create_physics:handrail_motion
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): captureCargo@63(66L); settleCargo@135(37L); ensureCargoVisual@19(21L); releaseCargoFromBrokenPanel@180(13L); removeStaleCargoVisual@194(10L); cargoPathClear@54(8L); moveCargo@41(7L); point@7(6L); forgetCargoVisual@173(6L); persist@14(4L); releaseGuide@49(4L); queueCargoPlacement@132(3L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { world, StructureSaveMode } from "@minecraft/server";

let factory;
export function configureHandrailCargo(services) { factory = services; }
const ZERO = { x: 0, y: 0, z: 0 };

function point(entry, block, offset) {
  const p = { x: entry.state.origin.x + block.dx, y: entry.state.origin.y + block.dy,
    z: entry.state.origin.z + block.dz };
  p[entry.state.axis] += offset;
  return p;
}

function persist(entry) {
  if (entry.entity.isValid)
    entry.entity.setDynamicProperty("create_physics:handrail_motion", JSON.stringify(entry.state));
}

export function ensureCargoVisual(entry) {
  const cargo = entry.state.cargo;
  if (!cargo || entry.cargoAssembly?.isValid) return;
  if (!factory) throw new Error("The moving block system is still starting.");
  releaseGuide(entry);
  for (const id of cargo.visualIds ?? []) {
    const entity = world.getEntity(id);
    if (entity?.isValid) entity.remove();
  }
  for (const entity of entry.entity.dimension.getEntities({ tags: [`handrail_cargo_${entry.entity.id}`] })) {
    if (entity.isValid) entity.remove();
  }
  const anchor = { x: entry.state.origin.x, y: entry.state.origin.y, z: entry.state.origin.z };
  const snapshots = cargo.blocks.map(b => ({ ...b, typeId: b.typeId, states: b.states, location: point(entry, b, 0) }));
  entry.cargoAssembly = factory.createAssembly(entry.entity.dimension, snapshots, anchor, `handrail_cargo_${entry.entity.id}`, entry.state.axis, entry);
  cargo.visualIds = entry.cargoAssembly.visualEntityIds;
  moveCargo(entry);
  if (entry.onPhysicsStep && factory.observeStep)
    entry.releaseGuide = factory.observeStep(entry.entity.dimension, entry.onPhysicsStep);
  persist(entry);
}

export function moveCargo(entry) {
  if (!entry.cargoAssembly?.isValid) return;
  const p = { x: entry.state.origin.x + 0.5, y: entry.state.origin.y + 0.5, z: entry.state.origin.z + 0.5 };
  p[entry.state.axis] += entry.state.offset;
  entry.cargoAssembly.body.teleport(p, { velocity: ZERO, angularVelocity: ZERO, rotation: ZERO });
  entry.cargoAssembly.syncVisuals(true);
}

function releaseGuide(entry) {
  entry.releaseGuide?.();
  delete entry.releaseGuide;
}

export function cargoPathClear(entry, offset) {
  for (const block of entry.state.cargo?.blocks ?? []) {
    let target;
    try { target = entry.entity.dimension.getBlock(point(entry, block, offset)); } catch { return false; }
    if (!target?.isAir) return false;
  }
  return true;
}

export function captureCargo(entry) {
  if (entry.state.cargo) {
    ensureCargoVisual(entry);
    return;
  }
  const { state, entity } = entry;
  const offset = Math.round(state.offset);
  const seed = { ...state.origin }; seed.y++; seed[state.axis] += offset;
  if (!factory?.collectBlocks) throw new Error("The Physics Glue system is still starting.");
  // The panel attaches only its top block. All other membership comes from
  // the controller's native glue collector, never a flood fill of neighbors.
  const selected = factory.collectBlocks(entity.dimension, seed);
  const blocks = [];
  for (const snapshot of selected) {
    const p = snapshot.location;
    const block = entity.dimension.getBlock(p);
    if (!block) throw new Error("Load the area above the panel before moving it.");
    if (block.isAir) continue;
    if (block.isLiquid || /(?:bedrock|barrier|portal|structure_block|command_block)$/.test(block.typeId)
      || block.typeId === "create_physics:handrail" || block.typeId === "create_physics:handrail_panel")
      throw new Error("A block attached to the panel cannot be moved.");
    blocks.push({ dx: p.x - state.origin.x - (state.axis === "x" ? offset : 0), dy: p.y - state.origin.y,
      dz: p.z - state.origin.z - (state.axis === "z" ? offset : 0), typeId: block.typeId,
      states: block.permutation.getAllStates() });
  }
  if (!blocks.length) {
    // The slider itself has a constrained physical body even before it has cargo.
    state.cargo = { blocks: [], sourceOffset: offset, phase: "moving", visualIds: [] };
    try { ensureCargoVisual(entry); }
    catch (error) { delete state.cargo; throw error; }
    return;
  }
  const prefix = `create_physics:handrail_${entity.id.replace(/[^a-zA-Z0-9_]/g, "_")}_${Date.now()}`;
  const cargo = { blocks, sourceOffset: offset, phase: "capturing", visualIds: [] };
  state.cargo = cargo;
  if (JSON.stringify(state).length > 26000) { delete state.cargo; throw new Error("The blocks attached to the panel contain too much data."); }
  try {
    // Save block entities too: inventories/signs survive transport and reloads.
    for (let i = 0; i < blocks.length; i++) {
      const p = point(entry, blocks[i], offset);
      blocks[i].structure = `${prefix}_${i}`;
      world.structureManager.createFromWorld(blocks[i].structure, entity.dimension, p, p,
        { includeBlocks: true, includeEntities: false, saveMode: StructureSaveMode.World });
    }
    persist(entry);
    ensureCargoVisual(entry); // Validate all renderers before removing any source block.
    for (const b of blocks) entity.dimension.getBlock(point(entry, b, offset)).setType("minecraft:air");
    cargo.phase = "moving";
    persist(entry);
    factory.onCaptured?.(entity.dimension, blocks.map(block => ({ ...block, location: point(entry, block, offset) })));
  } catch (error) {
    // Restore the exact saved cells if assembly creation/removal failed.
    for (const b of blocks) {
      if (b.structure && world.structureManager.get(b.structure))
        world.structureManager.place(b.structure, entity.dimension, point(entry, b, offset));
    }
    factory?.disposeSession?.(entry, true);
    entry.cargoAssembly?.remove();
    releaseGuide(entry);
    delete entry.cargoAssembly;
    for (const b of blocks) if (b.structure) world.structureManager.delete(b.structure);
    delete state.cargo;
    persist(entry);
    throw error;
  }
}

// Placement is handled by placeBlockOnPhysicsController, including inventory,
// orientation, native block entities, and the existing mining/session system.
export function queueCargoPlacement(entry, event, player, hit) {
  return factory?.queuePlacement(entry, event, player, hit) ?? false;
}
export function settleCargo(entry) {
  const cargo = entry.state.cargo;
  if (!cargo) return true;
  if (cargo.phase === "restored" || (cargo.phase !== "capturing" && factory?.restoreSession)) {
    if (cargo.phase !== "restored" && !factory.restoreSession(entry)) return false;
    if (entry.state.cargo !== cargo) return true; // Completed synchronously.
    releaseGuide(entry);
    delete entry.cargoAssembly;
    delete entry.state.cargo;
    persist(entry);
    for (const b of cargo.blocks) if (b.structure) world.structureManager.delete(b.structure);
    return true;
  }
  const offset = Math.round(entry.state.offset);
  const rollback = cargo.phase === "capturing";
  const destination = rollback ? cargo.sourceOffset : offset;
  // Never replace an unrelated world block to make room for the load.
  for (let i = cargo.settled ?? 0; i < cargo.blocks.length; i++) {
    let target;
    try { target = entry.entity.dimension.getBlock(point(entry, cargo.blocks[i], destination)); } catch { return false; }
    if (!target || (!target.isAir && !rollback)) return false;
  }
  for (let i = cargo.settled ?? 0; i < cargo.blocks.length; i++) {
    world.structureManager.place(cargo.blocks[i].structure, entry.entity.dimension, point(entry, cargo.blocks[i], destination));
    cargo.settled = i + 1;
    persist(entry);
  }
  factory?.disposeSession?.(entry, true);
  entry.cargoAssembly?.remove();
  releaseGuide(entry);
  delete entry.cargoAssembly;
  for (const id of cargo.visualIds ?? []) { const e = world.getEntity(id); if (e?.isValid) e.remove(); }
  delete entry.state.cargo;
  persist(entry);
  for (const b of cargo.blocks) world.structureManager.delete(b.structure);
  return true;
}

export function forgetCargoVisual(entry) {
  factory?.disposeSession?.(entry, false);
  releaseGuide(entry);
  entry.cargoAssembly?.remove();
  delete entry.cargoAssembly;
}

export function releaseCargoFromBrokenPanel(entry) {
  // Keep the cargo in the native physics system when its rail anchor breaks.
  // Restoring to world blocks could be obstructed and leave the panel orphaned.
  if (entry.state.cargo && !factory?.releaseSession?.(entry)) return false;
  releaseGuide(entry);
  for (const block of entry.state.cargo?.blocks ?? []) {
    if (block.structure) world.structureManager.delete(block.structure);
  }
  delete entry.cargoAssembly;
  delete entry.state.cargo;
  entry.state.guided = false;
  return true;
}

export function removeStaleCargoVisual(entity) {
  if (!entity.isValid) return;
  const tag = entity.getTags().find(t => t.startsWith("handrail_cargo_"));
  if (!tag) return;
  const parent = world.getEntity(tag.slice("handrail_cargo_".length));
  let ids;
  try { ids = JSON.parse(parent?.getDynamicProperty("create_physics:handrail_motion") ?? "{}").cargo?.visualIds; }
  catch { return; }
  if (!ids?.includes(entity.id)) entity.remove();
}
