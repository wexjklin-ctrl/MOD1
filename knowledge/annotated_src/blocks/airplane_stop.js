/* CLAUDE-MAP-BEGIN
 FILE: blocks/airplane_stop.js  (0 KB, 27 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: -
 IMPORTED BY: blocks/airplane_flight.js, main.js
 EXPORTS: airplaneStoppingForce, restrictUnpoweredFlight, stoppedAirplaneGroundVelocity
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): airplaneStoppingForce@1(9L); restrictUnpoweredFlight@11(9L); stoppedAirplaneGroundVelocity@21(6L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
export function airplaneStoppingForce(velocity, mass, grounded) {
  const braking = grounded ? 3 : 0.12;
  return {
    x: -velocity.x * mass * braking,
    // Air drag preserves momentum; gravity controls the fall.
    y: 0,
    z: -velocity.z * mass * braking
  };
}

export function restrictUnpoweredFlight(forces, engineOn, grounded) {
  if (engineOn) return forces;
  // An unpowered aircraft may fall or coast, but cannot generate a takeoff
  // impulse from drag on a downward-facing nose or flight stabilization.
  forces.force.y=Math.min(0,forces.force.y);
  forces.liftAcceleration=0;
  if (grounded) forces.torque={x:0,y:0,z:0};
  return forces;
}

export function stoppedAirplaneGroundVelocity(velocity, engineOn, grounded, towed) {
  if (engineOn || !grounded || towed) return undefined;
  const speed=Math.hypot(velocity.x,velocity.z);
  const factor=speed<0.08 ? 0 : Math.exp(-3/20);
  return {x:velocity.x*factor,y:velocity.y,z:velocity.z*factor};
}
