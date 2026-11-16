/* CLAUDE-MAP-BEGIN
 FILE: cbc/impact.js  (32 KB, 668 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: Projectile impact & damage to structures (hook into main.js).
 IMPORTS: @minecraft/server, cbc/config/overrides.js, i18n/i18n.js
 IMPORTED BY: cbc/fuze.js, cbc/projectiles.js, cbc/twin.js, core/cbcMount.js, main.js
 EXPORTS: classify, mitigation, targetable, hurt, findEntityHit, areaHit, removeBlock, breakBlocks, tryPierce, setTwinHooks, probeTwin, hurtCannons, setStructureHook, structureRay, applyImpact, setChainHook
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): breakBlocks@403(145L); findEntityHit@262(50L); hurt@207(45L); knock@168(34L); areaHit@345(31L); hurtCannons@576(31L); applyImpact@635(30L); readPieces@65(28L); open@315(28L); takeTotem@126(25L); targetable@101(23L); classify@14(22L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { __R } from "../i18n/i18n.js";
// Попадание снаряда (сборка 37): классы блоков, пробитие, прямой урон, урон по площади, разрушение блоков сферой.
// Числа и правила см. IMPACT в config/overrides.js. Вызовы API сверены со справочником Microsoft Learn (Entity.applyDamage/applyKnockback/kill, Dimension.getEntitiesFromRay + EntityRaycastOptions, equippable.getEquipment/setEquipment, enchantable.getEnchantments, команда setblock ... destroy); в игре не запускались.
import { EquipmentSlot, system, world } from "@minecraft/server";
import { AREA_COVER_FACTOR, ARMOR_MODEL, CRATER, IMPACT, LIMITS, PIERCE_DROPS } from "./config/overrides.js";
const AIR = new Set(["air", "cave_air", "void_air"]);
const LIQUID = new Set(["water", "flowing_water", "lava", "flowing_lava"]);
const UNBREAKABLE = /^(bedrock|barrier|light_block|structure_block|structure_void|jigsaw|command_block|chain_command_block|repeating_command_block|end_portal|end_portal_frame|end_gateway|portal|reinforced_deepslate|border_block|allow|deny)$/;
const HARD = /^(obsidian|crying_obsidian|respawn_anchor|ancient_debris|enchanting_table|ender_chest|dragon_egg|conduit|beacon|spawner|trial_spawner|vault|heavy_core)$/;
const METAL = /^(iron|gold|diamond|emerald|netherite|copper|raw_iron|raw_gold|raw_copper|lapis|redstone)_block$|copper|^(iron_bars|iron_door|iron_trapdoor|chain|anvil|chipped_anvil|damaged_anvil|cauldron|hopper|lightning_rod|bell|grindstone)$/;
const EARTH = /^(dirt|grass_block|dirt_path|grass_path|farmland|podzol|mycelium|coarse_dirt|rooted_dirt|mud|clay|sand|red_sand|gravel|snow|snow_layer|powder_snow|soul_sand|soul_soil|moss_block|pale_moss_block|muddy_mangrove_roots|suspicious_sand|suspicious_gravel|ice|netherrack|crimson_nylium|warped_nylium)$|_concrete_powder$/;
const SOFT = /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)_|leaves|glass|wool|carpet|bookshelf|crafting_table|chest|barrel|_door$|_fence|_trapdoor$|_sign$|_bed$|ladder|scaffolding|hay_block|cactus|pumpkin|melon|cake|honey_block|slime|sponge|tnt|composter|lectern|loom|cartography_table|fletching_table|smithing_table|jukebox|note_block|bee_nest|beehive|shulker_box|banner|torch|lantern|campfire|sea_lantern|glowstone/;
/** Класс блока: air, liquid, unbreakable, hard, metal, earth, soft, stone (по умолчанию). Блоки пушки (cbc:) считаются металлом. */
export function classify(typeId) {
    if (typeId.startsWith("cbc:"))
        return "metal";
    const id = typeId.startsWith("minecraft:") ? typeId.slice(10) : typeId;
    if (AIR.has(id))
        return "air";
    if (LIQUID.has(id))
        return "liquid";
    if (UNBREAKABLE.test(id))
        return "unbreakable";
    if (HARD.test(id))
        return "hard";
    if (/_ore$/.test(id))
        return "stone";
    if (METAL.test(id))
        return "metal";
    if (EARTH.test(id))
        return "earth";
    if (SOFT.test(id))
        return "soft";
    return "stone";
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// ---- Броня ----
const ARMOR_POINTS = {
    leather: { helmet: 1, chestplate: 3, leggings: 2, boots: 1 }, chainmail: { helmet: 2, chestplate: 5, leggings: 4, boots: 1 },
    iron: { helmet: 2, chestplate: 6, leggings: 5, boots: 2 }, golden: { helmet: 2, chestplate: 5, leggings: 3, boots: 1 },
    diamond: { helmet: 3, chestplate: 8, leggings: 6, boots: 3 }, netherite: { helmet: 3, chestplate: 8, leggings: 6, boots: 3 },
    turtle: { helmet: 2, chestplate: 0, leggings: 0, boots: 0 },
};
/**
 * Множитель урона по надетой броне. pieces = [{ typeId, ench: { protection, blast_protection, projectile_protection } }].
 * kind: "blast" (по площади) или "projectile" (прямое попадание).
 */
export function mitigation(pieces, kind) {
    const M = ARMOR_MODEL;
    let points = 0, nether = 0, epf = 0;
    for (const p of pieces) {
        const m = /^(?:minecraft:)?([a-z]+)_(helmet|chestplate|leggings|boots)$/.exec(p.typeId);
        if (!m)
            continue;
        points += ARMOR_POINTS[m[1]]?.[m[2]] ?? 0;
        if (m[1] === "netherite")
            nether++;
        const e = p.ench ?? {};
        epf += (e.protection ?? 0) + 2 * (kind === "blast" ? (e.blast_protection ?? 0) : (e.projectile_protection ?? 0));
    }
    const armorRed = Math.min(M.maxArmorReduction, M.perPoint * points + M.netheriteBonus * nether);
    const enchRed = Math.min(M.maxArmorReduction, M.perEpf * Math.min(M.epfCap, epf));
    return (1 - armorRed) * (1 - enchRed);
}
function readPieces(e) {
    const out = [];
    let eq;
    try {
        eq = e.getComponent("minecraft:equippable");
    }
    catch { /* нет компонента */ }
    if (!eq)
        return out;
    for (const slot of [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet]) {
        try {
            const it = eq.getEquipment(slot);
            if (!it)
                continue;
            const ench = {};
            try {
                const en = it.getComponent("minecraft:enchantable");
                if (en)
                    for (const x of en.getEnchantments())
                        ench[String(x.type.id).replace("minecraft:", "")] = x.level;
            }
            catch { /* без зачарований */ }
            out.push({ typeId: it.typeId, ench });
        }
        catch { /* слот недоступен */ }
    }
    return out;
}
// ---- Существа ----
function valid(e) { try {
    return typeof e.isValid === "function" ? e.isValid() : e.isValid !== false;
}
catch {
    return false;
} }
/** Существо, по которому имеет смысл бить: живое, не часть пушки, не игрок в креативе/наблюдателе. */
export function targetable(e) {
    if (!valid(e))
        return false;
    const t = e.typeId;
    if (t.startsWith("cbc:") || t === "minecraft:item" || t === "minecraft:xp_orb")
        return false;
    try {
        if (!e.getComponent("minecraft:health"))
            return false;
    }
    catch {
        return false;
    }
    if (t === "minecraft:player") {
        try {
            const gm = String(e.getGameMode());
            if (/creative|spectator/i.test(gm))
                return false;
        }
        catch { /* режим неизвестен: считаем выживанием */ }
    }
    return true;
}
const TOTEM = "minecraft:totem_of_undying";
/** Игрок держит тотем бессмертия (рука или вторая рука): забрать один и вернуть true. */
function takeTotem(e) {
    let eq;
    try {
        eq = e.getComponent("minecraft:equippable");
    }
    catch { /* нет компонента */ }
    if (!eq)
        return false;
    for (const slot of [EquipmentSlot.Mainhand, EquipmentSlot.Offhand]) {
        try {
            const it = eq.getEquipment(slot);
            if (it && it.typeId === TOTEM) {
                if (it.amount > 1) {
                    it.amount -= 1;
                    eq.setEquipment(slot, it);
                }
                else
                    eq.setEquipment(slot, undefined);
                return true;
            }
        }
        catch { /* слот недоступен */ }
    }
    return false;
}
/** Эффект тотема: 1 здоровье, регенерация, поглощение, огнестойкость, звук и частицы. */
function reviveByTotem(e, h) {
    h.setCurrentValue(1);
    for (const [id, ticks, amp] of [["regeneration", 900, 1], ["absorption", 100, 1], ["fire_resistance", 800, 0]]) {
        try {
            e.addEffect(id, ticks, { amplifier: amp });
        }
        catch { /* эффект не добавился */ }
    }
    try {
        const l = e.location;
        e.dimension.playSound("random.totem", l);
        e.dimension.spawnParticle("minecraft:totem_particle", { x: l.x, y: l.y + 1, z: l.z });
    }
    catch { /* звук и частицы не критичны */ }
}
/** Отбросить существо: kb = { from?: точка взрыва, dir?: направление полёта снаряда, strength }. */
function knock(e, kb) {
    if (!kb || !(kb.strength > 0.01))
        return;
    try {
        const l = e.location;
        let dx = kb.from ? l.x - kb.from.x : 0, dz = kb.from ? l.z - kb.from.z : 0;
        let n = Math.hypot(dx, dz);
        if (n < 0.3 && kb.dir) {
            dx = kb.dir.x;
            dz = kb.dir.z;
            n = Math.hypot(dx, dz);
        }
        if (n < 1e-6) {
            dx = 1;
            dz = 0;
            n = 1;
        }
        dx /= n;
        dz /= n;
        const hs = kb.strength, vs = Math.min(0.9, 0.25 + 0.35 * kb.strength);
        try {
            e.applyKnockback({ x: dx * hs, z: dz * hs }, vs); // актуальная сигнатура (VectorXZ, вертикаль)
        }
        catch {
            try {
                e.applyKnockback(dx, dz, hs, vs); // старая сигнатура (dirX, dirZ, горизонталь, вертикаль)
            }
            catch {
                e.applyImpulse({ x: dx * hs * 0.5, y: vs, z: dz * hs * 0.5 });
            }
        }
    }
    catch { /* существо недоступно */ }
}
/**
 * Нанести урон `raw` с учётом брони (своя модель, см. mitigation). Игровой applyDamage с причиной "override" даёт красную вспышку, звук и смерть
 * по правилам игры; если игра всё же срезала урон бронёй/эффектами, недостающее досчитывается напрямую. Тотем бессмертия обрабатывается здесь.
 * Возвращает фактический урон.
 */
export function hurt(e, raw, kind, kb) {
    try {
        const h = e.getComponent("minecraft:health");
        if (!h)
            return 0;
        const dmg = raw * mitigation(readPieces(e), kind);
        if (!(dmg > 0.01))
            return 0;
        const cur = h.currentValue;
        if (cur - dmg <= 0 && e.typeId === "minecraft:player" && takeTotem(e)) {
            reviveByTotem(e, h);
            knock(e, kb);
            return cur - 1;
        }
        let ok = true, threw = false;
        try {
            ok = e.applyDamage(dmg, { cause: "override" });
        }
        catch {
            threw = true;
        }
        if (threw) { // applyDamage недоступен: ставим здоровье напрямую
            if (cur - dmg <= 0)
                e.kill();
            else
                h.setCurrentValue(cur - dmg);
        }
        else if (ok) {
            const after = h.currentValue, got = cur - after;
            if (after > 0 && got > 0 && got < dmg * 0.9) { // игра срезала урон (броня/эффекты): добавляем недостающее
                const rest = dmg - got;
                if (after - rest <= 0)
                    e.kill();
                else
                    h.setCurrentValue(after - rest);
            }
        }
        if (ok || threw)
            knock(e, kb);
        return dmg;
    }
    catch {
        return 0;
    }
}
/** Расстояние от точки q до отрезка a -> a + dir*len и параметр t (вдоль отрезка, блоков) ближайшей точки. */
function segDist(a, dir, len, q) {
    const t = Math.max(0, Math.min(len, (q.x - a.x) * dir.x + (q.y - a.y) * dir.y + (q.z - a.z) * dir.z));
    return { d: Math.hypot(a.x + dir.x * t - q.x, a.y + dir.y * t - q.y, a.z + dir.z * t - q.z), t };
}
/**
 * Первое существо на отрезке from -> from + dir*maxDist (прямое попадание).
 * pad > 0 (патроны автопушки): «толстая» пуля. Если точный луч никого не задел, ищем существа, чьё тело (три точки по высоте) ближе pad блоков
 * к линии полёта; существа ближе 2.5 блока к точке выстрела origin пропускаем (стрелок и его пушка).
 */
export function findEntityHit(dim, from, dir, maxDist, skip, pad = 0, origin) { // сборка 71: skip = Set id уже пробитых существ (пробитие насквозь)
    let hits;
    try {
        hits = dim.getEntitiesFromRay(from, dir, { maxDistance: Math.ceil(maxDist * 1.8) + 1, ignoreBlockCollision: true });
    }
    catch {
        return undefined;
    }
    let best;
    for (const h of hits ?? []) {
        if (h.distance > maxDist + 1e-3 || !targetable(h.entity) || skip?.has(h.entity.id))
            continue;
        if (!best || h.distance < best.distance)
            best = h;
    }
    if (best || !(pad > 0))
        return best ? { entity: best.entity, dist: best.distance } : undefined;
    // запасной поиск с запасом на попадание (пехота, бегущая цель)
    let list = [];
    try {
        list = dim.getEntities({ location: { x: from.x + dir.x * maxDist / 2, y: from.y + dir.y * maxDist / 2, z: from.z + dir.z * maxDist / 2 }, maxDistance: maxDist / 2 + pad + 2.5 });
    }
    catch {
        return undefined;
    }
    let near;
    for (const e of list) {
        if (skip?.has(e.id) || !targetable(e))
            continue;
        const l = e.location;
        if (origin && Math.hypot(l.x - origin.x, l.y - origin.y, l.z - origin.z) < 2.5)
            continue;
        let h = 1.8;
        try {
            const hb = e.getComponent("minecraft:collision_box");
            if (hb && hb.height)
                h = hb.height;
        }
        catch { /* размеры неизвестны: человеческий рост */ }
        let m;
        for (const k of [0.15, 0.5, 0.9]) {
            const r = segDist(from, dir, maxDist, { x: l.x, y: l.y + h * k, z: l.z });
            if (!m || r.d < m.d)
                m = r;
        }
        if (m.d <= pad && (!near || m.t < near.dist))
            near = { entity: e, dist: m.t };
    }
    return near;
}
/** Блоки, которые взрывную волну не гасят (сборка 78): листва, снег, трава и прочая растительность, ковры. */
const BLAST_PASS = /leaves|^snow_layer$|^snow$|^(tall_grass|short_grass|grass|fern|large_fern|double_plant|deadbush|seagrass|vine|sweet_berry_bush|fire|soul_fire|web|cobweb|torch|redstone_wire|string|tripwire)$|carpet|_sapling$|^(red|yellow)_flower$|_tulip$|_flower$|^azalea|^moss_carpet$/;
/** Нет ли блока между a и b (для урона по площади через стену). Листва и снег не считаются преградой: луч идёт дальше. */
function open(dim, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.hypot(dx, dy, dz);
    if (d < 0.6)
        return true;
    const dir = { x: dx / d, y: dy / d, z: dz / d };
    let from = a, left = d;
    try {
        for (let i = 0; i < 16 && left > 0.3; i++) {
            const hit = dim.getBlockFromRay(from, dir, { maxDistance: Math.ceil(left * 1.8) + 1 });
            if (!hit)
                return true;
            const f = hit.faceLocation, bl = hit.block;
            const p = { x: bl.x + f.x, y: bl.y + f.y, z: bl.z + f.z };
            const dist = Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z);
            if (dist >= d - 0.3)
                return true;
            const id = bl.typeId.startsWith("minecraft:") ? bl.typeId.slice(10) : bl.typeId;
            if (!BLAST_PASS.test(id))
                return false;
            from = { x: p.x + dir.x * 0.55, y: p.y + dir.y * 0.55, z: p.z + dir.z * 0.55 }; // шаг за точку входа: следующий блок на луче (тот же блок листвы пройдётся снова)
            left = d - Math.hypot(from.x - a.x, from.y - a.y, from.z - a.z);
        }
        return true;
    }
    catch {
        return true;
    }
}
const AREA_MAX_TARGETS = 80; // потолок целей за один взрыв (в обычной игре не достигается)
/** Урон по площади вокруг c. skip: существо, уже получившее прямой урон. */
export function areaHit(dim, c, area, skip, dir) {
    let list = [];
    try {
        list = dim.getEntities({ location: c, maxDistance: area.radius + 1.5 });
    }
    catch {
        return 0;
    }
    if (list.length > AREA_MAX_TARGETS) { // защита сервера: в огромном радиусе (картечь 54) берём ближайшие цели
        const d2 = (e) => { try { const q = e.location; return (q.x - c.x) ** 2 + (q.y - c.y) ** 2 + (q.z - c.z) ** 2; } catch { return Infinity; } };
        list = list.map((e) => [d2(e), e]).sort((a, b) => a[0] - b[0]).slice(0, AREA_MAX_TARGETS * 2).map((x) => x[1]);
    }
    let n = 0, handled = 0;
    for (const e of list) {
        if (e === skip || !targetable(e))
            continue;
        if (++handled > AREA_MAX_TARGETS)
            break;
        const l = e.location, mid = { x: l.x, y: l.y + 0.9, z: l.z };
        const d = Math.max(0, Math.hypot(mid.x - c.x, mid.y - c.y, mid.z - c.z) - 0.5); // 0.5: примерная половина ширины
        if (d > area.radius)
            continue;
        let raw = area.damage * (1 - area.falloff * Math.min(1, d / area.radius));
        if (!open(dim, c, mid))
            raw *= AREA_COVER_FACTOR;
        const k = area.knock ? { from: c, dir: dir, strength: area.knock * (1 - 0.7 * Math.min(1, d / area.radius)) } : undefined;
        if (hurt(e, raw, "blast", k) > 0)
            n++;
    }
    return n;
}
/** Убрать блок. drop = true: как будто сломан (команда setblock ... destroy выбрасывает предметы), иначе тихо заменить воздухом. */
export function removeBlock(dim, b, drop) {
    if (drop) {
        for (const cmd of [`setblock ${b.x} ${b.y} ${b.z} air [] destroy`, `setblock ${b.x} ${b.y} ${b.z} air destroy`]) {
            try {
                const r = dim.runCommand(cmd);
                if (r && r.successCount === 0)
                    continue;
                return true;
            }
            catch { /* пробуем другой синтаксис */ }
        }
    }
    try {
        b.setType("minecraft:air");
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Разрушить блоки эллипсоидом вокруг c; radii: радиус по классу блока (по вертикали), hScale: растяжение по горизонтали. Работает порциями (system.runJob), чтобы не вешать тик.
 * Сборка 42 (воронка «не совсем круглая»): (1) центр привязан к сетке блоков (x, z = центр блока, y кратно 0.5), поэтому воронка симметрична по всем осям;
 * (2) случайное дрожание радиуса (+-0.4 блока) убрано; (3) островки и шипы нерушимых блоков внутри воронки убираются проходом сглаживания (CRATER.smooth):
 * блок, который этот снаряд не ломает на таком расстоянии, но у которого уже убраны >= 4 из 6 соседей, тоже убирается. Плоская стена так не съедается (там открыта одна грань).
 */
export function breakBlocks(dim, c0, radii, cap, drops, hScale = 1) {
    const R = Math.max(0, ...Object.values(radii));
    const RH = R * hScale; // воронка шире по горизонтали (hScale), глубина (вертикальный радиус) прежняя
    const c = { x: Math.floor(c0.x) + 0.5, y: Math.round(c0.y * 2) / 2, z: Math.floor(c0.z) + 0.5 };
    const K = (x, y, z) => `${x},${y},${z}`;
    function* job() {
        const cells = new Map();
        let n = 0;
        for (let x = Math.floor(c.x - RH); x <= Math.floor(c.x + RH); x++)
            for (let y = Math.floor(c.y - R); y <= Math.floor(c.y + R); y++)
                for (let z = Math.floor(c.z - RH); z <= Math.floor(c.z + RH); z++) {
                    if ((++n % 120) === 0)
                        yield;
                    let b;
                    try {
                        b = dim.getBlock({ x, y, z });
                    }
                    catch {
                        continue;
                    }
                    if (!b)
                        continue;
                    const cls = classify(b.typeId);
                    const d = Math.hypot((x + 0.5 - c.x) / hScale, y + 0.5 - c.y, (z + 0.5 - c.z) / hScale);
                    const r = radii[cls];
                    cells.set(K(x, y, z), { b, x, y, z, cls, d, r, rm: r !== undefined && d <= r });
                }
        if (CRATER.smooth) {
            const nb = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
            for (let pass = 0; pass < CRATER.smoothPasses; pass++) {
                const add = [];
                for (const q of cells.values()) {
                    if (q.rm || q.r === undefined || q.d > R)
                        continue; // уже убирается / этот снаряд такой блок не ломает вообще (металл, обсидиан) / вне эллипсоида
                    let open = 0;
                    for (const [ox, oy, oz] of nb) {
                        const o = cells.get(K(q.x + ox, q.y + oy, q.z + oz));
                        if (o && (o.rm || o.cls === "air" || o.cls === "liquid"))
                            open++;
                    }
                    if (open >= CRATER.smoothOpen)
                        add.push(q);
                }
                if (!add.length)
                    break;
                for (const q of add)
                    q.rm = true;
            }
        }
        const cand = [];
        for (const q of cells.values())
            if (q.rm)
                cand.push(q);
        cand.sort((a, b) => a.d - b.d);
        const m = Math.min(cand.length, cap);
        let left = drops ? drops.max : 0;
        for (let i = 0; i < m; i++) {
            if (i % 60 === 59)
                yield;
            const q = cand[i];
            let cur;
            try {
                cur = dim.getBlock({ x: q.x, y: q.y, z: q.z });
            }
            catch {
                continue; // чанк выгрузился
            }
            let was;
            try {
                was = q.b.typeId;
            }
            catch {
                was = undefined;
            }
            if (!cur || (was !== undefined && cur.typeId !== was))
                continue; // блок успел измениться (игрок, другой взрыв): не трогаем
            let holds = false;
            try {
                holds = !!cur.getComponent("minecraft:inventory"); // сундук/бочка/шалкер/печь: содержимое выпадает, а не исчезает
            }
            catch { /* нет компонента */ }
            const drop = holds || (left > 0 && Math.random() < drops.chance);
            if (drop && !holds)
                left--;
            removeBlock(dim, cur, drop);
        }
    }
    // Сборка 80: воронка шире одного чанка, а при дальнем выстреле снаряд держит загруженным только свой чанк. Соседние чанки не загружены,
    // getBlock в них не работает, и воронка обрезалась по границе чанка (куски, «четвертинка» круга). Теперь на время разрушения держим
    // область загрузки вокруг воронки (один прямоугольник), а после разрушения снимаем.
    const x0 = Math.floor((c.x - RH) / 16), x1 = Math.floor((c.x + RH) / 16), z0 = Math.floor((c.z - RH) / 16), z1 = Math.floor((c.z + RH) / 16);
    const yy = Math.max(-60, Math.min(300, c.y));
    let allLoaded = true;
    try {
        for (let cx = x0; cx <= x1 && allLoaded; cx++)
            for (let cz = z0; cz <= z1; cz++)
                if (!dim.isChunkLoaded({ x: cx * 16 + 8, y: yy, z: cz * 16 + 8 })) {
                    allLoaded = false;
                    break;
                }
    }
    catch {
        allLoaded = false;
    }
    const start = (name) => {
        try {
            system.runJob((function* () { try { yield* job(); } finally { if (name) { try { world.tickingAreaManager.removeTickingArea(name); } catch { /* уже снята */ } } } })());
        }
        catch { /* runJob недоступен: пропускаем разрушение */ }
    };
    if (allLoaded || (x1 - x0 + 1) * (z1 - z0 + 1) > 16) {
        start();
        return;
    }
    let T;
    try {
        T = world.tickingAreaManager;
    }
    catch { /* нет менеджера */ }
    if (!T) {
        start();
        return;
    }
    const name = `cbc_k${++craterSeq}`;
    const opts = { dimension: dim, from: { x: x0 * 16, y: 0, z: z0 * 16 }, to: { x: x1 * 16 + 15, y: 0, z: z1 * 16 + 15 } };
    try {
        if (!T.hasCapacity(opts)) { // лимит областей: чуть позже пробуем ещё раз, потом ломаем сколько получится
            system.runTimeout(() => {
                let ok = false;
                try {
                    ok = T.hasCapacity(opts);
                }
                catch { /* пробуем создать */ }
                if (!ok) {
                    start();
                    return;
                }
                T.createTickingArea(name, opts).then(() => start(name)).catch(() => { start(); });
            }, 10);
            return;
        }
    }
    catch { /* нет метода: пробуем создать */ }
    T.createTickingArea(name, opts).then(() => start(name)).catch(() => { start(); });
}
let craterSeq = 0;
/** Снаряд типа "pierce" продолжает лететь сквозь блок? Если да, блок уже убран. p хранит остаток бюджета в p.pen. */
export function tryPierce(p, block, speed) {
    if (block.typeId === "cbc:he_shell" || block.typeId === "cbc:powder_charge")
        return false; // сборка 42: поставленный фугас не пробиваем насквозь, снаряд взрывается об него (цепная детонация подхватит блок)
    const spec = IMPACT[p.munitionId];
    if (!spec || spec.kind !== "pierce" || !spec.cost)
        return false;
    const cost = spec.cost[classify(block.typeId)];
    if (cost === undefined)
        return false;
    if (p.pen === undefined)
        p.pen = (spec.budget ?? 0) * clamp(speed / (spec.speedRef ?? 1), 0.5, 1.5);
    if (p.pen < cost)
        return false;
    if (!removeBlock(p.dim, block, PIERCE_DROPS))
        return false;
    p.pen -= cost;
    return true;
}
/** Результат удара в точке at: прямой урон, урон по площади, разрушение блоков. entity: существо, в которое попали (если есть); dir: направление полёта. */
// ---- Сборка 71: удар по пушкам (ломаются по кусочкам) ----
const CANNON_RE = /^cbc:(cast_iron|steel|bronze_vt)_/;
let twinHook, twinProbe;
/** twin.js подключает сюда повреждение поднятой автопушки (hook) и проверку «снаряд у автопушки» (probe); прямой импорт дал бы цикл. */
export function setTwinHooks(hook, probe) { twinHook = hook; twinProbe = probe; }
export function probeTwin(dim, pos, r) { try { return twinProbe ? !!twinProbe(dim, pos, r) : false; } catch { return false; } }
/** Удар радиуса R в точке at: ломает до 6 ближайших деталей пушек (шанс 0.9 в центре, 0.15 на краю) и бьёт по поднятым автопушкам. */
export function hurtCannons(dim, at, R) {
    const found = [];
    const r = Math.ceil(R);
    const cx = Math.floor(at.x), cy = Math.floor(at.y), cz = Math.floor(at.z);
    for (let x = cx - r; x <= cx + r; x++)
        for (let y = cy - r; y <= cy + r; y++)
            for (let z = cz - r; z <= cz + r; z++) {
                const d = Math.hypot(x + 0.5 - at.x, y + 0.5 - at.y, z + 0.5 - at.z);
                if (d > R)
                    continue;
                let b;
                try {
                    b = dim.getBlock({ x, y, z });
                }
                catch {
                    continue;
                }
                if (b && CANNON_RE.test(b.typeId))
                    found.push({ b, d });
            }
    found.sort((a, b) => a.d - b.d);
    let broken = 0;
    for (const f of found) {
        if (broken >= 6)
            break;
        if (Math.random() < 0.9 - 0.75 * Math.min(1, f.d / Math.max(0.5, R)) && removeBlock(dim, f.b, true))
            broken++;
    }
    if (twinHook)
        twinHook(dim, at, R);
}
// ---- Сборка 82: урон по физическим конструкциям (машинам) ----
// Блоки конструкции лежат не в мире, а в физике (core/structures.js), поэтому getBlockFromRay их не видит и снаряд летел сквозь корпус,
// а взрыв ничего не ломал. core/cbcMount.js подключает сюда луч по конструкциям и взрыв по ним (прямой импорт дал бы цикл).
let structHook;
export function setStructureHook(h) { structHook = h; }
/** Первая точка пересечения отрезка from -> from + dir*maxDist с блоками конструкции: { distance, point } или undefined. */
export function structureRay(dim, from, dir, maxDist, skipOwner) { // шаг 150: skipOwner - конструкция стрелка, её луч не учитывает
    try {
        return structHook?.ray(dim, from, dir, maxDist, skipOwner);
    }
    catch (e) {
        __R.log("warn", `[CBC] луч по конструкциям: ${e}`);
        return undefined;
    }
}
/** Сила взрыва для конструкций (шкала ванильного ТНТ = 4) по записи IMPACT: фугас ~5, ядро ~1.5, бронебойный ~3.5, картечь и автопушка ~1. */
function structPower(spec) {
    if (!(spec.area || spec.direct || spec.entryArea))
        return 0; // дымовой и отравляющий снаряды без урона
    let q;
    if (spec.blocks)
        q = 1.5 + (spec.area?.damage ?? 0) / 40;
    else if (spec.direct)
        q = 1 + spec.direct / 60;
    else
        q = 1;
    return Math.min(8, q);
}
export function applyImpact(dim, munitionId, at, entity, dir, power = 1) { // сборка 71: power = множитель силы выстрела (длина ствола бронзовой пушки)
    const spec = IMPACT[munitionId];
    if (!spec)
        return;
    try { // сборка 83: урон конструкциям считается ПЕРВЫМ и отдельно (раньше ошибка в breakBlocks/areaHit или молчаливый catch скрывали отсутствие урона)
        const sp = structPower(spec) * power;
        if (sp > 0)
            structHook?.blast(dim, at, sp);
    }
    catch (e) {
        __R.log("warn", `[CBC] урон по конструкциям не прошёл: ${e}`);
    }
    let direct = false;
    if (entity && spec.direct) {
        hurt(entity, spec.direct * power, "projectile", spec.directKnock ? { dir: dir ? { x: dir.x, z: dir.z } : undefined, strength: spec.directKnock } : undefined);
        direct = true;
    }
    if (spec.area)
        areaHit(dim, at, power === 1 ? spec.area : { ...spec.area, damage: spec.area.damage * power }, direct ? entity : undefined, dir ? { x: dir.x, z: dir.z } : undefined);
    if (spec.blocks)
        breakBlocks(dim, at, spec.blocks, spec.cap ?? LIMITS.maxBlocksBrokenPerExplosion, spec.drops, spec.hScale ?? 1);
    if (spec.cannonRadius > 0) {
        try {
            hurtCannons(dim, at, spec.cannonRadius);
        }
        catch { /* не критично */ }
    }
    if (spec.chain > 0 && chainHook)
        chainHook(dim, at, spec.chain); // сборка 42: цепная детонация поставленных фугасов рядом (fuze.js)
}
let chainHook;
/** fuze.js подключает сюда цепную детонацию (прямой импорт дал бы цикл импортов). */
export function setChainHook(fn) { chainHook = fn; }
