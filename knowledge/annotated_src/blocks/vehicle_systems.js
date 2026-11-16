/* CLAUDE-MAP-BEGIN
 FILE: blocks/vehicle_systems.js  (2 KB, 51 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: blocks/hot_air_envelope.js, blocks/rz_air_mode.js, blocks/symmetric_sails.js
 IMPORTED BY: blocks/aircraft_motion.js, blocks/airplane_flight.js, blocks/balloon_flight.js, blocks/car_drive.js, blocks/propeller_bearing.js, blocks/rz_air_control.js, blocks/rz_air_lever.js, blocks/rz_drive.js, main.js
 EXPORTS: vehicleSystems, vehicleSessions, airEngineOn
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): vehicleSystems@7(30L); vehicleSessions@39(5L); airEngineOn@46(5L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { isHotAirEnvelope } from "./hot_air_envelope.js";
import { SYMMETRIC_SAIL_IDS } from "./symmetric_sails.js";
import { RZ_PROP_IDS } from "./rz_air_mode.js";

const layouts = new WeakMap();

export function vehicleSystems(session) {
  const cached = layouts.get(session);
  if (cached?.snapshots === session.snapshots && cached.count === session.snapshots.length && cached.blocks === session.assembly?.blocks) return cached;
  const result = { snapshots: session.snapshots, count: session.snapshots.length, blocks: session.assembly?.blocks,
    car: false, airplane: false, balloon: false, articulated: false, propeller: false, burners: [], envelopes: 0,
    rzProp: false, rzAir: false, throttle: false };   // RZ Lite: rzProp = есть винт RZ, rzAir = самолёт с кресла (винт + крылья, без блока газа)
  let sails = 0;
  for (const snapshot of session.snapshots) {
    if (isHotAirEnvelope(snapshot.typeId)) { result.envelopes++; continue; }
    if (RZ_PROP_IDS.has(snapshot.typeId)) { result.rzProp = true; continue; }
    if (SYMMETRIC_SAIL_IDS.has(snapshot.typeId)) { sails++; continue; }
    switch (snapshot.typeId) {
      case "create_physics:steering_contro_wheel": result.car = true; break;
      case "create_physics:wheel_mount":
      case "create_physics:wheel_mount_iron":
      case "create_physics:wheel_mount_netherite": result.car = true; break;   // RZ Lite: машина и без рулевого блока (водитель = кресло)
      case "create_physics:airplane_throttle": result.articulated = true; break;   // шаг 138: пульт башни, самолётом больше не делает
      case "create_physics:hot_air_burner": result.balloon = true; result.burners.push(snapshot); break;
      case "create_physics:guiding_wind":
      case "create_physics:propeller_bearing":
      case "create_physics:airplane_wing_control": result.articulated = true; break;
      case "create_physics:andesite_propeller": result.propeller = true; break;
    }
  }
  if (result.rzProp) result.articulated = true;
  if (session.towerRoot) result.articulated = true;   // шаг 138: башня-основание
  if (result.rzProp && sails > 0 && !result.throttle) result.airplane = result.rzAir = true;
  layouts.set(session, result);
  return result;
}

// A structure can use several systems, such as an airplane with landing wheels.
export function* vehicleSessions(sessions, system) {
  for (const session of sessions) {
    if (session.assembly?.isValid && vehicleSystems(session)[system]) yield session;
  }
}

// RZ Lite: двигатель самолёта включён (блок газа CM или пробел с кресла в режиме RZ)
export function airEngineOn(session) {
  const v = vehicleSystems(session);
  if (v.rzAir) return session.rzAirCtl?.on === true;
  return session.snapshots.some(s => s.typeId === "create_physics:airplane_throttle" && s.permutation.getState("create_physics:propeller_on") === true);
}
