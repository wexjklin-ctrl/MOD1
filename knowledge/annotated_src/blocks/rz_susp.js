/* CLAUDE-MAP-BEGIN
 FILE: blocks/rz_susp.js  (20 KB, 299 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: RZ Lite suspension: spring/offset per wheel, ground sampling; scriptevent rzlite:susp.
 IMPORTS: @minecraft/server, blocks/wheel_mount_ids.js
 IMPORTED BY: main.js
 EXPORTS: SUSP, suspSpring, suspOffset, suspReset, rzGroundVel, rzFlipStep, rzLie, rzLyingStep, rzAirTrack, rzRideOf, rzRideRecalc, rzTipBias, rzHullProbes, installRzSusp
 EVENTS: scriptEventReceive
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): rzLyingStep@118(42L); hullEdge@243(30L); rzFlipStep@77(27L); installRzSusp@275(24L); rzAirTrack@165(23L); rzTipBias@207(22L); rzGroundVel@57(15L); suspSpring@40(13L); rzHullProbes@235(8L); rzLie@111(7L); rzRideRecalc@196(6L); rzRideOf@191(5L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { isWheelMountId } from "./wheel_mount_ids.js";
// RZ Lite: подвеска машин, переворот при падении, спокойная стоянка. Всё скалярное и без новых циклов по блокам:
// на машину - одно число скорости пружины (rest.suspVy), одна пара вызовов localPointToWorld для наклона, остальное - те же расчёты, что уже были.
// Идея подвески: кузов едет на демпфированной пружине вокруг высоты опоры (вместо жёсткой телепортации на землю), а колёса
// визуально остаются на земле через свойство wheel_ground_offset (клиент сам сглаживает за 0.1 с).
// Всё включается/выключается флагами: /scriptevent rzlite:susp on|off, rzlite:susp flip on|off, rzlite:susp calm on|off.
import { world, system } from "@minecraft/server";

export const SUSP = {
  ON: 1,            // 1 = пружинная подвеска кузова, 0 = как раньше (жёсткая посадка на землю)
  K: 110,           // жёсткость пружины, 1/с^2
  C: 15,            // демпфирование, 1/с (коэффициент ~0.7)
  UP: 0.45,         // макс. «проседание» кузова ниже опоры, блоков; глубже - мгновенный подъём (чтобы шасси не проваливалось в ступеньку)
  VMAX: 9,          // предел вертикальной скорости пружины, м/с
  OFF_UP: 0.25,     // пределы визуального хода колеса (совпадают с диапазоном свойства -0.35..0.25)
  OFF_DOWN: -0.35,
  AIR_GAP: 0.6,     // блоков: колесо выше опоры больше чем на это = колесо в воздухе
  FLIP_ON: 1,       // 1 = машина может перевернуться при падении
  IMPACT: 9,        // м/с: вертикальная скорость приземления, с которой машину кувыркает (~3.7 блока падения при g=11)
  KICK: 0.5,        // рад/с кувырка на каждый м/с сверх IMPACT
  AIR_TICKS: 4,     // сколько тиков надо провисеть в воздухе, чтобы приземление считалось падением
  FLIP_ENTER: 0.45, // cos наклона кузова, ниже которого машина лежит (примерно 63 градуса)
  FLIP_EXIT: 0.78,  // cos наклона, выше которого лежавшая машина снова встаёт на колёса (примерно 39 градусов)
  FLIP_SLEEP: 30,   // тиков тишины, после которых перевёрнутая машина засыпает
  CALM: 1,          // 1 = удары не дёргают машину: боковое скольжение гасится, лёгкий толчок по стоящей машине игнорируется
  HIT_IGNORE: 1.2,  // м/с: горизонтальная скорость, ниже которой толчок по припаркованной машине игнорируется
  SLIDE_DAMP: 0.5,  // множитель скорости за тик на малой скорости без газа (машина сразу останавливается и засыпает)
  LATERAL: 0.6,     // доля боковой скорости, гасимая за тик на земле (колёса не скользят боком)
  RIDE: 0,          // общая добавка к просвету колёс, блоков (сверх настройки каждой машины в меню колёсного блока), -0.2..0.3
  STEP: 0.3,        // ступенька, которую колесо берёт, = высота центра колеса над землёй + это число (от скорости не зависит)
  HULL: 1,          // 1 = корпус (нос/днище) тоже щупает ступеньку впереди: не застревает днищем, нос приподнимается
  TIP: 1,           // 1 = центр масс влияет на наклон: груз за пределами колёсной базы клюёт носом (или задирает)
  TIP_K: 12,        // градусов наклона на каждый блок выноса центра масс за крайние колёса
  TIP_MAX: 22       // предел такого наклона, градусов
};
const PROP_KEY = "rzlite:susp";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Пружина кузова. err = высота опоры - высота кузова (блоки), target = высота опоры. Возвращает { vy, snap }. */
export function suspSpring(rest, err, target) {
  // скорость самой опоры (ступенька/склон): пружина следует за ней без отставания, а не тащится позади
  let vt = 0;
  if (rest.suspPrev !== undefined && Math.abs(target - rest.suspPrev) <= 0.3) vt = clamp((target - rest.suspPrev) * 20, -SUSP.VMAX, SUSP.VMAX);   // уступ больше 0.3 - не склон, опережение не нужно
  rest.suspPrev = target;
  let snap = 0;
  if (err > SUSP.UP) { snap = err - SUSP.UP; err = SUSP.UP; }
  let vy = rest.suspVy ?? 0;
  vy += (SUSP.K * err - SUSP.C * (vy - vt)) * 0.05;
  vy = clamp(vy, -SUSP.VMAX, SUSP.VMAX);
  rest.suspVy = vy;
  return { vy, snap };
}
export const suspOffset = v => Math.round(clamp(v, SUSP.OFF_DOWN, SUSP.OFF_UP) * 40) / 40;
export function suspReset(rest) { rest.suspVy = 0; rest.suspPrev = undefined; }

/** Горизонтальная скорость на земле: колёса не скользят боком, без газа на малой скорости машина останавливается (тело может заснуть). */
export function rzGroundVel(vel, axle, grip, braking) {
  let x = vel.x, z = vel.z;
  if (SUSP.CALM) {
    const along = x * axle.x + z * axle.z;
    const k = Math.min(1, SUSP.LATERAL * grip);
    x -= (x - axle.x * along) * k;
    z -= (z - axle.z * along) * k;
    if (braking && grip >= 1) {
      const sp = Math.hypot(x, z), f = sp < 2.5 ? SUSP.SLIDE_DAMP : 0.92;
      x *= f; z *= f;
      if (sp * f < 0.04) { x = 0; z = 0; }
    }
  }
  return { x, z };
}

/**
 * Лежит ли машина. true = кузов свободен (физика движка), земля машину не держит, привод выключен. false = обычный режим колёс.
 * Вход при наклоне больше ~63 градусов, выход, когда она снова почти на колёсах и стоит.
 */
export function rzFlipStep(body, rest, session) {
  if (body.isSleeping) return rest.flipped === true;   // спящее тело не трогаем: ноль нагрузки на стоянке
  const o = body.localPointToWorld({ x: 0, y: 0, z: 0 }), u = body.localPointToWorld({ x: 0, y: 1, z: 0 });
  const upY = u.y - o.y;
  if (!rest.flipped) {
    if (upY >= SUSP.FLIP_ENTER) return false;
    rest.flipped = true; rest.flipQuiet = 0;
  }
  session.rzFlipped = true;
  rest.parkedPose = undefined; rest.parkedPosition = undefined; rest.parkTicks = 0; rest.settled = false;
  const v = body.velocity, w = body.angularVelocity;
  const lin = Math.hypot(v.x, v.y, v.z), ang = Math.hypot(w.x, w.y, w.z);
  const quiet = lin < 0.25 && ang < 0.3;
  rest.flipQuiet = quiet ? (rest.flipQuiet ?? 0) + 1 : 0;
  if (upY > SUSP.FLIP_EXIT && lin < 1 && ang < 0.8) {   // встала на колёса: обратно в обычный режим
    rest.flipped = false; session.rzFlipped = false; rest.flipQuiet = 0;
    body.setAngularVelocity({ x: 0, y: 0, z: 0 });
    suspReset(rest);
    return false;
  }
  if (rest.flipQuiet >= SUSP.FLIP_SLEEP) {   // лежит спокойно: усыпляем, как любое тело
    body.setVelocity({ x: 0, y: 0, z: 0 });
    body.setAngularVelocity({ x: 0, y: 0, z: 0 });
    body.sleep();
  }
  return true;
}

/**
 * Шаг 115: состояние «лежит». Когда машина упала (на нос, корму, борт, на одно колесо) и больше не может стоять на колёсах,
 * скрипт отпускает тело: колёсная опора, пружина, опрокидывающий момент и парковка выключены, дальше всё считает движок.
 * Тело усыпляется, как только затихло (или по таймеру), и пока оно спит, цикл колёс его пропускает: ноль нагрузки.
 * Возвращает true, пока тело в этом режиме (вызывающий делает continue).
 */
export function rzLie(body, rest, session) {
  rest.lying = true; rest.lyingQuiet = 0; rest.lyingTicks = 0; rest.tipTicks = 0; rest.tipStill = 0; rest.tipPose = undefined;
  rest.parkedPose = undefined; rest.parkedPosition = undefined; rest.parkTicks = 0; rest.settled = false; rest.probes = undefined;
  rest.airTicks = 0; rest.airQuiet = 0;
  if (session) session.rzAirborne = false;
  suspReset(rest);
}
export function rzLyingStep(body, rest, calmTicks = 15, maxTicks = 120, topple = false) {
  if (body.isSleeping) return true;
  const v = body.velocity, w = body.angularVelocity;
  const lin = Math.hypot(v.x, v.y, v.z), ang = Math.hypot(w.x, w.y, w.z);
  rest.lyingTicks = (rest.lyingTicks ?? 0) + 1;
  // шаг 118: тело на ребре (наклон примерно 20..78 градусов), например машина на одном колесе. Затухание шага 116 гасило медленное падение
  // и тело зависало под углом. Пока такое положение, не гасим вращение, а подталкиваем верх в сторону наклона (не дольше 90 тиков)
  let pushing = false;
  if (topple && rest.lyingTicks <= 40 && lin < 3 && ang < 1.5) {
    const o = body.localPointToWorld({ x: 0, y: 0, z: 0 }), u = body.localPointToWorld({ x: 0, y: 1, z: 0 });
    const ux = u.x - o.x, uy = u.y - o.y, uz = u.z - o.z, h = Math.hypot(ux, uz);
    if (uy > 0.2 && uy < 0.995) {
      // направление падения: от колеса (точки опоры) к центру масс, то есть на сторону, противоположную колесу; без колеса или при совпадении - по наклону верха
      let dx = ux, dz = uz, dl = h;
      if (topple && typeof topple === "object") {
        const wp = body.localPointToWorld(topple), cm = body.localPointToWorld(body.getCenterOfMass());
        const ex = cm.x - wp.x, ez = cm.z - wp.z, el = Math.hypot(ex, ez);
        if (el > 0.1) { dx = ex; dz = ez; dl = el; }
      }
      if (dl > 0.05) {
        const k = 0.2 / dl;
        body.setAngularVelocity({ x: w.x + dz * k, y: w.y, z: w.z - dx * k });
        pushing = true; rest.lyingQuiet = 0;
      }
    }
  }
  // шаг 116: гасим дрожь и подпрыгивание лежащего тела (медленные движения и отскок вверх), быстрое падение/качение не трогаем
  if (!pushing && lin < 3 && ang < 4) {
    const f = lin < 1 ? 0.55 : 0.8;
    body.setVelocity({ x: v.x * f, y: v.y > 0 ? v.y * 0.4 : v.y, z: v.z * f });
    body.setAngularVelocity({ x: w.x * f, y: w.y * f, z: w.z * f });
  }
  if (!pushing) rest.lyingQuiet = (lin < 0.6 && ang < 1.0) ? (rest.lyingQuiet ?? 0) + 1 : 0;
  // таймер страхует от вечной дрожи, но не замораживает тело, которое ещё реально катится или летит
  if (!pushing && (rest.lyingQuiet >= calmTicks || (rest.lyingTicks >= maxTicks && lin < 2.0))) {
    body.setVelocity({ x: 0, y: 0, z: 0 });
    body.setAngularVelocity({ x: 0, y: 0, z: 0 });
    body.sleep();
    rest.lyingQuiet = 0; rest.lyingTicks = 0;
  }
  return true;
}

/**
 * Воздух и приземление. airborne = все колёса выше опоры. Возвращает 1 (в воздухе), 2 (приземлилась с кувырком), 0 (на земле).
 * Кувырок: на приземлении быстрее IMPACT машина получает вращение вокруг горизонтальной оси поперёк движения (носом вниз), дальше движок.
 */
export function rzAirTrack(body, rest, session, airborne, forward) {
  if (airborne) {
    rest.airTicks = (rest.airTicks ?? 0) + 1;
    rest.airVy = body.velocity.y;
    session.rzAirborne = rest.airTicks >= 2;
    return 1;
  }
  const ticks = rest.airTicks ?? 0;
  rest.airTicks = 0; session.rzAirborne = false;
  if (ticks === 0) return 0;
  suspReset(rest);
  const impact = -(rest.airVy ?? 0);
  if (SUSP.FLIP_ON && ticks >= SUSP.AIR_TICKS && impact > SUSP.IMPACT) {
    const v = body.velocity, hs = Math.hypot(v.x, v.z);
    const dx = hs > 1.5 ? v.x / hs : forward.x, dz = hs > 1.5 ? v.z / hs : forward.z;
    const mag = clamp(2.5 + (impact - SUSP.IMPACT) * SUSP.KICK, 2.5, 7);
    const w = body.angularVelocity;
    body.setAngularVelocity({ x: w.x + dz * mag, y: w.y, z: w.z - dx * mag });
    rest.flipped = true; rest.flipQuiet = 0; session.rzFlipped = true;
    return 2;
  }
  return 0;
}


/** Просвет колёс машины, блоков: общая добавка + среднее по колёсным блокам (слайдер в меню колёсного блока). Пересчёт раз в 100 тиков. */
export function rzRideOf(session, tick) {
  if (!SUSP.ON || !session) return 0;
  if (session.rzRide === undefined || tick - (session.rzRideTick ?? -1000) >= 100) rzRideRecalc(session, tick);
  return clamp(SUSP.RIDE + session.rzRide, -0.2, 0.3);
}
export function rzRideRecalc(session, tick = 0) {
  let n = 0, sum = 0;
  for (const s of session.snapshots) if (isWheelMountId(s.typeId) && s.hasWheel) { n++; sum += Number(s.wheelRide) || 0; }
  session.rzRide = n ? sum / n : 0;
  session.rzRideTick = tick;
}

/**
 * Наклон от центра масс. Центр масс (локальный, rest.com) за крайними колёсами, стоящими на земле, наклоняет машину в эту сторону:
 * груз в носу клюёт носом, груз в корме задирает нос. Возвращает градусы, которые вычитаются из наклона по склону (плавно). 0 при выключенном TIP.
 */
export function rzTipBias(rest, body, supports, axis) {
  const com = rest.com;
  if (!SUSP.TIP || !com) { rest.tip = 0; return 0; }
  const comD = com.x * axis.x + com.z * axis.z;
  let lo = Infinity, hi = -Infinity;
  for (const s of supports) {
    if (s.virtual) continue;
    const p = body.localPointToWorld(s.wheel.localLocation);
    if (p.y - s.height - (s.ride ?? 0) > 0.3) continue;   // колесо над землёй (верхний каток, колесо в воздухе) опорой не считается
    const d = s.wheel.localLocation.x * axis.x + s.wheel.localLocation.z * axis.z;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  let target = 0;
  if (lo <= hi) {
    const over = comD > hi ? comD - hi : comD < lo ? comD - lo : 0;
    const eff = Math.max(0, Math.abs(over) - 0.15) * Math.sign(over);   // мёртвая зона: небольшой вынос не клюёт
    target = clamp(eff * SUSP.TIP_K, -SUSP.TIP_MAX, SUSP.TIP_MAX);
  }
  rest.tip = (rest.tip ?? 0) + (target - (rest.tip ?? 0)) * 0.15;
  return Math.abs(rest.tip) < 0.05 ? 0 : rest.tip;
}

/**
 * Точки корпуса, которыми машина щупает ступеньку впереди: для каждого из 3 боковых столбцов (края и середина) - самые выдвинутые вперёд
 * нижние края (до 3 на столбец, каждый следующий ниже предыдущего). Считается по блокам один раз (кэш в rest.hull, пересчёт раз в 100 тиков).
 * axis - локальная ось качения колёс, sign - куда едем (+1/-1). Возвращает локальные точки {x,y,z} чуть впереди передней грани.
 */
export function rzHullProbes(assembly, rest, axis, sign, tick) {
  let h = rest.hull;
  const blocks = assembly.blocks;
  if (!h || h.blocks !== blocks || h.count !== blocks.length || tick - h.tick >= 100 || h.ax !== axis.x || h.az !== axis.z) {
    h = rest.hull = { blocks, count: blocks.length, tick, ax: axis.x, az: axis.z, plus: hullEdge(blocks, axis, 1), minus: hullEdge(blocks, axis, -1) };
  }
  return sign >= 0 ? h.plus : h.minus;
}
function hullEdge(blocks, axis, sign) {
  const lat = { x: -axis.z, z: axis.x };
  const cols = new Map();
  for (const b of blocks) {
    if (b.visualEntityTypeId === "create_physics:physics_wheel" || b.collidable === false || b.collisionShape === "none") continue;
    const l = b.localLocation;
    let yb = -0.5;
    if (Array.isArray(b.collisionShape) && b.collisionShape.length) yb = Math.min(...b.collisionShape.map(box => box.min.y)) - 0.5;
    const a = sign * (l.x * axis.x + l.z * axis.z), c = Math.round(l.x * lat.x + l.z * lat.z);
    let col = cols.get(c);
    if (!col) cols.set(c, col = []);
    col.push({ a, y: l.y + yb });
  }
  if (!cols.size) return [];
  const keys = [...cols.keys()].sort((p, q) => p - q);
  const pick = new Set([keys[0], keys[keys.length - 1], keys[keys.length >> 1]]);
  const out = [];
  for (const c of pick) {
    const col = cols.get(c).sort((p, q) => q.a - p.a || p.y - q.y);
    let low = Infinity, n = 0;
    for (const e of col) {
      if (e.y >= low - 0.05) continue;
      low = e.y;
      const d = sign * (e.a + 0.5 + 0.12);
      out.push({ x: axis.x * d + lat.x * c, y: e.y, z: axis.z * d + lat.z * c });
      if (++n >= 3) break;
    }
  }
  return out;
}

const save = () => { try { world.setDynamicProperty(PROP_KEY, JSON.stringify(SUSP)); } catch {} };
export function installRzSusp() {
  try {
    system.run(() => {
      try {
        const raw = world.getDynamicProperty(PROP_KEY);
        if (typeof raw !== "string") return;
        const o = JSON.parse(raw);
        for (const key of Object.keys(SUSP)) if (Number.isFinite(o?.[key])) SUSP[key] = o[key];
      } catch {}
    });
    system.afterEvents.scriptEventReceive.subscribe(ev => {
      if (ev.id !== "rzlite:susp") return;
      const reply = m => { try { (ev.sourceEntity ?? world).sendMessage?.(m); } catch {} };
      const a = ev.message.trim().split(/\s+/);
      const w = (a[0] ?? "").toLowerCase(), flag = (a[1] ?? "").toLowerCase();
      if (w === "on" || w === "off") { SUSP.ON = w === "on" ? 1 : 0; save(); reply(`[susp] подвеска ${SUSP.ON ? "включена" : "выключена"}`); }
      else if (w === "flip" && (flag === "on" || flag === "off")) { SUSP.FLIP_ON = flag === "on" ? 1 : 0; save(); reply(`[susp] переворот при падении ${SUSP.FLIP_ON ? "включён" : "выключен"}`); }
      else if (w === "calm" && (flag === "on" || flag === "off")) { SUSP.CALM = flag === "on" ? 1 : 0; save(); reply(`[susp] спокойная стоянка ${SUSP.CALM ? "включена" : "выключена"}`); }
      else if (w === "set" && a[2] !== undefined && Number.isFinite(Number(a[2])) && Object.hasOwn(SUSP, (a[1] ?? "").toUpperCase())) {
        const name = a[1].toUpperCase(); SUSP[name] = Number(a[2]); save(); reply(`[susp] ${name} = ${SUSP[name]}`);
      } else reply(`[susp] ON=${SUSP.ON} FLIP_ON=${SUSP.FLIP_ON} CALM=${SUSP.CALM} K=${SUSP.K} C=${SUSP.C} UP=${SUSP.UP} IMPACT=${SUSP.IMPACT} RIDE=${SUSP.RIDE} STEP=${SUSP.STEP} HULL=${SUSP.HULL} TIP=${SUSP.TIP} TIP_K=${SUSP.TIP_K} TIP_MAX=${SUSP.TIP_MAX}. Команды: on | off | flip on|off | calm on|off | set <ИМЯ> <число> (RIDE, STEP, HULL 0/1, TIP 0/1, TIP_K, TIP_MAX, K, C, UP, IMPACT ...)`);
    });
  } catch {}
}
