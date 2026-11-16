/* CLAUDE-MAP-BEGIN
 FILE: blocks/propeller_bearing.js  (13 KB, 217 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: @minecraft/server, blocks/airplane_math.js, blocks/rz_air_mode.js, blocks/symmetric_sails.js, blocks/vehicle_systems.js, blocks/windmill_sails.js
 IMPORTED BY: blocks/airplane_flight.js, blocks/tower.js, main.js
 EXPORTS: PROPELLER_BEARING, SAILS_PER_BLADE, ROTOR_MAX_SPEED, placedRotorSailPermutation, sailPlacementNormal, orientPropellerSails, propellerGroups, multiply, quaternion, euler, continuousRotorRotation, rotorPose, addPropellerBearingMotion
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): addPropellerBearingMotion@123(94L); legacyPropellerGroups@61(23L); orientPropellerSails@40(16L); placedRotorSailPermutation@13(15L); sailPlacementNormal@28(12L); continuousRotorRotation@102(12L); rotorPose@114(8L); multiply@85(6L); euler@95(6L); propellerGroups@57(4L); quaternion@91(4L); sub@12(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { SYMMETRIC_SAIL_IDS, symmetricSailBase } from "./symmetric_sails.js";
import { WINDMILL_SAIL_IDS, isWindmillSail, windmillSailFacing, windmillRotorFacing } from "./windmill_sails.js";
import { world } from "@minecraft/server";
import { AIRPLANE_THROTTLE, ACTIVE_STATE, key, machineFront, dot, clamp } from "./airplane_math.js";
import { RZ_PROP_IDS, AIRCFG, propAxis } from "./rz_air_mode.js";   // RZ Lite
import { vehicleSystems, airEngineOn } from "./vehicle_systems.js";

export const PROPELLER_BEARING = "create_physics:propeller_bearing";
const sailIds = new Set([...SYMMETRIC_SAIL_IDS,...WINDMILL_SAIL_IDS]);
export const SAILS_PER_BLADE = 4;
export const ROTOR_MAX_SPEED = 36;
const sub = (a,b) => ({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
export function placedRotorSailPermutation(permutation, snapshots, clickedLocation, typeId) {
  const clickedKey = key(clickedLocation);
  const group = propellerGroups(snapshots).find(g => key(g.bearing.location) === clickedKey || g.members.some(m => key(m.location) === clickedKey));
  const source = group?.bearing ?? snapshots.find(s => key(s.location) === clickedKey && sailIds.has(s.typeId));
  if (!source) return permutation;
  if(isWindmillSail(typeId)) {
    const facing=group?windmillRotorFacing(source.permutation.getState("minecraft:cardinal_direction")):
      isWindmillSail(source.typeId)?windmillSailFacing(source.permutation):source.permutation.getState("minecraft:cardinal_direction");
    return permutation.withState("minecraft:facing_direction",facing??"south");
  }
  return permutation.withState("create_physics:horizontal", false)
    .withState("minecraft:cardinal_direction", group
      ? ({north:"west",east:"north",south:"east",west:"south"}[source.permutation.getState("minecraft:cardinal_direction")]??"east")
      : source.permutation.getState("minecraft:cardinal_direction") ?? "south");
}
export function sailPlacementNormal(hit, itemTypeId) {
  const normal = hit.localNormal;
  if (!sailIds.has(itemTypeId) ||
      ![hit.block.typeId, hit.block.itemTypeId].includes(itemTypeId) || !hit.thinFace || !hit.localFaceOffset) return normal;
  // The broad face's outer band extends the blade in its own plane.
  // Its center still places a block in front/behind for deeper designs.
  const axes = ['x','y','z'].filter(axis => normal[axis] === 0);
  axes.sort((a,b)=>Math.abs(hit.localFaceOffset[b])-Math.abs(hit.localFaceOffset[a]));
  const axis = axes[0];
  if (!axis || Math.abs(hit.localFaceOffset[axis]) < 0.25) return normal;
  return {...{x:0,y:0,z:0},[axis]:Math.sign(hit.localFaceOffset[axis])};
}
export function orientPropellerSails(snapshots) {
  for (const group of propellerGroups(snapshots)) {
    const facing = group.bearing.permutation.getState("minecraft:cardinal_direction") ?? "south";
    for (const member of group.members) {
      if (!sailIds.has(member.typeId)) continue;
      if(isWindmillSail(member.typeId)) {
        member.permutation=member.permutation.withState("minecraft:facing_direction",windmillRotorFacing(facing));
        continue;
      }
      const sailFacing = symmetricSailBase(member.typeId) === "create_physics:symmetric_sail"
        ? ({north:"west",east:"north",south:"east",west:"south"}[facing]) : facing;
      member.permutation = member.permutation.withState("create_physics:horizontal", false)
        .withState("minecraft:cardinal_direction", sailFacing);
    }
  }
}

export function propellerGroups(snapshots) {
  // шаг 138: Propeller Bearing стал «Башней конструкции» - роторы больше не считаются (ноль нагрузки), вращение башни: tower.js
  return [];
}
function legacyPropellerGroups(snapshots) {
  const blocks = new Map(snapshots.map(s => [key(s.location),s]));
  const claimed = new Set();
  return snapshots.filter(s => s.typeId === PROPELLER_BEARING).sort((a,b) => key(a.location).localeCompare(key(b.location))).map(bearing => {
    const facing = bearing.permutation.getState("minecraft:cardinal_direction") ?? "south";
    const forward = machineFront(facing), right = {x:forward.z,y:0,z:-forward.x};
    const center = {x:bearing.location.x+forward.x,y:bearing.location.y,z:bearing.location.z+forward.z};
    const queue=[center], members=[], counts=[0,0,0,0];
    for(let i=0;i<queue.length;i++) {
      const p=queue[i], id=key(p), block=blocks.get(id);
      if(!block || claimed.has(id) || block.typeId===PROPELLER_BEARING || dot(sub(p,bearing.location),forward)<1) continue;
      claimed.add(id); members.push(block);
      if(sailIds.has(block.typeId)) {
        const delta=sub(p,center), x=dot(delta,right), y=delta.y;
        if(Math.abs(x)>0 || Math.abs(y)>0) counts[Math.abs(x)>=Math.abs(y) ? (x>0?0:1) : (y>0?2:3)]++;
      }
      for(const offset of [right,{x:-right.x,y:0,z:-right.z},{x:0,y:1,z:0},{x:0,y:-1,z:0},forward,{x:-forward.x,y:0,z:-forward.z}]) {
        queue.push({x:p.x+offset.x,y:p.y+offset.y,z:p.z+offset.z});
      }
    }
    return {bearing,forward,center,members,counts,ready:members.some(m=>sailIds.has(m.typeId))};
  });
}

export function multiply(a,b) { return {
  x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,
  y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,
  z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,
  w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z
}; }
export function quaternion(e) {
  const a=e.x*Math.PI/360,b=e.y*Math.PI/360,c=e.z*Math.PI/360;
  return multiply(multiply({x:0,y:Math.sin(b),z:0,w:Math.cos(b)}, {x:0,y:0,z:Math.sin(c),w:Math.cos(c)}), {x:Math.sin(a),y:0,z:0,w:Math.cos(a)});
}
export function euler(q) {
  const t=q.x*q.y+q.z*q.w, d=180/Math.PI;
  if(Math.abs(t)>0.499999) return {x:0,y:Math.sign(t)*2*Math.atan2(q.x,q.w)*d,z:Math.sign(t)*90};
  return {x:Math.atan2(2*q.x*q.w-2*q.y*q.z,1-2*q.x*q.x-2*q.z*q.z)*d,
    y:Math.atan2(2*q.y*q.w-2*q.x*q.z,1-2*q.y*q.y-2*q.z*q.z)*d,z:Math.asin(clamp(2*t,-1,1))*d};
}
const wrapAngle = a => ((a + 180) % 360 + 360) % 360 - 180;
export function continuousRotorRotation(rotation, previous) {
  if (!previous) return rotation;
  // Equivalent Euler decompositions must not make the rendered block flip
  // its other two axes when the rotor crosses a quarter turn.
  if (Math.abs(Math.abs(rotation.z) - 90) < 0.0001) {
    rotation = {x:previous.x,y:rotation.y-Math.sign(rotation.z)*previous.x,z:rotation.z};
  }
  const alternate = {x:rotation.x+180,y:rotation.y+180,z:180-rotation.z};
  const distance = r => ['x','y','z'].reduce((n,k)=>n+wrapAngle(r[k]-previous[k])**2,0);
  const chosen = distance(alternate)<distance(rotation)?alternate:rotation;
  return {x:wrapAngle(chosen.x),y:wrapAngle(chosen.y),z:wrapAngle(chosen.z)};
}
export function rotorPose(local, pivot, axis, angle, baseRotation={x:0,y:0,z:0}, previousRotation) {
  const rad=-angle*Math.PI/180,c=Math.cos(rad),s=Math.sin(rad),v=sub(local,pivot),along=dot(v,axis);
  const cross={x:axis.y*v.z-axis.z*v.y,y:axis.z*v.x-axis.x*v.z,z:axis.x*v.y-axis.y*v.x};
  const location={x:pivot.x+v.x*c+cross.x*s+axis.x*along*(1-c),
    y:pivot.y+v.y*c+cross.y*s+axis.y*along*(1-c),z:pivot.z+v.z*c+cross.z*s+axis.z*along*(1-c)};
  const half=rad/2,spin={x:axis.x*Math.sin(half),y:axis.y*Math.sin(half),z:axis.z*Math.sin(half),w:Math.cos(half)};
  return {location,rotation:continuousRotorRotation(euler(multiply(spin,quaternion(baseRotation))),previousRotation),yaw:0};
}

export function addPropellerBearingMotion(session,transforms,balloonActive = false) {
  if(!session.assembly?.isValid || session.streamingMotion) return;
  if(session.rotorTopology!==session.snapshots || session.rotorCount!==session.snapshots.length || session.rotorAssembly!==session.assembly) {
    session.rotorTopology=session.snapshots;session.rotorCount=session.snapshots.length;session.rotorAssembly=session.assembly;
    session.rotorGroups=propellerGroups(session.snapshots);
    session.rotorRotations=new Map();
    session.rotorThrottles=session.snapshots.filter(s=>s.typeId===AIRPLANE_THROTTLE);
    session.rotorHasSteeringWheel=session.snapshots.some(s=>s.typeId==="create_physics:steering_wheel");
  }
  const throttles=session.rotorThrottles;
  const throttle=throttles.find(s=>s.permutation.getState(ACTIVE_STATE)===true)??throttles[0];
  const on=throttle ? throttle.permutation.getState("create_physics:propeller_on")===true : balloonActive;
  const steeringControlled=session.rotorHasSteeringWheel && (!throttle || balloonActive);
  const local=p=>sub(p,session.location), angles=new Map(), body=session.assembly.body;
  if(session.rotorBlocks!==session.assembly.blocks || session.rotorBlockCount!==session.assembly.blocks.length) {
    session.rotorBlocks=session.assembly.blocks;
    session.rotorBlockCount=session.assembly.blocks.length;
    session.rotorBlockMap=new Map(session.assembly.blocks.map(b=>[key(b.localLocation),b]));
  }
  const blockMap=session.rotorBlockMap;
  const bearingCount=session.rotorGroups.length;
  for(const group of session.rotorGroups) {
    const speed=group.bearing.rotorSpeed??0;
    const sign=group.bearing.permutation.getState("create_physics:push_forward")===false ? -1 : 1;
    const selectedSpeed=steeringControlled ? clamp(Number(group.bearing.propellerSpeed)||0,0,32)/32 : 1;
    const enabled=steeringControlled ? balloonActive && group.bearing.propellerEnabled===true : on;
    const powered=enabled && selectedSpeed>0 && group.ready;
    group.bearing.rotorSpeed=speed+clamp((powered?ROTOR_MAX_SPEED*selectedSpeed*sign:0)-speed,-2,2);
    group.bearing.rotorAngle=(((group.bearing.rotorAngle??0)+group.bearing.rotorSpeed)%360+360)%360;
    const angle=group.bearing.rotorAngle;
    angles.set(key(local(group.bearing.location)),angle>180?angle-360:angle);
    const pivot=local(group.center);
    for(const member of group.members) {
      const position=local(member.location),block=blockMap.get(key(position));
      // Derive blade geometry from the rotor axis itself, not the player's
      // facing at placement or an old visual's orientation.
      const baseRotation = block?.rotation ?? {x:0,y:0,z:0};
      const pose=rotorPose(position,pivot,group.forward,angle,baseRotation,session.rotorRotations.get(key(position))??baseRotation);
      session.rotorRotations.set(key(position),pose.rotation);
      pose.size=isWindmillSail(member.typeId)?{x:1,y:1,z:0.375}:sailIds.has(member.typeId)?{x:0.375,y:1,z:1}:{x:1,y:1,z:1};
      // Animated blades must not inject ground-contact impulses into the hull.
      // Ray interaction remains available; solid contact returns when stopped.
      pose.collisionResponse = Math.abs(group.bearing.rotorSpeed) < 0.001;
      transforms.set(key(position),pose);
    }
    if(!powered || Math.abs(group.bearing.rotorSpeed)<0.001 || session.airplaneHandlesPropulsion) continue;
    const spinSign=Math.sign(group.bearing.rotorSpeed);
    const push={x:group.forward.x*spinSign,y:group.forward.y*spinSign,z:group.forward.z*spinSign};
    const origin=body.localPointToWorld({x:0,y:0,z:0}),tip=body.localPointToWorld(push),direction=sub(tip,origin);
    const speedAlong=dot(body.velocity,direction);
    const acceleration=clamp((6-speedAlong)*0.65,0,2.5)*Math.abs(group.bearing.rotorSpeed)/ROTOR_MAX_SPEED;
    const force=body.getMass()*acceleration/Math.max(1,bearingCount);
    body.applyForceAt(body.localPointToWorld(body.getCenterOfMass()),{x:direction.x*force,y:direction.y*force,z:direction.z*force});
  }
  // RZ Lite: винт RZ (aero:block__smart_propeller__*) вращается вокруг своей оси, пока двигатель включён (пробел с кресла)
  if(vehicleSystems(session).rzProp) {
    // как в RZ (AirVisuals.update): с тягой скорость от рычага, без тяги винт вертится от потока воздуха
    const rig=session.rzRig;
    const spin=rig ? (session.rzDrivePowered && rig.thr>0.02 ? AIRCFG.SPIN*(0.15+0.85*rig.thr) : Math.min(AIRCFG.SPIN,Math.abs(rig.airspeed)*1.25))
      : (airEngineOn(session)?AIRCFG.SPIN:0);
    const target=spin*(AIRCFG.PROP_INV?-1:1);
    const spd=session.rzPropSpeed??0;
    session.rzPropSpeed=spd+clamp(target-spd,-2,2);
    session.rzPropAngle=(((session.rzPropAngle??0)+session.rzPropSpeed)%360+360)%360;
    for(const snap of session.snapshots) {
      if(!RZ_PROP_IDS.has(snap.typeId)) continue;
      const position=local(snap.location),base=blockMap.get(key(position))?.rotation??{x:0,y:0,z:0};
      const pose=rotorPose(position,position,propAxis(snap),session.rzPropAngle,base,session.rotorRotations.get(key(position))??base);
      session.rotorRotations.set(key(position),pose.rotation);
      pose.size={x:1,y:1,z:1};
      pose.collisionResponse=Math.abs(session.rzPropSpeed)<0.001;
      transforms.set(key(position),pose);
    }
  }
  if(!angles.size) return;
  const anchor=session.assembly.visualAnchor??{x:0,y:0,z:0};
  const ids=session.assembly.visualEntityIds;
  session.rotorVisualAudit=(session.rotorVisualAudit??0)+1;
  if(!session.rotorControlVisuals || session.rotorVisualBlocks!==session.assembly.blocks || session.rotorVisualCount!==ids.length || session.rotorVisualAudit>=20) {
    session.rotorVisualBlocks=session.assembly.blocks;session.rotorVisualCount=ids.length;session.rotorVisualAudit=0;
    session.rotorControlVisuals=[];
    for(const id of ids) {try {
      const entity=world.getEntity(id);if(entity?.typeId!==PROPELLER_BEARING)continue;
      const block=session.assembly.getVisualBlock(id);
      const location=block?.localLocation??{x:Math.round(entity.getProperty("create_physics:local_x")+anchor.x),y:Math.round(entity.getProperty("create_physics:local_y")+anchor.y),z:Math.round(entity.getProperty("create_physics:local_z")+anchor.z)};
      session.rotorControlVisuals.push({entity,key:key(location)});
    }catch{}}
  }
  for(const record of session.rotorControlVisuals) {try {
    if(!record.entity?.isValid)continue;
    const angle=angles.get(record.key)??0;
    if(record.angle!==angle){record.entity.setProperty("create_physics:rotor_angle",angle);record.angle=angle;}
  }catch{}}
}
