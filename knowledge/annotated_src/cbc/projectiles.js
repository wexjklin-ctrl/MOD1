/* CLAUDE-MAP-BEGIN
 FILE: cbc/projectiles.js  (28 KB, 548 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: Projectile entities/ballistics glue.
 IMPORTS: @minecraft/server, cbc/ballistics.js, cbc/config/overrides.js, cbc/effects.js, cbc/fire.js, cbc/impact.js, cbc/perf.js, i18n/i18n.js
 IMPORTED BY: cbc/admin.js, cbc/cmMount.js, cbc/main.js, cbc/twin.js, cbc/world.js, core/cbcMount.js
 EXPORTS: PROJECTILE_TYPE, liveCount, liveProjectiles, areaCount, clearProjectiles, spawnProjectile, cleanupOrphans, startFlightLoop
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): advance@319(148L); advanceFuze@265(36L); manageChunks@171(31L); acquire@127(30L); tick@484(29L); blast@215(20L); pathChunks@103(17L); flyby@302(16L); spawnProjectile@71(14L); moveEntity@236(14L); updateThrottle@470(14L); spawnEntitySafe@57(13L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { __t, __R } from "../i18n/i18n.js";
// Снаряды в мире: сущность cbc:projectile + полёт по баллистике каждый тик + удар по блоку -> взрыв.
// Проверено справочником: Dimension.spawnEntity / getBlockFromRay (maxDistance — манхэттенская!) / createExplosion / playSound / isChunkLoaded / getEntities({type}).
// TODO-VERIFY (в игре не запускалось): Entity.teleport(pos, { facingLocation }), Entity.remove(), синтаксис события в spawnEntity "id<event>".
// Сборка 37: попадание в сущности по пути, пробитие блоков и урон по площади считает impact.js. Рикошета нет.
import { system, world } from "@minecraft/server";
import { AUTOCANNON, AUTOCANNON_HIT_PAD, DEBUG, FLYBY, FUZE, IMPACT, LIMITS, LONG_RANGE } from "./config/overrides.js";
import { stepFlight } from "./ballistics.js";
import { fuseSpark, impactEffects, trail } from "./effects.js";
import { flightParams } from "./fire.js";
import { structureRay, applyImpact, areaHit, breakBlocks, classify, findEntityHit, probeTwin, tryPierce } from "./impact.js";
import { sampleTps, slowFactor } from "./perf.js";
export const PROJECTILE_TYPE = "cbc:projectile";
const OWN_STRUCT_GRACE_TICKS = 25;   // шаг 150
const live = [];
export function liveCount() { return live.length; }
/** (v1.9.33) живые снаряды: structures.js не выгружает конструкции рядом с ними (дальняя артиллерия). */
export function liveProjectiles() { return live; }
/** Сколько областей загрузки (ticking area) сейчас держат снаряды (диагностика, /scriptevent phys:cbc perf). */
export function areaCount() { return owned.size; }
/** Убрать все снаряды из воздуха (меню администратора). Возвращает, сколько убрано. */
export function clearProjectiles() {
    const n = live.length;
    for (const p of live) {
        try {
            p.entity.remove();
        }
        catch { /* уже удалена */ }
        releaseAll(p);
    }
    live.length = 0;
    return n;
}
const LONG_SHOT = 150; // дальше этого (блоков от дула) о попадании и потере снаряда сообщаем в чат: чтобы можно было найти воронку
function distOf(p, pt) { return Math.round(Math.hypot(pt.x - p.origin.x, pt.z - p.origin.z)); }
function notifyLong(p, pt, text, always = false) {
    try {
        if (always || distOf(p, pt) >= LONG_SHOT)
            __R.sendMessage(world, text);
    }
    catch { /* ignore */ }
}
// Сборка 40: ошибки полёта больше не глотаются молча (не чаще раза в 5 секунд, чтобы не засорять чат).
let lastErrTick = -1e9;
function reportError(what, e) {
    try {
        if (system.currentTick - lastErrTick < 100)
            return;
        lastErrTick = system.currentTick;
        __R.log("warn", `[CBC] ${what}: ${String(e)}`);
    }
    catch { /* ignore */ }
}
function dbg(text) { if (DEBUG)
    __R.log("warn", `[CBC dbg] ${text}`); }
/** spawnEntity с запасным вариантом: если событие-вариант не сработало, создаём сущность без него (лучше снаряд с базовой текстурой, чем молчаливый невылет). */
function spawnEntitySafe(dim, pos, munitionId) {
    try {
        return dim.spawnEntity(PROJECTILE_TYPE, pos, { spawnEvent: `cbc:set_${AUTOCANNON[munitionId]?.visual ?? munitionId}` }); // сборка 71: у новых патронов визуал общий (visual)
    }
    catch (e1) {
        try {
            return dim.spawnEntity(PROJECTILE_TYPE, pos);
        }
        catch {
            throw e1;
        }
    }
}
/** Создать снаряд. Событие `cbc:set_<munitionId>` выбирает вариант (текстуру) в BP-сущности. */
export function spawnProjectile(dim, pos, vel, munitionId, fuzeSec = 0, opts = {}) { // сборка 71: opts = { gravityMult, power } (части бронзовой пушки)
    const entity = spawnEntitySafe(dim, pos, munitionId);
    const fp = flightParams(munitionId);
    const params = opts.gravityMult && opts.gravityMult !== 1 ? { ...fp, gravity: fp.gravity * opts.gravityMult } : fp;
    const p = { entity, dim, origin: { x: pos.x, y: pos.y, z: pos.z }, power: opts.power ?? 1, owner: opts.owner, st: { pos, vel, age: 0 }, params, munitionId, fuzeTicks: munitionId === "he_shell" ? Math.round(Math.max(0, Number(fuzeSec) || 0) * 20) : 0, keys: new Set(), hold: 0, waited: 0, tickN: 0, acc: 0, dead: false };
    live.push(p);
    try {
        manageChunks(p, p.st);
    }
    catch (e) {
        dbg(`ticking area: ${String(e)}`);
    }
    ensureLoop();
}
// ---- Дальний выстрел: по одному чанку на пути снаряда, только если он ещё не загружен, и только пока снаряд рядом ----
// Область = ровно 1 чанк (без прямоугольника-«ящика» вокруг диагонали). Общие для снарядов (счётчик ссылок), снимаются, как только снаряд проехал чанк.
const owned = new Map(); // "dim|cx,cz" -> { name, refs, ready, drop }
const failedAt = new Map(); // "dim|cx,cz" -> тик последней неудачи создания области (повторяем не чаще раза в 10 тиков)
let areaSeq = 0;
const clampY = (y) => Math.max(-60, Math.min(300, y)); // сборка 70
function tam() { try {
    return world.tickingAreaManager;
}
catch {
    return undefined;
} }
/**
 * Чанки вдоль пути на lookaheadTicks вперёд (высота не важна).
 * Сборка 40: выборка каждые 0.5 блока (было 8). Раньше путь по диагонали мог «срезать» угол чанка между точками выборки,
 * этот чанк не удерживался, и снаряд, шагнув в него, пропадал («снаряд потерян: чанк впереди не загрузился»).
 * Это только арифметика (без вызовов API), на нагрузку не влияет; дорогие isChunkLoaded вызываются по-прежнему только для уникальных чанков.
 */
function pathChunks(s) {
    const L = LONG_RANGE.lookaheadTicks, v = s.vel;
    const dx = v.x * L, dz = v.z * L;
    const n = Math.min(2000, Math.max(1, Math.ceil(Math.hypot(dx, dz) * 2)));
    const out = new Map();
    let lastKey = "";
    for (let i = 0; i <= n; i++) {
        const k = i / n;
        const cx = Math.floor((s.pos.x + dx * k) / 16), cz = Math.floor((s.pos.z + dz * k) / 16);
        const key = `${cx},${cz}`;
        if (key === lastKey)
            continue;
        lastKey = key;
        out.set(key, { cx, cz });
    }
    return out;
}
function dropEntry(T, key, e) {
    try {
        T.removeTickingArea(e.name);
    }
    catch { /* ignore */ }
    owned.delete(key);
}
function acquire(T, p, ck, c) {
    const key = `${p.dim.id}|${ck}`;
    let e = owned.get(key);
    if (!e) {
        if (owned.size >= LONG_RANGE.maxChunks)
            return;
        if (system.currentTick - (failedAt.get(key) ?? -1e9) < 10)
            return;
        const opts = { dimension: p.dim, from: { x: c.cx * 16, y: 0, z: c.cz * 16 }, to: { x: c.cx * 16 + 15, y: 0, z: c.cz * 16 + 15 } };
        try {
            if (!T.hasCapacity(opts)) {
                failedAt.set(key, system.currentTick);
                return;
            }
        }
        catch { /* нет метода: пробуем создать */ }
        e = { name: `cbc_c${++areaSeq}`, refs: 0, ready: false, drop: false };
        const made = e;
        owned.set(key, made);
        T.createTickingArea(made.name, opts).then(() => {
            failedAt.delete(key);
            made.ready = true;
            if (made.drop && made.refs <= 0)
                dropEntry(T, key, made);
        }).catch((err) => { owned.delete(key); failedAt.set(key, system.currentTick); dbg(__t(113, String(err))); });
    }
    e.drop = false;
    e.refs++;
    p.keys.add(key);
}
function release(T, p, key) {
    p.keys.delete(key);
    const e = owned.get(key);
    if (!e)
        return;
    e.refs--;
    if (e.refs > 0)
        return;
    if (e.ready)
        dropEntry(T, key, e);
    else
        e.drop = true; // ещё грузится: снимем, когда загрузится
}
/** Держать загруженными чанки на пути вперёд (кроме уже загруженных кем-то) и отпускать пройденные. */
function manageChunks(p, s) {
    const T = LONG_RANGE.enabled ? tam() : undefined;
    if (!T || p.dead)
        return;
    const want = pathChunks(s);
    const wantKeys = new Set();
    // сборка 70: в мире лимит ~10 областей загрузки; раньше просили сразу все чанки на 12 тиков вперёд (быстрый снаряд = десятки), область не создавалась и снаряд «терялся».
    // Теперь держим не больше maxAheadAreas ближайших незагруженных чанков по ходу пути, остальные запросятся по мере движения.
    const maxAhead = LONG_RANGE.maxAheadAreas ?? 6;
    let ahead = 0;
    for (const [ck, c] of want) {
        const key = `${p.dim.id}|${ck}`;
        wantKeys.add(key);
        if (p.keys.has(key)) {
            if (owned.has(key)) {
                ahead++;
                continue;
            }
            p.keys.delete(key); // область пропала (не создалась/снята): забываем и просим заново, иначе снаряд ждал бы её вечно
        }
        if (!owned.has(key) && p.dim.isChunkLoaded({ x: c.cx * 16 + 8, y: clampY(s.pos.y), z: c.cz * 16 + 8 }))
            continue; // уже загружен (игроком или другим снарядом): ничего не делаем
        if (ahead >= maxAhead)
            continue;
        ahead++;
        acquire(T, p, ck, c);
    }
    for (const key of [...p.keys])
        if (!wantKeys.has(key))
            release(T, p, key);
}
function releaseAll(p) {
    p.dead = true;
    const T = tam();
    if (T)
        for (const key of [...p.keys])
            release(T, p, key);
    p.keys.clear();
}
function explode(p, point, dir, entity) {
    const at = { x: point.x - dir.x * 0.25, y: point.y - dir.y * 0.25, z: point.z - dir.z * 0.25 }; // чуть отступить от грани
    blast(p, at, dir, entity);
}
/** Взрыв снаряда ровно в точке at (для снаряда с задержкой взрыватель считает точку сам). */
function blast(p, at, dir, entity) {
    try {
        applyImpact(p.dim, p.munitionId, at, entity, dir, p.power ?? 1); // сборка 37: урон по существам и блокам считает impact.js (createExplosion больше не используется)
    }
    catch (e) {
        dbg(__t(114, String(e)));
    }
    try {
        const ac = AUTOCANNON[p.munitionId]; // сборка 62: автопушечные снаряды: свой звук и громкость (флак = звук разрыва из аддона)
        if (ac?.flak)
            p.dim.playSound("cbc.flak_round_explosion", at, { volume: ac.hitVolume, pitch: ac.hitPitch });
        else if (ac)
            p.dim.playSound("cbc.shell_explosion", at, { volume: ac.hitVolume, pitch: ac.hitPitch });
        else
            p.dim.playSound("cbc.shell_explosion", at, { volume: 4 });
    }
    catch { /* звук не критичен */ }
    impactEffects(p.dim, at, p.munitionId);
    notifyLong(p, at, __t(115, Math.round(at.x), Math.round(at.y), Math.round(at.z), distOf(p, at)));
}
/** Переместить сущность снаряда. Если она пропала (выгрузилась/удалена), создаём новую: полёт и попадание от неё не зависят, пусть снаряд не исчезает молча. */
function moveEntity(p, pos, face) {
    try {
        p.entity.teleport(pos, { facingLocation: face });
        return;
    }
    catch { /* сущность недействительна */ }
    try {
        p.entity = spawnEntitySafe(p.dim, pos, p.munitionId);
        p.entity.teleport(pos, { facingLocation: face });
    }
    catch (e) {
        dbg(__t(116, String(e)));
    }
}
// ---- Взрыватель с задержкой (сборка 42, только фугасный заряд; параметры FUZE в overrides.js) ----
/** Первое касание блока: запускаем таймер взрывателя. Снаряд дальше «ползёт» сквозь блоки (advanceFuze). */
function startFuze(p, pt, dir, spd) {
    const k = Math.max(0.5, Math.min(1.5, spd / FUZE.speedRef));
    p.fz = { left: p.fuzeTicks, pos: { x: pt.x + dir.x * 0.05, y: pt.y + dir.y * 0.05, z: pt.z + dir.z * 0.05 }, entry: pt, dir, budget: FUZE.depthBudget * k, moved: false, stopped: false };
    p.st = { pos: { x: pt.x, y: pt.y, z: pt.z }, vel: { x: 0, y: 0, z: 0 }, age: p.st.age };
    try {
        manageChunks(p, p.st); // держим только чанк, где лежит снаряд (скорость 0: путь вперёд не нужен)
    }
    catch (e) {
        dbg(`ticking area: ${String(e)}`);
    }
    moveEntity(p, pt, { x: pt.x + dir.x, y: pt.y + dir.y, z: pt.z + dir.z });
}
/** Один тик снаряда с горящим взрывателем. true = взорвался. */
function advanceFuze(p) {
    const z = p.fz, d = z.dir;
    if (--z.left <= 0) {
        blast(p, z.pos, d, undefined);
        return true;
    }
    if (!z.stopped) {
        let cls;
        try {
            const b = p.dim.getBlock({ x: Math.floor(z.pos.x), y: Math.floor(z.pos.y), z: Math.floor(z.pos.z) });
            cls = b ? classify(b.typeId) : undefined;
        }
        catch {
            cls = undefined;
        }
        const cost = FUZE.cost[cls];
        if (cost === undefined || z.budget <= 0) {
            // Дальше пути нет (воздух, обсидиан, бедрок, бюджет кончился): лежим. Если так и не вошли в блок, садимся на поверхность, а не внутрь грани.
            z.stopped = true;
            if (!z.moved) {
                z.pos = { x: z.entry.x - d.x * 0.3, y: z.entry.y - d.y * 0.3, z: z.entry.z - d.z * 0.3 };
                moveEntity(p, z.pos, { x: z.pos.x + d.x, y: z.pos.y + d.y, z: z.pos.z + d.z });
            }
        }
        else {
            const v = 1 / (FUZE.ticksPerEarth * cost); // блок земли за ticksPerEarth тиков, тяжёлые блоки медленнее
            z.pos = { x: z.pos.x + d.x * v, y: z.pos.y + d.y * v, z: z.pos.z + d.z * v };
            z.budget -= 1 / FUZE.ticksPerEarth;
            z.moved = true;
            moveEntity(p, z.pos, { x: z.pos.x + d.x, y: z.pos.y + d.y, z: z.pos.z + d.z });
        }
    }
    if (z.stopped && !z.moved && z.left % 5 === 0)
        fuseSpark(p.dim, z.pos); // снаряд лежит на поверхности: искры показывают, что взрыватель горит
    return false;
}
/** Сборка 62: звук пролёта автопушечного снаряда рядом с игроком (один раз на игрока и снаряд, играет только ему). */
function flyby(p, pos) {
    try {
        for (const pl of p.dim.getPlayers({ location: pos, maxDistance: FLYBY.range })) {
            if (!p.fl)
                p.fl = new Set();
            if (p.fl.has(pl.id))
                continue;
            p.fl.add(pl.id);
            try {
                pl.playSound(FLYBY.sound, { volume: FLYBY.volume, pitch: 0.95 + Math.random() * 0.15 });
            }
            catch { /* игрок вышел */ }
        }
    }
    catch { /* getPlayers недоступен */ }
}
/** Один тик снаряда. true = снаряд закончил жизнь. */
function advance(p) {
    if (p.fz)
        return advanceFuze(p);
    const s0 = p.st;
    if (p.hold > 0 || (p.tickN++ & 1) === 0)
        manageChunks(p, s0); // раз в 2 тика (пока снаряд ждёт загрузку — каждый тик)
    const f = Math.min(p.keys.size > 0 ? slow : 1, tpsSlow); // замедление: чанки (над незагруженной землёй) и/или низкий TPS
    if (f < 1) {
        p.acc += f; // снаряд двигается не каждый тик (возраст и баллистика не меняются, просто «время» идёт медленнее)
        if (p.acc < 1)
            return false;
        p.acc -= 1;
    }
    const s1 = stepFlight(s0, p.params);
    if (s1.age > LIMITS.projectileMaxLifetimeTicks) {
        notifyLong(p, s0.pos, __t(117, Math.round(s0.pos.x), Math.round(s0.pos.y), Math.round(s0.pos.z)));
        return true;
    }
    let loaded = true;
    try {
        loaded = p.dim.isChunkLoaded({ x: s1.pos.x, y: clampY(s1.pos.y), z: s1.pos.z }); // сборка 70: высота зажата в пределы мира (дуга выше потолка раньше давала «чанк не загрузился»)
    }
    catch {
        loaded = false; // точка вне допустимой высоты мира и т.п.
    }
    if (!loaded) {
        // Сборка 40: ждём и когда областей у снаряда ещё нет (не хватило ёмкости/область не создалась): manageChunks каждый тик пробует снова.
        // Раньше при keys.size == 0 снаряд пропадал мгновенно. Счётчик ожидания теперь по подряд идущим тикам (раньше копился за весь полёт).
        if (LONG_RANGE.enabled && tam() && p.hold < LONG_RANGE.maxHoldTicks && p.waited < LONG_RANGE.maxHoldTicks * 4) {
            p.hold++;
            p.waited++; // ждём, пока загрузится чанк впереди (снаряд стоит на месте, возраст не растёт)
            return false;
        }
        notifyLong(p, s0.pos, __t(118, Math.round(s1.pos.x), Math.round(s1.pos.z), Math.round(s1.pos.y)), true);
        return true;
    }
    p.hold = 0;
    const dx = s1.pos.x - s0.pos.x, dy = s1.pos.y - s0.pos.y, dz = s1.pos.z - s0.pos.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6)
        return true;
    const dir = { x: dx / len, y: dy / len, z: dz / len };
    if (IMPACT[p.munitionId]?.cannonRadius && s1.age >= 4 && Math.hypot(s1.pos.x - p.origin.x, s1.pos.z - p.origin.z) > 5 && probeTwin(p.dim, s1.pos, 1.8)) {
        explode(p, s1.pos, dir, undefined); // сборка 71: снаряд попал в поднятую бронзовую автопушку (у неё нет блоков и целей-существ)
        return true;
    }
    const air = IMPACT[p.munitionId]?.airburst; // сборка 71: зенитный патрон: взрыв в воздухе на высоте burstHeight над точкой выстрела
    if (air && s1.pos.y - p.origin.y >= air.burstHeight) {
        blast(p, s1.pos, dir, undefined);
        return true;
    }
    // Путь за тик режется на отрезки: пробитый блок убирается, и снаряд летит дальше (kind "pierce"); существо на пути = прямое попадание.
    const spd = Math.hypot(s1.vel.x, s1.vel.y, s1.vel.z);
    let from = s0.pos, left = len;
    for (let guard = 0; guard < 40 && left > 1e-6; guard++) {
        const hit = p.dim.getBlockFromRay(from, dir, { maxDistance: Math.ceil(left * 1.8) + 2 });
        let pt, dist = left;
        if (hit) {
            const b = hit.block, f = hit.faceLocation;
            pt = { x: b.x + f.x, y: b.y + f.y, z: b.z + f.z };
            dist = Math.hypot(pt.x - from.x, pt.y - from.y, pt.z - from.z);
            if (dist > left + 1e-3)
                pt = undefined; // блок дальше конца этого тика
        }
        // сборка 82: блоки физических конструкций (машин) в мире не лежат, ищем их отдельным лучом; вблизи точки выстрела первые тики игнорируем (своя машина)
        let onStruct = false;
        {
            const sh = structureRay(p.dim, from, dir, pt ? dist : left, p.owner !== undefined && s1.age < OWN_STRUCT_GRACE_TICKS ? p.owner : undefined); // шаг 150: первые ~секунду своя конструкция не цель (блоки башни в луче стоят без поворота и подъёма)
            if (sh && !(s1.age < 10 && Math.hypot(sh.point.x - p.origin.x, sh.point.y - p.origin.y, sh.point.z - p.origin.z) < 4)) {
                pt = sh.point;
                dist = sh.distance;
                onStruct = true;
            }
        }
        const ent = findEntityHit(p.dim, from, dir, pt ? dist : left, p.pierced, AUTOCANNON[p.munitionId] ? AUTOCANNON_HIT_PAD : 0, p.origin); // пули автопушки: расширенное попадание
        if (ent) {
            const hitAt = { x: from.x + dir.x * ent.dist, y: from.y + dir.y * ent.dist, z: from.z + dir.z * ent.dist };
            if (air && hitAt.y - p.origin.y < air.minHeight)
                return true; // сборка 71: ниже minHeight над точкой выстрела зенитный заряд не взрывается (снаряд просто исчезает)
            const pe = IMPACT[p.munitionId]?.pierceEntities ?? 0;
            if (pe > 0) { // сборка 71: пробитие насквозь (серый патрон): урон существу и дальше по пути, до pe существ
                p.pierced = p.pierced ?? new Set();
                p.pierced.add(ent.entity.id);
                try {
                    applyImpact(p.dim, p.munitionId, hitAt, ent.entity, dir, p.power ?? 1);
                }
                catch (e) {
                    dbg(__t(114, String(e)));
                }
                try {
                    const ac = AUTOCANNON[p.munitionId];
                    if (ac)
                        p.dim.playSound("cbc.shell_explosion", hitAt, { volume: ac.hitVolume, pitch: ac.hitPitch });
                }
                catch { /* звук не критичен */ }
                if (p.pierced.size >= pe) {
                    impactEffects(p.dim, hitAt, p.munitionId);
                    return true;
                }
                from = { x: hitAt.x + dir.x * 0.3, y: hitAt.y + dir.y * 0.3, z: hitAt.z + dir.z * 0.3 };
                left = len - Math.hypot(from.x - s0.pos.x, from.y - s0.pos.y, from.z - s0.pos.z);
                continue;
            }
            explode(p, hitAt, dir, ent.entity);
            return true;
        }
        if (!pt)
            break;
        const cr = IMPACT[p.munitionId]?.entryCrater;
        if (cr && !p.cr) { // сборка 71: бронебойный снаряд: небольшая круглая воронка у точки входа
            p.cr = true;
            const ea = IMPACT[p.munitionId]?.entryArea;
            if (ea) {
                try {
                    areaHit(p.dim, pt, ea, undefined, { x: dir.x, z: dir.z }); // сборка 72: урон по площади в точке входа
                }
                catch (e) {
                    dbg(__t(119, String(e)));
                }
            }
            try {
                breakBlocks(p.dim, { x: pt.x + dir.x * 0.3, y: pt.y + dir.y * 0.3, z: pt.z + dir.z * 0.3 }, cr.blocks, cr.cap, cr.drops, 1);
            }
            catch (e) {
                dbg(__t(120, String(e)));
            }
        }
        if (!onStruct && tryPierce(p, hit.block, spd)) {
            from = { x: pt.x + dir.x * 0.05, y: pt.y + dir.y * 0.05, z: pt.z + dir.z * 0.05 };
            left = len - Math.hypot(from.x - s0.pos.x, from.y - s0.pos.y, from.z - s0.pos.z);
            continue;
        }
        if (p.fuzeTicks > 0) {
            startFuze(p, pt, dir, spd); // сборка 42: взрыватель с задержкой, снаряд остаётся в игре до конца таймера
            return false;
        }
        if (air && pt.y - p.origin.y < air.minHeight)
            return true; // сборка 71: низкий зенитный заряд при касании блока не взрывается
        explode(p, pt, dir, undefined);
        return true;
    }
    p.st = s1;
    if (AUTOCANNON[p.munitionId] && s1.age >= FLYBY.minAge && (s1.age & 1) === 0)
        flyby(p, s1.pos);
    trail(p.dim, s1.pos);
    moveEntity(p, s1.pos, { x: s1.pos.x + dir.x, y: s1.pos.y + dir.y, z: s1.pos.z + dir.z });
    return false;
}
// ---- Адаптивное замедление: чем больше новых чанков нужно загружать в единицу времени, тем медленнее летят снаряды над незагруженной землёй ----
let tpsSlow = 1; // замедление по TPS (perf.js, меню /cbc:admin)
let slow = 1; // доля тиков, на которых снаряд над незагруженной землёй реально движется (1 = полная скорость)
function updateThrottle() {
    let demand = 0; // чанков за тик, которые «просят» все снаряды над незагруженной землёй
    for (const p of live)
        if (p.keys.size > 0)
            demand += Math.hypot(p.st.vel.x, p.st.vel.z) / 16;
    let f = demand > LONG_RANGE.chunkBudgetPerTick ? LONG_RANGE.chunkBudgetPerTick / demand : 1;
    let pending = 0;
    for (const e of owned.values())
        if (!e.ready)
            pending++;
    if (pending > LONG_RANGE.maxPendingLoads)
        f *= 0.5; // чанки не успевают грузиться: ещё замедляемся
    slow = Math.max(LONG_RANGE.minSpeedFactor, Math.min(1, f));
}
function tick() {
    sampleTps();
    tpsSlow = slowFactor();
    if (owned.size > 0)
        updateThrottle();
    else
        slow = 1;
    for (let i = live.length - 1; i >= 0; i--) {
        const p = live[i];
        if (!p)
            continue;
        let done = false;
        try {
            done = advance(p);
        }
        catch (e) {
            reportError(__t(121), e);
            done = true;
        }
        if (done) {
            try {
                p.entity.remove();
            }
            catch { /* уже удалена */ }
            releaseAll(p);
            live.splice(i, 1);
        }
    }
}
/** Убрать сущности-снаряды, оставшиеся от прошлой сессии (скрипт их уже не ведёт). */
export function cleanupOrphans() {
    for (const id of ["overworld", "nether", "the_end"]) {
        try {
            for (const e of world.getDimension(id).getEntities({ type: PROJECTILE_TYPE })) {
                try {
                    e.remove();
                }
                catch { /* ignore */ }
            }
        }
        catch { /* измерение недоступно */ }
    }
}
// Цикл полёта запускается только когда есть снаряд в воздухе и останавливается, когда снарядов не осталось.
let loopHandle;
function ensureLoop() {
    if (loopHandle !== undefined)
        return;
    loopHandle = system.runInterval(() => {
        tick();
        if (live.length === 0 && loopHandle !== undefined) {
            system.clearRun(loopHandle);
            loopHandle = undefined;
        }
    }, 1);
}
export function startFlightLoop() {
    cleanupOrphans();
    try {
        owned.clear();
        tam()?.removeAllTickingAreas(); // остатки прошлой сессии (удаляет только области этого пака)
    }
    catch { /* ignore */ }
}
