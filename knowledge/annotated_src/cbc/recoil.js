/* CLAUDE-MAP-BEGIN
 FILE: cbc/recoil.js  (26 KB, 546 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: Cannon recoil on contraptions.
 IMPORTS: @minecraft/server, cbc/multiblock.js, i18n/i18n.js
 IMPORTED BY: cbc/main.js, cbc/world.js, core/cbcMount.js, main.js
 EXPORTS: RECOIL_TICKS, clampElevation, canElevate, setElevation, fireRecoil, releaseByPos, healHidden, isRaised, raiseRemaining, restoreRecoil, parsePart
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): fireRecoil@422(52L); animate@280(47L); tiltClear@330(47L); engage@236(37L); restoreRecoil@519(26L); ensureRetry@86(24L); releaseNow@213(22L); setElevation@398(20L); healHidden@490(20L); setHidden@55(19L); sweep@172(18L); spawnPart@137(16L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { __R } from "../i18n/i18n.js";
// Откат ствола стальной пушки: части (ствол/камера) на время анимации заменяются невидимыми двойниками cbc:<имя>_hidden,
// а на их месте рисуются сущности cbc:recoil_part, которые «откатываются» (анимация в RP, tools/gen_recoil.py).
// Страховки: список спрятанных блоков хранится в dynamic property мира и восстанавливается при загрузке; у сущности есть таймер самоудаления.
// TODO-VERIFY (в игре не запускалось): BlockPermutation.resolve с состоянием направления, Entity.setRotation, Block.setPermutation/withState.
import { BlockPermutation, system, world } from "@minecraft/server";
import { dirVec, parsePart } from "./multiblock.js";
export const RECOIL_TICKS = 24; // совпадает с RECOIL_SEC (1.2 с) в tools/gen_recoil.py
const HIDDEN_STATE = "cbc:f"; // направление скрытого двойника (индекс в FACINGS)
const FACING_STATE = "minecraft:facing_direction";
const FACINGS = ["down", "up", "north", "south", "west", "east"];
const SUFFIX = "_hidden";
const KEY = "cbc:recoil_hidden";
const FAMILY = "cbc_recoil_part"; // семейство всех сущностей частей (type_family в BP)
// Наклон запечён в геометрию: шаг угла выбирается вариантом сущности (tools/gen_recoil_tilt.py, те же пределы и шаг).
const TILT_MIN = -10, TILT_STEP = 2.5, TILT_N = 29;
const K_UP = TILT_N, K_DOWN = TILT_N + 1; // вертикальные пушки (ствол строго вверх/вниз), тоже запечены в геометрию
/** Идентификатор сущности: cbc:tp_<b|c><k> (статична) или cbc:kp_<b|c><k> (с откатом, k чётные или вертикальные). Угол выбирается идентификатором, без variant. */
function entityId(part, k, kick) {
    const kk = kick && k < TILT_N ? Math.min(TILT_N - 1 - ((TILT_N - 1) % 2), Math.round(k / 2) * 2) : k;
    const mortar = part.type.includes("mortar"); // сборка 79: миномётный ствол: те же геометрии, другая текстура (tm_/km_)
    const pre = mortar ? (kick ? "km" : "tm") : kick ? "kp" : part.type.includes("cast_iron") ? "ci" : "tp"; // ci = чугун (только наклон, без отката)
    return `cbc:${pre}_${part.type.endsWith("barrel") ? "b" : "c"}${kk}`;
}
/** Шаг геометрии для пушки: горизонтальные по углу, вертикальные фиксированные. */
function kFor(st, theta) { return st.direction === "up" ? K_UP : st.direction === "down" ? K_DOWN : kOf(theta); }
/** Сборка 82: шаги 0..28 = -10..60° (как раньше), 29/30 вертикальные, 31..40 = 62.5..85° (мортирный затвор). */
const TILT_EXT0 = TILT_N + 2, TILT_EXT_N = 10;
function kOf(theta) {
    const raw = Math.round((theta - TILT_MIN) / TILT_STEP);
    if (raw <= TILT_N - 1)
        return Math.max(0, raw);
    return TILT_EXT0 + Math.min(TILT_EXT_N - 1, raw - TILT_N);
}
const RECOIL_MATERIALS = new Set(["steel"]); // «металл»: откат; у чугуна отката нет, но наклон ствола у него есть (ELEV_MATERIALS)
const ELEV_MATERIALS = new Set(["steel", "cast_iron"]); // материалы с визуальным наклоном частей
const RECOIL_PARTS = new Set(["cbc:steel_cannon_barrel", "cbc:steel_mortar_barrel", "cbc:steel_cannon_chamber", "cbc:cast_iron_cannon_barrel", "cbc:cast_iron_cannon_chamber"]);
// yaw: юг 0, запад 90, север 180, восток -90 (как у игрока); pitch: вверх -90, вниз 90
const YAW = { south: 0, west: 90, north: 180, east: -90, up: 0, down: 0 };
const PITCH = { south: 0, west: 0, north: 0, east: 0, up: -90, down: 90 };
function load() {
    const raw = world.getDynamicProperty(KEY);
    if (typeof raw !== "string")
        return [];
    try {
        const a = JSON.parse(raw);
        return Array.isArray(a) ? a : [];
    }
    catch {
        return [];
    }
}
function save(list) { world.setDynamicProperty(KEY, JSON.stringify(list)); }
/** Спрятать блок (заменить невидимым двойником cbc:<имя>_hidden с тем же направлением) или вернуть исходный блок. */
function setHidden(dim, p, hidden) {
    const b = dim.getBlock(p);
    if (!b)
        return false; // чанк не загружен: вернуть блок не удалось
    if (hidden) {
        if (!RECOIL_PARTS.has(b.typeId))
            return true;
        const idx = Math.max(0, FACINGS.indexOf(String(b.permutation.getState(FACING_STATE))));
        b.setPermutation(BlockPermutation.resolve(b.typeId + SUFFIX, { [HIDDEN_STATE]: idx }));
    }
    else {
        if (!b.typeId.endsWith(SUFFIX))
            return true; // уже обычный блок
        const base = b.typeId.slice(0, -SUFFIX.length);
        const idx = Number(b.permutation.getState(HIDDEN_STATE)) || 0;
        b.setPermutation(BlockPermutation.resolve(base, { [FACING_STATE]: FACINGS[idx] ?? "up" }));
    }
    return true;
}
// Блоки, которые не удалось вернуть (чанк выгружен, пока игрок ушёл): запись остаётся в мире, возврат повторяется, пока чанк не загрузится.
let pending = [];
let retryHandle;
const samePos = (r, dimId, q) => r.dim === dimId && r.x === q.x && r.y === q.y && r.z === q.z;
function dropRecords(dimId, list) {
    save(load().filter((r) => !list.some((q) => samePos(r, dimId, q))));
}
function queueRestore(r) {
    if (!pending.some((q) => samePos(q, r.dim, r)))
        pending.push({ dim: r.dim, x: r.x, y: r.y, z: r.z });
    ensureRetry();
}
function ensureRetry() {
    if (retryHandle !== undefined || pending.length === 0)
        return;
    retryHandle = system.runTimeout(() => {
        retryHandle = undefined;
        const left = [];
        for (const r of pending) {
            let done = false;
            try {
                const dim = world.getDimension(r.dim);
                if (dim.isChunkLoaded(r) && setHidden(dim, r, false)) {
                    done = true;
                    dropRecords(r.dim, [r]);
                    sweep(dim, { x: r.x + 0.5, y: r.y + 0.5, z: r.z + 0.5 }, 3); // сущности отката, оставшиеся в этом чанке
                }
            }
            catch { /* повторим позже */ }
            if (!done)
                left.push(r);
        }
        pending = left;
        ensureRetry(); // таймер живёт только пока есть невозвращённые блоки
    }, 60);
}
// ---- Вертикальная наводка (сталь и чугун) и откат (только сталь), горизонтальные пушки -------------------------------------
// Пока пушка заряжена и угол не 0, части (ствол/камера) заменены невидимыми двойниками, а на их месте стоят сущности
// cbc:recoil_part, повёрнутые на угол вокруг центра казённика. Выстрел: откат вдоль наклонённой оси, затем плавное опускание.
// Наклон запечён в геометрию по шагам угла (сборка 21), знак: ELEV_PITCH_SIGN в tools/gen_recoil_tilt.py (SIGN).
const HORIZONTAL = new Set(["north", "south", "east", "west"]);
// Знак наклона (ствол вверх = поворот кости aim на -угол) задан в tools/gen_recoil_tilt.py (SIGN); если ствол наклоняется вниз, поставить SIGN = 1 и перегенерировать.
const RAISE_TICKS = 24;
const ADJUST_TICKS = 12;
const LOWER_TICKS = 30;
const raised = new Map(); // ключ заряжания пушки -> состояние
const rad = (d) => d * Math.PI / 180;
/** Положение сущности i-й части при угле theta: центр части на расстоянии i от центра казённика вдоль (наклонённой) оси. */
function geom(st, i, theta) {
    let center;
    if (st.horizontal) {
        const c = Math.cos(rad(theta)), sn = Math.sin(rad(theta));
        center = { x: st.p0.x + i * st.dh.x * c, y: st.p0.y + i * sn, z: st.p0.z + i * st.dh.z * c };
    }
    else {
        center = { x: st.p0.x + i * st.v.x, y: st.p0.y + i * st.v.y, z: st.p0.z + i * st.v.z };
    }
    return { origin: { x: center.x, y: center.y - 0.5, z: center.z } };
}
/**
 * Создать сущность части с запечённым наклоном шага k (summon сразу с поворотом, без интерполяции).
 * Старую сущность (old) не трогает: новую находим среди тех, что не old.
 */
function spawnPart(st, p, k, kick, old) {
    const g = geom(st, p.i, st.theta);
    const dim = st.dim;
    const type = entityId(p, k, kick);
    dim.runCommand(`summon ${type} ${g.origin.x} ${g.origin.y} ${g.origin.z} ${YAW[st.direction]} 0`);
    const found = dim.getEntities({ type, location: g.origin, maxDistance: 0.4 }).filter((e) => !old || e.id !== old.id);
    if (found.length === 0)
        throw new Error("сущность отката не создана");
    for (let j = 1; j < found.length; j++) {
        try {
            found[j].remove();
        }
        catch { /* ignore */ }
    }
    return found[0];
}
/** Первая сущность части (без старой). */
function summonPart(st, p, kick) {
    const k = kFor(st, st.theta);
    p.entity = spawnPart(st, p, k, kick, undefined);
    p.k = k;
    p.kick = kick;
}
/** Заменить сущность части на новую с другим шагом угла/типом: сначала создаём новую, потом убираем старую (без мигания). */
function respawnPart(st, p, k, kick) {
    const old = p.entity;
    p.entity = spawnPart(st, p, k, kick, old);
    p.k = k;
    p.kick = kick;
    try {
        old?.remove();
    }
    catch { /* уже удалена */ }
}
/** Убрать «осиротевшие» сущности частей (остатки прошлых сборок/сбоев) в радиусе от центра казённика; отслеживаемые не трогаем. Только по событиям, без таймеров. */
function sweep(dim, center, radius) {
    const keep = new Set();
    for (const s of raised.values())
        for (const p of s.parts)
            if (p.entity)
                keep.add(p.entity.id);
    try {
        for (const e of dim.getEntities({ families: [FAMILY], location: center, maxDistance: radius })) {
            if (keep.has(e.id))
                continue;
            try {
                e.remove();
            }
            catch { /* уже удалена */ }
        }
    }
    catch { /* чанк не загружен */ }
}
function sweepScan(dim, scan) {
    sweep(dim, { x: scan.breechPos.x + 0.5, y: scan.breechPos.y + 0.5, z: scan.breechPos.z + 0.5 }, scan.chambers + scan.barrels + 4);
}
function removeEntities(st) {
    for (const p of st.parts) {
        try {
            p.entity?.remove();
        }
        catch { /* уже удалена */ }
        p.entity = undefined;
    }
}
function stopTimers(st) {
    if (st.anim !== undefined) {
        system.clearRun(st.anim);
        st.anim = undefined;
    }
    if (st.timeout !== undefined) {
        system.clearRun(st.timeout);
        st.timeout = undefined;
    }
}
/** Убрать сущности, вернуть блоки, забыть пушку. */
function releaseNow(key) {
    const st = raised.get(key);
    if (!st)
        return;
    stopTimers(st);
    removeEntities(st);
    const restored = [];
    for (const p of st.parts) {
        let ok = false;
        try {
            ok = setHidden(st.dim, p.pos, false);
        }
        catch { /* чанк выгружен */ }
        if (ok)
            restored.push(p.pos);
        else
            queueRestore({ dim: st.dim.id, x: p.pos.x, y: p.pos.y, z: p.pos.z }); // запись в мире остаётся, вернём позже
    }
    dropRecords(st.dim.id, restored);
    raised.delete(key);
    sweep(st.dim, st.p0, st.parts.length + 4);
}
/** Создать состояние, спрятать блоки и поставить сущности под углом theta. */
function engage(dim, scan, key, theta, kick) {
    sweepScan(dim, scan);
    const v = dirVec(scan.direction);
    const st = {
        dim, key, direction: scan.direction, theta,
        p0: { x: scan.breechPos.x + 0.5, y: scan.breechPos.y + 0.5, z: scan.breechPos.z + 0.5 },
        dh: { x: v.x, z: v.z }, v, horizontal: HORIZONTAL.has(scan.direction), rear: scan.breechPos, parts: [], busy: false,
    };
    const total = scan.chambers + scan.barrels;
    for (let i = 1; i <= total; i++) {
        const pos = { x: scan.breechPos.x + v.x * i, y: scan.breechPos.y + v.y * i, z: scan.breechPos.z + v.z * i };
        const b = dim.getBlock(pos);
        if (!b || !RECOIL_PARTS.has(b.typeId))
            continue;
        st.parts.push({ i, pos, type: b.typeId, entity: undefined, k: 0, kick: false });
    }
    if (st.parts.length === 0)
        return undefined;
    raised.set(key, st);
    const hiddenNow = [];
    try {
        for (const p of st.parts) {
            summonPart(st, p, kick);
            setHidden(dim, p.pos, true);
            hiddenNow.push({ dim: dim.id, x: p.pos.x, y: p.pos.y, z: p.pos.z });
        }
        save([...load(), ...hiddenNow]); // одна запись на все части (раньше JSON перезаписывался на каждую часть)
    }
    catch (err) {
        if (hiddenNow.length)
            save([...load(), ...hiddenNow]); // спрятанные блоки должны быть в списке, чтобы releaseNow их вернул
        __R.log("warn", `[CBC] наводка/откат: ${String(err)}`);
        releaseNow(key);
        return undefined;
    }
    return st;
}
/** Минимум тиков на градус: при пике скорости ease (1.5 * угол / тиков) шаг геометрии (2.5°) не пропускается и ход не рывком. */
const RAISE_TICKS_PER_DEG = 0.8, LOWER_TICKS_PER_DEG = 1.0;
/**
 * Плавно перевести угол st.theta -> to (ease in-out), затем done().
 * Длительность растёт с размахом угла (на 60° не «скипается» и не падает рывком). Без таймера на каждый тик:
 * заранее считаем, на каких тиках меняется шаг геометрии, и ставим один runTimeout до следующей смены (сущности создаются как раньше, только на смене шага).
 */
function animate(st, to, ticks, done) {
    if (st.anim !== undefined) {
        system.clearRun(st.anim);
        st.anim = undefined;
    }
    const from = st.theta;
    const total = Math.max(ticks, Math.ceil(Math.abs(to - from) * (to < from ? LOWER_TICKS_PER_DEG : RAISE_TICKS_PER_DEG)));
    st.animEnd = system.currentTick + total; // сборка 41: когда закончится подъём/опускание (для задержки выстрела, см. raiseRemaining)
    const forceFirst = st.parts.some((p) => p.kick); // выход из режима отката: первая смена обязательна
    let curK = st.parts.length ? st.parts[0].k : kFor(st, from);
    const events = [];
    for (let t = 1; t <= total; t++) {
        const k = t / total;
        const th = t === total ? to : from + (to - from) * (k * k * (3 - 2 * k));
        const ks = kFor(st, th);
        if (ks !== curK || t === total || (forceFirst && events.length === 0))
            events.push({ t, th, ks });
        curK = ks;
    }
    let i = 0, prevT = 0;
    const next = () => {
        const ev = events[i];
        st.anim = system.runTimeout(() => {
            st.anim = undefined;
            st.theta = ev.th;
            for (const p of st.parts) {
                try {
                    if (!p.entity)
                        continue;
                    if (ev.ks !== p.k || p.kick)
                        respawnPart(st, p, ev.ks, false); // только новый шаг угла (или выход из режима отката): новая сущность; teleport не используем
                }
                catch { /* сущность в незагруженном чанке */ }
            }
            prevT = ev.t;
            i++;
            if (i < events.length) {
                next();
                return;
            }
            sweep(st.dim, st.p0, st.parts.length + 4);
            if (done)
                done();
        }, ev.t - prevT);
    };
    next();
}
// ---- Проверка проходимости: ствол не должен подниматься/опускаться сквозь блоки (только по запросу, без тиков) ----
/** Свободен ли весь наклонённый ствол при угле theta (углы 8 точек + середина каждой части; клетки самой пушки не считаются). */
const PASSABLE = new Set(["minecraft:short_grass", "minecraft:tallgrass", "minecraft:tall_grass", "minecraft:fern", "minecraft:large_fern", "minecraft:snow_layer", "minecraft:vine"]);
function tiltClear(dim, scan, theta, cache) {
    const v = dirVec(scan.direction);
    const dh = { x: v.x, z: v.z };
    const c = Math.cos(rad(theta)), sn = Math.sin(rad(theta));
    const total = scan.chambers + scan.barrels;
    const bx = scan.breechPos.x, by = scan.breechPos.y, bz = scan.breechPos.z;
    const own = new Set();
    for (let i = 0; i <= total; i++)
        own.add(`${bx + v.x * i},${by},${bz + v.z * i}`);
    const solidAt = (x, y, z) => {
        const key = `${x},${y},${z}`;
        if (own.has(key))
            return false;
        let r = cache.get(key);
        if (r === undefined) {
            try {
                const b = dim.getBlock({ x, y, z });
                r = !!b && !b.isAir && !b.isLiquid && !PASSABLE.has(b.typeId); // любой не-воздух блок мешает (isSolid не используем: ненадёжен для плит/ступеней)
            }
            catch {
                r = false; // чанк не загружен: не блокируем
            }
            cache.set(key, r);
        }
        return r;
    };
    for (let i = 1; i <= total; i++) {
        let b = undefined;
        try {
            b = dim.getBlock({ x: bx + v.x * i, y: by, z: bz + v.z * i });
        }
        catch { /* ignore */ }
        const hw = String(b?.typeId ?? "").includes("chamber") ? 0.49 : 0.37; // полуширина части (камера 16 px, ствол 12 px), с запасом от границы клетки
        const cx = bx + 0.5 + i * dh.x * c, cy = by + 0.5 + i * sn, cz = bz + 0.5 + i * dh.z * c;
        for (const sa of [-0.49, 0, 0.49])
            for (const su of [-hw, hw])
                for (const sl of [-hw, hw]) {
                    // ось (dh*c, sn), «вверх» части (-dh*sn, c), поперёк (dh.z, -dh.x)
                    const x = cx + sa * dh.x * c - su * dh.x * sn + sl * dh.z;
                    const y = cy + sa * sn + su * c;
                    const z = cz + sa * dh.z * c - su * dh.z * sn - sl * dh.x;
                    if (solidAt(Math.floor(x), Math.floor(y), Math.floor(z)))
                        return false;
                }
    }
    return true;
}
/** Наибольший свободный угол в сторону want (шагами step от 0): возвращает want, если путь свободен, иначе последний свободный угол. */
export function clampElevation(dim, scan, want, step) {
    if (!want || !canElevate(scan))
        return want;
    const sgn = want > 0 ? 1 : -1, cache = new Map();
    let ok = 0;
    for (let a = step; a <= Math.abs(want) + 1e-9; a += step) {
        if (!tiltClear(dim, scan, sgn * a, cache))
            break;
        ok = sgn * a;
    }
    return ok;
}
/** Есть ли визуальный наклон частей (сталь и чугун, горизонтальная). */
export function canElevate(scan) {
    return ELEV_MATERIALS.has(scan.materialId) && HORIZONTAL.has(scan.direction);
}
/**
 * Привести визуальный наклон в соответствие с углом theta (0 = опущена). Вызывать из system.run.
 * Возвращает false, если пушка сейчас занята выстрелом/опусканием (потом синхронизируется сама).
 */
export function setElevation(dim, scan, key, theta) {
    if (!canElevate(scan))
        return true;
    sweepScan(dim, scan);
    const st = raised.get(key);
    if (st) {
        if (st.busy)
            return false;
        if (st.theta === theta && st.anim === undefined)
            return true;
        animate(st, theta, ADJUST_TICKS, theta === 0 ? () => releaseNow(key) : undefined);
        return true;
    }
    if (theta === 0)
        return true;
    const fresh = engage(dim, scan, key, 0, false);
    if (fresh)
        animate(fresh, theta, RAISE_TICKS);
    return true;
}
/**
 * Выстрел: откат (все стальные пушки) вдоль оси при текущем угле, затем плавное опускание до 0 и возврат блоков.
 * `after` вызывается, когда пушка вернулась в исходное положение. Вызывать из system.run.
 */
export function fireRecoil(dim, scan, key, theta, after) {
    if (!RECOIL_MATERIALS.has(scan.materialId)) {
        // Чугун: отката нет. Если ствол был поднят, после выстрела он плавно опускается и возвращает блоки.
        const up = raised.get(key);
        if (up) {
            stopTimers(up);
            up.busy = true;
            const finish = () => { releaseNow(key); if (after)
                after(); };
            if (up.theta !== 0)
                animate(up, 0, LOWER_TICKS, finish);
            else
                finish();
        }
        return;
    }
    sweepScan(dim, scan);
    const th = HORIZONTAL.has(scan.direction) ? theta : 0;
    let st = raised.get(key);
    if (st) {
        // уже поднята: пересоздаём сущности на текущем наклоне, чтобы анимация отката началась заново
        stopTimers(st);
        removeEntities(st);
        try {
            for (const p of st.parts)
                summonPart(st, p, true);
        }
        catch (err) {
            __R.log("warn", `[CBC] откат: ${String(err)}`);
            releaseNow(key);
            if (after)
                after();
            return;
        }
    }
    else {
        st = engage(dim, scan, key, th, true);
        if (!st)
            return;
    }
    st.busy = true;
    const cur = st;
    cur.timeout = system.runTimeout(() => {
        cur.timeout = undefined;
        const finish = () => { releaseNow(key); if (after)
            after(); };
        if (cur.theta !== 0)
            animate(cur, 0, LOWER_TICKS, finish);
        else
            finish();
    }, RECOIL_TICKS);
}
/** Блок пушки сломали/взорвали: сразу вернуть все части (сущности убрать, двойники заменить настоящими блоками). */
export function releaseByPos(dimId, pos) {
    let released = 0;
    for (const [key, st] of [...raised]) {
        if (st.dim.id !== dimId)
            continue;
        const hit = (st.rear.x === pos.x && st.rear.y === pos.y && st.rear.z === pos.z)
            || st.parts.some((p) => p.pos.x === pos.x && p.pos.y === pos.y && p.pos.z === pos.z);
        if (hit) {
            releaseNow(key);
            released++;
        }
    }
    return released;
}
/** Вылечить пушку, у которой блоки застряли «скрытыми» (не в режиме наводки): вернуть обычные блоки. Возвращает число исправленных. */
export function healHidden(dim, scan, key) {
    if (raised.has(key))
        return 0;
    const v = dirVec(scan.direction);
    const fixed = [];
    for (let i = 1; i <= scan.chambers + scan.barrels; i++) {
        const pos = { x: scan.breechPos.x + v.x * i, y: scan.breechPos.y + v.y * i, z: scan.breechPos.z + v.z * i };
        try {
            const b = dim.getBlock(pos);
            if (b && b.typeId.endsWith(SUFFIX) && setHidden(dim, pos, false))
                fixed.push(pos);
        }
        catch { /* ignore */ }
    }
    if (fixed.length) {
        dropRecords(dim.id, fixed);
        sweepScan(dim, scan);
    }
    return fixed.length;
}
export function isRaised(key) { return raised.has(key); }
/** Сколько тиков осталось до конца подъёма/наводки ствола (0 = не поднимается; во время выстрела/опускания тоже 0). */
export function raiseRemaining(key) {
    const st = raised.get(key);
    if (!st || st.busy || st.animEnd === undefined)
        return 0;
    return Math.max(0, st.animEnd - system.currentTick);
}
/** При загрузке мира: вернуть блоки, спрятанные до выхода, и убрать зависшие сущности отката. */
export function restoreRecoil() {
    const failed = [];
    for (const r of load()) {
        let ok = false;
        try {
            ok = setHidden(world.getDimension(r.dim), r, false);
        }
        catch { /* ignore */ }
        if (!ok)
            failed.push(r);
    }
    save(failed); // не вернувшиеся (чанк не загружен) остаются в списке и возвращаются позже
    for (const r of failed)
        queueRestore(r);
    for (const id of ["overworld", "nether", "the_end"]) {
        try {
            for (const e of world.getDimension(id).getEntities({ families: [FAMILY] })) {
                try {
                    e.remove();
                }
                catch { /* ignore */ }
            }
        }
        catch { /* ignore */ }
    }
}
export { parsePart };
