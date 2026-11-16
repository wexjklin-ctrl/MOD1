/* CLAUDE-MAP-BEGIN
 FILE: blocks/double_chest.js  (7 KB, 144 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: @minecraft/server, blocks/chest.js
 IMPORTED BY: blocks/hatch.js, main.js
 EXPORTS: physicsChestPartner, syncPhysicsChestHitbox, configurePhysicsChests, detachPhysicsChest
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): configurePhysicsChests@34(85L); detachPhysicsChest@121(23L); physicsChestPartner@4(15L); syncPhysicsChestHitbox@20(12L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { world } from "@minecraft/server";
import { isPhysicsAnimatedChest, physicsChestRotation, physicsChestVariant, physicsChestInventoryTitle } from "./chest.js";

export function physicsChestPartner(snapshot, snapshots) {
  if (!isPhysicsAnimatedChest(snapshot.typeId)) return;
  const yaw = physicsChestRotation(snapshot.permutation).y;
  const axis = Math.abs(yaw) === 90 ? "z" : "x";
  const other = axis === "x" ? "z" : "x";
  const line = snapshots.filter(s => s.typeId === snapshot.typeId &&
    physicsChestRotation(s.permutation).y === yaw &&
    s.location.y === snapshot.location.y && s.location[other] === snapshot.location[other])
    .sort((a,b) => a.location[axis]-b.location[axis]);
  const index = line.indexOf(snapshot);
  let start = index;
  while (start > 0 && line[start].location[axis]-line[start-1].location[axis] === 1) start--;
  const partner = line[index + ((index-start)%2 ? -1 : 1)];
  return partner && Math.abs(partner.location[axis]-snapshot.location[axis]) === 1 ? partner : undefined;
}

export function syncPhysicsChestHitbox(storage, point) {
  let shape="single";
  if (storage.chestPairAxis) {
    const local=storage.localLocation,axis=storage.chestPairAxis;
    const end=storage.assembly.body.localPointToWorld({x:local.x+axis.x,y:local.y,z:local.z+axis.z});
    shape=Math.abs(end.x-point.x)>=Math.abs(end.z-point.z) ? "double_x" : "double_z";
  }
  if(storage.chestHitboxShape!==shape) {
    storage.entity.triggerEvent(`create_physics:${shape}_hitbox`);
    storage.chestHitboxShape=shape;
  }
}

// One inventory owns both halves; the partner has no separate inventory to duplicate items.
export function configurePhysicsChests(session, storages) {
  const used = new Set();
  const models = new Map();
  const variants = new Map(session.snapshots.filter(s=>isPhysicsAnimatedChest(s.typeId)).map(s=>[`${s.location.x},${s.location.y},${s.location.z}`,physicsChestVariant(s.typeId)]));
  for (const snapshot of session.snapshots) {
    if (!isPhysicsAnimatedChest(snapshot.typeId) || used.has(snapshot)) continue;
    used.add(snapshot);
    let owner = snapshot;
    let partner = physicsChestPartner(snapshot, session.snapshots);
    if (used.has(partner)) partner = undefined;
    if (partner) {
      const a = storages.get(owner.storageEntityId)?.entity?.getComponent("minecraft:inventory")?.container;
      const b = storages.get(partner.storageEntityId)?.entity?.getComponent("minecraft:inventory")?.container;
      if (b && (!a || b.size > a.size)) [owner, partner] = [partner, owner];
      used.add(owner);
      used.add(partner);
    }
    const record = storages.get(owner.storageEntityId);
    if (!record?.entity?.isValid) continue;
    // Keep the inventory title for UI routing, but never draw it above the carrier.
    if (!record.entity.getEffect("invisibility")) {
      record.entity.addEffect("invisibility",20000000,{showParticles:false});
    }
    if (partner) {
      const extra = storages.get(partner.storageEntityId);
      let target = record.entity.getComponent("minecraft:inventory").container;
      const source = extra?.entity?.getComponent("minecraft:inventory")?.container;
      const first = Array.from({length: target.size}, (_, i) => target.getItem(i));
      const second = source ? Array.from({length: source.size}, (_, i) => source.getItem(i)) : [];
      // Do not discard items if old independently populated inventories exceed 54 slots.
      const free = 54 - first.filter(Boolean).length;
      if (second.filter(Boolean).length > free) partner = undefined;
      else {
        if (target.size < 54) {
          record.entity.triggerEvent("create_physics:double_inventory");
          target = record.entity.getComponent("minecraft:inventory").container;
          if (target.size < 54) continue;
          for (let i = 0; i < first.length; i++) target.setItem(i, first[i]);
        }
        for (const item of second) {
          if (!item) continue;
          for (let i = 0; i < target.size; i++) {
            if (!target.getItem(i)) { target.setItem(i, item); break; }
          }
        }
        if (extra && extra !== record) {
          source.clearAll();
          storages.delete(extra.entity.id);
          extra.entity.remove();
          partner.storageEntityId = undefined;
        }
      }
    }
    const local = {x:owner.location.x-session.location.x,y:owner.location.y-session.location.y,z:owner.location.z-session.location.z};
    record.localLocation = {...local};
    record.chestPairAxis=undefined;
    let model = 0;
    if (partner) {
      const dx = partner.location.x-owner.location.x, dz = partner.location.z-owner.location.z;
      const yaw = physicsChestRotation(owner.permutation).y * Math.PI/180;
      model = dx*Math.cos(yaw)-dz*Math.sin(yaw) > 0 ? 1 : 2;
      record.localLocation.x += dx/2;
      record.localLocation.z += dz/2;
      record.chestPairAxis={x:dx,z:dz};
      models.set(`${partner.location.x},${partner.location.y},${partner.location.z}`,3);
    }
    syncPhysicsChestHitbox(record,session.assembly.body.localPointToWorld(record.localLocation));
    // Invisible formatting selects the inventory UI without drawing a world-space name.
    // The entity's native opening path otherwise always selects the small screen.
    const title = physicsChestInventoryTitle(owner.typeId, !!partner);
    if (record.entity.nameTag !== title) record.entity.nameTag = title;
    models.set(`${owner.location.x},${owner.location.y},${owner.location.z}`,model);
  }
  for (const id of session.assembly.visualEntityIds) {
    const visual = world.getEntity(id);
    if (visual?.typeId !== "create_physics:chest") continue;
    const local = session.assembly.getVisualBlock(id)?.localLocation;
    if (!local) continue;
    const key = `${local.x+session.location.x},${local.y+session.location.y},${local.z+session.location.z}`;
    const model = models.get(key) ?? 0;
    const variant = variants.get(key) ?? 0;
    if (visual.getProperty("create_physics:chest_variant") !== variant) visual.setProperty("create_physics:chest_variant",variant);
    if (visual.getProperty("create_physics:chest_model") !== model) visual.setProperty("create_physics:chest_model",model);
  }
}

// Split before mining either half, keeping one 27-slot inventory on each block.
export function detachPhysicsChest(snapshot, session, storages) {
  const partner = physicsChestPartner(snapshot, session.snapshots);
  if (!partner) return;
  const owner = snapshot.storageEntityId ? snapshot : partner;
  const record = storages.get(owner.storageEntityId);
  const source = record?.entity?.getComponent("minecraft:inventory")?.container;
  if (!source || source.size !== 54) return;
  const other = owner === snapshot ? partner : snapshot;
  if (other.storageEntityId) return;
  const items = Array.from({length:54},(_,i)=>source.getItem(i));
  const local = {x:other.location.x-session.location.x,y:other.location.y-session.location.y,z:other.location.z-session.location.z};
  const point = session.assembly.body.localPointToWorld(local);
  const entity = session.dimension.spawnEntity("create_physics:physics_chest",{...point,y:point.y-0.5});
  const target = entity.getComponent("minecraft:inventory").container;
  for (let i=0;i<27;i++) target.setItem(i,items[i+27]);
  record.entity.triggerEvent("create_physics:single_inventory");
  const retained = record.entity.getComponent("minecraft:inventory").container;
  for (let i=0;i<27;i++) retained.setItem(i,items[i]);
  other.storageEntityId=entity.id;
  entity.nameTag=physicsChestInventoryTitle(other.typeId);
  record.entity.nameTag=physicsChestInventoryTitle(owner.typeId);
  storages.set(entity.id,{assembly:session.assembly,entity,localLocation:local});
}
