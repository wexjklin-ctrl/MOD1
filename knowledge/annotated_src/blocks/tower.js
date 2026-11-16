/* CLAUDE-MAP-BEGIN
 FILE: blocks/tower.js  (19 KB, 284 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: Tower/core block handling (mandatory core of a contraption).
 IMPORTS: @minecraft/server, @minecraft/server-ui, blocks/propeller_bearing.js, cbc/multiblock.js
 IMPORTED BY: blocks/aircraft_motion.js, cbc/cmMount.js, main.js
 EXPORTS: TOWER, TOWER_PANEL, TOWER_RANGE, TOWER_RATE, PITCH_MIN, PITCH_MAX, PITCH_RATE, TOWER_MAX_BLOCKS, towerHasCannon, towerAxis, markTowerHeads, towerForPanel, addTowerMotion, towerTurnOf, showTowerPanel
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): addTowerMotion@168(55L); showTowerPanel@248(36L); writeTowerBatches@138(28L); cannonsOf@34(27L); towerTurnOf@226(20L); buildGroups@102(17L); markTowerHeads@89(12L); headOf@75(11L); pitchedPose@127(9L); towerAxis@67(6L); rod@26(4L); towerForPanel@121(4L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// Шаг 138: «Башня конструкции» (бывший Propeller Bearing) и «Пульт управления башни» (бывший Airplane Throttle).
// Башня - шарнир: всё, что приклеено к ней со стороны «головы» (грань block_face), поворачивается вокруг её оси на заданный угол.
//  Режим 1 (башня вместо ядра): башня остаётся обычным блоком мира, а приклеенная к ней конструкция становится статичной физической
//   (motionType static: ноль расчёта физики) и вращается только вокруг оси башни. Поза головы - те же articulated-позы, что у винтов.
//  Режим 2 (башня в машине с ядром): башня - блок машины, её «голова» вращается независимо от корпуса.
// Цена: пока башня стоит на месте, поз не пересчитывается (кэш по углу), цикл идёт только пока угол меняется (до 3 градусов за тик).
import { world } from "@minecraft/server";
import { CustomForm, ObservableNumber } from "@minecraft/server-ui";
import { rotorPose, multiply, quaternion, euler, continuousRotorRotation } from "./propeller_bearing.js";
import { findCannon, parsePart, dirVec } from "../cbc/multiblock.js";

export const TOWER = "create_physics:propeller_bearing";
export const TOWER_PANEL = "create_physics:airplane_throttle";
export const TOWER_RANGE = 180;       // слайдер -180..180, центр = исходное положение
export const TOWER_RATE = 3;          // градусов за тик (60 град/с)
export const PITCH_MIN = -10, PITCH_MAX = 50, PITCH_RATE = 2;   // шаг 141: подъём ствола башней, как у стальной пушки
const FACING = "minecraft:facing_direction", DIRS = ["north", "south", "east", "west", "up", "down"];
export const TOWER_MAX_BLOCKS = 1500; // предел головы одной башни
const FACE = { up: [0, 1, 0], down: [0, -1, 0], north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0] };
const key = p => `${p.x},${p.y},${p.z}`;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const NEIGHBORS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

const D2R = Math.PI / 180;
/** Поворот вектора v вокруг единичной оси k на rad радиан (Родриг). */
function rod(v, k, rad) {
  const c = Math.cos(rad), s = Math.sin(rad), d = k.x * v.x + k.y * v.y + k.z * v.z;
  return { x: v.x * c + (k.y * v.z - k.z * v.y) * s + k.x * d * (1 - c), y: v.y * c + (k.z * v.x - k.x * v.z) * s + k.y * d * (1 - c), z: v.z * c + (k.x * v.y - k.y * v.x) * s + k.z * d * (1 - c) };
}
const qAxis = (k, rad) => { const h = rad / 2, s = Math.sin(h); return { x: k.x * s, y: k.y * s, z: k.z * s, w: Math.cos(h) }; };

/** Шаг 141/150: ВСЕ пушки в голове башни (только если ось башни вертикальна). У каждой своя ось подъёма k, свой шарнир (казённик) и свои клетки.
 *  Считается один раз на группу. Возвращает массив (пустой, если пушек нет). */
function cannonsOf(session, g) {
  if (g.cannons !== undefined) return g.cannons;
  g.cannons = [];
  try {
    if (Math.abs(g.axis.y) !== 1 || !session.assembly?.isValid) return g.cannons;
    const map = new Map();
    for (const b of session.assembly.blocks) {
      const f = b.contraptionStates?.[FACING];
      map.set(key(b.localLocation), { typeId: b.typeId ?? b.itemTypeId, facing: typeof f === "string" && DIRS.includes(f) ? f : undefined });
    }
    const read = p => map.get(key(p)) ?? { typeId: "minecraft:air", facing: undefined };
    const o = session.location, seen = new Set();
    for (const m of g.members) {
      if (!parsePart(m.typeId)) continue;
      const found = findCannon({ x: m.location.x - o.x, y: m.location.y - o.y, z: m.location.z - o.z }, read);
      if (!found || !found.scan.valid || !["north", "south", "east", "west"].includes(found.scan.direction)) continue;
      const d = dirVec(found.scan.direction), sc = found.scan, br = found.breech, bk = key(br);
      if (seen.has(bk)) continue;   // та же пушка, найденная от другой своей детали
      seen.add(bk);
      const n = Math.abs(sc.muzzlePos.x - br.x) + Math.abs(sc.muzzlePos.y - br.y) + Math.abs(sc.muzzlePos.z - br.z);
      const keys = new Set();
      for (let i = 0; i <= n; i++) keys.add(key({ x: br.x + d.x * i, y: br.y, z: br.z + d.z * i }));
      g.cannons.push({ k: { x: -d.z, y: 0, z: d.x }, pivot: { x: br.x, y: br.y, z: br.z }, keys });
    }
  } catch {}
  return g.cannons;
}
/** Пушка группы, в чьих клетках лежит клетка id (или undefined). */
const cannonAt = (session, g, id) => cannonsOf(session, g).find(c => c.keys.has(id));
/** Есть ли у башни пушки, которые можно поднимать (для пульта). */
export function towerHasCannon(session, group) { return cannonsOf(session, group).length > 0; }

/** Ось башни (единичный вектор «головы»): грань, на которую её поставили (любое из 6 направлений). */
export function towerAxis(snapshotOrBlock) {
  let face = "up";
  try { face = snapshotOrBlock.permutation.getState("minecraft:block_face") ?? "up"; } catch {}
  const v = FACE[face] ?? FACE.up;
  return { x: v[0], y: v[1], z: v[2] };
}

/** Голова башни из блоков конструкции: всё связное по граням со стороны оси, не заходя в другие башни. */
function headOf(tower, axis, byKey, claimed) {
  const members = [], queue = [{ x: tower.location.x + axis.x, y: tower.location.y + axis.y, z: tower.location.z + axis.z }];
  for (let i = 0; i < queue.length && members.length < TOWER_MAX_BLOCKS; i++) {
    const p = queue[i], id = key(p), block = byKey.get(id);
    if (!block || claimed.has(id) || block.typeId === TOWER) continue;
    if ((p.x - tower.location.x) * axis.x + (p.y - tower.location.y) * axis.y + (p.z - tower.location.z) * axis.z < 1) continue;
    claimed.add(id); members.push(block);
    for (const [x, y, z] of NEIGHBORS) queue.push({ x: p.x + x, y: p.y + y, z: p.z + z });
  }
  return members;
}

/** Шаг 149: до сборки помечает блоки головы вертикальной башни ключом башни (snapshot.towerHead = "x,y,z"): простые кубы головы идут в свои пачки
 *  (сущность tower_batch), которые целиком вращаются вокруг оси башни. root - башня-основание {location, axis} или undefined. */
export function markTowerHeads(snapshots, root) {
  if (!root && !snapshots.some(s => s.typeId === TOWER)) return;
  for (const s of snapshots) s.towerHead = false;
  const towers = root ? [{ location: root.location, axis: root.axis }] : snapshots.filter(s => s.typeId === TOWER).map(s => ({ location: s.location, axis: towerAxis(s) }));
  if (!towers.length) return;
  const byKey = new Map(snapshots.map(s => [key(s.location), s])), claimed = new Set();
  for (const t of towers) {
    if (Math.abs(t.axis.y) !== 1) continue;   // пачки вращаются только вокруг вертикали; боковая башня - отдельные визуалы
    const id = key(t.location);
    for (const m of headOf(t, t.axis, byKey, claimed)) m.towerHead = id;
  }
}

function buildGroups(session) {
  const local = p => ({ x: p.x - session.location.x, y: p.y - session.location.y, z: p.z - session.location.z });
  const groups = [];
  if (session.towerRoot) {   // режим 1: башня вне конструкции, вращается вся конструкция
    const root = session.towerRoot, axis = root.axis;
    // шаг 147: вращается только голова (связное выше башни по оси), остальное - неподвижный корпус
    const byKey = new Map(session.snapshots.map(s => [key(s.location), s]));
    groups.push({ state: root, axis, pivot: local(root.location), members: headOf({ location: root.location }, axis, byKey, new Set()), panelHost: true });
    return groups;
  }
  const byKey = new Map(session.snapshots.map(s => [key(s.location), s])), claimed = new Set();
  for (const tower of session.snapshots.filter(s => s.typeId === TOWER).sort((a, b) => key(a.location).localeCompare(key(b.location)))) {
    const axis = towerAxis(tower);
    groups.push({ state: tower, axis, pivot: local(tower.location), members: headOf(tower, axis, byKey, claimed) });
  }
  return groups;
}

/** Башня, чьей головой управляет пульт: та, в чьей голове стоит пульт. */
export function towerForPanel(session, panel) {
  const groups = session.towerGroups ?? buildGroups(session);
  return groups.find(g => g.panelHost || g.members.includes(panel));
}

/** Деталь пушки: сначала подъём вокруг казённика (ось k), потом поворот башни вокруг её оси. */
function pitchedPose(position, g, yawDeg, cn, pitchDeg, base, previous) {
  const pr = pitchDeg * D2R, yr = -yawDeg * D2R;
  const v = { x: position.x - cn.pivot.x, y: position.y - cn.pivot.y, z: position.z - cn.pivot.z };
  const r1 = rod(v, cn.k, pr);
  const w = { x: cn.pivot.x + r1.x - g.pivot.x, y: cn.pivot.y + r1.y - g.pivot.y, z: cn.pivot.z + r1.z - g.pivot.z };
  const r2 = rod(w, g.axis, yr);
  const q = multiply(qAxis(g.axis, yr), multiply(qAxis(cn.k, pr), quaternion(base)));
  return { location: { x: g.pivot.x + r2.x, y: g.pivot.y + r2.y, z: g.pivot.z + r2.z }, rotation: continuousRotorRotation(euler(q), previous), yaw: 0 };
}

/** Шаг 149: пачки головы (tower_batch) вращаются на клиенте вокруг точки башни: пишем только угол и точку, и только при смене. */
function writeTowerBatches(session, g, angle) {
  const a = session.assembly;
  if (Math.abs(g.axis.y) !== 1) return;
  try {
    if (!session.towerBatchList) {
      session.towerBatchList = [];
      for (const id of a.visualEntityIds) {
        const e = world.getEntity(id);
        if (e?.typeId !== "create_physics:tower_batch") continue;
        const k = a.getVisualBlock(id)?.towerKey;
        if (k) session.towerBatchList.push({ entity: e, key: k });
      }
    }
    g.key ??= key(g.state.location);
    const an = a.visualAnchor ?? { x: 0, y: 0, z: 0 };
    const v = [angle * g.axis.y, g.pivot.x - an.x, g.pivot.z - an.z];
    for (const r of session.towerBatchList) {
      if (r.key !== g.key) continue;
      if (!r.entity.isValid) { session.towerBatchList = undefined; g.shown = NaN; return; }
      const last = r.last;
      if (last && last[0] === v[0] && last[1] === v[1] && last[2] === v[2]) continue;
      r.entity.setProperty("create_physics:tw_rot", v[0]);
      if (!last || last[1] !== v[1]) r.entity.setProperty("create_physics:tw_px", v[1]);
      if (!last || last[2] !== v[2]) r.entity.setProperty("create_physics:tw_pz", v[2]);
      r.last = v;
    }
  } catch {}
}

/** Раз в тик внутри прохода articulated. Заполняет transforms позами блоков головы; без движения и без угла - почти ничего. */
export function addTowerMotion(session, transforms) {
  if (!session.assembly?.isValid || session.streamingMotion) return;
  if (session.towerTopo !== session.snapshots || session.towerCount !== session.snapshots.length || session.towerAssembly !== session.assembly) {
    session.towerTopo = session.snapshots; session.towerCount = session.snapshots.length; session.towerAssembly = session.assembly;
    session.towerGroups = buildGroups(session);
    session.towerBlocks = undefined;
    session.towerKeys = new Set();
    for (const g of session.towerGroups) {
      g.shown = NaN;
      for (const m of g.members) session.towerKeys.add(key({ x: m.location.x - session.location.x, y: m.location.y - session.location.y, z: m.location.z - session.location.z }));
    }
  }
  const groups = session.towerGroups;
  if (!groups.length) return;
  for (const g of groups) {
    const s = g.state;
    if (g.batchSrc !== session.assembly.blocks) { g.batchSrc = session.assembly.blocks; g.shown = NaN; session.towerBatchList = undefined; }   // блоки сменились: пачки перечитать
    s.towerAngle ??= 0; s.towerTarget ??= 0; s.towerPitch ??= 0; s.towerPitchTarget ??= 0;
    const d = s.towerTarget - s.towerAngle, dp = s.towerPitchTarget - s.towerPitch;
    let moved = false;
    if (Math.abs(d) > 0.0005) { s.towerAngle = Math.abs(d) <= TOWER_RATE ? s.towerTarget : s.towerAngle + Math.sign(d) * TOWER_RATE; moved = true; }
    if (Math.abs(dp) > 0.0005) { s.towerPitch = Math.abs(dp) <= PITCH_RATE ? s.towerPitchTarget : s.towerPitch + Math.sign(dp) * PITCH_RATE; moved = true; }
    const stateKey = s.towerAngle * 1000 + s.towerPitch;
    if (g.shown !== stateKey) {   // позы пересчитываются только при смене угла
      if (!session.towerBlocks || session.towerBlockSrc !== session.assembly.blocks) {
        session.towerBlockSrc = session.assembly.blocks;
        session.towerBlocks = new Map(session.assembly.blocks.map(b => [key(b.localLocation), b]));
        session.towerRot = new Map();
      }
      g.poses = [];
      if (s.towerAngle !== 0 || s.towerPitch !== 0) {
        const lifted = s.towerPitch !== 0;   // шаг 150: пульт поднимает ВСЕ пушки башни
        for (const m of g.members) {
          const position = { x: m.location.x - session.location.x, y: m.location.y - session.location.y, z: m.location.z - session.location.z };
          const id = key(position), base = session.towerBlocks.get(id)?.rotation ?? { x: 0, y: 0, z: 0 };
          let pose;
          const cn = lifted ? cannonAt(session, g, id) : undefined;
          if (cn) pose = pitchedPose(position, g, s.towerAngle, cn, s.towerPitch, base, session.towerRot.get(id) ?? base);
          else pose = rotorPose(position, g.pivot, g.axis, s.towerAngle, base, session.towerRot.get(id) ?? base);
          session.towerRot.set(id, pose.rotation);
          pose.size = { x: 1, y: 1, z: 1 };
          pose.collisionResponse = !moved;   // во время движения голова не толкает корпус импульсами
          g.poses.push([id, pose]);
        }
      } else for (const m of g.members) session.towerRot?.delete(key({ x: m.location.x - session.location.x, y: m.location.y - session.location.y, z: m.location.z - session.location.z }));
      g.shown = stateKey; g.movedLast = moved;
      writeTowerBatches(session, g, s.towerAngle);
    } else if (g.movedLast && !moved && g.poses?.length) {   // остановились: вернуть коллизию
      for (const [, pose] of g.poses) pose.collisionResponse = true;
      g.movedLast = false;
    }
    if (g.poses?.length) for (const [id, pose] of g.poses) transforms.set(id, pose);
    if (moved) session.assembly.body.wakeUp?.();
  }
}

/** Шаг 140: клетка (в координатах сборки) принадлежит голове башни? Тогда пушка наводится башней, а не своей наводкой ±5°.
 *  Возвращает undefined, если клетка не в голове; иначе { active, point(p), dir(v) } - поворот точки и вектора башней (для выстрела), шаг 141: с учётом подъёма. */
export function towerTurnOf(session, cell) {
  const groups = session?.towerGroups;
  if (!groups?.length || !cell) return undefined;
  const o = session.location, id = `${cell.x},${cell.y},${cell.z}`;
  for (const g of groups) {
    g.keys ??= new Set(g.members.map(m => `${m.location.x - o.x},${m.location.y - o.y},${m.location.z - o.z}`));
    if (!g.keys.has(id)) continue;
    const a = g.state.towerAngle ?? 0, pt = g.state.towerPitch ?? 0, cn = pt !== 0 ? cannonAt(session, g, id) : undefined, pv = g.pivot, yr = -a * D2R;   // шаг 150: пушка по своей клетке
    const lift = !!cn;
    const dir = v => { let r = lift ? rod(v, cn.k, pt * D2R) : v; return a !== 0 ? rod(r, g.axis, yr) : r; };
    const point = p => {
      let r = { x: p.x - pv.x, y: p.y - pv.y, z: p.z - pv.z };
      if (lift) { const t = rod({ x: p.x - cn.pivot.x, y: p.y - cn.pivot.y, z: p.z - cn.pivot.z }, cn.k, pt * D2R); r = { x: cn.pivot.x + t.x - pv.x, y: cn.pivot.y + t.y - pv.y, z: cn.pivot.z + t.z - pv.z }; }
      if (a !== 0) r = rod(r, g.axis, yr);
      return { x: pv.x + r.x, y: pv.y + r.y, z: pv.z + r.z };
    };
    return { active: a !== 0 || (lift && pt !== 0), dir, point };
  }
  return undefined;
}

/** Окно пульта: слайдер угла (центр = исходное) и кнопка «вернуть в исходное». */
export async function showTowerPanel(player, session, panel, persist = () => {}) {
  if (!session?.assembly?.isValid) { try { player.sendMessage("§eПульт работает на башне, когда конструкция собрана"); } catch {} return; }
  const group = towerForPanel(session, panel);
  if (!group) { try { player.sendMessage("§eПульт должен стоять в конструкции, приклеенной к башне"); } catch {} return; }
  let angle, sub, pitch, subP;
  try {
    angle = new ObservableNumber(clamp(Math.round(group.state.towerTarget ?? 0), -TOWER_RANGE, TOWER_RANGE), { clientWritable: true });
    const apply = () => {
      if (!session.assembly?.isValid) return;
      group.state.towerTarget = clamp(Math.round(angle.getData()), -TOWER_RANGE, TOWER_RANGE);
      persist(session);
    };
    sub = angle.subscribe(apply);
    const lifts = towerHasCannon(session, group);
    if (lifts) {
      pitch = new ObservableNumber(clamp(Math.round(group.state.towerPitchTarget ?? 0), PITCH_MIN, PITCH_MAX), { clientWritable: true });
      subP = pitch.subscribe(() => {
        if (!session.assembly?.isValid) return;
        group.state.towerPitchTarget = clamp(Math.round(pitch.getData()), PITCH_MIN, PITCH_MAX);
        persist(session);
      });
    }
    const form = new CustomForm(player, "Пульт управления башни");
    form.label("Центр ползунка - исходное положение башни. Влево или вправо - на сколько градусов повернуть.");
    form.slider("Поворот башни", angle, -TOWER_RANGE, TOWER_RANGE, { step: 5 });
    if (pitch) form.slider("Подъём пушки", pitch, PITCH_MIN, PITCH_MAX, { step: 5 });
    form.button("Вернуть в исходное положение", () => { try { angle.setData(0); pitch?.setData(0); } catch {} });
    form.closeButton();
    await form.show();
  } catch (error) {
    console.warn(`[Create Physics] tower panel: ${error?.message ?? error}`);
  } finally {
    if (angle && sub) angle.unsubscribe(sub);
    if (pitch && subP) pitch.unsubscribe(subP);
  }
}
