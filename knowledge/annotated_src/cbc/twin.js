/* CLAUDE-MAP-BEGIN
 FILE: cbc/twin.js  (63 KB, 900 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: CBC multiblock/cannon logic (largest CBC file).
 IMPORTS: @minecraft/server, cbc/ballistics.js, cbc/casings.js, cbc/config/overrides.js, cbc/effects.js, cbc/fire.js, cbc/impact.js, cbc/projectiles.js, cbc/settings.js, cbc/twin_scan.js, i18n/i18n.js
 IMPORTED BY: cbc/main.js
 EXPORTS: SEAT_ENTITY, TWIN_ENTITY, ROUND_ID, ROUNDS, TRIGGER_ID, applyTwinLoad, registerTwinComponent, restoreTwins, registerTwin
 EVENTS: itemUse, playerBreakBlock, playerInteractWithBlock, playerInteractWithEntity, playerPlaceBlock, playerSpawn
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): registerTwin@793(107L); mount@569(65L); shoot@636(64L); restore@465(40L); stepOne@425(38L); dropBoxAmmo@703(31L); updateCamera@202(26L); buriedAt@176(20L); restoreTwins@772(20L); alignHandles@238(17L); refreshVisual@352(17L); placeSeat@382(17L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { __t, __R } from "../i18n/i18n.js";
// Бронзовая спаренная вертикальная пушка (подвижная). Адаптер Script API. Сборка 47.
// Состояния: BLOCKS (обычная постройка) -> клик по пушке (без Shift) -> ACTIVE (блоки убраны; невидимое сиденье + модель пушки; игрок сидит)
//   -> слез/вышел/умер -> RETURNING (плавный возврат yaw и наклона) -> RESTORING (блоки возвращены, сущности убраны) -> BLOCKS.
// Живой цикл (runInterval) существует ТОЛЬКО пока есть активная пушка (правило HANDOFF §26).
// Механизм (сборка 47, в игре НЕ проверен): сиденье `cbc:btc_seat` каждый тик переносится на окружность позади казённика (поворот на 360° по взгляду игрока);
// модель `cbc:bt<раскладка>[a|b]` неподвижна и ПЕРЕСОЗДАЁТСЯ командой summon при смене шага yaw (6°) или наклона (3°): поворот, заданный при создании, клиент показывает
// надёжно (так сделана стальная пушка, HANDOFF §31-33). Откат трубки = модель с суффиксом a/b (анимация играет при создании).
import * as MC from "@minecraft/server";
import { BlockPermutation, system, world } from "@minecraft/server";
import { AUTOCANNON, AUTOCANNON_MODS, DEBUG, LIMITS } from "./config/overrides.js";
import { S } from "./settings.js";
import { planShot } from "./fire.js";
import { applySpread } from "./ballistics.js";
import { muzzleBlast, shake } from "./effects.js";
import { ejectCasing } from "./casings.js";
import { liveCount, spawnProjectile } from "./projectiles.js";
import { setTwinHooks } from "./impact.js";
import { HDIRS, TWIN_YAW, findTwin, twinDirVec, twinPart } from "./twin_scan.js";

const BOX_ID = "cbc:bronze_vt_ammo_box"; // сборка 64: фиолетовый ящик боеприпасов сбоку казённика
const boxEntId = (slot) => `cbc:btx${slot}`; // его модель на сущности пушки (слоты 0..3, см. twin_scan.boxSlot)

export const SEAT_ENTITY = "cbc:btc_seat"; // невидимое сиденье (ездовая сущность, двигается по кругу за пушкой)
export const TWIN_ENTITY = SEAT_ENTITY; // совместимость со старым именем
const VIS_FAMILY = "cbc_btc"; // семейство визуальных сущностей пушки (модель; пересоздаётся при смене угла)
const SEAT_FAMILY = "cbc_btc_seat";
const visId = (layout, kick) => `cbc:bt${layout}${kick || ""}`; // cbc:bt<раскладка>[a|b]: a/b = с анимацией отката трубки
const isTwinEntityId = (id) => id === SEAT_ENTITY || /^cbc:bt(\d+[ab]?|x[0-3])$/.test(id || "");
const FACING_STATE = "minecraft:facing_direction";
// Сборка 71: патроны автопушки. code = буква в очереди ствола.
//  серый  cbc:ap_autocannon_round    = бронебойный (a): прямой полёт, блоки не ломает, урон как у арбалета, пробивает до 3 существ;
//  оранжевый cbc:he_autocannon_round = фугасный (e): небольшая навесная траектория, урон по площади 6 блоков.
// Зенитные патроны (жёлтые) удалены.
export const ROUND_ID = "cbc:ap_autocannon_round";
export const ROUNDS = {
    "cbc:ap_autocannon_round": { code: "a", munition: "ap_autocannon", name: __t(122), short: __t(123) },
    "cbc:he_autocannon_round": { code: "e", munition: "he_autocannon", name: __t(130), short: __t(131) },
};
const ROUND_BY_CODE = Object.fromEntries(Object.entries(ROUNDS).map(([id, r]) => [r.code, { ...r, itemId: id }]));
const ROUND_CAP = 8; // патронов в каждом стволе (A и B) без ящика
const BOX_CAP = 45; // сборка 64: с ящиком боеприпасов сбоку казённика: по 45 на каждый ствол (всего 90)
const capOf = (st) => (typeof st.cap === "number" ? st.cap : ROUND_CAP);
const capFor = (found) => ((found?.boxes?.length ?? 0) > 0 ? BOX_CAP : ROUND_CAP);
const isRound = (id) => Object.prototype.hasOwnProperty.call(ROUNDS, id);
const EJECT_SIDE = 0.35, EJECT_UP = 0.18, EJECT_BACK = 0.04; // гильза: скорость вбок / вверх / назад, блоков/тик
export const TRIGGER_ID = "cbc:autocannon_trigger"; // «спуск»: выдаётся при посадке, чтобы ПКМ с пустой рукой давал событие itemUse
const isTrigger = (id) => id === TRIGGER_ID;
const JUMP_FIRES = false; // стрельба прыжком (Space) отключена: стреляем правой кнопкой мыши
const PMIN = -12, PMAX = 60, PSTEP = 3; // наклон: от -12° до 60°; модель пересоздаётся при смене шага 3°
const BARREL_CD = 20; // тиков между выстрелами одного ствола (откат 12 тиков)
const MOUNT_FIRE_DELAY = 20; // сборка 69: тиков после посадки, пока стрелять нельзя (20 = 1 с)
const GLOBAL_CD = 6; // тиков между любыми двумя выстрелами (чередование A/B, ~3 выстр./с суммарно)
const RETURN_YAW_PER_TICK = 3; // градусов за тик при возврате
const TURN_RATE = 2; // макс. скорость поворота пушки, градусов за тик (2 x 20 = 40°/с, оборот за 9 с)
const ELEV_RATE = 1.5; // макс. скорость подъёма/опускания ствола, градусов за тик
const GRACE_TICKS = 40; // сколько ждём посадки игрока после создания
const RESTORE_RETRY = 20; // тиков между попытками вернуть блоки (чанк не загружен)
const RESTORE_GIVEUP = 30; // попыток
const SEAT_Y = 0.5; // высота оси ствола над низом блока казённика
const SEAT_BACK = 3.1; // расстояние сиденья позади центра переднего казённика (за вторым казёнником и ручками; сборка 63: было 2.1 с одним казёнником)
const SEAT_DY = 0; // высота сущности-сиденья над низом казённика (сам сидящий смещён на -0.4 в BP: seats.position)
const YAW_STEP = 4; // шаг пересоздания модели по повороту, градусов (поворот 360°, 60 положений)
const VIS_MIN_INTERVAL = 2; // не чаще одного пересоздания модели за столько тиков

const dbg = (t) => { if (DEBUG) __R.log("warn", `[CBC dbg] ${t}`); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const stKey = (dimId, p) => `cbc:btc:${dimId}:${p.x},${p.y},${p.z}`;
const KEY_RE = /^cbc:btc:(.+):(-?\d+),(-?\d+),(-?\d+)$/;
const emptySlot = () => ({ n: 0, q: "" });
/** Очередь патронов ствола: строка кодов ("a" бронебойный, "f" флак), стреляет с начала. Старое состояние {n} без q = n флаковых патронов. */
// старые зенитные коды (f/g/h) больше не существуют - выкидываем их из очереди
const queueOf = (slot) => (typeof slot.q === "string" ? slot.q : "a".repeat(Math.max(0, slot.n ?? 0))).replace(/[^ae]/g, "");
const setQueue = (slot, q) => { slot.q = q; slot.n = q.length; };
const bar = (p, t) => { try { __R.actionBar(p, t); } catch { /* игрок вышел */ } };
const AUTO_MOUNT = false; // автопосадка после постройки ОТКЛЮЧЕНА (сборка 52): садиться нужно ПКМ по ручкам
const TWIN_DEBUG = false; // сборка 46: при каждом клике по блоку бронзовой пушки пишет в чат, что пришло (выключить, когда посадка подтверждена)
/** actionbar + чат: для сообщений, которые нельзя пропустить (скрытый HUD, затёртый actionbar). */
const say = (p, t) => { bar(p, t); }; // только панель над хотбаром, в чат не пишем

// ---------- хранилище ----------
function readState(key) {
    const raw = world.getDynamicProperty(key);
    if (typeof raw !== "string") return undefined;
    try { return JSON.parse(raw); } catch { return undefined; }
}
function writeState(key, st) { world.setDynamicProperty(key, st ? JSON.stringify(st) : undefined); }
const PRUNE_EVERY = 6000; // тиков (5 мин) между чистками, только при посадке: постоянного таймера нет (HANDOFF §26)
let lastPrune = -1e9;
/** Сборка 85: запись заряда бронзовой пушки, чей казённик исчез (взрыв, команда, воронка: playerBreakBlock не сработал), удаляется. Идущие и неактивные в загруженных чанках не трогаются. */
function pruneStates(now) {
    if (now - lastPrune < PRUNE_EVERY) return;
    lastPrune = now;
    try {
        for (const id of world.getDynamicPropertyIds()) {
            const m = KEY_RE.exec(id);
            if (!m || act.has(id)) continue;
            const st = readState(id);
            if (!st) { world.setDynamicProperty(id, undefined); continue; } // битая запись
            if (st.active) continue;
            const b = world.getDimension(m[1]).getBlock({ x: Number(m[2]), y: Number(m[3]), z: Number(m[4]) });
            if (!b) continue; // чанк не загружен: решим позже
            if (b.typeId !== "cbc:bronze_vt_breech") world.setDynamicProperty(id, undefined);
        }
    } catch (e) { dbg(`pruneStates: ${String(e)}`); }
}
function freshState() { return { v: 1, a: emptySlot(), b: emptySlot(), next: "a", active: false }; }

// ---------- блоки ----------
function makeReader(dim) {
    return (pos) => {
        try {
            const b = dim.getBlock(pos);
            if (!b) return undefined;
            const f = b.permutation.getState(FACING_STATE);
            return { typeId: b.typeId, facing: typeof f === "string" && HDIRS.includes(f) ? f : undefined };
        } catch { return undefined; }
    };
}
function describe(st) {
    const side = (slot) => { const q = queueOf(slot); const by = {}; for (const c of q) by[c] = (by[c] ?? 0) + 1; const parts = Object.entries(by).map(([c, n]) => `${ROUND_BY_CODE[c]?.short ?? "?"}:${n}`).join(" "); return `${q.length}/${capOf(st)}${q.length ? __t(132, parts, ROUND_BY_CODE[q[0]]?.short ?? "?") : ""}`; };
    return __t(133, side(st.a), side(st.b), st.next.toUpperCase());
}
function consumeHeld(player, typeId) {
    try {
        if (String(player.getGameMode()).toLowerCase() === "creative") return true;
        const inv = player.getComponent("minecraft:inventory");
        const slot = inv?.container?.getSlot(player.selectedSlotIndex);
        if (!slot || !slot.hasItem() || (typeId && slot.typeId !== typeId)) return false;
        if (slot.amount > 1) slot.amount = slot.amount - 1; else slot.setItem(undefined);
        return true;
    } catch (e) { dbg(`consume: ${String(e)}`); return false; }
}

/** Добавить патрон в ствол с меньшим запасом (при равенстве A). Чистая логика. */
export function applyTwinLoad(st, typeId) {
    if (!isRound(typeId)) return { ok: false, message: __t(134) };
    const r = ROUNDS[typeId];
    const qa = queueOf(st.a), qb = queueOf(st.b);
    const slot = qa.length <= qb.length ? "a" : "b";
    const other = slot === "a" ? "b" : "a";
    const len = (k) => queueOf(st[k]).length;
    const cap = capOf(st);
    const pick = len(slot) < cap ? slot : len(other) < cap ? other : undefined;
    if (!pick) return { ok: false, message: __t(135, cap) };
    setQueue(st[pick], queueOf(st[pick]) + r.code);
    return { ok: true, message: __t(136, r.name, pick.toUpperCase()) };
}

// ---------- предмет-спуск (ПКМ с пустой рукой события не даёт, поэтому в руку выдаём несъёмный предмет) ----------
function invOf(player) { try { return player.getComponent("minecraft:inventory")?.container; } catch { return undefined; } }
/** Сборка 85: спуск больше НЕ выдаётся при посадке (его можно скрафтить). Здесь убираем только СТАРЫЕ несъёмные (lockMode != none), выданные сборками до 85. Скрафченные остаются. */
function clearLockedTriggers(player) {
    try {
        const c = invOf(player);
        if (!c) return;
        for (let i = 0; i < c.size; i++) {
            const it = c.getItem(i);
            if (it && isTrigger(it.typeId) && String(it.lockMode ?? "none") !== "none") c.setItem(i, undefined);
        }
    } catch (e) { dbg(`clearLockedTriggers: ${String(e)}`); }
}
const holdsTrigger = (p) => { try { return isTrigger(invOf(p)?.getSlot(p.selectedSlotIndex)?.typeId); } catch { return false; } };

// ---------- камера от ствола (спуск в руке) и защита от «иксрея» (сборка 85) ----------
const CAM_USE_GUN_DIR = true; // true: камера смотрит туда же, куда реально стреляет пушка (она догоняет мышь с ограничением скорости); false: взгляд игрока
const CAM_AHEAD = 0.25; // камера впереди дула, блоков (чтобы трубки не закрывали обзор)
const XR = 0.2; // запас вокруг камеры, блоков: если любая из 7 точек внутри блока, экран чернеет
const XR_PTS = [[0, 0, 0], [XR, 0, 0], [-XR, 0, 0], [0, XR, 0], [0, -XR, 0], [0, 0, XR], [0, 0, -XR]];
const XR_REFRESH = 5; // тиков между повторами затемнения, пока камера в блоке
const HOLD_CHECK = 2; // тиков между проверками «спуск в руке» (инвентарь)
const XR_CHECK = 2; // тиков между проверками «камера в блоке» (затемнение держится 0,35 с = 7 тиков)
const XR_CACHE = 10; // если камера не сдвинулась в другие блоки, результат берётся из кэша столько тиков
/** Камера внутри твёрдого блока (или чанк не загружен)? Уникальные блоки вокруг точки проверяются один раз, результат кэшируется в a.xr. */
function buriedAt(a, dim, loc, now) {
    const keys = [], cells = [];
    for (const [dx, dy, dz] of XR_PTS) {
        const x = Math.floor(loc.x + dx), y = Math.floor(loc.y + dy), z = Math.floor(loc.z + dz);
        const k = `${x},${y},${z}`;
        if (keys.includes(k)) continue;
        keys.push(k); cells.push({ x, y, z });
    }
    const key = keys.join(";");
    if (a.xrKey === key && now - a.xrAt2 < XR_CACHE) return a.xrRes;
    let res = false;
    for (const c of cells) {
        try {
            const b = dim.getBlock(c);
            if (!b || (!b.isAir && !b.isLiquid && b.isSolid)) { res = true; break; } // чанк не загружен тоже считаем «внутри»
        } catch { res = true; break; }
    }
    a.xrKey = key; a.xrAt2 = now; a.xrRes = res;
    return res;
}
function camOff(a, p) {
    try { p?.camera?.clear(); } catch (e) { dbg(`camera.clear: ${String(e)}`); }
    try { p?.camera?.fade(); } catch { /* затемнения могло и не быть */ }
    a.camOn = false; a.fadeAt = -1e9; a.cy = undefined; a.cp = undefined; a.xrKey = undefined; a.hold = false;
}
/** У сидящего: спуск в руке = камера из дула; камера (или голова) внутри блока = чёрный экран. Проверки реже тика, setCamera только при смене направления. */
function updateCamera(a, p, now) {
    const cam = p.camera;
    if (!cam) return;
    if (now - (a.holdAt ?? -1e9) >= HOLD_CHECK) { a.holdAt = now; a.hold = holdsTrigger(p); }
    let loc;
    if (a.hold) {
        let yaw = a.yaw, pit = a.pitchUp;
        if (!CAM_USE_GUN_DIR) { const r = p.getRotation(); yaw = r.y; pit = -r.x; }
        if (!a.camOn || yaw !== a.cy || pit !== a.cp) { // направление не менялось: камеру не трогаем
            const d = partDir(yaw, pit);
            const L = (a.len ?? 3) + 0.2 + CAM_AHEAD;
            a.camLoc = { x: a.pivot.x + d.x * L, y: a.pivot.y + SEAT_Y + d.y * L, z: a.pivot.z + d.z * L };
            const opts = { location: a.camLoc, rotation: { x: -pit, y: yaw } };
            if (!a.camOn) opts.easeOptions = { easeTime: 0.15, easeType: MC.EaseType ? MC.EaseType.Linear : "Linear" };
            try { cam.setCamera("minecraft:free", opts); a.camOn = true; a.cy = yaw; a.cp = pit; } catch (e) { dbg(`setCamera: ${String(e)}`); a.camOn = false; }
        }
        loc = a.camLoc;
    } else if (a.camOn) camOff(a, p);
    if (now - (a.xrAt ?? -1e9) < XR_CHECK) return;
    a.xrAt = now;
    if (!loc) loc = p.getHeadLocation();
    if (buriedAt(a, dimOf(a), loc, now) && now - (a.fadeAt ?? -1e9) >= XR_REFRESH) {
        a.fadeAt = now;
        try { cam.fade({ fadeColor: { red: 0, green: 0, blue: 0 }, fadeTime: { fadeInTime: 0, holdTime: 0.35, fadeOutTime: 0.1 } }); } catch (e) { dbg(`fade: ${String(e)}`); }
    }
}
function releaseRider(a) {
    try {
        if (!a.riderId) return;
        const pl = world.getAllPlayers().find((x) => x.id === a.riderId);
        if (pl) { camOff(a, pl); clearLockedTriggers(pl); }
    } catch (e) { dbg(`releaseRider: ${String(e)}`); }
}

// ---------- ручки: всегда смотрят туда же, куда ствол (перекладина у казённика, хваты к стрелку) ----------
const HANDLE_OPP = { north: "south", south: "north", east: "west", west: "east" };
function alignHandles(dim, hpos) {
    try {
        const hb = dim.getBlock(hpos);
        if (!hb || hb.typeId !== "cbc:bronze_vt_handles") return false;
        for (const d of HDIRS) {
            const v = twinDirVec(d);
            const nb = dim.getBlock({ x: hpos.x + v.x, y: hpos.y, z: hpos.z + v.z });
            if (nb && nb.typeId === "cbc:bronze_vt_breech") {
                const want = d; // сборка 59: facing = направление пушки (геометрия ручек зеркалена по y: ножки у казённика)
                const cur = hb.permutation.getState(FACING_STATE);
                if (cur !== want) { hb.setPermutation(hb.permutation.withState(FACING_STATE, want)); }
                return true;
            }
        }
    } catch (e) { __R.log("warn", `[CBC] ручки: не удалось выровнять (${String(e)})`); }
    return false;
}
// сборка 58: ручки без казённика рядом: facing при установке = взгляд игрока, нужен ОБРАТНЫЙ (ножки к казённику, который впереди по взгляду)
function flipFreeHandles(block, player) {
    try {
        const yaw = ((player.getRotation().y % 360) + 360) % 360; // юг 0, запад 90, север 180, восток 270
        const look = yaw < 45 || yaw >= 315 ? "south" : yaw < 135 ? "west" : yaw < 225 ? "north" : "east";
        const want = look; // сборка 59: без разворота
        if (block.permutation.getState(FACING_STATE) !== want) block.setPermutation(block.permutation.withState(FACING_STATE, want));
    } catch (e) { dbg(`flipFreeHandles: ${String(e)}`); }
}
function alignHandlesFromBreech(dim, bpos) {
    for (const d of HDIRS) {
        const v = twinDirVec(d);
        alignHandles(dim, { x: bpos.x - v.x, y: bpos.y, z: bpos.z - v.z });
    }
}

// ---------- ящик боеприпасов: всегда лицом к казённику (сборка 64) ----------
/** facing ящика = направление ОТ ящика К казённику (геометрия ящика сделана под это). */
function alignBox(dim, bpos) {
    try {
        const bb = dim.getBlock(bpos);
        if (!bb || bb.typeId !== BOX_ID) return false;
        for (const d of HDIRS) {
            const v = twinDirVec(d);
            const nb = dim.getBlock({ x: bpos.x + v.x, y: bpos.y, z: bpos.z + v.z });
            if (nb && nb.typeId === "cbc:bronze_vt_breech") {
                const cur = bb.permutation.getState(FACING_STATE);
                if (cur !== d) { bb.setPermutation(bb.permutation.withState(FACING_STATE, d)); }
                return true;
            }
        }
    } catch (e) { __R.log("warn", `[CBC] ящик: не удалось выровнять (${String(e)})`); }
    return false;
}
function alignBoxesAround(dim, pos) {
    for (const d of HDIRS) { const v = twinDirVec(d); alignBox(dim, { x: pos.x + v.x, y: pos.y, z: pos.z + v.z }); }
}

// ---------- активные пушки ----------
// Схема (сборка 47): сиденье и модель РАЗДЕЛЕНЫ.
//  - сиденье `cbc:btc_seat`: невидимая ездовая сущность; каждый тик переносится (teleport) на окружность позади казённика по yaw взгляда;
//  - модель `cbc:bt<раскладка>[a|b]`: статичная сущность, НЕ двигается; при смене шага yaw (6°) или наклона (3°) пересоздаётся командой summon
//    с нужным yaw (так сделана стальная пушка: «верно только то, что задано при создании»); наклон = свойство cbc:pitch, выставленное сразу после создания.
const act = new Map(); // key -> { key, dimId, seat, vis, layout, pivot, yaw, pitchUp, vy, vp, lastVis, orbit, seatPos, homeYaw, shot:{a,b}, lastAny, jump, bar, tries, pending, ... }
let loopHandle;
function ensureLoop() { if (loopHandle === undefined) loopHandle = system.runInterval(tick, 1); }
function valid(e) { try { return !!e && (typeof e.isValid === "function" ? e.isValid() : !!e.isValid); } catch { return false; } }
function ridersOf(ent) { try { return ent.getComponent("minecraft:rideable")?.getRiders() ?? []; } catch { return []; } }
function actOfPlayer(player) {
    for (const a of act.values()) { if (valid(a.seat) && ridersOf(a.seat).some((r) => r.id === player.id)) return a; }
    return undefined;
}
const dimOf = (a) => world.getDimension(a.dimId);
const rad = (d) => (d * Math.PI) / 180;

/** Убрать все сущности пушки (модели и сиденья) в радиусе r от точки c, кроме перечисленных id. */
function sweep(dim, c, r, keep) {
    for (const fam of [VIS_FAMILY, SEAT_FAMILY]) {
        try { for (const e of dim.getEntities({ families: [fam], location: c, maxDistance: r })) { if (!keep || !keep.has(e.id)) { try { e.remove(); } catch { /* уже удалена */ } } } } catch (e) { dbg(`sweep: ${String(e)}`); }
    }
}

// Сборка 51: модель = три сущности: корпус `cbc:bt<n>` и два ствола `cbc:bt<n>a` (нижний) / `cbc:bt<n>b` (верхний). Откат: ствол смещается назад вдоль оси (teleport каждый тик),
// пересоздание модели при повороте берёт текущее смещение, поэтому откат не обрывается при вращении.
const RECOIL_TICKS = 10; // длительность отката ствола, тиков
const RECOIL_DIST = 0.3; // смещение ствола назад, блоков
const SPRING_TICKS = 16; // с пружиной: откат дольше
const SPRING_DIST = 0.88; // сборка 58: с пружиной ствол уходит назад почти на целый блок (почти полностью в пружину)
const pitchK = (up) => Math.round((clamp(up, PMIN, PMAX) - PMIN) / PSTEP); // номер шага наклона = mark_variant (задаётся событием при создании)
function partDir(yawDeg, pitchUpDeg) { const y = rad(yawDeg), t = rad(pitchUpDeg); return { x: -Math.sin(y) * Math.cos(t), y: Math.sin(t), z: Math.cos(y) * Math.cos(t) }; }
function recoilD(a, w, now) {
    const k = now - a.rc[w];
    const T = a.spring ? SPRING_TICKS : RECOIL_TICKS;
    const R = a.spring ? SPRING_DIST : RECOIL_DIST;
    if (k < 0 || k >= T) return 0;
    if (a.spring && k < 1) return R * 0.5; // с пружиной: два тика на ход назад
    if (k <= 1) return R;
    const u = (k - 1) / (T - 1);
    return R * (1 - u) * (1 - u);
}
function barrelLoc(a, w, ys, ps, now) {
    const d = recoilD(a, w, now), v = partDir(ys, ps);
    return { x: a.pivot.x - v.x * d, y: a.pivot.y - v.y * d, z: a.pivot.z - v.z * d };
}
/** Создать одну часть модели (команда summon: поворот задаётся при создании). Вернуть сущность или undefined. */
function spawnPart(a, id, loc, yaw, pitchUp, old) {
    const dim = dimOf(a);
    const ev = `cbc:pk${pitchK(pitchUp)}`;
    let ent;
    try { dim.runCommand(`summon ${id} ${loc.x} ${loc.y} ${loc.z} ${yaw.toFixed(1)} ${(-pitchUp).toFixed(1)} ${ev}`); } catch (e) { dbg(`summon: ${String(e)}`); }
    try { ent = dim.getEntities({ type: id, location: loc, maxDistance: 0.8 }).find((e) => !(valid(old) && e.id === old.id)); } catch (e) { dbg(`find vis: ${String(e)}`); }
    if (!ent) { // запасной путь: Script API
        try { ent = dim.spawnEntity(id, loc, { spawnEvent: ev }); try { ent.setRotation({ x: -pitchUp, y: yaw }); } catch { ent.teleport(loc, { rotation: { x: -pitchUp, y: yaw } }); } } catch (e) { dbg(`spawnEntity vis: ${String(e)}`); return undefined; }
    }
    return ent;
}
/** Обновить модель под текущие yaw/наклон (с квантованием и ограничением частоты). */
function refreshVisual(a, now, force) {
    const ys = wrap180(Math.round(a.yaw / YAW_STEP) * YAW_STEP);
    const ps = clamp(Math.round(a.pitchUp / PSTEP) * PSTEP, PMIN, PMAX);
    if (!force) {
        if (ys === a.vy && ps === a.vp) return;
        if (now - a.lastVis < VIS_MIN_INTERVAL) return;
    }
    const body = spawnPart(a, visId(a.layout), a.pivot, ys, ps, a.vis);
    if (!body) return;
    const va = spawnPart(a, visId(a.layout, "a"), barrelLoc(a, "a", ys, ps, now), ys, ps, a.va);
    const vb = spawnPart(a, visId(a.layout, "b"), barrelLoc(a, "b", ys, ps, now), ys, ps, a.vb);
    const vx = (a.slots ?? []).map((sl, i) => spawnPart(a, boxEntId(sl), a.pivot, ys, ps, a.vx?.[i])); // ящики боеприпасов: едут вместе с пушкой
    const old = [a.vis, a.va, a.vb, ...(a.vx ?? [])];
    a.vis = body; a.va = va; a.vb = vb; a.vx = vx; a.vy = ys; a.vp = ps; a.lastVis = now;
    a.rd = { a: recoilD(a, "a", now), b: recoilD(a, "b", now) };
    for (const o of old) { try { if (valid(o)) o.remove(); } catch { /* уже удалена */ } }
}
/** Сдвинуть стволы по текущей фазе отката (каждый тик). */
function updateRecoil(a, now) {
    for (const w of ["a", "b"]) {
        const e = w === "a" ? a.va : a.vb;
        if (!valid(e)) continue;
        const d = recoilD(a, w, now);
        if (a.rd && a.rd[w] === d) continue;
        if (!a.rd) a.rd = {};
        a.rd[w] = d;
        try { e.teleport(barrelLoc(a, w, a.vy, a.vp, now)); } catch (err) { dbg(`recoil teleport: ${String(err)}`); }
    }
}
/** Перенести сиденье на окружность позади казённика (по yaw). Если игрок при этом слетает: перейти на сиденье в центре. */
function placeSeat(a, player) {
    if (!valid(a.seat)) return;
    const y = rad(a.yaw);
    const x = a.orbit ? a.pivot.x + Math.sin(y) * SEAT_BACK : a.pivot.x;
    const z = a.orbit ? a.pivot.z - Math.cos(y) * SEAT_BACK : a.pivot.z;
    if (a.seatPos && Math.hypot(x - a.seatPos.x, z - a.seatPos.z) < 0.03) return;
    const loc = { x, y: a.pivot.y + SEAT_DY, z };
    try { a.seat.teleport(loc); a.seatPos = loc; } catch (e) { dbg(`seat teleport: ${String(e)}`); return; }
    if (a.orbit && player && !ridersOf(a.seat).length) { // перенос сиденья сбросил седока: запасной режим (сиденье в центре, модель всё равно вращается)
        a.orbit = false;
        const c = { x: a.pivot.x, y: a.pivot.y + SEAT_DY, z: a.pivot.z };
        try { a.seat.teleport(c); a.seatPos = c; } catch { /* ignore */ }
        let ok = false;
        try { ok = a.seat.getComponent("minecraft:rideable").addRider(player) !== false; } catch { /* ignore */ }
        say(player, __t(139, ok ? __t(137) : __t(138)));
    }
}
/** Пушка догоняет цель с ограничением скорости (плавный поворот и подъём). Возвращает true, если цель достигнута. */
function slew(a, aimYaw, aimPitch, ry, rp) {
    const dy = wrap180(aimYaw - a.yaw);
    a.yaw = Math.abs(dy) <= ry ? wrap180(aimYaw) : wrap180(a.yaw + Math.sign(dy) * ry);
    const dp = clamp(aimPitch, PMIN, PMAX) - a.pitchUp;
    a.pitchUp = Math.abs(dp) <= rp ? clamp(aimPitch, PMIN, PMAX) : a.pitchUp + Math.sign(dp) * rp;
    return Math.abs(dy) <= ry && Math.abs(dp) <= rp;
}

function jumpPressed(p) {
    try {
        const info = p.inputInfo;
        if (!info) return false;
        const s = info.getButtonState(MC.InputButton ? MC.InputButton.Jump : "Jump");
        return String(s) === "Pressed";
    } catch { return false; }
}

function tick() {
    const now = system.currentTick;
    for (const [key, a] of [...act]) {
        try { stepOne(key, a, now); } catch (e) { dbg(`twin tick ${key}: ${String(e)}`); }
    }
    if (act.size === 0 && loopHandle !== undefined) { system.clearRun(loopHandle); loopHandle = undefined; }
}

function stepOne(key, a, now) {
    if (a.pending) { // блоки ещё не удалось вернуть (чанк не загружен)
        if (now - a.pending >= RESTORE_RETRY) { a.pending = now; a.tries++; restore(key, a); }
        return;
    }
    if (!a.returning && !valid(a.seat)) { restore(key, a); return; } // сиденье пропало (kill, выгрузка): сразу вернуть блоки
    if (!a.returning && (!valid(a.vis) || !valid(a.va) || !valid(a.vb) || (a.slots ?? []).some((_, i) => !valid(a.vx?.[i]))) && now - (a.retry ?? -1e9) >= 10) { a.retry = now; refreshVisual(a, now, true); } // часть модели потерялась: создать заново
    const riders = a.returning ? [] : ridersOf(a.seat);
    if (riders.length) {
        a.seen = true;
        a.returning = false;
        const p = riders[0];
        a.riderId = p.id;
        const r = p.getRotation();
        slew(a, r.y, -r.x, TURN_RATE, ELEV_RATE);
        placeSeat(a, p);
        refreshVisual(a, now);
        updateRecoil(a, now);
        updateCamera(a, p, now);
        if (JUMP_FIRES) {
            const jp = jumpPressed(p);
            if (jp && !a.jump) shoot(a, p, now);
            a.jump = jp;
        }
        if (now - a.bar >= 10) { a.bar = now; const st = readState(key); if (st) bar(p, __t(140, describe(st), wrap180(a.yaw).toFixed(0), a.pitchUp.toFixed(0))); }
        return;
    }
    if (!a.returning && (a.seen || now > a.grace)) {
        a.returning = true; releaseRider(a);
        try { if (valid(a.seat)) a.seat.remove(); } catch { /* уже удалена */ }
    }
    if (!a.returning) return;
    // плавный возврат: yaw кратчайшим путём, наклон к 0
    const done = slew(a, a.homeYaw, 0, RETURN_YAW_PER_TICK, ELEV_RATE);
    if (!done) { refreshVisual(a, now); updateRecoil(a, now); return; }
    a.yaw = a.homeYaw;
    restore(key, a);
}

/** Вернуть блоки и убрать сущности. Если чанк не загружен: повторять (a.pending). */
function restore(key, a) {
    const st = readState(key);
    const cells0 = st?.cells; // сборка 71: список деталей нужен после очистки st.cells
    const dim = world.getDimension(a.dimId);
    let ok = true;
    if (st?.cells) {
        for (let ci = 0; ci < st.cells.length; ci++) {
            const c = st.cells[ci];
            if (a.lost?.has(ci)) continue; // сборка 71: деталь разбита попаданием, не возвращается
            try {
                const b = dim.getBlock({ x: c.p[0], y: c.p[1], z: c.p[2] });
                if (!b) { ok = false; continue; }
                if (b.typeId === c.t) continue;
                b.setPermutation(BlockPermutation.resolve(c.t, c.s));
            } catch { ok = false; }
        }
    }
    if (!ok) {
        if (!a.pending) __R.log("warn", "[CBC] бронзовая пушка: блоки не удалось вернуть сразу (чанк не загружен), повторяю");
        a.pending = system.currentTick;
        if (a.tries >= RESTORE_GIVEUP) { __R.log("warn", `[CBC] бронзовая пушка ${key}: блоки не возвращены, запись сохранена (вернутся при следующей загрузке мира)`); act.delete(key); }
        return;
    }
    releaseRider(a);
    try { if (valid(a.seat)) a.seat.remove(); } catch { /* уже удалена */ }
    for (const o of [a.vis, a.va, a.vb, ...(a.vx ?? [])]) { try { if (valid(o)) o.remove(); } catch { /* уже удалена */ } }
    const c0 = st?.cells?.[0]?.p;
    if (c0) sweep(dim, { x: c0[0] + 0.5, y: c0[1], z: c0[2] + 0.5 }, 14); // потерянные модели/сиденья (id не отслеживались)
    if (st) { st.active = false; delete st.cells; delete st.eid; writeState(key, st); }
    act.delete(key);
    if (a.lost && a.lost.size && !a.lostDone && cells0) { // сборка 71: разбитые детали: обломки выпадают (шанс 50%), без ящика лишние патроны выпадают тоже
        a.lostDone = true;
        for (const i of a.lost) {
            const c = cells0[i];
            if (!c) continue;
            if (String(c.t).startsWith("cbc:") && Math.random() < 0.5) { try { dim.spawnItem(new MC.ItemStack(c.t, 1), { x: c.p[0] + 0.5, y: c.p[1] + 0.5, z: c.p[2] + 0.5 }); } catch { /* ignore */ } }
            if (c.t === BOX_ID) { try { dropBoxAmmo(dim, { x: c.p[0], y: c.p[1], z: c.p[2] }); } catch { /* ignore */ } }
        }
    }
}

// ---------- удар по поднятой автопушке (сборка 71) ----------
function twinPoints(a) {
    const n = Math.min(8, Math.max(1, a.ncell ?? readState(a.key)?.cells?.length ?? 3)); // сборка 85: число деталей запомнено при посадке (probe зовётся от снарядов каждый тик, JSON.parse там дорог)
    const d = partDir(a.yaw, a.pitchUp);
    const base = { x: a.pivot.x, y: a.pivot.y + SEAT_Y, z: a.pivot.z };
    return [base, a.seatPos ?? base, { x: base.x + d.x * n * 0.5, y: base.y + d.y * n * 0.5, z: base.z + d.z * n * 0.5 }];
}
const near = (pts, at) => Math.min(...pts.map((q) => Math.hypot(q.x - at.x, q.y - at.y, q.z - at.z)));
function probeTwinHit(dim, pos, r) {
    for (const a of act.values()) if (a.dimId === dim.id && !a.pending && near(twinPoints(a), pos) <= r) return true;
    return false;
}
/** Взрыв радиуса R в точке at: автопушка рядом теряет 1-2 детали (вернутся не все) и выбрасывает стрелка с сиденья. */
function damageTwins(dim, at, R) {
    const now = system.currentTick;
    for (const [key, a] of act) {
        if (a.dimId !== dim.id || a.pending || a.hurtTick === now) continue;
        const dmin = near(twinPoints(a), at);
        if (dmin > R + 1.5) continue;
        a.hurtTick = now;
        const st = readState(key);
        if (!st?.cells) continue;
        a.lost = a.lost ?? new Set();
        const free = st.cells.map((_, i) => i).filter((i) => !a.lost.has(i));
        const n = dmin <= R * 0.5 + 1 ? 2 : 1;
        for (let k = 0; k < n && free.length; k++) a.lost.add(free.splice(Math.floor(Math.random() * free.length), 1)[0]);
        try { const pl = world.getAllPlayers().find((x) => x.id === a.riderId); if (pl) say(pl, __t(141)); } catch { /* ignore */ }
        try { if (valid(a.seat)) a.seat.remove(); } catch { /* уже удалена */ } // без сиденья stepOne сразу вернёт блоки (кроме разбитых)
    }
}
setTwinHooks(damageTwins, probeTwinHit);

// ---------- посадка ----------
// сборка 56: посадка может прийти двумя путями (компонент блока и afterEvents.playerInteractWithBlock), второй вызов в те же тики игнорируем
const lastMountTry = new Map();
function tryMount(block, player) {
    const now = system.currentTick;
    if (now - (lastMountTry.get(player.id) ?? -1e9) < 10) return;
    lastMountTry.set(player.id, now);
    if (lastMountTry.size > 16) for (const [k, t] of lastMountTry) if (now - t > 200) lastMountTry.delete(k); // сборка 85: карта не растёт за время жизни мира
    mount(block, player);
}
/**
 * Сборка 56: компонент блока ручек. Событие playerInteractWithBlock приходит при пустой руке ТОЛЬКО если взаимодействие «успешно»
 * (блок интерактивный); у обычного кастомного блока без компонента клик пустой рукой до скрипта не доходит.
 * Компонент onPlayerInteract делает блок интерактивным, и клик пустой рукой по ручкам начинает приходить.
 */
export function registerTwinComponent(registry) {
    registry.registerCustomComponent("cbc:twin_handles", {
        onPlayerInteract: (e) => {
            try {
                const player = e.player;
                const block = e.block;
                if (!player || !block) return;
                if (player.isSneaking || actOfPlayer(player)) return;
                const held = player.getComponent("minecraft:inventory")?.container?.getItem(player.selectedSlotIndex)?.typeId;
                if (isRound(held)) return; // сборка 85: со спуском в руке тоже садимся
                system.run(() => { try { tryMount(block, player); } catch (err) { __R.log("warn", `[CBC] ошибка посадки: ${String(err)}`); } });
            } catch (err) { __R.log("warn", `[CBC] ошибка компонента ручек: ${String(err)}`); }
        },
    });
}

function mount(block, player) {
    if (S.frozen) { say(player, __t(142)); return; }
    const dim = block.dimension;
    const found = findTwin({ x: block.x, y: block.y, z: block.z }, makeReader(dim));
    if (!found) { say(player, __t(143, block.typeId)); return; }
    if (!found.valid) { say(player, __t(144, found.reason ?? "?")); return; }
    if (!found.hasMount) { say(player, __t(145)); return; }
    if (!found.hasHandles) { say(player, __t(146)); return; }
    const key = stKey(dim.id, found.breechPos);
    if (act.has(key)) { say(player, __t(147)); return; }
    const st = readState(key) ?? freshState();
    if (st.active) { say(player, __t(148)); return; }
    if (actOfPlayer(player)) { say(player, __t(149)); return; }
    // 1) запомнить блоки как есть (состояния не меняем), 2) создать сиденье и модель (при неудаче блоки НЕ трогаем), 3) записать состояние, 4) убрать блоки, 5) посадить
    try { alignHandles(dim, found.handlesPos); } catch { /* ignore */ } // сборка 57: ручки к казённику ДО запоминания состояния
    const boxes = found.boxes ?? [];
    for (const b of boxes) { try { alignBox(dim, b.pos); } catch { /* ignore */ } } // сборка 64: ящики лицом к казённику ДО запоминания состояния
    st.cap = capFor(found);
    const cells = [];
    for (const c of [...found.cells, { pos: found.handlesPos, part: "handles" }, ...boxes.map((b) => ({ pos: b.pos, part: "ammo_box" }))]) {
        const b = dim.getBlock(c.pos);
        if (!b) { say(player, __t(150)); return; }
        // сборка 55: facing блоков НЕ меняем (раньше выравнивали к направлению пушки, из-за чего казённик «разворачивало» после возврата)
        cells.push({ p: [c.pos.x, c.pos.y, c.pos.z], t: b.typeId, s: b.permutation.getAllStates() });
    }
    const pivot = { x: found.breechPos.x + 0.5, y: found.breechPos.y, z: found.breechPos.z + 0.5 };
    const yaw = TWIN_YAW[found.dir];
    sweep(dim, pivot, 14); // остатки прошлых сеансов
    const now = system.currentTick;
    pruneStates(now);
    const a = { key, dimId: dim.id, seat: undefined, vis: undefined, va: undefined, vb: undefined, rc: { a: -1e9, b: -1e9 }, rd: { a: 0, b: 0 }, spring: found.seq.includes("S"), layout: found.layout, pivot, yaw, pitchUp: 0, vy: 1e9, vp: 1e9, lastVis: -1e9, orbit: true, seatPos: undefined,
        seen: false, grace: now + GRACE_TICKS, returning: false, homeYaw: yaw, shot: { a: -1e9, b: -1e9 }, lastAny: -1e9, mountedAt: now, jump: jumpPressed(player), bar: 0, trig: 0, riderId: player.id, tries: 0, pending: 0, len: found.seq.length, ncell: cells.length, camOn: false, fadeAt: -1e9,
        slots: [...new Set(boxes.map((b) => b.slot))], vx: [] };
    const sy = rad(yaw);
    const seatLoc = { x: pivot.x + Math.sin(sy) * SEAT_BACK, y: pivot.y + SEAT_DY, z: pivot.z - Math.cos(sy) * SEAT_BACK };
    try { a.seat = dim.spawnEntity(SEAT_ENTITY, seatLoc); a.seatPos = seatLoc; }
    catch (e) { say(player, __t(151, SEAT_ENTITY, String(e))); return; }
    refreshVisual(a, now, true);
    if (!valid(a.vis)) { try { a.seat.remove(); } catch { /* ignore */ } say(player, __t(152, visId(found.layout))); return; }
    st.cells = cells; st.layout = found.layout; st.seq = found.seq; st.dir = found.dir; st.barrels = found.barrels;
    st.active = true; st.dim = dim.id;
    writeState(key, st); // СНАЧАЛА запись (нужна восстановлению), потом удаляем блоки
    for (const c of [...found.cells, { pos: found.handlesPos }, ...boxes]) { try { dim.getBlock(c.pos).setType("minecraft:air"); } catch (e) { dbg(`air: ${String(e)}`); } }
    act.set(key, a);
    ensureLoop();
    const seat = a.seat;
    let seated = false;
    try { seated = seat.getComponent("minecraft:rideable").addRider(player) !== false; } catch (e) { say(player, `§e[CBC] addRider: ${String(e)}`); }
    // запасной вариант: команда /ride (если компонент не посадил игрока)
    system.runTimeout(() => {
        try {
            if (!valid(seat) || ridersOf(seat).length) return;
            const l = seat.location;
            player.runCommand(`ride @s start_riding @e[type=${SEAT_ENTITY},x=${l.x},y=${l.y},z=${l.z},r=3,c=1] teleport_rider`);
        } catch (e) { say(player, __t(153, String(e))); }
    }, 2);
    system.runTimeout(() => {
        try { if (valid(seat) && !ridersOf(seat).length) say(player, __t(154)); } catch { /* ignore */ }
    }, 12);
    // сборка 60: при посадке взгляд игрока = направление пушки (иначе пушка разворачивалась вслед за взглядом, если садились лицом к ручкам)
    const faceFwd = () => { try { if (valid(seat) && typeof player.setRotation === "function") player.setRotation({ x: 0, y: yaw }); } catch { /* ignore */ } };
    faceFwd(); system.runTimeout(faceFwd, 1); system.runTimeout(faceFwd, 3);
    try { clearLockedTriggers(player); } catch { /* ignore */ } // сборка 85: спуск не выдаётся, убираем только старые несъёмные
    say(player, seated ? __t(156, boxes.length ? __t(155, capOf(st)) : "") : __t(157));
}

// ---------- стрельба ----------
function shoot(a, player, now) {
    if (S.frozen) return;
    if (a.lastInput === now) return; // несколько событий ввода в один тик = один выстрел
    a.lastInput = now;
    if (now - a.mountedAt < MOUNT_FIRE_DELAY) return; // сборка 69: 1 с после посадки выстрел заблокирован (случайный выстрел от клика посадки)
    if (now - a.lastAny < GLOBAL_CD) return;
    const st = readState(a.key);
    if (!st) return;
    let which = st.next;
    const other = which === "a" ? "b" : "a";
    const ready = (k) => queueOf(st[k]).length > 0;
    if (!ready(which)) { if (ready(other)) which = other; else { bar(player, __t(158, describe(st))); return; } }
    if (now - a.shot[which] < BARREL_CD) return;
    if (liveCount() >= LIMITS.maxProjectilesAlive) { bar(player, __t(159)); return; }
    const slot = st[which];
    const queue = queueOf(slot);
    const rnd = ROUND_BY_CODE[queue[0]] ?? ROUND_BY_CODE.a; // тип патрона = первый в очереди ствола
    const scanLike = { valid: true, materialId: "bronze", direction: st.dir, chambers: 1, barrels: Math.max(1, st.barrels), breechPos: { x: 0, y: 0, z: 0 }, muzzlePos: { x: 0, y: 0, z: 0 } };
    const plan = planShot(scanLike, { projectileId: rnd.munition, charges: 1 }, Math.random); // разброс по длине ствола; скорость ниже заменена данными автопушки
    // сборка 71: части пушки: пружина (разброс), дульный тормоз (M: дальше, прямее, чуть хуже кучность), глушитель (N: дальше, навесом), длина ствола (скорость и сила)
    const M = AUTOCANNON_MODS, braked = st.seq.includes("M"), muffled = st.seq.endsWith("N"), sprungShot = st.seq.includes("S");
    const modSpeed = braked ? M.brake.speedMult : muffled ? M.silencer.speedMult : 1;
    const gMult = braked ? M.brake.gravityMult : muffled ? M.silencer.gravityMult : 1;
    const spreadDeg = plan.spreadDeg + (sprungShot ? 0 : M.noSpringSpreadDeg) + (braked ? M.brake.spreadDeg : 0);
    const barrelsUsed = Math.min(Math.max(1, st.barrels), 6);
    const power = M.powerMin + (M.powerMax - M.powerMin) * (barrelsUsed - 1) / 5;
    const speed = (AUTOCANNON[rnd.munition]?.speed ?? plan.speed) * (0.92 + 0.08 * barrelsUsed / 6) * modSpeed;
    if (!plan.ok) { bar(player, `§c[CBC] ${plan.reason ?? __t(160)}`); return; }
    if (a.returning) return;
    const yaw = rad(a.yaw);
    const th = rad(a.pitchUp);
    const dir = { x: -Math.sin(yaw) * Math.cos(th), y: Math.sin(th), z: Math.cos(yaw) * Math.cos(th) };
    const up = { x: Math.sin(yaw) * Math.sin(th), y: Math.cos(th), z: -Math.cos(yaw) * Math.sin(th) };
    const cells = st.seq.length;
    const off = which === "a" ? -0.25 : 0.25; // A: НИЖНЯЯ трубка, B: верхняя (кость orient повёрнута на 90° по x: z модели -> y мира); трубки на ±4 пикселя от оси
    const L = cells - 0.5 + 0.7;
    const base = { x: a.pivot.x, y: a.pivot.y + SEAT_Y, z: a.pivot.z };
    const origin = { x: base.x + dir.x * L + up.x * off, y: base.y + dir.y * L + up.y * off, z: base.z + dir.z * L + up.z * off };
    const vdir = applySpread(dir, (spreadDeg * Math.PI) / 180, Math.random);
    const dim = dimOf(a);
    try {
        spawnProjectile(dim, origin, { x: vdir.x * speed, y: vdir.y * speed, z: vdir.z * speed }, plan.munitionId, 0, { gravityMult: gMult, power });
    } catch (err) { bar(player, __t(161, String(err))); return; }
    a.shot[which] = now; a.lastAny = now;
    setQueue(slot, queue.slice(1));
    st.next = which === "a" ? "b" : "a";
    writeState(a.key, st);
    a.rc[which] = now; try { updateRecoil(a, now); } catch (e) { dbg(`recoil visual: ${String(e)}`); } // откат только у выстрелившей трубки
    const silenced = st.seq.endsWith("N"); // сборка 58: глушитель (N): почти нет дыма, выстрел тише
    const sprung = st.seq.includes("S"); // с пружиной экран не трясёт, без пружины трясёт
    try { dim.playSound("cbc.fire_autocannon", origin, silenced ? { volume: 0.5, pitch: 1.4 } : { volume: 3, pitch: 0.95 + Math.random() * 0.12 }); } catch { /* звук не критичен */ } // сборка 62: звук автопушки из аддона
    // сборка 62: гильза вылетает из казённика вбок (A вправо, B влево), с кувырком; звук экстракции чуть позже выстрела
    try {
        const sd = which === "a" ? 1 : -1;
        const right = { x: -Math.cos(yaw), y: 0, z: -Math.sin(yaw) }; // вправо от стрелка (смотрит вдоль dir)
        const bp = { x: base.x + dir.x * 0.4 + up.x * off + right.x * sd * 0.2, y: base.y + dir.y * 0.4 + up.y * off, z: base.z + dir.z * 0.4 + up.z * off + right.z * sd * 0.2 };
        const j = () => (Math.random() - 0.5) * 0.08;
        ejectCasing(dim, bp, { x: right.x * sd * EJECT_SIDE - dir.x * EJECT_BACK + j(), y: EJECT_UP + Math.random() * 0.08, z: right.z * sd * EJECT_SIDE - dir.z * EJECT_BACK + j() });
        if (!silenced) system.runTimeout(() => { try { dim.playSound("cbc.cartridge_extract", bp, { volume: 0.5, pitch: 1.5 + Math.random() * 0.3 }); } catch { /* звук не критичен */ } }, 3);
    } catch (e) { dbg(`casing: ${String(e)}`); }
    const mz = { x: origin.x - dir.x * 0.1, y: origin.y - dir.y * 0.1, z: origin.z - dir.z * 0.1 };
    muzzleBlast(dim, mz, dir, 1, true, silenced); // светлый и небольшой дым автопушки; с глушителем только слабый след
    if (!sprung) shake(dim, origin, silenced ? 0.4 : 0.7);
}

// ---------- сломанный ящик боеприпасов (сборка 71) ----------
/** Ящик сломан: патроны, которые уже не влезают в стволы без ящика (сверх 8 на ствол), выпадают предметами на месте ящика. */
function dropBoxAmmo(dim, boxPos) {
    for (const d of HDIRS) {
        const v = twinDirVec(d);
        const np = { x: boxPos.x + v.x, y: boxPos.y, z: boxPos.z + v.z };
        const nb = dim.getBlock(np);
        if (!nb || nb.typeId !== "cbc:bronze_vt_breech") continue;
        const found = findTwin(np, makeReader(dim));
        if (!found || !found.valid) continue;
        const key = stKey(dim.id, found.breechPos);
        if (act.has(key)) return; // пушка сейчас занята (блоки убраны): ящик как блок сломать нельзя
        const st = readState(key);
        if (!st) return;
        const cap = capFor(found); // без ящика 8 на ствол; если остался второй ящик, 45
        const drops = {};
        for (const k of ["a", "b"]) {
            const q = queueOf(st[k]);
            if (q.length <= cap) continue;
            for (const c of q.slice(cap)) drops[c] = (drops[c] ?? 0) + 1;
            setQueue(st[k], q.slice(0, cap));
        }
        st.cap = cap;
        writeState(key, st);
        const at = { x: boxPos.x + 0.5, y: boxPos.y + 0.5, z: boxPos.z + 0.5 };
        for (const [c, n] of Object.entries(drops)) {
            const id = ROUND_BY_CODE[c]?.itemId;
            if (!id) continue;
            for (let left = n; left > 0; left -= 64) dim.spawnItem(new MC.ItemStack(id, Math.min(64, left)), at);
        }
        return;
    }
}

// ---------- заряжание и отчёты ----------
function loadInto(block, player, typeId) {
    const found = findTwin({ x: block.x, y: block.y, z: block.z }, makeReader(block.dimension));
    if (!found || !found.valid) { bar(player, __t(144, found?.reason ?? "?")); return; }
    if (found.hasHandles) alignHandles(block.dimension, found.handlesPos);
    for (const b of found.boxes ?? []) alignBox(block.dimension, b.pos);
    const key = stKey(block.dimension.id, found.breechPos);
    if (act.has(key)) { bar(player, __t(162)); return; }
    const st = readState(key) ?? freshState();
    st.cap = capFor(found); // с ящиком сбоку казённика 45 на ствол, без него 8
    const res = applyTwinLoad(st, typeId);
    if (res.ok && !consumeHeld(player, typeId)) { bar(player, __t(163)); return; }
    if (res.ok) writeState(key, st);
    bar(player, `${res.ok ? "§a" : "§c"}[CBC] ${res.message} | ${describe(st)}`);
}
function loadIntoActive(a, player, typeId) {
    const st = readState(a.key);
    if (!st) return;
    const res = applyTwinLoad(st, typeId);
    if (res.ok && !consumeHeld(player, typeId)) { bar(player, __t(163)); return; }
    if (res.ok) writeState(a.key, st);
    bar(player, `${res.ok ? "§a" : "§c"}[CBC] ${res.message} | ${describe(st)}`);
}
function report(block, player) {
    const found = findTwin({ x: block.x, y: block.y, z: block.z }, makeReader(block.dimension));
    if (!found) return;
    if (!found.valid) { say(player, __t(144, found.reason ?? "?")); return; }
    if (found.hasHandles) alignHandles(block.dimension, found.handlesPos);
    for (const b of found.boxes ?? []) alignBox(block.dimension, b.pos);
    const st = readState(stKey(block.dimension.id, found.breechPos)) ?? freshState();
    st.cap = capFor(found); // только для отчёта (не сохраняется)
    const box = found.boxes?.length ? __t(164, found.boxes.length, BOX_CAP) : __t(165, ROUND_CAP, BOX_CAP);
    const miss = !found.hasMount ? __t(166) : !found.hasHandles ? __t(167) : "";
    say(player, __t(168, found.seq, found.barrels, found.dir, describe(st), box, miss));
}

// ---------- старт мира: восстановление ----------
export function restoreTwins() {
    try {
        for (const id of world.getDynamicPropertyIds()) {
            const m = KEY_RE.exec(id);
            if (!m) continue;
            const st = readState(id);
            if (!st?.active) continue;
            const a = { dimId: m[1], ent: undefined, tries: 0, pending: 0 };
            restore(id, a);
            if (a.pending) { a.key = id; act.set(id, a); ensureLoop(); } // не вышло: повторяем в цикле
        }
        for (const d of ["overworld", "nether", "the_end"]) {
            try {
                const keep = new Set();
                for (const x of act.values()) { if (valid(x.seat)) keep.add(x.seat.id); if (valid(x.vis)) keep.add(x.vis.id); if (valid(x.va)) keep.add(x.va.id); if (valid(x.vb)) keep.add(x.vb.id); for (const e of x.vx ?? []) { if (valid(e)) keep.add(e.id); } }
                for (const fam of [VIS_FAMILY, SEAT_FAMILY]) for (const e of world.getDimension(d).getEntities({ families: [fam] })) { if (!keep.has(e.id)) e.remove(); }
            } catch { /* измерение не загружено */ }
        }
    } catch (e) { dbg(`restoreTwins: ${String(e)}`); }
}

export function registerTwin() {
    // клик боеприпасом: зарядить (до установки блока)
    world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
        try {
            const ra = actOfPlayer(ev.player); // сидящий за пушкой: ПКМ по блоку = выстрел (патрон в руке = зарядить)
            if (ra) {
                ev.cancel = true;
                const { player } = ev;
                const tid = ev.itemStack?.typeId;
                if (isRound(tid) && !ev.isFirstEvent) return;
                system.run(() => { try { if (isRound(tid)) loadIntoActive(ra, player, tid); else shoot(ra, player, system.currentTick); } catch (e) { dbg(`seat block: ${String(e)}`); } });
                return;
            }
            if (!ev.isFirstEvent || !twinPart(ev.block.typeId)) return;
            const typeId = ev.itemStack?.typeId;
            if (twinPart(ev.block.typeId) === "ammo_box") { const bb = ev.block; system.run(() => { try { alignBox(bb.dimension, bb.location); } catch { /* ignore */ } }); }
            if (twinPart(ev.block.typeId) === "handles") { const hb = ev.block; system.run(() => { try { alignHandles(hb.dimension, hb.location); } catch { /* ignore */ } }); } // сборка 60: ручки к казённику при любом клике
            if (!isRound(typeId) && !ev.player.isSneaking && twinPart(ev.block.typeId) === "handles") { // сборка 57: посадка и из before (пустая рука)
                const { block, player } = ev;
                system.run(() => { try { tryMount(block, player); } catch (e) { __R.log("warn", `[CBC] ошибка посадки: ${String(e)}`); } });
                return;
            }
            if (!isRound(typeId) || ev.player.isSneaking) return;
            ev.cancel = true;
            const { block, player } = ev;
            system.run(() => { try { loadInto(block, player, typeId); } catch (e) { __R.log("warn", `[CBC] ошибка заряжания (бронза): ${String(e)}`); } });
        } catch (e) { __R.log("warn", `[CBC] ошибка before (бронза): ${String(e)}`); }
    });
    // ПКМ по РУЧКАМ без Shift (с пустой рукой или любым предметом, кроме патрона): сесть; по остальным частям и с Shift: отчёт
    world.afterEvents.playerInteractWithBlock.subscribe((ev) => {
        try {
            if (!twinPart(ev.block.typeId)) return;
            if (!ev.isFirstEvent) return;
            const typeId = ev.itemStack?.typeId;
            if (isRound(typeId) && !ev.player.isSneaking) return;
            const { block, player } = ev;
            if (!isRound(typeId) && !player.isSneaking && twinPart(ev.block.typeId) === "handles") system.run(() => { try { tryMount(block, player); } catch (e) { __R.log("warn", `[CBC] ошибка посадки: ${String(e)}`); } });
            else report(block, player);
        } catch (e) { __R.log("warn", `[CBC] ошибка after (бронза): ${String(e)}`); }
    });
    // зарядить сидящую/занятую пушку, кликнув по сущности боеприпасом
    world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
        try {
            const ra = actOfPlayer(ev.player); // сидящий: ПКМ по любой сущности (в том числе по самой пушке) = выстрел
            if (ra) {
                ev.cancel = true;
                const { player } = ev;
                const tid = ev.itemStack?.typeId;
                system.run(() => { try { if (isRound(tid)) loadIntoActive(ra, player, tid); else shoot(ra, player, system.currentTick); } catch (e) { dbg(`seat entity: ${String(e)}`); } });
                return;
            }
            if (!isTwinEntityId(ev.target.typeId)) return;
            const typeId = ev.itemStack?.typeId;
            if (!isRound(typeId)) return;
            ev.cancel = true;
            const { target, player } = ev;
            system.run(() => { const a = [...act.values()].find((x) => (valid(x.seat) && x.seat.id === target.id) || (valid(x.vis) && x.vis.id === target.id) || (valid(x.va) && x.va.id === target.id) || (valid(x.vb) && x.vb.id === target.id) || (x.vx ?? []).some((e) => valid(e) && e.id === target.id)); if (a) loadIntoActive(a, player, typeId); });
        } catch (e) { dbg(`entity interact: ${String(e)}`); }
    });
    // ввод сидящего: любое использование предмета = выстрел (ammo в руке = зарядить); прыжок читается в цикле
    const onUse = (player, item) => {
        const a = actOfPlayer(player);
        const typeId = item?.typeId;
        if (!a) return; // спуск вне пушки ничего не делает

        if (isRound(typeId)) { loadIntoActive(a, player, typeId); return; }
        shoot(a, player, system.currentTick);
    };
    world.afterEvents.itemUse.subscribe((ev) => { try { onUse(ev.source, ev.itemStack); } catch (e) { dbg(`itemUse: ${String(e)}`); } });
    try {
        world.afterEvents.playerButtonInput?.subscribe((ev) => {
            try {
                if (String(ev.newButtonState) !== "Pressed" || String(ev.button) === "Sneak") return;
                const a = actOfPlayer(ev.player);
                if (a && String(ev.button) === "Jump") shoot(a, ev.player, system.currentTick);
            } catch { /* ignore */ }
        });
    } catch { /* событие недоступно */ }
    // забытый спуск (выход из игры, смерть) снимаем при появлении игрока
    try { world.afterEvents.playerSpawn.subscribe((ev) => { try { if (!actOfPlayer(ev.player)) { clearLockedTriggers(ev.player); try { ev.player.camera.clear(); } catch { /* ignore */ } } } catch { /* ignore */ } }); } catch { /* событие недоступно */ }
    // ручки сами поворачиваются к казённику при установке (и ручек, и казённика)
    try {
        world.afterEvents.playerPlaceBlock.subscribe((ev) => {
            try {
                const t = ev.block.typeId;
                const d = ev.block.dimension;
                if (t === "cbc:bronze_vt_handles") { if (!alignHandles(d, ev.block.location)) flipFreeHandles(ev.block, ev.player); }
                else if (t === BOX_ID) alignBox(d, ev.block.location);
                else if (t === "cbc:bronze_vt_breech") { alignHandlesFromBreech(d, ev.block.location); alignBoxesAround(d, ev.block.location); }
                if (AUTO_MOUNT && twinPart(t)) { // ТЕСТ: достроил пушку (казённик + станина + ручки + стволы) = сразу сел
                    const { block, player } = ev;
                    system.run(() => {
                        try {
                            if (actOfPlayer(player)) return;
                            const f = findTwin({ x: block.x, y: block.y, z: block.z }, makeReader(block.dimension));
                            if (f && f.valid && f.hasMount && f.hasHandles) mount(block, player);
                        } catch (e) { dbg(`automount: ${String(e)}`); }
                    });
                }
            } catch (e) { dbg(`place: ${String(e)}`); }
        });
    } catch { /* событие недоступно */ }
    world.afterEvents.playerBreakBlock.subscribe((ev) => {
        try { if (ev.brokenBlockPermutation.type.id === "cbc:bronze_vt_breech") writeState(stKey(ev.dimension.id, ev.block), undefined); } catch { /* ignore */ }
        try { if (ev.brokenBlockPermutation.type.id === BOX_ID) dropBoxAmmo(ev.dimension, ev.block.location); } catch (e) { dbg(`box drop: ${String(e)}`); }
    });
}
