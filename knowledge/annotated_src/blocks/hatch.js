/* CLAUDE-MAP-BEGIN
 FILE: blocks/hatch.js  (6 KB, 134 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: @minecraft/server, blocks/double_chest.js, blocks/mechanical_harvester.js
 IMPORTED BY: main.js
 EXPORTS: HATCH_ID, hatchPlacementFacing, hatchVisualProperties, physicsHatchInventories, syncPhysicsHatchVisuals, depositPhysicsHatch, queuePhysicsHatchUse
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): physicsHatchInventories@21(32L); queuePhysicsHatchUse@104(30L); syncPhysicsHatchVisuals@54(25L); depositPhysicsHatch@80(23L); hatchPlacementFacing@11(5L); hatchVisualProperties@17(3L); key@7(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { world, system } from "@minecraft/server";
import { physicsChestPartner } from "./double_chest.js";
import { insertHarvestStack } from "./mechanical_harvester.js";

export const HATCH_ID = "create:hatch";
const offsets=[{x:1,y:0,z:0},{x:-1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:-1,z:0},{x:0,y:0,z:1},{x:0,y:0,z:-1}];
const key=p=>`${p.x},${p.y},${p.z}`;
const useTicks=new Map();
const openUntil=new WeakMap();

export function hatchPlacementFacing(face) {
  // The Hatch's back plate sits on the side named by its facing state.
  // Point that back toward the supporting wall, leaving the opening outside.
  return {north:"south",south:"north",east:"west",west:"east"}[face] ?? "south";
}

export function hatchVisualProperties(snapshot) {
  return {"create_physics:hatch_open":snapshot.permutation.getState("create:open")===true};
}

export function physicsHatchInventories(session,snapshot,storages) {
  const byPosition=new Map(session.snapshots.map(s=>[key(s.location),s]));
  const targets=[],seenEntities=new Set(),visitedVaults=new Set();
  const add=s=>{
    if(!s) return;
    const owner=s.storageEntityId?s:physicsChestPartner(s,session.snapshots);
    if(!owner?.storageEntityId || seenEntities.has(owner.storageEntityId)) return;
    const record=storages.get(owner.storageEntityId);
    if(record && record.assembly!==session.assembly) return;
    const entity=record?.entity??world.getEntity(owner.storageEntityId);
    if(!entity?.isValid || entity.hasTag("create_physics_deployer_hand")) return;
    const container=entity.getComponent("minecraft:inventory")?.container;
    if(container) {seenEntities.add(entity.id);targets.push(container);}
  };
  for(const delta of offsets) {
    const neighbor=byPosition.get(key({x:snapshot.location.x+delta.x,y:snapshot.location.y+delta.y,z:snapshot.location.z+delta.z}));
    if(!neighbor) continue;
    if(neighbor.typeId!=="create:vault") {add(neighbor);continue;}
    const queue=[neighbor];
    for(let i=0;i<queue.length;i++) {
      const s=queue[i],id=key(s.location);
      if(visitedVaults.has(id)) continue;
      visitedVaults.add(id);
      add(s);
      for(const d of offsets) {
        const next=byPosition.get(key({x:s.location.x+d.x,y:s.location.y+d.y,z:s.location.z+d.z}));
        if(next?.typeId==="create:vault" && !visitedVaults.has(key(next.location))) queue.push(next);
      }
    }
  }
  return targets;
}

export function syncPhysicsHatchVisuals(session) {
  if(!session.assembly?.isValid) return;
  const hatches=new Map();
  for(const snapshot of session.snapshots) if(snapshot.typeId===HATCH_ID) {
    if(snapshot.permutation.getState("create:open")===true && (openUntil.get(snapshot)??0)<=system.currentTick)
      snapshot.permutation=snapshot.permutation.withState("create:open",false);
    hatches.set(key({x:snapshot.location.x-session.location.x,y:snapshot.location.y-session.location.y,z:snapshot.location.z-session.location.z}),snapshot);
  }
  if(!hatches.size) return;
  for(const block of session.assembly.blocks) {
    const snapshot=hatches.get(key(block.localLocation));
    if(snapshot) block.visualProperties=hatchVisualProperties(snapshot);
  }
  for(const id of session.assembly.visualEntityIds) {
    try {
      const entity=world.getEntity(id);
      if(entity?.typeId!=="create_physics:hatch" || !entity.isValid) continue;
      const local=session.assembly.getVisualBlock(id)?.localLocation;
      const snapshot=local&&hatches.get(key(local));
      if(!snapshot) continue;
      const value=hatchVisualProperties(snapshot)["create_physics:hatch_open"];
      if(entity.getProperty("create_physics:hatch_open")!==value) entity.setProperty("create_physics:hatch_open",value);
    }catch{}
  }
}

export function depositPhysicsHatch(player,session,snapshot,storages,bulk=false) {
  const inventory=player.getComponent("minecraft:inventory")?.container;
  if(!inventory) return false;
  const targets=physicsHatchInventories(session,snapshot,storages);
  if(!targets.length) return false;
  const slots=bulk?Array.from({length:Math.max(0,Math.min(36,inventory.size)-9)},(_,i)=>i+9):[player.selectedSlotIndex];
  const creative=!bulk && player.getGameMode?.()==="Creative";
  let moved=false;
  for(const slot of slots) {
    if(!Number.isInteger(slot) || slot<0 || slot>=inventory.size) continue;
    const stack=inventory.getItem(slot);
    if(!stack) continue;
    let remainder=stack.clone();
    for(const target of targets) {
      if(!remainder) break;
      remainder=insertHarvestStack(target,remainder);
    }
    if((remainder?.amount??0)===stack.amount) continue;
    if(!creative) inventory.setItem(slot,remainder);
    moved=true;
  }
  return moved;
}

export function queuePhysicsHatchUse(event,player,raycast,storages,sessions,persist,ensureVaults) {
  if(!player?.isValid) return false;
  const target=raycast(player);
  if(target?.snapshot?.typeId!==HATCH_ID) return false;
  event.cancel=true;
  if(event.isFirstEvent===false || system.currentTick-(useTicks.get(player.id)??-100)<5) return true;
  useTicks.set(player.id,system.currentTick);
  const selected=player.selectedSlotIndex,bulk=player.isSneaking;
  system.run(()=>{
    const {session,snapshot}=target;
    if(!player.isValid || !session.assembly?.isValid || !session.snapshots.includes(snapshot) || !bulk && player.selectedSlotIndex!==selected) return;
    try {
      ensureVaults(session);
      if(!depositPhysicsHatch(player,session,snapshot,storages,bulk)) return;
      const deadline=system.currentTick+10;
      openUntil.set(snapshot,deadline);
      snapshot.permutation=snapshot.permutation.withState("create:open",true);
      syncPhysicsHatchVisuals(session);
      const entry=[...sessions].find(([,s])=>s===session);
      if(entry) persist(entry[0],session);
      system.runTimeout(()=>{
        if(openUntil.get(snapshot)!==deadline || !session.assembly?.isValid || !session.snapshots.includes(snapshot)) return;
        snapshot.permutation=snapshot.permutation.withState("create:open",false);
        syncPhysicsHatchVisuals(session);
        if(entry && sessions.get(entry[0])===session) persist(entry[0],session);
      },10);
    }catch(error){console.warn(`[Create Physics] Hatch: ${error?.message??error}`);}
  });
  return true;
}
