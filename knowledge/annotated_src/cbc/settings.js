/* CLAUDE-MAP-BEGIN
 FILE: cbc/settings.js  (3 KB, 61 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (auto, from first comment) Настройки администратора (меню /cbc:admin). Хранятся в dynamic property мира, применяются к LIMITS при загрузке.
 IMPORTS: @minecraft/server, cbc/config/overrides.js
 IMPORTED BY: cbc/admin.js, cbc/casings.js, cbc/cmMount.js, cbc/effects.js, cbc/main.js, cbc/perf.js, cbc/twin.js, cbc/world.js, core/cbcMount.js
 EXPORTS: DEFAULTS, S, loadSettings, saveSettings, resetSettings
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): loadSettings@27(20L); saveSettings@47(7L); resetSettings@55(6L); applyToLimits@21(5L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// Настройки администратора (меню /cbc:admin). Хранятся в dynamic property мира, применяются к LIMITS при загрузке.
import { system, world } from "@minecraft/server";
import { LIMITS } from "./config/overrides.js";
const KEY = "cbc:admin_settings";
export const DEFAULTS = Object.freeze({
    tpsGuard: true, // защита по TPS (замедление снарядов и урезание частиц)
    loadBelow: 18, // TPS ниже этого = «нагрузка»
    criticalBelow: 10, // TPS ниже этого = «критично»
    slowLoad: 60, // скорость снарядов при нагрузке, % (доля тиков, на которых снаряд движется)
    slowCritical: 25, // то же при критичной нагрузке, %
    maxProjectiles: LIMITS.maxProjectilesAlive,
    fireCooldown: LIMITS.fireCooldownTicks,
    maxExplosionRadius: LIMITS.maxExplosionRadius,
    particles: true, // частицы выстрела и взрыва
    trail: true, // след снаряда
    shake: true, // тряска экрана
    frozen: false, // заряженные пушки отключены (нет опроса пыли, выстрелы запрещены)
    balanceRev: 71, // сборка 71: ревизия баланса; если в мире сохранена старая, лимиты (снаряды, пауза, радиус) берутся из новых значений по умолчанию
});
export const S = { ...DEFAULTS };
function applyToLimits() {
    LIMITS.maxProjectilesAlive = S.maxProjectiles;
    LIMITS.fireCooldownTicks = S.fireCooldown;
    LIMITS.maxExplosionRadius = S.maxExplosionRadius;
}
/** Прочитать сохранённые настройки (только известные ключи с совпадающим типом). */
export function loadSettings() {
    try {
        const raw = world.getDynamicProperty(KEY);
        if (typeof raw === "string") {
            const o = JSON.parse(raw);
            const stale = o.balanceRev !== DEFAULTS.balanceRev;
            for (const k of Object.keys(DEFAULTS)) {
                if (stale && (k === "maxProjectiles" || k === "fireCooldown" || k === "maxExplosionRadius"))
                    continue; // новый баланс: старые сохранённые лимиты не перекрывают новые значения
                if (typeof o[k] === typeof DEFAULTS[k])
                    S[k] = o[k];
            }
            S.balanceRev = DEFAULTS.balanceRev;
            if (stale)
                system.run(() => saveSettings());
        }
    }
    catch { /* битые данные: остаются значения по умолчанию */ }
    applyToLimits();
}
export function saveSettings() {
    applyToLimits();
    try {
        world.setDynamicProperty(KEY, JSON.stringify(S));
    }
    catch { /* не критично */ }
}
/** Вернуть настройки по умолчанию (состояние «пушки отключены» не трогаем: у него своя кнопка). */
export function resetSettings() {
    const frozen = S.frozen;
    Object.assign(S, DEFAULTS);
    S.frozen = frozen;
    saveSettings();
}
