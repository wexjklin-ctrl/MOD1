/* CLAUDE-MAP-BEGIN
 FILE: blocks/wheel_marks.js  (2 KB, 50 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: DEAD: wheel tracks decals, not imported.
 IMPORTS: @minecraft/server
 IMPORTED BY: - (none: DEAD or entry)
 EXPORTS: emitWheelMarks
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): emitWheelMarks@5(45L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { MolangVariableMap } from "@minecraft/server";

const SPACING=0.3;

export function emitWheelMarks(wheel, center, radius, rollingAxis, airborne, tick, terrainTop) {
  if (tick%2) return;
  const bottom=center.y-radius;
  const contact=(x,z,y)=>{
    for (let blockY=Math.floor(y+0.15);blockY>=Math.floor(y)-1;blockY--) {
      const block=wheel.dimension.getBlock({x:Math.floor(x),y:blockY,z:Math.floor(z)});
      if (!block || block.isLiquid) continue;
      const top=terrainTop(block,x,z);
      if (top!==undefined && Math.abs(top-y)<=0.18) return top;
    }
  };
  if (airborne || wheel.assembly.body.isSleeping) {wheel.lastGroundMark=undefined;return;}
  try {
    const velocity=wheel.assembly.body.velocity;
    const speed=Math.hypot(velocity?.x ?? 0,velocity?.z ?? 0);
    const length=Math.hypot(rollingAxis.x,rollingAxis.z);
    const directionSign=length>0.01 && (velocity.x*rollingAxis.x+velocity.z*rollingAxis.z)<0 ? -1 : 1;
    const direction=speed>0.03 ? {x:velocity.x/speed,z:velocity.z/speed}
      : length>0.01 ? {x:rollingAxis.x/length*directionSign,z:rollingAxis.z/length*directionSign} : {x:0,z:0};
    const markX=center.x-direction.x*0.25;
    const markZ=center.z-direction.z*0.25;
    const top=contact(markX,markZ,bottom);
    if (top===undefined) {wheel.lastGroundMark=undefined;return;}
    const current={x:markX,y:top,z:markZ};
    const previous=wheel.lastGroundMark;
    if (!previous) {wheel.lastGroundMark=current;return;}
    const dx=current.x-previous.x,dz=current.z-previous.z;
    const distance=Math.hypot(dx,dz);
    if (distance>2 || Math.abs(current.y-previous.y)>0.6) {wheel.lastGroundMark=current;return;}
    if (distance<SPACING) return;
    const count=Math.min(4,Math.floor(distance/SPACING));
    const variables=new MolangVariableMap();
    variables.setFloat("variable.mark_angle",Math.atan2(length>0.01 ? rollingAxis.x : dx,length>0.01 ? rollingAxis.z : dz)*180/Math.PI);
    variables.setFloat("variable.mark_width",radius>1 ? 0.7 : 0.5);
    for (let i=1;i<=count;i++) {
      const fraction=i*SPACING/distance;
      const point={x:previous.x+dx*fraction,y:previous.y+(current.y-previous.y)*fraction,z:previous.z+dz*fraction};
      const surface=contact(point.x,point.z,point.y);
      if (surface!==undefined) wheel.dimension.spawnParticle("create_physics:rode_mark",{...point,y:surface+0.012},variables);
      wheel.lastGroundMark=point;
    }
  } catch {
    wheel.lastGroundMark=undefined;
  }
}
