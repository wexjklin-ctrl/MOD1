/* CLAUDE-MAP-BEGIN
 FILE: blocks/mechanical_harvester.js  (8 KB, 184 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: @minecraft/server, blocks/vault.js
 IMPORTED BY: blocks/deployer.js, blocks/deployer_tools.js, blocks/funnel.js, blocks/hatch.js, blocks/mechanical_drill.js, blocks/mechanical_saw.js, main.js
 EXPORTS: matureCrop, structureInventories, insertHarvestStack, collectHarvestDrops, tickPhysicsHarvesters
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): tickPhysicsHarvesters@129(55L); insertHarvestStack@47(31L); structureInventories@24(23L); collectHarvestDrops@78(16L); harvest@94(16L); visualsFor@113(16L); matureCrop@14(10L); localPoint@110(3L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { world, system } from "@minecraft/server";
import { physicsVaultSnapshots } from "./vault.js";
// Moving Create harvesters: bounded crop probes, vanilla drops, automatic replanting.
const cache = new WeakMap();
const cropAges = new Map([
  ["minecraft:wheat", ["growth", 7]],
  ["minecraft:carrots", ["growth", 7]],
  ["minecraft:potatoes", ["growth", 7]],
  ["minecraft:beetroot", ["growth", 7]],
  ["minecraft:nether_wart", ["age", 3]],
  ["minecraft:cocoa", ["age", 2]],
  ["minecraft:sweet_berry_bush", ["growth", 2]]
]);
export function matureCrop(block) {
  const info = cropAges.get(block?.typeId);
  if (!info) return undefined;
  const state = info[0];
  try {
    const age = block.permutation.getState(state);
    if (!Number.isFinite(age) || age < info[1]) return undefined;
    return {permutation:block.permutation.withState(state, block.typeId === "minecraft:sweet_berry_bush" ? 1 : 0)};
  } catch { return undefined; }
}
export function structureInventories(session, storages) {
  const containers = [], seen = new Set();
  const add = entity => {
    if (!entity?.isValid || seen.has(entity.id)) return;
    seen.add(entity.id);
    try {
      const container = entity.getComponent("minecraft:inventory")?.container;
      if (container) containers.push(container);
    } catch {}
  };
  for (const storage of storages?.values() ?? []) {
    if (storage.assembly === session.assembly && !storage.entity.hasTag("create_physics_deployer_hand")) add(storage.entity);
  }
  // Physical vaults retain Create's original inventory anchors, including after reload.
  for (const snapshot of physicsVaultSnapshots(session)) {
    if (!snapshot.storageEntityId || seen.has(snapshot.storageEntityId)) continue;
    try {
      const entity = world.getEntity(snapshot.storageEntityId);
      if (entity?.typeId === "create:vault_storage_anchor") add(entity);
    } catch {}
  }
  return containers;
}
export function insertHarvestStack(container, stack) {
  let amount = stack.amount;
  // Vaults use private three-slot anchors. Write their slots as Create does.
  for (let pass=0;pass<2 && amount>0;pass++) {
    for (let slot=0;slot<container.size && amount>0;slot++) {
      try {
        const current = container.getItem(slot);
        if (pass === 0) {
          if (!current || !current.isStackableWith(stack)) continue;
          const moved = Math.min(amount,Math.max(0,current.maxAmount-current.amount));
          if (!moved) continue;
          const updated=current.clone();
          updated.amount+=moved;
          container.setItem(slot,updated);
          amount-=moved;
        } else {
          if (current) continue;
          const moved=Math.min(amount,stack.maxAmount);
          const inserted=stack.clone();
          inserted.amount=moved;
          container.setItem(slot,inserted);
          amount-=moved;
        }
      } catch {}
    }
  }
  if (!amount) return undefined;
  const remainder=stack.clone();
  remainder.amount=amount;
  return remainder;
}
export function collectHarvestDrops(dimension, center, oldItems, containers) {
  for (const entity of dimension.getEntities({type:"minecraft:item",location:center,maxDistance:1.5})) {
    if (!entity.isValid || oldItems.has(entity.id)) continue;
    const stack = entity.getComponent("minecraft:item")?.itemStack;
    if (!stack) continue;
    const location = {...entity.location};
    // Remove the world stack before inserting, so partial fills never duplicate it.
    try { entity.remove(); } catch { continue; }
    let remainder = stack;
    for (const container of containers) {
      if (!remainder) break;
      try { remainder = insertHarvestStack(container,remainder); } catch {}
    }
    if (remainder) dimension.spawnItem(remainder,location);
  }
}
function harvest(block, containers) {
  const crop = matureCrop(block);
  if (!crop) return false;
  const {x,y,z} = block.location;
  const center = {x:x+0.5,y:y+0.5,z:z+0.5};
  const dimension = block.dimension;
  // Only collect newly generated loot; leave pre-existing dropped items untouched.
  const oldItems = containers.length ? new Set(dimension.getEntities({type:"minecraft:item",location:center,maxDistance:1.5}).map(entity=>entity.id)) : undefined;
  const result = dimension.runCommand(`setblock ${x} ${y} ${z} air destroy`);
  if (!result.successCount) return false;
  block.setPermutation(crop.permutation);
  if (containers.length) system.run(() => {
    try { collectHarvestDrops(dimension,center,oldItems,containers); } catch {}
  });
  return true;
}
function localPoint(session, point) {
  return session.assembly.body.localPointToWorld(session.assembly.getArticulatedLocalLocation(point));
}
function visualsFor(session, entry) {
  const ids = session.assembly.visualEntityIds;
  // Entity references are cheap to reuse; retry after streaming/rebuilding visuals.
  if (entry.visualIds !== ids || entry.visualCount !== ids.length || entry.visuals.some(e => !e.isValid)) {
    entry.visualIds = ids;
    entry.visualCount = ids.length;
    entry.visuals = [];
    for (const id of ids) {
      try {
        const entity = world.getEntity(id);
        if (entity?.typeId === "create_physics:mechanical_harvester") entry.visuals.push(entity);
      } catch {}
    }
  }
  return entry.visuals;
}
export function tickPhysicsHarvesters(sessions, storages, ensureVaultInventories) {
  let budget = 32;
  for (const session of sessions.values()) {
    if (!session.assembly?.isValid || session.streamingMotion) continue;
    let entry = cache.get(session);
    if (!entry || entry.snapshots !== session.snapshots || entry.count !== session.snapshots.length) {
      entry = {snapshots:session.snapshots,count:session.snapshots.length,
        harvesters:session.snapshots.filter(s => s.typeId === "create:mechanical_harvester"),
        previous:new Map(),visuals:[],visualIds:undefined,visualCount:-1};
      cache.set(session,entry);
    }
    if (!entry.harvesters.length) continue;
    const speed = Math.hypot(session.assembly.body.velocity.x, session.assembly.body.velocity.z);
    let anyActive = false;
    const seen = new Set();
    ensureVaultInventories?.(session);
    const containers = structureInventories(session, storages);
    for (const snapshot of entry.harvesters) {
      const yaw = ({north:180,east:90,south:0,west:-90}[snapshot.permutation.getState("minecraft:cardinal_direction")] ?? 0) * Math.PI / 180;
      const front = {x:-Math.sin(yaw),z:Math.cos(yaw)};
      const side = {x:front.z,z:-front.x};
      const local = {x:snapshot.location.x-session.location.x,y:snapshot.location.y-session.location.y,z:snapshot.location.z-session.location.z};
      const tip = localPoint(session,{x:local.x+front.x,y:local.y,z:local.z+front.z});
      const previous = entry.previous.get(snapshot);
      entry.previous.set(snapshot,tip);
      const travel = previous ? Math.hypot(tip.x-previous.x,tip.y-previous.y,tip.z-previous.z) : 0;
      const active = speed > 0.02 || travel > 0.005 || snapshot.permutation.getState("create:is_spinning") === true;
      anyActive ||= active;
      if (!active || budget <= 0) continue;
      // Sweep between updates so a fast vehicle does not skip rows of crops.
      const steps = previous && travel < 4 ? Math.min(10,Math.max(1,Math.ceil(travel/0.35))) : 1;
      for (let step=1;step<=steps;step++) {
        const t=step/steps;
        const sweep=steps>1 ? {x:previous.x+(tip.x-previous.x)*t-tip.x,y:previous.y+(tip.y-previous.y)*t-tip.y,z:previous.z+(tip.z-previous.z)*t-tip.z} : {x:0,y:0,z:0};
        for (const across of [-0.4,0,0.4]) {
          const point=localPoint(session,{x:local.x+front.x+side.x*across,y:local.y,z:local.z+front.z+side.z*across});
          for (const height of [0,-0.45]) {
            if (budget <= 0) break;
            const position={x:Math.floor(point.x+sweep.x),y:Math.floor(point.y+sweep.y+height),z:Math.floor(point.z+sweep.z)};
            const key=`${position.x},${position.y},${position.z}`;
            if (seen.has(key)) continue;
            seen.add(key);
            try {
              const block=session.dimension.getBlock(position);
              if (matureCrop(block) && harvest(block, containers)) budget--;
            } catch {}
          }
        }
      }
    }
    for (const entity of visualsFor(session,entry)) {
      try { if(entity.getProperty("create_physics:harvesting") !== anyActive) entity.setProperty("create_physics:harvesting",anyActive); } catch {}
    }
  }
}
