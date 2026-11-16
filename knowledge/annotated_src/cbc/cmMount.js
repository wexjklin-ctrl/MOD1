/* CLAUDE-MAP-BEGIN
 FILE: cbc/cmMount.js  (19 KB, 303 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: Cannon mount integration with assembled contraptions.
 IMPORTS: @minecraft/server, blocks/tower.js, cbc/config/overrides.js, cbc/effects.js, cbc/fire.js, cbc/fuze.js, cbc/loading.js, cbc/multiblock.js, cbc/projectiles.js, cbc/settings.js, cbc/world.js, core/gauntlet.js, i18n/i18n.js
 IMPORTED BY: main.js
 EXPORTS: installCbcMount, cbcQueueUse, cbcOnAssemble, cbcOnDisassemble, cbcAimVersion, cbcAimPoses
 EVENTS: worldLoad
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): fire@156(41L); cbcAimPoses@272(31L); cbcQueueUse@199(27L); installCbcMount@38(25L); cbcOnAssemble@234(15L); cbcOnDisassemble@251(14L); adjustElevation@114(12L); unloadFrom@144(11L); consumeHeld@127(9L); readerOf@64(8L); tiltVec@106(8L); findOf@74(7L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { towerTurnOf } from "../blocks/tower.js";   // шаг 140: пушка на башне
import { __t, __R } from "../i18n/i18n.js";
// Пушки (cbc:*) на конструкциях CreateMovement: заряжание, выстрел на ходу, отдача.
// Адаптер к физике CreateMovement; логика пушки (scripts/cbc/*) общая с пушками в мире.
// Что где: блоки читаются из assembly.blocks конструкции; заряд лежит в Map по ключу сессии и клетки (+ dynamic property мира);
// к скорости снаряда добавляется скорость точки дула, отдача уходит импульсом в тело (applyImpulseAt).
// Единицы CreateMovement: скорость тела в блоках/тик (как у сущностей Bedrock). НЕ ПРОВЕРЕНО В ИГРЕ.
import { ItemStack, system, world } from "@minecraft/server";
import { findCannon, parsePart, dirVec } from "./multiblock.js";
import { planShot, flightParams, mortarScatter } from "./fire.js";
import { ammoKind, applyLoad, chargeCapacity, describeLoad, emptyLoad, unloadFor } from "./loading.js";
import { spawnProjectile, liveCount } from "./projectiles.js";
import { muzzleBlast, shake } from "./effects.js";
import { LIMITS, rulesOf } from "./config/overrides.js";
import { getLoadAt, setLoadAt, getElevAt, setElevAt, clearLoadAt } from "./world.js";
import { effectiveTypeId } from "../core/gauntlet.js";
import { S } from "./settings.js";
import { fuzeFromItem, fuzeLore } from "./fuze.js";

const FACING = "minecraft:facing_direction";
const DIRS = ["north", "south", "east", "west", "up", "down"];
const PROP = "cbc:cm_loads";
const PROP_EL = "cbc:cm_elev";
const ELEV_STEP = 5, D2R = Math.PI / 180;
const HORIZ = new Set(["north", "south", "east", "west"]);
const AIM_UP = "phys:gg_aim", AIM_DN = "phys:gg_aim_dn";
const AIR = { typeId: "minecraft:air", facing: undefined };
const kx = (p) => `${p.x},${p.y},${p.z}`;

let sessions;           // Map ключ -> сессия конструкции CreateMovement
const loads = new Map(); // `${ключ сессии}|x,y,z` -> строка "снаряд,заряды,взрыватель"
const lastShot = new Map();
const lastUse = new Map();   // id игрока -> тик последнего клика по пушке
const elevs = new Map();  // тот же ключ -> угол возвышения, градусы
let dirty = false;
let aimVersion = 0;   // шаг 114: растёт при каждой смене угла наводки (main.js обновляет визуал ствола)

export function installCbcMount(sessionMap) {
  sessions = sessionMap;
  world.afterEvents.worldLoad.subscribe(() => {
    try { const raw = world.getDynamicProperty(PROP); if (typeof raw === "string") for (const [k, v] of Object.entries(JSON.parse(raw))) loads.set(k, v); }
    catch (e) { __R.log("warn", `[CBC] не удалось прочитать заряды на конструкциях: ${e}`); }
    try { const raw = world.getDynamicProperty(PROP_EL); if (typeof raw === "string") for (const [k, v] of Object.entries(JSON.parse(raw))) elevs.set(k, Number(v) || 0); }
    catch (e) { __R.log("warn", `[CBC] не удалось прочитать углы наводки: ${e}`); }
  });
  system.runInterval(() => {
    if (!dirty) return;
    dirty = false;
    try {
      // шаг 112: ключ сессии сам содержит «|» (`измерение|x,y,z`), а ключ заряда = `ключ сессии|клетка`. Раньше ключ резался по первому «|»
      // и никогда не совпадал с живой сессией, поэтому каждые 5 секунд после любого клика ВСЕ заряды на технике стирались (то порох, то снаряд).
      const owner = (k) => k.slice(0, k.lastIndexOf("|"));
      if (sessions.size > 0) {
        const live = new Set([...sessions.keys()].map(String));
        for (const k of [...loads.keys()]) if (!live.has(owner(k))) loads.delete(k);
        for (const k of [...elevs.keys()]) if (!live.has(owner(k))) elevs.delete(k);
      }
      world.setDynamicProperty(PROP_EL, JSON.stringify(Object.fromEntries(elevs)));
      world.setDynamicProperty(PROP, JSON.stringify(Object.fromEntries(loads)));
    } catch (e) { __R.log("warn", `[CBC] не удалось сохранить заряды: ${e}`); }
  }, 100);
}

function readerOf(session) {
  const map = new Map();
  for (const b of session.assembly.blocks) {
    const f = b.contraptionStates?.[FACING];
    map.set(kx(b.localLocation), { typeId: b.typeId ?? b.itemTypeId, facing: typeof f === "string" && DIRS.includes(f) ? f : undefined });
  }
  return (p) => map.get(kx(p)) ?? AIR;
}
const cbcBlockAt = (session, p) => session.assembly.blocks.find((b) => kx(b.localLocation) === kx(p));

function findOf(session, cell) {
  const found = findCannon({ x: cell.x, y: cell.y, z: cell.z }, readerOf(session));
  if (!found) return undefined;
  let sk;
  for (const [k, v] of sessions.entries()) if (v === session) { sk = k; break; }
  return { scan: found.scan, breech: found.breech, key: `${sk}|${kx(found.breech)}` };
}
function getLoad(key) {
  const raw = loads.get(key);
  if (typeof raw !== "string") return emptyLoad();
  const [p, ch, fz] = raw.split(",");
  return { projectileId: p && p !== "-" ? p : undefined, charges: Number(ch) || 0, fuze: Number(fz) || 0 };
}
function putLoad(key, load) {
  if (!load.projectileId && !(load.charges > 0)) loads.delete(key);
  else loads.set(key, `${load.projectileId ?? "-"},${Math.max(0, load.charges | 0)},${Math.max(0, Math.round(load.fuze || 0))}`);
  dirty = true;
}
function elevRange(scan) {
  if (!HORIZ.has(scan.direction)) return { min: 0, max: 0 };
  const r = rulesOf(scan);
  return { min: r.elevMin ?? 0, max: r.elevMax ?? 0 };
}
const canAim = (scan) => { const r = elevRange(scan); return r.max > r.min; };
function getElev(key, scan) {
  const { min, max } = elevRange(scan);
  const v = elevs.get(key);
  return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : 0;
}
function putElev(key, deg) { if (deg === 0) elevs.delete(key); else elevs.set(key, deg); dirty = true; aimVersion++; }
const fmtDeg = (d) => `${d > 0 ? "+" : ""}${d}°`;
/** Поворот вектора v вокруг горизонтальной оси, перпендикулярной стволу, на deg градусов (вверх при deg > 0). */
function tiltVec(v, dir, deg) {
  if (!deg) return v;
  const d = dirVec(dir), k = { x: -d.z, y: 0, z: d.x };
  const c = Math.cos(deg * D2R), sn = Math.sin(deg * D2R);
  const kxv = { x: k.y * v.z - k.z * v.y, y: k.z * v.x - k.x * v.z, z: k.x * v.y - k.y * v.x };
  const kv = k.x * v.x + k.y * v.y + k.z * v.z;
  return { x: v.x * c + kxv.x * sn + k.x * kv * (1 - c), y: v.y * c + kxv.y * sn + k.y * kv * (1 - c), z: v.z * c + kxv.z * sn + k.z * kv * (1 - c) };
}
function adjustElevation(session, cell, player, delta) {
  const f = findOf(session, cell); if (!f) return say(player, __t(185));
  const scan = f.scan;
  if (!scan.valid) return say(player, __t(186, scan.reason ?? "?"));
  if (!canAim(scan)) return say(player, __t(187));
  if (towerTurnOf(session, f.breech)) return say(player, "§eПушка на башне: поднимайте и поворачивайте её пультом башни");
  const { min, max } = elevRange(scan);
  const raw = getElev(f.key, scan) + delta, next = Math.max(min, Math.min(max, raw));
  putElev(f.key, next);
  const hint = scan.materialId === "cast_iron" ? __t(188) : "";
  say(player, next !== raw ? __t(190, fmtDeg(next), min, max, raw < min ? hint : "") : __t(191, fmtDeg(next), min, max));
}
function say(player, text) { try { __R.actionBar(player, text); } catch { /* игрок вышел */ } }
function consumeHeld(player, typeId) {
  try {
    if (String(player.getGameMode()).toLowerCase() === "creative") return true;
    const slot = player.getComponent("minecraft:inventory").container.getSlot(player.selectedSlotIndex);
    if (!slot.hasItem() || (typeId && slot.typeId !== typeId)) return false;
    if (slot.amount > 1) slot.amount = slot.amount - 1; else slot.setItem(undefined);
    return true;
  } catch { return false; }
}

function loadInto(session, cell, player, typeId, fuze) {
  const f = findOf(session, cell); if (!f) return say(player, __t(185));
  const res = applyLoad(f.scan, getLoad(f.key), typeId, fuze);
  let ok = res.ok;
  if (res.ok) { if (consumeHeld(player, typeId)) putLoad(f.key, res.load); else ok = false; }
  say(player, ok ? `§a[CBC] ${res.message}` : `§c[CBC] ${res.ok ? __t(192) : res.message}`);
}
function unloadFrom(session, cell, player, typeId) {
  const f = findOf(session, cell); if (!f || !f.scan.valid) return;
  const res = unloadFor(getLoad(f.key), typeId);
  if (!res.ok || !res.itemId) return;
  const item = new ItemStack(res.itemId, 1);
  const lore = res.fuze ? fuzeLore(res.fuze) : [];
  if (lore.length) __R.setLore(item, lore);
  putLoad(f.key, res.load);
  try { player.dimension.spawnItem(item, player.location); } catch { /* чанк не загружен */ }
  say(player, __t(203, res.message, res.load.charges, chargeCapacity(f.scan), res.load.projectileId));
}

function fire(session, cell, player) {
  if (S.frozen) return say(player, __t(142));
  const f = findOf(session, cell); if (!f) return say(player, __t(185));
  const now = system.currentTick;
  if (now - (lastShot.get(f.key) ?? -1e9) < LIMITS.fireCooldownTicks) return say(player, __t(198));
  const load = getLoad(f.key);
  const sc = f.scan;
  const plan = planShot(sc, load);
  if (!plan.ok) return say(player, `§c[CBC] ${plan.reason ?? __t(160)}`);
  if (liveCount() >= LIMITS.maxProjectilesAlive) return say(player, __t(159));
  const body = session.assembly.body, dim = session.dimension ?? player.dimension;
  const tw = towerTurnOf(session, sc.breechPos), twa = tw?.active ? tw : undefined;   // шаг 140: выстрел из повёрнутой башней пушки
  const th = canAim(sc) && !tw ? getElev(f.key, sc) : 0;
  const d0 = dirVec(sc.direction), cs = Math.cos(th * D2R), sn = Math.sin(th * D2R);
  const d = { x: d0.x * cs, y: d0.y * cs + sn, z: d0.z * cs };   // ствол с учётом наводки
  const p0 = { x: sc.breechPos.x + 0.5, y: sc.breechPos.y + 0.5, z: sc.breechPos.z + 0.5 };
  const n = Math.abs(sc.muzzlePos.x - sc.breechPos.x) + Math.abs(sc.muzzlePos.y - sc.breechPos.y) + Math.abs(sc.muzzlePos.z - sc.breechPos.z);
  const P0 = twa ? twa.point(p0) : p0;
  const atWorld = (dist) => { const q = { x: p0.x + d.x * dist, y: p0.y + d.y * dist, z: p0.z + d.z * dist }; return body.localPointToWorld(twa ? twa.point(q) : q); };
  const dirWorld = (v) => { const u = twa ? twa.dir(v) : v, a = body.localPointToWorld(P0), b = body.localPointToWorld({ x: P0.x + u.x, y: P0.y + u.y, z: P0.z + u.z }); return { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }; };
  const origin = atWorld(n + 1.2);
  let vel;
  try {
    let v = tiltVec(plan.velocity, sc.direction, th);
    if ((sc.mortars ?? 0) > 0) v = mortarScatter(v, sc.mortars, th, flightParams(plan.munitionId), sc.direction === "up" || sc.direction === "down");
    const vw = dirWorld(v), bv0 = body.getVelocityAt(origin);   // шаг 150: физика отдаёт блоки/секунду, снаряд летит в блоках/тик -> делим на 20
    vel = { x: vw.x + bv0.x / 20, y: vw.y + bv0.y / 20, z: vw.z + bv0.z / 20 };
    spawnProjectile(dim, origin, vel, plan.munitionId, load.fuze ?? 0, { owner: session });
  } catch (err) { return say(player, __t(161, err)); }
  lastShot.set(f.key, now);
  putLoad(f.key, emptyLoad());
  const dw = dirWorld(d);
  try { dim.playSound("cbc.fire_big_cannon", origin, { volume: 4 }); } catch { /* звук не критичен */ }
  muzzleBlast(dim, atWorld(n + 0.6), dw, load.charges);
  shake(dim, atWorld(n), load.charges);
  try {   // отдача: импульс против ствола, не больше ~0.15 блока/тик прироста скорости
    const speed = Math.hypot(vel.x, vel.y, vel.z) * 20;
    const imp = Math.min(speed * (2 + load.charges), 3 * body.getMass()) / 20;
    body.applyImpulseAt(atWorld(0), { x: -dw.x * imp, y: -dw.y * imp, z: -dw.z * imp });
  } catch { /* отдача не критична */ }
}

/** Вызывается первой строкой обработчика playerInteractWithBlock (before). true = клик обработан. */
export function cbcQueueUse(event, player, raycast) {
  try {
    if (!sessions || sessions.size === 0 || event.isFirstEvent === false) return false;
    const item = event.itemStack, t = effectiveTypeId(item);
    const aim = t === AIM_UP || t === AIM_DN;
    if (t !== undefined && t !== "minecraft:flint_and_steel" && !aim && !ammoKind(t)) return false;
    const hit = raycast(player);
    const local = hit?.hit?.block?.localLocation;
    if (!local || !parsePart(hit.snapshot?.typeId ?? hit.hit.block.typeId)) return false;
    event.cancel = true;
    // шаг 110: один клик приходит сразу из нескольких событий (itemUse / блок / сущность), а удержание ПКМ повторяет их: одно действие на 5 тиков
    const now = system.currentTick;
    if (now - (lastUse.get(player.id) ?? -100) < 5) return true;
    lastUse.set(player.id, now);
    const session = hit.session, cell = { x: local.x, y: local.y, z: local.z };
    system.run(() => {
      try {
        if (t === undefined) { const f = findOf(session, cell); if (!f) return say(player, __t(185)); say(player, `§e[CBC] ${describeLoad(getLoad(f.key))} (${chargeCapacity(f.scan)})`); }
        else if (t === "minecraft:flint_and_steel") fire(session, cell, player);
        else if (aim) adjustElevation(session, cell, player, t === AIM_DN ? -ELEV_STEP : ELEV_STEP);
        else if (player.isSneaking) unloadFrom(session, cell, player, t);
        else loadInto(session, cell, player, t, fuzeFromItem(item));
      } catch (e) { __R.log("warn", `[CBC] ошибка пушки на конструкции: ${e}`); }
    });
    return true;
  } catch { return false; }
}


// ---- перенос заряда и угла между миром и конструкцией -----------------------------------------------------------------
const cellMatches = (blocks, rel) => blocks.find((b) => kx(b.localLocation) === kx(rel))
  ?? blocks.find((b) => Math.abs(b.localLocation.x - rel.x) <= 0.51 && Math.abs(b.localLocation.y - rel.y) <= 0.51 && Math.abs(b.localLocation.z - rel.z) <= 0.51);
const relOf = (session, s) => ({ x: s.location.x - session.location.x, y: s.location.y - session.location.y, z: s.location.z - session.location.z });

/** Конструкцию собрали: заряд и угол пушек, стоявших в мире, переезжают на конструкцию. Вызывать после sessions.set(key, session). */
export function cbcOnAssemble(session, key) {
  try {
    for (const s of session.snapshots ?? []) {
      if (!parsePart(s.typeId)) continue;
      const load = getLoadAt(session.dimension.id, s.location), elev = getElevAt(session.dimension.id, s.location);
      if (!load.projectileId && !(load.charges > 0) && !elev) continue;
      const b = cellMatches(session.assembly.blocks, relOf(session, s));
      if (!b) continue;
      const ck = `${key}|${kx(b.localLocation)}`;
      if (load.projectileId || load.charges > 0) putLoad(ck, load);
      if (elev) putElev(ck, elev);
      clearLoadAt(session.dimension.id, s.location);
    }
  } catch (e) { __R.log("warn", `[CBC] перенос заряда при сборке: ${e}`); }
}

/** Конструкцию разобрали: заряд и угол возвращаются пушкам в мире. restoreSnapshots - снимки с targetLocation. Вызывать до удаления сессии. */
export function cbcOnDisassemble(session, key, restoreSnapshots) {
  try {
    for (const s of restoreSnapshots ?? []) {
      if (!parsePart(s.typeId)) continue;
      const b = cellMatches(session.assembly.blocks, relOf(session, s));
      if (!b) continue;
      const ck = `${key}|${kx(b.localLocation)}`;
      const load = getLoad(ck), elev = elevs.get(ck) ?? 0;
      if (load.projectileId || load.charges > 0) setLoadAt(session.dimension.id, s.targetLocation, load);
      if (elev) setElevAt(session.dimension.id, s.targetLocation, elev);
      loads.delete(ck); elevs.delete(ck); dirty = true;
    }
  } catch (e) { __R.log("warn", `[CBC] перенос заряда при разборке: ${e}`); }
}


// ---- шаг 114: визуальная наводка на технике ---------------------------------------------------------------------------
// Детали пушки на конструкции рисуются отдельными сущностями (local_x/y/z, local_pitch/roll). Чтобы ствол наклонялся, каждая деталь
// поворачивается вокруг горизонтальной оси, перпендикулярной стволу, через центр казённика: сдвиг = R*(k*d) - k*d, поворот = угол возвышения.
export const cbcAimVersion = () => aimVersion;
/** Map `x,y,z` клетки детали -> { dx, dy, dz (блоки), pitch, roll (градусы вокруг оси x и z конструкции) } для пушек с ненулевым углом. */
export function cbcAimPoses(session) {
  const out = new Map();
  try {
    if (!sessions) return out;
    let sk; for (const [k, v] of sessions.entries()) if (v === session) { sk = k; break; }
    if (sk === undefined) return out;
    const read = readerOf(session), done = new Set();
    for (const b of session.assembly.blocks) {
      if (!parsePart(b.typeId ?? b.itemTypeId)) continue;
      const found = findCannon({ x: b.localLocation.x, y: b.localLocation.y, z: b.localLocation.z }, read);
      if (!found || !found.scan.valid) continue;
      const bk = kx(found.breech);
      if (done.has(bk)) continue;
      done.add(bk);
      const scan = found.scan;
      if (!canAim(scan) || towerTurnOf(session, found.breech)) continue;   // шаг 140: на башне подъём даёт башня
      const th = getElev(`${sk}|${bk}`, scan);
      if (!th) continue;
      const d = dirVec(scan.direction);
      const n = Math.abs(scan.muzzlePos.x - scan.breechPos.x) + Math.abs(scan.muzzlePos.y - scan.breechPos.y) + Math.abs(scan.muzzlePos.z - scan.breechPos.z);
      // ось подъёма k = (-d.z, 0, d.x): север/юг -> ось x, восток/запад -> ось z (правая система, подъём вверх при th > 0)
      const kv = { x: -d.z, z: d.x };
      for (let i = 0; i <= n; i++) {
        const r = { x: d.x * i, y: 0, z: d.z * i }, t = tiltVec(r, scan.direction, th);
        out.set(kx({ x: scan.breechPos.x + d.x * i, y: scan.breechPos.y, z: scan.breechPos.z + d.z * i }),
          { dx: t.x - r.x, dy: t.y - r.y, dz: t.z - r.z, pitch: kv.x * th, roll: kv.z * th });
      }
    }
  } catch (e) { __R.log("warn", `[CBC] визуальная наводка: ${e}`); }
  return out;
}
