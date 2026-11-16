/* CLAUDE-MAP-BEGIN
 FILE: core/cbcLooks.js  (5 KB, 103 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: DEAD.
 IMPORTS: lib/shapes/index.js
 IMPORTED BY: core/cbcMount.js, core/cbcMount.js
 EXPORTS: CBC, PARTS, LIFT_KIND, DIR_VEC, fixForFacing, setCbcFlip, LIFT_LOOK, cbcName, LIFT_KEY, cbcLook
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): fixForFacing@46(18L); cbcLook@89(14L); bedrock@30(9L); cbcName@76(6L); make@69(3L); same@41(1L); setCbcFlip@66(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// Внешность деталей пушек (cbc:*) на физических конструкциях.
//
// Каждая деталь — запечённая геометрия (RP/models/entity/phys_shapes.geo.json, генератор tools/gen_cbc_geos.py) и идёт общим путём блоков:
// сущность phys:block в позе конструкции (одна команда позы на всю конструкцию), без отдельной нагрузки на каждую деталь.
// Ориентация задаётся phys:fix. Геометрия нарисована для facing = up (ось ствола вдоль +Y), код fix подбирается так,
// чтобы ось ствола легла вдоль facing блока, а «перекат» совпал с поворотом блока в мире (minecraft:transformation из JSON блока).
//
// Пока заряженный ствол поднят или откатывается, его блоки (камеры и стволы) не рисуются блоками: extra["cbc:lift"] = "1"
// превращает look в пустой, а картинку даёт сущность phys:part (core/cbcMount.js).
import { turnPoint } from "../lib/shapes/index.js";

export const CBC = Object.freeze({
  GEO0: 2084, TEX0: 1148,                  // g2084.. и t1148.. : порядок как PARTS в tools/gen_cbc_geos.py
  KIND0: 33,                               // phys:part kind 33..36 (поднятые части)
  FACING: "minecraft:facing_direction",
});

export const PARTS = ["steel_cannon_barrel", "steel_cannon_chamber", "steel_screw_breech", "steel_sliding_breech", "steel_mortar_barrel",
  "steel_mortar_breech", "cast_iron_cannon_barrel", "cast_iron_cannon_chamber", "cast_iron_sliding_breech"];
/** Части, которые умеют подниматься: имя блока -> kind phys:part (33..36). */
export const LIFT_KIND = Object.freeze({ steel_cannon_barrel: 33, steel_cannon_chamber: 34, cast_iron_cannon_barrel: 35, cast_iron_cannon_chamber: 36 });

const DIR = { up: [0, 1, 0], down: [0, -1, 0], north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0] };
export const DIR_VEC = DIR;
// minecraft:transformation из JSON блоков cbc (поворот в градусах, X потом Y)
const ROT = { up: [0, 0, 0], down: [180, 0, 0], north: [90, 0, 0], south: [90, 180, 0], east: [90, 90, 0], west: [90, 270, 0] };
const D2R = Math.PI / 180;

/** Поворот Bedrock (по часовой стрелке) вокруг X, затем Y применяется к вектору. */
function bedrock(rot, v) {
  const [ax, ay] = rot;
  let [x, y, z] = v;
  const ca = Math.cos(ax * D2R), sa = Math.sin(ax * D2R);
  [y, z] = [y * ca + z * sa, -y * sa + z * ca];
  const cb = Math.cos(ay * D2R), sb = Math.sin(ay * D2R);
  [x, z] = [x * cb - z * sb, x * sb + z * cb];
  return [Math.round(x), Math.round(y), Math.round(z)];
}

const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const fixCache = new Map();
let roll180 = false;   // переключатель на случай, если модель получилась повёрнутой на 180° (см. setCbcFlip)

/** Код phys:fix для facing: ось ствола -> направление facing, «перекат» как у блока в мире (если не нашлось точного совпадения — достаточно оси). */
export function fixForFacing(facing) {
  const key = facing + (roll180 ? "|f" : "");
  let r = fixCache.get(key);
  if (r !== undefined) return r;
  const rot = ROT[facing] ?? ROT.up;
  const want = AXES.map(a => bedrock(roll180 ? [rot[0], rot[1] + 180, 0] : rot, a));
  let axisOnly = -1;
  r = -1;
  for (let t = 0; t < 64; t++) {
    const up = turnPoint(t, AXES[1]).map(Math.round);
    if (!same(up, want[1])) continue;
    if (axisOnly < 0) axisOnly = t;
    if (AXES.every((a, i) => same(turnPoint(t, a).map(Math.round), want[i]))) { r = t; break; }
  }
  if (r < 0) r = axisOnly < 0 ? 0 : axisOnly;
  fixCache.set(key, r);
  return r;
}

/** /scriptevent phys:veh cbcflip — развернуть модели пушек на 180° вокруг оси ствола (после смены вызвать refreshAllLooks). */
export function setCbcFlip(v) { v = v === true; if (v !== roll180) { roll180 = v; fixCache.clear(); looks.clear(); } }

const looks = new Map();
function make(geo, tex, fix) {
  return { geo, tex, frames: 1, frametime: 1, blend: false, cube: false, cull: false, lid: false, holes: false, fix, mask: 0, bounds: undefined, shape: undefined, yaw: 0 };
}

/** look для клетки, пока её рисует сущность-часть: модели нет, но клетка не считается непрозрачным кубом. */
export const LIFT_LOOK = make(CBC.GEO0, CBC.TEX0, 0);

export function cbcName(type) {
  if (!type.startsWith("cbc:")) return undefined;
  let n = type.slice(4);
  if (n.endsWith("_hidden")) n = n.slice(0, -7);
  return PARTS.includes(n) ? n : undefined;
}

export const LIFT_KEY = "cbc:lift";

/**
 * look { geo, tex, ... } (формат lib/shapes/looks.js), "lift" (деталь временно рисует сущность-часть) или undefined (не блок пушки).
 * s: сохранённые состояния блока, extra: данные клетки.
 */
export function cbcLook(type, s, extra) {
  const name = cbcName(type);
  if (name === undefined) return undefined;
  if (extra !== undefined && extra[LIFT_KEY] === "1" && LIFT_KIND[name] !== undefined) return "lift";
  const f = s?.[CBC.FACING];
  const facing = typeof f === "string" && DIR[f] !== undefined ? f : "up";
  const key = name + "|" + facing;
  let look = looks.get(key);
  if (look === undefined) {
    const i = PARTS.indexOf(name);
    looks.set(key, look = make(CBC.GEO0 + i, CBC.TEX0 + i, fixForFacing(facing)));
  }
  return look;
}
