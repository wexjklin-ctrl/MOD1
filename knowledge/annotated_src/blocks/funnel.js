/* CLAUDE-MAP-BEGIN
 FILE: blocks/funnel.js  (5 KB, 112 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: @minecraft/server, blocks/mechanical_harvester.js
 IMPORTED BY: main.js
 EXPORTS: isPhysicsFunnel, syncPhysicsFunnelVisuals, queuePhysicsFunnelUse, tickPhysicsFunnels
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): syncPhysicsFunnelVisuals@7(22L); tickPhysicsFunnels@91(22L); queuePhysicsFunnelUse@29(21L); outputItem@73(18L); inputItems@58(15L); funnelMouth@50(8L); isPhysicsFunnel@6(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { world, system } from "@minecraft/server";
import { structureInventories, insertHarvestStack } from "./mechanical_harvester.js";
const types = new Set(["create:andesite_funnel","create:brass_funnel"]);
const useTicks = new Map();
const sessionCache = new WeakMap();
export function isPhysicsFunnel(typeId) { return types.has(typeId); }
export function syncPhysicsFunnelVisuals(session) {
  const snapshots=session.snapshots.filter(s=>types.has(s.typeId));
  if (!snapshots.length) return;
  const anchor=session.assembly.visualAnchor ?? {x:0,y:0,z:0};
  for (const id of session.assembly.visualEntityIds) {
    try {
      const entity=world.getEntity(id);
      if (!entity?.isValid || !["create_physics:andesite_funnel","create_physics:brass_funnel"].includes(entity.typeId)) continue;
      const local=session.assembly.getVisualBlock(id)?.localLocation ?? {
        x:Math.round(Number(entity.getProperty("create_physics:local_x"))+anchor.x),
        y:Math.round(Number(entity.getProperty("create_physics:local_y"))+anchor.y),
        z:Math.round(Number(entity.getProperty("create_physics:local_z"))+anchor.z)
      };
      const snapshot=snapshots.find(s=>s.location.x-session.location.x===local.x && s.location.y-session.location.y===local.y && s.location.z-session.location.z===local.z);
      if (!snapshot) continue;
      for (const [state,property] of [["create:input","create_physics:funnel_input"],["create:parallel","create_physics:funnel_parallel"],["create:on","create_physics:funnel_on"]]) {
        const value=snapshot.permutation.getState(state) === true;
        if (entity.getProperty(property) !== value) entity.setProperty(property,value);
      }
    } catch {}
  }
}
export function queuePhysicsFunnelUse(event,player,raycast,sessions,persist) {
  if (!player?.isValid || event.itemStack?.typeId !== "create:wrench") return false;
  const target=raycast(player);
  if (!target || !types.has(target.snapshot?.typeId)) return false;
  event.cancel=true;
  if (event.isFirstEvent === false || system.currentTick-(useTicks.get(player.id) ?? -100)<5) return true;
  useTicks.set(player.id,system.currentTick);
  system.run(()=>{
    const {session,snapshot}=target;
    if (!session.assembly?.isValid || !session.snapshots.includes(snapshot)) return;
    try {
      const input=snapshot.permutation.getState("create:input") !== true;
      snapshot.permutation=snapshot.permutation.withState("create:input",input);
      syncPhysicsFunnelVisuals(session);
      const entry=[...sessions].find(([,candidate])=>candidate===session);
      if (entry) persist(entry[0],session);
      if (player.isValid) player.onScreenDisplay.setActionBar(input ? "Funnel: input" : "Funnel: output");
    } catch(error) {console.warn(`[Create Physics] Funnel: ${error}`);}
  });
  return true;
}
function funnelMouth(session,snapshot) {
  const front={north:{x:0,z:-1},east:{x:1,z:0},south:{x:0,z:1},west:{x:-1,z:0}}[snapshot.permutation.getState("minecraft:cardinal_direction")] ?? {x:0,z:1};
  return session.assembly.body.localPointToWorld(session.assembly.getArticulatedLocalLocation({
    x:snapshot.location.x-session.location.x+front.x*0.45,
    y:snapshot.location.y-session.location.y-0.1,
    z:snapshot.location.z-session.location.z+front.z*0.45
  }));
}
function inputItems(session,mouth,containers) {
  for (const entity of session.dimension.getEntities({type:"minecraft:item",location:mouth,maxDistance:0.7}).slice(0,4)) {
    if (!entity.isValid) continue;
    const stack=entity.getComponent("minecraft:item")?.itemStack;
    if (!stack) continue;
    const location={...entity.location};
    try {entity.remove();} catch {continue;}
    let remainder=stack;
    for (const container of containers) {
      if (!remainder) break;
      try {remainder=insertHarvestStack(container,remainder);} catch {}
    }
    if (remainder) session.dimension.spawnItem(remainder,location);
  }
}
function outputItem(session,mouth,containers) {
  // Wait for the previous item to leave the mouth rather than flooding the ground.
  if (session.dimension.getEntities({type:"minecraft:item",location:mouth,maxDistance:0.7}).length) return;
  for (const container of containers) {
    for (let slot=0;slot<container.size;slot++) {
      let original;
      try {
        original=container.getItem(slot);
        if (!original) continue;
        const output=original.clone(); output.amount=1;
        const remaining=original.clone(); remaining.amount=Math.max(1,original.amount-1);
        container.setItem(slot,original.amount>1 ? remaining : undefined);
        try {session.dimension.spawnItem(output,mouth);} catch(error) {container.setItem(slot,original);throw error;}
        return;
      } catch {}
    }
  }
}
export function tickPhysicsFunnels(sessions,storages,ensureVaultInventories) {
  for (const session of sessions.values()) {
    if (!session.assembly?.isValid || session.streamingMotion) continue;
    let entry=sessionCache.get(session);
    if (!entry || entry.snapshots !== session.snapshots || entry.count !== session.snapshots.length) {
      entry={snapshots:session.snapshots,count:session.snapshots.length,funnels:session.snapshots.filter(s=>types.has(s.typeId))};
      sessionCache.set(session,entry);
    }
    if (!entry.funnels.length) continue;
    syncPhysicsFunnelVisuals(session);
    ensureVaultInventories?.(session);
    const containers=structureInventories(session,storages);
    if (!containers.length) continue;
    for (const snapshot of entry.funnels) {
      try {
        const mouth=funnelMouth(session,snapshot);
        if (snapshot.permutation.getState("create:input") === true) inputItems(session,mouth,containers);
        else outputItem(session,mouth,containers);
      } catch {}
    }
  }
}