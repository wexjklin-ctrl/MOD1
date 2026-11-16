/* CLAUDE-MAP-BEGIN
 FILE: blocks/seat_exit.js  (2 KB, 57 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: -
 IMPORTED BY: main.js
 EXPORTS: findSeatExit
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): findSeatExit@5(52L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
const hazards = new Set(["minecraft:lava", "minecraft:flowing_lava", "minecraft:fire", "minecraft:soul_fire", "minecraft:cactus", "minecraft:magma", "minecraft:campfire", "minecraft:soul_campfire", "minecraft:powder_snow", "minecraft:sweet_berry_bush"]);

// Only runs on dismount. Bounds include nearby moving structures, which native
// teleport checks cannot see because their blocks are rendered as entities.
export function findSeatExit(dimension, center, boxes = []) {
  const cache = new Map();
  const read = (x, y, z) => {
    const key = `${x},${y},${z}`;
    if (!cache.has(key)) {
      try { cache.set(key, dimension.getBlock({x, y, z}) ?? null); }
      catch { cache.set(key, null); }
    }
    return cache.get(key);
  };
  const intersects = (a, b) => a.min.x < b.max.x && a.max.x > b.min.x &&
    a.min.y < b.max.y && a.max.y > b.min.y && a.min.z < b.max.z && a.max.z > b.min.z;
  const clear = (p, radius = 0.34) => {
    const bounds = {min:{x:p.x-radius,y:p.y,z:p.z-radius}, max:{x:p.x+radius,y:p.y+1.9,z:p.z+radius}};
    if (boxes.some(box => intersects(bounds, box))) return false;
    for (let x=Math.floor(bounds.min.x); x<=Math.floor(bounds.max.x); x++)
      for (let y=Math.floor(bounds.min.y); y<=Math.floor(bounds.max.y); y++)
        for (let z=Math.floor(bounds.min.z); z<=Math.floor(bounds.max.z); z++) {
          const block = read(x,y,z);
          if (!block || !block.isAir || block.isLiquid || hazards.has(block.typeId)) return false;
        }
    return true;
  };
  const supported = p => {
    const y=p.y-0.08;
    if (boxes.some(b => p.x>b.min.x && p.x<b.max.x && p.z>b.min.z && p.z<b.max.z && y>=b.min.y && y<=b.max.y)) return true;
    const block=read(Math.floor(p.x),Math.floor(y),Math.floor(p.z));
    return !!block?.isSolid && !hazards.has(block.typeId);
  };
  let best, bestScore=-Infinity;
  const offsets=[{x:0,z:0}];
  for (const radius of [1,2,3,4,6]) for (let i=0;i<8;i++) {
    const angle=i*Math.PI/4;
    offsets.push({x:Math.cos(angle)*radius,z:Math.sin(angle)*radius});
  }
  for (const offset of offsets) {
    const x=center.x+offset.x,z=center.z+offset.z;
    const heights=new Set();
    for (let dy=-4;dy<=5;dy++) heights.add(Math.floor(center.y)+dy+0.05);
    for (const box of boxes) if (x>box.min.x && x<box.max.x && z>box.min.z && z<box.max.z &&
      box.max.y>=center.y-4 && box.max.y<=center.y+5) heights.add(box.max.y+0.05);
    for (const y of heights) {
      const point={x,y,z};
      if (!supported(point) || !clear(point)) continue;
      let clearance=0;
      for (const radius of [0.6,1,1.4]) { if (!clear(point,radius)) break; clearance++; }
      const score=clearance*2-Math.hypot(offset.x,offset.z)*0.5-Math.abs(y-center.y)*0.8;
      if (score>bestScore) {best=point;bestScore=score;}
    }
  }
  return best;
}
