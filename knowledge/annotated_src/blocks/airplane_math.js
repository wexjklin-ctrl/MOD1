/* CLAUDE-MAP-BEGIN
 FILE: blocks/airplane_math.js  (11 KB, 191 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: Aircraft math helpers.
 IMPORTS: blocks/airplane_takeoff.js, blocks/symmetric_sails.js
 IMPORTED BY: blocks/airplane_flight.js, blocks/airplane_throttle.js, blocks/propeller_bearing.js, main.js
 EXPORTS: AIRPLANE_THROTTLE, AIRPLANE_WING, ROLL_STATE, ACTIVE_STATE, key, clamp, dot, forwardFor, machineFront, bearingPushDirection, orientAirplaneSails, airplaneGroups, airplaneSailPose, wingDeflection, hasSymmetricWings, flightForces
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): flightForces@138(53L); orientAirplaneSails@41(30L); airplaneGroups@72(23L); hasSymmetricWings@120(17L); bearingPushDirection@22(12L); wingDeflection@107(10L); airplaneSailPose@97(9L); wingSeed@35(5L); forwardFor@10(4L); machineFront@17(4L); key@7(1L); clamp@8(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { SYMMETRIC_SAIL_IDS, symmetricSailBase } from "./symmetric_sails.js";
import { AIRPLANE_TAKEOFF_SPEED } from "./airplane_takeoff.js";
export const AIRPLANE_THROTTLE = "create_physics:airplane_throttle";
export const AIRPLANE_WING = "create_physics:airplane_wing_control";
export const ROLL_STATE = "create_physics:airplane_roll";
export const ACTIVE_STATE = "create_physics:airplane_active";
export const key = p => `${p.x},${p.y},${p.z}`;
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const forwardFor = facing => ({
  north: { x: 0, y: 0, z: -1 }, east: { x: 1, y: 0, z: 0 },
  south: { x: 0, y: 0, z: 1 }, west: { x: -1, y: 0, z: 0 }
})[facing] ?? { x: 0, y: 0, z: 1 };
// Physical entities face their cardinal direction; placed world blocks use
// their separate block-model transformation in airplane_wing_control.js.
const fronts = { north: [0, 1], east: [-1, 0], south: [0, -1], west: [1, 0] };
export function machineFront(facing) {
  const [x,z] = fronts[facing] ?? fronts.south;
  return {x,y:0,z};
}

export function bearingPushDirection(snapshots) {
  const sum = { x: 0, y: 0, z: 0 };
  for (const snapshot of snapshots) {
    if (snapshot.typeId !== "create_physics:propeller_bearing") continue;
    const blades = machineFront(snapshot.permutation.getState("minecraft:cardinal_direction"));
    // Tractor propeller: thrust points toward the blades in front of the bearing.
    const sign = snapshot.permutation.getState("create_physics:push_forward") === false ? -1 : 1;
    sum.x += blades.x * sign; sum.z += blades.z * sign;
  }
  const length = Math.hypot(sum.x, sum.z);
  return length > 0.001 ? { x: sum.x / length, y: 0, z: sum.z / length } : undefined;
}

function wingSeed(control, sails, facing) {
  const [x, z] = fronts[facing];
  const front = { x: control.location.x + x, y: control.location.y, z: control.location.z + z };
  return front;
}

export function orientAirplaneSails(snapshots) {
  const sails = new Map(snapshots.filter(s => SYMMETRIC_SAIL_IDS.has(s.typeId)).map(s => [key(s.location), s]));
  const reached = new Map();
  for (const control of snapshots.filter(s => s.typeId === AIRPLANE_WING).sort((a,b) => key(a.location).localeCompare(key(b.location)))) {
    const facing = control.permutation.getState("minecraft:cardinal_direction") ?? "south";
    const queue = [wingSeed(control, sails, facing)];
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i], id = key(p);
      const [fx,fz] = fronts[facing];
      if ((p.x-control.location.x)*fx+(p.z-control.location.z)*fz < 1) continue;
      if (reached.has(id) || !sails.has(id)) continue;
      reached.set(id, facing);
      for (const [x,z] of Object.values(fronts)) queue.push({x:p.x+x,y:p.y,z:p.z+z});
    }
  }
  const changed = [];
  for (const [id, sail] of sails) {
    const facing = reached.get(id);
    // A wall-mounted sail is already marked horizontal by its block component.
    // Keep that placed orientation when it is not part of an airplane wing.
    const horizontal = facing !== undefined || sail.permutation.getState("create_physics:horizontal") === true;
    if (sail.permutation.getState("create_physics:horizontal") === horizontal &&
        (!horizontal || facing === undefined || sail.permutation.getState("minecraft:cardinal_direction") === facing)) continue;
    sail.permutation = sail.permutation.withState("create_physics:horizontal", horizontal);
    if (horizontal) sail.permutation = sail.permutation.withState("minecraft:cardinal_direction", facing);
    changed.push(sail);
  }
  // RZ Lite: ориентацию крыла вне блока управления задаёт игрок (присед при установке), по соседям не распространяем.
  return changed;
}

export function airplaneGroups(snapshots) {
  const sails = new Map(snapshots.filter(s => SYMMETRIC_SAIL_IDS.has(s.typeId) &&
    s.permutation.getState("create_physics:horizontal") === true).map(s => [key(s.location), s]));
  const claimed = new Set();
  return snapshots.filter(s => s.typeId === AIRPLANE_WING)
    .sort((a, b) => key(a.location).localeCompare(key(b.location))).map(control => {
      const facing = control.permutation.getState("minecraft:cardinal_direction") ?? "south";
      const queue = [wingSeed(control, sails, facing)];
      const members = [];
      for (let i = 0; i < queue.length; i++) {
        const p = queue[i], id = key(p);
        const [fx,fz] = fronts[facing];
        if ((p.x-control.location.x)*fx+(p.z-control.location.z)*fz < 1) continue;
        if (claimed.has(id) || !sails.has(id)) continue;
        claimed.add(id);
        members.push(sails.get(id));
        for (const [dx, dz] of Object.values(fronts)) queue.push({ x: p.x + dx, y: p.y, z: p.z + dz });
      }
      const center = members.length ? members.reduce((p, s) => ({ x: p.x + s.location.x / members.length,
        y: p.y + s.location.y / members.length, z: p.z + s.location.z / members.length }), { x: 0, y: 0, z: 0 }) : control.location;
      return { control, members, center, yaw: { north: 0, east: -90, south: 180, west: 90 }[facing] };
    });
}

// Rotate around the control's model-Z hinge. Model Z is mirrored in physics.
export function airplaneSailPose(local, pivot, yaw, angle) {
  const y = yaw * Math.PI / 180, r = -angle * Math.PI / 180;
  const cy = Math.cos(y), sy = Math.sin(y), cr = Math.cos(r), sr = Math.sin(r);
  const dx = local.x - pivot.x, dy = local.y - pivot.y, dz = local.z - pivot.z;
  const x = dx * cy - dz * sy, z = dx * sy + dz * cy;
  const rx = x * cr - dy * sr, ry = x * sr + dy * cr;
  return { location: { x: pivot.x + rx * cy + z * sy, y: pivot.y + ry, z: pivot.z - rx * sy + z * cy },
    rotation: { x: 0, y: yaw, z: -90 - angle }, yaw: 0 };
}

export function wingDeflection(group, throttle, input) {
  const forward = forwardFor(throttle.permutation.getState("minecraft:cardinal_direction"));
  const right = { x: forward.z, y: 0, z: -forward.x };
  const side = (group.center.x - throttle.location.x) * right.x + (group.center.z - throttle.location.z) * right.z;
  const radians = group.yaw * Math.PI / 180;
  const hinge = { x: Math.sin(radians), y: 0, z: Math.cos(radians) };
  const orientation = dot(hinge, right);
  // Mirrored controls have opposite local axes: compensate for that orientation.
  return input * 30 * (side < 0 ? -1 : 1) * (orientation < -0.01 ? -1 : 1);
}

// Bounded flight assistance, scaled by forward airspeed and available wing area.
// At rest there is no lift or steering torque. Banking tilts the lift vector.
export function hasSymmetricWings(groups, throttle) {
  const wings = groups.filter(g => g.members.length > 0);
  if (wings.length < 2) return false;
  const forward = forwardFor(throttle.permutation.getState("minecraft:cardinal_direction"));
  const right = { x: forward.z, y: 0, z: -forward.x };
  const sides = wings.map(g => dot(g.control.location, right));
  const min = Math.min(...sides), max = Math.max(...sides);
  if (max - min < 1) return false;
  const middle = (min + max) / 2;
  const project = p => [dot(p,right)-middle, p.y, dot(p,forward)];
  const mirrored = points => {
    const keys = new Set(points.map(p => p.join(",")));
    return points.every(([x,y,z]) => keys.has([-x,y,z].join(",")));
  };
  return mirrored(wings.map(g => project(g.control.location))) &&
    mirrored(wings.flatMap(g => g.members.map(s => project(s.location))));
}

export function flightForces({ input, pitchInput = 0, poweredWings = false, verticalTakeoff = false, liftEnabled = true, enginePower = 1, flightMode = false, grounded = false, stableWings = false, headingError = 0, velocity, angularVelocity, forward, right, up, mass, area, blockCount, span, ropeDownwardLoad = 0 }) {
  const speed = Math.max(0, dot(velocity, forward));
  const authority = clamp((speed - 0.4) / 2.6, 0, 1);
  const wingLoading = clamp(area * 2 / Math.max(1, blockCount), 0, 1);
  // Let the landing gear support the airframe instead of fighting it with
  // airborne leveling torque. Retain some authority during powered takeoff.
  const groundAuthority = grounded ? (flightMode ? 0.35 : 0) : 1;
  const stabilizationAuthority = authority * groundAuthority;
  const airspeedLift = verticalTakeoff && poweredWings && enginePower > 0 ? 1 : clamp(speed * speed / (AIRPLANE_TAKEOFF_SPEED * AIRPLANE_TAKEOFF_SPEED), 0, 1);
  const baseLift = !liftEnabled ? 0 : poweredWings
    ? (flightMode ? mass * clamp(11 + (pitchInput * 3 - velocity.y) * 2, 0, 17) * airspeedLift / Math.max(0.5, up.y) : 0)
    : mass * 9.81 * clamp(speed * speed / 10.24, 0, 1.4) * wingLoading;
  const payloadCapacity = mass * 9.81 * wingLoading * clamp(enginePower, 0, 1);
  const payloadLift = liftEnabled && poweredWings && flightMode && up.y > 0.5
    ? Math.min(Math.max(0, ropeDownwardLoad), payloadCapacity) * airspeedLift / up.y : 0;
  const lift = baseLift + payloadLift;
  const bank = Math.atan2(-right.y, up.y);
  const turnRate = flightMode ? clamp(9.81 * Math.tan(clamp(bank, -0.6, 0.6)) / Math.max(speed, 2), -0.55, 0.55) * authority : 0;
  const stabilizing = stableWings && Math.abs(input) < 0.01;
  // Request up to 45 degrees of bank; authority fades this out at low speed.
  // Assisted yaw and lateral force retain their coordinated, bounded turn rate.
  const maxBank = 45 * Math.PI / 180;
  const targetBank = flightMode ? input * maxBank * authority : 0;
  const targetRoll = clamp((bank - targetBank) * 1.6, -0.5, 0.5);
  const rollError = targetRoll - (dot(angularVelocity, forward) - turnRate * forward.y);
  const inertiaScale = mass * clamp(span * span / 8, 0.5, 12);
  const rollTorque = clamp(rollError * (stabilizing ? 3 : 2), -1.2, 1.2) * inertiaScale * stabilizationAuthority * (stabilizing ? 1 : wingLoading);
  const horizontalLength = Math.hypot(forward.x, forward.z) || 1;
  const turnRight = { x: forward.z / horizontalLength, y: 0, z: -forward.x / horizontalLength };
  const sideSpeed = dot(velocity, turnRight);
  const holdingHeading = stabilizing && Math.abs(bank) < 3 * Math.PI / 180;
  const desiredYaw = turnRate + sideSpeed * 0.1 + (holdingHeading ? headingError * 0.8 : 0);
  const yawTorque = clamp((desiredYaw - angularVelocity.y) * 1.8, -0.7, 0.7) * inertiaScale * authority * groundAuthority;
  // Positive pitch input raises the nose around the aircraft's right axis.
  const desiredPitch = (flightMode ? pitchInput : 0) * 35 * Math.PI / 180;
  const pitchError = desiredPitch - Math.asin(clamp(forward.y, -1, 1));
  const pitchTorque = clamp(-pitchError * 1.8 - (dot(angularVelocity, right) - turnRate * right.y) * 1.4, -0.8, 0.8) * inertiaScale * stabilizationAuthority * (stableWings ? 1 : wingLoading);
  const drag = mass * speed * 0.025 * authority;
  const cruiseSpeed = grounded ? 5 : 5.8;
  const drive = poweredWings ? mass * clamp((cruiseSpeed - speed) * 1.2, 0, 4) * clamp(enginePower, 0, 1) : 0;
  const lateral = -sideSpeed * mass * authority * 0.65;
  // In assisted flight the lift's horizontal component follows the same turn
  // rate as the nose, avoiding a sideways shove faster than the aircraft yaws.
  const assistedTurn = poweredWings && flightMode;
  const turnForce = mass * speed * turnRate;
  const liftX = assistedTurn ? turnRight.x * turnForce : up.x * lift;
  const liftZ = assistedTurn ? turnRight.z * turnForce : up.z * lift;
  return {
    liftAcceleration: Math.max(0, up.y * lift / Math.max(0.001, mass)),
    force: { x: liftX + forward.x * (drive - drag) + turnRight.x * lateral, y: up.y * lift + forward.y * (drive - drag), z: liftZ + forward.z * (drive - drag) + turnRight.z * lateral },
    torque: { x: forward.x * rollTorque + right.x * pitchTorque, y: forward.y * rollTorque + yawTorque + right.y * pitchTorque, z: forward.z * rollTorque + right.z * pitchTorque }
  };
}
