/* CLAUDE-MAP-BEGIN
 FILE: cbc/multiblock.js  (9 KB, 195 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: cbc/config/materials.generated.js, cbc/config/overrides.js, i18n/i18n.js
 IMPORTED BY: blocks/tower.js, cbc/cmMount.js, cbc/fire.js, cbc/recoil.js, cbc/world.js, core/cbcMount.js
 EXPORTS: MAX_CANNON_LENGTH, dirVec, parsePart, scanCannon, findBreech, findCannon
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): scanCannon@53(59L); findCannon@151(44L); findBreech@117(28L); parsePart@20(23L); fail@43(3L); dirVec@17(1L); axisOf@46(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { __t } from "../i18n/i18n.js";
// Сканирование мультиблока пушки. Чистая логика: не импортирует @minecraft/server,
// блоки читаются через интерфейс BlockReader (адаптер к Script API живёт в main.ts/world.ts).
// Поэтому модуль компилируется и тестируется без сети и без игры (npm run test).
import { MATERIALS } from "./config/materials.generated.js";
import { MORTAR } from "./config/overrides.js";
import { MORTAR_BREECH_RULES, rulesFor } from "./config/overrides.js";
export const MAX_CANNON_LENGTH = 40; // защита от бесконечного прохода; больше самой длинной пушки: затвор + 6 камер + 30 стволов = 37
const DIR_VEC = {
    north: { x: 0, y: 0, z: -1 },
    south: { x: 0, y: 0, z: 1 },
    east: { x: 1, y: 0, z: 0 },
    west: { x: -1, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    down: { x: 0, y: -1, z: 0 },
};
export function dirVec(d) { return DIR_VEC[d]; }
const MATERIAL_IDS = Object.keys(MATERIALS).sort((a, b) => b.length - a.length);
/** `cbc:steel_cannon_barrel` -> { kind: "barrel", material: "steel" }; не часть пушки -> undefined. */
export function parsePart(typeId) {
    if (!typeId.startsWith("cbc:"))
        return undefined;
    let name = typeId.slice(4);
    if (name.endsWith("_hidden"))
        name = name.slice(0, -7); // невидимый двойник на время наклона/отката = та же часть пушки
    const material = MATERIAL_IDS.find((m) => name.startsWith(m + "_"));
    if (!material)
        return undefined;
    const rest = name.slice(material.length + 1);
    switch (rest) {
        case "mortar_breech": return { kind: "breech", material, mortarBreech: true }; // сборка 82: миномётный стальной затвор
        case "sliding_breech":
        case "screw_breech":
        case "quickfiring_breech":
            return { kind: "breech", material };
        case "cannon_chamber": return { kind: "chamber", material };
        case "cannon_barrel": return { kind: "barrel", material };
        case "mortar_barrel": return { kind: "barrel", material, mortar: true }; // сборка 79: миномётный ствол = ствол + разлёт
        case "cannon_end": return { kind: "end", material };
        default: return undefined;
    }
}
function fail(breechPos, direction, reason) {
    return { valid: false, reason, breechPos, direction, chambers: 0, barrels: 0, mortars: 0, materialId: "", muzzlePos: breechPos };
}
function axisOf(d) { return d === "up" || d === "down" ? "y" : d === "east" || d === "west" ? "x" : "z"; }
/**
 * Идёт от казённика вперёд по оси его facing.
 * Правила: breech -> камеры (мин/макс по материалу, см. CANNON_RULES) -> стволы (1..maxBarrels) -> опциональный end (последний).
 * Блоки пушки с другой осью, неверный порядок или «дыра» внутри -> невалидно.
 * материалы смешивать нельзя: вся пушка из материала затвора.
 */
export function scanCannon(breechPos, read, dirOverride) {
    const head = read(breechPos);
    if (!head)
        return fail(breechPos, "north", __t(98));
    const dir = dirOverride ?? head.facing ?? "north";
    const breech = parsePart(head.typeId);
    if (!breech || breech.kind !== "breech")
        return fail(breechPos, dir, __t(99));
    const v = DIR_VEC[dir];
    let weakest = breech.material;
    let chambers = 0, barrels = 0, mortars = 0, hasEnd = false;
    let pos = breechPos;
    for (let i = 1; i <= MAX_CANNON_LENGTH; i++) {
        const next = { x: pos.x + v.x, y: pos.y + v.y, z: pos.z + v.z };
        const b = read(next);
        if (!b)
            return fail(breechPos, dir, __t(100));
        const part = parsePart(b.typeId);
        if (!part)
            break; // конец цепочки
        if (part.kind === "breech")
            return fail(breechPos, dir, __t(101));
        if (part.material !== breech.material) {
            const ru = (m) => (m === "steel" ? __t(102) : m === "cast_iron" ? __t(103) : m);
            return fail(breechPos, dir, __t(104, ru(breech.material), ru(part.material)));
        }
        // Направление (facing) не-казёнников не влияет на сборку: цепочка определяется положением блоков, а выравнивание делает world.ts.
        if (hasEnd)
            return fail(breechPos, dir, __t(105));
        if (part.kind === "chamber") {
            if (barrels > 0)
                return fail(breechPos, dir, __t(106));
            chambers++;
        }
        else if (part.kind === "barrel") {
            barrels++;
            if (part.mortar)
                mortars++;
        }
        else
            hasEnd = true;
        if (MATERIALS[part.material].maxSafePropellantStress < MATERIALS[weakest].maxSafePropellantStress)
            weakest = part.material;
        pos = next;
    }
    if (barrels === 0)
        return fail(breechPos, dir, __t(107));
    if (mortars > MORTAR.maxCount)
        return fail(breechPos, dir, __t(108, MORTAR.maxCount, mortars));
    const rules = breech.mortarBreech ? { ...rulesFor(weakest), ...MORTAR_BREECH_RULES } : rulesFor(weakest);
    const who = weakest === "steel" ? __t(78) : weakest === "cast_iron" ? __t(77) : __t(109, weakest);
    if (chambers < rules.minChambers)
        return fail(breechPos, dir, __t(110, rules.minChambers));
    if (chambers > rules.maxChambers)
        return fail(breechPos, dir, __t(111, who, rules.maxChambers, chambers));
    if (barrels > rules.maxBarrels)
        return fail(breechPos, dir, __t(112, rules.maxBarrels, barrels));
    return { valid: true, breechPos, direction: dir, chambers, barrels, mortars, materialId: weakest, muzzlePos: pos, mortarBreech: !!breech.mortarBreech };
}
const OPPOSITE = { north: "south", south: "north", east: "west", west: "east", up: "down", down: "up" };
/**
 * От любого блока пушки ищет казённик по прямой в любую из 6 сторон: цепочка блоков пушки должна упираться
 * в казённик, который смотрит в сторону начального блока. Собственный facing начального блока не важен.
 */
export function findBreech(start, read) {
    const first = read(start);
    if (!first || !parsePart(first.typeId))
        return undefined;
    if (parsePart(first.typeId)?.kind === "breech")
        return start;
    const own = first.facing;
    const dirs = Object.keys(DIR_VEC).sort((a, b) => (own && b === OPPOSITE[own] ? 1 : 0) - (own && a === OPPOSITE[own] ? 1 : 0));
    for (const d of dirs) {
        const v = DIR_VEC[d];
        let pos = start;
        for (let i = 0; i <= MAX_CANNON_LENGTH; i++) {
            const b = read(pos);
            if (!b)
                break;
            const part = parsePart(b.typeId);
            if (!part)
                break;
            if (part.kind === "breech") {
                if ((b.facing ?? "north") === OPPOSITE[d])
                    return pos;
                break;
            }
            pos = { x: pos.x + v.x, y: pos.y + v.y, z: pos.z + v.z };
        }
    }
    return undefined;
}
const ALL_DIRS = ["north", "south", "east", "west", "up", "down"];
/**
 * Главный вход: найти пушку по ЛЮБОМУ её блоку. Направление определяется геометрией (линия блоков от казённика),
 * а не facing частей: казённик может быть повёрнут как угодно, ствол ставится по прямой от него.
 * Из кандидатов выбирается первая валидная пушка; если валидной нет, возвращается скан первого кандидата (с причиной).
 */
export function findCannon(start, read) {
    const first = read(start);
    if (!first)
        return undefined;
    const fp = parsePart(first.typeId);
    if (!fp)
        return undefined;
    const cands = [];
    if (fp.kind === "breech") {
        const pref = first.facing ? [first.facing, ...ALL_DIRS.filter((d) => d !== first.facing)] : ALL_DIRS;
        for (const d of pref)
            cands.push({ breech: start, dir: d });
    }
    else {
        for (const d of ALL_DIRS) {
            const v = DIR_VEC[d];
            let pos = start;
            for (let i = 0; i <= MAX_CANNON_LENGTH; i++) {
                const b = read(pos);
                if (!b)
                    break;
                const part = parsePart(b.typeId);
                if (!part)
                    break;
                if (part.kind === "breech") {
                    cands.push({ breech: pos, dir: OPPOSITE[d] });
                    break;
                }
                pos = { x: pos.x + v.x, y: pos.y + v.y, z: pos.z + v.z };
            }
        }
    }
    if (cands.length === 0)
        return undefined;
    let firstScan;
    for (const c of cands) {
        const scan = scanCannon(c.breech, read, c.dir);
        if (scan.valid)
            return { breech: c.breech, scan };
        // для казённика-старта «нужен ствол» по всем 5 лишним направлениям не интересен: запоминаем только первого кандидата
        firstScan ??= { breech: c.breech, scan };
    }
    return firstScan;
}
