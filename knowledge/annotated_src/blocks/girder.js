/* CLAUDE-MAP-BEGIN
 FILE: blocks/girder.js  (3 KB, 79 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: -
 IMPORTED BY: main.js
 EXPORTS: GIRDER_ID, updateGirderConnections, girderProperties, girderRotation, girderCollision, syncPhysicsGirders
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): syncPhysicsGirders@47(32L); updateGirderConnections@4(22L); girderCollision@38(7L); girderProperties@27(6L); girderRotation@34(3L); key@2(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
export const GIRDER_ID = "create:metal_girder";
const key = p => `${p.x},${p.y},${p.z}`;

export function updateGirderConnections(snapshots) {
  const girders = snapshots.filter(s => s.typeId === GIRDER_ID);
  const byPosition = new Map(girders.map(s => [key(s.location), s]));
  const neighbor = (s, x, y, z) => byPosition.get(key({x:s.location.x+x,y:s.location.y+y,z:s.location.z+z}));
  // Resolve all columns first so the beam below sees the final state above it.
  const states = girders.map(s => {
    const hasX = !!(neighbor(s,-1,0,0) || neighbor(s,1,0,0));
    const hasZ = !!(neighbor(s,0,0,-1) || neighbor(s,0,0,1));
    const facing = s.permutation.getState("minecraft:cardinal_direction");
    return {s,pole:!hasX && !hasZ,useX:((facing === "north" || facing === "south") && hasX) || !hasZ};
  });
  for (const {s,pole,useX} of states) {
    s.permutation = s.permutation.withState("create:is_pole",pole);
    if (!pole) s.permutation = s.permutation.withState("minecraft:cardinal_direction",useX ? "north" : "west");
  }
  for (const {s,pole,useX} of states) {
    const above = neighbor(s,0,1,0);
    const connected = !pole && above?.permutation.getState("create:is_pole") !== true &&
      !!(useX ? neighbor(s,-1,0,0) && neighbor(s,1,0,0) : neighbor(s,0,0,-1) && neighbor(s,0,0,1));
    s.permutation = s.permutation.withState("create:connected",connected);
  }
}

export function girderProperties(snapshot) {
  return {
    "create_physics:girder_pole":snapshot.permutation.getState("create:is_pole") === true,
    "create_physics:girder_connected":snapshot.permutation.getState("create:connected") === true
  };
}

export function girderRotation(snapshot) {
  return {x:0,y:({north:0,south:180,west:90,east:270}[snapshot.permutation.getState("minecraft:cardinal_direction")] ?? 0),z:0};
}

export function girderCollision(snapshot) {
  const properties = girderProperties(snapshot);
  if (properties["create_physics:girder_pole"]) return [{min:{x:.25,y:0,z:.25},max:{x:.75,y:1,z:.75}}];
  return properties["create_physics:girder_connected"]
    ? [{min:{x:0,y:2/16,z:4/16},max:{x:1,y:14/16,z:12/16}}]
    : [{min:{x:0,y:0,z:3/16},max:{x:1,y:1,z:13/16}}];
}

const previousStates = new WeakMap();
export function syncPhysicsGirders(session, world) {
  if (!session.assembly?.isValid) return;
  updateGirderConnections(session.snapshots);
  const byLocal = new Map(), updates = [];
  for (const s of session.snapshots) {
    if (s.typeId !== GIRDER_ID) continue;
    const localLocation = {x:s.location.x-session.location.x,y:s.location.y-session.location.y,z:s.location.z-session.location.z};
    byLocal.set(key(localLocation),s);
    const signature = JSON.stringify(s.permutation.getAllStates());
    const previous = previousStates.get(s);
    if (previous?.assembly !== session.assembly || previous.signature !== signature) {
      const block = session.assembly.blocks.find(b => key(b.localLocation) === key(localLocation));
      if (block) {
        block.rotation = girderRotation(s);
        block.visualProperties = girderProperties(s);
        updates.push({localLocation,collisionShape:girderCollision(s)});
      }
      previousStates.set(s,{assembly:session.assembly,signature});
    }
  }
  if (!byLocal.size) return;
  if (updates.length) session.assembly.setBlockCollisionShapes(updates);
  for (const id of session.assembly.visualEntityIds) {
    const entity = world.getEntity(id);
    if (!entity?.isValid || entity.typeId !== "create_physics:girder") continue;
    const block = session.assembly.getVisualBlock(id);
    const snapshot = block && byLocal.get(key(block.localLocation));
    if (!snapshot) continue;
    for (const [name,value] of Object.entries(girderProperties(snapshot))) entity.setProperty(name,value);
  }
  if (updates.length) session.assembly.syncVisuals(true);
}
