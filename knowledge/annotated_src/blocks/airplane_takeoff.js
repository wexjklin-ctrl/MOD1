/* CLAUDE-MAP-BEGIN
 FILE: blocks/airplane_takeoff.js  (1 KB, 26 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: -
 IMPORTED BY: blocks/airplane_flight.js, blocks/airplane_math.js, main.js
 EXPORTS: AIRPLANE_TAKEOFF_DISTANCE, AIRPLANE_TAKEOFF_SPEED, airplaneTakeoffState, airplaneTakeoffPitch, airplaneGroundRollVelocity
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): airplaneGroundRollVelocity@15(11L); airplaneTakeoffState@4(5L); airplaneTakeoffPitch@9(5L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
export const AIRPLANE_TAKEOFF_DISTANCE = 1.5;
export const AIRPLANE_TAKEOFF_SPEED = 2;

export function airplaneTakeoffState(previous, {engineOn,grounded,position}) {
  return {distance:0,ready:engineOn,groundRoll:grounded,grounded,
    launchHeight:engineOn ? previous?.launchHeight ?? position.y : undefined,
    position:{...position}};
}
export function airplaneTakeoffPitch(state,pitch,position) {
  if (state.ready && state.groundRoll && Number.isFinite(state.launchHeight) &&
      position.y-state.launchHeight<2 && pitch>=0) return Math.max(pitch,0.25);
  return pitch;
}

export function airplaneGroundRollVelocity(velocity,forward,enginePower,engineOn,grounded) {
  if (!engineOn || !grounded || !(enginePower>0)) return undefined;
  const length=Math.hypot(forward.x,forward.z);
  if (length<0.01) return undefined;
  const dx=forward.x/length,dz=forward.z/length;
  const speed=velocity.x*dx+velocity.z*dz;
  // Like car wheel drive, apply a bounded velocity response after ground
  // contacts so static contact friction cannot hold the takeoff run still.
  const step=Math.max(-0.16,Math.min(0.16,(5-speed)*0.12))*Math.min(1,enginePower);
  return {x:velocity.x+dx*step,y:velocity.y,z:velocity.z+dz*step};
}
