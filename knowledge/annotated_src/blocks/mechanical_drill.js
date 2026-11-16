/* CLAUDE-MAP-BEGIN
 FILE: blocks/mechanical_drill.js  (5 KB, 106 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: @minecraft/server, blocks/block_hardness.js, blocks/mechanical_harvester.js
 IMPORTED BY: blocks/deployer.js, main.js
 EXPORTS: drillFacing, drillForward, canDrill, tickPhysicsDrills
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): tickPhysicsDrills@69(38L); targetFor@28(33L); breakTarget@18(10L); drillVisuals@61(8L); drillFacing@5(6L); drillForward@11(4L); canDrill@15(3L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { world, system } from "@minecraft/server";
import { getBlockHardness } from "./block_hardness.js";
import { structureInventories, collectHarvestDrops } from "./mechanical_harvester.js";
const cache = new WeakMap();
export function drillFacing(permutation) {
  try {
    const value=permutation.getState("minecraft:facing_direction") ?? permutation.getState("facing_direction");
    return typeof value === "number" ? ["down","up","north","south","west","east"][value] ?? "south" : value ?? "south";
  } catch { return "south"; }
}
export function drillForward(facing) {
  // Match the original model's +Z drill tip through the physical visual transform.
  return {south:{x:0,y:0,z:-1},north:{x:0,y:0,z:1},east:{x:-1,y:0,z:0},west:{x:1,y:0,z:0},up:{x:0,y:1,z:0},down:{x:0,y:-1,z:0}}[facing] ?? {x:0,y:0,z:-1};
}
export function canDrill(block) {
  return !!block && !block.isAir && !block.isLiquid && block.typeId !== "create_physics:lamp_light" && getBlockHardness(block) >= 0;
}
function breakTarget(block,containers) {
  const {x,y,z}=block.location;
  const center={x:x+0.5,y:y+0.5,z:z+0.5}, dimension=block.dimension;
  const oldItems=containers.length ? new Set(dimension.getEntities({type:"minecraft:item",location:center,maxDistance:1.5}).map(e=>e.id)) : undefined;
  const result=dimension.runCommand(`setblock ${x} ${y} ${z} air destroy`);
  if (!result.successCount) return false;
  if (containers.length) system.run(()=>{try { collectHarvestDrops(dimension,center,oldItems,containers); } catch {}});
  try { dimension.playSound("dig.stone",center,{volume:0.45}); } catch {}
  return true;
}
function targetFor(session,snapshot,pending) {
  const front=drillForward(drillFacing(snapshot.permutation));
  const local={x:snapshot.location.x-session.location.x,y:snapshot.location.y-session.location.y,z:snapshot.location.z-session.location.z};
  const horizontal = front.y === 0;
  const side = horizontal ? {x:front.z,y:0,z:-front.x} : {x:1,y:0,z:0};
  const up = horizontal ? {x:0,y:1,z:0} : {x:0,y:0,z:1};
  const candidates=[], seen=new Set();
  // Probe the entire cutter face; a tilted chassis must not leave seams in a wall.
  for (const distance of [0.8,1.1,1.45]) {
    for (const [u,v] of [[0,0],[-0.4,0],[0.4,0],[0,-0.4],[0,0.4],[-0.4,-0.4],[-0.4,0.4],[0.4,-0.4],[0.4,0.4]]) {
      const point=session.assembly.body.localPointToWorld(session.assembly.getArticulatedLocalLocation({
        x:local.x+front.x*distance+side.x*u+up.x*v,
        y:local.y+front.y*distance+side.y*u+up.y*v,
        z:local.z+front.z*distance+side.z*u+up.z*v
      }));
      const position={x:Math.floor(point.x),y:Math.floor(point.y),z:Math.floor(point.z)};
      const key=`${position.x},${position.y},${position.z}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let block;
      try {block=session.dimension.getBlock(position);} catch {continue;}
      if (!block || block.isAir || block.isLiquid || block.typeId === "create_physics:lamp_light") continue;
      candidates.push(block);
    }
    // Do not reach through a blocking layer into blocks farther behind it.
    if (candidates.length) break;
  }
  if (pending) {
    const previous=candidates.find(block=>`${block.location.x},${block.location.y},${block.location.z}|${block.typeId}` === pending.key);
    if (previous) return previous;
  }
  return candidates.find(canDrill) ?? candidates[0];
}
function drillVisuals(session,entry) {
  const ids=session.assembly.visualEntityIds;
  if (entry.ids !== ids || entry.idCount !== ids.length || entry.visuals.some(e=>!e.isValid)) {
    entry.ids=ids; entry.idCount=ids.length; entry.visuals=[];
    for (const id of ids) { try { const e=world.getEntity(id); if(e?.typeId === "create_physics:mechanical_drill") entry.visuals.push(e); } catch {} }
  }
  return entry.visuals;
}
export function tickPhysicsDrills(sessions,storages,ensureVaultInventories,refreshTerrain) {
  let budget=16;
  for (const session of sessions.values()) {
    if (!session.assembly?.isValid || session.streamingMotion) continue;
    let entry=cache.get(session);
    if (!entry || entry.snapshots !== session.snapshots || entry.count !== session.snapshots.length) {
      entry={snapshots:session.snapshots,count:session.snapshots.length,drills:session.snapshots.filter(s=>s.typeId === "create:mechanical_drill"),progress:new Map(),visuals:[],ids:undefined,idCount:-1};
      cache.set(session,entry);
    }
    if (!entry.drills.length) continue;
    ensureVaultInventories?.(session);
    const containers=structureInventories(session,storages);
    let active=false;
    const broken=[];
    for (const snapshot of entry.drills) {
      try {
        const pending=entry.progress.get(snapshot);
        const block=targetFor(session,snapshot,pending);
        const running=!session.assembly.body.isSleeping || snapshot.permutation.getState("create:is_spinning") === true || !!pending || canDrill(block);
        active ||= running;
        if (!running || budget <= 0) continue;
        if (!canDrill(block)) {entry.progress.delete(snapshot);continue;}
        const {x,y,z}=block.location;
        const key=`${x},${y},${z}|${block.typeId}`;
        const state=pending?.key === key ? pending : {key,ticks:0};
        state.ticks+=2;
        entry.progress.set(snapshot,state);
        const required=Math.max(2,Math.min(300,Math.ceil(getBlockHardness(block)*4)));
        if (state.ticks < required) continue;
        if (breakTarget(block,containers)) {broken.push({x,y,z});entry.progress.delete(snapshot);budget--;}
      } catch {}
    }
    if (broken.length) refreshTerrain?.(session,broken);
    for (const entity of drillVisuals(session,entry)) {
      try {if(entity.getProperty("create_physics:drilling") !== active) entity.setProperty("create_physics:drilling",active);} catch {}
    }
  }
}