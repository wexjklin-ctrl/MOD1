/* CLAUDE-MAP-BEGIN
 FILE: cbc/perf.js  (3 KB, 75 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (auto, from first comment) Мониторинг TPS без постоянных таймеров: замеры берутся из циклов, которые и так работают (полёт снарядов, опрос заряженных пушек).
 IMPORTS: @minecraft/server, cbc/settings.js
 IMPORTED BY: cbc/admin.js, cbc/casings.js, cbc/effects.js, cbc/projectiles.js, cbc/world.js
 EXPORTS: classify, sampleTps, measureTps, tpsInfo, slowFactor, degrade
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): sampleTps@29(16L); classify@11(11L); measureTps@46(11L); record@22(6L); slowFactor@65(6L); tpsInfo@60(4L); currentMode@57(3L); degrade@72(3L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// Мониторинг TPS без постоянных таймеров: замеры берутся из циклов, которые и так работают (полёт снарядов, опрос заряженных пушек).
// Нет снарядов и заряженных пушек = нет замеров и нет накладных расходов; данные «свежие» 10 секунд, потом считаем, что всё в норме.
// Режимы: 0 норма (TPS >= loadBelow), 1 нагрузка (criticalBelow <= TPS < loadBelow), 2 критично (TPS < criticalBelow). Гистерезис 1 TPS.
import { system } from "@minecraft/server";
import { S } from "./settings.js";
const FRESH_TICKS = 200; // 10 с
const WINDOW_TICKS = 20; // окно замера: 1 с
let wTick, wMs;
let tps = 20, mode = 0, lastSample = -1e9;
/** Режим по TPS с гистерезисом (чистая функция). */
export function classify(value, prevMode, loadBelow, criticalBelow) {
    if (value < criticalBelow)
        return 2;
    if (prevMode === 2 && value < criticalBelow + 1)
        return 2;
    if (value < loadBelow)
        return 1;
    if (prevMode >= 1 && value < loadBelow + 1)
        return 1;
    return 0;
}
function record(value, smooth) {
    const fresh = system.currentTick - lastSample < FRESH_TICKS;
    tps = smooth && fresh ? tps * 0.5 + value * 0.5 : value;
    mode = classify(tps, fresh ? mode : 0, S.loadBelow, S.criticalBelow);
    lastSample = system.currentTick;
}
/** Вызывать из любого регулярно работающего цикла. Дёшево: вне момента замера только сравнение двух чисел. */
export function sampleTps() {
    const t = system.currentTick;
    if (wTick === undefined || t - wTick > 100) {
        wTick = t;
        wMs = Date.now();
        return;
    }
    if (t - wTick < WINDOW_TICKS)
        return;
    const ms = Date.now();
    const sec = (ms - wMs) / 1000;
    if (sec > 0)
        record(Math.min(20, (t - wTick) / sec), true);
    wTick = t;
    wMs = ms;
}
/** Замер «сейчас» за `ticks` тиков (кнопка в меню). */
export function measureTps(ticks = 40) {
    return new Promise((resolve) => {
        const t0 = system.currentTick, m0 = Date.now();
        system.runTimeout(() => {
            const sec = (Date.now() - m0) / 1000, dt = system.currentTick - t0;
            const v = sec > 0 ? Math.min(20, dt / sec) : 20;
            record(v, false);
            resolve(v);
        }, ticks);
    });
}
function currentMode() {
    return system.currentTick - lastSample < FRESH_TICKS ? mode : 0;
}
export function tpsInfo() {
    const fresh = system.currentTick - lastSample < FRESH_TICKS;
    return { tps: fresh ? tps : undefined, mode: fresh ? mode : 0 };
}
/** Доля тиков, на которых снаряд движется (1 = полная скорость). */
export function slowFactor() {
    if (!S.tpsGuard)
        return 1;
    const m = currentMode();
    return m === 0 ? 1 : (m === 1 ? S.slowLoad : S.slowCritical) / 100;
}
/** Уровень урезания эффектов: 0 всё, 1 меньше, 2 минимум. */
export function degrade() {
    return S.tpsGuard ? currentMode() : 0;
}
