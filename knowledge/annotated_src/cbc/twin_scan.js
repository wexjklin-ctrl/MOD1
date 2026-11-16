/* CLAUDE-MAP-BEGIN
 FILE: cbc/twin_scan.js  (9 KB, 131 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: i18n/i18n.js
 IMPORTED BY: cbc/twin.js
 EXPORTS: TWIN_PREFIX, TWIN_LETTER, TWIN_PARTS, TWIN_MAX_LEN, TWIN_LAYOUTS, HDIRS, twinDirVec, TWIN_YAW, twinPart, boxSlot, validLayout, scanTwin, findTwin
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): findTwin@83(48L); scanTwin@35(47L); boxSlot@24(7L); twinPart@18(5L); twinDirVec@14(1L); validLayout@33(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { __t } from "../i18n/i18n.js";
// Бронзовая спаренная пушка: чистая логика сборки (без @minecraft/server). Читатель блоков такой же, как у multiblock.js.
// Правило раскладки: B S? b{1..6} (M|N)?  (B казённик, S пружина отката, b ствол, M дульный тормоз, N глушитель).
// Сборка 63: перед казёнником B обязателен ВТОРОЙ (задний) казённик: ряд «B B S? b.. (M|N)?». Раскладка/модель считаются от переднего казённика (крайнего у ствола, он же ось поворота и источник гильз); задний лежит в cells последним и в `rearPos`. Ручки стоят за задним казёнником.
export const TWIN_PREFIX = "cbc:bronze_vt_";
export const TWIN_LETTER = { breech: "B", recoil_spring: "S", barrel: "b", muzzle_brake: "M", silencer: "N" };
export const TWIN_PARTS = [...Object.keys(TWIN_LETTER), "handles", "mount", "ammo_box"]; // handles = ручки сзади казённика (садятся через них), mount = станина под казёнником, ammo_box = фиолетовый ящик боеприпасов сбоку казённика (сборка 64)
export const TWIN_MAX_LEN = 10; // B + S + 6 b + M = 9; запас
// Порядок раскладок = порядок геометрий в сущности cbc:btc (вариант = индекс). Сгенерировано из layouts.json части A.
export const TWIN_LAYOUTS = ["Bb", "BbM", "BbN", "Bbb", "BbbM", "BbbN", "Bbbb", "BbbbM", "BbbbN", "Bbbbb", "BbbbbM", "BbbbbN", "Bbbbbb", "BbbbbbM", "BbbbbbN", "Bbbbbbb", "BbbbbbbM", "BbbbbbbN", "BSb", "BSbM", "BSbN", "BSbb", "BSbbM", "BSbbN", "BSbbb", "BSbbbM", "BSbbbN", "BSbbbb", "BSbbbbM", "BSbbbbN", "BSbbbbb", "BSbbbbbM", "BSbbbbbN", "BSbbbbbb", "BSbbbbbbM", "BSbbbbbbN"];
const DIR_VEC = { north: { x: 0, y: 0, z: -1 }, south: { x: 0, y: 0, z: 1 }, east: { x: 1, y: 0, z: 0 }, west: { x: -1, y: 0, z: 0 } };
const OPP = { north: "south", south: "north", east: "west", west: "east" };
export const HDIRS = ["north", "south", "east", "west"];
export function twinDirVec(d) { return DIR_VEC[d]; }
/** Yaw сущности (как у игрока): юг 0, запад 90, север 180, восток -90. */
export const TWIN_YAW = { south: 0, west: 90, north: 180, east: -90 };
/** `cbc:bronze_vt_barrel` -> "barrel"; не часть -> undefined. */
export function twinPart(typeId) {
    if (!typeId || !typeId.startsWith(TWIN_PREFIX)) return undefined;
    const p = typeId.slice(TWIN_PREFIX.length);
    return TWIN_PARTS.includes(p) ? p : undefined;
}
/** Слот модели ящика (сущности cbc:btx0..3): казённик (f передний / r задний) и сторона. Модельный +x = ВЛЕВО от стрелка (по числам ванильных моделей: правая рука на -x). 0 = передний-левый, 1 = передний-правый, 2 = задний-левый, 3 = задний-правый. */
export function boxSlot(dir, which, lat) {
    const yaw = (TWIN_YAW[dir] * Math.PI) / 180;
    const right = { x: -Math.cos(yaw), z: -Math.sin(yaw) }; // вправо от стрелка, смотрящего вдоль dir
    const lv = DIR_VEC[lat];
    const isRight = lv.x * right.x + lv.z * right.z > 0;
    return (which === "r" ? 2 : 0) + (isRight ? 1 : 0);
}
const RE = /^BS?b{1,6}[MN]?$/;
/** Строка раскладки валидна? */
export function validLayout(seq) { return RE.test(seq); }
/** Скан от казённика в сторону dir. Возврат { valid, reason?, seq, layout, cells:[{pos,part}], barrels, dir, breechPos }. */
export function scanTwin(breechPos, dir, read) {
    const fail = (reason) => ({ valid: false, reason, seq: "", layout: -1, cells: [], barrels: 0, dir, breechPos });
    const head = read(breechPos);
    if (!head) return fail(__t(98));
    if (twinPart(head.typeId) !== "breech") return fail(__t(169));
    const v = DIR_VEC[dir];
    if (!v) return fail(__t(170));
    // сборка 63: если впереди (по dir) ещё казённик, то начали с заднего: рабочий казённик = крайний у ствола
    const ahead = { x: breechPos.x + v.x, y: breechPos.y, z: breechPos.z + v.z };
    const ahead1 = read(ahead);
    if (ahead1 && twinPart(ahead1.typeId) === "breech") breechPos = ahead;
    const rearPos = { x: breechPos.x - v.x, y: breechPos.y, z: breechPos.z - v.z };
    const rear = read(rearPos);
    if (!rear) return fail(__t(171));
    if (twinPart(rear.typeId) !== "breech") return fail(__t(172));
    const cells = [{ pos: breechPos, part: "breech" }];
    let seq = "B";
    for (let i = 1; i <= TWIN_MAX_LEN; i++) {
        const pos = { x: breechPos.x + v.x * i, y: breechPos.y, z: breechPos.z + v.z * i };
        const b = read(pos);
        if (!b) return fail(__t(100));
        const part = twinPart(b.typeId);
        if (!part || part === "handles" || part === "mount" || part === "ammo_box") break;
        if (part === "breech") return fail(__t(173));
        cells.push({ pos, part });
        seq += TWIN_LETTER[part];
    }
    if (!validLayout(seq)) return fail(__t(174, seq));
    const layout = TWIN_LAYOUTS.indexOf(seq);
    if (layout < 0) return fail(__t(175, seq));
    cells.push({ pos: rearPos, part: "breech" }); // задний казённик: последним (cells[0] остаётся передним)
    const handlesPos = { x: rearPos.x - v.x, y: rearPos.y, z: rearPos.z - v.z }; // ручки за задним казёнником
    const hasHandles = twinPart(read(handlesPos)?.typeId) === "handles";
    const under = (p) => twinPart(read({ x: p.x, y: p.y - 1, z: p.z })?.typeId) === "mount";
    const hasMount = under(breechPos) || under(rearPos); // станина под любым из двух казёнников
    // сборка 64: ящики боеприпасов СБОКУ любого из двух казёнников (поперёк оси пушки)
    const boxes = [];
    for (const [which, bp] of [["f", breechPos], ["r", rearPos]]) {
        for (const lat of HDIRS) {
            if (lat === dir || lat === OPP[dir]) continue;
            const lv = DIR_VEC[lat];
            const pos = { x: bp.x + lv.x, y: bp.y, z: bp.z + lv.z };
            if (twinPart(read(pos)?.typeId) === "ammo_box") boxes.push({ pos, which, lat, facing: OPP[lat], slot: boxSlot(dir, which, lat) });
        }
    }
    return { valid: true, seq, layout, cells, barrels: (seq.match(/b/g) ?? []).length, dir, breechPos, rearPos, hasHandles, hasMount, handlesPos, boxes };
}
/** Найти пушку по ЛЮБОМУ её блоку: идём по прямой в 4 стороны до казённика, затем сканируем. Возврат скана или { valid:false, reason } / undefined (не наш блок). */
export function findTwin(start, read) {
    const first = read(start);
    if (!first || !twinPart(first.typeId)) return undefined;
    const cands = [];
    if (twinPart(first.typeId) === "mount") { // станина: пушка стоит на ней (казённик сверху)
        const up = { x: start.x, y: start.y + 1, z: start.z };
        if (twinPart(read(up)?.typeId) === "breech") return findTwin(up, read);
        return { valid: false, reason: __t(176), seq: "", layout: -1, cells: [], barrels: 0, dir: "north", breechPos: start };
    }
    if (twinPart(first.typeId) === "ammo_box") { // ящик: казённик рядом сбоку; пушка стреляет вдоль перпендикуляра к линии ящик-казённик
        for (const d of HDIRS) {
            const v = DIR_VEC[d];
            const n = { x: start.x + v.x, y: start.y, z: start.z + v.z };
            if (twinPart(read(n)?.typeId) !== "breech") continue;
            for (const pd of HDIRS) { if (pd !== d && pd !== OPP[d]) cands.push({ breech: n, dir: pd }); }
        }
    } else if (twinPart(first.typeId) === "handles") { // ручки: (задний) казённик сразу впереди, пушка стреляет в ту же сторону
        for (const d of HDIRS) {
            const v = DIR_VEC[d];
            const n = { x: start.x + v.x, y: start.y, z: start.z + v.z };
            if (twinPart(read(n)?.typeId) === "breech") cands.push({ breech: n, dir: d });
        }
    } else if (twinPart(first.typeId) === "breech") {
        const pref = first.facing && HDIRS.includes(first.facing) ? [first.facing, ...HDIRS.filter((d) => d !== first.facing)] : HDIRS;
        for (const d of pref) cands.push({ breech: start, dir: d });
    } else {
        for (const d of HDIRS) {
            const v = DIR_VEC[d];
            let pos = start;
            for (let i = 0; i <= TWIN_MAX_LEN; i++) {
                const b = read(pos);
                if (!b) break;
                const part = twinPart(b.typeId);
                if (!part || part === "ammo_box") break;
                if (part === "breech") { cands.push({ breech: pos, dir: OPP[d] }); break; }
                pos = { x: pos.x + v.x, y: pos.y, z: pos.z + v.z };
            }
        }
    }
    if (!cands.length) return { valid: false, reason: __t(177), seq: "", layout: -1, cells: [], barrels: 0, dir: "north", breechPos: start };
    let firstFail;
    for (const c of cands) {
        const s = scanTwin(c.breech, c.dir, read);
        if (s.valid) return s;
        if (!firstFail || s.seq.length > firstFail.seq.length) firstFail = s; // самая «длинная» неудача полезнее для сообщения
    }
    return firstFail;
}
