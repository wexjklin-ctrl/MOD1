/* CLAUDE-MAP-BEGIN
 FILE: core/cbcMount.js  (34 KB, 626 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: DEAD: old mount code; imports missing modules (lib/*, core/*).
 IMPORTS: @minecraft/server, cbc/config/overrides.js, cbc/effects.js, cbc/fire.js, cbc/fuze.js, cbc/impact.js, cbc/loading.js, cbc/multiblock.js, cbc/projectiles.js, cbc/recoil.js, cbc/settings.js, cbc/world.js, config.js, core/cbcLooks.js, core/explosions.js, core/gauntlet.js, core/parking.js, core/parts.js, core/structures.js, core/tps.js, i18n/i18n.js, lib/blockMass.js, lib/math.js
 IMPORTED BY: - (none: DEAD or entry)
 EXPORTS: fireOnStructure, syncMount, tickCbc, cbcIsUse, cbcUse, cbcAssembled, cbcDisassembled, cbcBeforeRelease
 EVENTS: playerSpawn, scriptEventReceive, worldLoad
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): fireOnStructure@211(66L); stepMount@408(35L); syncMount@345(23L); cbcUse@487(20L); unloadFrom@188(18L); cbcAssembled@513(18L); tickCbc@455(16L); adjustElevation@155(15L); alignParts@128(13L); liftChain@284(13L); kickRecoil@369(13L); setFlags@301(12L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { __t, __R } from "../i18n/i18n.js";
// Пушки (cbc:*) на физических конструкциях: заряжание, наводка, выстрел на ходу и анимация подъёма/отката ствола.
//
// Логика (сканер пушки, баллистика, снаряды) общая с пушками в мире (scripts/cbc/*). Здесь только адаптер к конструкции:
//   * блоки читаются из клеток конструкции (не из мира), направление и точка дула берутся из позы тела;
//   * заряд и угол хранятся в клетке казённика (extra: "cbc:ld", "cbc:el"), сохраняются вместе с конструкцией
//     и переносятся между мировыми блоками и конструкцией при сборке/разборке (см. cbcAssembled / cbcDisassembled);
//   * к скорости снаряда добавляется скорость машины, отдача уходит импульсом в тело;
//   * в покое пушка рисуется обычными блоками конструкции (phys:block, одна команда позы на всю конструкцию, core/cbcLooks.js);
//     пока заряженный ствол поднят или откатывается, камеры и стволы временно рисуют сущности phys:part (поза = поза тела * наклон),
//     блоки на это время не рисуются (extra "cbc:lift").
import { BlockPermutation, ItemStack, system, world } from "@minecraft/server";
import { effectiveTypeId } from "./gauntlet.js";
import { CONFIG } from "../config.js";
import { PHYSICS_ALLOW, registerBlockPhysics } from "../lib/blockMass.js";
import { quatFromAxisAngle, quatMul } from "../lib/math.js";
import { PartDisplay } from "./parts.js";
import { allStructures, cellKey, getStructure, onStructureChanged, onStructureGone, raycastStructures, redrawStructure, setBlock, setCellExtra } from "./structures.js";
import { explodeStructures } from "./explosions.js";
import { wakeParkedNear } from "./parking.js";
import { quietFor } from "./tps.js";
import { CBC, LIFT_KEY, LIFT_KIND, cbcName } from "./cbcLooks.js";
import { findCannon, parsePart, dirVec } from "../cbc/multiblock.js";
import { barrelFactor, flightParams, mortarScatter, planShot, estimateRange as estRaw } from "../cbc/fire.js";
import { ammoKind, ammoName, applyLoad, chargeCapacity, describeLoad, emptyLoad, unloadFor } from "../cbc/loading.js";
import { spawnProjectile, liveCount, areaCount, liveProjectiles, PROJECTILE_TYPE } from "../cbc/projectiles.js";
import { muzzleBlast, shake } from "../cbc/effects.js";
import { LIMITS, MORTAR, SHORT_BARREL, rulesFor, rulesOf } from "../cbc/config/overrides.js";
import { S } from "../cbc/settings.js";
import { setStructureHook } from "../cbc/impact.js";
import { canElevate, RECOIL_TICKS } from "../cbc/recoil.js";
import { fuzeFromItem, fuzeLore } from "../cbc/fuze.js";
import { clearLoadAt, getLoadAt, getElevAt, setElevAt, setLoadAt } from "../cbc/world.js";

const D2R = Math.PI / 180;
const DIRS = ["north", "south", "east", "west", "up", "down"];
const HORIZ = new Set(["north", "south", "east", "west"]);
const ELEV_STEP = 5;
const AIM_ITEM = "phys:gg_aim";      // «наводка +5°»: ПКМ по пушке поднимает ствол на 5°
const AIM_ITEM_DN = "phys:gg_aim_dn"; // «наводка -5°»: ПКМ по пушке опускает ствол на 5° (присед не нужен)
const LD = "cbc:ld", EL = "cbc:el";
const ANGLE_SPEED = 2.5;          // градусов за тик при подъёме/опускании ствола
const SETTLE_TICKS = 4;           // запас после конца подъёма до выстрела
const RECOIL_BLOCKS = 0.45;       // ход ствола при откате, блоков

// ---- физика и допуск блоков в конструкцию -----------------------------------------------------------------------------
PHYSICS_ALLOW.re.push(/^cbc:(steel|cast_iron)_(cannon_barrel|cannon_chamber|screw_breech|sliding_breech|mortar_barrel|mortar_breech)(_hidden)?$/);
for (const m of ["steel", "cast_iron"])
  for (const p of ["cannon_barrel", "cannon_chamber", "screw_breech", "sliding_breech", "mortar_barrel", "mortar_breech"])
    for (const sfx of ["", "_hidden"]) registerBlockPhysics(`cbc:${m}_${p}${sfx}`, { mass: m === "steel" ? 7.9 : 7.2, friction: 0.45 });

// ---- чтение конструкции -----------------------------------------------------------------------------------------------
const AIR = { typeId: "minecraft:air", facing: undefined };
function readerOf(st) {
  return (p) => {
    const c = st.cells.get(cellKey(p.x, p.y, p.z));
    if (c === undefined) return AIR;
    const f = st.palette.getSaved(c.perm)?.s?.[CBC.FACING];
    return { typeId: c.type, facing: typeof f === "string" && DIRS.includes(f) ? f : undefined };
  };
}
const cellAt = (st, p) => st.cells.get(cellKey(p.x, p.y, p.z));
const isBreechType = (t) => parsePart(t)?.kind === "breech";

function findOf(st, cell) {
  const found = findCannon({ x: cell.x, y: cell.y, z: cell.z }, readerOf(st));
  if (!found) return undefined;
  return { ...found, bc: cellAt(st, found.breech) };
}

// ---- состояние в клетке казённика --------------------------------------------------------------------------------------
function getLoad(c) {
  const raw = c?.extra?.[LD];
  if (typeof raw !== "string") return emptyLoad();
  const [p, ch, fz] = raw.split(",");
  return { projectileId: p && p !== "-" ? p : undefined, charges: Number(ch) || 0, fuze: Number(fz) || 0 };
}
function putLoad(st, c, load) {
  const v = !load.projectileId && !(load.charges > 0) ? undefined : `${load.projectileId ?? "-"},${Math.max(0, load.charges | 0)},${Math.max(0, Math.round(load.fuze || 0))}`;
  setCellExtra(st, c, { [LD]: v });
}
function elevRange(scan) {
  if (!HORIZ.has(scan.direction)) return { min: 0, max: 0 };
  const r = rulesOf(scan);
  return { min: r.elevMin ?? 0, max: r.elevMax ?? 0 };
}
const canAim = (scan) => { const r = elevRange(scan); return r.max > r.min; };
function getElev(c, scan) {
  const { min, max } = elevRange(scan);
  const v = Number(c?.extra?.[EL]);
  return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : 0;
}
const putElev = (st, c, deg) => setCellExtra(st, c, { [EL]: deg === 0 ? undefined : String(deg) });
const effElev = (scan, c) => (canAim(scan) ? getElev(c, scan) : 0);
const fmtDeg = (d) => `${d > 0 ? "+" : ""}${d}°`;
const armedNow = (ld) => !!ld.projectileId && ld.charges > 0;

// ---- сообщения --------------------------------------------------------------------------------------------------------
function say(player, text) {
  if (player === undefined) return;
  try { __R.actionBar(player, text); quietFor(player.id); } catch { /* игрок вышел */ }
}
const NOT_FOUND = __t(185);

function consumeHeld(player, typeId) {
  try {
    if (String(player.getGameMode()).toLowerCase() === "creative") return true;
    const inv = player.getComponent("minecraft:inventory");
    if (!inv || !inv.container) return false;
    const slot = inv.container.getSlot(player.selectedSlotIndex);
    if (!slot.hasItem() || (typeId && slot.typeId !== typeId)) return false;
    if (slot.amount > 1) slot.amount = slot.amount - 1; else slot.setItem(undefined);
    return true;
  } catch { return false; }
}

function tiltVec(v, dir, deg) {
  if (!deg) return v;
  const d = dirVec(dir);
  const k = { x: -d.z, y: 0, z: d.x };
  const c = Math.cos(deg * D2R), sn = Math.sin(deg * D2R);
  const kxv = { x: k.y * v.z - k.z * v.y, y: k.z * v.x - k.x * v.z, z: k.x * v.y - k.y * v.x };
  const kv = k.x * v.x + k.y * v.y + k.z * v.z;
  return { x: v.x * c + kxv.x * sn + k.x * kv * (1 - c), y: v.y * c + kxv.y * sn + k.y * kv * (1 - c), z: v.z * c + kxv.z * sn + k.z * kv * (1 - c) };
}

/** Выровнять facing блоков пушки по направлению казённика (как alignParts в мире): модель повёрнута осью ствола вдоль пушки. */
function alignParts(st, scan) {
  try {
    const v = dirVec(scan.direction);
    const total = scan.chambers + scan.barrels + 1;
    for (let i = 0; i <= total; i++) {
      const c = cellAt(st, { x: scan.breechPos.x + v.x * i, y: scan.breechPos.y + v.y * i, z: scan.breechPos.z + v.z * i });
      if (c === undefined || !parsePart(c.type) || c.type.endsWith("_hidden")) continue;
      const saved = st.palette.getSaved(c.perm);
      if (saved?.s?.[CBC.FACING] === scan.direction) continue;
      setBlock(st, c.x, c.y, c.z, BlockPermutation.resolve(c.type, { ...(saved?.s ?? {}), [CBC.FACING]: scan.direction }));
    }
  } catch (e) { __R.log("warn", `[CBC] выравнивание деталей на конструкции: ${e}`); }
}

// ---- действия игрока --------------------------------------------------------------------------------------------------
function report(st, cell, player) {
  const f = findOf(st, cell);
  if (!f) return say(player, NOT_FOUND);
  const { scan: r, bc } = f;
  if (!r.valid) return say(player, __t(234, r.reason ?? "?", r.breechPos.x, r.breechPos.y, r.breechPos.z, r.direction));
  alignParts(st, r);
  syncMount(st, bc);
  const ld = getLoad(bc);
  const est = (n) => Math.round(estRaw(r, n));
  say(player, __t(236, r.chambers, r.barrels, r.materialId, r.direction, describeLoad(ld), chargeCapacity(r), est(ld.charges), est(1), est(chargeCapacity(r)), barrelFactor(r.barrels, rulesFor(r.materialId).maxBarrels).toFixed(2), canAim(r) ? __t(193, fmtDeg(getElev(bc, r)), elevRange(r).min, elevRange(r).max) : "", r.barrels < SHORT_BARREL.minBarrels ? __t(194) : "", (r.mortars ?? 0) > 0 ? __t(235, r.mortars, MORTAR.radius[r.mortars] * 2) : ""));
}

function adjustElevation(st, cell, player, delta) {
  const f = findOf(st, cell);
  if (!f) return say(player, NOT_FOUND);
  const { scan, bc } = f;
  if (!scan.valid) return say(player, __t(186, scan.reason ?? "?"));
  if (!canAim(scan)) return say(player, __t(187));
  const { min, max } = elevRange(scan);
  const cur = getElev(bc, scan);
  const raw = cur + delta;
  const next = Math.max(min, Math.min(max, raw));
  putElev(st, bc, next);
  const hint = scan.materialId === "cast_iron" ? __t(188) : "";
  say(player, next !== raw ? __t(190, fmtDeg(next), min, max, raw < min ? hint : "") : __t(191, fmtDeg(next), min, max));
  syncMount(st, bc);
}

function loadInto(st, cell, player, typeId, fuze) {
  const f = findOf(st, cell);
  if (!f) return say(player, NOT_FOUND);
  const { scan, bc } = f;
  const res = applyLoad(scan, getLoad(bc), typeId, fuze);
  let ok = res.ok;
  if (res.ok) {
    if (consumeHeld(player, typeId)) { putLoad(st, bc, res.load); syncMount(st, bc); } else ok = false;
  }
  say(player, ok ? `§a[CBC] ${res.message}` : `§c[CBC] ${res.ok ? __t(192) : res.message}`);
}

function canUnload(st, cell, typeId) {
  const f = findOf(st, cell);
  return !!f && f.scan.valid && unloadFor(getLoad(f.bc), typeId).ok;
}

function unloadFrom(st, cell, player, typeId, normal) {
  const f = findOf(st, cell);
  if (!f || !f.scan.valid) return;
  const { scan, bc } = f;
  const res = unloadFor(getLoad(bc), typeId);
  if (!res.ok || !res.itemId) return;
  const item = new ItemStack(res.itemId, 1);
  const lore = res.fuze ? fuzeLore(res.fuze) : [];
  if (lore.length) __R.setLore(item, lore);
  putLoad(st, bc, res.load);
  try {
    const c = st.cellCenter(cell.x, cell.y, cell.z);
    const o = st.body.gridDirToWorld(normal[0] * 0.8, normal[1] * 0.8, normal[2] * 0.8);
    st.dimension.spawnItem(item, { x: c.x + o.x, y: c.y + o.y, z: c.z + o.z });
  } catch { /* предмет не выпал: чанк не загружен */ }
  syncMount(st, bc);
  say(player, __t(203, res.message, res.load.charges, chargeCapacity(scan), ammoName(res.load.projectileId)));
}

// ---- выстрел ---------------------------------------------------------------------------------------------------------
const lastShot = new Map();
const delayed = new Set();

export function fireOnStructure(st, cell, player) {
  if (S.frozen) return say(player, __t(142));
  if (st.removed || !st.active) return;
  const f = findOf(st, cell);
  if (!f) return say(player, NOT_FOUND);
  const { scan, bc } = f;
  const key = mountKey(st, bc);
  const now = system.currentTick;
  if (now - (lastShot.get(key) ?? -1e9) < LIMITS.fireCooldownTicks) return say(player, __t(198));
  const load = getLoad(bc);
  const th = effElev(scan, bc);
  const m = mounts.get(key);
  if (armedNow(load) && m !== undefined && Math.abs(m.cur - th) > 0.3) {
    // ствол ещё поднимается: выстрел отложим до конца подъёма
    if (!delayed.has(key)) {
      delayed.add(key);
      const wait = Math.ceil(Math.abs(m.cur - th) / ANGLE_SPEED) + SETTLE_TICKS;
      say(player, __t(199, (wait / 20).toFixed(1)));
      const id = st.id, cx = cell.x, cy = cell.y, cz = cell.z;
      system.runTimeout(() => {
        delayed.delete(key);
        const s2 = getStructure(id), c2 = s2?.cells.get(cellKey(cx, cy, cz));
        if (s2 !== undefined && c2 !== undefined) try { fireOnStructure(s2, c2, player); } catch (e) { __R.log("warn", `[CBC] отложенный выстрел: ${e}`); }
      }, wait);
    }
    return;
  }
  const plan = planShot(scan, load);
  if (!plan.ok) return say(player, `§c[CBC] ${plan.reason ?? __t(160)}`);
  if (liveCount() >= LIMITS.maxProjectilesAlive) return say(player, __t(159));
  const body = st.body, dim = st.dimension;
  const d = dirVec(scan.direction);
  const cs = Math.cos(th * D2R), sn = Math.sin(th * D2R);
  const dt = { x: d.x * cs, y: d.y * cs + sn, z: d.z * cs };
  const p0 = { x: scan.breechPos.x + 0.5, y: scan.breechPos.y + 0.5, z: scan.breechPos.z + 0.5 };
  const n = Math.abs(scan.muzzlePos.x - scan.breechPos.x) + Math.abs(scan.muzzlePos.y - scan.breechPos.y) + Math.abs(scan.muzzlePos.z - scan.breechPos.z);
  const atGrid = (dist) => ({ x: p0.x + dt.x * dist, y: p0.y + dt.y * dist, z: p0.z + dt.z * dist });
  const atWorld = (dist) => { const g = atGrid(dist); return body.gridToWorld(g.x, g.y, g.z); };
  const origin = atWorld(n + 1.2);
  let vel;
  try {
    let v = tiltVec(plan.velocity, scan.direction, th);
    if ((scan.mortars ?? 0) > 0) v = mortarScatter(v, scan.mortars, th, flightParams(plan.munitionId), scan.direction === "up" || scan.direction === "down");
    const vw = body.gridDirToWorld(v.x, v.y, v.z);
    const bv = body.pointVelocity(origin.x, origin.y, origin.z);       // скорость точки дула, блоков/с
    vel = { x: vw.x + bv.x / 20, y: vw.y + bv.y / 20, z: vw.z + bv.z / 20 };
    spawnProjectile(dim, origin, vel, plan.munitionId, load.fuze ?? 0);
  } catch (err) {
    return say(player, __t(161, err));
  }
  lastShot.set(key, now);
  putLoad(st, bc, emptyLoad());
  const dw = body.gridDirToWorld(dt.x, dt.y, dt.z);
  try { dim.playSound("cbc.fire_big_cannon", origin, { volume: 4 }); } catch { /* звук не критичен */ }
  muzzleBlast(dim, atWorld(n + 0.6), dw, load.charges);
  shake(dim, atWorld(n), load.charges);
  // отдача: импульс в тело в точке казённика против направления ствола (не больше ~3 блоков/с прироста скорости)
  try {
    const speed = Math.hypot(vel.x, vel.y, vel.z) * 20;
    const imp = Math.min(speed * (2 + load.charges), 3 * body.mass);
    const bw = body.gridToWorld(p0.x, p0.y, p0.z);
    body.applyImpulseAt(-dw.x * imp, -dw.y * imp, -dw.z * imp, bw.x, bw.y, bw.z);
  } catch { /* отдача не критична */ }
  kickRecoil(st, bc, scan, th);
  syncMount(st, bc);
}

// ---- анимация подъёма и отката ----------------------------------------------------------------------------------------
const mounts = new Map();     // ключ: `${id конструкции}:${ключ клетки казённика}`
const mountKey = (st, bc) => `${st.id}:${cellKey(bc.x, bc.y, bc.z)}`;
const tmp = { x: 0, y: 0, z: 0 };

/** Цепочка поднимаемых клеток (камеры и стволы), либо undefined, если пушку нельзя поднять визуально (миномёт, дульная часть, не горизонтальная и т.п.). */
function liftChain(st, scan) {
  if (!canElevate(scan)) return undefined;
  const v = dirVec(scan.direction), out = [];
  const total = scan.chambers + scan.barrels;
  for (let i = 1; i <= total; i++) {
    const c = cellAt(st, { x: scan.breechPos.x + v.x * i, y: scan.breechPos.y + v.y * i, z: scan.breechPos.z + v.z * i });
    const name = c === undefined ? undefined : cbcName(c.type);
    const kind = name === undefined ? undefined : LIFT_KIND[name];
    if (kind === undefined) return undefined;
    out.push({ cell: c, kind, i });
  }
  return out;
}

/** Клетка конструкции по координатам звена цепочки (объект клетки мог быть пересоздан: берём актуальный). */
const cellOfLink = (m, it) => (it.cell === undefined ? undefined : m.st.cells.get(cellKey(it.cell.x, it.cell.y, it.cell.z)));

function setFlags(m, on) {
  for (const it of m.chain) {
    const cur = cellOfLink(m, it);
    if (cur === undefined) continue;
    if (on && cur.type !== it.cell.type) continue;          // на месте звена уже другой блок: не трогаем
    it.cell = cur;
    setCellExtra(m.st, cur, { [LIFT_KEY]: on ? "1" : undefined });
  }
  // клетки только что перерисованы (блок удалён/создан заново): заставим конструкцию несколько тиков подряд слать позу,
  // иначе свежая сущность в покое может мигнуть в неправильной позе
  try { m.st.visuals.refresh(6); } catch { /* визуал недоступен */ }
}

/** Клетки пушки (камеры и стволы), у которых висит флаг подъёма: чужие флаги без хозяина-анимации снимаются (см. sweepLift). */
const cbcCellsCache = new WeakMap();
function cbcCellsOf(st) {
  const e = cbcCellsCache.get(st);
  if (e !== undefined && e.version === st.version && e.size === st.cells.size) return e.list;
  const list = [];
  for (const c of st.cells.values()) if (cbcName(c.type) !== undefined) list.push(c);
  cbcCellsCache.set(st, { version: st.version, size: st.cells.size, list });
  return list;
}

/** Снять «залипшие» флаги подъёма: если клетка помечена, а анимация (mount) её не ведёт, блок так и остался бы невидимым навсегда. */
function sweepLift(st) {
  let owned;
  for (const c of cbcCellsOf(st)) {
    if (c.extra?.[LIFT_KEY] !== "1") continue;
    if (owned === undefined) {
      owned = new Set();
      for (const m of mounts.values()) if (m.st === st && m.flagged) for (const it of m.chain) { const cur = cellOfLink(m, it); if (cur !== undefined) owned.add(cur); }
    }
    if (!owned.has(c)) setCellExtra(st, c, { [LIFT_KEY]: undefined });
  }
}

function disposeMount(m, clearFlags = true) {
  if (clearFlags) { try { setFlags(m, false); m.flagged = false; } catch { /* конструкция уже удалена */ } }
  for (const it of m.chain) { it.display?.remove(); it.display = undefined; }
  mounts.delete(m.key);
}

/** Привести подъём в соответствие с состоянием: заряжена (снаряд и заряд) -> угол наводки, иначе 0. Создаёт анимацию при необходимости. */
export function syncMount(st, bc) {
  if (st.removed) return;
  const f = findOf(st, bc);
  const key = mountKey(st, bc);
  let m = mounts.get(key);
  if (!f || !f.scan.valid || !f.bc) { if (m !== undefined) disposeMount(m); return; }
  const target = armedNow(getLoad(f.bc)) ? effElev(f.scan, f.bc) : 0;
  if (m === undefined) {
    const dv0 = dirVec(f.scan.direction);
    const total0 = f.scan.chambers + f.scan.barrels;
    let leftover = false;
    for (let i = 1; i <= total0 && !leftover; i++)
      leftover = cellAt(st, { x: f.breech.x + dv0.x * i, y: f.breech.y + dv0.y * i, z: f.breech.z + dv0.z * i })?.extra?.[LIFT_KEY] === "1";
    if (target === 0 && !leftover) return;
    const chain = liftChain(st, f.scan);
    if (chain === undefined) { if (leftover) sweepLift(st); return; }
    const dv = dirVec(f.scan.direction);
    m = { key, st, bc: f.bc, dir: [dv.x, dv.z], chain, cur: leftover ? target : 0, target, age: 0, flagged: false, recoilT0: -1e9, dropAt: -1 };
    mounts.set(key, m);
    if (leftover) { m.flagged = true; m.age = 10; }
  }
  m.target = target;
}

function kickRecoil(st, bc, scan, th) {
  const key = mountKey(st, bc);
  let m = mounts.get(key);
  if (m === undefined) {
    const chain = liftChain(st, scan);
    if (chain === undefined) return;          // миномёты и пушки без поднимаемых частей: откат не рисуем
    const dv = dirVec(scan.direction);
    m = { key, st, bc, dir: [dv.x, dv.z], chain, cur: th, target: 0, age: 0, flagged: false, recoilT0: -1e9, dropAt: -1 };
    mounts.set(key, m);
  }
  m.recoilT0 = system.currentTick;
  m.dropAt = -1;
}

function recoilOffset(m, tick) {
  const t = tick - m.recoilT0;
  if (t < 0 || t >= RECOIL_TICKS) return 0;
  const u = t / RECOIL_TICKS;
  return RECOIL_BLOCKS * (u < 0.15 ? u / 0.15 : Math.pow(1 - (u - 0.15) / 0.85, 2));
}

// v1.9.13: после цикла «подъём/откат» (флаги cbc:lift ставились и снимались, клетки пушки перерисовывались) отрисовка машины остаётся в состоянии,
// при котором клиентский FPS падает на 10-20 кадров, пока машина стоит; движение машины или полная перерисовка (phys:set merge 0/1) это лечат.
// Причина внутри render.js не найдена, поэтому после отката пересоздаём сущности этой конструкции (как redrawAll, но для одной машины).
const REDRAW_DELAY = 10;
const redrawPending = new Set();
function scheduleRedraw(st) {
  if (redrawPending.has(st.id)) return;
  redrawPending.add(st.id);
  system.runTimeout(() => {
    redrawPending.delete(st.id);
    try {
      if (st.removed || !st.active) return;
      for (const m of mounts.values()) if (m.st === st) return;   // идёт новая анимация: перерисуем после неё
      redrawStructure(st);
    } catch (e) { __R.log("warn", `[CBC] перерисовка машины после выстрела: ${e}`); }
  }, REDRAW_DELAY);
}

function stepMount(m, tick) {
  const st = m.st;
  if (st.removed || !st.active) { disposeMount(m, false); return; }
  const bc = st.cells.get(cellKey(m.bc.x, m.bc.y, m.bc.z));
  if (bc !== m.bc) { disposeMount(m); return; }
  // направление к цели
  if (Math.abs(m.target - m.cur) > 1e-6) m.cur += Math.max(-ANGLE_SPEED, Math.min(ANGLE_SPEED, m.target - m.cur));
  const recoil = recoilOffset(m, tick);
  const resting = Math.abs(m.cur) < 1e-6 && recoil === 0 && m.target === 0;
  const body = st.body, anchor = st.visuals.anchor;
  m.age++;
  if (resting && m.flagged) {
    // ствол опустился: возвращаем блоки, сущности уберём через несколько тиков (чтобы не мигало)
    setFlags(m, false); m.flagged = false; m.dropAt = tick + 6;
  }
  if (resting && !m.flagged && m.dropAt >= 0 && tick >= m.dropAt) { disposeMount(m, false); scheduleRedraw(st); return; }
  if (resting && !m.flagged && m.dropAt < 0 && m.age > 3) { disposeMount(m, false); return; }
  if (anchor === undefined) return;
  const moving = !body.isStatic && !body.asleep;
  const th = m.cur * D2R, c = Math.cos(th), s = Math.sin(th);
  const dx = m.dir[0], dz = m.dir[1];
  const qEl = quatFromAxisAngle(-dz, 0, dx, th);
  const qFix = quatFromAxisAngle(dz, 0, -dx, Math.PI / 2);
  const q = quatMul(body.orientation, quatMul(qEl, qFix));
  const bx = m.bc.x + 0.5, by = m.bc.y + 0.5, bz = m.bc.z + 0.5;
  for (const it of m.chain) {
    if (it.display === undefined) it.display = new PartDisplay(it.kind, 0);
    const dist = it.i - recoil;
    const pos = body.gridToWorld(bx + dx * c * dist, by + s * dist, bz + dz * c * dist, tmp);
    const ka = !moving && (tick + it.i + st.id) % CONFIG.KEEPALIVE_TICKS === 0;
    it.display.update(st.dimension, anchor, pos, q, moving, tick, ka || m.age < 3);
  }
  // блоки скрываем, когда сущности уже показаны (2 тика), чтобы не было мигания
  if (!m.flagged && m.age >= 2 && !resting) { setFlags(m, true); m.flagged = true; }
}

// ---- перебор конструкций ----------------------------------------------------------------------------------------------
const breechCache = new WeakMap();
function breechesOf(st) {
  let e = breechCache.get(st);
  if (e !== undefined && e.version === st.version && e.size === st.cells.size) return e.list;
  const list = [];
  for (const c of st.cells.values()) if (c.type.startsWith("cbc:") && isBreechType(c.type)) list.push(c);
  breechCache.set(st, { version: st.version, size: st.cells.size, list });
  return list;
}

export function tickCbc(tick) {
  if (tick % 20 === 7) {
    for (const st of allStructures()) {
      if (!st.active || st.removed) continue;
      for (const bc of breechesOf(st)) syncMount(st, bc);
      try { sweepLift(st); } catch (e) { __R.log("warn", `[CBC] уборка флагов подъёма: ${e}`); }
    }
  }
  for (const m of [...mounts.values()]) {
    try { stepMount(m, tick); }
    catch (e) {
      __R.log("warn", `[CBC] анимация пушки упала, блоки возвращены: ${e}`);
      try { disposeMount(m); } catch { /* ничего */ }
    }
  }
}

// ---- события конструкции ----------------------------------------------------------------------------------------------
onStructureChanged((st) => { for (const m of [...mounts.values()]) if (m.st === st) disposeMount(m); });
onStructureGone((st) => { for (const m of [...mounts.values()]) if (m.st === st) disposeMount(m, false); });

// ---- взаимодействие (подключается из core/uses.js) --------------------------------------------------------------------
/** Перехватывать ли клик по клетке (чтобы блок не ставился и не срабатывало обычное действие). */
export function cbcIsUse(st, cell, normal, item, sneaking) {
  if (cbcName(cell.type) === undefined) return false;
  if (item === undefined) return !sneaking;
  const t = effectiveTypeId(item);
  if (t === "minecraft:flint_and_steel" || t === AIM_ITEM || t === AIM_ITEM_DN) return true;
  if (!ammoKind(t)) return false;
  return sneaking ? canUnload(st, cell, t) : true;
}

export function cbcUse(player, st, cell, normal, item) {
  if (cbcName(cell.type) === undefined) return false;
  const t = effectiveTypeId(item);
  try {
    if (item === undefined) { report(st, cell, player); return true; }
    if (t === "minecraft:flint_and_steel") { fireOnStructure(st, cell, player); return true; }
    if (t === AIM_ITEM || t === AIM_ITEM_DN) { adjustElevation(st, cell, player, t === AIM_ITEM_DN ? -ELEV_STEP : ELEV_STEP); return true; }
    if (!ammoKind(t)) return false;
    if (player.isSneaking) {
      if (!canUnload(st, cell, t)) return false;
      unloadFrom(st, cell, player, t, normal);
      return true;
    }
    loadInto(st, cell, player, t, fuzeFromItem(item));
    return true;
  } catch (e) {
    __R.log("warn", `[CBC] ошибка пушки на конструкции: ${e}`);
    return true;
  }
}

// ---- перенос состояния при сборке и разборке --------------------------------------------------------------------------
/**
 * Вызывается из assembleFromWorld сразу после создания клеток, до удаления мировых блоков.
 * origin: мировые координаты клетки (0,0,0); берёт заряд и угол из мира, возвращает скрытые двойники к обычным деталям.
 */
export function cbcAssembled(st, origin) {
  try {
    const dimId = st.dimension.id;
    for (const c of [...st.cells.values()]) {
      if (!c.type.startsWith("cbc:")) continue;
      if (c.type.endsWith("_hidden") && cbcName(c.type) !== undefined) {
        const saved = st.palette.getSaved(c.perm);
        try { setBlock(st, c.x, c.y, c.z, BlockPermutation.resolve(c.type.slice(0, -7), saved?.s ?? {})); } catch { /* оставим как есть */ }
      }
      if (!isBreechType(c.type)) continue;
      const wp = { x: origin.x + c.x, y: origin.y + c.y, z: origin.z + c.z };
      const ld = getLoadAt(dimId, wp), el = getElevAt(dimId, wp);
      if (ld.projectileId || ld.charges > 0) putLoad(st, c, ld);
      if (el) putElev(st, c, el);
      clearLoadAt(dimId, wp);
    }
  } catch (e) { __R.log("warn", `[CBC] сборка конструкции с пушкой: ${e}`); }
}

/** Вызывается из disassemble после установки блока клетки в мир (location — мировые координаты). */
export function cbcDisassembled(st, cell, location) {
  try {
    if (!cell.type.startsWith("cbc:") || !isBreechType(cell.type) || cell.extra === undefined) return;
    const dimId = st.dimension.id;
    const ld = getLoad(cell);
    if (ld.projectileId || ld.charges > 0) setLoadAt(dimId, location, ld);
    const el = Number(cell.extra[EL]);
    if (Number.isFinite(el) && el !== 0) setElevAt(dimId, location, el);
  } catch (e) { __R.log("warn", `[CBC] разборка конструкции с пушкой: ${e}`); }
}

/** Перед разборкой/удалением: убрать подъём (блоки вернутся, сущности исчезнут). */
export function cbcBeforeRelease(st) {
  for (const m of [...mounts.values()]) if (m.st === st) disposeMount(m);
}

// ---- подключение к structures.js и команда настройки -------------------------------------------------------------------
import { refreshAllLooks, setCbcHooks, setFarInterest } from "./structures.js";
import { setCbcFlip } from "./cbcLooks.js";
setCbcHooks({ assembled: cbcAssembled, disassembled: cbcDisassembled, release: cbcBeforeRelease });
setFarInterest(() => liveProjectiles());

let flip = false;
world.afterEvents.worldLoad.subscribe(() => {
  system.afterEvents.scriptEventReceive.subscribe((ev) => {
    if (ev.id !== "phys:cbc") return;
    const msg0 = ev.message.trim();
    if (msg0 === "help" || msg0 === "") {
      try { __R.sendMessage(ev.sourceEntity, __t(237)); } catch { /* ничего */ }
      return;
    }
    if (msg0 === "perf") { // диагностика просадки FPS: запускать, когда FPS уже упал (после серии выстрелов)
      const pl = ev.sourceEntity; if (pl === undefined) return;
      try {
        const dim = pl.dimension;
        const cnt = (type) => { try { return dim.getEntities({ type }).length; } catch { return -1; } };
        let total = 0, active = 0, awake = 0, cells = 0;
        for (const st of allStructures()) { total++; if (st.active) { active++; cells += st.cells.size; if (!st.body.isStatic && !st.body.asleep) awake++; } }
        __R.sendMessage(pl, __t(238, liveCount(), areaCount(), mounts.size)
          + __t(239, cnt(PROJECTILE_TYPE), cnt(CONFIG.ENTITY_PART), cnt(CONFIG.ENTITY_BLOCK))
          + __t(240, total, active, cells, awake)
          + __t(241));
      } catch (e) { try { __R.sendMessage(pl, __t(242, e)); } catch { /* ничего */ } }
      return;
    }
    if (msg0 === "boom" || msg0.startsWith("boom ")) { // диагностика: взрыв силы N (по умолчанию 5) в точке, куда смотрит игрок
      const pl = ev.sourceEntity; if (pl === undefined) return;
      const say = (t) => { try { __R.sendMessage(pl, t); } catch { /* ничего */ } };
      try {
        const pw = Number(msg0.split(/\s+/)[1]) || 5;
        const hit = raycastStructures(pl.dimension, pl.getHeadLocation(), pl.getViewDirection(), 64);
        if (hit === undefined) { say(__t(243)); return; }
        const pt = hit.hit.point;
        say(__t(244, pw, pt.x.toFixed(1), pt.y.toFixed(1), pt.z.toFixed(1), hit.structure.cells.size));
        explodeStructures(pl.dimension, pt, pw, { dropChance: 0.3 });
      } catch (e) { say(__t(245, e)); }
      return;
    }
    if (ev.message.trim() === "flip") {
      flip = !flip; setCbcFlip(flip); refreshAllLooks();
      try { __R.sendMessage(ev.sourceEntity, __t(246, flip ? __t(215) : __t(76))); } catch { /* ничего */ }
    }
  });
});

// ---- урон снарядов по физическим конструкциям (сборка 82) -------------------------------------------------------------
setStructureHook({
  /** Луч снаряда по блокам конструкций: ближайшая точка попадания. */
  ray(dim, from, dir, maxDist) {
    const r = raycastStructures(dim, from, dir, maxDist);
    return r === undefined ? undefined : { distance: r.hit.distance, point: r.hit.point };
  },
  /** Взрыв/удар снаряда: ломает блоки конструкций по их прочности (core/explosions.js) и толкает машину. */
  blast(dim, at, power) {
    const r = power * 2 + 2;
    let parked = false;
    try { // стоящая 10+ секунд техника «запаркована» (обычные блоки мира): будим, она соберётся на следующем тике
      parked = wakeParkedNear(dim.id, { x: at.x - r, y: at.y - r, z: at.z - r }, { x: at.x + r, y: at.y + r, z: at.z + r }, 0) === true;
    } catch (e) { __R.log("warn", `[CBC] пробуждение запаркованной техники: ${e}`); }
    try { explodeStructures(dim, at, power, { dropChance: 0.3 }); } catch (e) { __R.log("warn", `[CBC] взрыв по конструкциям: ${e}`); }
    if (parked) system.runTimeout(() => {
      try { explodeStructures(dim, at, power, { dropChance: 0.3 }); } catch (e) { __R.log("warn", `[CBC] взрыв по собранной технике: ${e}`); }
    }, 3);
  },
});

// приветствие при входе: если оно видно, скрипты аддона загрузились (сборка 84)
world.afterEvents.playerSpawn.subscribe((e) => {
  if (!e.initialSpawn) return;
  system.runTimeout(() => {
    try { __R.sendMessage(e.player, __t(247)); } catch { /* игрок вышел */ }
  }, 60);
});
