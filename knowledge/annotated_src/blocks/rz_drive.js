/* CLAUDE-MAP-BEGIN
 FILE: blocks/rz_drive.js  (42 KB, 657 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: RZ Lite drive: throttle/steering/gearbox for ground vehicles; kinematic velocity control; scriptevent rzlite:drive.
 IMPORTS: @minecraft/server, blocks/rz_block_mass.js, blocks/rz_hud.js, blocks/rz_sound.js, blocks/vehicle_systems.js, blocks/wheel_mount_ids.js
 IMPORTED BY: blocks/airplane_flight.js, blocks/car_drive.js, main.js
 EXPORTS: FUEL_ITEM, BURNER_ID, STEAM_TANK_ID, STEAM_ENGINE_ID, SHAFT_ID, RADIATOR_ID, FUEL_TANK_ID, GEARBOX_IDS, ENGINES, DRIVE, STEAM, clusterMult, rzMarkTrackBroken, analyze, stepRzDrive, rzCarDrive, rzCanDrive, rzTrackTurnScale, rzAirplane, rzInteract, installRzDrive
 EVENTS: scriptEventReceive
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): build@161(207L); stepRzDrive@405(70L); rzInteract@566(45L); installRzDrive@624(33L); rzHud@476(24L); loadStore@80(11L); saveStore@91(11L); analyze@149(11L); rzCarDrive@516(11L); hud@501(10L); reportLines@613(10L); axisOf@109(8L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { isWheelMountId } from "./wheel_mount_ids.js";
// RZ Lite: привод RZ (двигатели -> редукторы -> валы -> колёса/пропеллер, топливо, перегрев, пар) поверх тяги CreateMovement.
// Порт логики core/drivetrain.js, core/fuel.js, core/steam.js (упрощённо) из RZ Physics. НЕ проверено в игре.
//
// Правило включения: если в конструкции есть хотя бы один блок двигателя RZ -> «режим двигателя»: тяга CM масштабируется
// мощностью/топливом RZ. Нет двигателей RZ -> всё работает как в CM (машины CM без двигателей не ломаются).
//
// Точки подключения (всё остальное в CM не менялось):
//   car_drive.js      : rzCarDrive(session, cmTarget)  - предел скорости и ускорение машины;
//   airplane_flight.js: rzAirplane(session)           - разрешение работы двигателя самолёта и предел тяги;
//   main.js           : stepRzDrive() раз в тик (топливо/нагрев/пар), rzInteract() (заправка ПКМ), HUD.
import { sendHud, installRzHud } from "./rz_hud.js";
import { RZW, rzBlockMass } from "./rz_block_mass.js";
import { vehicleSystems, airEngineOn } from "./vehicle_systems.js";
import { rzEngineSound, rzEngineSoundCleanup, installRzSound } from "./rz_sound.js";
import { world, system, GameMode, ItemStack, EntityComponentTypes, EquipmentSlot } from "@minecraft/server";

export const FUEL_ITEM = "phys:fuel_bucket";
export const BURNER_ID = "phys:blaze_burner";
export const STEAM_TANK_ID = "phys:fluid_tank";
export const STEAM_ENGINE_ID = "phys:steam_engine";
export const SHAFT_ID = "phys:shaft";
export const RADIATOR_ID = "phys:radiator";
export const FUEL_TANK_ID = "phys:fuel_tank";
export const GEARBOX_IDS = new Set(["tfmg:steel_gearbox", "tfmg:engine_gearbox"]);
const PROP_IDS = new Set(["aero:block__smart_propeller__propeller_reversed", "aero:block__smart_propeller__propeller_medium", "aero:block__smart_propeller__propeller_large", "aero:block__smart_propeller__propeller_huge",
  "create_physics:propeller_bearing", "create_physics:andesite_propeller"]);

/** Двигатели RZ (значения из drivetrain.js RZ). power - «л.с.», heat - тепло, speed - множитель скорости, mass - масса блока, fuel - л/с на двигатель при полном газе. */
export const ENGINES = {
  "tfmg:simple_large_engine": { power: 180, heat: 1.0, speed: 1.1, scalable: false, mass: 2.0, fuel: 0.025 },
  "tfmg:large_engine": { power: 260, heat: 1.5, speed: 1.2, scalable: true, axis: "any", gain: 0.8, decay: 0.6, max: 6, mass: 2.5, fuel: 0.040 },
  "cdg:diesel_engine": { power: 150, heat: 0.9, speed: 1.1, scalable: true, axis: "line", gain: 0.85, decay: 0.8, max: 6, mass: 1.4, fuel: 0.018 },
  "cdg:modular_diesel_engine": { power: 300, heat: 1.7, speed: 1.25, scalable: true, axis: "line", gain: 0.9, decay: 0.75, max: 4, mass: 2.4, fuel: 0.045 },
  [STEAM_ENGINE_ID]: { power: 130, heat: 0, speed: 1.0, scalable: true, axis: "none", mass: 1.5, fuel: 0, steam: true },
};
const BLOCK_MASS = { [SHAFT_ID]: 0.15, [RADIATOR_ID]: 0.7, [FUEL_TANK_ID]: 0.8, [BURNER_ID]: 1.2, [STEAM_TANK_ID]: 1.0,
  "tfmg:steel_gearbox": 1.0, "tfmg:engine_gearbox": 0.9 };

/** Тюнинг: /scriptevent rzlite:drive set <KEY> <число> (сохраняется в мире). */
export const DRIVE = {
  ACCEL_K: 3.0, ACCEL_MAX: 18, RAD_COOL: 1.0, AMBIENT: 0.15, IDLE_HEAT: 0.35, HEAT_SECONDS: 60, COOL_SECONDS: 40, HEAT_LOSS: 0.6,
  FUEL_ENABLED: 1, BUCKET_L: 20, TANK_PER_ENGINE: 40, TANK_PER_BLOCK: 60, FUEL_K: 1.0, IDLE_FUEL: 0.06, MASS_REF: 10, MASS_FUEL: 0.3,
  SPEED_CAP: 55, SPEED_R0: 18, TRK_SPEED_KMH: 22, TRK_WHEEL_BONUS: 0.3, MAX_REVERSE: 6,
  TRK_TURN_REF: 6,   // гусеницы: ускорение привода (м/с^2), при котором разворот на месте полный; тяжёлая машина со слабым двигателем крутится медленнее
  MASS_SCALE: 1.0,   // множитель оценки массы (масса считается по блокам: 1 на обычный блок, как в RZ)
  AIR_POWER_REF: 25, // самолёт: мощность на массу, дающая полную тягу CM
  // шаг 109: предел скорости колёсных машин по покрытию (км/ч) и по прямой/холмам. Бесплатно: без предметов и расхода топлива.
  SURF_SOFT_KMH: 50, SURF_HARD_KMH: 75, SURF_CONCRETE_KMH: 85,   // земля/песок; камень и прочие твёрдые; бетон
  STRAIGHT_MIN: 0.7,   // доля предела на покрытии при постоянных поворотах (1 - поворот не мешает)
  STRAIGHT_RISE: 0.012, STRAIGHT_FALL: 0.08,   // как быстро за тик возвращается/пропадает «прямолинейность» (около 4 с по прямой до максимума)
  HILL_VY: 1.5,        // м/с вертикальной скорости, с которой на склоне перестаёт расти скорость
  CM_FULL_SPEED: 9.775, // полный газ машины CM (8.5 * 1.15), м/с
  REQUIRE_ENGINE: 1,  // как в RZ: машина без двигателя RZ не едет (0 - как в CM)
  ALLOW_CRUISE: 0,    // 1 - круиз-скорость рулевого блока CM работает и без водителя
  SLEEP_K: 2.5,      // шаг 112: насколько охотно стоящая техника засыпает (1 - как раньше, больше - быстрее и при большей тряске)
  INVERT_INPUT: 1,   // шаг 113: 1 - W/S и A/D поменяны местами относительно шага 112 (0 - как в шаге 112)
  TIP_TICKS: 40,     // шаг 115: сколько тиков машина падает под действием TIP_K, затем её отпускают и усыпляют (0 - не отпускать)
  LIE_CALM: 6,         // шаг 115: тиков тишины, после которых упавшая машина засыпает
  TIP_K: 1,          // шаг 114: сила опрокидывания машины, у которой центр масс вне колёс (0 - выключено, 2 - вдвое быстрее)
  AIM_VIS: 1,        // шаг 114: визуальный наклон ствола на технике: 1 - вверх при подъёме, -1 - если в игре наклоняется в другую сторону, 0 - выкл.
  ONE_WHEEL_LIE: 1,   // шаг 119: 1 - машина с одним колесом без газа сразу падает (без пружинной опоры); 0 - как в шаге 118
  STEER_V2: 1,        // шаг 118: 1 - перёд рамки машины совпадает с физическим ходом (рулят передние колёса, A/D верные); 0 - как в шагах 113-117
  TRACK_TURN_V2: 1,   // шаг 121: 1 - у танков A/D повернуты в обратную сторону относительно шагов 113-120 (лево/право были перепутаны); 0 - как раньше
  FLIP_FORWARD: 0,    // шаг 112: 1 - перёд машины противоположен взгляду водителя (если в игре едет задом наперёд)
};
export const STEAM = { TANK_L: 60, BUCKET_L: 20, BURN_LAVA: 20000, BURN_COAL: 16000, BURN_MAX: 60000, ENG_PER_TANK: 3,
  WATER_PER_ENG: 0.10, BURN_PER_ENG: 0.5, IDLE_LOAD: 0.3, WARMUP_S: 2.5, COOLDOWN_S: 1.5, HOLD_S: 4 };

const DT = 1 / 20;
const PROP_KEY = "rzlite:drive";
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ck = (x, y, z) => x + "," + y + "," + z;
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const HFACE = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

// ------------------------------------------------------------------ сохранение: топливо, вода, горелка по id конструкции
const store = new Map();      // id -> { f: топливо л, b: тики горения, w: вода л }
let dirty = false, lastSave = -1000;
function loadStore() {
  try {
    const raw = world.getDynamicProperty(PROP_KEY);
    if (typeof raw === "string") {
      const o = JSON.parse(raw);
      if (o.cfg) for (const k of Object.keys(o.cfg)) if (k in DRIVE && typeof o.cfg[k] === "number") DRIVE[k] = o.cfg[k];
      if (o.scfg) for (const k of Object.keys(o.scfg)) if (k in STEAM && typeof o.scfg[k] === "number") STEAM[k] = o.scfg[k];
      for (const k of Object.keys(o.s ?? {})) store.set(k, o.s[k]);
    }
  } catch {}
}
function saveStore() {
  dirty = false;
  try {
    const s = {};
    for (const [id, v] of store) if ((v.f ?? 0) > 0.005 || (v.b ?? 0) > 0 || (v.w ?? 0) > 0.005) s[id] = { f: round2(v.f), b: Math.round(v.b ?? 0), w: round2(v.w) };
    const cfg = {}, scfg = {};
    for (const k of Object.keys(DRIVE)) cfg[k] = DRIVE[k];
    for (const k of Object.keys(STEAM)) scfg[k] = STEAM[k];
    world.setDynamicProperty(PROP_KEY, JSON.stringify({ s, cfg, scfg }));
  } catch {}
}
const round2 = v => Math.round((v ?? 0) * 100) / 100;
const rec = id => { let r = store.get(id); if (!r) store.set(id, r = { f: 0, b: 0, w: 0 }); return r; };
const sid = session => String(session.assembly?.id);

// ------------------------------------------------------------------ анализ конструкции (кэш по набору блоков)
const cache = new WeakMap();

function axisOf(v, fallback) {
  switch (v) {
    case "east": case "west": return 0;
    case "up": case "down": return 1;
    case "north": case "south": return 2;
    default: return fallback;
  }
}
const stateOf = (snap, name) => { try { return snap.permutation.getState(name); } catch { return undefined; } };

class Dsu {
  constructor(n) { this.p = Array.from({ length: n }, (_, i) => i); }
  find(i) { while (this.p[i] !== i) { this.p[i] = this.p[this.p[i]]; i = this.p[i]; } return i; }
  union(a, b) { a = this.find(a); b = this.find(b); if (a !== b) this.p[b] = a; }
}

export function clusterMult(spec, n) {
  const k = Math.min(Math.max(n, 1), spec.max ?? 1);
  if (k <= 1 || spec.decay === undefined) return 1;
  return 1 + spec.gain * (1 - Math.pow(spec.decay, k - 1)) / (1 - spec.decay);
}

/** Ключ плоскости гусеницы для крепления (тот же, что в build). */
function trackPlaneKey(session, snap) {
  const dir = snap.wheelDirection ?? stateOf(snap, "minecraft:cardinal_direction") ?? "south";
  const lateralX = dir === "east" || dir === "west";
  const x = snap.location.x - session.location.x, z = snap.location.z - session.location.z;
  return (lateralX ? "x" : "z") + (lateralX ? x : z) + dir;
}
/** Вызывать при поломке крепления с катком гусеницы (до удаления снимка): танк стоит, пока гусеницу не починят. */
export function rzMarkTrackBroken(session, snap) {
  try {
    const v = Number(snap.wheelVariant ?? 0);
    if (v < 4 || v > 7) return;
    (session.rzBrokenPlanes ?? (session.rzBrokenPlanes = new Set())).add(trackPlaneKey(session, snap));
    cache.delete(session);
  } catch { /* не критично */ }
}

/** Анализ привода конструкции. Возвращает undefined, если двигателей RZ нет (режим CM). */
export function analyze(session) {
  const snaps = session.snapshots;
  const c = cache.get(session);
  // шаг 111: снятие/слом катка меняет hasWheel внутри того же снимка, поэтому кэш проверяет ещё и число креплений с катком
  let wheelSig = 0;
  for (const sn of snaps) if (isWheelMountId(sn.typeId) && sn.hasWheel) wheelSig++;
  if (c && c.snaps === snaps && c.count === snaps.length && c.wheelSig === wheelSig && c.blocks === session.assembly?.blocks) return c.info;
  const info = build(session);
  cache.set(session, { snaps, count: snaps.length, wheelSig, blocks: session.assembly?.blocks, info });
  return info;
}

function build(session) {
  const sx = session.location.x, sy = session.location.y, sz = session.location.z;
  const engines = [], gears = [], shafts = [], wheels = [], props = [], burners = [], tanks = [], emptyMounts = [];
  let nRad = 0, nTankBlocks = 0, mass = 0, hasEngine = false;
  const cells = new Map();
  for (const s of session.snapshots) {
    const t = s.typeId;
    const x = s.location.x - sx, y = s.location.y - sy, z = s.location.z - sz;
    const cell = { x, y, z, type: t, snap: s };
    cells.set(ck(x, y, z), cell);
    mass += RZW.ON ? rzBlockMass(t) : (ENGINES[t]?.mass ?? BLOCK_MASS[t] ?? 1);   // RZ Lite: реальный вес блоков (двигатели и привод в таблице те же числа)
    if (ENGINES[t]) { engines.push(cell); hasEngine = true; }
    else if (t === SHAFT_ID) shafts.push(cell);
    else if (GEARBOX_IDS.has(t)) gears.push(cell);
    else if (t === RADIATOR_ID) nRad++;
    else if (t === FUEL_TANK_ID) nTankBlocks++;
    else if (t === BURNER_ID) burners.push(cell);
    else if (t === STEAM_TANK_ID) tanks.push(cell);
    else if (isWheelMountId(t)) { if (s.hasWheel) wheels.push(cell); else emptyMounts.push(cell); }   // шаг 108: пустое крепление (каток снят/сломан) всё равно проводит привод к гусенице
    else if (PROP_IDS.has(t)) props.push(cell);
  }
  if (!hasEngine) return undefined;
  mass = Math.max(1, mass * DRIVE.MASS_SCALE);

  // ---- паровые котлы: горелка, над ней 1..3 бака столбом, двигатели сбоку баков (не больше ENG_PER_TANK на бак)
  const boilers = [], steamValid = new Map();
  const cellAt = (x, y, z) => cells.get(ck(x, y, z));
  for (const b of burners) {
    const col = [];
    for (let k = 1; k <= 3; k++) { const t = cellAt(b.x, b.y + k, b.z); if (t?.type === STEAM_TANK_ID) col.push(t); else break; }
    if (col.length === 0) continue;
    const boiler = { burner: b, tanks: col, engines: [], conn: 0 };
    for (const t of col) {
      const here = [];
      for (const dir of Object.values(HFACE)) {
        const e = cellAt(t.x + dir[0], t.y, t.z + dir[1]);
        if (e?.type === STEAM_ENGINE_ID) here.push(e);
      }
      here.sort((a, b2) => (a.x - b2.x) || (a.y - b2.y) || (a.z - b2.z));
      for (const e of here.slice(0, STEAM.ENG_PER_TANK)) {
        let d = HFACE[stateOf(e.snap, "minecraft:facing_direction")];
        if (!d) d = [e.x - t.x, e.z - t.z];            // направление наружу от бака, если состояние не горизонтальное
        steamValid.set(ck(e.x, e.y, e.z), { boiler: boilers.length, d });
        boiler.engines.push(e);
      }
    }
    boilers.push(boiler);
  }

  // ---- активные двигатели
  const sortKey = cc => (cc.x * 4096 + cc.y) * 4096 + cc.z;
  engines.sort((a, b) => sortKey(a) - sortKey(b));
  const seenSingle = new Set(), active = [];
  let inactive = 0;
  for (const e of engines) {
    const spec = ENGINES[e.type];
    if (spec.steam && !steamValid.has(ck(e.x, e.y, e.z))) { inactive++; continue; }
    if (!spec.scalable) { if (seenSingle.has(e.type)) { inactive++; continue; } seenSingle.add(e.type); }
    active.push(e);
  }

  // ---- узлы графа
  const nodes = [], byKey = new Map();
  const add = (cc, kind, axis, extra) => { const n = { c: cc, kind, axis, i: nodes.length, steam: kind === "E" && ENGINES[cc.type].steam === true, ...extra }; nodes.push(n); byKey.set(ck(cc.x, cc.y, cc.z), n); return n; };
  for (const e of active) add(e, "E", axisOf(stateOf(e.snap, "minecraft:cardinal_direction"), 2));
  for (const g of gears) add(g, "G", -1);
  for (const sh of shafts) add(sh, "S", axisOf(stateOf(sh.snap, "minecraft:block_face"), 1));
  for (const w of wheels) add(w, "W", -1);
  for (const p of props) add(p, "P", -1);
  // первый вал парового двигателя: клетка E+2d. Пусто -> виртуальный вал, ось горизонтальна и перпендикулярна d
  for (const n of nodes.slice()) {
    if (!n.steam) continue;
    const v = steamValid.get(ck(n.c.x, n.c.y, n.c.z));
    if (!v) continue;
    const ax = v.d[0] !== 0 ? 2 : 0, tx = n.c.x + 2 * v.d[0], tz = n.c.z + 2 * v.d[1];
    v.node = undefined;
    const m = byKey.get(ck(tx, n.c.y, tz));
    if (!m) {
      if (cells.has(ck(tx, n.c.y, tz))) v.out = "blocked";
      else { v.node = add({ x: tx, y: n.c.y, z: tz, type: "virtual_shaft" }, "S", ax); v.out = "virtual"; }
    } else if (m.kind === "S") { if (m.axis === ax) { v.node = m; v.out = "real"; } else v.out = "wrongaxis"; }
    else if (m.kind === "G") { v.node = m; v.out = "gear"; }
    else v.out = "blocked";
  }

  const conducts = (n, di) => n.kind !== "S" || n.axis === (di >> 1);
  const clusterAdj = (a, b, di) => {
    if (a.c.type !== b.c.type) return false;
    const spec = ENGINES[a.c.type];
    if (!spec.scalable || spec.steam) return false;
    return spec.axis === "any" || (a.axis === b.axis && (di >> 1) === a.axis);
  };
  const load = n => n.kind === "W" || n.kind === "P";
  const link = (a, b, di) => {
    if (a.steam || b.steam) return false;
    if (load(a) && load(b)) return false;
    if ((load(a) && b.kind === "E") || (a.kind === "E" && load(b))) return false;
    if (a.kind === "E" && b.kind === "E") return clusterAdj(a, b, di);
    return conducts(a, di) && conducts(b, di ^ 1);
  };
  const neighbour = (n, di) => { const d = DIRS[di]; return byKey.get(ck(n.c.x + d[0], n.c.y + d[1], n.c.z + d[2])); };

  const net = new Dsu(nodes.length), clu = new Dsu(nodes.length);
  for (const n of nodes) {
    if (load(n)) continue;
    for (let di = 0; di < 6; di++) {
      const m = neighbour(n, di);
      if (!m || load(m) || !link(n, m, di)) continue;
      net.union(n.i, m.i);
      if (n.kind === "E" && m.kind === "E") clu.union(n.i, m.i);
    }
  }
  for (const n of nodes) {
    if (!n.steam) continue;
    const v = steamValid.get(ck(n.c.x, n.c.y, n.c.z));
    if (v?.node) net.union(n.i, v.node.i);
  }

  const clusters = new Map();
  for (const n of nodes) {
    if (n.kind !== "E") continue;
    const r = clu.find(n.i);
    let cl = clusters.get(r);
    if (!cl) clusters.set(r, cl = { type: n.c.type, n: 0, root: net.find(n.i), boiler: n.steam ? steamValid.get(ck(n.c.x, n.c.y, n.c.z))?.boiler : undefined });
    cl.n++;
    if (n.steam && cl.boiler === undefined) cl.boiler = steamValid.get(ck(n.c.x, n.c.y, n.c.z))?.boiler;
  }
  const comps = new Map();
  const comp = r => { let o = comps.get(r); if (!o) comps.set(r, o = { power: 0, heat: 0, speedW: 0, fuel: 0, steamPower: 0, wheels: new Set(), props: 0 }); return o; };
  const clusterInfo = [];
  for (const cl of clusters.values()) {
    const spec = ENGINES[cl.type];
    // паровые двигатели - линейная сумма (кластеров нет): считаем каждый отдельно, но тип тот же
    const mult = spec.steam ? cl.n : clusterMult(spec, cl.n);
    const power = spec.steam ? spec.power * cl.n : spec.power * mult, heat = spec.heat * cl.n;
    const o = comp(cl.root);
    o.power += power; o.heat += heat; o.speedW += power * spec.speed; o.fuel += spec.fuel * cl.n;
    if (spec.steam) o.steamPower += power;
    clusterInfo.push({ type: cl.type, n: cl.n, mult, power, heat, root: cl.root });
  }
  // колёса и пропеллеры -> сети
  for (const n of nodes) {
    if (!load(n)) continue;
    for (let di = 0; di < 6; di++) {
      const m = neighbour(n, di);
      if (!m || load(m) || !link(n, m, di)) continue;
      const o = comp(net.find(m.i));
      if (n.kind === "W") o.wheels.add(ck(n.c.x, n.c.y, n.c.z)); else o.props++;
    }
  }
  // гусеница - одно целое: питание дошло до любого катка плоскости -> ведут все катки плоскости
  const planeOf = new Map(), rollersOf = new Map();
  for (const w of wheels) {
    const variant = Number(w.snap.wheelVariant ?? 0);
    if (variant < 4 || variant > 7) continue;
    const dir = w.snap.wheelDirection ?? stateOf(w.snap, "minecraft:cardinal_direction") ?? "south";
    const lateralX = dir === "east" || dir === "west";
    const pk = (lateralX ? "x" : "z") + (lateralX ? w.x : w.z) + dir;
    const k = ck(w.x, w.y, w.z);
    planeOf.set(k, pk);
    let a = rollersOf.get(pk); if (!a) rollersOf.set(pk, a = []); a.push(k);
  }
  for (const o of comps.values()) {
    const more = [];
    for (const k of o.wheels) { const pk = planeOf.get(k); if (pk !== undefined) for (const r of rollersOf.get(pk) ?? []) more.push(r); }
    for (const r of more) o.wheels.add(r);
  }
  // шаг 111: плоскость гусеницы, из которой сломали каток вместе с креплением (пустого крепления не осталось), считается разорванной,
  // пока катков в ней снова не станет не меньше, чем было (rzMarkTrackBroken вызывается из main.js при поломке)
  const brokenPlanes = session.rzBrokenPlanes ?? (session.rzBrokenPlanes = new Set()), planePeak = session.rzPlanePeak ?? (session.rzPlanePeak = new Map());
  for (const [pk, a] of rollersOf) {
    if (brokenPlanes.has(pk)) { if (a.length >= (planePeak.get(pk) ?? 0)) brokenPlanes.delete(pk); }
    else if (a.length > (planePeak.get(pk) ?? 0)) planePeak.set(pk, a.length);
  }
  if (rollersOf.size === 0) brokenPlanes.clear();
  // шаг 108: у гусеницы сломан/снят каток (крепление без катка в той же плоскости) - гусеница целиком не едет, танк стоит
  let brokenTrack = brokenPlanes.size > 0;
  if (!brokenTrack) for (const w of emptyMounts) {
    const dir = w.snap.wheelDirection ?? stateOf(w.snap, "minecraft:cardinal_direction") ?? "south";
    const lateralX = dir === "east" || dir === "west";
    if (rollersOf.has((lateralX ? "x" : "z") + (lateralX ? w.x : w.z) + dir)) { brokenTrack = true; break; }
  }
  if (brokenTrack) for (const o of comps.values()) for (const k of [...o.wheels]) if (planeOf.has(k)) o.wheels.delete(k);
  // итог: учитываются сети, где есть мощность и нагрузка (колёса или пропеллер)
  const drivenWheels = new Set(), drivenSteamBoilers = new Set();
  let basePower = 0, heatGen = 0, speedW = 0, fuelRate = 0, steamPower = 0, propellers = 0;
  const connectedRoots = new Set();
  for (const [root, o] of comps) {
    if (o.power <= 0 || (o.wheels.size === 0 && o.props === 0)) continue;
    connectedRoots.add(root);
    basePower += o.power; heatGen += o.heat; speedW += o.speedW; fuelRate += o.fuel; steamPower += o.steamPower; propellers += o.props;
    for (const k of o.wheels) drivenWheels.add(k);
  }
  for (const ci of clusterInfo) {
    ci.connected = connectedRoots.has(ci.root);
    const spec = ENGINES[ci.type];
    if (ci.connected && spec.steam) { /* котёл работает, если к нему подключён хоть один двигатель */ }
  }
  for (const cl of clusters.values()) if (cl.boiler !== undefined && connectedRoots.has(cl.root)) drivenSteamBoilers.add(cl.boiler);
  const trackMode = [...drivenWheels].some(k => planeOf.has(k));
  const wheelMode = [...drivenWheels].some(k => !planeOf.has(k));
  const hasSteam = boilers.length > 0;
  return { mode: "engine", mass, nRad, nTankBlocks, boilers, drivenSteamBoilers, hasSteam,
    basePower, heatGen, cooling: nRad * DRIVE.RAD_COOL, speedF: basePower > 0 ? speedW / basePower : 1,
    nEngines: active.length, nFuelEngines: active.filter(e => !ENGINES[e.type].steam).length, inactive,
    fuelRate, steamPower, clusters: clusterInfo, wheelsDriven: drivenWheels.size, props: propellers, trackMode, wheelMode, brokenTrack };
}

// ------------------------------------------------------------------ формулы RZ
const capacity = info => info.nFuelEngines * DRIVE.TANK_PER_ENGINE + info.nTankBlocks * DRIVE.TANK_PER_BLOCK;
function stepHeat(info, heat, load) {
  if (info.heatGen <= 0) return 0;
  const need = load < 0 ? 0 : info.heatGen * (DRIVE.IDLE_HEAT + (1 - DRIVE.IDLE_HEAT) * load);
  const amb = DRIVE.AMBIENT * (load < 0 ? 3 : 1);
  const d = (need - info.cooling - amb * info.heatGen) / info.heatGen;
  const rate = d > 0 ? d / DRIVE.HEAT_SECONDS : Math.max(d, -1) / DRIVE.COOL_SECONDS;
  return clamp(heat + rate * DT, 0, 1);
}
function topSpeed(info, power, mass) {
  const ratio = power / Math.max(mass, 0.1);
  let v = DRIVE.SPEED_CAP * (1 - Math.exp(-ratio * info.speedF / DRIVE.SPEED_R0));
  if (info.trackMode && !info.wheelMode) v = Math.min(v, DRIVE.TRK_SPEED_KMH / 3.6);
  else if (info.trackMode && info.wheelMode) v = Math.min(v, DRIVE.TRK_SPEED_KMH / 3.6 * (1 + DRIVE.TRK_WHEEL_BONUS * (1 - Math.exp(-ratio / 12))));
  return v;
}
function fuelBurn(info, load, speed) {
  if (!(info.fuelRate > 0)) return 0;
  const l = DRIVE.IDLE_FUEL + (1 - DRIVE.IDLE_FUEL) * clamp(load, 0, 1);
  const m = 1 + DRIVE.MASS_FUEL * info.mass / DRIVE.MASS_REF;
  const v = clamp(speed / DRIVE.SPEED_CAP, 0, 1.5);
  return info.fuelRate * DRIVE.FUEL_K * l * m * (1 + 1.5 * v * v);
}

// ------------------------------------------------------------------ состояние сессии в тик
function driverPlayer(session) {
  const id = session.carDriverId ?? session.rzAirPilotId;   // самолёт RZ: водитель не назначается, пилот пишется rz_air_control.js
  if (!id) return undefined;
  try { return world.getAllPlayers().find(p => p.id === id); } catch { return undefined; }
}
function planeEngineOn(session) {
  return airEngineOn(session);
}

/** Раз в тик: топливо, нагрев, пар. Возвращает ничего; результат лежит в session.rz = { info, heat, fuelOk, power, vmax, accel, steamK, ... }. */
export function stepRzDrive(sessions, tick) {
  if (tick - lastSave >= 100 && dirty) { lastSave = tick; saveStore(); }
  if (tick % 40 === 0) rzEngineSoundCleanup(tick);
  for (const session of sessions) {
    if (!session.assembly?.isValid) continue;
    const info = analyze(session);
    if (!info) { session.rz = undefined; continue; }
    const st = session.rz ?? (session.rz = { heat: 0, steamK: 0, hold: 0, load: 0 });
    st.info = info;
    const id = sid(session), r = rec(id);
    const body = session.assembly.body;
    let speed = 0;
    try { speed = Math.hypot(body.velocity.x, body.velocity.z); } catch {}
    const plane = vehicleSystems(session).airplane;
    const occupied = session.rzOccupied === true;   // RZ Lite: в кресле никого - двигатель молчит, HUD не шлётся (main.js считает раз в 4 тика)
    const driving = occupied && (plane ? planeEngineOn(session) : !!session.carDriverId);
    // нагрузка: |газ| за последний тик (хук машины) или тяга самолёта; -1 = двигатель выключен
    const throttle = plane ? (session.airplaneEnginePower ?? 0) : (st.load ?? 0);
    const load = driving || speed > 1 ? clamp(throttle, 0, 1) : -1;
    st.heat = stepHeat(info, st.heat, load);
    st.driving = driving;
    // ---- паровые котлы
    if (info.hasSteam) {
      const running = driving && (throttle > 0.01 || speed > 1);
      if (running) st.hold = STEAM.HOLD_S; else st.hold = Math.max(0, st.hold - DT);
      const boilerOn = st.hold > 0;
      const nEng = info.clusters.filter(c => ENGINES[c.type].steam && c.connected).reduce((a, c) => a + c.n, 0);
      const cap = info.boilers.reduce((a, b) => a + b.tanks.length * STEAM.TANK_L, 0);
      r.w = Math.min(r.w, cap);
      const ready = boilerOn && r.b > 0 && r.w > 0 && nEng > 0;
      if (ready) {
        const l = STEAM.IDLE_LOAD + (1 - STEAM.IDLE_LOAD) * clamp(throttle, 0, 1);
        r.b = Math.max(0, r.b - STEAM.BURN_PER_ENG * nEng * l);
        r.w = Math.max(0, r.w - STEAM.WATER_PER_ENG * nEng * l * DT);
        dirty = true;
      }
      st.steamK = clamp(st.steamK + (ready ? DT / STEAM.WARMUP_S : -DT / STEAM.COOLDOWN_S), 0, 1);
    } else st.steamK = 0;
    // ---- топливо
    const cap = capacity(info);
    if (r.f > cap) r.f = cap;
    const hasFuelEngines = info.nFuelEngines > 0 && info.fuelRate > 0;
    st.fuelOk = !DRIVE.FUEL_ENABLED || !hasFuelEngines || r.f > 0;
    if (DRIVE.FUEL_ENABLED && hasFuelEngines && load >= 0 && st.fuelOk) {
      r.f = Math.max(0, r.f - fuelBurn(info, load, speed) * DT);
      dirty = true;
    }
    // ---- итоговая мощность (steamPower не зависит от топлива бака и перегрева)
    const eff = 1 - DRIVE.HEAT_LOSS * st.heat;
    const power = (st.fuelOk ? (info.basePower - info.steamPower) * eff : 0) + info.steamPower * st.steamK;
    st.eff = eff; st.power = power; st.fuel = r.f; st.cap = cap; st.water = r.w; st.burn = r.b;
    st.vmax = Math.max(1, topSpeed(info, power, info.mass));
    st.vrev = Math.min(st.vmax, DRIVE.MAX_REVERSE * Math.min(1, info.speedF));
    st.accel = clamp(power * DRIVE.ACCEL_K / Math.max(info.mass, 0.1), 0, DRIVE.ACCEL_MAX);
    st.thrust = power > 0.5 && (info.wheelsDriven > 0 || info.props > 0);
    // ---- звук двигателя (RZ engineSound)
    try {
      const on = driving && st.fuelOk && info.basePower > 0 && (info.wheelsDriven > 0 || info.props > 0);
      const bl = body.location, bv = body.velocity;
      const dim = session.dimension ?? session.snapshots[0]?.dimension ?? driverPlayer(session)?.dimension ?? world.getDimension("overworld");
      rzEngineSound(tick, id, dim, info, on, speed, st.vmax, plane ? (session.airplaneEnginePower ?? 0) : (st.load ?? 0), { px: bl.x, py: bl.y, pz: bl.z, vx: bv.x, vz: bv.z });
      if (info.hasSteam && st.steamK > 0.3 && tick % 40 === 0) dim.playSound("phys.steam", { x: bl.x, y: bl.y + 1, z: bl.z }, { volume: 0.6 * st.steamK });
    } catch {}
    // ---- HUD водителю: интерфейс RZ (ui/rz_hud.json), данные идут в title-канал
    if (tick % (plane ? 4 : 2) === 0 && info.basePower >= 0) {   // самолёт: раз в 4 тика, как в RZ
      const p = occupied ? driverPlayer(session) : undefined;
      if (p) rzHud(p, session, info, st, plane, speed, throttle);
    }
  }
}

function rzHud(player, session, info, st, plane, speed, throttle) {
  try {
    const body = session.assembly.body;
    const hasFuel = DRIVE.FUEL_ENABLED && info.fuelRate > 0 && info.nFuelEngines > 0;
    const fr = hasFuel && st.cap > 0 ? clamp(st.fuel / st.cap, 0, 1) : 0;
    const hasTemp = info.heatGen > 0, heat = hasTemp ? st.heat : 0;
    const rig = plane ? session.rzRig : undefined;   // модель полёта RZ: скорость по воздуху и флаги срыва/предела/потолка
    const kmh = (rig ? rig.airspeed : speed) * 3.6, vmaxKmh = rig && Number.isFinite(rig.vcap) ? rig.vcap * 3.6 : st.vmax > 1 ? st.vmax * 3.6 : plane ? 360 : 180;
    const scale = Math.min(999, Math.max(40, Math.ceil(Math.max(vmaxKmh, kmh) / 10) * 10));
    const thrust = plane ? (rig ? rig.thr : (session.airplaneEnginePower ?? 0)) : Math.abs(st.load ?? 0);
    const sign = Math.sign(session.wheelAcceleration ?? 0);
    const gear = plane ? "A" : thrust > 0.05 && sign < 0 && speed < 0.5 ? "R" : thrust > 0.05 ? "D" : "N";
    sendHud(player, { mode: plane ? "a" : "c", kmh, alt: body.location.y, scale, fuelFrac: fr, heat, thr: thrust, gear, flags: {
      hasFuel, hasTemp,
      noEngine: info.basePower <= 0 || (!st.thrust && info.wheelsDriven === 0 && info.props === 0),
      fuelEmpty: hasFuel && st.fuel <= 0,
      fuelLow: hasFuel && st.fuel > 0 && fr < 0.2,
      overheat: hasTemp && heat > 0.66,
      hot: hasTemp && heat > 0.45 && heat <= 0.66,
      limit: !!rig && rig.capped === true, thin: !!rig && rig.air < 0.5,
      stallAero: !!rig && rig.aoa > 20 && rig.airspeed > 6, stallCeil: !!rig && rig.air <= 0.12,
      brake: false, airborne: false, shallow: false } });
  } catch {}
}

function hud(player, info, st) {
  try {
    const t = Math.round(st.heat * 100), col = st.heat > 0.66 ? "§c" : st.heat > 0.33 ? "§e" : "§a";
    let line = `§f${Math.round(st.power)} л.с. §7| КПД ${Math.round(st.eff * 100)}% | ${col}t ${t}%§7 | рад. ${info.nRad}/${Math.ceil(info.heatGen * (1 - DRIVE.AMBIENT) / DRIVE.RAD_COOL - 1e-6)}`;
    if (DRIVE.FUEL_ENABLED && info.fuelRate > 0) line += st.fuel <= 0 ? " §7| §cнет топлива" : ` §7| топливо ${st.fuel.toFixed(st.fuel < 10 ? 1 : 0)}/${Math.round(st.cap)} л`;
    if (info.hasSteam) line += ` §7| пар ${Math.round(st.steamK * 100)}% вода ${st.water.toFixed(0)} л огонь ${Math.round(st.burn / 20)} с`;
    if (!st.thrust && info.wheelsDriven === 0 && info.props === 0) line += " §7| §eдвигатель не соединён с колёсами (вал/редуктор)";
    player.onScreenDisplay.setActionBar(line);
  } catch {}
}

// ------------------------------------------------------------------ хуки CM
/**
 * Машина: cmTarget - целевая скорость CM (м/с, со знаком). Возвращает undefined (режим CM) или { target, maxAccelTick }.
 */
export function rzCarDrive(session, cmTarget) {
  const st = session.rz;
  if (!st?.info) return DRIVE.REQUIRE_ENGINE ? { target: 0, maxAccelTick: 0.32, noThrust: true } : undefined;
  const frac = clamp(cmTarget / DRIVE.CM_FULL_SPEED, -1, 1);
  st.load = Math.abs(frac);
  if (!st.thrust) return { target: 0, maxAccelTick: 0.32, noThrust: true };
  // шаг 114: после шага 113 клавиша W даёт отрицательную цель (INVERT_INPUT), поэтому «вперёд» = знак forwardSign; полный предел только вперёд, ограниченный (vrev) только назад
  const fwd = (DRIVE.INVERT_INPUT === 0 ? 1 : -1) * (DRIVE.STEER_V2 ? -1 : 1);   // шаг 118: при STEER_V2 знак входа W обратный, перёд рамки развёрнут (main.js rzReversed)
  const target = frac * fwd >= 0 ? frac * st.vmax : frac * st.vrev;
  return { target, maxAccelTick: Math.max(0.05, st.accel / 20), noThrust: false };
}

/** Шаг 121: может ли машина вообще ехать (есть двигатель, топливо и соединённый привод; у танка гусеница не разорвана). Нет - ни ход, ни разворот на месте. */
export function rzCanDrive(session) {
  const st = session?.rz;
  if (!st?.info) return !DRIVE.REQUIRE_ENGINE;
  return st.thrust === true;
}

/** Гусеницы: множитель скорости разворота 0.3..1 по отношению мощности к весу (вес блоков уже в st.accel). 1 - режим CM или флаг весов выключен. */
export function rzTrackTurnScale(session) {
  const st = session.rz;
  if (!RZW.ON || !st?.info) return 1;
  return clamp(st.accel / Math.max(0.1, DRIVE.TRK_TURN_REF), 0.3, 1);
}

/** Самолёт: undefined - режим CM; иначе { ok, cap }, ok = двигатель может работать, cap = предел тяги 0..1. */
export function rzAirplane(session) {
  const st = session.rz;
  if (!st?.info) return undefined;
  const ok = st.thrust === true && st.power > 0.5;
  const cap = clamp((st.power / Math.max(st.info.mass, 0.1)) / DRIVE.AIR_POWER_REF, 0.15, 1);
  return { ok, cap };
}

// ------------------------------------------------------------------ заправка и осмотр (ПКМ по блоку конструкции)
const say = (p, m) => { try { p.onScreenDisplay.setActionBar(m); } catch {} };
function heldItem(player) { try { return player.getComponent("minecraft:inventory")?.container?.getItem(player.selectedSlotIndex); } catch { return undefined; } }
function isCreative(p) { try { return p.getGameMode() === GameMode.Creative; } catch { return false; } }
function setHeld(player, item) { try { player.getComponent(EntityComponentTypes.Equippable)?.setEquipment(EquipmentSlot.Mainhand, item); } catch {} }
function consumeHeld(player, replacement) {
  if (isCreative(player)) return;
  const held = heldItem(player);
  if (!held) return;
  if (held.amount > 1) {
    try { held.amount--; player.getComponent("minecraft:inventory").container.setItem(player.selectedSlotIndex, held); } catch {}
  } else setHeld(player, replacement ? new ItemStack(replacement, 1) : undefined);
}

/** true = клик обработан (CM не должен продолжать). */
export function rzInteract(player, session, snapshot) {
  const info = analyze(session);
  const t = snapshot.typeId, item = heldItem(player)?.typeId;
  const isDriveBlock = !!ENGINES[t] || GEARBOX_IDS.has(t) || t === SHAFT_ID || t === RADIATOR_ID || t === FUEL_TANK_ID || t === BURNER_ID || t === STEAM_TANK_ID;
  if (item !== FUEL_ITEM && !isDriveBlock) return false;
  if (!info && item === FUEL_ITEM) { say(player, "§cВ конструкции нет двигателя: заправлять нечего"); return true; }
  if (!info) return false;
  const id = sid(session), r = rec(id);
  if (item === FUEL_ITEM) {
    if (!DRIVE.FUEL_ENABLED) { say(player, "§7Топливо отключено (rzlite:drive set FUEL_ENABLED 1)"); return true; }
    const cap = capacity(info);
    if (cap <= 0) { say(player, "§eНет двигателя, которому нужен бензин (паровой работает на лаве/угле)"); return true; }
    const free = cap - r.f;
    if (free < DRIVE.BUCKET_L - 1e-6) { say(player, free < 0.5 ? `§eБак полон (${r.f.toFixed(0)}/${Math.round(cap)} л)` : `§eВ бак влезет ${free.toFixed(1)} л, канистра ${DRIVE.BUCKET_L} л (бак ${Math.round(cap)} л)`); return true; }
    r.f += DRIVE.BUCKET_L; dirty = true; saveStore();
    consumeHeld(player, "minecraft:bucket");
    try { player.playSound("bucket.empty_water", { volume: 0.8, pitch: 0.7 }); } catch {}
    say(player, `§aЗаправлено +${DRIVE.BUCKET_L} л. Бак: ${r.f.toFixed(0)}/${Math.round(cap)} л`);
    return true;
  }
  if (t === BURNER_ID && (item === "minecraft:lava_bucket" || item === "minecraft:coal_block")) {
    const add = item === "minecraft:lava_bucket" ? STEAM.BURN_LAVA : STEAM.BURN_COAL;
    if (r.b + add > STEAM.BURN_MAX + 1) { say(player, "§eГорелка заполнена"); return true; }
    r.b += add; dirty = true; saveStore();
    consumeHeld(player, item === "minecraft:lava_bucket" ? "minecraft:bucket" : undefined);
    try { player.playSound("fire.ignite", { volume: 0.7, pitch: 0.8 }); } catch {}
    say(player, `§aГорелка: ${Math.round(r.b / 20)} с огня`);
    return true;
  }
  if (t === STEAM_TANK_ID && item === "minecraft:water_bucket") {
    const cap = info.boilers.reduce((a, b) => a + b.tanks.length * STEAM.TANK_L, 0);
    if (cap <= 0) { say(player, "§eБак не стоит над горелкой"); return true; }
    if (cap - r.w < STEAM.BUCKET_L - 1e-6) { say(player, `§eВода: ${r.w.toFixed(0)}/${cap} л`); return true; }
    r.w += STEAM.BUCKET_L; dirty = true; saveStore();
    consumeHeld(player, "minecraft:bucket");
    try { player.playSound("bucket.empty_water", { volume: 0.8, pitch: 1 }); } catch {}
    say(player, `§aВода: ${r.w.toFixed(0)}/${cap} л`);
    return true;
  }
  // иначе - осмотр: краткий отчёт
  const st = session.rz;
  if (st && info.basePower > 0) { hud(player, info, st); return true; }
  say(player, "§eДвигатель не соединён с колёсами/пропеллером: нужна цепь вал/редуктор (двигатель и колесо напрямую не соединяются)");
  return true;
}

// ------------------------------------------------------------------ /scriptevent rzlite:drive ...
function reportLines(session) {
  const st = session.rz, info = st?.info ?? analyze(session);
  if (!info) return [];
  const out = [`§b[drive] конструкция ${sid(session)}: двигателей ${info.nEngines}${info.inactive ? ` (+${info.inactive} лишних/неподключённых паровых)` : ""}, колёс с приводом ${info.wheelsDriven}, пропеллеров ${info.props}, мощность ${Math.round(info.basePower)}, масса ${info.mass.toFixed(1)}`];
  for (const c of info.clusters) out.push(`  ${c.type} x${c.n} множитель ${c.mult.toFixed(2)} мощность ${Math.round(c.power)} ${c.connected ? "" : "§c(не соединён)§r"}`);
  out.push(`  радиаторов ${info.nRad} (охлаждение ${info.cooling.toFixed(1)} при нагреве ${info.heatGen.toFixed(1)}), температура ${Math.round((st?.heat ?? 0) * 100)}%`);
  if (st) out.push(`  vmax ${(st.vmax * 3.6).toFixed(0)} км/ч, ускорение ${st.accel.toFixed(1)} м/с², топливо ${st.fuel.toFixed(1)}/${Math.round(st.cap)} л, тяга ${st.thrust ? "есть" : "нет"}`);
  if (info.hasSteam && st) out.push(`  пар: ${Math.round(st.steamK * 100)}%, вода ${st.water.toFixed(0)} л, огонь ${Math.round(st.burn / 20)} с`);
  return out;
}

export function installRzDrive(sessionsMap) {
  loadStore();
  installRzSound();
  installRzHud();
  system.afterEvents.scriptEventReceive.subscribe(ev => {
    if (ev.id !== "rzlite:drive") return;
    const [cmd, a, b] = ev.message.trim().split(/\s+/);
    const src = ev.sourceEntity;
    const reply = m => { try { (src ?? world).sendMessage?.(m); } catch {} };
    const near = [];
    for (const s of sessionsMap.values()) {
      if (!s.assembly?.isValid) continue;
      if (src?.location && s.location) {
        const dx = s.location.x - src.location.x, dy = s.location.y - src.location.y, dz = s.location.z - src.location.z;
        if (dx * dx + dy * dy + dz * dz > 48 * 48) continue;
      }
      near.push(s);
    }
    if (cmd === "report" || cmd === undefined) {
      let n = 0;
      for (const s of near) for (const l of reportLines(s)) { reply(l); n++; }
      if (!n) reply("§e[drive] рядом нет конструкций с двигателями RZ");
    } else if (cmd === "set") {
      const key = a, val = Number(b);
      if (key in DRIVE && Number.isFinite(val)) { DRIVE[key] = val; dirty = true; saveStore(); reply(`§a[drive] ${key} = ${val}`); }
      else if (key in STEAM && Number.isFinite(val)) { STEAM[key] = val; dirty = true; saveStore(); reply(`§a[steam] ${key} = ${val}`); }
      else reply("§e[drive] set <КЛЮЧ> <число>. Ключи: " + Object.keys(DRIVE).concat(Object.keys(STEAM)).join(" "));
    } else if (cmd === "fill") {
      for (const s of near) { const info = analyze(s); if (!info) continue; const r = rec(sid(s)); r.f = capacity(info); r.b = STEAM.BURN_MAX; r.w = info.boilers.reduce((x, y) => x + y.tanks.length * STEAM.TANK_L, 0); dirty = true; }
      saveStore(); reply("§a[drive] баки, вода и горелка заполнены");
    } else reply("§e[drive] report | set <КЛЮЧ> <число> | fill");
  });
}
