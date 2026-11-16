/* CLAUDE-MAP-BEGIN
 FILE: blocks/physics_performance.js  (5 KB, 132 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: -
 IMPORTED BY: blocks/portable_engine.js, blocks/rz_air_lever.js, blocks/throttle_lever.js, main.js, physics.js
 EXPORTS: physicsSnapshotsOfType, assemblyVisualEntitiesOfType, setPhysicsVisualProperty, assemblyBlocksByLocation, syncPhysicsAttachmentPose, nearbySupportSnapshots, syncPhysicsAttachmentPosition
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): nearbySupportSnapshots@87(32L); assemblyVisualEntitiesOfType@27(22L); physicsSnapshotsOfType@11(15L); syncPhysicsAttachmentPose@73(13L); setPhysicsVisualProperty@50(12L); syncPhysicsAttachmentPosition@120(12L); assemblyBlocksByLocation@63(9L); key@6(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
const indexes = new WeakMap();
const poses = new WeakMap();
const orientedPoses = new WeakMap();
const assemblyBlockIndexes = new WeakMap();
const CELL = 8;
const key = (x,y,z) => `${x},${y},${z}`;
const visualIndexes = new WeakMap();
const snapshotIndexes = new WeakMap();
const visualPropertyValues = new WeakMap();

export function physicsSnapshotsOfType(session, typeId) {
  const snapshots = session.snapshots;
  let index = snapshotIndexes.get(session);
  if (!index || index.snapshots !== snapshots || index.count !== snapshots.length || index.blocks !== session.assembly?.blocks) {
    const byType = new Map();
    for (const snapshot of snapshots) {
      let group = byType.get(snapshot.typeId);
      if (!group) byType.set(snapshot.typeId,group=[]);
      group.push(snapshot);
    }
    index = {snapshots,count:snapshots.length,blocks:session.assembly?.blocks,byType};
    snapshotIndexes.set(session,index);
  }
  return index.byType.get(typeId) ?? [];
}

export function assemblyVisualEntitiesOfType(assembly, typeId, world, tick) {
  const count = assembly.visualEntityCount;
  let index = visualIndexes.get(assembly);
  const matches = index?.byType.get(typeId);
  if (!index || index.world !== world || index.count !== count || index.blocks !== assembly.blocks ||
      index.blockCount !== assembly.blocks.length || tick-index.tick >= 5 || tick < index.tick ||
      matches?.some(entity => !entity.isValid)) {
    const byType = new Map();
    for (const id of assembly.visualEntityIds) {
      try {
        const entity = world.getEntity(id);
        if (!entity?.isValid) continue;
        let group = byType.get(entity.typeId);
        if (!group) byType.set(entity.typeId,group=[]);
        group.push(entity);
      } catch { /* Retry unloaded visuals on the next index refresh. */ }
    }
    index = {world,count,blocks:assembly.blocks,blockCount:assembly.blocks.length,tick,byType};
    visualIndexes.set(assembly,index);
  }
  return index.byType.get(typeId) ?? [];
}

export function setPhysicsVisualProperty(entity, name, value, tick) {
  let values = visualPropertyValues.get(entity);
  if (!values) visualPropertyValues.set(entity,values=new Map());
  const previous = values.get(name);
  if (previous?.value === value) {
    if (tick-previous.audit < 20 && tick >= previous.audit) return false;
    if (entity.getProperty(name) === value) { previous.audit=tick; return false; }
  }
  entity.setProperty(name,value);
  values.set(name,{value,audit:tick});
  return true;
}

export function assemblyBlocksByLocation(assembly) {
  const blocks=assembly.blocks;
  let index=assemblyBlockIndexes.get(assembly);
  if(!index || index.blocks!==blocks || index.count!==blocks.length) {
    index={blocks,count:blocks.length,map:new Map(blocks.map(block=>[key(block.localLocation.x,block.localLocation.y,block.localLocation.z),block]))};
    assemblyBlockIndexes.set(assembly,index);
  }
  return index.map;
}

export function syncPhysicsAttachmentPose(entity,point,rotation,tick,dimension) {
  const previous=orientedPoses.get(entity);
  const same=p=>Math.abs(p.x-point.x)<0.000001 && Math.abs(p.y-point.y)<0.000001 && Math.abs(p.z-point.z)<0.000001;
  const sameRotation=r=>Math.abs(r.x-rotation.x)<0.000001 && Math.abs(((r.y-rotation.y+540)%360+360)%360-180)<0.000001;
  if(previous && previous.dimension===dimension && same(previous.point) && sameRotation(previous.rotation)) {
    if(tick-previous.audit<20) return false;
    previous.audit=tick;
    if(same(entity.location) && sameRotation(entity.getRotation())) return false;
  }
  entity.teleport(point,{checkForBlocks:false,dimension,keepVelocity:false,rotation});
  orientedPoses.set(entity,{point:{...point},rotation:{...rotation},dimension,audit:tick});
  return true;
}

export function nearbySupportSnapshots(session, players) {
  // Articulated blocks can move independently of the assembly's source grid.
  if (session.assembly.articulatedBlockTransforms?.size) return session.snapshots;
  const origin = session.location, snapshots = session.snapshots;
  let index = indexes.get(session);
  if (!index || index.snapshots !== snapshots || index.count !== snapshots.length ||
      index.x !== origin.x || index.y !== origin.y || index.z !== origin.z) {
    index = { snapshots, count:snapshots.length, x:origin.x, y:origin.y, z:origin.z, cells:new Map() };
    for (const snapshot of snapshots) {
      const p=snapshot.location;
      const cell=key(Math.floor((p.x-origin.x)/CELL),Math.floor((p.y-origin.y)/CELL),Math.floor((p.z-origin.z)/CELL));
      let list=index.cells.get(cell);
      if (!list) index.cells.set(cell,list=[]);
      list.push(snapshot);
    }
    indexes.set(session,index);
  }
  const candidates = new Set();
  for (const player of players) {
    const p=session.assembly.body.worldPointToLocal(player);
    // Existing supports use an 18-block release radius; allow two more blocks
    // for offsets, partial blocks and support strips before the exact check.
    for (let x=Math.floor((p.x-20)/CELL);x<=Math.floor((p.x+20)/CELL);x++) {
      for (let y=Math.floor((p.y-20)/CELL);y<=Math.floor((p.y+20)/CELL);y++) {
        for (let z=Math.floor((p.z-20)/CELL);z<=Math.floor((p.z+20)/CELL);z++) {
          for (const snapshot of index.cells.get(key(x,y,z)) ?? []) candidates.add(snapshot);
        }
      }
    }
  }
  return candidates;
}

export function syncPhysicsAttachmentPosition(entity, point, tick) {
  const previous=poses.get(entity);
  const same = p => Math.abs(p.x-point.x)<0.000001 && Math.abs(p.y-point.y)<0.000001 && Math.abs(p.z-point.z)<0.000001;
  if (previous && same(previous.point)) {
    if (tick-previous.audit<20) return false;
    previous.audit=tick;
    if (same(entity.location)) return false;
  }
  entity.teleport(point);
  poses.set(entity,{point:{...point},audit:tick});
  return true;
}
