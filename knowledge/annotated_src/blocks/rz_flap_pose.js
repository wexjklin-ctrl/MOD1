/* CLAUDE-MAP-BEGIN
 FILE: blocks/rz_flap_pose.js  (5 KB, 72 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (auto, from first comment) Шаг 137: рули высоты и направления (sim:block__
 IMPORTS: blocks/rz_parts.js
 IMPORTED BY: blocks/airplane_flight.js, blocks/rz_air_control.js
 EXPORTS: FLAP_CFG, eulerToQuat, quatToEuler, flapRotation, stepFlapPoses
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): stepFlapPoses@39(33L); quatToEuler@18(9L); eulerToQuat@13(5L); flapRotation@30(4L); mul@27(2L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// Шаг 137: рули высоты и направления (sim:block__*_symmetric_sail) красиво отклоняются на самолёте RZ.
// Угол берётся готовым из модели полёта (plate.defl, радианы, поворот нормали вокруг оси шарнира h), поэтому визуал совпадает с физикой
// и ничего нового не считается. Горизонтальная пластина качается вверх-вниз (шарнир поперёк носа), вертикальная - влево-вправо.
// Только визуал: коллайдеры не трогаются (setArticulatedBlockTransforms не вызывается), запись свойств - лишь при смене угла на шаг QUANT.
// Клиент сам сглаживает local_* за 50 мс, так что шаг 1.5 градуса выглядит плавно. НЕ проверено в игре.
import { rzBlockRotation } from "./rz_parts.js";

export const FLAP_CFG = { INV: false, MAX_DEG: 40, QUANT: 1.5 };   // /scriptevent rzlite:air flap_inv - если рули качаются в обратную сторону
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const FLAP_IDS = new Set(["sim:block__black_symmetric_sail", "sim:block__brown_symmetric_sail", "sim:block__gray_symmetric_sail", "sim:block__white_symmetric_sail", "sim:block__light_gray_symmetric_sail", "sim:block__red_symmetric_sail", "sim:block__orange_symmetric_sail", "sim:block__yellow_symmetric_sail", "sim:block__lime_symmetric_sail", "sim:block__green_symmetric_sail", "sim:block__cyan_symmetric_sail", "sim:block__light_blue_symmetric_sail", "sim:block__blue_symmetric_sail", "sim:block__purple_symmetric_sail", "sim:block__magenta_symmetric_sail", "sim:block__pink_symmetric_sail", "sim:block__copper_symmetric_sail", "sim:block__iron_symmetric_sail", "sim:block__netherite_symmetric_sail"]);

// Эйлер (x,y,z градусы) в порядке YZX, как в rotateVectorByEulerDegreesYzx (main.js) -> кватернион [w,x,y,z]
export function eulerToQuat(r) {
  const hx = r.x * D2R / 2, hy = r.y * D2R / 2, hz = r.z * D2R / 2;
  const c1 = Math.cos(hx), c2 = Math.cos(hy), c3 = Math.cos(hz), s1 = Math.sin(hx), s2 = Math.sin(hy), s3 = Math.sin(hz);
  return [c1 * c2 * c3 - s1 * s2 * s3, s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 + s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3];
}
export function quatToEuler(q) {
  const [w, x, y, z] = q;
  const m11 = 1 - 2 * (y * y + z * z), m13 = 2 * (x * z + y * w), m21 = 2 * (x * y + z * w), m22 = 1 - 2 * (x * x + z * z),
    m23 = 2 * (y * z - x * w), m31 = 2 * (x * z - y * w), m33 = 1 - 2 * (x * x + y * y);
  const ez = Math.asin(Math.max(-1, Math.min(1, m21)));
  let ex = 0, ey;
  if (Math.abs(m21) < 0.9999999) { ex = Math.atan2(-m23, m22); ey = Math.atan2(-m31, m11); } else ey = Math.atan2(m13, m33);
  return { x: ex * R2D, y: ey * R2D, z: ez * R2D };
}
const mul = (a, b) => [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
// Поза: базовый поворот блока, затем отклонение на angleDeg вокруг оси шарнира h (в осях конструкции)
export function flapRotation(baseQ, h, angleDeg) {
  const a = angleDeg * D2R / 2, s = Math.sin(a);
  return quatToEuler(mul([Math.cos(a), h[0] * s, h[1] * s, h[2] * s], baseQ));
}

/**
 * Раз в тик после rig.step. Обновляет session.rzFlapPoses (Map "x,y,z" -> {rotation}) и session.rzFlapVersion (растёт при изменении).
 * Индекс рулей перестраивается только при смене модели (rig.plates), дальше цикл по 1-6 рулям без выделения памяти.
 */
export function stepFlapPoses(session, rig) {
  if (!rig) return;
  if (session.rzFlapPlates !== rig.plates || session.rzFlapTopo !== session.snapshots) {
    session.rzFlapPlates = rig.plates; session.rzFlapTopo = session.snapshots;
    const sx = session.location.x, sy = session.location.y, sz = session.location.z, byKey = new Map();
    for (const s of session.snapshots) if (FLAP_IDS.has(s.typeId)) byKey.set(`${s.location.x - sx},${s.location.y - sy},${s.location.z - sz}`, s);
    const list = [];
    for (const p of rig.plates) {
      if (!p.ctrl) continue;
      const key = `${Math.round(p.x + 0.5)},${Math.round(p.y + 0.5)},${Math.round(p.z + 0.5)}`, snap = byKey.get(key);
      if (!snap) continue;
      const base = rzBlockRotation(snap) ?? { x: 0, y: 0, z: 0 };
      list.push({ key, plate: p, base, baseQ: eulerToQuat(base), h: [p.hx, p.hy, p.hz], q: 0 });
    }
    session.rzFlapList = list;
    session.rzFlapPoses = new Map();
    session.rzFlapVersion = (session.rzFlapVersion ?? 0) + 1;
    for (const e of list) e.q = NaN;   // первая запись обязательна
  }
  const list = session.rzFlapList;
  if (!list?.length) return;
  const step = FLAP_CFG.QUANT, max = FLAP_CFG.MAX_DEG, sign = FLAP_CFG.INV ? -1 : 1;
  let changed = false;
  for (const e of list) {
    let deg = e.plate.defl * R2D * sign;
    deg = Math.max(-max, Math.min(max, deg));
    const q = Math.round(deg / step) * step || 0;
    if (q === e.q) continue;
    e.q = q; changed = true;
    session.rzFlapPoses.set(e.key, { rotation: q === 0 ? { ...e.base } : flapRotation(e.baseQ, e.h, q) });
  }
  if (changed) session.rzFlapVersion = (session.rzFlapVersion ?? 0) + 1;
}
