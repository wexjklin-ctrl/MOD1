/* CLAUDE-MAP-BEGIN
 FILE: blocks/barrel.js  (0 KB, 17 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: -
 IMPORTED BY: main.js
 EXPORTS: BARREL_FACES, barrelRotation, barrelPlacementFacing
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): barrelRotation@3(8L); barrelPlacementFacing@12(5L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
export const BARREL_FACES = ["down", "up", "north", "south", "west", "east"];

export function barrelRotation(snapshot) {
  const states=snapshot.permutation.getAllStates();
  const value=states["minecraft:facing_direction"] ?? states.facing_direction ?? 1;
  const face=typeof value === "number" ? BARREL_FACES[value] : value;
  // The lid is +Y in the model. Entity animation mirrors model Z and roll.
  const rotations={down:{x:180,y:0,z:0},up:{x:0,y:0,z:0},north:{x:90,y:0,z:0},south:{x:-90,y:0,z:0},west:{x:0,y:0,z:-90},east:{x:0,y:0,z:90}};
  return rotations[face] ?? rotations.up;
}

export function barrelPlacementFacing(view) {
  if (Math.abs(view.y)>Math.max(Math.abs(view.x),Math.abs(view.z))) return view.y>0 ? "down" : "up";
  if (Math.abs(view.x)>Math.abs(view.z)) return view.x>0 ? "west" : "east";
  return view.z>0 ? "north" : "south";
}
