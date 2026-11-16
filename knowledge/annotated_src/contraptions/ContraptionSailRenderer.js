/* CLAUDE-MAP-BEGIN
 FILE: contraptions/ContraptionSailRenderer.js  (7 KB, 122 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: DEAD.
 IMPORTS: blocks/symmetric_sails.js
 IMPORTED BY: - (none: DEAD or entry)
 EXPORTS: SAIL_BATCH_ENTITY, sailBatchStyle, sailRigidMotion, createSailBatch, hideSailBatchSlot, hasPendingSailBatches, syncSailBatchTransforms
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): syncSailBatchTransforms@89(33L); createSailBatch@58(26L); sailBatchStyle@8(14L); continuousAngles@42(9L); euler@35(7L); sailRigidMotion@51(7L); quaternion@26(5L); multiply@22(4L); rotate@31(4L); hasPendingSailBatches@85(4L); key@6(1L); wrap@7(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { SAIL_MATERIALS } from "../blocks/symmetric_sails.js";

export const SAIL_BATCH_ENTITY = "create_physics:contraption_sail_batch";
const records = new WeakMap();
const recordsByEntity = new WeakMap();
const key = p => `${p.x},${p.y},${p.z}`;
const wrap = value => ((value % 360) + 540) % 360 - 180;
export function sailBatchStyle(block) {
  const prefix = "create_physics:symmetric_sail";
  if (!block.typeId?.startsWith(prefix) || block.visualAttachment || block.visual) return;
  const side = block.typeId.startsWith(prefix + "_side");
  const suffix = block.typeId.slice((side ? prefix + "_side" : prefix).length);
  const color = SAIL_MATERIALS.indexOf(suffix ? suffix.slice(1) : "white");
  if (color < 0 || Object.keys(block.visualProperties ?? {}).some(name => name !== "create_physics:sail_color")) return;
  const rotation = { x: 0, y: 0, z: 0, ...block.rotation };
  const quarters = [rotation.x, rotation.y, rotation.z].map(value => ((value / 90) % 4 + 4) % 4);
  if (quarters.some(value => Math.abs(value - Math.round(value)) > 0.00001)) return;
  const orientation = Math.round(quarters[0]) + Math.round(quarters[1]) * 4 + Math.round(quarters[2]) * 16;
  return { color, side, rotation, orientation, style: color + (side ? 20 : 0),
    group: `${orientation}|${block.contraptionSailPartition ?? ""}` };
}
function multiply(a, b) { return {
  x: a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y, y: a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,
  z: a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w, w: a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z
}; }
function quaternion(e) {
  const x=e.x*Math.PI/360,y=e.y*Math.PI/360,z=e.z*Math.PI/360;
  return multiply(multiply({x:0,y:Math.sin(y),z:0,w:Math.cos(y)},
    {x:0,y:0,z:Math.sin(z),w:Math.cos(z)}),{x:Math.sin(x),y:0,z:0,w:Math.cos(x)});
}
function rotate(q, p) {
  const v = multiply(multiply(q, { ...p, w: 0 }), {x:-q.x,y:-q.y,z:-q.z,w:q.w});
  return { x:v.x, y:v.y, z:v.z };
}
function euler(q) {
  const t=q.x*q.y+q.z*q.w,d=180/Math.PI;
  if (Math.abs(t)>0.499999) return {x:0,y:Math.sign(t)*2*Math.atan2(q.x,q.w)*d,z:Math.sign(t)*90};
  return {x:Math.atan2(2*q.x*q.w-2*q.y*q.z,1-2*q.x*q.x-2*q.z*q.z)*d,
    y:Math.atan2(2*q.y*q.w-2*q.x*q.z,1-2*q.y*q.y-2*q.z*q.z)*d,
    z:Math.asin(Math.max(-1,Math.min(1,2*t)))*d};
}
function continuousAngles(rotation,previous) {
  if(!previous)return rotation;
  if(Math.abs(Math.abs(rotation.z)-90)<0.0001)
    rotation={x:previous.x,y:rotation.y-Math.sign(rotation.z)*previous.x,z:rotation.z};
  const alternate={x:rotation.x+180,y:rotation.y+180,z:180-rotation.z};
  const distance=r=>['x','y','z'].reduce((sum,axis)=>sum+wrap(r[axis]-previous[axis])**2,0);
  const chosen=distance(alternate)<distance(rotation)?alternate:rotation;
  return {x:wrap(chosen.x),y:wrap(chosen.y),z:wrap(chosen.z)};
}
export function sailRigidMotion(block, transforms) {
  const base = block.rotation ?? {x:0,y:0,z:0}, pose = transforms.get(key(block.localLocation));
  const current = pose?.rotation ?? {...base,y:base.y+(pose?.yaw??0)};
  const original = quaternion(base), q = multiply(quaternion(current),{x:-original.x,y:-original.y,z:-original.z,w:original.w});
  const point = rotate(q,block.localLocation), target=pose?.location??block.localLocation;
  return { q, translation:{x:target.x-point.x,y:target.y-point.y,z:target.z-point.z} };
}
export function createSailBatch(dimension, body, anchor, blocks, tags, rotation) {
  const style = sailBatchStyle(blocks[0]);
  if (!style || blocks.length > 20 || blocks.some(block => sailBatchStyle(block)?.group !== style.group))
    throw new Error("Incompatible sail batch members.");
  const entity = dimension.spawnEntity(SAIL_BATCH_ENTITY,body.localPointToWorld(anchor));
  const origin = Object.fromEntries(["x","y","z"].map(axis=>[axis,Math.min(...blocks.map(block=>block.localLocation[axis]))]));
  try {
    for (const tag of tags) if (!entity.addTag(tag)) throw new Error("Could not tag sail batch.");
    const angles=rotation??body.getVisualRotation();
    for (const [axis,name] of [["x","pitch"],["y","yaw"],["z","roll"]]) entity.setProperty(`create_physics:${name}`,wrap(angles[axis]));
    for (const axis of ["x","y","z"]) entity.setProperty(`create_physics:batch_${axis}`,origin[axis]-anchor[axis]);
    entity.setProperty("create_physics:sail_orientation",style.orientation);
    entity.setProperty("create_physics:uniform_sail_style",blocks.every(block=>sailBatchStyle(block).style===style.style)?style.style:-1);
    blocks.forEach((block,slot)=>{
      const p={x:block.localLocation.x-origin.x,y:block.localLocation.y-origin.y,z:block.localLocation.z-origin.z};
      if (![p.x,p.y,p.z].every(value=>Number.isInteger(value)&&value>=0&&value<64)) throw new Error("Sail batch span exceeds 64 cells.");
      const memberStyle=sailBatchStyle(block);
      entity.setProperty(`create_physics:b${slot}_data`,(memberStyle.style+1)*262144+p.x+p.y*64+p.z*4096);
    });
    let map=records.get(body); if(!map) records.set(body,map=new Map());
    for(const [id,record]of map)if(!record.entity.isValid)map.delete(id);
    const record={entity,blocks,origin,anchor:{...anchor},pending:true,last:{},active:new Set(blocks.map((_,slot)=>slot))};
    map.set(entity.id,record);recordsByEntity.set(entity,record);
    return entity;
  } catch(error) { if(entity.isValid)entity.remove();throw error; }
}
export function hideSailBatchSlot(entity,slot) { recordsByEntity.get(entity)?.active.delete(slot); }
export function hasPendingSailBatches(assembly) {
  for(const record of records.get(assembly.body)?.values()??[]) if(record.entity.isValid&&record.pending)return true;
  return false;
}
export function syncSailBatchTransforms(assembly, transforms) {
  const map=records.get(assembly.body); if(!map)return true;
  let compatible=true;
  for(const [id,record] of map){
    if(!record.entity.isValid){map.delete(id);continue;}
    const blocks=record.blocks.filter((block,slot)=>record.active.has(slot));
    if(!blocks.length)continue;
    const first=sailRigidMotion(blocks[0],transforms);
    const motions=blocks.map(block=>({block,motion:sailRigidMotion(block,transforms)}));
    if(motions.some(({motion})=>{
      const dot=Math.abs(first.q.x*motion.q.x+first.q.y*motion.q.y+first.q.z*motion.q.z+first.q.w*motion.q.w);
      return 1-dot>1e-7||Math.hypot(...["x","y","z"].map(axis=>motion.translation[axis]-first.translation[axis]))>0.0002;
    })){
      compatible=false;
      for(const {block,motion}of motions){
        const sign=motion.q.w<0?-1:1;
        block.contraptionSailPartition=[...['x','y','z','w'].map(axis=>motion.q[axis]*sign),...['x','y','z'].map(axis=>motion.translation[axis])]
          .map(value=>Math.round(value*10000)).join(',');
      }
      continue;
    }
    const moved=rotate(first.q,record.origin), angles=continuousAngles(euler(first.q),record.angles);
    record.angles=angles;
    const values={};
    for(const axis of ['x','y','z']){
      values[`batch_${axis}`]=moved[axis]+first.translation[axis]-record.anchor[axis];
      values[`motion_${axis}`]=wrap(angles[axis]);
    }
    for(const [name,value]of Object.entries(values))if(record.last[name]!==value){record.entity.setProperty(`create_physics:${name}`,value);record.last[name]=value;}
    record.pending=false;
  }
  return compatible;
}
