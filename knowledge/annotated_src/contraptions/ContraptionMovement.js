/* CLAUDE-MAP-BEGIN
 FILE: contraptions/ContraptionMovement.js  (1 KB, 25 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: -
 IMPORTED BY: contraptions/ContraptionManager.js, main.js
 EXPORTS: assertVector, contraptionPose, moveContraption, localToWorld, worldToLocal, inheritSeparatedBodyMotion
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): moveContraption@8(7L); inheritSeparatedBodyMotion@18(7L); assertVector@1(4L); contraptionPose@5(3L); localToWorld@15(1L); worldToLocal@16(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
export function assertVector(value) {
  if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) throw new TypeError("Expected a finite Vector3.");
  return { x: value.x, y: value.y, z: value.z };
}
export function contraptionPose(assembly) {
  return { location: { ...assembly.body.location }, rotation: assembly.body.getRotation(), velocity: { ...assembly.body.velocity } };
}
export function moveContraption(assembly, location, rotation = assembly.body.getRotation()) {
  if (!assembly.isValid) throw new Error("Contraption is no longer active.");
  assembly.body.teleport(assertVector(location), {
    rotation: assertVector(rotation), velocity: { x: 0, y: 0, z: 0 }, angularVelocity: { x: 0, y: 0, z: 0 }
  });
  assembly.syncVisuals(true);
}
export function localToWorld(assembly, point) { return assembly.body.localPointToWorld(assertVector(point)); }
export function worldToLocal(assembly, point) { return assembly.body.worldPointToLocal(assertVector(point)); }

export function inheritSeparatedBodyMotion(source, target, constrained = false) {
  // Linear velocity belongs to the body's center of mass. Sampling at the new
  // center preserves every point's velocity when a rotating body is divided.
  const center = target.localPointToWorld(target.getCenterOfMass());
  target.setVelocity(assertVector(source.getVelocityAt(center)));
  target.setAngularVelocity(constrained ? { x: 0, y: 0, z: 0 } : assertVector(source.angularVelocity));
}
