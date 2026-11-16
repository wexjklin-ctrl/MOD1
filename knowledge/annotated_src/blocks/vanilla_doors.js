/* CLAUDE-MAP-BEGIN
 FILE: blocks/vanilla_doors.js  (2 KB, 48 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: -
 IMPORTED BY: blocks/create_doors.js, main.js
 EXPORTS: VANILLA_DOORS, isVanillaDoor, vanillaDoorState, setVanillaDoorState, vanillaDoorCollision, vanillaDoorRotation, normalizeVanillaDoorPairs
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): normalizeVanillaDoorPairs@32(16L); vanillaDoorCollision@23(6L); vanillaDoorState@14(5L); setVanillaDoorState@19(4L); vanillaDoorRotation@29(3L); isVanillaDoor@13(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
export const VANILLA_DOORS = new Map([
  ["minecraft:wooden_door",0],["minecraft:oak_door",0],["minecraft:spruce_door",1],
  ["minecraft:birch_door",2],["minecraft:jungle_door",3],["minecraft:acacia_door",4],
  ["minecraft:dark_oak_door",5],["minecraft:crimson_door",6],["minecraft:warped_door",7],
  ["minecraft:mangrove_door",8],["minecraft:cherry_door",9],["minecraft:bamboo_door",10],
  ["minecraft:pale_oak_door",11],["minecraft:iron_door",12],
  ["minecraft:copper_door",13],["minecraft:exposed_copper_door",14],
  ["minecraft:weathered_copper_door",15],["minecraft:oxidized_copper_door",16],
  ["minecraft:waxed_copper_door",13],["minecraft:waxed_exposed_copper_door",14],
  ["minecraft:waxed_weathered_copper_door",15],["minecraft:waxed_oxidized_copper_door",16],
  ["minecraft:poplar_door",17]
]);
export const isVanillaDoor = id=>VANILLA_DOORS.has(id);
export function vanillaDoorState(snapshot) {
  const s=snapshot.permutation.getAllStates();
  const read=name=>s[name] ?? s[`minecraft:${name}`];
  return {open:read("open_bit")===true,upper:read("upper_block_bit")===true,hinge:read("door_hinge_bit")===true,direction:Number(read("direction")??0)};
}
export function setVanillaDoorState(permutation,name,value) {
  const s=permutation.getAllStates();
  return permutation.withState(Object.prototype.hasOwnProperty.call(s,name)?name:`minecraft:${name}`,value);
}
export function vanillaDoorCollision(snapshot) {
  const s=vanillaDoorState(snapshot);
  if (!s.open) return [{min:{x:0,y:0,z:13/16},max:{x:1,y:1,z:1}}];
  return s.hinge ? [{min:{x:0,y:0,z:0},max:{x:3/16,y:1,z:1}}]
    : [{min:{x:13/16,y:0,z:0},max:{x:1,y:1,z:1}}];
}
export function vanillaDoorRotation(snapshot) {
  return {x:0,y:180-vanillaDoorState(snapshot).direction*90,z:0};
}
export function normalizeVanillaDoorPairs(snapshots) {
  const doors=new Map(snapshots.filter(s=>isVanillaDoor(s.typeId)).map(s=>[`${s.location.x},${s.location.y},${s.location.z}`,s]));
  for (const lower of doors.values()) {
    if (vanillaDoorState(lower).upper) continue;
    const upper=doors.get(`${lower.location.x},${lower.location.y+1},${lower.location.z}`);
    if (!upper || upper.typeId!==lower.typeId || !vanillaDoorState(upper).upper) continue;
    const bottomState=vanillaDoorState(lower),topState=vanillaDoorState(upper);
    for (const half of [lower,upper]) {
      let permutation=half.permutation;
      permutation=setVanillaDoorState(permutation,"direction",bottomState.direction);
      permutation=setVanillaDoorState(permutation,"open_bit",bottomState.open);
      permutation=setVanillaDoorState(permutation,"door_hinge_bit",topState.hinge);
      half.permutation=permutation;
    }
  }
}
