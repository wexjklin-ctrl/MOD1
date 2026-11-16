/* CLAUDE-MAP-BEGIN
 FILE: blocks/car_orientation.js  (0 KB, 26 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: blocks/armchair.js
 IMPORTED BY: main.js
 EXPORTS: carFacingForward, isCarFacingBlock, restoredCarFacing
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): restoredCarFacing@14(12L); isCarFacingBlock@10(4L); carFacingForward@7(3L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { isArmchairBlock } from "./armchair.js";
// Native seat yaw and car controls use the same local forward convention.
const forwards = {
  north: {x:0,z:-1}, east: {x:1,z:0},
  south: {x:0,z:1}, west: {x:-1,z:0}
};
export function carFacingForward(facing) {
  return {...(forwards[facing] ?? forwards.south)};
}
export function isCarFacingBlock(typeId) {
  return isArmchairBlock(typeId) || typeId === "create_physics:steering_contro_wheel" ||
    typeId.startsWith("create:") && typeId.endsWith("_seat");
}
export function restoredCarFacing(facing, orientation) {
  const forward=carFacingForward(facing);
  const rotated={x:orientation.x.x*forward.x+orientation.z.x*forward.z,
    z:orientation.x.z*forward.x+orientation.z.z*forward.z};
  if (Math.hypot(rotated.x,rotated.z)<0.5) return facing;
  let best=facing,score=-Infinity;
  for (const [candidate,axis] of Object.entries(forwards)) {
    const dot=axis.x*rotated.x+axis.z*rotated.z;
    if (dot>score) {best=candidate;score=dot;}
  }
  return best;
}
