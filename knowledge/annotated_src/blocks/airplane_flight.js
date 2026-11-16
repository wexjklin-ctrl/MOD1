/* CLAUDE-MAP-BEGIN
 FILE: blocks/airplane_flight.js  (13 KB, 182 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: Aircraft flight model.
 IMPORTS: blocks/airplane_math.js, blocks/airplane_stop.js, blocks/airplane_takeoff.js, blocks/airplane_throttle.js, blocks/propeller_bearing.js, blocks/rz_air_mode.js, blocks/rz_air_rig.js, blocks/rz_drive.js, blocks/rz_flap_pose.js, blocks/vehicle_systems.js
 IMPORTED BY: main.js
 EXPORTS: addAirplaneFlight
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): addAirplaneFlight@17(140L); rzFlight@160(22L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { airplaneStoppingForce, restrictUnpoweredFlight } from "./airplane_stop.js";
import { airplaneTakeoffState } from "./airplane_takeoff.js";
import { AIRPLANE_THROTTLE, ACTIVE_STATE, ROLL_STATE, airplaneGroups, airplaneSailPose,
  wingDeflection, flightForces, forwardFor, bearingPushDirection, hasSymmetricWings, clamp, key } from "./airplane_math.js";
import { setAirplaneVisualAngles } from "./airplane_throttle.js";
import { propellerGroups } from "./propeller_bearing.js";
import { rzAirplane, DRIVE as RZ_DRIVE } from "./rz_drive.js"; // RZ Lite
import { rzAirFly, rzForward2, RZ_AIR_LITE } from "./rz_air_rig.js"; // RZ Lite: модель полёта RZ (AirRig)
import { AIRCFG, rzAirInfo, rzVirtualThrottle, rzSymmetric } from "./rz_air_mode.js"; // RZ Lite: самолёт с кресла без блока газа и рулей
import { vehicleSystems } from "./vehicle_systems.js";
import { stepFlapPoses } from "./rz_flap_pose.js"; // шаг 137: визуальное отклонение рулей

// RZ Lite: рули высоты RZ (sim:block__*_symmetric_sail). Без них самолёт летает как в CM (множитель 1).
// С рулями отклик тангажа зависит от их числа: 1 руль = 0.85, 2 = 1.0, 4+ = 1.25 (приближение к пластинам RZ).
const RZ_ELEVATORS = new Set(["sim:block__black_symmetric_sail", "sim:block__brown_symmetric_sail", "sim:block__gray_symmetric_sail", "sim:block__white_symmetric_sail", "sim:block__light_gray_symmetric_sail", "sim:block__red_symmetric_sail", "sim:block__orange_symmetric_sail", "sim:block__yellow_symmetric_sail", "sim:block__lime_symmetric_sail", "sim:block__green_symmetric_sail", "sim:block__cyan_symmetric_sail", "sim:block__light_blue_symmetric_sail", "sim:block__blue_symmetric_sail", "sim:block__purple_symmetric_sail", "sim:block__magenta_symmetric_sail", "sim:block__pink_symmetric_sail", "sim:block__copper_symmetric_sail", "sim:block__iron_symmetric_sail", "sim:block__netherite_symmetric_sail"]);

export function addAirplaneFlight(session, transforms) {
  session.airplaneWingDriveActive = false;
  session.airplaneHandlesPropulsion = false;
  session.airplaneLiftAcceleration = 0;
  session.airplaneGroundForward = undefined;
  const assembly = session.assembly;
  if (!assembly?.isValid || session.streamingMotion) return;
  if (session.airplaneTopology !== session.snapshots || session.airplaneCount !== session.snapshots.length || session.airplaneAssembly !== assembly || session.rzThrustInv !== AIRCFG.THRUST_INV) {
    session.rzThrustInv = AIRCFG.THRUST_INV;
    session.airplaneTopology = session.snapshots;
    session.airplaneCount = session.snapshots.length;
    session.airplaneAssembly = assembly;
    session.airplaneGroups = airplaneGroups(session.snapshots);
    session.airplanePropellers = propellerGroups(session.snapshots);
    session.airplaneThrottles = session.snapshots.filter(s => s.typeId === AIRPLANE_THROTTLE);
    session.rzAirInfo = vehicleSystems(session).rzAir ? rzAirInfo(session.snapshots) : undefined;   // RZ Lite
    if (!session.rzAirInfo) { session.rzRig = undefined; session.rzRigTopo = undefined; session.rzRigKey = undefined; }   // RZ Lite: модель RZ только для самолёта RZ
    session.airplaneElevators = session.snapshots.filter(s => RZ_ELEVATORS.has(s.typeId)).length;
    session.airplaneSymmetryKey = undefined;
    session.airplaneTakeoff = undefined;
  }
  if (session.rzAirInfo) { rzFlight(session); return; }   // RZ Lite: самолёт RZ летит по AirRig, формулы CM не используются
  const rzInfo = session.rzAirInfo;   // RZ Lite: есть = самолёт RZ (кресло + винт + крылья), блок газа и рули не нужны
  const throttles = rzInfo ? [rzVirtualThrottle(session, rzInfo)] : session.airplaneThrottles;
  const throttle = throttles.find(s => s.permutation.getState(ACTIVE_STATE) === true) ?? throttles[0];
  const propulsion = rzInfo ? rzInfo.thrust : bearingPushDirection(session.airplanePropellers.map(group => group.bearing));
  const facing = propulsion ? (Math.abs(propulsion.x) > Math.abs(propulsion.z) ? (propulsion.x > 0 ? "east" : "west") : (propulsion.z > 0 ? "south" : "north")) : undefined;
  const pilot = throttle && facing ? { ...throttle, permutation: throttle.permutation.withState("minecraft:cardinal_direction", facing) } : throttle;
  const requestedInput = throttle ? clamp(Number(throttle.permutation.getState(ROLL_STATE)) || 0, -3, 3) / 7 : 0;
  session.airplaneSmoothRoll = (session.airplaneSmoothRoll ?? 0) + (requestedInput-(session.airplaneSmoothRoll ?? 0))*0.2;
  const input = Math.abs(requestedInput-session.airplaneSmoothRoll)<0.001 ? requestedInput : session.airplaneSmoothRoll;
  const local = p => ({ x: p.x - session.location.x, y: p.y - session.location.y, z: p.z - session.location.z });
  const angles = new Map(rzInfo ? [] : throttles.map(t => [key(local(t.location)), t === throttle ? input * 30 : 0]));
  let area = 0, span = 1, deflectedInput = 0;
  for (const group of (rzInfo ? rzInfo.groups : session.airplaneGroups)) {
    if (rzInfo) {   // RZ Lite: крылья неподвижны, рулей нет - крен задаёт сама модель полёта
      area += group.members.length;
      deflectedInput += input * group.members.length;
      for (const sail of group.members) span = Math.max(span, Math.hypot(sail.location.x - throttle.location.x, sail.location.z - throttle.location.z) * 2);
      continue;
    }
    const target = pilot ? wingDeflection(group, pilot, input) : 0;
    const previous = group.control.airplaneCurrentAngle ?? 0;
    const angle = previous + clamp(target - previous, -2, 2);
    group.control.airplaneCurrentAngle = angle;
    if (throttle && group.members.length) {
      deflectedInput += angle / wingDeflection(group, pilot, 1) * group.members.length;
    }
    const pivot = local(group.control.location);
    angles.set(key(pivot), angle);
    for (const sail of group.members) {
      const center = local(sail.location);
      transforms.set(key(center), airplaneSailPose(center, pivot, group.yaw, angle));
      area++;
      if (throttle) span = Math.max(span, Math.hypot(sail.location.x - throttle.location.x, sail.location.z - throttle.location.z) * 2);
    }
  }
  setAirplaneVisualAngles(session, angles);
  if (!throttle || area === 0) { session.airplaneEnginePower = 0; return; }
  session.airplaneHandlesPropulsion = true;
  const body = assembly.body;
  const origin = body.localPointToWorld({ x: 0, y: 0, z: 0 });
  const worldVector = vector => {
    const point = body.localPointToWorld(vector);
    return { x: point.x - origin.x, y: point.y - origin.y, z: point.z - origin.z };
  };
  const forward = propulsion ?? forwardFor(throttle.permutation.getState("minecraft:cardinal_direction"));
  session.airplaneGroundForward = forward;
  const rzAir = rzAirplane(session);   // RZ Lite: undefined = нет двигателей RZ (режим CM)
  const engineOn = throttle.permutation.getState("create_physics:propeller_on") === true &&
    propulsion !== undefined && (rzAir === undefined || rzAir.ok);
  // Three-second spool-up at 20 physics steps/s; switching off cuts thrust.
  session.airplaneEnginePower = engineOn ? Math.min(rzAir ? rzAir.cap : 1, (session.airplaneEnginePower ?? 0) + 1 / 60) : 0;
  session.airplaneWingDriveActive = engineOn;
  const worldForward = worldVector(forward);
  session.airplaneTakeoff=airplaneTakeoffState(session.airplaneTakeoff,{
    engineOn,grounded:session.airplaneWheelGroundContact === true,
    position:origin,velocity:body.velocity,forward:worldForward
  });
  const canLift = engineOn && session.airplaneTakeoff.ready;
  const runwayRoll = engineOn && session.airplaneTakeoff.groundRoll && !canLift;
  const runwayLength=Math.hypot(worldForward.x,worldForward.z) || 1;
  // Keep thrust horizontal until the aircraft has completed its ground roll.
  const thrustForward=runwayRoll ? {x:worldForward.x/runwayLength,y:0,z:worldForward.z/runwayLength} : worldForward;
  const symmetryKey = `${key(throttle.location)}|${forward.x},${forward.z}`;
  if (session.airplaneSymmetryKey !== symmetryKey) {
    session.airplaneSymmetryKey = symmetryKey;
    session.airplaneSymmetric = rzInfo ? rzSymmetric(rzInfo, forward) : hasSymmetricWings(session.airplaneGroups, pilot);
  }
  const stableWings = engineOn && session.airplaneSymmetric;
  const directionKey = `${forward.x},${forward.z}`;
  if (session.airplanePushDirection !== directionKey) {
    session.airplanePushDirection = directionKey;
    session.airplaneHeading = undefined;
  }
  const requestedPitch = clamp(Number(throttle.permutation.getState("create_physics:airplane_pitch")) || 0, -7, 7) / 7;
  const elevatorGain = session.airplaneElevators > 0 ? clamp(0.7 + 0.15 * session.airplaneElevators, 0.85, 1.25) : 1;   // RZ Lite
  session.airplaneSmoothPitch = (session.airplaneSmoothPitch ?? 0) + (requestedPitch*elevatorGain-(session.airplaneSmoothPitch ?? 0))*0.2;
  const pitchInput = Math.abs(requestedPitch*elevatorGain-session.airplaneSmoothPitch)<0.001 ? requestedPitch*elevatorGain : session.airplaneSmoothPitch;
  const worldRight = worldVector({ x: forward.z, y: 0, z: -forward.x });
  const worldUp = worldVector({ x: 0, y: 1, z: 0 });
  const bank = Math.atan2(-worldRight.y, worldUp.y);
  if (!stableWings || Math.abs(input) > 0.01 || Math.abs(pitchInput) > 0.01 ||
      Math.abs(bank) > 3 * Math.PI / 180 || Math.abs(body.angularVelocity.y) > 0.1) session.airplaneHeading = undefined;
  else session.airplaneHeading ??= { x: worldForward.x, z: worldForward.z };
  const heading = session.airplaneHeading;
  const headingError = heading ? Math.atan2(heading.x * worldForward.z - heading.z * worldForward.x,
    heading.x * worldForward.x + heading.z * worldForward.z) : 0;
  const forces = flightForces({ input: clamp(deflectedInput / area, -1, 1),
    poweredWings: engineOn,
    verticalTakeoff: engineOn,
    liftEnabled: canLift,
    enginePower: session.airplaneEnginePower,
    stableWings, headingError,
    grounded: session.airplaneWheelGroundContact === true,
    flightMode: canLift,
    pitchInput,
    velocity: body.velocity, angularVelocity: body.angularVelocity,
    forward: thrustForward, right: worldRight,
    up: worldUp, mass: body.getMass(), area, blockCount: session.snapshots.length, span,
    ropeDownwardLoad: session.ropeDownwardLoad ?? 0 });
  if (!engineOn) {
    const grounded = session.airplaneWheelGroundContact === true;
    // The wheel contact pass handles ground braking with the current contacts.
    // Keep air drag here so stale landing contact cannot brake an airborne plane.
    const stopping = airplaneStoppingForce(body.velocity,body.getMass(),false);
    forces.force.x += stopping.x;
    forces.force.y += stopping.y;
    forces.force.z += stopping.z;
    if (grounded && Math.hypot(body.velocity.x,body.velocity.z) < 0.03) {
      body.setVelocity({x:0,y:body.velocity.y,z:0});
    }
  }
  restrictUnpoweredFlight(forces,engineOn,session.airplaneWheelGroundContact === true);
  session.airplaneLiftAcceleration = forces.liftAcceleration;
  if (Math.hypot(forces.force.x, forces.force.y, forces.force.z) > 0.0001) {
    body.applyForceAt(body.localPointToWorld(body.getCenterOfMass()), forces.force);
  }
  if (Math.hypot(forces.torque.x, forces.torque.y, forces.torque.z) > 0.0001) body.applyTorque(forces.torque);
}

// RZ Lite: полёт самолёта RZ. Ввод пилота пишет rz_air_control.js в session.rzAirCtl (W/S тангаж и A/D крен без округления,
// пробел - рычаг тяги 0/1). Без пилота ввод null: тяга гаснет, рули в ноль, как в RZ (vehicles.js).
function rzFlight(session) {
  const info = session.rzAirInfo, body = session.assembly.body;
  setAirplaneVisualAngles(session, new Map());
  session.airplaneTakeoff = undefined;
  const fwd2 = rzForward2(info.thrust);
  if (!fwd2) { session.airplaneEnginePower = 0; session.airplaneWingDriveActive = false; session.airplaneHandlesPropulsion = false; return; }
  const ctl = session.rzAirCtl, pilot = session.rzAirPilotId !== undefined;
  const inp = pilot ? { thr: ctl?.on ? (ctl.lever ?? 1) : 0, pitch: ctl?.fp ?? 0, roll: ctl?.fr ?? 0 } : null;
  const eng = session.rz?.info ? rzAirplane(session) : undefined;
  const drive = eng ? { acc: session.rz.accel, vlim: session.rz.vmax, powered: eng.ok }
    : RZ_DRIVE.REQUIRE_ENGINE ? { acc: 0, vlim: 0, powered: false }
    : { acc: RZ_AIR_LITE.FALLBACK_ACC, vlim: RZ_AIR_LITE.FALLBACK_VMAX, powered: true };
  if (pilot && ctl?.on && body.isSleeping) body.wakeUp();
  const rig = rzAirFly(session, body, fwd2, inp, drive);
  stepFlapPoses(session, rig);   // шаг 137: рули высоты/направления отклоняются как в модели полёта (только вид)
  session.rzDrivePowered = drive.powered;
  session.airplaneHandlesPropulsion = true;
  session.airplaneEnginePower = rig.thr;
  session.airplaneWingDriveActive = rig.thr > 0.01 && drive.powered;
  session.airplaneGroundForward = { x: fwd2[0], y: 0, z: fwd2[1] };
  session.airplaneLiftAcceleration = Math.max(0, session.rzLiftAcc ?? 0);
}
