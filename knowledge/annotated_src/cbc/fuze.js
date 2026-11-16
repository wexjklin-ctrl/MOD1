/* CLAUDE-MAP-BEGIN
 FILE: cbc/fuze.js  (16 KB, 388 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: Fuzes/explosions.
 IMPORTS: @minecraft/server, cbc/config/overrides.js, cbc/effects.js, cbc/impact.js, i18n/i18n.js
 IMPORTED BY: cbc/admin.js, cbc/cmMount.js, cbc/main.js, cbc/world.js, core/cbcMount.js
 EXPORTS: SHELL_ID, fuzeLore, fuzeFromItem, fuzeHint, fugasInfo, setFugasKnown, chainDetonate, registerFuze
 EVENTS: blockExplode, explosion, playerBreakBlock, playerInteractWithBlock, playerPlaceBlock
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): registerFuze@319(69L); chainDetonate@235(46L); onVanillaExplosion@282(36L); chainFromRegistry@203(31L); detonate@89(30L); replaceDrop@60(24L); regAdd@172(17L); regLoad@156(16L); scheduleDetonations@120(13L); cycle@47(12L); fuzeFromItem@20(11L); regSave@145(11L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { __t, __R } from "../i18n/i18n.js";
// Фугасный заряд (сборка 42): настройка задержки взрывателя на поставленном блоке, перенос настройки в предмет, цепная детонация.
// Параметры: FUZE и CHAIN в config/overrides.js. Состояние блока `cbc:fuze` (0..5) объявлено в BP/blocks/he_shell.json.
// API: world.beforeEvents.explosion (ExplosionBeforeEvent: dimension, source, getImpactedBlocks) сверен со справочником Microsoft Learn;
// ItemStack.getLore/setLore, Dimension.spawnItem, BlockPermutation.withState используются по стабильному API; в игре НЕ проверено.
import { ItemStack, system, world } from "@minecraft/server";
import { CHAIN, FUZE } from "./config/overrides.js";
import { impactEffects } from "./effects.js";
import { applyImpact, setChainHook } from "./impact.js";
export const SHELL_ID = "cbc:he_shell";
/** Взрывоопасные блоки: id блока -> ключ в IMPACT (сборка 78: пороховой заряд тоже детонирует). */
const EXPLOSIVES = { "cbc:he_shell": "he_shell", "cbc:powder_charge": "powder_charge" };
const STATE = "cbc:fuze";
const LORE_RE = /(?:Взрыватель|Fuze|Espoleta):\s*(\d+)/;
const clampFuze = (n) => Math.max(0, Math.min(FUZE.max, Math.round(Number(n) || 0)));
// ---------- Настройка взрывателя ----------
/** Строка описания предмета с настройкой (0 = обычный предмет без описания, он складывается в стопку с остальными). */
export function fuzeLore(sec) { return sec > 0 ? [__t(71, sec)] : []; }
/** Настройка взрывателя из описания предмета (0, если не задана). */
export function fuzeFromItem(item) {
    try {
        for (const l of item?.getLore?.() ?? []) {
            const m = LORE_RE.exec(String(l));
            if (m)
                return clampFuze(m[1]);
        }
    }
    catch { /* нет описания */ }
    return 0;
}
/** Короткое пояснение к значению (для actionbar). */
export function fuzeHint(sec) {
    if (sec <= 0)
        return __t(72);
    const depth = FUZE.depthBudget;
    return sec <= depth ? __t(73, sec) : __t(74, depth, sec - depth);
}
function blockFuze(block) {
    try {
        return clampFuze(block.permutation.getState(STATE));
    }
    catch {
        return 0;
    }
}
/** Правый клик по поставленному фугасу: следующее значение задержки по кругу 0..max. */
function cycle(block, player) {
    const cur = blockFuze(block), next = (cur + 1) % (FUZE.max + 1);
    block.setPermutation(block.permutation.withState(STATE, next));
    try {
        __R.actionBar(player, __t(75, next, fuzeHint(next)));
    }
    catch { /* игрок вышел */ }
    try {
        block.dimension.playSound("random.click", { x: block.x + 0.5, y: block.y + 0.5, z: block.z + 0.5 }, { volume: 0.7, pitch: 0.8 + next * 0.1 });
    }
    catch { /* звук не критичен */ }
}
/** Блок сломан: выпавший предмет заменяем таким же, но с настройкой в описании (блочные состояния в предмет сами не переходят). */
function replaceDrop(dim, pos, sec) {
    const c = { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 };
    let items = [];
    try {
        items = dim.getEntities({ type: "minecraft:item", location: c, maxDistance: 2.5 });
    }
    catch {
        return;
    }
    for (const e of items) {
        try {
            const st = e.getComponent("minecraft:item")?.itemStack;
            if (!st || st.typeId !== SHELL_ID || st.getLore().length > 0)
                continue;
            const at = e.location, n = st.amount;
            const ns = new ItemStack(SHELL_ID, n);
            __R.setLore(ns, fuzeLore(sec));
            e.remove();
            dim.spawnItem(ns, at);
            return; // подменяем один свежий дроп
        }
        catch { /* сущность недоступна */ }
    }
}
// ---------- Цепная детонация ----------
const pending = new Set(); // фугасы, у которых детонация уже запланирована
let scans = 0;
const pkey = (dim, p) => `${dim.id}|${p.x},${p.y},${p.z}`;
/** Взорвать поставленный фугас: тот же взрыв, что и при попадании (взрыватель не учитывается). Блок убирается ДО взрыва: повторно он не сработает. */
function detonate(dim, p) {
    pending.delete(pkey(dim, p));
    regDel(dim, p);
    let b;
    try {
        b = dim.getBlock(p);
    }
    catch {
        return;
    }
    const mun = b ? EXPLOSIVES[b.typeId] : undefined;
    if (!b || !mun)
        return;
    try {
        b.setType("minecraft:air");
    }
    catch {
        return;
    }
    const at = { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 };
    try {
        applyImpact(dim, mun, at, undefined, undefined); // внутри снова запускает цепную детонацию вокруг этого взрыва
    }
    catch { /* удар не обработан */ }
    try {
        dim.playSound("cbc.shell_explosion", at, { volume: 4 });
    }
    catch { /* звук не критичен */ }
    impactEffects(dim, at, mun);
}
/** Запланировать детонацию найденных фугасов (задержка растёт с расстоянием). */
function scheduleDetonations(dim, found) {
    for (const f of found) {
        const k = pkey(dim, f.p);
        if (pending.has(k))
            continue;
        pending.add(k);
        const delay = CHAIN.baseDelayTicks + Math.round(f.d * CHAIN.delayPerBlock) + Math.floor(Math.random() * (CHAIN.jitterTicks + 1));
        system.runTimeout(() => { try {
            detonate(dim, f.p);
        }
        catch { /* ignore */ } }, delay);
    }
}
// ---------- Учёт поставленных фугасов (сборка 87) ----------
// Скан куба вокруг каждого взрыва (до 25^3 блоков) нужен только если в мире есть поставленные фугасы. Игроки ставят их через playerPlaceBlock, убирают через
// playerBreakBlock / blockExplode / детонацию; позиции хранятся в реестре (и в динамическом свойстве, раз в 5 с после изменения, без постоянного таймера).
// Реестру доверяем только в режиме «экономия» (включает администратор в /cbc:admin): в старом мире уже стоящие фугасы в реестре не числятся.
// Не учитываются: блоки, поставленные командами (/setblock, /fill), структурами, переставленные поршнями. В режиме «экономия» они цепью не детонируют.
const REG_KEY = "cbc:fugas";
const REG_MAX = 1500; // больше: реестр переполнен, возвращаемся к полному скану (свойство мира ограничено ~32 КБ)
const DIM_CODE = { "minecraft:overworld": "o", "minecraft:nether": "n", "minecraft:the_end": "e" };
const reg = new Map(); // "o:x,y,z" -> { c, x, y, z }
let regKnown = false, regOverflow = false, regSaveTimer;
const regTrusted = () => regKnown && !regOverflow;
const regId = (dim, p) => { const c = DIM_CODE[dim.id]; return c ? `${c}:${p.x},${p.y},${p.z}` : undefined; };
function regSave() {
    if (regSaveTimer !== undefined)
        return;
    regSaveTimer = system.runTimeout(() => {
        regSaveTimer = undefined;
        try {
            world.setDynamicProperty(REG_KEY, JSON.stringify({ k: regKnown ? 1 : 0, o: regOverflow ? 1 : 0, p: [...reg.keys()] }));
        }
        catch { /* не критично */ }
    }, 100);
}
function regLoad() {
    try {
        const raw = world.getDynamicProperty(REG_KEY);
        if (typeof raw !== "string")
            return;
        const o = JSON.parse(raw);
        regKnown = !!o.k;
        regOverflow = !!o.o;
        for (const id of o.p ?? []) {
            const m = /^(\w):(-?\d+),(-?\d+),(-?\d+)$/.exec(String(id));
            if (m)
                reg.set(id, { c: m[1], x: Number(m[2]), y: Number(m[3]), z: Number(m[4]) });
        }
    }
    catch { /* битая запись: начинаем с пустого реестра, режим «экономия» выключен */ regKnown = false; reg.clear(); }
}
function regAdd(dim, p) {
    const id = regId(dim, p);
    if (!id) { // своё измерение (не оверворлд/незер/энд): не учитываем, значит реестру верить нельзя
        regOverflow = true;
        regSave();
        return;
    }
    if (reg.has(id))
        return;
    if (reg.size >= REG_MAX) {
        regOverflow = true;
        regSave();
        return;
    }
    reg.set(id, { c: id[0], x: p.x, y: p.y, z: p.z });
    regSave();
}
function regDel(dim, p) {
    const id = regId(dim, p);
    if (id && reg.delete(id))
        regSave();
}
/** Для меню администратора. */
export function fugasInfo() { return { known: regKnown, overflow: regOverflow, count: reg.size }; }
export function setFugasKnown(on) {
    regKnown = !!on;
    if (on)
        regOverflow = false;
    regSave();
}
/** Режим «экономия»: взрыв ищет фугасы только среди учтённых (без скана куба). */
function chainFromRegistry(dim, c, R) {
    if (reg.size === 0)
        return;
    const code = DIM_CODE[dim.id], found = [];
    let stale = false;
    for (const [id, e] of [...reg]) {
        if (e.c !== code)
            continue;
        const d = Math.hypot(e.x + 0.5 - c.x, e.y + 0.5 - c.y, e.z + 0.5 - c.z);
        if (d > R)
            continue;
        let b;
        try {
            b = dim.getBlock({ x: e.x, y: e.y, z: e.z });
        }
        catch {
            continue;
        }
        if (!b)
            continue; // чанк не загружен: запись остаётся
        if (!EXPLOSIVES[b.typeId]) { // блок убран воронкой, командой и т.п.: запись устарела
            reg.delete(id);
            stale = true;
            continue;
        }
        found.push({ p: { x: e.x, y: e.y, z: e.z }, d });
    }
    if (stale)
        regSave();
    scheduleDetonations(dim, found);
}
/** Найти поставленные фугасы в радиусе `radius` от точки c и запланировать их детонацию (поиск порциями через runJob). */
export function chainDetonate(dim, c, radius) {
    if (!(radius > 0))
        return;
    if (regTrusted() && DIM_CODE[dim.id]) { // сборка 87: пустой реестр = ни скана, ни нагрузки
        chainFromRegistry(dim, c, Math.min(radius, CHAIN.vanillaMax));
        return;
    }
    if (scans >= CHAIN.maxActiveScans)
        return;
    const R = Math.min(radius, CHAIN.vanillaMax);
    scans++;
    function* job() {
        try {
            const found = [];
            let n = 0;
            for (let x = Math.floor(c.x - R); x <= Math.floor(c.x + R); x++)
                for (let y = Math.floor(c.y - R); y <= Math.floor(c.y + R); y++)
                    for (let z = Math.floor(c.z - R); z <= Math.floor(c.z + R); z++) {
                        if ((++n % 200) === 0)
                            yield;
                        const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y, z + 0.5 - c.z);
                        if (d > R)
                            continue;
                        let b;
                        try {
                            b = dim.getBlock({ x, y, z });
                        }
                        catch {
                            continue;
                        }
                        if (b && EXPLOSIVES[b.typeId])
                            found.push({ p: { x, y, z }, d });
                    }
            scheduleDetonations(dim, found);
        }
        finally {
            scans--;
        }
    }
    try {
        system.runJob(job());
    }
    catch {
        scans--;
    }
}
/** Ванильные взрывы (TNT, крипер, кровать, разрыв казённика): центр = источник или середина разрушенных блоков, радиус = самый дальний разрушенный блок. */
function onVanillaExplosion(ev) {
    if (regTrusted() && reg.size === 0)
        return; // сборка 87: поставленных фугасов нет, взрыв ничего не детонирует
    let blocks = [];
    try {
        blocks = ev.getImpactedBlocks();
    }
    catch { /* список недоступен */ }
    let c;
    try {
        const l = ev.source?.location;
        if (l)
            c = { x: l.x, y: l.y, z: l.z };
    }
    catch { /* источник недействителен */ }
    if (!c) {
        if (!blocks.length)
            return;
        let sx = 0, sy = 0, sz = 0;
        for (const b of blocks) {
            sx += b.x + 0.5;
            sy += b.y + 0.5;
            sz += b.z + 0.5;
        }
        c = { x: sx / blocks.length, y: sy / blocks.length, z: sz / blocks.length };
    }
    let r = CHAIN.vanillaMin;
    for (const b of blocks)
        r = Math.max(r, Math.hypot(b.x + 0.5 - c.x, b.y + 0.5 - c.y, b.z + 0.5 - c.z) + 0.5);
    r = Math.min(CHAIN.vanillaMax, r);
    const dim = ev.dimension, cc = c;
    system.run(() => { try {
        chainDetonate(dim, cc, r);
    }
    catch { /* ignore */ } });
}
// ---------- Подписки ----------
export function registerFuze() {
    regLoad();
    setChainHook(chainDetonate);
    // Учёт фугасов: поставил игрок = в реестр; сломан игроком или взрывом = из реестра.
    try {
        world.afterEvents.playerPlaceBlock.subscribe((ev) => {
            try {
                if (EXPLOSIVES[ev.block.typeId])
                    regAdd(ev.block.dimension, { x: ev.block.x, y: ev.block.y, z: ev.block.z });
            }
            catch { /* ignore */ }
        });
    }
    catch { /* событие недоступно */ }
    try {
        world.afterEvents.blockExplode.subscribe((ev) => {
            try {
                if (EXPLOSIVES[ev.explodedBlockPermutation.type.id])
                    regDel(ev.dimension, { x: ev.block.x, y: ev.block.y, z: ev.block.z });
            }
            catch { /* ignore */ }
        });
    }
    catch { /* событие недоступно */ }
    // Правый клик по поставленному фугасу = следующая задержка. Shift + клик: поставить блок как обычно.
    world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
        try {
            if (!ev.isFirstEvent || ev.block.typeId !== SHELL_ID || ev.player.isSneaking)
                return;
            ev.cancel = true;
            const { block, player } = ev;
            system.run(() => { try {
                cycle(block, player);
            }
            catch (e) {
                __R.log("warn", `[CBC] ошибка настройки взрывателя: ${String(e)}`);
            } });
        }
        catch { /* ignore */ }
    });
    // Блок сломан игроком: настройка переходит в выпавший предмет (в творческом режиме предмета нет, подмена ничего не найдёт).
    world.afterEvents.playerBreakBlock.subscribe((ev) => {
        try {
            const perm = ev.brokenBlockPermutation;
            if (EXPLOSIVES[perm.type.id])
                regDel(ev.dimension, { x: ev.block.x, y: ev.block.y, z: ev.block.z });
            if (perm.type.id !== SHELL_ID)
                return;
            const sec = clampFuze(perm.getState(STATE));
            if (!sec)
                return;
            const dim = ev.dimension, pos = { x: ev.block.x, y: ev.block.y, z: ev.block.z };
            system.runTimeout(() => { try {
                replaceDrop(dim, pos, sec);
            }
            catch { /* ignore */ } }, 1);
        }
        catch { /* ignore */ }
    });
    try {
        world.beforeEvents.explosion.subscribe(onVanillaExplosion);
    }
    catch {
        try {
            world.afterEvents.explosion.subscribe(onVanillaExplosion);
        }
        catch { /* события взрыва недоступны: цепная детонация только от снарядов аддона */ }
    }
}
