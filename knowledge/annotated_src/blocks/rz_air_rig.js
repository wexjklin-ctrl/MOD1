/* CLAUDE-MAP-BEGIN
 FILE: blocks/rz_air_rig.js  (27 KB, 395 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (auto, from first comment) RZ Lite: порт модели полёта RZ 1 в 1 (RZ_Physics_BP/scripts/lib/vehicle/air.js, v1.9.65-1.9.79).
 IMPORTS: blocks/rz_air_mode.js, blocks/rz_block_mass.js, blocks/symmetric_sails.js
 IMPORTED BY: blocks/airplane_flight.js, blocks/rz_air_control.js
 EXPORTS: AIR, AirRig, RZ_AIR_LITE, rzAirModel, rzForward2, rzAirFly
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): rzAirFly@357(38L); rzAirModel@313(23L); wingNormal@292(8L); flapNormal@301(7L); ceilOf@338(6L); rzForward2@346(4L); clamp@54(1L); cross@56(1L); dot@57(1L); cross3@287(1L); norm3@288(1L); state@289(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// RZ Lite: порт модели полёта RZ 1 в 1 (RZ_Physics_BP/scripts/lib/vehicle/air.js, v1.9.65-1.9.79).
// Константы AIR и класс AirRig скопированы без изменений. Ниже класса - только переходник к телу Lite (rzAirFly).
// Нагрузка как в RZ: один проход по коротким массивам (винты, пластины), собранным один раз при смене блоков; два вызова
// (сила и момент) на тело за тик. Никаких рейкастов и обхода блоков в тике.
import { AIRCFG, RZ_PROP_IDS, PROP_SPEC, propAxis } from "./rz_air_mode.js";
import { SYMMETRIC_SAIL_IDS } from "./symmetric_sails.js";
import { rzMassOf } from "./rz_block_mass.js";

// v1.9.65 — модель полёта самолёта (винты + пластины-крылья + рули). Дёшево: никаких рейкастов и обхода клеток в каждом тике,
// только короткие массивы, собранные один раз при смене блоков конструкции (core/aircraft.js).
//
// Идея: каждый блок-крыло — плоская пластина 1x1 с нормалью n. Сила на пластине (тонкий профиль):
//     F = -CN(sinA) * q * S * n,      q = RHO * |v|^2 / 2,   sinA = (v . n) / |v|,   v = скорость воздуха в точке пластины (v тела + w x r)
//   CN линейна по sinA до срыва (CN_STALL), после срыва падает до CN_POST. Из одной формулы получаются подъёмная сила, индуктивное
//   сопротивление, боковая сила вертикальных плоскостей (киль), устойчивость и демпфирование (хвост видит скорость вращения), срыв.
//   Рули — те же пластины, но нормаль повёрнута на угол отклонения вокруг оси шарнира: n' = n cos d + (h x n) sin d.
// Тяга: сила вдоль оси каждого винта в его позиции (момент от несимметричной тяги получается сам).
// Управление: каналы тангаж/крен/рыскание -> угловая скорость цели -> отклонение рулей (знаки усилений каждого руля считаются по его
//   положению относительно центра масс, поэтому «куда повёрнуть» подбирается само, а не задаётся вручную).
export const AIR = {
  RHO: 0.06,            // «плотность воздуха» (единицы игры, подобрано так, чтобы лёгкий самолёт летел при 20-40 м/с)
  CN_SLOPE: 5.0,        // dCN / d(sinA) до срыва
  CN_STALL: 0.34,       // sin угла срыва (~20 градусов)
  CN_POST: 0.7,         // доля CN после срыва
  CD0: 0.05,            // паразитное сопротивление пластины (на единицу площади)
  BODY_DRAG: 0.0006,    // сопротивление корпуса: a = -BODY_DRAG * |v| * v
  THRUST_K: 1.3,        // (шаг 119: было 0.75) ускорение от тяги = THRUST_K * (ускорение привода, м/с^2)
  THRUST_ACC_MAX: 20,   // (шаг 119: было 14) предел ускорения от тяги, м/с^2
  VMAX_K: 1.35,         // тяга падает до нуля на скорости VMAX_K * предел скорости привода
  DOWN_K: 2.0,          // (v1.9.70) усиление руля высоты при ручке «нос вниз» (естественный момент крыльев тянет нос вверх; 1 = как для набора высоты)
  DEFL_MAX: 20,         // максимальное отклонение руля, градусов
  SERVO: 8,             // скорость привода руля (1/с)
  RATE_PITCH: 1.0,      // целевая угловая скорость при полной ручке, рад/с
  RATE_ROLL: 1.6,
  RATE_YAW: 0.7,
  FF: 0.7,              // прямая подача (доля ручки в отклонение руля)
  KP: 0.55,             // усиление по ошибке угловой скорости (на рад/с)
  YAW_MIX: 0.45,        // доля рыскания при крене (скоординированный поворот)
  INCIDENCE: 5,         // угол установки крыльев (градусов): горизонтальные пластины впереди центра масс стоят носом вверх, иначе подъёмной силы в горизонте нет
  LEVEL: 0.35,          // самовыравнивание крена, когда ручка крена отпущена (рад/с на единицу наклона), 0 = выкл
  ANG_DAMP: 0.5,        // общее демпфирование вращения, 1/с (поверх аэродинамического)
  THR_RATE: 0.6,        // скорость рычага тяги, 1/с
  MIN_AIRSPEED: 0.3,    // ниже этой скорости пластины не считаются
  OVERLOAD_MAX: 1.8,    // (шаг 132) нагрузка = масса конструкции / суммарная cap винтов; при 1.8 тяга нулевая, выше 1 - линейно падает
  OVERLOAD_SPD: 0.5,    // (шаг 132) потеря предела скорости на единицу перегрузки (выше 1)
  OVERLOAD_SPD_MIN: 0.5,// (шаг 132) не ниже этой доли предела скорости
  FADE_FRAC: 0.08,      // (шаг 132) тяга затухает в последних 8% до предела скорости винта (65-70 км/ч при MAX_KMH 70)
  MAX_KMH: 70,          // (v1.9.79, шаг 132: 80 -> 70) предел скорости самолёта, км/ч (0 = без предела): тяга сходит на нет у предела, выше — сильное торможение
  CEILING_Y: 0,         // (v1.9.79) потолок высоты, блоков (0 = автоматически: верх мира - 10). Выше — «разреженный воздух»: тяга и подъёмная сила пропадают
  CEIL_FADE: 20,        // зона плавного затухания тяги и подъёмной силы под потолком, блоков
  MAX_FORCE_G: 4,       // предел силы пластины в весах конструкции (защита от «взрыва» при больших dt/скоростях)
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const D2R = Math.PI / 180;
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export class AirRig {
  constructor(cfg = AIR) {
    this.cfg = cfg;
    this.props = []; this.plates = [];
    this.fwd = [0, 0, 1]; this.up = [0, 1, 0];
    this.thr = 0;                    // рычаг тяги 0..1
    this.speed = 0;                  // скорость вперёд, м/с
    this.airspeed = 0; this.aoa = 0; // для HUD
    this.thrust = 0;                 // суммарная тяга, Н
    this.ctl = { pitch: 0, roll: 0, yaw: 0 };
    this.hasControls = false;
    this.calKey = "";
    this.wingArea = 0;
    this.n = { x: 0, y: 0, z: 0 };
    this.ceilY = 310;                // потолок высоты (ставится из core/vehicles.js)
    this.air = 1;                    // доля плотности воздуха на текущей высоте (1 = норма, 0 = потолок)
    this.capped = false;             // упёрлись в предел скорости (для HUD)
  }

  /** model: { props: [{x,y,z,dx,dy,dz}], plates: [{x,y,z,nx,ny,nz,ctrl,hx,hy,hz}] } (координаты клеток в сетке). */
  setup(model, fwdGrid) {
    this.props = model.props.map(p => ({ ...p }));
    this.plates = model.plates.map(p => ({ ...p, defl: 0, tgt: 0, gp: 0, gr: 0, gy: 0, nx0: p.nx, ny0: p.ny, nz0: p.nz, cx: p.nx, cy: p.ny, cz: p.nz, ch: 0, sh: 0 }));
    this.wingArea = this.plates.length;
    this.hasControls = this.plates.some(p => p.ctrl);
    this.setForward(fwdGrid);
  }

  setForward(f) {
    if (f !== undefined) this.fwd = [f[0], 0, f[1]];
    this.calKey = "";                 // пересчитать усиления рулей
  }

  /** Усиления рулей по тангажу/крену/рысканию: знак и вес от положения руля относительно центра масс (в сетке). */
  calibrate(b) {
    const key = `${b.comX.toFixed(2)},${b.comY.toFixed(2)},${b.comZ.toFixed(2)}|${this.fwd[0]},${this.fwd[2]}|${this.plates.length}`;
    if (key === this.calKey) return;
    this.calKey = key;
    const f = this.fwd, u = this.up;
    const P = cross(f, u);            // ось «нос вверх» (направо)
    const R = f;                       // крен вправо
    const Y = [-u[0], -u[1], -u[2]];  // рыскание вправо
    let mp = 1e-9, mr = 1e-9, my = 1e-9;
    const inc = this.cfg.INCIDENCE * D2R, ci = Math.cos(inc), si = Math.sin(inc);
    for (const p of this.plates) {
      p.gp = p.gr = p.gy = 0;
      p.nx0 = p.nx; p.ny0 = p.ny; p.nz0 = p.nz;
      if (!p.ctrl && inc !== 0 && Math.abs(p.ny) > 0.7) {
        const rel = (p.x + 0.5 - b.comX) * f[0] + (p.z + 0.5 - b.comZ) * f[2];
        if (rel > -1.5) { const s = p.ny > 0 ? 1 : -1; p.nx0 = -f[0] * si; p.ny0 = s * ci; p.nz0 = -f[2] * si; }
      }
      p.cx = p.nx0; p.cy = p.ny0; p.cz = p.nz0;
      if (!p.ctrl) continue;
      const r = [p.x + 0.5 - b.comX, p.y + 0.5 - b.comY, p.z + 0.5 - b.comZ];
      const n = [p.nx0, p.ny0, p.nz0], h = [p.hx, p.hy, p.hz];
      const c = dot(cross(h, n), f);                // d(sinA)/d(отклонение) при потоке вдоль f
      const t = cross(r, n);                          // момент ~ -c * (r x n) на единицу отклонения
      p.gp = -c * dot(t, P); p.gr = -c * dot(t, R); p.gy = -c * dot(t, Y);
      mp = Math.max(mp, Math.abs(p.gp)); mr = Math.max(mr, Math.abs(p.gr)); my = Math.max(my, Math.abs(p.gy));
    }
    for (const p of this.plates) {
      if (!p.ctrl) continue;
      p.gp /= mp; p.gr /= mr; p.gy /= my;
      if (Math.abs(p.gp) < 0.15) p.gp = 0;
      if (Math.abs(p.gr) < 0.15) p.gr = 0;
      if (Math.abs(p.gy) < 0.15) p.gy = 0;
    }
  }

  /**
   * b — тело, inp: { thr (0..1 желаемый рычаг), pitch, roll (-1..1) } или null, acc — ускорение привода (м/с^2, уже с КПД),
   * vlim — предел скорости привода (м/с), powered — есть ли тяга (топливо), dt — шаг.
   */
  step(b, inp, dt, acc, vlim, powered) {
    const c = this.cfg, M = b.mass;
    if (b.invMass === 0 || M <= 0) return;
    this.calibrate(b);
    const R = b.rot;
    // ---- рычаг тяги
    const wantThr = inp ? clamp(inp.thr, 0, 1) : 0;
    const dthr = wantThr - this.thr, mx = c.THR_RATE * dt;
    this.thr += Math.abs(dthr) <= mx ? dthr : Math.sign(dthr) * mx;
    // ---- скорость и направления в мире
    const fw = [R[0] * this.fwd[0] + R[2] * this.fwd[2], R[3] * this.fwd[0] + R[5] * this.fwd[2], R[6] * this.fwd[0] + R[8] * this.fwd[2]];
    const vF = b.vx * fw[0] + b.vy * fw[1] + b.vz * fw[2];
    this.speed = vF;
    const V = Math.hypot(b.vx, b.vy, b.vz);
    this.airspeed = V;
    // (v1.9.79) разреженный воздух у потолка: плотность падает до 0 -> тяга и подъёмная сила пропадают, самолёт падает
    const fade = Math.max(1, c.CEIL_FADE);
    const dens = clamp((this.ceilY - b.py) / fade, 0, 1);
    this.air = dens;
    // (шаг 132) предел скорости и тяга зависят от винтов: spd - доля предела, cap - масса, которую винты тянут без потерь
    const vbase = c.MAX_KMH > 0 ? c.MAX_KMH / 3.6 : Infinity;
    let capSum = 0, spdMax = 0;
    for (const p of this.props) { capSum += p.cap ?? 30; spdMax = Math.max(spdMax, p.spd ?? 1); }
    const load = this.props.length ? M / Math.max(1, capSum) : 0;
    this.load = load;
    const tf = load <= 1 ? 1 : clamp((c.OVERLOAD_MAX - load) / (c.OVERLOAD_MAX - 1), 0, 1);
    const sf = load <= 1 ? 1 : clamp(1 - c.OVERLOAD_SPD * (load - 1), c.OVERLOAD_SPD_MIN, 1);
    const vcap = vbase === Infinity ? Infinity : vbase * (spdMax || 1) * sf;
    this.vcap = vcap;
    this.capped = V > vcap * 0.97;
    const g = Math.abs(b.gravityScale) * 9.81;
    const fmax = c.MAX_FORCE_G * M * g;
    let ftotal = 0;
    // ---- тяга винтов
    this.thrust = 0;
    if (powered && this.thr > 0.001 && this.props.length > 0 && dens > 0) {
      const lim = Math.max(1, vlim * c.VMAX_K);
      const a = clamp(acc * c.THRUST_K, 0, c.THRUST_ACC_MAX);
      const share = M * a * this.thr * dens * tf / this.props.length;
      for (const p of this.props) {
        const eff = p.eff ?? 1;   // шаг 119: размер винта. Тяга растёт с размером, предел скорости тяги тоже
        const dx = R[0] * p.dx + R[1] * p.dy + R[2] * p.dz, dy = R[3] * p.dx + R[4] * p.dy + R[5] * p.dz, dz = R[6] * p.dx + R[7] * p.dy + R[8] * p.dz;
        const va = b.vx * dx + b.vy * dy + b.vz * dz;
        const vcapP = vbase === Infinity ? Infinity : vbase * (p.spd ?? 1) * sf;
        const limP = Math.max(lim * (1 + 0.3 * (eff - 1)), vcapP === Infinity ? 0 : vcapP * 4);   // шаг 132: предел двигателя не ниже предела винта
        const k = Math.min(clamp(1 - va / limP, 0, 1), vcapP === Infinity ? 1 : clamp((vcapP - va) / (vcapP * c.FADE_FRAC), 0, 1));
        const f = share * eff * k;
        if (f <= 0) continue;
        const gx = p.x + 0.5 - b.comX, gy = p.y + 0.5 - b.comY, gz = p.z + 0.5 - b.comZ;
        const rx = R[0] * gx + R[1] * gy + R[2] * gz, ry = R[3] * gx + R[4] * gy + R[5] * gz, rz = R[6] * gx + R[7] * gy + R[8] * gz;
        const Fx = dx * f, Fy = dy * f, Fz = dz * f;
        b.fx += Fx; b.fy += Fy; b.fz += Fz;
        b.tx += ry * Fz - rz * Fy; b.ty += rz * Fx - rx * Fz; b.tz += rx * Fy - ry * Fx;
        ftotal += f;
      }
      this.thrust = ftotal;
    }
    // ---- управление: ручка -> угловая скорость цели -> отклонение рулей
    const ctl = this.ctl;
    if (this.hasControls) {
      const f = this.fwd, u = this.up, P = cross(f, u);
      // угловая скорость тела в осях сетки
      const wgx = R[0] * b.wx + R[3] * b.wy + R[6] * b.wz, wgy = R[1] * b.wx + R[4] * b.wy + R[7] * b.wz, wgz = R[2] * b.wx + R[5] * b.wy + R[8] * b.wz;
      const wb = [wgx, wgy, wgz];
      const q = dot(wb, P), p = dot(wb, f), r = -dot(wb, u);
      const ip = inp ? inp.pitch : 0, ir = inp ? inp.roll : 0;
      // наклон: y-компонента вектора «вправо» в мире (отрицательна, когда правое крыло опущено)
      const rightY = R[3] * P[0] + R[4] * P[1] + R[5] * P[2];
      let tRoll = ir * c.RATE_ROLL;
      if (ir === 0 && c.LEVEL > 0) tRoll = c.LEVEL * rightY;
      const tPitch = ip * c.RATE_PITCH;
      const tYaw = ir * c.RATE_YAW * c.YAW_MIX;
      // на малой скорости рули не работают, но и «ручка» не должна раскручивать контур — гасим усиление
      const auth = clamp(V / 8, 0, 1);
      const pr = (c.FF * ip + c.KP * (tPitch - q)) * auth;
      ctl.pitch = clamp(pr < 0 ? pr * c.DOWN_K : pr, -c.DOWN_K, 1);
      ctl.roll = clamp((c.FF * (ir === 0 ? 0 : ir) + c.KP * (tRoll - p)) * auth, -1, 1);
      ctl.yaw = clamp((c.FF * ir * c.YAW_MIX + c.KP * (tYaw - r)) * auth, -1, 1);
    } else { ctl.pitch = ctl.roll = ctl.yaw = 0; }
    const dmax = c.DEFL_MAX * D2R, servo = Math.min(1, c.SERVO * dt);
    // ---- пластины
    const rho = 0.5 * c.RHO * dens;
    let maxAoa = 0;
    if (V > c.MIN_AIRSPEED) {
      for (const p of this.plates) {
        if (p.ctrl) {
          const tg = clamp(p.gp * ctl.pitch + p.gr * ctl.roll + p.gy * ctl.yaw, -Math.max(1, c.DOWN_K), Math.max(1, c.DOWN_K)) * dmax;
          p.defl += (tg - p.defl) * servo;
          p.ch = Math.cos(p.defl); p.sh = Math.sin(p.defl);
          // n' = n cos d + (h x n) sin d
          const hx = p.hy * p.nz0 - p.hz * p.ny0, hy = p.hz * p.nx0 - p.hx * p.nz0, hz = p.hx * p.ny0 - p.hy * p.nx0;
          p.cx = p.nx0 * p.ch + hx * p.sh; p.cy = p.ny0 * p.ch + hy * p.sh; p.cz = p.nz0 * p.ch + hz * p.sh;
        }
        const gx = p.x + 0.5 - b.comX, gy = p.y + 0.5 - b.comY, gz = p.z + 0.5 - b.comZ;
        const rx = R[0] * gx + R[1] * gy + R[2] * gz, ry = R[3] * gx + R[4] * gy + R[5] * gz, rz = R[6] * gx + R[7] * gy + R[8] * gz;
        const vx = b.vx + b.wy * rz - b.wz * ry, vy = b.vy + b.wz * rx - b.wx * rz, vz = b.vz + b.wx * ry - b.wy * rx;
        const v2 = vx * vx + vy * vy + vz * vz;
        if (v2 < 0.09) continue;
        const vl = Math.sqrt(v2);
        const nx = R[0] * p.cx + R[1] * p.cy + R[2] * p.cz, ny = R[3] * p.cx + R[4] * p.cy + R[5] * p.cz, nz = R[6] * p.cx + R[7] * p.cy + R[8] * p.cz;
        const sa = (vx * nx + vy * ny + vz * nz) / vl;
        const as = sa < 0 ? -sa : sa;
        let cn = as <= c.CN_STALL ? c.CN_SLOPE * as : c.CN_SLOPE * c.CN_STALL * c.CN_POST;
        if (sa < 0) cn = -cn;
        if (as > maxAoa) maxAoa = as;
        const qS = rho * v2;
        // нормальная сила + паразитное сопротивление вдоль -v
        let Fx = -cn * qS * nx, Fy = -cn * qS * ny, Fz = -cn * qS * nz;
        const d = c.CD0 * qS / vl;
        Fx -= d * vx; Fy -= d * vy; Fz -= d * vz;
        const fl = Math.hypot(Fx, Fy, Fz);
        if (fl > fmax) { const k = fmax / fl; Fx *= k; Fy *= k; Fz *= k; }
        b.fx += Fx; b.fy += Fy; b.fz += Fz;
        b.tx += ry * Fz - rz * Fy; b.ty += rz * Fx - rx * Fz; b.tz += rx * Fy - ry * Fx;
      }
      // сопротивление корпуса
      const bd = -c.BODY_DRAG * V * M;
      b.fx += bd * b.vx; b.fy += bd * b.vy; b.fz += bd * b.vz;
    } else if (this.hasControls) {
      for (const p of this.plates) if (p.ctrl) {   // без потока рули возвращаются в ноль, чтобы не залипать
        p.defl += (0 - p.defl) * servo;
      }
    }
    this.aoa = Math.asin(clamp(maxAoa, 0, 1)) / D2R;
    // (v1.9.79) жёсткий предел скорости: сверх него (пикирование) сильное торможение вдоль скорости, без момента
    if (V > vcap) {
      const k = -Math.min(6, (V - vcap) * 2.5) * M / V;
      b.fx += k * b.vx; b.fy += k * b.vy; b.fz += k * b.vz;
    }
    // ---- общее демпфирование вращения
    if (c.ANG_DAMP > 0 && (b.wx !== 0 || b.wy !== 0 || b.wz !== 0)) {
      const I = b.inertia, k = c.ANG_DAMP;
      // момент = -k * I * w (в осях сетки), переведённый в мир; хватает диагонали + недиагональных членов
      const wgx = R[0] * b.wx + R[3] * b.wy + R[6] * b.wz, wgy = R[1] * b.wx + R[4] * b.wy + R[7] * b.wz, wgz = R[2] * b.wx + R[5] * b.wy + R[8] * b.wz;
      const lx = I[0] * wgx + I[1] * wgy + I[2] * wgz, ly = I[1] * wgx + I[3] * wgy + I[4] * wgz, lz = I[2] * wgx + I[4] * wgy + I[5] * wgz;
      b.tx += -k * (R[0] * lx + R[1] * ly + R[2] * lz);
      b.ty += -k * (R[3] * lx + R[4] * ly + R[5] * lz);
      b.tz += -k * (R[6] * lx + R[7] * ly + R[8] * lz);
    }
  }
}

// =====================================================================================================================
// Переходник к Lite
// =====================================================================================================================
export const RZ_AIR_LITE = {
  G_LITE: 11,      // гравитация мира Lite (physics.js: DEFAULT_GRAVITY y = -11)
  G_RZ: 9.81,      // гравитация RZ (config.js GRAVITY)
  DT: 1 / 20,      // шаг: один тик скрипта
  FALLBACK_ACC: 8, // без двигателя RZ и при REQUIRE_ENGINE = 0: ускорение привода, м/с^2
  FALLBACK_VMAX: 30,
  SCALE: 0         // 0 = авто (масса Lite / масса по RZ, гравитация); иначе множитель сил вручную (/scriptevent rzlite:air force_scale)
};

const FELEV = new Set(["sim:block__black_symmetric_sail", "sim:block__gray_symmetric_sail", "sim:block__brown_symmetric_sail", "sim:block__white_symmetric_sail", "sim:block__light_gray_symmetric_sail", "sim:block__red_symmetric_sail", "sim:block__orange_symmetric_sail", "sim:block__yellow_symmetric_sail", "sim:block__lime_symmetric_sail", "sim:block__green_symmetric_sail", "sim:block__cyan_symmetric_sail", "sim:block__light_blue_symmetric_sail", "sim:block__blue_symmetric_sail", "sim:block__purple_symmetric_sail", "sim:block__magenta_symmetric_sail", "sim:block__pink_symmetric_sail", "sim:block__copper_symmetric_sail", "sim:block__iron_symmetric_sail", "sim:block__netherite_symmetric_sail"]);
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const state = (s, n) => { try { return s.permutation.getState(n); } catch { return undefined; } };

/** Нормаль крыла как в RZ (aircraft.js wingNormal): горизонтальное - вверх, вертикальное - поперёк тонкой стороны. */
function wingNormal(snap) {
  const h = state(snap, "create_physics:horizontal");
  if (h === true || h === 1) return [0, 1, 0];
  const dir = state(snap, "minecraft:cardinal_direction") ?? "south";
  const side = snap.typeId.startsWith("create_physics:symmetric_sail_side");
  const thinX = side ? (dir === "east" || dir === "west") : (dir === "north" || dir === "south");
  return thinX ? [1, 0, 0] : [0, 0, 1];
}
/** Нормаль руля как в RZ (flapNormal): пластина лежит на грани, по которой кликнули. */
function flapNormal(snap) {
  switch (state(snap, "minecraft:block_face")) {
    case "north": case "south": return [0, 0, 1];
    case "east": case "west": return [1, 0, 0];
    default: return [0, 1, 0];
  }
}

/**
 * Модель для AirRig.setup (RZ: analyzeAircraft + aircraftModel). Координаты клеток Lite - центры блоков (целые),
 * а AirRig ждёт угол клетки (x + 0.5 = центр), поэтому сдвиг на -0.5.
 */
export function rzAirModel(session, fwd2) {
  const sx = session.location.x, sy = session.location.y, sz = session.location.z;
  const fw = [fwd2[0], 0, fwd2[1]], lat = norm3(cross3(fw, [0, 1, 0]));
  const sg = AIRCFG.THRUST_INV ? -1 : 1;
  const props = [], plates = [];
  for (const s of session.snapshots) {
    const t = s.typeId;
    const x = s.location.x - sx - 0.5, y = s.location.y - sy - 0.5, z = s.location.z - sz - 0.5;
    if (RZ_PROP_IDS.has(t)) {
      const a = propAxis(s);
      const sp = PROP_SPEC.get(t) ?? { eff: 1, cap: 30, spd: 0.8 };
      props.push({ x, y, z, dx: sg * a.x, dy: sg * a.y, dz: sg * a.z, eff: sp.eff, cap: sp.cap, spd: sp.spd });
    } else if (FELEV.has(t)) {
      const n = flapNormal(s), q = { x, y, z, nx: n[0], ny: n[1], nz: n[2], ctrl: true, hx: 0, hy: 1, hz: 0 };
      if (Math.abs(n[1]) > 0.5) { q.hx = lat[0]; q.hy = lat[1]; q.hz = lat[2]; }   // горизонтальная: шарнир поперёк перёда
      plates.push(q);
    } else if (SYMMETRIC_SAIL_IDS.has(t)) {
      const n = wingNormal(s);
      plates.push({ x, y, z, nx: n[0], ny: n[1], nz: n[2], ctrl: false, hx: 0, hy: 1, hz: 0 });
    }
  }
  return { props, plates };
}

const ceilCache = new Map();
function ceilOf(dim) {   // RZ vehicles.js ceilOf: верх мира - 10
  const id = dim?.id ?? "x";
  let c = ceilCache.get(id);
  if (c === undefined) { try { c = dim.heightRange.max - 10; } catch { c = 310; } ceilCache.set(id, c); }
  return c;
}

/** Ось «перёда» в сетке (целая ось X или Z) по направлению тяги. */
export function rzForward2(thrust) {
  if (!thrust) return undefined;
  return Math.abs(thrust.x) > Math.abs(thrust.z) ? [Math.sign(thrust.x), 0] : [0, Math.sign(thrust.z) || 1];
}

/**
 * Один шаг модели RZ для сессии. inp = { thr, pitch, roll } или null (нет пилота).
 * drive = { acc, vlim, powered }. Возвращает rig (для HUD, звука и винта) или undefined.
 * Расчёт ведётся для «массы по RZ» (rzMassOf), результат силы и момента масштабируется на (масса Lite / масса RZ) и на отношение
 * гравитаций: подъёмная сила, сопротивление и тяга относятся к весу так же, как в RZ.
 */
export function rzAirFly(session, body, fwd2, inp, drive) {
  let rig = session.rzRig;
  const key = `${session.snapshots.length}|${fwd2[0]},${fwd2[1]}|${AIRCFG.THRUST_INV}`;
  if (!rig || session.rzRigTopo !== session.snapshots || session.rzRigKey !== key) {
    if (!rig) rig = session.rzRig = new AirRig(AIR);
    rig.setup(rzAirModel(session, fwd2), fwd2);
    session.rzRigTopo = session.snapshots; session.rzRigKey = key;
    session.rzMass = rzMassOf(session.snapshots);
  }
  const M = body.getMass();
  if (!(M > 0)) return rig;
  const Mrz = session.rzMass;
  { let cs = 0; for (const p of rig.props) cs += p.cap ?? 30; rig.load = cs > 0 ? Mrz / cs : 0; }   // шаг 132: нагрузка винтов для сообщения пилоту
  const L = RZ_AIR_LITE, k = (L.SCALE > 0 ? L.SCALE : (M / Mrz) * (L.G_LITE / L.G_RZ));
  // тело в виде, который ждёт AirRig
  const b = session.rzRigBody ??= { rot: new Array(9).fill(0), inertia: new Array(6).fill(0), gravityScale: 1, invMass: 1 };
  const o = body.localPointToWorld({ x: 0, y: 0, z: 0 });
  const ex = body.localPointToWorld({ x: 1, y: 0, z: 0 }), ey = body.localPointToWorld({ x: 0, y: 1, z: 0 }), ez = body.localPointToWorld({ x: 0, y: 0, z: 1 });
  const R = b.rot;
  R[0] = ex.x - o.x; R[1] = ey.x - o.x; R[2] = ez.x - o.x;
  R[3] = ex.y - o.y; R[4] = ey.y - o.y; R[5] = ez.y - o.y;
  R[6] = ex.z - o.z; R[7] = ey.z - o.z; R[8] = ez.z - o.z;
  const v = body.velocity, w = body.angularVelocity, c = body.getCenterOfMass(), I = body.getInertia(), loc = body.location;
  b.mass = Mrz; b.invMass = 1 / Mrz;
  b.vx = v.x; b.vy = v.y; b.vz = v.z; b.wx = w.x; b.wy = w.y; b.wz = w.z;
  b.py = loc.y; b.comX = c.x; b.comY = c.y; b.comZ = c.z;
  const ik = Mrz / M;   // инерция для массы RZ (форма распределения массы та же)
  b.inertia[0] = I.x * ik; b.inertia[1] = 0; b.inertia[2] = 0; b.inertia[3] = I.y * ik; b.inertia[4] = 0; b.inertia[5] = I.z * ik;
  b.fx = b.fy = b.fz = b.tx = b.ty = b.tz = 0;
  rig.ceilY = AIR.CEILING_Y > 0 ? AIR.CEILING_Y : (session.rzCeil ??= ceilOf(session.dimension));
  rig.step(b, inp, L.DT, drive.acc, drive.vlim, drive.powered);
  const fx = b.fx * k, fy = b.fy * k, fz = b.fz * k;
  if (Math.abs(fx) + Math.abs(fy) + Math.abs(fz) > 0.0001) body.applyForceAt(body.localPointToWorld(c), { x: fx, y: fy, z: fz });
  const tx = b.tx * k, ty = b.ty * k, tz = b.tz * k;
  if (Math.abs(tx) + Math.abs(ty) + Math.abs(tz) > 0.0001) body.applyTorque({ x: tx, y: ty, z: tz });
  session.rzLiftAcc = fy / M;   // для колёсной части: подъёмная сила + вертикальная составляющая тяги, м/с^2
  return rig;
}
