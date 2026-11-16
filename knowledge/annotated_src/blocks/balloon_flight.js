/* CLAUDE-MAP-BEGIN
 FILE: blocks/balloon_flight.js  (3 KB, 59 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: blocks/rz_block_mass.js, blocks/vehicle_systems.js
 IMPORTED BY: main.js
 EXPORTS: applyHotAirBalloonLift
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): applyHotAirBalloonLift@3(56L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { vehicleSystems } from "./vehicle_systems.js";
import { RZW } from "./rz_block_mass.js";
export function applyHotAirBalloonLift(sessions, services) {
  const { getHotAirBalloonPower, hotAirBalloonLiftCorrectionByBody, ropeDownwardLoadByBody } = services;
  for (const session of sessions) {
    if (!session.assembly?.isValid) continue;
    const body = session.assembly.body;
    const controlPower = getHotAirBalloonPower(session);
    if (controlPower === void 0) {
      hotAirBalloonLiftCorrectionByBody.delete(body.id);
      continue;
    }
    try {
      const targetRiseSpeed = (controlPower - 64) / 64 * 0.65;
      const verticalVelocity = body.velocity.y;
      const speedError = targetRiseSpeed - verticalVelocity;
      const desiredCorrection = Math.abs(speedError) < 0.025 ? 0 : Math.max(-0.5, Math.min(0.5, speedError * 0.5));
      const previousCorrection = hotAirBalloonLiftCorrectionByBody.get(body.id) ?? desiredCorrection;
      const speedCorrection = previousCorrection + (desiredCorrection - previousCorrection) * 0.06;
      hotAirBalloonLiftCorrectionByBody.set(body.id, speedCorrection);
      const mass = body.getMass();
      const envelopeCount = vehicleSystems(session).envelopes;
      // Payload assistance is bounded by envelope size and burner power.
      // It acts on the balloon only; the rope still transmits the actual load.
      // RZ Lite: при весах RZ грузоподъёмность не от массы самого шара (лёгкий шар с тяжёлой корзиной не поднимал бы ничего),
      // а от числа оболочек: RZW.BALLOON_ENV_LIFT массы на оболочку при полной горелке.
      const payloadCapacity = RZW.ON ? 11 * RZW.BALLOON_ENV_LIFT * Math.min(envelopeCount, 64) * controlPower / 128
        : mass * 11 * Math.min(1, envelopeCount / 16) * controlPower / 128;
      const ropeLoad = Math.max(0, ropeDownwardLoadByBody.get(body.id) ?? 0);
      const lift = mass * (11 + speedCorrection) + Math.min(ropeLoad, payloadCapacity);
      const liftPoint = body.localPointToWorld(body.getCenterOfMass());
      const velocity = body.velocity;
      const horizontalDamping = mass * 1.35;
      body.applyForceAt(liftPoint, {
        x: -velocity.x * horizontalDamping,
        y: lift,
        z: -velocity.z * horizontalDamping
      });
      const angularVelocity = body.angularVelocity;
      const inertia = body.getInertia();
      const localOrigin = body.localPointToWorld({ x: 0, y: 0, z: 0 });
      const localUpPoint = body.localPointToWorld({ x: 0, y: 1, z: 0 });
      const localUp = {
        x: localUpPoint.x - localOrigin.x,
        y: localUpPoint.y - localOrigin.y,
        z: localUpPoint.z - localOrigin.z
      };
      const levelingStrength = controlPower > 64 ? 0.14 : 0.07;
      body.applyTorqueImpulse({
        x: (-localUp.z * levelingStrength - angularVelocity.x * 0.22) * inertia.x,
        y: -angularVelocity.y * inertia.y * 0.08,
        z: (localUp.x * levelingStrength - angularVelocity.z * 0.22) * inertia.z
      });
      if (!body.isActive) body.wakeUp();
    } catch {
    }
  }
}
