/* CLAUDE-MAP-BEGIN
 FILE: blocks/wheel_surface.js  (0 KB, 21 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: -
 IMPORTED BY: blocks/car_drive.js, main.js
 EXPORTS: wheelSurfaceGrip, wheelContactGrip, wheelSurfaceVelocity, wheelCoastFactor
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): wheelSurfaceVelocity@10(7L); wheelSurfaceGrip@1(6L); wheelCoastFactor@17(4L); wheelContactGrip@7(3L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
export function wheelSurfaceGrip(typeId) {
  if (typeId === "minecraft:blue_ice") return 0.015;
  if (typeId === "minecraft:packed_ice") return 0.03;
  if (typeId === "minecraft:ice" || typeId === "minecraft:frosted_ice") return 0.05;
  return 1;
}
export function wheelContactGrip(contacts) {
  return contacts.length ? contacts.reduce((sum,c)=>sum+wheelSurfaceGrip(c.terrain.typeId),0)/contacts.length : 1;
}
export function wheelSurfaceVelocity(velocity, axis, grip = 1) {
  const length=Math.hypot(axis.x,axis.z);
  if (length<0.01) return velocity;
  const dx=axis.x/length,dz=axis.z/length;
  const speed=velocity.x*dx+velocity.z*dz;
  return {x:velocity.x+(dx*speed-velocity.x)*grip,y:velocity.y,z:velocity.z+(dz*speed-velocity.z)*grip};
}
export function wheelCoastFactor(velocity, grip) {
  const stopSpeed=grip<1 ? 0.005 : 0.06;
  return Math.hypot(velocity.x,velocity.z)<stopSpeed ? 0 : Math.exp(-2.6*grip/20);
}
