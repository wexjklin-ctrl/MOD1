/* CLAUDE-MAP-BEGIN
 FILE: blocks/deployer.js  (12 KB, 212 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: Deployer block automation.
 IMPORTS: @minecraft/server, blocks/deployer_tools.js, blocks/mechanical_drill.js, blocks/mechanical_harvester.js
 IMPORTED BY: main.js
 EXPORTS: deployerTarget, isDeployerTool, deployerHand, ensurePhysicsDeployerHands, queuePhysicsDeployerUse, takeDeployerBlock, deployerHoeGround, tickPhysicsDeployers
 DYN-PROPS: create_physics:deployer_filter, create_physics:held_type
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): tickPhysicsDeployers@122(90L); queuePhysicsDeployerUse@61(26L); takeDeployerBlock@87(23L); deployerTarget@8(21L); deployerHand@40(18L); deployerHoeGround@110(12L); structureDeployers@29(8L); isDeployerTool@37(3L); ensurePhysicsDeployerHands@58(3L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { usePhysicsDeployerTool } from "./deployer_tools.js";
import { world, system, BlockPermutation } from "@minecraft/server";
import { drillFacing } from "./mechanical_drill.js";
import { structureInventories } from "./mechanical_harvester.js";
const uses=new Map();
const toolMotion=new WeakMap(), actionTicks=new WeakMap();
const deployerLists=new WeakMap();
export function deployerTarget(session,snapshot) {
  const local={x:snapshot.location.x-session.location.x,y:snapshot.location.y-session.location.y,z:snapshot.location.z-session.location.z};
  const assembly=session.assembly;
  const block=assembly.blocks?.find(b=>b.localLocation.x===local.x && b.localLocation.y===local.y && b.localLocation.z===local.z);
  const articulation=assembly.articulatedBlockTransforms?.get(`${local.x},${local.y},${local.z}`);
  const rotations={north:{x:0,y:0,z:0},east:{x:0,y:-90,z:0},south:{x:0,y:180,z:0},west:{x:0,y:90,z:0},up:{x:90,y:0,z:0},down:{x:-90,y:0,z:0}};
  const base=block?.rotation ?? rotations[drillFacing(snapshot.permutation)] ?? rotations.south;
  const rotation=articulation?.rotation ?? {...base,y:base.y+(articulation?.yaw ?? 0)};
  // Match the rendered hand, whose native model extends along -Z (world +Z).
  // Rotate the origin and direction together; looking up an articulated target
  // cell could accidentally use the transform of a different structure block.
  const rx=rotation.x*Math.PI/180,ry=rotation.y*Math.PI/180,rz=rotation.z*Math.PI/180;
  // Native hand pitch is opposite the placement vector's vertical pitch.
  // Correct it before applying roll/yaw so horizontal facings stay unchanged.
  const x=-Math.sin(rx)*Math.sin(rz),y=-Math.sin(rx)*Math.cos(rz),z=Math.cos(rx);
  const front={x:x*Math.cos(ry)+z*Math.sin(ry),y,z:-x*Math.sin(ry)+z*Math.cos(ry)};
  const origin=assembly.getArticulatedLocalLocation(local);
  const at=distance=>assembly.body.localPointToWorld({x:origin.x+front.x*distance,y:origin.y+front.y*distance,z:origin.z+front.z*distance});
  const point=at(2);
  return {local,point,position:{x:Math.floor(point.x),y:Math.floor(point.y),z:Math.floor(point.z)},at};
}
function structureDeployers(session) {
  let entry=deployerLists.get(session);
  if (!entry || entry.source!==session.snapshots || entry.count!==session.snapshots.length) {
    entry={source:session.snapshots,count:session.snapshots.length,list:session.snapshots.filter(s=>s.typeId==="create:deployer")};
    deployerLists.set(session,entry);
  }
  return entry.list;
}
export function isDeployerTool(item) {
  return !!item && /(?:_(?:pickaxe|axe|shovel|hoe|sword)|:(?:bow|crossbow|shears|flint_and_steel|trident|fishing_rod|mace))$/.test(item.typeId);
}
export function deployerHand(session,snapshot,storages) {
  let entity;
  try {entity=world.getEntity(snapshot.storageEntityId);} catch {}
  const local={x:snapshot.location.x-session.location.x,y:snapshot.location.y-session.location.y,z:snapshot.location.z-session.location.z};
  if (!entity?.isValid) {
    entity=session.dimension.spawnEntity("create_physics:storage_container",session.assembly.body.localPointToWorld(local));
    entity.addTag("create_physics_deployer_hand");
    snapshot.storageEntityId=entity.id;
    // Transfer the original Create hand before its block entity despawns.
    const old=session.dimension.getEntities({type:"create:deployer_entity",location:{x:snapshot.location.x+0.5,y:snapshot.location.y+0.5,z:snapshot.location.z+0.5},maxDistance:0.45}).find(e=>e.getComponent("minecraft:inventory")?.container?.getItem(0));
    const source=old?.getComponent("minecraft:inventory")?.container;
    const item=source?.getItem(0);
    if (item) {entity.getComponent("minecraft:inventory").container.setItem(0,item);source.setItem(0,undefined);}
  }
  entity.addTag("create_physics_deployer_hand");
  storages.set(entity.id,{assembly:session.assembly,entity,localLocation:local});
  return entity;
}
export function ensurePhysicsDeployerHands(session,storages) {
  for (const snapshot of structureDeployers(session)) deployerHand(session,snapshot,storages);
}
export function queuePhysicsDeployerUse(event,player,raycast,storages,sessions,persist) {
  if (!player?.isValid) return false;
  const hit=raycast(player);
  if (hit?.snapshot?.typeId!=="create:deployer") return false;
  const item=event.itemStack ?? player.getComponent("minecraft:equippable")?.getEquipment("Mainhand");
  if (item?.typeId==="create:wrench") return false;
  if (item && !isDeployerTool(item)) {try {BlockPermutation.resolve(item.typeId);} catch {return false;}}
  event.cancel=true;
  if (event.isFirstEvent===false || system.currentTick-(uses.get(player.id) ?? -100)<5) return true;
  uses.set(player.id,system.currentTick);
  system.run(()=>{
    if (!player.isValid || !hit.session.assembly?.isValid || !hit.session.snapshots.includes(hit.snapshot)) return;
    try {
      const hand=deployerHand(hit.session,hit.snapshot,storages), container=hand.getComponent("minecraft:inventory").container;
      const equipment=player.getComponent("minecraft:equippable"), current=equipment.getEquipment("Mainhand"), previous=container.getItem(0);
      if (current && !isDeployerTool(current)) {try {BlockPermutation.resolve(current.typeId);} catch {return;}}
      // Swap whole stacks, keeping both inventories intact.
      container.setItem(0,current);
      try {equipment.setEquipment("Mainhand",previous);} catch(error) {container.setItem(0,previous);throw error;}
      hand.setDynamicProperty("create_physics:deployer_filter",current?.typeId);
      for (const [key,session] of sessions) if (session===hit.session) {persist(key,session);break;}
      player.onScreenDisplay.setActionBar(current ? (isDeployerTool(current) ? "Deployer: tool loaded" : "Deployer: block loaded") : "Deployer: hand emptied");
    } catch(error) {console.warn(`[Create Physics] Deployer: ${error}`);}
  });
  return true;
}
export function takeDeployerBlock(hand,containers) {
  const held=hand.getComponent("minecraft:inventory").container;
  let item=held.getItem(0);
  if (isDeployerTool(item)) return item;
  if (item) {try {BlockPermutation.resolve(item.typeId);} catch {return;}}
  const filter=item?.typeId ?? hand.getDynamicProperty("create_physics:deployer_filter");
  if (!item) {
    for (const container of containers) {
      for (let slot=0;slot<container.size;slot++) {
        const candidate=container.getItem(slot);
        if (!candidate || (filter && candidate.typeId!==filter)) continue;
        if (!isDeployerTool(candidate)) {try {BlockPermutation.resolve(candidate.typeId);} catch {continue;}}
        if (isDeployerTool(candidate) && !filter) continue;
        held.setItem(0,candidate);
        try {container.setItem(slot,undefined);} catch(error) {held.setItem(0,undefined);throw error;}
        item=candidate;break;
      }
      if (item) break;
    }
  }
  if (item) hand.setDynamicProperty("create_physics:deployer_filter",item.typeId);
  return item;
}
export function deployerHoeGround(session,local,point) {
  const origin=session.assembly.body.localPointToWorld(session.assembly.getArticulatedLocalLocation(local));
  const x=Math.floor(point.x), z=Math.floor(point.z);
  const top=Math.floor(origin.y-0.25), bottom=Math.floor(origin.y-2.75);
  for(let y=top;y>=bottom;y--) {
    let block;try {block=session.dimension.getBlock({x,y,z});}catch{return;}
    if(!block)return;
    if(block.isAir || block.typeId==="create_physics:lamp_light")continue;
    // Work only the exposed ground; do not dig through stone, water or farmland.
    return ["minecraft:dirt","minecraft:grass_block","minecraft:coarse_dirt","minecraft:podzol","minecraft:mycelium","minecraft:grass_path","minecraft:dirt_path"].includes(block.typeId) ? block : undefined;
  }
}
export function tickPhysicsDeployers(sessions,storages,ensureVaults,refreshTerrain,persist) {
  let budget=16;
  for (const [key,session] of sessions) {
    if (!session.assembly?.isValid || session.streamingMotion) continue;
    const deployers=structureDeployers(session);
    if (!deployers.length) continue;
    ensureVaults(session);
    ensurePhysicsDeployerHands(session,storages);
    const containers=structureInventories(session,storages), changed=[];
    let occupied, visuals;
    const positionKey=p=>`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
    function occupies(position) {
      if (!occupied) {
        occupied=new Set();
        for (const s of session.snapshots) {
          const p=session.assembly.body.localPointToWorld(session.assembly.getArticulatedLocalLocation({x:s.location.x-session.location.x,y:s.location.y-session.location.y,z:s.location.z-session.location.z}));
          occupied.add(positionKey(p));
        }
      }
      return occupied.has(positionKey(position));
    }
    function visualAt(local) {
      if (!visuals) {
        visuals=new Map();
        for (const id of session.assembly.visualEntityIds) {
          const visual=world.getEntity(id);
          if (visual?.typeId!=="create_physics:deployer") continue;
          const v=session.assembly.getVisualBlock(id)?.localLocation;
          if (v) visuals.set(`${v.x},${v.y},${v.z}`,visual);
        }
      }
      return visuals.get(`${local.x},${local.y},${local.z}`);
    }
    for (const snapshot of deployers) {
      if (budget<=0) break;
      try {
        const hand=world.getEntity(snapshot.storageEntityId), item=takeDeployerBlock(hand,containers);
        const {local,point,position,at}=deployerTarget(session,snapshot);
        const block=session.dimension.getBlock(position);
        const tool=isDeployerTool(item);
        let clear=!tool && block?.isAir && !occupies(position);
        if (clear) {
          const targetKey=positionKey(position),sourceKey=positionKey(at(0));
          for (const distance of [0.55,0.8,1.05,1.3,1.55,1.8]) {
            const p=at(distance),key=positionKey(p);
            if (key===sourceKey || key===targetKey) continue;
            const crossed=session.dimension.getBlock({x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z)});
            if (!crossed?.isAir || occupies(p)) {clear=false;break;}
          }
        }
        const previous=toolMotion.get(snapshot);
        toolMotion.set(snapshot,{...point});
        const velocity=session.assembly.body.velocity;
        const moving=(previous && Math.hypot(point.x-previous.x,point.y-previous.y,point.z-previous.z)>0.015) || (velocity && Math.hypot(velocity.x,velocity.y,velocity.z)>0.03);
        const working=!!item && (tool ? !!moving : !!clear);
        const matchedVisual=visualAt(local);
        if (matchedVisual) {
          const visual=matchedVisual;
          if (visual.getProperty("create_physics:tool_mode")!==tool) visual.setProperty("create_physics:tool_mode",tool);
          if (visual.getProperty("create_physics:deploying")!==working) visual.setProperty("create_physics:deploying",working);
          const type=item?.typeId ?? "minecraft:air";
          if (visual.getDynamicProperty("create_physics:held_type")!==type) {
            visual.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 ${type} 1`);
            visual.setDynamicProperty("create_physics:held_type",type);
          }
        }
        if (!working || system.currentTick-(actionTicks.get(snapshot) ?? -100)<(tool ? 8 : 20)) continue;
        if (tool) {
          const target=item.typeId.endsWith("_hoe") ? deployerHoeGround(session,local,point) : block;
          if (usePhysicsDeployerTool(hand,item,target,point,containers)) {
            actionTicks.set(snapshot,system.currentTick); changed.push(target?.location ?? position); budget--;
          }
          continue;
        }
        const permutation=BlockPermutation.resolve(item.typeId);
        const inventory=hand.getComponent("minecraft:inventory").container;
        const remainder=item.clone();
        if (item.amount>1) remainder.amount=item.amount-1;
        inventory.setItem(0,item.amount>1 ? remainder : undefined);
        try {block.setPermutation(permutation);} catch(error) {inventory.setItem(0,item);throw error;}
        actionTicks.set(snapshot,system.currentTick);
        changed.push(position);budget--;
        try {session.dimension.playSound("dig.stone",point,{volume:0.3});} catch {}
      } catch(error) {console.warn(`[Create Physics] Deployer: ${error}`);}
    }
    if (changed.length) refreshTerrain(session,changed);
    // Persist newly created hand anchors, including deployers added while assembled.
    if (deployers.some(s=>!s.deployerHandSaved)) {persist(key,session);for(const s of deployers)s.deployerHandSaved=true;}
  }
}
