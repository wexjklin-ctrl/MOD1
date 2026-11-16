/* CLAUDE-MAP-BEGIN
 FILE: cbc/ballistics.js  (2 KB, 55 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (auto, from first comment) Один шаг движения за 1 тик. Возвращает новое состояние (исходное не меняется).
 IMPORTS: -
 IMPORTED BY: cbc/fire.js, cbc/projectiles.js, cbc/twin.js
 EXPORTS: stepFlight, applySpread, orientation
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): stepFlight@2(22L); applySpread@25(17L); orientation@50(5L); norm@45(4L); cross@42(3L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
/** Один шаг движения за 1 тик. Возвращает новое состояние (исходное не меняется). */
export function stepFlight(s, p) {
    let { x, y, z } = s.vel;
    if (p.quadraticDrag) {
        const speed = Math.hypot(x, y, z);
        const k = Math.min(1, p.drag * speed);
        x -= x * k;
        y -= y * k;
        z -= z * k;
    }
    else {
        const k = 1 - p.drag;
        x *= k;
        y *= k;
        z *= k;
    }
    y += p.gravity;
    return {
        pos: { x: s.pos.x + x, y: s.pos.y + y, z: s.pos.z + z },
        vel: { x, y, z },
        age: s.age + 1,
    };
}
/** Применить разброс: случайный наклон вектора на угол до `spreadRad`. rnd() -> [0,1). */
export function applySpread(dir, spreadRad, rnd = Math.random) {
    if (spreadRad <= 0)
        return dir;
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
    // ортонормальный базис, перпендикулярный d
    const ref = Math.abs(d.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const u = norm(cross(d, ref));
    const w = cross(d, u);
    const ang = rnd() * spreadRad, phi = rnd() * Math.PI * 2;
    const s = Math.sin(ang), c = Math.cos(ang);
    return {
        x: d.x * c + (u.x * Math.cos(phi) + w.x * Math.sin(phi)) * s,
        y: d.y * c + (u.y * Math.cos(phi) + w.y * Math.sin(phi)) * s,
        z: d.z * c + (u.z * Math.cos(phi) + w.z * Math.sin(phi)) * s,
    };
}
function cross(a, b) {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function norm(a) {
    const l = Math.hypot(a.x, a.y, a.z) || 1;
    return { x: a.x / l, y: a.y / l, z: a.z / l };
}
/** Углы модели по скорости (градусы): yaw вокруг Y, pitch вверх положительный. Для ориентации сущности. */
export function orientation(vel) {
    const yaw = (Math.atan2(-vel.x, vel.z) * 180) / Math.PI;
    const pitch = (Math.atan2(vel.y, Math.hypot(vel.x, vel.z)) * 180) / Math.PI;
    return { yaw, pitch };
}
