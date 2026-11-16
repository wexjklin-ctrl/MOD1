/* CLAUDE-MAP-BEGIN
 FILE: blocks/create_doors.js  (8 KB, 151 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: blocks/vanilla_doors.js
 IMPORTED BY: main.js
 EXPORTS: CREATE_DOORS, isCreateDoor, createDoorState, createDoorProperties, createDoorCollision, raycastCreateDoors, doorContactCenter, createDoorPlayerSupports, configureCreateDoors, toggleCreateDoor
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): raycastCreateDoors@24(62L); configureCreateDoors@109(22L); toggleCreateDoor@131(20L); createDoorPlayerSupports@96(13L); doorContactCenter@86(10L); createDoorState@7(6L); createDoorProperties@13(6L); createDoorCollision@19(4L); isCreateDoor@6(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { VANILLA_DOORS, isVanillaDoor, vanillaDoorState, setVanillaDoorState, vanillaDoorCollision } from "./vanilla_doors.js";
export const CREATE_DOORS = new Map([
  ["create:andesite_door",0],["create:brass_door",1],
  ["create:copper_door",2],["create:glass_door",3]
]);
export const isCreateDoor = typeId => CREATE_DOORS.has(typeId) || isVanillaDoor(typeId);
export function createDoorState(snapshot) {
  if (isVanillaDoor(snapshot.typeId)) return vanillaDoorState(snapshot);
  return {open:snapshot.permutation.getState("create:open") === true,
    upper:snapshot.permutation.getState("create:upper") === true,
    hinge:snapshot.permutation.getState("create:hinge") === true};
}
export function createDoorProperties(snapshot) {
  const state = createDoorState(snapshot);
  return {"create_physics:door_variant":CREATE_DOORS.get(snapshot.typeId) ?? VANILLA_DOORS.get(snapshot.typeId),
    "create_physics:door_open":state.open,"create_physics:door_upper":state.upper,
    "create_physics:door_hinge":state.hinge};
}
export function createDoorCollision(snapshot) {
  if (isVanillaDoor(snapshot.typeId)) return vanillaDoorCollision(snapshot);
  return createDoorState(snapshot).open ? "none" : [{min:{x:0,y:0,z:0},max:{x:1,y:1,z:3/16}}];
}
const doorPickLayouts = new WeakMap();
export function raycastCreateDoors(session,origin,direction,maxDistance) {
  const assembly=session.assembly;
  if (!assembly?.isValid) return undefined;
  let layout=doorPickLayouts.get(session);
  if (!layout || layout.snapshots!==session.snapshots || layout.count!==session.snapshots.length || layout.blocks!==assembly.blocks) {
    const blockMap=new Map(assembly.blocks.map(b=>[`${b.localLocation.x},${b.localLocation.y},${b.localLocation.z}`,b]));
    layout={snapshots:session.snapshots,count:session.snapshots.length,blocks:assembly.blocks,doors:[]};
    for (const snapshot of session.snapshots) {
      if (!isCreateDoor(snapshot.typeId) || createDoorState(snapshot).upper) continue;
      const local={x:snapshot.location.x-session.location.x,y:snapshot.location.y-session.location.y,z:snapshot.location.z-session.location.z};
      const block=blockMap.get(`${local.x},${local.y},${local.z}`);
      if (block) layout.doors.push({snapshot,block,local});
    }
    doorPickLayouts.set(session,layout);
  }
  if (!layout.doors.length) return undefined;
  const localOrigin=assembly.body.worldPointToLocal(origin);
  const end=assembly.body.worldPointToLocal({x:origin.x+direction.x,y:origin.y+direction.y,z:origin.z+direction.z});
  const ray={x:end.x-localOrigin.x,y:end.y-localOrigin.y,z:end.z-localOrigin.z};
  let closest;
  for (const {snapshot,block,local} of layout.doors) {
    const angle=(block.rotation?.y??0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
    const dx=localOrigin.x-local.x,dz=localOrigin.z-local.z;
    const start={x:dx*c-dz*s,y:localOrigin.y-local.y,z:dx*s+dz*c};
    const vector={x:ray.x*c-ray.z*s,y:ray.y,z:ray.x*s+ray.z*c};
    const state=createDoorState(snapshot);
    let min={x:-0.52,y:-0.52,z:-0.52},max={x:0.52,y:1.52,z:-0.29};
    if (isVanillaDoor(snapshot.typeId)) {
      if (!state.open) {min.z=0.29;max.z=0.52;}
      else {min={x:state.hinge?-0.52:0.29,y:-0.52,z:-0.52};max={x:state.hinge?-0.29:0.52,y:1.52,z:0.52};}
    } else if (state.open) {
      if (snapshot.typeId==="create:brass_door" || snapshot.typeId==="create:glass_door") {
        const offset=state.hinge?-14/16:14/16;
        min={x:-0.52+offset,y:-0.52,z:-0.4};max={x:0.52+offset,y:1.52,z:-0.16};
      } else {
        min={x:state.hinge?-0.62:0.18,y:-0.52,z:-0.52};
        max={x:state.hinge?-0.18:0.62,y:1.52,z:0.32};
      }
    }
    // Give the moving door a two-pixel interaction margin on every face.
    // Keep this separate from physical collision and follow its open position.
    for (const axis of ["x","y","z"]) {
      min[axis]-=2/16;
      max[axis]+=2/16;
    }
    let near=0,far=maxDistance,normal={x:0,y:0,z:0};
    for (const axis of ["x","y","z"]) {
      if (Math.abs(vector[axis])<1e-8) {if(start[axis]<min[axis] || start[axis]>max[axis]) {far=-1;break;}continue;}
      let a=(min[axis]-start[axis])/vector[axis],b=(max[axis]-start[axis])/vector[axis];
      const sign=a<=b?-1:1;
      if(a>b) [a,b]=[b,a];
      if(a>near) {near=a;normal={x:0,y:0,z:0};normal[axis]=sign;}
      far=Math.min(far,b);
      if(near>far) break;
    }
    if(far<near || far<0 || near>maxDistance || closest && near>=closest.hit.distance) continue;
    const gridNormal={x:Math.round(normal.x*c+normal.z*s),y:normal.y,z:Math.round(-normal.x*s+normal.z*c)};
    closest={session,snapshot,hit:{block,distance:near,localNormal:gridNormal,localFaceOffset:{x:dx+ray.x*near,y:start.y+ray.y*near,z:dz+ray.z*near},
      location:{x:origin.x+direction.x*near,y:origin.y+direction.y*near,z:origin.z+direction.z*near},localLocation:{x:localOrigin.x+ray.x*near,y:localOrigin.y+ray.y*near,z:localOrigin.z+ray.z*near}}};
  }
  return closest;
}
export function doorContactCenter(assembly,localLocation,rotation,playerLocation,plane={axis:"z",value:-13/32}) {
  const point=assembly.body.worldPointToLocal(playerLocation);
  const radians=(rotation?.y ?? 0)*Math.PI/180;
  const dx=point.x-localLocation.x,dz=point.z-localLocation.z;
  const x=dx*Math.cos(radians)-dz*Math.sin(radians);
  const z=dx*Math.sin(radians)+dz*Math.cos(radians);
  const along=plane.axis==="z"?x:z,normal=plane.axis==="z"?z:x;
  const clamped=Math.max(-13/32,Math.min(13/32,along));
  return {center:{x:plane.axis==="z"?clamped:plane.value,y:0.5,z:plane.axis==="z"?plane.value:clamped},near:Math.abs(along)<=1.1 && Math.abs(normal-plane.value)<=1.3 && point.y-localLocation.y>=-2 && point.y-localLocation.y<=3};
}
export function createDoorPlayerSupports(snapshot,session,players=[]) {
  const state=createDoorState(snapshot);
  if (state.open && !isVanillaDoor(snapshot.typeId) || state.upper || !session?.assembly?.isValid) return [];
  const local={x:snapshot.location.x-session.location.x,y:snapshot.location.y-session.location.y,z:snapshot.location.z-session.location.z};
  const block=session.assembly.blocks.find(b=>b.localLocation.x===local.x && b.localLocation.y===local.y && b.localLocation.z===local.z);
  const plane=isVanillaDoor(snapshot.typeId) ? (state.open ? {axis:"x",value:state.hinge?-13/32:13/32} : {axis:"z",value:13/32}) : {axis:"z",value:-13/32};
  const supports=[];
  for (const player of players) {
    const contact=doorContactCenter(session.assembly,local,block?.rotation,player,plane);
    if (contact.near) supports.push({center:contact.center,height:2,event:"create_physics:door_contact_support",key:`door:${player.id}`,doorPlayer:player.id,doorPlane:plane});
  }
  return supports;
}
export function configureCreateDoors(session,world) {
  if (!session.assembly?.isValid) return;
  const doors = session.snapshots.filter(s=>isCreateDoor(s.typeId));
  if (!doors.length) return;
  const byLocation = new Map(doors.map(s=>[`${s.location.x-session.location.x},${s.location.y-session.location.y},${s.location.z-session.location.z}`,s]));
  for (const id of session.assembly.visualEntityIds) {
    const block = session.assembly.getVisualBlock(id);
    if (!block || !isCreateDoor(block.typeId)) continue;
    try {
      const p=block.localLocation, snapshot=byLocation.get(`${p.x},${p.y},${p.z}`);
      const entity=world.getEntity(id);
      if (!snapshot || !entity?.isValid) continue;
      if (createDoorState(snapshot).upper) {
        entity.remove();
        continue;
      }
      for (const [name,value] of Object.entries(createDoorProperties(snapshot))) {
        if (entity.getProperty(name)!==value) entity.setProperty(name,value);
      }
    } catch {}
  }
}
export function toggleCreateDoor(session,snapshot,services) {
  if (!session.assembly?.isValid || !isCreateDoor(snapshot?.typeId)) return false;
  const state=createDoorState(snapshot), open=!state.open;
  const otherY=snapshot.location.y+(state.upper?-1:1);
  const pair=session.snapshots.filter(s=>s.typeId===snapshot.typeId && s.location.x===snapshot.location.x && s.location.z===snapshot.location.z &&
    (s===snapshot || s.location.y===otherY && createDoorState(s).upper!==state.upper));
  const updates=[];
  for (const part of pair) {
    part.permutation=isVanillaDoor(part.typeId) ? setVanillaDoorState(part.permutation,"open_bit",open) : part.permutation.withState("create:open",open).withState("create:animating",false);
    const local={x:part.location.x-session.location.x,y:part.location.y-session.location.y,z:part.location.z-session.location.z};
    updates.push({localLocation:local,collisionShape:createDoorCollision(part)});
  }
  session.assembly.setBlockCollisionShapes(updates);
  session.assembly.body.wakeUp();
  configureCreateDoors(session,services.world);
  services.refreshSupports(session);
  services.persist(session);
  try { session.dimension.playSound((open?"open.":"close.")+(isVanillaDoor(snapshot.typeId) && !snapshot.typeId.includes("iron") && !snapshot.typeId.includes("copper") ? "wooden_door" : "iron_door"),session.assembly.body.localPointToWorld(updates[0].localLocation),{pitch:1.05,volume:0.8}); } catch {}
  return true;
}
