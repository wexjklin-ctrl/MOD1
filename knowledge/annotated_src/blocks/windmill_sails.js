/* CLAUDE-MAP-BEGIN
 FILE: blocks/windmill_sails.js  (1 KB, 25 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: blocks/symmetric_sails.js
 IMPORTED BY: blocks/propeller_bearing.js, main.js
 EXPORTS: WINDMILL_SAIL_IDS, isWindmillSail, windmillRotorFacing, windmillSailFacing, windmillSailProperties, windmillSailRotation
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): windmillSailProperties@13(6L); windmillSailRotation@19(6L); windmillSailFacing@9(4L); windmillRotorFacing@6(3L); isWindmillSail@5(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { SAIL_COLORS } from "./symmetric_sails.js";

const colors=new Map(SAIL_COLORS.map((color,i)=>[i===0?"create:windmill_sail":`create:${color}_windmill_sail`,i]));
export const WINDMILL_SAIL_IDS=new Set(colors.keys());
export function isWindmillSail(typeId) {return colors.has(typeId);}
export function windmillRotorFacing(bearingFacing) {
  return {north:"south",south:"north",east:"west",west:"east"}[bearingFacing]??"north";
}
export function windmillSailFacing(permutation) {
  const value=permutation.getState("minecraft:facing_direction")??permutation.getState("facing_direction")??"up";
  return typeof value==="number"?["down","up","north","south","west","east"][value]??"up":value;
}
export function windmillSailProperties(snapshot) {
  return {
    "create_physics:sail_color":colors.get(snapshot.typeId)??0,
    "create_physics:sail_quarter_turn":snapshot.permutation.getState("create:sail_rotation")??0
  };
}
export function windmillSailRotation(snapshot) {
  const facing=windmillSailFacing(snapshot.permutation);
  if(facing==="up") return {x:-90,y:0,z:0};
  if(facing==="down") return {x:90,y:0,z:0};
  return {x:0,y:({north:180,south:0,east:90,west:-90}[facing]??0),z:0};
}
