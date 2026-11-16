/* CLAUDE-MAP-BEGIN
 FILE: blocks/airplane_landing_gear.js  (2 KB, 54 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: -
 IMPORTED BY: main.js
 EXPORTS: AIRPLANE_GROUND_REACH, airplaneRestReady, airplaneWheelSupport
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): airplaneWheelSupport@27(27L); airplaneRestReady@4(19L); cross@23(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
export const AIRPLANE_GROUND_REACH = 0.08;
// Detect bounded contact jitter over a whole second rather than requiring
// virtually identical rotations on every frame. A real tip leaves this window.
export function airplaneRestReady(rest, pose, grounded, commanded) {
  if (!grounded || commanded) {
    rest.airplaneRestAnchor = undefined;
    rest.airplaneRestTicks = 0;
    return false;
  }
  const anchor = rest.airplaneRestAnchor;
  const angle = (a,b) => Math.abs((a-b+540)%360-180);
  const bounded = anchor && Math.hypot(pose.position.x-anchor.position.x,
    pose.position.y-anchor.position.y,pose.position.z-anchor.position.z) <= 0.06 &&
    ['x','y','z'].every(axis => angle(pose.rotation[axis],anchor.rotation[axis]) <= 1.5);
  if (!bounded) {
    rest.airplaneRestAnchor = {position:{...pose.position},rotation:{...pose.rotation}};
    rest.airplaneRestTicks = 0;
    return false;
  }
  rest.airplaneRestTicks = (rest.airplaneRestTicks ?? 0)+1;
  return rest.airplaneRestTicks >= 20;
}
const cross = (a, b, c) => (b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);

// Place the ground reaction inside the tire support polygon. An offset
// center of mass then tips the aircraft around the nearest supporting axle.
export function airplaneWheelSupport(points, center) {
  if (!points.length) return undefined;
  const sorted = [...points].sort((a,b) => a.x-b.x || a.z-b.z);
  const half = list => {
    const result = [];
    for (const p of list) {
      while (result.length >= 2 && cross(result[result.length-2],result[result.length-1],p) <= 0) result.pop();
      result.push(p);
    }
    return result;
  };
  const lower=half(sorted), upper=half([...sorted].reverse());
  const hull=sorted.length === 1 ? sorted : [...lower.slice(0,-1),...upper.slice(0,-1)];
  if (hull.length >= 3 && hull.every((p,i) => cross(p,hull[(i+1)%hull.length],center) >= -1e-8)) {
    return {x:center.x,z:center.z,balanced:true};
  }
  let closest=hull[0], distance=Infinity;
  for (let i=0; i<hull.length; i++) {
    const a=hull[i], b=hull[(i+1)%hull.length];
    const dx=b.x-a.x, dz=b.z-a.z, length=dx*dx+dz*dz;
    const t=length>1e-12 ? Math.max(0,Math.min(1,((center.x-a.x)*dx+(center.z-a.z)*dz)/length)) : 0;
    const candidate={x:a.x+t*dx,z:a.z+t*dz};
    const d=(candidate.x-center.x)**2+(candidate.z-center.z)**2;
    if (d<distance) {distance=d;closest=candidate;}
  }
  return {...closest,balanced:distance <= 0.05**2};
}
