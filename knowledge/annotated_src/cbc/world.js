/* CLAUDE-MAP-BEGIN
 FILE: cbc/world.js  (38 KB, 791 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: CBC world interaction (break/explode/lever).
 IMPORTS: @minecraft/server, cbc/config/overrides.js, cbc/effects.js, cbc/fire.js, cbc/fuze.js, cbc/loading.js, cbc/multiblock.js, cbc/perf.js, cbc/projectiles.js, cbc/recoil.js, cbc/settings.js, core/gauntlet.js, i18n/i18n.js
 IMPORTED BY: cbc/admin.js, cbc/cmMount.js, cbc/main.js, core/cbcMount.js
 EXPORTS: makeReader, fireCannon, registerBreechComponent, setCannonsFrozen, armedCount, dischargeAll, registerInteraction, getLoadAt, setLoadAt, getElevAt, setElevAt, clearLoadAt
 EVENTS: blockExplode, leverAction, playerBreakBlock, playerInteractWithBlock
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): registerInteraction@641(143L); fireCannon@283(98L); pollRedstone@500(68L); adjustElevation@123(30L); report@247(29L); loadInto@202(27L); blockPowered@422(24L); syncRaise@99(23L); dischargeAll@586(22L); consumeHeld@165(21L); registerBreechComponent@386(21L); unloadFrom@622(19L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { __t, __R } from "../i18n/i18n.js";
// Адаптер Script API -> чистая логика. Здесь (и только здесь) живут вызовы @minecraft/server для мультиблока.
// TODO-VERIFY (в игре не запускалось): имя состояния FACING_STATE и формат его значений.
import { ItemStack, system, world } from "@minecraft/server";
import { gauntletInfo } from "../core/gauntlet.js";
import { DEBUG, LIMITS } from "./config/overrides.js";
import { S, saveSettings } from "./settings.js";
import { sampleTps } from "./perf.js";
import { estimateRange as estRaw, flightParams, mortarScatter, planShot } from "./fire.js";
const estimateRange = (r, c) => Math.round(estRaw(r, c));
import { muzzleBlast, shake } from "./effects.js";
import { canElevate, clampElevation, fireRecoil, healHidden, raiseRemaining, releaseByPos, setElevation } from "./recoil.js";
import { liveCount, spawnProjectile } from "./projectiles.js";
import { ammoKind, ammoName, applyLoad, chargeCapacity, describeLoad, emptyLoad, unloadFor } from "./loading.js";
import { MORTAR, SHORT_BARREL, rulesFor, rulesOf } from "./config/overrides.js";
import { barrelFactor } from "./fire.js";
import { dirVec, findCannon, parsePart } from "./multiblock.js";
import { fuzeFromItem, fuzeLore } from "./fuze.js";
const FACING_STATE = "minecraft:facing_direction"; // тот же, что FACING_STATE в tools/gen_blocks.py
const DIRS = ["north", "south", "east", "west", "up", "down"];
/** Читатель блоков для сканера. getBlock возвращает undefined/бросает ошибку в незагруженном чанке. */
export function makeReader(origin) {
    return (pos) => {
        try {
            const b = origin.dimension.getBlock(pos);
            if (!b)
                return undefined;
            const f = b.permutation.getState(FACING_STATE);
            const facing = typeof f === "string" && DIRS.includes(f) ? f : undefined;
            return { typeId: b.typeId, facing };
        }
        catch {
            return undefined;
        }
    };
}
/** Отладка: что стоит вокруг блока и куда он смотрит (для случая «казённик не найден»). */
function around(block) {
    const names = [[__t(178), 0, 0, -1], [__t(179), 0, 0, 1], [__t(180), 1, 0, 0], [__t(181), -1, 0, 0], [__t(182), 0, 1, 0], [__t(183), 0, -1, 0]];
    const parts = names.map(([n, x, y, z]) => {
        const b = block.dimension.getBlock({ x: block.x + x, y: block.y + y, z: block.z + z });
        return `${n}: ${b ? b.typeId.replace("minecraft:", "").replace("cbc:", "") : "?"}`;
    });
    const f = block.permutation.getState(FACING_STATE);
    return __t(184, block.typeId, block.x, block.y, block.z, String(f), parts.join(", "));
}
function dbg(text) {
    if (DEBUG)
        __R.log("warn", `[CBC dbg] ${text}`);
}
// Хранение состояния заряжания: dynamic properties мира, ключ по измерению и координатам казённика.
// TODO-VERIFY (в игре не запускалось): world.getDynamicProperty / world.setDynamicProperty(id, string).
// TODO: чистить запись, когда казённик ломают; сейчас остаётся «мусор» в мире.
function loadKey(dimId, p) { return `cbc:load:${dimId}:${p.x},${p.y},${p.z}`; }
function getLoad(dimId, breech) {
    const raw = world.getDynamicProperty(loadKey(dimId, breech));
    if (typeof raw !== "string")
        return emptyLoad();
    try {
        const o = JSON.parse(raw);
        return { projectileId: typeof o.projectileId === "string" ? o.projectileId : undefined, charges: Number(o.charges) || 0, fuze: Number(o.fuze) || 0 };
    }
    catch {
        return emptyLoad();
    }
}
function setLoad(dimId, breech, load) {
    const key = loadKey(dimId, breech);
    world.setDynamicProperty(key, JSON.stringify(load));
    syncArmed(key, load);
}
// ---- Вертикальная наводка (горизонтальные пушки): сталь -10..50°, чугун 0..10° (только поднимать), диапазон в CANNON_RULES ----
const ELEV_STEP = 5;
const HORIZ = new Set(["north", "south", "east", "west"]);
/** Допустимый диапазон угла для пушки (градусы). Вертикальные пушки и материалы без elevMax: 0..0 (наводки нет). */
function elevRange(scan) {
    if (!HORIZ.has(scan.direction))
        return { min: 0, max: 0 };
    const r = rulesOf(scan);
    return { min: r.elevMin ?? 0, max: r.elevMax ?? 0 };
}
/** Есть ли у пушки вертикальная наводка (угол влияет на выстрел). Визуальный наклон частей есть только у стали (canElevate). */
function canAim(scan) { const r = elevRange(scan); return r.max > r.min; }
function elevKey(dimId, p) { return `cbc:elev:${dimId}:${p.x},${p.y},${p.z}`; }
function getElev(dimId, breech, scan) {
    const v = world.getDynamicProperty(elevKey(dimId, breech));
    const { min, max } = elevRange(scan);
    return typeof v === "number" ? Math.max(min, Math.min(max, v)) : 0; // сохранённое значение всегда срезается до диапазона материала
}
function setElev(dimId, breech, deg) {
    world.setDynamicProperty(elevKey(dimId, breech), deg === 0 ? undefined : deg);
}
/** Угол, который реально действует для пушки (0 для вертикальных пушек). */
function effElev(scan, dimId, breech) {
    return canAim(scan) ? getElev(dimId, breech, scan) : 0;
}
function fmtDeg(d) { return `${d > 0 ? "+" : ""}${d}°`; }
/** Привести визуальный наклон в соответствие с состоянием: заряжена (снаряд и заряд) -> угол игрока, иначе 0. */
function syncRaise(block) {
    try {
        const found = findCannon({ x: block.x, y: block.y, z: block.z }, makeReader(block));
        if (!found || !found.scan.valid || !canElevate(found.scan))
            return; // визуальный наклон у стали и чугуна
        const { breech, scan } = found;
        const dimId = block.dimension.id;
        const ld = getLoad(dimId, breech);
        const armedNow = !!ld.projectileId && ld.charges > 0;
        let ang = armedNow ? getElev(dimId, breech, scan) : 0;
        if (ang) {
            const free = clampElevation(block.dimension, scan, ang, ELEV_STEP); // ствол не должен проходить сквозь блоки (проверка только при событии)
            if (free !== ang) {
                ang = free;
                setElev(dimId, breech, free);
            }
        }
        setElevation(block.dimension, scan, loadKey(dimId, breech), ang);
    }
    catch (e) {
        dbg(`syncRaise: ${String(e)}`);
    }
}
/** Изменить угол стальной пушки на delta градусов (клик палкой). Вызывать из system.run. */
function adjustElevation(block, player, delta) {
    const found = findCannon({ x: block.x, y: block.y, z: block.z }, makeReader(block));
    if (!found) {
        __R.actionBar(player, __t(185));
        return;
    }
    const { breech, scan } = found;
    if (!scan.valid) {
        __R.actionBar(player, __t(186, scan.reason ?? "?"));
        return;
    }
    if (!canAim(scan)) {
        __R.actionBar(player, __t(187));
        return;
    }
    const dimId = block.dimension.id;
    const { min, max } = elevRange(scan);
    const cur = getElev(dimId, breech, scan);
    const raw = cur + delta;
    const want = Math.max(min, Math.min(max, raw));
    const next = canElevate(scan) ? clampElevation(block.dimension, scan, want, ELEV_STEP) : want; // проверка блоков, пока ствол визуально наклоняется (сталь и чугун)
    setElev(dimId, breech, next);
    const hint = scan.materialId === "cast_iron" ? __t(188) : "";
    __R.actionBar(player, next !== want
        ? __t(189, fmtDeg(next))
        : want !== raw
            ? __t(190, fmtDeg(next), min, max, raw < min ? hint : "")
            : __t(191, fmtDeg(next), min, max));
    syncRaise(block);
}
/** Повернуть вектор v вокруг горизонтальной поперечной оси так, чтобы горизонтальное направление dir поднялось на deg градусов. */
function tiltVec(v, dir, deg) {
    if (!deg)
        return v;
    const d = dirVec(dir);
    const k = { x: -d.z, y: 0, z: d.x }; // d x up
    const c = Math.cos(deg * Math.PI / 180), sn = Math.sin(deg * Math.PI / 180);
    const kxv = { x: k.y * v.z - k.z * v.y, y: k.z * v.x - k.x * v.z, z: k.x * v.y - k.y * v.x };
    const kv = k.x * v.x + k.y * v.y + k.z * v.z;
    return { x: v.x * c + kxv.x * sn + k.x * kv * (1 - c), y: v.y * c + kxv.y * sn + k.y * kv * (1 - c), z: v.z * c + kxv.z * sn + k.z * kv * (1 - c) };
}
/** Списать один предмет из выбранного слота (кроме творческого режима). Ошибки глотаем: механика заряжания важнее. */
function consumeHeld(player, typeId) {
    try {
        if (String(player.getGameMode()).toLowerCase() === "creative")
            return true;
        const inv = player.getComponent("minecraft:inventory");
        if (!inv || !inv.container)
            return false;
        const slot = inv.container.getSlot(player.selectedSlotIndex);
        if (!slot.hasItem() || (typeId && slot.typeId !== typeId))
            return false; // предмет уже не в руке (выбросили/сменили слот): заряжать бесплатно нельзя
        if (slot.amount > 1)
            slot.amount = slot.amount - 1;
        else
            slot.setItem(undefined);
        return true;
    }
    catch (e) {
        dbg(`consume: ${String(e)}`);
        return false;
    }
}
/** Убрать запись заряжания для блока, который сломали или взорвали (ключ = координаты заднего блока пушки). */
function clearLoadAt(dimId, pos) {
    try {
        const key = loadKey(dimId, pos);
        world.setDynamicProperty(key, undefined);
        armed.delete(key);
        lastPowered.delete(key);
        partsCache.delete(key);
        lastShot.delete(key);
        world.setDynamicProperty(elevKey(dimId, pos), undefined);
    }
    catch (e) {
        dbg(`clearLoad: ${String(e)}`);
    }
}
/** Зарядить боеприпас `typeId` в пушку, к которой относится блок `block`. Вызывать из system.run (не из before-контекста). */
function loadInto(block, player, typeId, fuze = 0) {
    const read = makeReader(block);
    const found = findCannon({ x: block.x, y: block.y, z: block.z }, read);
    if (!found) {
        __R.actionBar(player, __t(185));
        try {
            dbg(around(block));
        }
        catch { /* ignore */ }
        return;
    }
    const { breech, scan } = found;
    const dimId = block.dimension.id;
    const res = applyLoad(scan, getLoad(dimId, breech), typeId, fuze);
    let okLoad = res.ok;
    if (res.ok) {
        if (consumeHeld(player, typeId)) {
            setLoad(dimId, breech, res.load);
            syncRaise(block);
        }
        else
            okLoad = false;
    }
    const text = okLoad ? `§a[CBC] ${res.message}` : `§c[CBC] ${res.ok ? __t(192) : res.message}`;
    __R.actionBar(player, text);
    dbg(`load ${typeId} -> ${res.message}`);
}
/** Выровнять facing всех блоков собранной пушки по казённику (визуально: отверстия вдоль оси). Не критично, ошибки глотаем. */
function alignParts(origin, scan) {
    try {
        const v = dirVec(scan.direction);
        const total = scan.chambers + scan.barrels + 1; // + возможный end
        for (let i = 0; i <= total; i++) {
            const b = origin.dimension.getBlock({ x: scan.breechPos.x + v.x * i, y: scan.breechPos.y + v.y * i, z: scan.breechPos.z + v.z * i });
            if (!b || !parsePart(b.typeId) || b.typeId.endsWith("_hidden"))
                continue;
            if (b.permutation.getState(FACING_STATE) !== scan.direction)
                b.setPermutation(b.permutation.withState(FACING_STATE, scan.direction));
        }
    }
    catch (e) {
        dbg(`align: ${String(e)}`);
    }
}
/** Показать результат скана для блока `block` (общая логика для before/after обработчиков). */
function report(block, player) {
    const read = makeReader(block);
    const found = findCannon({ x: block.x, y: block.y, z: block.z }, read);
    if (!found) {
        __R.actionBar(player, __t(185));
        try {
            dbg(around(block));
        }
        catch { /* ignore */ }
        return;
    }
    const { breech, scan: r } = found;
    if (r.valid) {
        try {
            healHidden(block.dimension, r, loadKey(block.dimension.id, breech)); // застрявшие невидимые блоки -> обычные
        }
        catch (e) {
            dbg(`heal: ${String(e)}`);
        }
        alignParts(block, r);
        syncRaise(block);
    }
    const dimId = block.dimension.id;
    const text = r.valid
        ? __t(196, r.chambers, r.barrels, r.materialId, r.muzzlePos.x, r.muzzlePos.y, r.muzzlePos.z, r.direction, describeLoad(getLoad(dimId, breech)), chargeCapacity(r), estimateRange(r, getLoad(dimId, breech).charges), estimateRange(r, 1), estimateRange(r, chargeCapacity(r)), barrelFactor(r.barrels, rulesFor(r.materialId).maxBarrels).toFixed(2), canAim(r) ? __t(193, fmtDeg(getElev(dimId, breech, r)), elevRange(r).min, elevRange(r).max) : "", r.barrels < SHORT_BARREL.minBarrels ? __t(194) : "", (r.mortars ?? 0) > 0 ? __t(195, r.mortars, MORTAR.radius[r.mortars] * 2) : "")
        : __t(197, r.reason ?? "?", r.breechPos.x, r.breechPos.y, r.breechPos.z, r.direction);
    __R.actionBar(player, text);
    dbg(`report: ${text}`);
}
const lastShot = new Map();
/**
 * Выстрел из пушки, к которой относится блок `block`. `player` нужен только для сообщений (при сигнале redstone его нет).
 * Вызывать из system.run. Состояние после выстрела: снаряд и заряды сбрасываются.
 */
const delayedFire = new Set(); // ключи пушек, у которых выстрел уже отложен до конца подъёма ствола
const RAISE_SETTLE_TICKS = 6; // запас после конца подъёма, чтобы ствол визуально «встал» на угол
export function fireCannon(block, player) {
    const say = (t) => { try {
        __R.actionBar(player, t);
    }
    catch { /* игрок вышел */ } dbg(`fire: ${t}`); };
    if (S.frozen) {
        say(__t(142));
        return;
    }
    const read = makeReader(block);
    const found = findCannon({ x: block.x, y: block.y, z: block.z }, read);
    if (!found) {
        say(__t(185));
        return;
    }
    const { breech, scan } = found;
    const dim = block.dimension;
    const key = loadKey(dim.id, breech);
    const now = system.currentTick;
    if (now - (lastShot.get(key) ?? -1e9) < LIMITS.fireCooldownTicks) {
        say(__t(198));
        return;
    }
    // Сборка 41: пушка заряжена под углом и ствол ещё поднимается -> выстрел откладывается до конца подъёма (визуально ствол не успевал подняться).
    const wait = raiseRemaining(loadKey(dim.id, breech));
    if (wait > 0) {
        if (!delayedFire.has(key)) {
            delayedFire.add(key);
            say(__t(199, ((wait + RAISE_SETTLE_TICKS) / 20).toFixed(1)));
            system.runTimeout(() => {
                delayedFire.delete(key);
                try {
                    fireCannon(block, player);
                }
                catch (e) {
                    dbg(__t(200, String(e)));
                }
            }, wait + RAISE_SETTLE_TICKS);
        }
        return;
    }
    const load = getLoad(dim.id, breech);
    const plan = planShot(scan, load);
    if (plan.overloaded) {
        // Разрыв: небольшой взрыв у казённика (радиус 2, с разрушением), заряжание сбрасывается.
        setLoad(dim.id, breech, emptyLoad());
        lastShot.set(key, now);
        dim.createExplosion({ x: breech.x + 0.5, y: breech.y + 0.5, z: breech.z + 0.5 }, 2, { breaksBlocks: true });
        say(__t(201, plan.reason));
        return;
    }
    if (!plan.ok) {
        say(`§c[CBC] ${plan.reason ?? __t(160)}`);
        return;
    }
    if (liveCount() >= LIMITS.maxProjectilesAlive) {
        say(__t(159));
        return;
    }
    const d = dirVec(scan.direction);
    const th = effElev(scan, dim.id, breech);
    const p0 = { x: scan.breechPos.x + 0.5, y: scan.breechPos.y + 0.5, z: scan.breechPos.z + 0.5 };
    const n = Math.abs(scan.muzzlePos.x - scan.breechPos.x) + Math.abs(scan.muzzlePos.y - scan.breechPos.y) + Math.abs(scan.muzzlePos.z - scan.breechPos.z);
    const cs = Math.cos(th * Math.PI / 180), sn = Math.sin(th * Math.PI / 180);
    const dt = { x: d.x * cs, y: d.y * cs + sn, z: d.z * cs }; // направление ствола с учётом наклона
    const at = (dist) => ({ x: p0.x + dt.x * dist, y: p0.y + dt.y * dist, z: p0.z + dt.z * dist });
    const origin = at(n + 1.2);
    try {
        let vel = tiltVec(plan.velocity, scan.direction, th);
        if ((scan.mortars ?? 0) > 0)
            vel = mortarScatter(vel, scan.mortars, th, flightParams(plan.munitionId), scan.direction === "up" || scan.direction === "down");
        spawnProjectile(block.dimension, origin, vel, plan.munitionId, load.fuze ?? 0);
    }
    catch (err) {
        // Сборка 40: раньше исключение здесь терялось без следа (выстрела нет, сообщения нет). Теперь: заряд и снаряд остаются в пушке, игрок видит причину.
        const msg = __t(161, String(err));
        if (player)
            say(msg);
        else
            __R.log("warn", msg);
        return;
    }
    lastShot.set(key, now);
    setLoad(dim.id, breech, emptyLoad());
    try {
        dim.playSound("cbc.fire_big_cannon", origin, { volume: 4 });
    }
    catch { /* звук не критичен */ }
    muzzleBlast(dim, at(n + 0.6), dt, load.charges);
    shake(dim, at(n), load.charges);
    try {
        fireRecoil(block.dimension, scan, key, th, () => { const rb = dim.getBlock(breech); if (rb)
            syncRaise(rb); });
    }
    catch (err) {
        dbg(`recoil: ${String(err)}`);
    }
}
/**
 * Сигнал redstone на казённик (рычаг, красная пыль). Компонент "cbc:breech" подключён в JSON казёнников
 * (minecraft:redstone_consumer, format_version 1.26.0). Стреляем по фронту 0 -> >0.
 * Регистрировать в system.beforeEvents.startup (см. main.ts). TODO-VERIFY: в игре не запускалось.
 */
export function registerBreechComponent(registry) {
    registry.registerCustomComponent("cbc:breech", {
        onRedstoneUpdate: (e) => {
            if (REDSTONE_TEST)
                __R.log("warn", `[CBC test] redstone: ${e.block.typeId.replace("cbc:", "")} ${e.block.x},${e.block.y},${e.block.z} сигнал ${e.previousPowerLevel} -> ${e.powerLevel}`);
            else
                dbg(`redstone: ${e.block.typeId} ${e.block.x},${e.block.y},${e.block.z} power ${e.previousPowerLevel} -> ${e.powerLevel}`);
            if (!(e.powerLevel > 0 && e.previousPowerLevel === 0))
                return;
            const block = e.block;
            system.run(() => {
                try {
                    fireCannon(block);
                }
                catch (err) {
                    __R.log("warn", `[CBC] ошибка выстрела по сигналу: ${String(err)}`);
                }
            });
        },
    });
}
/**
 * Клик по блоку пушки. Два обработчика:
 *  - afterEvents: срабатывает, когда взаимодействие состоялось (подтверждено в игре для собранной пушки);
 *  - beforeEvents: перехват клика боеприпасом (заряжание), см. ниже.
 * При DEBUG=true оба пишут отладочные строки в чат.
 */
/**
 * Сигнал красной пыли без redstone_consumer: раз в 2 тика смотрим заряженные пушки и ищем рядом с их блоками
 * включённую пыль (minecraft:redstone_wire, состояние redstone_signal > 0), блок красного камня или ненулевой
 * Block.getRedstonePower() у самого блока (если метод есть). Выстрел по фронту «нет сигнала -> есть сигнал».
 * Первое наблюдение пушки выстрела не вызывает (чтобы уже включённая линия не стреляла сразу после заряжания).
 */
const LOAD_KEY_RE = /^cbc:load:(.+):(-?\d+),(-?\d+),(-?\d+)$/;
const NEIGH = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const lastPowered = new Map();
function blockPowered(dim, pos) {
    const b = dim.getBlock(pos);
    if (!b)
        return false;
    try {
        if (typeof b.getRedstonePower === "function" && (b.getRedstonePower() ?? 0) > 0)
            return true;
    }
    catch { /* метод может отсутствовать или не поддерживаться для кастомного блока */ }
    for (const [ox, oy, oz] of NEIGH) {
        const n = dim.getBlock({ x: pos.x + ox, y: pos.y + oy, z: pos.z + oz });
        if (!n)
            continue;
        if (n.typeId === "minecraft:redstone_wire") {
            const sig = n.permutation.getState("redstone_signal");
            if (typeof sig === "number" && sig > 0)
                return true;
        }
        else if (n.typeId === "minecraft:redstone_block") {
            return true;
        }
    }
    return false;
}
// Опрос работает ТОЛЬКО пока есть заряженные пушки (armed): иначе таймера нет вообще.
const armed = new Set();
const partsCache = new Map();
let pollHandle;
const POLL_TICKS = 10; // сборка 87: 0.5 с (было 4 тика). Импульс красной пыли короче 10 тиков может не поймать (рычаг, кнопка, плита держат дольше)
const POLL_RADIUS = 64; // сборка 87: пушку опрашиваем, только если рядом (в этом радиусе, то же измерение) есть игрок
const RESCAN_TICKS = 20; // геометрию пушки пересматриваем раз в секунду, а не при каждом опросе
// ТЕСТ сборки 17: true = опрос пыли выключен, стрельба от пыли только через redstone_consumer (событие onRedstoneUpdate).
const REDSTONE_TEST = false;
function syncArmed(key, load) {
    if (REDSTONE_TEST)
        return;
    if (load.projectileId && load.charges > 0) {
        armed.add(key);
        ensurePoll();
    }
    else {
        armed.delete(key);
        lastPowered.delete(key);
        partsCache.delete(key);
    }
}
function ensurePoll() {
    if (pollHandle !== undefined || S.frozen)
        return;
    pollHandle = system.runInterval(() => {
        sampleTps();
        try {
            pollRedstone();
        }
        catch (e) {
            dbg(`pollRedstone: ${String(e)}`);
        }
        if (armed.size === 0 && pollHandle !== undefined) {
            system.clearRun(pollHandle);
            pollHandle = undefined;
        }
    }, POLL_TICKS);
}
/** При загрузке мира: найти пушки, заряженные до перезапуска, и взять их под наблюдение. */
function armFromWorld() {
    try {
        for (const id of world.getDynamicPropertyIds()) {
            const m = LOAD_KEY_RE.exec(id);
            if (!m)
                continue;
            const load = getLoad(m[1], { x: Number(m[2]), y: Number(m[3]), z: Number(m[4]) });
            syncArmed(id, load);
        }
    }
    catch (e) {
        dbg(`armFromWorld: ${String(e)}`);
    }
}
function pollRedstone() {
    const now = system.currentTick;
    const pls = [];
    for (const pl of world.getAllPlayers()) {
        try {
            const l = pl.location;
            pls.push({ d: pl.dimension.id, x: l.x, y: l.y, z: l.z });
        }
        catch { /* игрок вышел */ }
    }
    const R2 = POLL_RADIUS * POLL_RADIUS;
    for (const id of [...armed]) {
        const m = LOAD_KEY_RE.exec(id);
        if (!m) {
            armed.delete(id);
            continue;
        }
        const px = Number(m[2]), py = Number(m[3]), pz = Number(m[4]);
        if (!pls.some((q) => q.d === m[1] && (q.x - px) ** 2 + (q.y - py) ** 2 + (q.z - pz) ** 2 <= R2)) { // игроков рядом нет: не опрашиваем; сигнал, пришедший за это время, выстрела не даст
            lastPowered.delete(id);
            continue;
        }
        try {
            const dim = world.getDimension(m[1]);
            const rear = { x: Number(m[2]), y: Number(m[3]), z: Number(m[4]) };
            const startBlock = dim.getBlock(rear);
            if (!startBlock)
                continue; // чанк не загружен: пропускаем, запись остаётся
            if (!parsePart(startBlock.typeId)) { // казённик разрушен без события (взрыв снаряда, команда): запись и опрос больше не нужны
                clearLoadAt(m[1], rear);
                continue;
            }
            let c = partsCache.get(id);
            if (!c || now - c.t >= RESCAN_TICKS) {
                const parts = [];
                const found = findCannon(rear, makeReader(startBlock));
                if (found && found.scan.valid) {
                    const v = dirVec(found.scan.direction);
                    const total = found.scan.chambers + found.scan.barrels + 1;
                    for (let i = 0; i <= total; i++) {
                        const pos = { x: found.scan.breechPos.x + v.x * i, y: found.scan.breechPos.y + v.y * i, z: found.scan.breechPos.z + v.z * i };
                        const b = dim.getBlock(pos);
                        if (b && parsePart(b.typeId))
                            parts.push(pos);
                    }
                }
                c = { t: now, parts };
                partsCache.set(id, c);
            }
            let powered = false;
            for (const pos of c.parts) {
                if (blockPowered(dim, pos)) {
                    powered = true;
                    break;
                }
            }
            const prev = lastPowered.get(id);
            lastPowered.set(id, powered);
            if (prev === false && powered) {
                dbg(__t(202, id));
                fireCannon(startBlock, undefined);
            }
        }
        catch (e) {
            dbg(`poll: ${String(e)}`);
        }
    }
}
/** Меню администратора: пушки отключены = нет опроса красной пыли (таймер остановлен) и нет выстрелов. Заряд сохраняется. */
export function setCannonsFrozen(on) {
    S.frozen = on;
    saveSettings();
    if (on) {
        if (pollHandle !== undefined) {
            system.clearRun(pollHandle);
            pollHandle = undefined;
        }
    }
    else {
        lastPowered.clear(); // уже включённая линия пыли не должна выстрелить сразу после включения
        if (armed.size > 0)
            ensurePoll();
    }
}
export function armedCount() { return armed.size; }
/** Меню администратора: убрать заряд и снаряд у всех пушек мира. Возвращает число записей. */
export function dischargeAll() {
    let n = 0;
    try {
        for (const id of world.getDynamicPropertyIds()) {
            if (LOAD_KEY_RE.test(id)) {
                world.setDynamicProperty(id, undefined);
                n++;
            }
        }
    }
    catch (e) {
        dbg(`dischargeAll: ${String(e)}`);
    }
    armed.clear();
    lastPowered.clear();
    partsCache.clear();
    if (pollHandle !== undefined) {
        system.clearRun(pollHandle);
        pollHandle = undefined;
    }
    return n;
}
/** Куда выбрасывать предмет: рядом с гранью блока, по которой кликнули. */
const FACE_OFF = { up: [0, 1, 0], down: [0, -1, 0], north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0] };
function dropSpot(block, face) {
    const o = FACE_OFF[String(face ?? "up").toLowerCase()] ?? FACE_OFF.up;
    return { x: block.x + 0.5 + o[0] * 0.8, y: block.y + 0.5 + o[1] * 0.8, z: block.z + 0.5 + o[2] * 0.8 };
}
/** Есть ли что вынуть из заряженной пушки для этого предмета в руке (чтение без изменений, можно из before-события). */
function canUnload(block, typeId) {
    const found = findCannon({ x: block.x, y: block.y, z: block.z }, makeReader(block));
    if (!found || !found.scan.valid)
        return false;
    return unloadFor(getLoad(block.dimension.id, found.breech), typeId).ok;
}
/** Shift + клик боеприпасом по заряженной пушке: заряд или снаряд выпадает предметом. Вызывать из system.run. */
function unloadFrom(block, player, typeId, face) {
    const found = findCannon({ x: block.x, y: block.y, z: block.z }, makeReader(block));
    if (!found || !found.scan.valid)
        return;
    const { breech, scan } = found;
    const dimId = block.dimension.id;
    const res = unloadFor(getLoad(dimId, breech), typeId);
    if (!res.ok || !res.itemId)
        return;
    const item = new ItemStack(res.itemId, 1);
    const lore = res.fuze ? fuzeLore(res.fuze) : [];
    if (lore.length)
        __R.setLore(item, lore);
    setLoad(dimId, breech, res.load);
    block.dimension.spawnItem(item, dropSpot(block, face));
    syncRaise(block);
    const cap = chargeCapacity(scan);
    __R.actionBar(player, __t(203, res.message, res.load.charges, cap, ammoName(res.load.projectileId)));
}
export function registerInteraction() {
    armFromWorld();
    // Чистка заряжания при поломке/взрыве блока пушки (запись привязана к заднему блоку; для остальных блоков ключа нет, это безвредно).
    world.afterEvents.playerBreakBlock.subscribe((ev) => {
        try {
            if (parsePart(ev.brokenBlockPermutation.type.id)) {
                const bp = { x: ev.block.x, y: ev.block.y, z: ev.block.z };
                releaseByPos(ev.dimension.id, bp);
                clearLoadAt(ev.dimension.id, bp);
            }
        }
        catch (e) {
            dbg(`break: ${String(e)}`);
        }
    });
    try {
        world.afterEvents.blockExplode.subscribe((ev) => {
            try {
                if (parsePart(ev.explodedBlockPermutation.type.id)) {
                    const bp = { x: ev.block.x, y: ev.block.y, z: ev.block.z };
                    releaseByPos(ev.dimension.id, bp);
                    clearLoadAt(ev.dimension.id, bp);
                }
            }
            catch (e) {
                dbg(`explode: ${String(e)}`);
            }
        });
    }
    catch (e) {
        dbg(__t(204, String(e)));
    }
    // Рычаг рядом с блоком пушки (в т.ч. прямо на ней): включение = выстрел. Не зависит от redstone_consumer.
    world.afterEvents.leverAction.subscribe((ev) => {
        try {
            dbg(`lever: ${ev.block.x},${ev.block.y},${ev.block.z} powered=${ev.isPowered}`);
            if (!ev.isPowered)
                return;
            const offs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
            for (const [ox, oy, oz] of offs) {
                const n = ev.block.dimension.getBlock({ x: ev.block.x + ox, y: ev.block.y + oy, z: ev.block.z + oz });
                if (n && parsePart(n.typeId)) {
                    const target = n;
                    system.run(() => { try {
                        fireCannon(target, ev.player);
                    }
                    catch (e) {
                        __R.log("warn", `[CBC] ошибка выстрела от рычага: ${String(e)}`);
                    } });
                    return;
                }
            }
            dbg(__t(205));
        }
        catch (e) {
            __R.log("warn", `[CBC] ошибка lever: ${String(e)}`);
        }
    });
    world.afterEvents.playerInteractWithBlock.subscribe((ev) => {
        try {
            dbg(`after: ${ev.block.typeId} first=${ev.isFirstEvent} item=${ev.itemStack?.typeId ?? __t(206)}`);
            if (!ev.isFirstEvent || !parsePart(ev.block.typeId))
                return;
            report(ev.block, ev.player);
        }
        catch (e) {
            __R.log("warn", `[CBC] ошибка after-обработчика: ${String(e)}`);
        }
    });
    // before: клик боеприпасом по блоку собранной пушки заряжает её (установка отменяется); клик огнивом стреляет.
    // Shift + клик: если пушка заряжена, предмет выпадает (заряд/снаряд); иначе не перехватывается и снаряд ставится как декор. Свойства cancel/itemStack/block/player/isFirstEvent
    // подтверждены справочником (PlayerInteractWithBlockBeforeEvent). Мир из before-контекста менять нельзя, поэтому system.run.
    world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
        try {
            const gg = gauntletInfo(ev.itemStack);
            const typeId = gg !== undefined ? gg.virtual : ev.itemStack?.typeId;
            if (!ev.isFirstEvent || !parsePart(ev.block.typeId))
                return;
            if (typeId === "minecraft:flint_and_steel") {
                // Огниво по блоку пушки = выстрел (поджог блока отменяем).
                ev.cancel = true;
                const { block, player } = ev;
                system.run(() => {
                    try {
                        fireCannon(block, player);
                    }
                    catch (e) {
                        __R.log("warn", `[CBC] ошибка выстрела: ${String(e)}`);
                    }
                });
                return;
            }
            if (gg !== undefined && (gg.mode === "aim" || gg.mode === "aimdn")) { // только гравипушка в режиме «наводка» (обычная палка и отдельные палочки больше не работают)
                // Наводка по блоку пушки: режим aim = +5°, режим aimdn = -5° (присед не нужен). Горизонтальные пушки: сталь -10..50°, чугун 0..10°.
                ev.cancel = true;
                const { block, player } = ev;
                const delta = gg.mode === "aimdn" ? -ELEV_STEP : ELEV_STEP;
                system.run(() => {
                    try {
                        adjustElevation(block, player, delta);
                    }
                    catch (e) {
                        __R.log("warn", `[CBC] ошибка наводки: ${String(e)}`);
                    }
                });
                return;
            }
            if (!ammoKind(typeId))
                return;
            if (ev.player.isSneaking) {
                // Shift + клик по заряженной пушке: заряд/снаряд выпадает. Если вынимать нечего, предмет ставится как декор (как раньше).
                if (!canUnload(ev.block, typeId))
                    return;
                ev.cancel = true;
                const { block, player } = ev;
                const face = ev.blockFace;
                system.run(() => {
                    try {
                        unloadFrom(block, player, typeId, face);
                    }
                    catch (e) {
                        __R.log("warn", `[CBC] ошибка извлечения: ${String(e)}`);
                    }
                });
                return;
            }
            ev.cancel = true;
            const { block, player } = ev;
            const fz = fuzeFromItem(ev.itemStack); // сборка 42: задержка взрывателя из описания предмета (до списания предмета из руки)
            system.run(() => {
                try {
                    loadInto(block, player, typeId, fz);
                }
                catch (e) {
                    __R.log("warn", `[CBC] ошибка заряжания: ${String(e)}`);
                }
            });
        }
        catch (e) {
            __R.log("warn", `[CBC] ошибка before (синхронно): ${String(e)}`);
        }
    });
}

// ---- v1.9.5+: доступ к состоянию заряжания по координатам казённика (пушка на физической конструкции переносит заряд при сборке/разборке) ----
export function getLoadAt(dimId, pos) { return getLoad(dimId, pos); }
export function setLoadAt(dimId, pos, load) { setLoad(dimId, pos, load); }
export function getElevAt(dimId, pos) { const v = world.getDynamicProperty(elevKey(dimId, pos)); return typeof v === "number" ? v : 0; }
export function setElevAt(dimId, pos, deg) { setElev(dimId, pos, deg); }
export { clearLoadAt };
