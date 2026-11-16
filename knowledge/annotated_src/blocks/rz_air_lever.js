/* CLAUDE-MAP-BEGIN
 FILE: blocks/rz_air_lever.js  (3 KB, 58 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (auto, from first comment) RZ Lite: рычаг тяги самолёта (блок create_physics:throttle_lever на конструкции RZ).
 IMPORTS: @minecraft/server, blocks/physics_performance.js, blocks/vehicle_systems.js
 IMPORTED BY: main.js
 EXPORTS: rzLeverInteract, stepRzAirLever
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): stepRzAirLever@30(28L); rzLeverInteract@15(8L); release@24(4L); clamp@11(1L); leverOf@12(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// RZ Lite: рычаг тяги самолёта (блок create_physics:throttle_lever на конструкции RZ).
// Нажать на рычаг - взяться за него, двигать камерой вверх (тяга больше) / вниз (меньше), нажать ещё раз или присесть - отпустить.
// Значение 0..1 хранится в session.rzAirCtl.lever (нет значения = 1, как до появления рычага); множитель тяги берёт rzFlight (airplane_flight.js).
// Рычаг на экране поворачивает create_physics:throttle_power (0..128, анимация RP: (power-64)*0.546875 градуса). НЕ проверено в игре.
import { world, system } from "@minecraft/server";
import { vehicleSystems } from "./vehicle_systems.js";
import { assemblyVisualEntitiesOfType, physicsSnapshotsOfType, setPhysicsVisualProperty } from "./physics_performance.js";

const LEVER = "create_physics:throttle_lever";
const LOOK_RANGE = 50;   // градусов поворота камеры на весь ход рычага
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const leverOf = session => session.rzAirCtl?.lever ?? 1;

/** Нажатие на рычаг: взяться / отпустить. */
export function rzLeverInteract(player, session) {
  const grab = session.rzLeverGrab;
  if (grab?.id === player.id) { release(session, player, true); return; }
  const ctl = session.rzAirCtl ??= { roll: 0, pitch: 0, on: false, fr: 0, fp: 0 };
  if (ctl.lever === undefined) ctl.lever = 1;
  session.rzLeverGrab = { id: player.id, pitch: player.getRotation().x };
  try { player.onScreenDisplay.setActionBar(`§eРычаг тяги: ${Math.round(ctl.lever * 100)}%  §7(камера вверх/вниз, ещё раз - отпустить)`); } catch {}
}

function release(session, player, say) {
  session.rzLeverGrab = undefined;
  if (say) try { player?.onScreenDisplay.setActionBar(`§7Рычаг отпущен: тяга ${Math.round(leverOf(session) * 100)}%`); } catch {}
}

/** Раз в тик: ведёт рычаг за камерой игрока и крутит визуал. */
export function stepRzAirLever(sessions, tick) {
  for (const session of sessions) {
    try {
      if (!session.assembly?.isValid || !vehicleSystems(session).rzAir) { session.rzLeverGrab = undefined; continue; }
      if (!physicsSnapshotsOfType(session, LEVER).length) { session.rzLeverGrab = undefined; continue; }
      const grab = session.rzLeverGrab;
      if (grab) {
        const player = world.getAllPlayers().find(p => p.id === grab.id);
        if (!player?.isValid || player.isSneaking) { release(session, player, !!player?.isValid); }
        else {
          const ctl = session.rzAirCtl ??= { roll: 0, pitch: 0, on: false, fr: 0, fp: 0 };
          const pitch = player.getRotation().x;                    // -90 вверх .. +90 вниз
          const next = clamp(leverOf(session) - (pitch - grab.pitch) / LOOK_RANGE, 0, 1);
          grab.pitch = pitch;
          if (next !== ctl.lever) {
            ctl.lever = next;
            if (ctl.on) session.assembly.body.wakeUp();
            if (tick % 2 === 0) try { player.onScreenDisplay.setActionBar(`§eТяга: ${Math.round(next * 100)}%`); } catch {}
          }
        }
      }
      const power = leverOf(session) * 128;
      for (const entity of assemblyVisualEntitiesOfType(session.assembly, LEVER, world, tick)) {
        try { setPhysicsVisualProperty(entity, "create_physics:throttle_power", power, tick); } catch {}
      }
    } catch {}
  }
}
