/* CLAUDE-MAP-BEGIN
 FILE: blocks/rope_simulation.js  (12 KB, 277 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: Rope / handles link simulation.
 IMPORTS: -
 IMPORTED BY: main.js
 EXPORTS: MAX_ROPE_LENGTH, ROPE_SNAP_EXTRA, initialRopeLength, ropeVisualPoints, enforceRopeLength, stopRopePull, stepRope
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): stepRope@61(216L); stopRopePull@42(18L); enforceRopeLength@25(15L); initialRopeLength@12(6L); ropeVisualPoints@20(3L); copy@2(1L); distance@3(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// Persistent Verlet nodes: slack falls under gravity instead of rescaling a curve.
const copy = p => ({ x: p.x, y: p.y, z: p.z });
const distance = (a, b) => Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z);
// The segment's knot is 6 pixels wide (radius 3/16), wider than its cord.
const RADIUS = 0.205;
// шаг 108: защита от вылета при очень длинной/растянутой верёвке
export const MAX_ROPE_LENGTH = 64;          // длиннее такую верёвку не создаём
export const ROPE_SNAP_EXTRA = 12;          // растянули дальше длины + это (блоков): верёвка рвётся
const MAX_SCAN_CELLS = 4000;                // перебор блоков вдоль участка больше этого не делаем
const MAX_SAMPLES = 160;                    // предел точек проверки на один участок

export function initialRopeLength(start, end) {
  const d = distance(start,end);
  const horizontal = Math.hypot(end.x-start.x,end.z-start.z);
  // Allocate slack once, when connecting hooks, so gravity can form a curve.
  return Math.max(0.05, d + Math.min(1.5, Math.max(0.15,d*0.08)) * horizontal / Math.max(0.05,d));
}

// One entity per solver edge; the entity count stays fixed throughout movement.
export function ropeVisualPoints(nodes) {
  return nodes;
}

// Project movable anchors back to the available rope length, without a spring.
export function enforceRopeLength(bodyA, bodyB, pointA, pointB, restLength) {
  const d = distance(pointA, pointB);
  if (!Number.isFinite(restLength) || restLength <= 0 || d <= restLength || bodyA === bodyB) return false;
  const wa = bodyA ? 1 / Math.max(0.01, bodyA.getMass()) : 0;
  const wb = bodyB ? 1 / Math.max(0.01, bodyB.getMass()) : 0;
  if (wa + wb === 0) return false;
  const scale = (d - restLength) / (d * (wa + wb));
  const delta = { x:(pointB.x-pointA.x)*scale, y:(pointB.y-pointA.y)*scale, z:(pointB.z-pointA.z)*scale };
  for (const [body, weight] of [[bodyA, wa], [bodyB, -wb]]) {
    if (!body || weight === 0) continue;
    const location = body.location;
    body.teleport({ x:location.x+delta.x*weight, y:location.y+delta.y*weight, z:location.z+delta.z*weight });
  }
  return true;
}

// Remove only motion that would pull the anchors past the available length.
export function stopRopePull(bodyA, bodyB, pointA, pointB, restLength, dt) {
  const d = distance(pointA, pointB);
  if (!Number.isFinite(restLength) || restLength <= 0 || d < 0.000001 || !(dt > 0) || bodyA === bodyB) return;
  const n = { x:(pointB.x-pointA.x)/d, y:(pointB.y-pointA.y)/d, z:(pointB.z-pointA.z)/d };
  const va = bodyA ? bodyA.getVelocityAt(pointA) : { x:0, y:0, z:0 };
  const vb = bodyB ? bodyB.getVelocityAt(pointB) : { x:0, y:0, z:0 };
  const excess = (vb.x-va.x)*n.x+(vb.y-va.y)*n.y+(vb.z-va.z)*n.z - Math.max(0,restLength-d)/dt;
  if (excess <= 0.000001) return;
  const wa = bodyA && bodyA.getMass() > 0 ? 1/bodyA.getMass() : 0;
  const wb = bodyB && bodyB.getMass() > 0 ? 1/bodyB.getMass() : 0;
  if (wa+wb === 0) return;
  for (const [body, weight] of [[bodyA,wa],[bodyB,-wb]]) {
    if (!body || weight === 0) continue;
    const v=body.velocity, amount=excess*weight/(wa+wb);
    body.setVelocity({ x:v.x+n.x*amount, y:v.y+n.y*amount, z:v.z+n.z*amount });
    body.wakeUp();
  }
}

export function stepRope(link, start, end) {
  link.ropeCacheFrame = (link.ropeCacheFrame ?? 0) + 1;
  const rest = Math.min(MAX_ROPE_LENGTH * 1.5, Math.max(0.05, Number(link.restLength) || distance(start, end)));
  if (link.ropeNodes?.some(p => !Number.isFinite(p.x + p.y + p.z))) link.ropeNodes = undefined;   // сбой чисел: пересоздать
  // Keep the topology created with the rope, including when its anchors move.
  const count = link.ropeNodes?.length >= 3
    ? link.ropeNodes.length - 1
    : Math.min(96, Math.max(2, Math.round(rest)));
  if (!link.ropeNodes || link.ropeNodes.length !== count + 1) {
    // Seed a hanging curve with the allocated length instead of a straight line.
    const curvePoint = (t, sag) => ({
      x:start.x+(end.x-start.x)*t,
      y:start.y+(end.y-start.y)*t-4*sag*t*(1-t),
      z:start.z+(end.z-start.z)*t
    });
    let low=0, high=rest;
    for (let iteration=0;iteration<24;iteration++) {
      const sag=(low+high)*0.5;
      let length=0, previous=start;
      for (let i=1;i<=count;i++) {
        const p=curvePoint(i/count,sag);
        length+=distance(previous,p); previous=p;
      }
      if (length>rest) high=sag; else low=sag;
    }
    link.ropeNodes = Array.from({ length: count + 1 }, (_, i) => {
      const t = i / count;
      const p = curvePoint(t,(low+high)*0.5);
      return { ...p, previous: copy(p) };
    });
  }
  const nodes = link.ropeNodes;
  link.ropeSleepingFrame = false;
  const anchorsStill = link.ropeLastStart && distance(start, link.ropeLastStart) < 0.000001 &&
    distance(end, link.ropeLastEnd) < 0.000001 && link.ropeLastRest === rest;
  if (anchorsStill && link.ropeQuietFrames >= 20 && (link.ropeSleepTicks ?? 0) < 9) {
    link.ropeSleepTicks = (link.ropeSleepTicks ?? 0) + 1;
    link.ropeSleepingFrame = true;
    return nodes;
  }
  if (!anchorsStill) link.ropeQuietFrames = 0;
  link.ropeSleepTicks = 0;
  link.ropeLastStart = copy(start);
  link.ropeLastEnd = copy(end);
  link.ropeLastRest = rest;
  if (link.ropeFrameStart?.length !== nodes.length) link.ropeFrameStart = nodes.map(copy);
  for (let i=0;i<nodes.length;i++) {
    link.ropeFrameStart[i].x = nodes[i].x;
    link.ropeFrameStart[i].y = nodes[i].y;
    link.ropeFrameStart[i].z = nodes[i].z;
  }
  // Reuse the solver's position buffer instead of allocating one per iteration.
  if (link.ropeScratch?.length !== nodes.length) link.ropeScratch = nodes.map(copy);
  const before = link.ropeScratch;
  // Keep block lookups for at most four ticks; obstacles are still rechecked.
  if (!link.ropeBlockCache || link.ropeCacheFrame - link.ropeBlockCacheFrame >= 4) {
    link.ropeBlockCache = new Map();
    link.ropeBlockCacheFrame = link.ropeCacheFrame;
  }
  const cache = link.ropeBlockCache;
  const solid = (x,y,z) => {
    const key = `${x},${y},${z}`;
    if (!cache.has(key)) {
      try {
        const block = link.first.dimension.getBlock({x,y,z});
        const type = block?.typeId ?? "";
        const passable = /(?:air|water|lava|fire|torch|flower|sapling|short_grass|tallgrass|tall_grass|vine|fern|deadbush|rail|redstone_wire)$/.test(type);
        // isSolid excludes partial blocks such as chests/fences/slabs. Keep
        // those as obstacles too; the hook itself contains our fixed anchor.
        cache.set(key, type !== "create_physics:rope_hook" &&
          (block?.isSolid === true || block?.isAir === false && !block.isLiquid && !passable));
      } catch { cache.set(key, false); }
    }
    return cache.get(key);
  };
  // Skip fine collision samples when the complete swept bounds contain no obstacle.
  const hasObstacle = (a, b) => {
    const cells = (Math.floor(Math.max(a.x,b.x)+RADIUS)-Math.floor(Math.min(a.x,b.x)-RADIUS)+1) *
      (Math.floor(Math.max(a.y,b.y)+RADIUS)-Math.floor(Math.min(a.y,b.y)-RADIUS)+1) *
      (Math.floor(Math.max(a.z,b.z)+RADIUS)-Math.floor(Math.min(a.z,b.z)-RADIUS)+1);
    if (!(cells <= MAX_SCAN_CELLS)) return false;   // слишком большой объём (или NaN): не сканируем, иначе игра зависает
    for (let x=Math.floor(Math.min(a.x,b.x)-RADIUS); x<=Math.floor(Math.max(a.x,b.x)+RADIUS); x++) {
      for (let y=Math.floor(Math.min(a.y,b.y)-RADIUS); y<=Math.floor(Math.max(a.y,b.y)+RADIUS); y++) {
        for (let z=Math.floor(Math.min(a.z,b.z)-RADIUS); z<=Math.floor(Math.max(a.z,b.z)+RADIUS); z++) {
          if (solid(x,y,z)) return true;
        }
      }
    }
    return false;
  };
  // A taut rope has no slack to sag. Avoid solver error lengthening its links.
  if (distance(start,end) >= rest - 0.0001 && !hasObstacle(start,end)) {
    for (let i=0;i<=count;i++) {
      const t=i/count, p=nodes[i];
      p.x=start.x+(end.x-start.x)*t;
      p.y=start.y+(end.y-start.y)*t;
      p.z=start.z+(end.z-start.z)*t;
      p.previous=copy(p);
    }
    return nodes;
  }
  const collide = (p, segmentDirection) => {
    for (let x=Math.floor(p.x-RADIUS); x<=Math.floor(p.x+RADIUS); x++) {
      for (let y=Math.floor(p.y-RADIUS); y<=Math.floor(p.y+RADIUS); y++) {
        for (let z=Math.floor(p.z-RADIUS); z<=Math.floor(p.z+RADIUS); z++) {
          if (!solid(x,y,z)) continue;
          if (p.x <= x-RADIUS+0.00001 || p.x >= x+1+RADIUS-0.00001 ||
              p.y <= y-RADIUS+0.00001 || p.y >= y+1+RADIUS-0.00001 ||
              p.z <= z-RADIUS+0.00001 || p.z >= z+1+RADIUS-0.00001) continue;
          const faces = [
            {axis:"x", value:x-RADIUS}, {axis:"x", value:x+1+RADIUS},
            {axis:"y", value:y-RADIUS}, {axis:"y", value:y+1+RADIUS},
            {axis:"z", value:z-RADIUS}, {axis:"z", value:z+1+RADIUS}
          ].filter(face => {
            if(segmentDirection && Math.abs(segmentDirection[face.axis]) >= 0.9) return false;
            const neighbor={x,y,z};
            neighbor[face.axis]+=face.value < neighbor[face.axis] ? -1 : 1;
            return !solid(neighbor.x,neighbor.y,neighbor.z);
          });
          if(!faces.length) continue;
          faces.sort((a,b)=>Math.abs(a.value-p[a.axis])-Math.abs(b.value-p[b.axis]));
          const face = faces[0];
          p[face.axis] = face.value;
          // Contact removes normal velocity and damps sliding on the ground.
          p.previous[face.axis] = face.value;
          for (const axis of ["x","y","z"]) {
            if (axis !== face.axis) p.previous[axis] += (p[axis]-p.previous[axis])*0.2;
          }
        }
      }
    }
  };
  const sweep = (from, p) => {
    if (!hasObstacle(from,p)) return;
    const steps = Math.min(MAX_SAMPLES, Math.max(1, Math.ceil(distance(from,p)/0.05)));
    const target=copy(p);
    for(let i=1;i<=steps;i++) {
      const t=i/steps;
      const sample={x:from.x+(target.x-from.x)*t,y:from.y+(target.y-from.y)*t,z:from.z+(target.z-from.z)*t,previous:copy(from)};
      const before=copy(sample);
      collide(sample);
      if(distance(before,sample)>0.00001) {
        Object.assign(p,copy(sample));
        p.previous=copy(sample);
        return;
      }
    }
    collide(p);
  };
  const collideSegments = () => {
    let corrected = false;
    for(let i=0;i<count;i++) {
      const a=nodes[i],b=nodes[i+1],d=distance(a,b);
      if(d<0.000001) continue;
      if (!hasObstacle(a,b)) continue;
      const direction={x:(b.x-a.x)/d,y:(b.y-a.y)/d,z:(b.z-a.z)/d};
      const samples=Math.min(MAX_SAMPLES,Math.max(2,Math.ceil(d/0.05)));
      for(let j=1;j<samples;j++) {
        const t=j/samples;
        const p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t};
        const before=copy(p);p.previous=copy(p);
        collide(p,direction);
        if(distance(before,p)<0.00001) continue;
        corrected = true;
        for(const node of [i===0?undefined:a,i+1===count?undefined:b]) {
          if(!node) continue;
          for(const axis of ["x","y","z"]) node[axis]+=(p[axis]-before[axis])*(i===0 || i+1===count ? 1/Math.max(0.05,i===0?t:1-t) : 1);
          collide(node);
          node.previous=copy(node);
        }
      }
    }
    return corrected;
  };
  // Two substeps prevent fast falling nodes from skipping through block faces.
  for (let substep=0; substep<2; substep++) {
    Object.assign(nodes[0], start);
    Object.assign(nodes[count], end);
    for (let i=1;i<count;i++) {
      const p=nodes[i], previous=copy(p);
      for (const axis of ["x","y","z"]) p[axis] += Math.max(-0.2,Math.min(0.2,(p[axis]-p.previous[axis])*0.96));
      p.y -= 9.81 * 0.025 * 0.025;
      p.previous=previous;
      sweep(previous,p);
    }
    const length = rest / count;
    for (let iteration=0;iteration<16;iteration++) {
      for (let i=0;i<nodes.length;i++) {
        before[i].x=nodes[i].x;
        before[i].y=nodes[i].y;
        before[i].z=nodes[i].z;
      }
      for (let k=0;k<count;k++) {
        const i=iteration%2 ? count-1-k : k;
        const a=nodes[i], b=nodes[i+1];
        const d=distance(a,b);
        if (d<0.000001) { if(i+1<count) b.x+=0.001; continue; }
        const correction=(d-length)/d;
        const wa=i===0?0:1, wb=i+1===count?0:1, total=wa+wb;
        if (!total) continue;
        for (const axis of ["x","y","z"]) {
          const delta=(b[axis]-a[axis])*correction/total;
          a[axis]+=delta*wa; b[axis]-=delta*wb;
        }
      }
      for(let i=1;i<count;i++) sweep(before[i],nodes[i]);
      if(iteration%4===3) collideSegments();
    }
    // Moving a shared node can put the previous segment into a corner.
    // Recheck the complete chain after projection, not only the node centers.
    for (let pass=0;pass<8;pass++) if (!collideSegments()) break;
  }
  const settled = nodes.every((p,i) => distance(p, link.ropeFrameStart[i]) < 0.002 && distance(p, p.previous) < 0.002);
  link.ropeQuietFrames = settled ? (link.ropeQuietFrames ?? 0) + 1 : 0;
  return nodes;
}
