/* CLAUDE-MAP-BEGIN
 FILE: blocks/glass_pane_collision.js  (0 KB, 11 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: -
 IMPORTED BY: main.js
 EXPORTS: glassPaneCollision
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): glassPaneCollision@1(9L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
export function glassPaneCollision(connections = {}) {
  const low = 7.25 / 16, high = 8.75 / 16;
  const boxes = [{min:{x:low,y:0,z:low},max:{x:high,y:1,z:high}}];
  if (connections.north) boxes.push({min:{x:low,y:0,z:0},max:{x:high,y:1,z:low}});
  if (connections.south) boxes.push({min:{x:low,y:0,z:high},max:{x:high,y:1,z:1}});
  if (connections.west) boxes.push({min:{x:0,y:0,z:low},max:{x:low,y:1,z:high}});
  if (connections.east) boxes.push({min:{x:high,y:0,z:low},max:{x:1,y:1,z:high}});
  return boxes;
}

