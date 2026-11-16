/* CLAUDE-MAP-BEGIN
 FILE: blocks/chest.js  (5 KB, 99 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: @minecraft/server
 IMPORTED BY: blocks/double_chest.js, main.js
 EXPORTS: isPhysicsAnimatedChest, physicsChestVariant, physicsChestInventoryTitle, physicsChestRotation, initializePhysicsChestAnimation
 EVENTS: entityContainerClosed, entityContainerOpened, playerInteractWithEntity
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): initializePhysicsChestAnimation@26(73L); physicsChestInventoryTitle@14(7L); physicsChestRotation@21(5L); isPhysicsAnimatedChest@8(3L); physicsChestVariant@11(3L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { world, system } from "@minecraft/server";
const copperChestVariants = new Map([
  ["minecraft:copper_chest",2], ["minecraft:waxed_copper_chest",2],
  ["minecraft:exposed_copper_chest",3], ["minecraft:waxed_exposed_copper_chest",3],
  ["minecraft:weathered_copper_chest",4], ["minecraft:waxed_weathered_copper_chest",4],
  ["minecraft:oxidized_copper_chest",5], ["minecraft:waxed_oxidized_copper_chest",5]
]);
export function isPhysicsAnimatedChest(type) {
  return type === "minecraft:chest" || type === "minecraft:trapped_chest" || copperChestVariants.has(type);
}
export function physicsChestVariant(type) {
  return copperChestVariants.get(type) ?? (type === "minecraft:trapped_chest" ? 1 : 0);
}
export function physicsChestInventoryTitle(type, double = false) {
  const copper = physicsChestVariant(type) >= 2;
  const marker = "\u00a7r".repeat(copper ? (double ? 5 : 4) : (double ? 3 : 2));
  // Only the invisible routing marker belongs on the actor. The explicitly
  // registered inventory UI supplies its own localized, visible title.
  return marker;
}
export function physicsChestRotation(permutation) {
  const direction=permutation.getState("minecraft:cardinal_direction") ?? permutation.getState("minecraft:facing_direction") ?? permutation.getState("facing_direction") ?? "south";
  const facing=typeof direction==="number" ? ["down","up","north","south","west","east"][direction] : direction;
  return {x:0,y:({north:180,east:90,south:0,west:-90}[facing] ?? 0),z:0};
}
export function initializePhysicsChestAnimation(storages,sessions) {
  // The inventory carrier cannot be destroyed by native entity combat.
  // Mining and block drops belong to the physics system.
  world.beforeEvents.entityHurt?.subscribe(event => {
    if (event.hurtEntity.typeId === "create_physics:physics_chest") event.cancel = true;
  });
  const opened=new Map();
  const nativeEvents=!!world.afterEvents.entityContainerOpened && !!world.afterEvents.entityContainerClosed;
  function update(entity,open) {
    const storage=storages.get(entity.id);
    if(!storage?.assembly?.isValid)return;
    let session;
    for (const candidate of sessions.values()) {
      if (candidate.assembly===storage.assembly) { session=candidate;break; }
    }
    const snapshot=session?.snapshots.find(s=>s.storageEntityId===entity.id && (isPhysicsAnimatedChest(s.typeId) || s.typeId === "minecraft:barrel"));
    if(!snapshot)return;
    const barrel=snapshot.typeId === "minecraft:barrel";
    const visualType=barrel ? "create_physics:barrel" : "create_physics:chest";
    const openProperty=barrel ? "create_physics:barrel_open" : "create_physics:chest_open";
    const local={x:snapshot.location.x-session.location.x,y:snapshot.location.y-session.location.y,z:snapshot.location.z-session.location.z};
    if (storage.chestOpen !== open) {
      const previous=storage.chestOpen ?? false;
      storage.chestOpen=open;
      if (previous !== open) {
        const sound=barrel ? (open ? "block.barrel.open" : "block.barrel.close") : (open ? "random.chestopen" : "random.chestclosed");
        try { entity.dimension.playSound(sound,entity.location,{volume:0.8,pitch:1}); } catch {}
      }
    }
    let matched=false;
    for(const id of storage.assembly.visualEntityIds) {
      try {
        const visual=world.getEntity(id);
        if(visual?.typeId!==visualType)continue;
        const block=storage.assembly.getVisualBlock(id);
        if(block?.localLocation.x!==local.x || block.localLocation.y!==local.y || block.localLocation.z!==local.z)continue;
        matched=true;
        if(visual.getProperty(openProperty)!==open)visual.setProperty(openProperty,open);
      }catch {}
    }
    storage.chestVisualBlocks=storage.assembly.blocks;
    storage.chestVisualBlockCount=storage.assembly.blocks.length;
    storage.chestVisualMissing=!matched;
  }
  function pulse(event) {
    if(event.target?.typeId!=="create_physics:physics_chest" || event.player.isSneaking)return;
    update(event.target,true);
    opened.set(event.target.id,{entity:event.target,until:system.currentTick+50,count:0});
  }
  if(nativeEvents) {
    world.afterEvents.entityContainerOpened.subscribe(event=>{
      if(event.entity.typeId!=="create_physics:physics_chest")return;
      const record=opened.get(event.entity.id) ?? {entity:event.entity,count:0};
      record.count++;record.until=Infinity;opened.set(event.entity.id,record);update(event.entity,true);
    });
    world.afterEvents.entityContainerClosed.subscribe(event=>{
      const record=opened.get(event.entity.id);if(!record)return;
      record.count=Math.max(0,record.count-1);
      if(!record.count){update(event.entity,false);opened.delete(event.entity.id);}
    });
  }else world.afterEvents.playerInteractWithEntity.subscribe(pulse);
  system.runInterval(()=>{
    for(const [id,record] of opened) {
      if(!record.entity.isValid || !storages.has(id)){opened.delete(id);continue;}
      if(system.currentTick>=record.until){update(record.entity,false);opened.delete(id);}
      else {
        const storage=storages.get(id);
        if(storage.chestVisualMissing || storage.chestVisualBlocks!==storage.assembly.blocks ||
           storage.chestVisualBlockCount!==storage.assembly.blocks.length) update(record.entity,true);
      }
    }
  },4);
}
