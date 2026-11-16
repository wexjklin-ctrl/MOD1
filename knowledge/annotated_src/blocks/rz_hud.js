/* CLAUDE-MAP-BEGIN
 FILE: blocks/rz_hud.js  (3 KB, 70 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (auto, from first comment) RZ HUD — пакет данных для кастомного интерфейса (resource pack: ui/rz_hud.json).
 IMPORTS: @minecraft/server
 IMPORTED BY: blocks/rz_drive.js
 EXPORTS: hudPacket, sendHud, installRzHud
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): hudPacket@29(18L); installRzHud@59(11L); bar@19(6L); sendHud@51(6L); clampI@16(1L); num@18(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// RZ HUD — пакет данных для кастомного интерфейса (resource pack: ui/rz_hud.json).
// Данные уходят в title-канал строкой фиксированной длины "rzhud:..." (101 символ), интерфейс режет её по смещениям.
// ВАЖНО: порядок и ширины полей должны совпадать с make_ui.py (spec) — см. таблицу ниже.
//   mode(1) spd(3) alt(4) scale(3) fuel(3) temp(3) thr(3) gear(1)
//   флаги по 1 символу ('y'/'n'): hasFuel hasTemp noEngine fuelEmpty fuelLow overheat hot limit thin
//                                 stallAero stallCeil brake airborne shallow
//   шкалы 'y'/'n': speed(30) fuel(10) temp(10) thr(10)
// Числа дополняются слева символом 'x' (= пусто), чтобы интерфейс скрывал ведущие нули.

import { system } from "@minecraft/server";

const PREFIX = "rzhud:";
const FLAG_ORDER = ["hasFuel", "hasTemp", "noEngine", "fuelEmpty", "fuelLow", "overheat", "hot", "limit", "thin",
  "stallAero", "stallCeil", "brake", "airborne", "shallow"];

const clampI = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? v : 0)));
// цифры кодируются буквами a..j (0..9), пустой разряд = "x"
const num = (v, w, max) => String(clampI(v, 0, max)).replace(/\d/g, d => "abcdefghij"[d]).padStart(w, "x");
function bar(frac, n) {
  const f = Number.isFinite(frac) ? Math.max(0, Math.min(1, frac)) : 0;
  let k = Math.round(f * n);
  if (k === 0 && f > 0.02) k = 1;
  return "y".repeat(k) + "n".repeat(n - k);
}

/**
 * h: { mode: "c"|"a"|"b", kmh, alt, scale, fuelFrac, heat, thr, gear: "D"|"R"|"N"|"A", flags: {...}, }
 */
export function hudPacket(h) {
  const f = h.flags ?? {};
  let s = PREFIX;
  s += h.mode;
  s += num(h.kmh, 3, 999);
  s += num(h.alt, 4, 9999);
  s += num(h.scale, 3, 999);
  s += num((h.fuelFrac ?? 0) * 100, 3, 100);
  s += num((h.heat ?? 0) * 100, 3, 100);
  s += num((h.thr ?? 0) * 100, 3, 100);
  s += h.gear;
  for (const k of FLAG_ORDER) s += f[k] ? "y" : "n";
  s += bar(h.scale > 0 ? h.kmh / h.scale : 0, 30);
  s += bar(h.fuelFrac ?? 0, 10);
  s += bar(h.heat ?? 0, 10);
  s += bar(h.thr ?? 0, 10);
  return s;
}

const active = new Map();   // id игрока -> { p, t } — кому сейчас показан HUD

/** Шлёт HUD игроку. Клиент сам HUD не гасит (строка title остаётся), поэтому ниже интервал шлёт "rzoff", когда обновления прекратились. */
export function sendHud(player, h) {
  try {
    player.onScreenDisplay.setTitle(hudPacket(h), { fadeInDuration: 0, stayDuration: 20, fadeOutDuration: 0 });
    active.set(player.id, { p: player, t: system.currentTick });
  } catch { /* игрок вышел */ }
}

let started = false;
export function installRzHud() {
  if (started) return; started = true;
system.runInterval(() => {
  const now = system.currentTick;
  for (const [id, e] of active) {
    if (now - e.t <= 8) continue;
    active.delete(id);
    try { e.p.onScreenDisplay.setTitle("rzoff", { fadeInDuration: 0, stayDuration: 1, fadeOutDuration: 0 }); } catch { /* вышел */ }
  }
}, 4);
}
