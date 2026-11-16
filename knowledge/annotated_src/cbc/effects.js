/* CLAUDE-MAP-BEGIN
 FILE: cbc/effects.js  (8 KB, 156 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (auto, from first comment) Визуальные эффекты: дым и вспышка выстрела, взрыв, след снаряда. Частицы описаны в RP/particles (tools/gen_particles.py).
 IMPORTS: @minecraft/server, cbc/config/overrides.js, cbc/fire.js, cbc/perf.js, cbc/settings.js
 IMPORTED BY: cbc/cmMount.js, cbc/fuze.js, cbc/projectiles.js, cbc/twin.js, cbc/world.js, core/cbcMount.js
 EXPORTS: muzzleBlast, poisonCloud, impactEffects, fuseSpark, trail, shake
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): impactEffects@63(54L); shake@135(21L); muzzleBlast@31(16L); poisonCloud@51(11L); trail@125(8L); vars@9(6L); spawn@15(6L); blastLoad@24(6L); fuseSpark@118(5L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// Визуальные эффекты: дым и вспышка выстрела, взрыв, след снаряда. Частицы описаны в RP/particles (tools/gen_particles.py).
// Параметры в частицы передаются через MolangVariableMap (variable.dx/dy/dz направление, variable.size размер, variable.power сила).
// TODO-VERIFY (в игре не запускалось): Dimension.spawnParticle(id, loc, MolangVariableMap), MolangVariableMap.setFloat.
import { MolangVariableMap, system } from "@minecraft/server";
import { impactPlan } from "./fire.js";
import { degrade } from "./perf.js";
import { S } from "./settings.js";
import { POISON_CLOUD } from "./config/overrides.js";
function vars(values) {
    const m = new MolangVariableMap();
    for (const [k, v] of Object.entries(values))
        m.setFloat(`variable.${k}`, v);
    return m;
}
function spawn(dim, id, pos, values = {}) {
    try {
        dim.spawnParticle(id, pos, vars(values));
    }
    catch { /* частица недоступна или чанк не загружен: не критично */ }
}
// Бюджет дыма выстрелов: дым — крупные полупрозрачные спрайты, при серии выстрелов они накладываются у камеры и роняют клиентский FPS
// (серверный TPS при этом нормальный, degrade() не срабатывает). Считаем выстрелы за последние 3 с и урезаем эффект.
const recentBlasts = [];
function blastLoad() {
    const t = system.currentTick;
    while (recentBlasts.length > 0 && t - recentBlasts[0] > 60) recentBlasts.shift();
    recentBlasts.push(t);
    return recentBlasts.length;
}
/** Выстрел: вспышка, дым конусом вдоль ствола и искры. `power` = число зарядов. */
export function muzzleBlast(dim, pos, dir, power, light = false, quiet = false) {
    if (!S.particles)
        return;
    if (quiet) { // сборка 58: глушитель: без вспышки и искр, только едва заметный дым
        spawn(dim, "cbc:autocannon_smoke", pos, { dx: dir.x, dy: dir.y, dz: dir.z, power: 0.3 });
        return;
    }
    const n = blastLoad();
    const lvl = Math.max(degrade(), n >= 4 ? 2 : n >= 2 ? 1 : 0); // 0 всё, 1 без искр, 2 только дым
    const p = n >= 3 ? 1 : Math.max(1, power);
    if (lvl < 2)
        spawn(dim, "cbc:flash", pos, { size: light ? 1 : 1 + p });
    spawn(dim, light ? "cbc:autocannon_smoke" : "cbc:cannon_smoke", pos, { dx: dir.x, dy: dir.y, dz: dir.z, power: p });
    if (lvl === 0)
        spawn(dim, "cbc:spark", { x: pos.x + dir.x * 0.5, y: pos.y + dir.y * 0.5, z: pos.z + dir.z * 0.5 }, { size: p * 1.5 });
}
/**
 * Сборка 81: ванильное оседающее облако отравления в точке падения отравляющего снаряда.
 * Чанк не подгружается: нет загруженного чанка - облако не создаётся. Областей загрузки не создаём, значит «залипших» чанков не остаётся.
 */
export function poisonCloud(dim, pos) {
    if (!POISON_CLOUD.enabled || degrade() >= 2)
        return; // при критической нагрузке TPS облако не создаётся (дым-частицы тоже урезаются)
    try {
        if (!dim.isChunkLoaded({ x: pos.x, y: Math.max(-60, Math.min(300, pos.y)), z: pos.z }))
            return;
        const e = dim.spawnEntity(POISON_CLOUD.entity, { x: pos.x, y: pos.y + 0.3, z: pos.z });
        e.getComponent("minecraft:projectile")?.shoot({ x: 0, y: -POISON_CLOUD.dropSpeed, z: 0 }); // падает на землю и там раскрывает облако (spawn_aoe_cloud)
    }
    catch { /* сущность или чанк недоступны: не критично */ }
}
/** Взрыв снаряда в точке `pos`. Тип эффекта зависит от снаряда. */
export function impactEffects(dim, pos, munitionId) {
    if (munitionId === "poison_shell")
        poisonCloud(dim, pos); // сборка 81: облако отравления не зависит от настройки частиц
    if (!S.particles)
        return;
    const lvl = degrade();
    const plan = impactPlan(munitionId);
    const size = Math.max(1, plan.radius);
    if (munitionId === "smoke_shell") {
        spawn(dim, "cbc:gas_cloud", pos, {});
        return;
    }
    if (munitionId === "poison_shell") { // сборка 81: зелёный дым + ванильное облако отравления на 30 с
        spawn(dim, "cbc:poison_gas", pos, {});
        return;
    }
    if (munitionId === "ap_autocannon") { // сборка 62: бронебойный патрон: искры и лёгкая пыль
        spawn(dim, "cbc:shrapnel_smoke", pos, { size: 0.5 });
        if (lvl < 2)
            spawn(dim, "cbc:spark", pos, { size: 1 });
        return;
    }
    if (munitionId.startsWith("flak_aa_")) { // сборка 71: зенитный взрыв крупнее (радиус 18)
        spawn(dim, "cbc:flak_burst", pos, { size: 3 });
        if (lvl < 2)
            spawn(dim, "cbc:flak_splinter", pos, { size: 3 });
        spawn(dim, "cbc:explosion_smoke", pos, { size: 2.5 });
        if (lvl === 0)
            spawn(dim, "cbc:spark", pos, { size: 2 });
        return;
    }
    if (munitionId === "he_autocannon") { // сборка 71: фугасный патрон автопушки: радиус 6
        spawn(dim, "cbc:flak_burst", pos, { size: 2 });
        spawn(dim, "cbc:explosion_smoke", pos, { size: 2 });
        if (lvl === 0)
            spawn(dim, "cbc:spark", pos, { size: 1.5 });
        return;
    }
    if (munitionId === "flak_autocannon") { // сборка 62: флак (старый, не используется): вспышка из кадров аддона (flak_smoke0-7), осколки, дым
        spawn(dim, "cbc:flak_burst", pos, { size: 1.6 });
        if (lvl < 2)
            spawn(dim, "cbc:flak_splinter", pos, { size: 1.5 });
        spawn(dim, "cbc:explosion_smoke", pos, { size: 1.2 });
        if (lvl === 0)
            spawn(dim, "cbc:spark", pos, { size: 1.5 });
        return;
    }
    const explosive = plan.breaksBlocks || plan.radius > 1;
    if (explosive && lvl < 2)
        spawn(dim, "cbc:flash", pos, { size: size * 1.5 });
    spawn(dim, (munitionId === "shrapnel_shell" || munitionId === "ap_shot") ? "cbc:shrapnel_smoke" : "cbc:explosion_smoke", pos, { size: explosive ? size : 0.8 });
    if (lvl === 0)
        spawn(dim, "cbc:spark", pos, { size: explosive ? size : 1.5 });
}
/** Искра у лежащего снаряда с горящим взрывателем (сборка 42). */
export function fuseSpark(dim, pos) {
    if (!S.particles || degrade() >= 2)
        return;
    spawn(dim, "cbc:spark", { x: pos.x, y: pos.y + 0.2, z: pos.z }, { size: 0.5 });
}
/** След снаряда в полёте (вызывать каждый тик). */
let trailN = 0;
export function trail(dim, pos) {
    if (!S.particles || !S.trail)
        return;
    const lvl = degrade();
    if (lvl === 2 || (lvl === 1 && (trailN++ & 1) === 1))
        return; // при нагрузке след рисуем через тик, при критичной не рисуем
    spawn(dim, "cbc:trail_smoke", pos);
}
const SHAKE_RANGE = 32;
/** Тряска экрана у игроков рядом: сила растёт с числом зарядов и падает с расстоянием. TODO-VERIFY: Entity.runCommand("camerashake ..."). */
export function shake(dim, pos, power) {
    if (!S.shake)
        return;
    const lvl = degrade();
    if (lvl === 2)
        return;
    try {
        for (const pl of dim.getPlayers({ location: pos, maxDistance: SHAKE_RANGE })) {
            const d = Math.hypot(pl.location.x - pos.x, pl.location.y - pos.y, pl.location.z - pos.z);
            const k = Math.max(0, 1 - d / SHAKE_RANGE);
            const intensity = Math.min(1.5, (0.3 + 0.25 * Math.max(1, power)) * k) * (lvl === 1 ? 0.5 : 1);
            if (intensity < 0.03)
                continue;
            try {
                pl.runCommand(`camerashake add @s ${intensity.toFixed(2)} ${(0.35 + 0.1 * Math.max(1, power)).toFixed(2)} positional`);
            }
            catch { /* команда недоступна */ }
        }
    }
    catch { /* getPlayers недоступен */ }
}
