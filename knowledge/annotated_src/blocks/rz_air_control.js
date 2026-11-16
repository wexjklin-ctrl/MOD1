/* CLAUDE-MAP-BEGIN
 FILE: blocks/rz_air_control.js  (8 KB, 107 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (auto, from first comment) RZ Lite: управление самолётом как в RZ. Пилот сидит в кресле конструкции и ведёт самолёт клавишами:
 IMPORTS: @minecraft/server, blocks/rz_air_mode.js, blocks/rz_air_rig.js, blocks/rz_flap_pose.js, blocks/vehicle_systems.js
 IMPORTED BY: main.js
 EXPORTS: stepRzAirControl, installRzAirControl
 EVENTS: scriptEventReceive
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): stepRzAirControl@23(67L); installRzAirControl@91(16L); clamp@19(1L); setJump@20(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// RZ Lite: управление самолётом как в RZ. Пилот сидит в кресле конструкции и ведёт самолёт клавишами:
//   W / S  - тангаж (W = нос вниз, S = нос вверх), A / D - крен, Прыжок - включить / выключить тягу (двигатель и винты).
// Клавиши записываются в состояния блока «газ самолёта» CM (airplane_roll -3..3, airplane_pitch -7..7, propeller_on),
// поэтому дальше самолёт летит по полётной модели CreateMovement. Форма со слайдерами CM остаётся рабочей.
// Самолёт RZ: ввод идёт в модель полёта RZ (rz_air_rig.js) как в RZ - W/S тангаж и A/D крен без округления, пробел - тяга 0/1, без пилота тяга гаснет.
// Команды: /scriptevent rzlite:air roll_inv | pitch_inv | thrust_inv | prop_inv | force_scale <число|auto> | status. НЕ проверено в игре.
import { system, world, InputButton, ButtonState, InputPermissionCategory } from "@minecraft/server";
import { vehicleSystems } from "./vehicle_systems.js";
import { AIRCFG } from "./rz_air_mode.js";
import { RZ_AIR_LITE } from "./rz_air_rig.js";
import { FLAP_CFG } from "./rz_flap_pose.js";

const THROTTLE = "create_physics:airplane_throttle";
const ROLL = "create_physics:airplane_roll", PITCH = "create_physics:airplane_pitch", ON = "create_physics:propeller_on";
const ACTIVE = "create_physics:airplane_active", FLIGHT = "create_physics:flight_mode";
const CFG = { ROLL_INV: false, PITCH_INV: false };
const jumpLocked = new Map();   // id игрока -> Player
const jumpPrev = new Map();     // id игрока -> была ли нажата кнопка в прошлый тик
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const setJump = (p, allowed) => { try { p.inputPermissions.setPermissionCategory(InputPermissionCategory.Jump, allowed); } catch {} };

/** Раз в тик. pilotOf(session) -> игрок, сидящий в креслах конструкции (или undefined). */
export function stepRzAirControl(sessions, pilotOf, tick) {
  const now = new Map();
  for (const session of sessions) {
    try {
      if (!session.assembly?.isValid) continue;
      const throttles = [];   // шаг 147: пульт - теперь пульт башни; раньше он считался газом самолёта, забирал W/A/D/прыжок и ломал езду танка
      const rzAir = throttles.length === 0 && vehicleSystems(session).rzAir;   // самолёт RZ: блока газа нет, управление с кресла
      if (throttles.length === 0 && !rzAir) continue;
      const pilot = pilotOf(session);
      if (!pilot) {   // RZ: без пилота тяга гаснет, ручка в ноль
        if (rzAir) { session.rzAirPilotId = undefined; const c = session.rzAirCtl; if (c) { c.roll = 0; c.pitch = 0; c.fr = 0; c.fp = 0; c.on = false; } }
        else {   // самолёт с блоком газа: пилот вышел - через секунду тяга гаснет (двигатель не гудит, HUD не горит)
          session.rzNoPilot = (session.rzNoPilot ?? 0) + 1;
          if (session.rzNoPilot === 20) {
            let changed = false;
            for (const o of throttles) if (o.permutation.getState(ON) === true || o.permutation.getState(ACTIVE) === true) { o.permutation = o.permutation.withState(ON, false).withState(ACTIVE, false); changed = true; }
            if (changed) session.assembly.body.wakeUp();
          }
        }
        continue;
      }
      now.set(pilot.id, pilot);
      session.rzNoPilot = 0;
      const throttle = rzAir ? undefined : (throttles.find(s => s.permutation.getState(ACTIVE) === true) ?? throttles[0]);
      const mv = pilot.inputInfo.getMovementVector();            // x > 0 = влево (A), y > 0 = вперёд (W)
      const sx = Math.abs(mv.x) < 0.05 ? 0 : clamp(mv.x, -1, 1), sy = Math.abs(mv.y) < 0.05 ? 0 : clamp(mv.y, -1, 1);
      const roll = Math.round(clamp((CFG.ROLL_INV ? sx : -sx) * 3, -3, 3));
      const pitch = Math.round(clamp((CFG.PITCH_INV ? sy : -sy) * 7, -7, 7));   // W = нос вниз (отрицательный тангаж)
      const jump = pilot.inputInfo.getButtonState(InputButton.Jump) === ButtonState.Pressed;
      const wasJump = jumpPrev.get(pilot.id) === true;
      jumpPrev.set(pilot.id, jump);
      if (rzAir) {   // RZ Lite: состояние управления хранится в сессии; пробел заводит/глушит винт
        const ctl = session.rzAirCtl ??= { roll: 0, pitch: 0, on: false, fr: 0, fp: 0 };
        session.rzAirPilotId = pilot.id;
        // как в RZ (airCommands): W = нос вниз (pitch -1), S = нос вверх, D = крен вправо; значения без округления
        const fr = CFG.ROLL_INV ? sx : -sx, fp = CFG.PITCH_INV ? sy : -sy;
        const on = jump && !wasJump ? !ctl.on : ctl.on;
        const changed = ctl.fr !== fr || ctl.fp !== fp || ctl.on !== on;
        ctl.fr = fr; ctl.fp = fp; ctl.roll = roll; ctl.pitch = pitch;
        if (on !== ctl.on) {
          ctl.on = on;
          try { const ld = session.rzRig?.load ?? 0;
            const pct = Math.round(ld * 100);
            pilot.onScreenDisplay.setActionBar(!on ? "§7Винт остановлен" : ld > 1.6 ? `§cВинт не потянет: нагрузка ${pct}%` : ld > 1 ? `§eВинт запущен, перегруз ${pct}%: слабая тяга и скорость` : `§aВинт запущен §7(нагрузка ${pct}%)`); } catch {}
        }
        if (changed) session.assembly.body.wakeUp();
        continue;
      }
      const engine = throttle.permutation.getState(ON) === true;
      const nextEngine = jump && !wasJump ? !engine : engine;
      const same = Number(throttle.permutation.getState(ROLL)) === roll && Number(throttle.permutation.getState(PITCH)) === pitch &&
        nextEngine === engine && throttle.permutation.getState(ACTIVE) === true;
      if (same) continue;
      for (const o of throttles) if (o !== throttle && o.permutation.getState(ACTIVE) === true) o.permutation = o.permutation.withState(ACTIVE, false);
      throttle.permutation = throttle.permutation.withState(ROLL, roll).withState(PITCH, pitch).withState(ON, nextEngine)
        .withState(ACTIVE, true).withState(FLIGHT, pitch > 0 || throttle.permutation.getState(FLIGHT) === true);
      session.assembly.body.wakeUp();
      if (nextEngine !== engine) { try { pilot.onScreenDisplay.setActionBar(nextEngine ? "§aТяга включена" : "§7Тяга выключена"); } catch {} }
    } catch {}
  }
  // прыжок за штурвалом не должен выкидывать из кресла: пока игрок пилот, Jump как действие отключён
  for (const [id, p] of now) {
    if (!jumpLocked.has(id)) { jumpLocked.set(id, p); setJump(p, false); }
    else if (tick % 40 === 0) setJump(p, false);
  }
  for (const [id, p] of jumpLocked) if (!now.has(id)) { jumpLocked.delete(id); jumpPrev.delete(id); setJump(p, true); }
}

export function installRzAirControl() {
  try {
    system.afterEvents.scriptEventReceive.subscribe(ev => {
      if (ev.id !== "rzlite:air") return;
      const reply = m => { try { (ev.sourceEntity ?? world).sendMessage?.(m); } catch {} };
      const a = ev.message.trim().toLowerCase();
      if (a === "roll_inv") { CFG.ROLL_INV = !CFG.ROLL_INV; reply(`[air] ROLL_INV = ${CFG.ROLL_INV}`); }
      else if (a === "pitch_inv") { CFG.PITCH_INV = !CFG.PITCH_INV; reply(`[air] PITCH_INV = ${CFG.PITCH_INV}`); }
      else if (a === "thrust_inv") { AIRCFG.THRUST_INV = !AIRCFG.THRUST_INV; reply(`[air] THRUST_INV = ${AIRCFG.THRUST_INV} (сломайте и поставьте винт или пересоберите конструкцию)`); }
      else if (a.startsWith("force_scale")) { const v = a.split(/\s+/)[1]; RZ_AIR_LITE.SCALE = v === undefined || v === "auto" ? 0 : Math.max(0.05, Number(v) || 0); reply(`[air] множитель сил RZ = ${RZ_AIR_LITE.SCALE || "авто (масса Lite / масса RZ * g)"}`); }
      else if (a === "flap_inv") { FLAP_CFG.INV = !FLAP_CFG.INV; reply(`[air] FLAP_INV = ${FLAP_CFG.INV} (рули качаются в другую сторону)`); }
      else if (a === "prop_inv") { AIRCFG.PROP_INV = !AIRCFG.PROP_INV; reply(`[air] PROP_INV = ${AIRCFG.PROP_INV}`); }
      else reply(`[air] W/S тангаж, A/D крен, Прыжок - тяга. ROLL_INV=${CFG.ROLL_INV} PITCH_INV=${CFG.PITCH_INV}. Команды: roll_inv | pitch_inv`);
    });
  } catch {}
}
