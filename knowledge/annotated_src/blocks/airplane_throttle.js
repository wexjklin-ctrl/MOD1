/* CLAUDE-MAP-BEGIN
 FILE: blocks/airplane_throttle.js  (5 KB, 96 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: @minecraft/server, @minecraft/server-ui, blocks/airplane_math.js
 IMPORTED BY: blocks/airplane_flight.js, main.js
 EXPORTS: registerAirplaneThrottle, showAirplaneThrottle, setAirplaneVisualAngles
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): showAirplaneThrottle@14(46L); setAirplaneVisualAngles@61(35L); registerAirplaneThrottle@5(8L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { world, system } from "@minecraft/server";
import { CustomForm, ObservableNumber, ObservableBoolean } from "@minecraft/server-ui";
import { AIRPLANE_THROTTLE, ROLL_STATE, ACTIVE_STATE, clamp } from "./airplane_math.js";

export function registerAirplaneThrottle(registry) {
  registry.registerCustomComponent("create_physics:airplane_throttle_interact", {
    onPlayerInteract({ block, player }) {
      if (!block || !player) return;
      system.run(() => { try { player.sendMessage("§7Пульт управления башни: поставьте его в конструкцию, приклеенную к Башне конструкции, и соберите её"); } catch {} });
    }
  });
}

export async function showAirplaneThrottle(player, session, throttle, persist = () => {}) {
  let input, subscription, pitch, pitchSubscription, engine, engineSubscription;
  try {
    input = new ObservableNumber(clamp(Number(throttle.permutation.getState(ROLL_STATE)) || 0, -3, 3), { clientWritable: true });
    pitch = new ObservableNumber(Number(throttle.permutation.getState("create_physics:airplane_pitch")) || 0, { clientWritable: true });
    engine = new ObservableBoolean(throttle.permutation.getState("create_physics:propeller_on") === true, { clientWritable: true });
    const apply = () => {
      const value = clamp(Math.round(input.getData()), -3, 3);
      if (session && !session.assembly?.isValid) return;
      const permutation = throttle.permutation.withState(ROLL_STATE, value).withState(ACTIVE_STATE, true)
        .withState("create_physics:airplane_pitch", clamp(Math.round(pitch.getData()), -7, 7))
        .withState("create_physics:flight_mode", pitch.getData() > 0 || throttle.permutation.getState("create_physics:flight_mode") === true)
        .withState("create_physics:propeller_on", engine.getData() === true);
      if (session) {
        for (const other of session.snapshots) {
          if (other.typeId === AIRPLANE_THROTTLE && other !== throttle) {
            other.permutation = other.permutation.withState(ACTIVE_STATE, false);
          }
        }
        throttle.permutation = permutation;
        session.assembly.body.wakeUp();
        persist(session);
      } else {
        if (throttle.typeId !== AIRPLANE_THROTTLE) return;
        throttle.setPermutation(permutation);
      }
    };
    subscription = input.subscribe(apply);
    pitchSubscription = pitch.subscribe(apply);
    engineSubscription = engine.subscribe(apply);
    const form = new CustomForm(player, "Airplane Controls");
    form.label(session ? "Enable the propellers to accelerate and take off. Use Pitch to control climbing and descending."
      : "Activate physics to fly.");
    form.slider("Left / Right", input, -3, 3, { step: 1 });
    form.slider("Pitch down / Pitch up", pitch, -7, 7, { step: 1 });
    form.toggle("Enable propellers", engine);
    await form.show();
    apply();
  } catch (error) {
    console.warn(`[Create Physics] airplane_throttle: ${error?.stack ?? error}`);
  } finally {
    if (input && subscription) input.unsubscribe(subscription);
    if (pitch && pitchSubscription) pitch.unsubscribe(pitchSubscription);
    if (engine && engineSubscription) engine.unsubscribe(engineSubscription);
  }
}

export function setAirplaneVisualAngles(session, angles) {
  const anchor = session.assembly.visualAnchor ?? { x: 0, y: 0, z: 0 };
  const pitchAngles = new Map(session.snapshots.filter(s => s.typeId === AIRPLANE_THROTTLE).map(s => [
    ["x","y","z"].map(axis => s.location[axis]-session.location[axis]).join(","),
    clamp(Number(s.permutation.getState("create_physics:airplane_pitch")) || 0,-7,7) / 7 * 30
  ]));
  // Cache only the control entities; do not resolve every structural block each tick.
  const ids = session.assembly.visualEntityIds;
  session.airplaneVisualAudit = (session.airplaneVisualAudit ?? 0) + 1;
  if (session.airplaneVisualBlocks !== session.assembly.blocks || session.airplaneVisualCount !== ids.length || session.airplaneVisualAudit >= 20) {
    session.airplaneVisualBlocks = session.assembly.blocks;
    session.airplaneVisualCount = ids.length;
    session.airplaneVisualAudit = 0;
    session.airplaneControlVisuals = [];
    for (const id of ids) {
      try {
        const entity = world.getEntity(id);
        if (entity?.isValid && [AIRPLANE_THROTTLE, "create_physics:airplane_wing_control"].includes(entity.typeId)) session.airplaneControlVisuals.push({id,entity});
      } catch {}
    }
  }
  for (const {id,entity} of session.airplaneControlVisuals) {
    try {
      if (!entity?.isValid) continue;
      const local = session.assembly.getVisualBlock(id)?.localLocation;
      const key = ["x", "y", "z"].map(axis => local?.[axis] ?? Math.round(entity.getProperty(`create_physics:local_${axis}`) + anchor[axis])).join(",");
      const angle = angles.get(key) ?? 0;
      if (entity.getProperty("create_physics:airplane_angle") !== angle) entity.setProperty("create_physics:airplane_angle", angle);
      if (entity.typeId === AIRPLANE_THROTTLE) {
        const pitchAngle = pitchAngles.get(key) ?? 0;
        if (entity.getProperty("create_physics:airplane_pitch_angle") !== pitchAngle) entity.setProperty("create_physics:airplane_pitch_angle",pitchAngle);
      }
    } catch {}
  }
}
