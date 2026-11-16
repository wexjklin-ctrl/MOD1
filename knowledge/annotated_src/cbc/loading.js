/* CLAUDE-MAP-BEGIN
 FILE: cbc/loading.js  (4 KB, 84 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: cbc/config/overrides.js, i18n/i18n.js
 IMPORTED BY: cbc/cmMount.js, cbc/fire.js, cbc/world.js, core/cbcMount.js
 EXPORTS: ammoName, PROJECTILE_BLOCKS, CHARGE_BLOCK, ammoKind, emptyLoad, chargeCapacity, applyLoad, itemOfMunition, unloadFor, describeLoad
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): applyLoad@32(21L); unloadFor@64(17L); ammoKind@19(9L); itemOfMunition@54(6L); describeLoad@81(3L); ammoName@5(1L); emptyLoad@28(1L); chargeCapacity@30(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { __t } from "../i18n/i18n.js";
// Чистая логика заряжания (без Script API): что за предмет, влезает ли он в пушку, как меняется CannonLoad.
import { ALLOWED_AMMO, AMMO_NAMES, RESTRICT_AMMO, rulesOf } from "./config/overrides.js";
/** Название снаряда для сообщений. */
export function ammoName(id) { return id ? (AMMO_NAMES[id] ?? id) : __t(76); }
const MATERIAL_GEN = { cast_iron: __t(77), steel: __t(78) };
/** id блока-снаряда -> ключ в MUNITIONS (у сплошного ядра ключ `shot`). */
export const PROJECTILE_BLOCKS = {
    he_shell: "he_shell",
    ap_shell: "ap_shell",
    ap_shot: "ap_shot",
    solid_shot: "shot",
    shrapnel_shell: "shrapnel_shell",
    smoke_shell: "smoke_shell",
    poison_shell: "poison_shell",
};
export const CHARGE_BLOCK = "powder_charge";
/** Что за боеприпас лежит в руке (typeId предмета, напр. "cbc:he_shell"). undefined, если не боеприпас. */
export function ammoKind(typeId) {
    if (!typeId || !typeId.startsWith("cbc:"))
        return undefined;
    const name = typeId.slice(4);
    if (name === CHARGE_BLOCK)
        return { kind: "charge" };
    const munitionId = PROJECTILE_BLOCKS[name];
    return munitionId ? { kind: "projectile", munitionId } : undefined;
}
export function emptyLoad() { return { charges: 0 }; }
/** Ёмкость зарядов: чугун 1 камера = 3; сталь 1..6 камер = 3..18. */
export function chargeCapacity(scan) { return scan.chambers * rulesOf(scan).chargesPerChamber; }
/** Применить боеприпас к состоянию пушки. Не мутирует вход. Предмет из руки НЕ списывается здесь. */
export function applyLoad(scan, load, typeId, fuze = 0) {
    const kind = ammoKind(typeId);
    if (!kind)
        return { ok: false, load, message: __t(79) };
    if (!scan.valid)
        return { ok: false, load, message: __t(66, scan.reason ?? "?") };
    if (kind.kind === "charge") {
        const cap = chargeCapacity(scan);
        if (load.charges >= cap)
            return { ok: false, load, message: __t(80, load.charges, cap) };
        const next = { ...load, charges: load.charges + 1 };
        return { ok: true, load: next, message: __t(81, next.charges, cap) };
    }
    if (load.projectileId)
        return { ok: false, load, message: __t(82, ammoName(load.projectileId)) };
    const allowed = ALLOWED_AMMO[scan.materialId];
    if (RESTRICT_AMMO && allowed && !allowed.includes(kind.munitionId))
        return { ok: false, load, message: __t(84, ammoName(kind.munitionId), MATERIAL_GEN[scan.materialId] ?? __t(83), allowed.map(ammoName).join(", ")) };
    const fz = kind.munitionId === "he_shell" ? Math.max(0, Math.round(fuze) || 0) : 0; // задержка взрывателя только у фугасного заряда
    return { ok: true, load: { ...load, projectileId: kind.munitionId, fuze: fz }, message: __t(86, ammoName(kind.munitionId), fz ? __t(85, fz) : "") };
}
/** Предмет-блок для боеприпаса из пушки (обратное к PROJECTILE_BLOCKS: у сплошного ядра ключ `shot`, предмет solid_shot). */
export function itemOfMunition(munitionId) {
    for (const [name, id] of Object.entries(PROJECTILE_BLOCKS))
        if (id === munitionId)
            return `cbc:${name}`;
    return undefined;
}
/**
 * Что выпадет, если Shift + клик боеприпасом по заряженной пушке. Заряд в руке: достаём один заряд. Снаряд в руке: достаём заряженный снаряд (любой).
 * ok = false, если доставать нечего (тогда клик работает как раньше: предмет ставится как декор). Не мутирует вход.
 */
export function unloadFor(load, typeId) {
    const kind = ammoKind(typeId);
    if (!kind)
        return { ok: false, load };
    if (kind.kind === "charge") {
        if (!(load.charges > 0))
            return { ok: false, load };
        return { ok: true, load: { ...load, charges: load.charges - 1 }, itemId: `cbc:${CHARGE_BLOCK}`, fuze: 0, message: __t(87) };
    }
    if (!load.projectileId)
        return { ok: false, load };
    const itemId = itemOfMunition(load.projectileId);
    if (!itemId)
        return { ok: false, load };
    const { projectileId, fuze, ...rest } = load;
    return { ok: true, load: { ...rest, charges: load.charges }, itemId, fuze: Number(fuze) || 0, message: __t(88, ammoName(load.projectileId)) };
}
export function describeLoad(load) {
    return __t(89, ammoName(load.projectileId), load.fuze ? __t(85, load.fuze) : "", load.charges);
}
