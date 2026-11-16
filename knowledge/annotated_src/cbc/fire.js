/* CLAUDE-MAP-BEGIN
 FILE: cbc/fire.js  (11 KB, 178 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: cbc/ballistics.js, cbc/config/materials.generated.js, cbc/config/munitions.generated.js, cbc/config/overrides.js, cbc/config/propellants.generated.js, cbc/loading.js, cbc/multiblock.js, i18n/i18n.js
 IMPORTED BY: cbc/cmMount.js, cbc/effects.js, cbc/projectiles.js, cbc/twin.js, cbc/world.js, cbc/world.js, core/cbcMount.js
 EXPORTS: planShot, chargeGain, estimateRange, barrelFactor, rangeAt45, rangeAtDeg, speedForRange, speedForTarget, flightParams, impactPlan, mortarScatter
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): planShot@18(35L); speedForRange@94(20L); speedForTarget@116(17L); impactPlan@139(17L); mortarScatter@162(16L); rangeAtDeg@79(13L); chargeGain@58(8L); estimateRange@67(4L); barrelFactor@72(4L); flightParams@134(4L); num@16(1L); rangeAt45@77(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { __t } from "../i18n/i18n.js";
// Расчёт выстрела (чистая логика, без Script API). Числа берутся из *.generated.ts; формулы СОБСТВЕННЫЕ (упрощённая модель).
// ДОПУЩЕНИЯ (не из данных мода, откалибровать по ощущениям): скорость = заряды * strength * SPEED_PER_POWER;
// разброс (в градусах) = max(minimumSpread, addedSpread * заряды - spreadReductionPerBarrel * стволы);
// перегрузка = заряды * addedStress > maxSafePropellantStress материала. Правило «снаряд застревает, если скорость < minimumVelocityPerBarrel * стволов»
// пока НЕ реализовано (при 1 заряде и 3 стволах чугуна оно блокировало бы любой выстрел).
import { applySpread, stepFlight } from "./ballistics.js";
import { BARREL_SPEED, IMPACT, LIMITS, LONG_BARREL, MORTAR, SHORT_BARREL, SPEED_PER_POWER, rulesFor } from "./config/overrides.js";
import { chargeCapacity } from "./loading.js";
import { MATERIALS } from "./config/materials.generated.js";
import { MUNITIONS } from "./config/munitions.generated.js";
import { PROPELLANTS } from "./config/propellants.generated.js";
import { dirVec } from "./multiblock.js";
const MAT = MATERIALS;
const MUN = MUNITIONS;
const num = (v, d) => (typeof v === "number" ? v : d);
/** План выстрела по состоянию пушки. rnd нужен для воспроизводимых тестов. */
export function planShot(scan, load, rnd = Math.random) {
    const base = { ok: false, overloaded: false, munitionId: load.projectileId ?? "", speed: 0, spreadDeg: 0, velocity: { x: 0, y: 0, z: 0 } };
    if (!scan.valid)
        return { ...base, reason: __t(66, scan.reason ?? "?") };
    if (!load.projectileId)
        return { ...base, reason: __t(67) };
    if (!MUN[load.projectileId])
        return { ...base, reason: __t(68, load.projectileId) };
    if (load.charges < 1)
        return { ...base, reason: __t(69) };
    const mat = MAT[scan.materialId];
    if (!mat)
        return { ...base, reason: __t(70, scan.materialId) };
    const prop = PROPELLANTS.powder_charge;
    // Перегрузки по «напряжению» больше нет: число зарядов ограничивает ёмкость камер (loading.chargeCapacity), лишнее просто не влезает.
    const charges = Math.min(load.charges, chargeCapacity(scan));
    const rules = rulesFor(scan.materialId); // сборка 82: баллистика у миномётного затвора как у стали (ограничены только длина ствола и угол)
    const baseSpeed = prop.strength * SPEED_PER_POWER; // скорость при 1 заряде и «среднем» стволе, блоков/тик
    const fp = flightParams(load.projectileId);
    const bf = barrelFactor(scan.barrels, rules.maxBarrels);
    const v1 = baseSpeed * bf; // длина ствола задаёт скорость 1 заряда, +% дальности за заряд считается от неё (точно при любой длине)
    const gain = chargeGain(rules, fp);
    const speed = speedForRange(v1, (1 + gain * (charges - 1)) * (rules.rangeBonus ?? 1), fp);
    let spreadDeg = Math.max(num(mat.minimumSpread, 0), prop.addedSpread * charges - num(mat.spreadReductionPerBarrel, 0) * scan.barrels);
    if (scan.barrels < SHORT_BARREL.minBarrels)
        spreadDeg += SHORT_BARREL.extraSpreadDeg; // короче 2 стволов: разброс сильно растёт (от 2 стволов остаётся как раньше)
    if (scan.barrels >= LONG_BARREL.minBarrels)
        spreadDeg *= LONG_BARREL.spreadMultiplier; // от 10 стволов: разброс на 30% меньше
    const d = dirVec(scan.direction);
    const dir = applySpread(d, (spreadDeg * Math.PI) / 180, rnd);
    return {
        ok: true, overloaded: false, munitionId: load.projectileId, speed, spreadDeg,
        velocity: { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed },
    };
}
/**
 * Прирост дальности за каждый заряд сверх первого. Если у материала задан maxRange, прирост выводится так, чтобы полная пушка
 * (максимум камер*зарядов и максимальная длина ствола, 45°) била ровно на maxRange, а дальность 1 заряда осталась прежней (не зависит от maxRange).
 * Иначе берётся rangePerCharge из CANNON_RULES.
 */
export function chargeGain(rules, params) {
    if (!rules.maxRange)
        return rules.rangePerCharge;
    const maxCharges = rules.maxChambers * rules.chargesPerChamber;
    const baseSpeed = PROPELLANTS.powder_charge.strength * SPEED_PER_POWER;
    const r1 = rangeAt45(baseSpeed * barrelFactor(rules.maxBarrels, rules.maxBarrels), params);
    return Math.max(0, (rules.maxRange / r1 - 1) / (maxCharges - 1));
}
/** Ожидаемая дальность при 45° (блоков) для собранной пушки и числа зарядов (для отчёта игроку). */
export function estimateRange(scan, charges) {
    const plan = planShot(scan, { projectileId: "he_shell", charges: Math.max(1, charges) }, () => 0);
    return plan.ok ? rangeAt45(plan.speed, flightParams("he_shell")) : 0;
}
/** Множитель скорости от длины ствола: 1 ствол = min, растёт с убывающей отдачей до max при maxBarrels (у материала свой максимум; см. BARREL_SPEED). */
export function barrelFactor(barrels, maxBarrels = 15) {
    const t = Math.max(0, Math.min(1, (barrels - 1) / Math.max(1, maxBarrels - 1)));
    return BARREL_SPEED.max - (BARREL_SPEED.max - BARREL_SPEED.min) * (1 - t) * (1 - t);
}
/** Дальность полёта при угле 45° (до возврата на исходную высоту) с учётом сопротивления снаряда. Нужна для калибровки «+X% дальности за заряд». */
export function rangeAt45(speed, params) { return rangeAtDeg(speed, params, 45); }
/** Дальность при угле deg (до возврата на высоту выстрела). */
export function rangeAtDeg(speed, params, deg) {
    const cx = Math.cos(deg * Math.PI / 180), cy = Math.sin(deg * Math.PI / 180);
    let s = { pos: { x: 0, y: 0, z: 0 }, vel: { x: speed * cx, y: speed * cy, z: 0 }, age: 0 };
    for (let i = 0; i < 4000; i++) {
        const n = stepFlight(s, params);
        if (n.pos.y <= 0 && n.vel.y < 0) {
            const k = s.pos.y / (s.pos.y - n.pos.y); // линейная интерполяция точки возврата
            return s.pos.x + (n.pos.x - s.pos.x) * k;
        }
        s = n;
    }
    return s.pos.x;
}
const speedCache = new Map();
/** Скорость, при которой дальность (при 45°) в `mult` раз больше, чем у скорости `v1`. Бисекция по симуляции: учитывает сопротивление воздуха снаряда. */
export function speedForRange(v1, mult, params) {
    if (mult <= 1)
        return v1;
    const key = `${v1}|${mult}|${params.gravity}|${params.drag}|${params.quadraticDrag}`;
    const hit = speedCache.get(key);
    if (hit !== undefined)
        return hit;
    const target = rangeAt45(v1, params) * mult;
    let lo = v1, hi = v1 * Math.max(2, Math.sqrt(mult) * 3);
    for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (rangeAt45(mid, params) < target)
            lo = mid;
        else
            hi = mid;
    }
    const v = (lo + hi) / 2;
    speedCache.set(key, v);
    return v;
}
const targetCache = new Map();
/** Скорость, при которой дальность (при 45°) равна `target` блоков. Бисекция по симуляции (rangeAt45 растёт со скоростью). */
export function speedForTarget(target, params) {
    const key = `${target}|${params.gravity}|${params.drag}|${params.quadraticDrag}`;
    const hit = targetCache.get(key);
    if (hit !== undefined)
        return hit;
    let lo = 0.05, hi = 60;
    for (let i = 0; i < 50; i++) {
        const mid = (lo + hi) / 2;
        if (rangeAt45(mid, params) < target)
            lo = mid;
        else
            hi = mid;
    }
    const v = (lo + hi) / 2;
    targetCache.set(key, v);
    return v;
}
/** Параметры полёта из данных мода (gravity, drag, quadraticDrag). */
export function flightParams(munitionId) {
    const m = MUN[munitionId] ?? {};
    return { gravity: num(m.gravity, -0.05), drag: num(m.drag, 0.01), quadraticDrag: m.quadraticDrag === true };
}
/** Что делает снаряд при ударе. Радиус из данных мода, но не выше LIMITS.maxExplosionRadius. Без взрывчатки: лёгкий удар без разрушения. */
export function impactPlan(munitionId) {
    // Сборка 37: данные из IMPACT (config/overrides.js). Радиус здесь нужен только эффектам (частицам), урон считает impact.js.
    const spec = IMPACT[munitionId];
    if (spec) {
        const r = Math.max(spec.area?.radius ?? 0, spec.blocks ? 4 : 0);
        if (r <= 0)
            return { radius: 1, breaksBlocks: false };
        return { radius: Math.min(LIMITS.maxExplosionRadius, r), breaksBlocks: !!spec.blocks };
    }
    const m = MUN[munitionId] ?? {};
    const blockPower = num(m.blockDamagingExplosivePower, 0);
    const entityPower = num(m.entityDamagingExplosivePower, 0);
    const power = Math.max(blockPower, entityPower);
    if (power <= 0)
        return { radius: 1, breaksBlocks: false };
    return { radius: Math.min(LIMITS.maxExplosionRadius, power), breaksBlocks: blockPower > 0 };
}

/**
 * Миномётный разлёт (сборка 79). vel: итоговая скорость снаряда (с наклоном ствола), th: угол ствола, vertical: пушка вверх/вниз.
 * Горизонтальная пушка: точка падения смещается в случайную точку круга радиуса R (не больше reachFraction дальности):
 * боковое смещение даёт поворот скорости вокруг Y, продольное - изменение скорости (дальность ~ v^2).
 */
export function mortarScatter(vel, mortars, th, params, vertical, rnd = Math.random) {
    if (!mortars || mortars < 1)
        return vel;
    const n = Math.min(MORTAR.maxCount, mortars);
    if (vertical)
        return (() => { const sp = Math.hypot(vel.x, vel.y, vel.z); const d = applySpread(vel, (MORTAR.coneDeg[n] * Math.PI) / 180, rnd); return { x: d.x * sp, y: d.y * sp, z: d.z * sp }; })();
    const speed = Math.hypot(vel.x, vel.y, vel.z);
    const D = Math.max(10, rangeAtDeg(speed, params, Math.max(5, th)));
    const R = Math.min(MORTAR.radius[n], D * MORTAR.reachFraction);
    const r = R * Math.sqrt(rnd()), a = rnd() * Math.PI * 2;
    const lat = r * Math.cos(a), lon = r * Math.sin(a);
    const yaw = Math.atan(lat / D);
    const k = Math.max(0.3, Math.min(1.4, Math.sqrt(Math.max(0.05, 1 + lon / D))));
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return { x: (vel.x * c - vel.z * s) * k, y: vel.y * k, z: (vel.x * s + vel.z * c) * k };
}
