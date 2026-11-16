/* CLAUDE-MAP-BEGIN
 FILE: blocks/rz_rot.js  (4 KB, 57 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (auto, from first comment) RZ Lite: гниение обломков (RZ core/coreBlock.js: «растворение обломков»), максимально дёшево.
 IMPORTS: @minecraft/server
 IMPORTED BY: main.js
 EXPORTS: ROT, rzHasCore, rzRotActive, rzRotMark, stepRzRot, installRzRot
 EVENTS: scriptEventReceive
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): installRzRot@39(18L); stepRzRot@27(10L); rzRotMark@21(4L); rzHasCore@17(1L); rzRotActive@18(1L); save@38(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// RZ Lite: гниение обломков (RZ core/coreBlock.js: «растворение обломков»), максимально дёшево.
// Правило как в RZ: если у конструкции было ядро (phys:core) и от неё отломился кусок БЕЗ ядра, этот кусок - обломок: он темнеет
// в 3 стадии и исчезает без выпадения блоков (содержимое сундуков выпадает). Кусок с ядром остаётся машиной.
// Если ядра в конструкции вообще нет (старые постройки, ядро снято игроком), ничего не гниёт.
// Нагрузка: разделение на куски делает уже существующий splitDisconnectedPhysicsControllerSession (по событию, а не по тикам);
// здесь только таблица обломков, которая в тике пуста (проверка размера Map), и 3 смены вида блоков обломка (потемнение) за всё время жизни.
import { world, system } from "@minecraft/server";

export const ROT = {
  ON: 1,            // 1 = обломки без ядра гниют, 0 = как раньше (куски остаются)
  STAGE_TICKS: 14,  // длительность стадии, как DEBRIS.STAGE_TICKS в RZ (3 стадии + пауза = 4 * STAGE_TICKS до удаления)
  SMOKE_POINTS: 4   // (не используется, оставлено для совместимости настроек)
};
const PROP_KEY = "rzlite:rot";
const dying = new Map();   // session -> { t0, stage }

export const rzHasCore = (snapshots, coreId) => snapshots.some(s => s?.typeId === coreId);
export const rzRotActive = session => dying.has(session);

/** Поставить обломок на гниение (повторный вызов ничего не делает). */
export function rzRotMark(session, tick) {
  if (!ROT.ON || dying.has(session)) return;
  dying.set(session, { t0: tick, stage: 0 });
}

/** Раз в тик. services = { smoke(session, stage, points), finish(session) }. При пустой таблице - одна проверка размера. */
export function stepRzRot(tick, services) {
  if (dying.size === 0) return;
  for (const [session, e] of [...dying]) {
    if (!session.assembly?.isValid) { dying.delete(session); continue; }
    const elapsed = tick - e.t0;
    const stage = Math.min(3, Math.floor(elapsed / ROT.STAGE_TICKS) + 1);
    if (stage > e.stage) { e.stage = stage; try { services.smoke(session, stage, ROT.SMOKE_POINTS); } catch {} }
    if (elapsed >= ROT.STAGE_TICKS * 4) { dying.delete(session); try { services.finish(session); } catch {} }
  }
}

const save = () => { try { world.setDynamicProperty(PROP_KEY, JSON.stringify({ on: ROT.ON ? 1 : 0, st: ROT.STAGE_TICKS })); } catch {} };
export function installRzRot() {
  try {
    system.run(() => {
      try {
        const raw = world.getDynamicProperty(PROP_KEY);
        if (typeof raw === "string") { const o = JSON.parse(raw); if (o?.on === 0 || o?.on === 1) ROT.ON = o.on; if (Number.isFinite(o?.st) && o.st >= 1) ROT.STAGE_TICKS = o.st; }
      } catch {}
    });
    system.afterEvents.scriptEventReceive.subscribe(ev => {
      if (ev.id !== "rzlite:rot") return;
      const reply = m => { try { (ev.sourceEntity ?? world).sendMessage?.(m); } catch {} };
      const a = ev.message.trim().toLowerCase().split(/\s+/);
      if (a[0] === "on" || a[0] === "off") { ROT.ON = a[0] === "on" ? 1 : 0; save(); reply(`[rot] ${ROT.ON ? "обломки без ядра гниют" : "гниение выключено"}`); }
      else if (a[0] === "stage" && Number(a[1]) >= 1) { ROT.STAGE_TICKS = Math.floor(Number(a[1])); save(); reply(`[rot] стадия ${ROT.STAGE_TICKS} тиков, весь обломок живёт ${ROT.STAGE_TICKS * 4} тиков`); }
      else reply(`[rot] ON=${ROT.ON} STAGE_TICKS=${ROT.STAGE_TICKS}, сейчас гниёт: ${dying.size}. Команды: on | off | stage <тики>`);
    });
  } catch {}
}
