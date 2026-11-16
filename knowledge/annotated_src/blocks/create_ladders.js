/* CLAUDE-MAP-BEGIN
 FILE: blocks/create_ladders.js  (1 KB, 18 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: -
 IMPORTED BY: main.js
 EXPORTS: CREATE_LADDERS, isPhysicsLadder, createLadderDirection, setPhysicsLadderFacing
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): setPhysicsLadderFacing@10(8L); createLadderDirection@5(5L); isPhysicsLadder@4(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
export const CREATE_LADDERS=new Map([
  ["create:ladder_andesite",0],["create:ladder_brass",1],["create:ladder_copper",2]
]);
export const isPhysicsLadder=typeId=>typeId==="minecraft:ladder" || CREATE_LADDERS.has(typeId);
export function createLadderDirection(snapshot) {
  const states=snapshot.permutation.getAllStates();
  const facing=states["minecraft:cardinal_direction"] ?? states.cardinal_direction ?? "north";
  return {north:0,west:1,south:2,east:3}[facing] ?? 0;
}
export function setPhysicsLadderFacing(snapshot,numeric) {
  const states=snapshot.permutation.getAllStates();
  if (CREATE_LADDERS.has(snapshot.typeId)) {
    const state=Object.prototype.hasOwnProperty.call(states,"minecraft:cardinal_direction") ? "minecraft:cardinal_direction" : "cardinal_direction";
    return snapshot.permutation.withState(state,{2:"north",3:"south",4:"west",5:"east"}[numeric]);
  }
  return snapshot.permutation.withState(Object.prototype.hasOwnProperty.call(states,"facing_direction") ? "facing_direction" : "minecraft:facing_direction",numeric);
}
