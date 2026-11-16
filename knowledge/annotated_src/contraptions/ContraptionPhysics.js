/* CLAUDE-MAP-BEGIN
 FILE: contraptions/ContraptionPhysics.js  (0 KB, 12 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: -
 IMPORTED BY: contraptions/ContraptionManager.js, main.js
 EXPORTS: validateContraptionAssembly, stopContraption
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): stopContraption@6(6L); validateContraptionAssembly@1(5L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
export function validateContraptionAssembly(assembly) {
  if (!assembly?.isValid || !assembly.body?.isValid) throw new Error("Contraption physics initialization failed.");
  if (!assembly.visualEntityIds.length) throw new Error("Contraption has no visual representation.");
  return assembly;
}
export function stopContraption(assembly) {
  if (!assembly?.isValid) return false;
  assembly.body.setVelocity({ x: 0, y: 0, z: 0 });
  assembly.body.setAngularVelocity({ x: 0, y: 0, z: 0 });
  return true;
}
