/* CLAUDE-MAP-BEGIN
 FILE: blocks/rz_air_mode.js  (5 KB, 84 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (auto, from first comment) RZ Lite: самолёт как в RZ - без блока газа и без блоков управления крылом (рулей).
 IMPORTS: blocks/symmetric_sails.js
 IMPORTED BY: blocks/airplane_flight.js, blocks/propeller_bearing.js, blocks/rz_air_control.js, blocks/rz_air_rig.js, blocks/vehicle_systems.js
 EXPORTS: PROP_SPEC, PROP_SIZE, RZ_PROP_IDS, AIRCFG, propAxis, rzAirInfo, rzSymmetric, rzVirtualThrottle
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): rzAirInfo@39(17L); rzVirtualThrottle@70(14L); rzSymmetric@58(10L); propAxis@24(5L); isHorizontalSail@29(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// RZ Lite: самолёт как в RZ - без блока газа и без блоков управления крылом (рулей).
// Нужны: кресло водителя, крылья (create_physics:symmetric_sail*, горизонтальные = лежат при установке с приседанием)
// и винт RZ (aero:block__smart_propeller__*). Управление с кресла: W/S тангаж, A/D крен, пробел - завести/заглушить винт.
// Остальная физика полёта общая с CM (airplane_flight.js / airplane_math.js flightForces).
import { SYMMETRIC_SAIL_IDS } from "./symmetric_sails.js";

// шаг 132: характеристики винтов. eff - множитель тяги, spd - доля предельной скорости (MAX_KMH), cap - сколько массы (в единицах RZ, см. rz_block_mass.js:
// шерсть 0.2, дерево 0.65, железный блок 7.9) винт тянет на полной тяге. Несколько винтов складывают cap. Выше cap тяга падает (AIR.OVERLOAD_MAX).
// reversed (малый): шерсть и дерево. medium: дерево + немного железа. large: смесь дерева и железа. huge: железные конструкции.
export const PROP_SPEC = new Map([
  ["aero:block__smart_propeller__propeller_reversed", { eff: 1, cap: 30, spd: 0.80 }],
  ["aero:block__smart_propeller__propeller_medium", { eff: 1.7, cap: 80, spd: 0.86 }],
  ["aero:block__smart_propeller__propeller_large", { eff: 2.6, cap: 160, spd: 0.93 }],
  ["aero:block__smart_propeller__propeller_huge", { eff: 4.2, cap: 340, spd: 1.0 }]
]);
export const PROP_SIZE = new Map([...PROP_SPEC].map(([k, v]) => [k, v.eff]));
export const RZ_PROP_IDS = new Set([...PROP_SPEC.keys()]);
export const AIRCFG = {
  THRUST_INV: true,   // как в RZ: тяга винта направлена против оси facing_direction (/scriptevent rzlite:air thrust_inv)
  PROP_INV: false,    // крутить винт в обратную сторону (/scriptevent rzlite:air prop_inv)
  SPIN: 36            // градусов за физический шаг при полной тяге (CM-ротор: 36)
};
const FACE = { up: [0, 1, 0], down: [0, -1, 0], north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0] };
export const propAxis = snapshot => {
  let f; try { f = snapshot.permutation.getState("minecraft:facing_direction"); } catch {}
  const a = FACE[f] ?? FACE.up;
  return { x: a[0], y: a[1], z: a[2] };
};
const isHorizontalSail = s => SYMMETRIC_SAIL_IDS.has(s.typeId) && s.permutation.getState("create_physics:horizontal") === true;

/** Состояние-заменитель блока: умеет getState/withState как BlockPermutation. */
class VirtualPermutation {
  constructor(states) { this.states = states; }
  getState(name) { return this.states[name]; }
  withState(name, value) { return new VirtualPermutation({ ...this.states, [name]: value }); }
}

/** Разбор конструкции: винты, горизонтальные крылья, направление тяги, симметрия. Считается при смене состава блоков. */
export function rzAirInfo(snapshots) {
  const props = snapshots.filter(s => RZ_PROP_IDS.has(s.typeId));
  const sails = snapshots.filter(isHorizontalSail);
  let tx = 0, tz = 0;
  for (const p of props) {
    const a = propAxis(p), sign = AIRCFG.THRUST_INV ? -1 : 1;
    tx += a.x * sign; tz += a.z * sign;   // вертикальная ось (up/down) тягу вперёд не даёт
  }
  const len = Math.hypot(tx, tz);
  const thrust = len > 0.001 ? { x: tx / len, y: 0, z: tz / len } : undefined;
  const sum = sails.reduce((r, s) => ({ x: r.x + s.location.x, y: r.y + s.location.y, z: r.z + s.location.z }), { x: 0, y: 0, z: 0 });
  const n = Math.max(1, sails.length);
  const center = sails.length ? { x: sum.x / n, y: sum.y / n, z: sum.z / n }
    : props.length ? props[0].location : { x: 0, y: 0, z: 0 };
  const group = { control: { location: center, airplaneCurrentAngle: 0, virtual: true }, members: sails, center, yaw: 0 };
  return { props, sails, thrust, center, groups: [group] };
}

/** Крылья симметричны относительно продольной оси (нужно для самостабилизации по крену). */
export function rzSymmetric(info, forward) {
  if (!info.sails.length || !forward) return false;
  const right = { x: forward.z, z: -forward.x };
  const pts = info.sails.map(s => [s.location.x * right.x + s.location.z * right.z, s.location.y, s.location.x * forward.x + s.location.z * forward.z]);
  const xs = pts.map(p => p[0]), min = Math.min(...xs), max = Math.max(...xs);
  if (max - min < 1) return false;
  const mid = (min + max) / 2, r = v => Math.round(v * 100) / 100;
  const keys = new Set(pts.map(p => `${r(p[0] - mid)},${r(p[1])},${r(p[2])}`));
  return pts.every(p => keys.has(`${r(-(p[0] - mid))},${r(p[1])},${r(p[2])}`));
}

/** Блок газа, которого нет в мире: состояния берутся из session.rzAirCtl (его пишет rz_air_control.js). */
export function rzVirtualThrottle(session, info) {
  const ctl = session.rzAirCtl ?? {};
  const f = info.thrust ?? { x: 0, z: 1 };
  const facing = Math.abs(f.x) > Math.abs(f.z) ? (f.x > 0 ? "east" : "west") : (f.z > 0 ? "south" : "north");
  return { typeId: "create_physics:airplane_throttle", virtual: true, location: info.center,
    permutation: new VirtualPermutation({
      "minecraft:cardinal_direction": facing,
      "create_physics:airplane_roll": ctl.roll ?? 0,
      "create_physics:airplane_pitch": ctl.pitch ?? 0,
      "create_physics:propeller_on": ctl.on === true,
      "create_physics:airplane_active": true,
      "create_physics:flight_mode": ctl.on === true
    }) };
}
