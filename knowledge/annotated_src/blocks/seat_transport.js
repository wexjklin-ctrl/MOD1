/* CLAUDE-MAP-BEGIN
 FILE: blocks/seat_transport.js  (2 KB, 38 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (auto, from first comment) Adapted from Van's hidden-seat transport: clear residual velocity, then
 IMPORTS: -
 IMPORTED BY: main.js
 EXPORTS: transportPhysicsSeat
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): transportPhysicsSeat@5(33L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// Adapted from Van's hidden-seat transport: clear residual velocity, then
// carry the native rider with observed movement instead of repeated position snaps.
const motion = new WeakMap();

export function transportPhysicsSeat(seat, point, yaw, tick) {
  const entity = seat.entity;
  const previous = motion.get(entity);
  const current = entity.location;
  const riders = entity.getComponent("minecraft:rideable")?.getRiders() ?? [];
  const mounted = riders.length > 0;
  const elapsed = previous ? tick - previous.tick : 0;
  if (previous && elapsed === 0) return;
  const error = { x: point.x-current.x, y: point.y-current.y, z: point.z-current.z };
  const distance = Math.hypot(error.x, error.y, error.z);
  const dimension = entity.dimension.id === seat.dimension.id;
  entity.clearVelocity();
  // Быстрый полёт: догоняем жёстче, но порог телепорта остаётся 1.5.
  // Телепорт кресла с пассажиром при отставании 0.6 выкидывал игрока из кресла.
  const speed = previous && elapsed > 0 ? Math.hypot(point.x-previous.point.x, point.y-previous.point.y, point.z-previous.point.z) / elapsed : 0;
  const gain = speed > 0.35 ? Math.min(0.8, 0.35 + speed*0.5) : 0.35;
  if (!mounted || !previous?.mounted || !dimension || elapsed < 1 || elapsed > 4 || distance > 1.5) {
    entity.teleport(point, { dimension: seat.dimension, rotation: { x: 0, y: yaw }, keepVelocity: false, checkForBlocks: false });
  } else {
    // Observed displacement includes chassis translation, turns, and banking.
    const impulse = {
      x: (point.x-previous.point.x)/elapsed + error.x*gain,
      y: (point.y-previous.point.y)/elapsed + error.y*gain,
      z: (point.z-previous.point.z)/elapsed + error.z*gain
    };
    // Rotation-only alignment leaves native rider movement interpolation intact.
    const rotation = entity.getRotation();
    const yawError = ((yaw-rotation.y+540)%360)-180;
    if (Math.abs(yawError) > 0.05 || Math.abs(rotation.x) > 0.05) entity.setRotation({ x: 0, y: yaw });
    entity.applyImpulse(impulse);
  }
  motion.set(entity, { point: { ...point }, tick, mounted });
}
