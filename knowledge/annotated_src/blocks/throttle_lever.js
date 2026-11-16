/* CLAUDE-MAP-BEGIN
 FILE: blocks/throttle_lever.js  (5 KB, 84 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: @minecraft/server, @minecraft/server-ui, blocks/physics_performance.js
 IMPORTED BY: blocks/index.js
 EXPORTS: THROTTLE_LEVER_BLOCK_ID, THROTTLE_LEVER_ENTITY_ID, showThrottleLeverControl, syncThrottleLeverEntities
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): showThrottleLeverControl@14(57L); syncThrottleLeverEntities@72(12L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { world, system } from "@minecraft/server";
import { assemblyVisualEntitiesOfType, physicsSnapshotsOfType, setPhysicsVisualProperty } from "./physics_performance.js";
import { CustomForm, ObservableNumber } from "@minecraft/server-ui";

export const THROTTLE_LEVER_BLOCK_ID = "create_physics:throttle_lever";
export const THROTTLE_LEVER_ENTITY_ID = "create_physics:throttle_lever";

// шаг 134/136: на шаре рычаг задаёт тягу винта (вперёд/назад) и руль; высоту по-прежнему задаёт горелка.
// Тяга хранится в propellerSpeed/propellerEnabled винтов (0..32) и propellerReverse (назад).
const PROPELLER_ID = "create_physics:andesite_propeller";
// шаг 135: Guiding Wind на шаре/дирижабле - постоянный руль. Угол (-50..50) хранится в guidingWindAngle блоков Guiding Wind
// и держится, пока рычаг не переставят: конструкция всё время поворачивает (applyGuidingWindHullTurn). Самолёты не затронуты.
const GUIDING_WIND_ID = "create_physics:guiding_wind";
export async function showThrottleLeverControl(player, session, services) {
  const propellers = session.snapshots.filter((snapshot) => snapshot.typeId === PROPELLER_ID);
  const winds = session.snapshots.filter((snapshot) => snapshot.typeId === GUIDING_WIND_ID);
  if (propellers.length === 0 && winds.length === 0) {
    try { player.sendMessage("§eНа этой конструкции нет винта для шаров и блока Guiding Wind."); } catch {}
    return;
  }
  let thrust;
  let rudder;
  let thrustSub;
  let rudderSub;
  try {
    // шаг 136: один рычаг. Газ -100..100: плюс - винт толкает вперёд, минус - назад (0 - стоп).
    // Руль -50..50 (Guiding Wind): корпус разворачивается постепенно, пока конструкция идёт вперёд или назад.
    const first = propellers[0];
    const current = first && first.propellerEnabled === true ? Math.round((Number(first.propellerSpeed) || 0) / 32 * 100) * (first.propellerReverse === true ? -1 : 1) : 0;
    thrust = new ObservableNumber(Math.max(-100, Math.min(100, current)), { clientWritable: true });
    let previous = current;
    rudder = new ObservableNumber(Math.max(-50, Math.min(50, Math.round(Number(winds[0]?.guidingWindAngle) || 0))), { clientWritable: true });
    const apply = () => {
      if (!session.assembly?.isValid) return;
      if (winds.length) {
        const angle = Math.max(-50, Math.min(50, Math.round(rudder.getData())));
        for (const wind of winds) { wind.guidingWindCurrentAngle ??= 0; wind.guidingWindAngle = angle; }
      }
      const value = Math.max(-100, Math.min(100, Math.round(thrust.getData())));
      const speed = Math.round(Math.abs(value) / 100 * 32);
      if (value !== previous) {
        try { player.playSound("random.click", {volume:0.25,pitch:Math.abs(value) > Math.abs(previous) ? 0.85 : 0.8}); } catch {}
        previous = value;
      }
      if (propellers.length) for (const propeller of propellers) {
        propeller.propellerEnabled = speed > 0;
        propeller.propellerSpeed = speed;
        propeller.propellerReverse = value < 0;
      }
      session.assembly.body.wakeUp();
      syncThrottleLeverEntities([session], services);
      services.persistSession(session);
    };
    thrustSub = thrust.subscribe(apply);
    rudderSub = rudder.subscribe(apply);
    const form = new CustomForm(player, "Рычаг тяги шара");
    if (propellers.length) form.slider("Газ: назад ← 0 → вперёд, %", thrust, -100, 100, { step: 5, description: "Нужен подключённый двигатель. Вперёд до 10 км/ч, назад медленнее." });
    else form.label("Винта для шаров нет: доступен только руль.");
    if (winds.length) form.slider("Руль (Guiding Wind), °", rudder, -50, 50, { step: 5, description: "Поворот плавный и только на ходу: чем быстрее идёте, тем быстрее разворот. Назад поворот обратный." })
      .button("Стоп, руль по центру", () => { try { rudder.setData(0); thrust.setData(0); } catch {} });
    else form.label("Блок Guiding Wind не подключён: руля нет.");
    await form.show();
    apply();
  } catch (error) {
    try { console.warn(`[Create Physics] Falha no throttle_lever: ${error?.stack ?? error}`); } catch {}
  } finally {
    if (thrust && thrustSub) thrust.unsubscribe(thrustSub);
    if (rudder && rudderSub) rudder.unsubscribe(rudderSub);
  }
}

export function syncThrottleLeverEntities(sessions, services) {
  for (const session of sessions) {
    if (!session.assembly?.isValid || !physicsSnapshotsOfType(session,THROTTLE_LEVER_BLOCK_ID).length) continue;
    const propeller = physicsSnapshotsOfType(session,PROPELLER_ID)[0];
    const value = propeller && propeller.propellerEnabled === true ? 64 + (propeller.propellerReverse === true ? -1 : 1) * (Number(propeller.propellerSpeed) || 0) / 32 * 64 : 64;   // шаг 136: назад - стрелка ниже середины
    for (const entity of assemblyVisualEntitiesOfType(session.assembly,THROTTLE_LEVER_ENTITY_ID,world,system.currentTick)) {
      try {
        setPhysicsVisualProperty(entity,"create_physics:throttle_power",value,system.currentTick);
      } catch {}
    }
  }
}
