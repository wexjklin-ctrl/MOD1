/* CLAUDE-MAP-BEGIN
 FILE: blocks/universal_block_orientation.js  (1 KB, 28 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (auto, from first comment) Preserve the placed block's direction when no dedicated model rule exists.
 IMPORTS: -
 IMPORTED BY: main.js
 EXPORTS: universalBlockRotation
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): universalBlockRotation@2(26L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// Preserve the placed block's direction when no dedicated model rule exists.
export function universalBlockRotation(snapshot) {
  const states = snapshot.permutation.getAllStates();
  const state = name => states[`minecraft:${name}`] ?? states[name];
  const horizontal = face => ({ north:0, east:-90, south:180, west:90 }[face]);
  const facing = face => {
    if (face === "up") return {x:-90,y:0,z:0};
    if (face === "down") return {x:90,y:0,z:0};
    const y=horizontal(face);
    return y === undefined ? undefined : {x:0,y,z:0};
  };
  const cardinal=state("cardinal_direction");
  if (cardinal !== undefined) return facing(cardinal);
  const numeric=state("facing_direction");
  if (Number.isInteger(numeric) && numeric>=0 && numeric<6) return facing(["down","up","north","south","west","east"][numeric]);
  const face=state("block_face");
  if (face !== undefined) return facing(face);
  const axis=state("pillar_axis");
  if (axis === "x") return {x:0,y:0,z:90};
  if (axis === "z") return {x:90,y:0,z:0};
  if (axis === "y") return {x:0,y:0,z:0};
  const sign=state("ground_sign_direction");
  if (Number.isInteger(sign) && sign>=0 && sign<16) return {x:0,y:-sign*22.5,z:0};
  const direction=state("direction");
  if (Number.isInteger(direction) && direction>=0 && direction<4) return facing(["south","west","north","east"][direction]);
  return undefined;
}
