/* CLAUDE-MAP-BEGIN
 FILE: blocks/wheel_suspension.js  (0 KB, 11 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: -
 IMPORTED BY: main.js
 EXPORTS: aircraftStructureCenterOfMass
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): aircraftStructureCenterOfMass@1(10L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
export function aircraftStructureCenterOfMass(blocks) {
  let mass=0;
  const moment={x:0,y:0,z:0};
  for (const block of blocks) {
    const weight=block.mass ?? 0.25;
    mass+=weight;
    for (const axis of ["x","y","z"]) moment[axis]+=block.localLocation[axis]*weight;
  }
  return mass>0 ? {x:moment.x/mass,y:moment.y/mass,z:moment.z/mass} : moment;
}
