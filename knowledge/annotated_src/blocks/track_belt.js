/* CLAUDE-MAP-BEGIN
 FILE: blocks/track_belt.js  (11 KB, 180 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: RZ Lite tracked belt visuals/logic; scriptevent rzlite:track.
 IMPORTS: @minecraft/server, blocks/track_layouts.js
 IMPORTED BY: main.js
 EXPORTS: analyzeTrackBelts, installTrackBelts
 EVENTS: scriptEventReceive
 DYN-PROPS: rzlite:track_cfg
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): updateSession@80(63L); analyzeTrackBelts@25(47L); installTrackBelts@154(26L); cleanOrphans@145(8L); setProp@75(4L); keyOf@20(3L); saveCfg@18(1L); removeBelt@74(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// RZ Lite: гусеничная лента RZ на конструкциях CreateMovement (не проверено в игре).
// Катки и звёздочки trackwork:* остаются колёсами CM (wheel_mount). Этот модуль ищет группы таких колёс в одной плоскости,
// подбирает готовую раскладку RZ (track_layouts.js) и рисует поверх неё ленту отдельной сущностью create_physics:track_belt.
// Лента едет сдвигом UV (клиентская переменная v.tk копится из свойства create_physics:track_speed, px/с); звёздочки и катки
// крутит анимация track_belt.spin (запечённые кости из RZ). Шаг 11: сущность ленты едет всадником на коллекторе конструкции
// (assembly.rzAttachExtra в physics.js), поэтому её положение задаётся один раз и не телепортируется.
import { world, system } from "@minecraft/server";
import { TRACK_KEYS } from "./track_layouts.js";

const ENTITY = "create_physics:track_belt";
const TAG = "rz_track_belt";
const CODE = { 4: "w", 5: "a", 6: "b", 7: "c" };         // номер варианта колеса -> код ячейки раскладки (wheel_variants.js)
const PX_PER_BLOCK = 16;

// Настройки на случай, если в игре лента развёрнута/смещена: /scriptevent rzlite:track <команда>
const cfg = { yawOffset: 0, beltInv: false, offX: 0, offY: 0, offZ: 0, enabled: true };
try { const raw = world.getDynamicProperty("rzlite:track_cfg"); if (typeof raw === "string") Object.assign(cfg, JSON.parse(raw)); } catch {}
const saveCfg = () => { try { world.setDynamicProperty("rzlite:track_cfg", JSON.stringify(cfg)); } catch {} };

function keyOf(cells) {
  return cells.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(c => c[0] + "." + c[1] + "." + c[2]).join(";");
}

/** Список лент конструкции: [{layout, ox, oy, oz (локальный низ-центр ячейки 0), dx, dz (куда смотрит +z раскладки), key}] */
export function analyzeTrackBelts(blocks) {
  const groups = new Map();
  for (const b of blocks) {
    if (b.visualEntityTypeId !== "create_physics:physics_wheel") continue;
    const code = CODE[Number(b.visualProperties?.["create_physics:wheel_variant"] ?? 0)];
    if (code === undefined || !b.localLocation) continue;
    const yaw = (b.rotation?.y ?? 0) * Math.PI / 180;
    const rollX = Math.abs(Math.sin(yaw)) > Math.abs(Math.cos(yaw));     // направление качения: ось x или z (ось колеса поперёк)
    const cx = Math.round(b.localLocation.x), cy = Math.round(b.localLocation.y), cz = Math.round(b.localLocation.z);
    const lat = rollX ? cz : cx, t = rollX ? cx : cz;
    const gk = (rollX ? "x" : "z") + lat;
    let g = groups.get(gk);
    if (g === undefined) groups.set(gk, g = { rollX, lat, items: [] });
    g.items.push({ y: cy, t, code });
  }
  const out = [];
  for (const g of groups.values()) {
    if (g.items.length < 2) continue;
    const dirT = g.rollX ? [1, 0] : [0, 1];
    // шаг 108: точная раскладка, а если такой готовой нет - лучшая из тех, что получаются без 1-2 крайних/лишних катков
    const lookup = items => {
      let y0 = 1e9, t0 = 1e9, t1 = -1e9;
      for (const it of items) { if (it.y < y0) y0 = it.y; if (it.t < t0) t0 = it.t; if (it.t > t1) t1 = it.t; }
      const a = items.map(it => [it.y - y0, it.t - t0, it.code]);
      let idx = TRACK_KEYS[keyOf(a)], mirrored = false;
      if (idx === undefined) { idx = TRACK_KEYS[keyOf(a.map(c => [c[0], t1 - t0 - c[1], c[2]]))]; mirrored = idx !== undefined; }
      return idx === undefined ? undefined : { idx, mirrored, y0, t0, t1 };
    };
    let hit = lookup(g.items);
    if (!hit && g.items.length <= 14) {
      const n = g.items.length;
      for (let drop = 1; drop <= 2 && !hit && n - drop >= 2; drop++) {
        for (let i = 0; i < n && !hit; i++) {
          if (drop === 1) hit = lookup(g.items.filter((_, k) => k !== i));
          else for (let j = i + 1; j < n && !hit; j++) hit = lookup(g.items.filter((_, k) => k !== i && k !== j));
        }
      }
    }
    if (!hit) continue;                                                // нет готовой раскладки: колёса остаются без ленты
    const { idx, mirrored, y0, t0, t1 } = hit;
    const tStart = mirrored ? t1 : t0;
    const dx = mirrored ? -dirT[0] : dirT[0], dz = mirrored ? -dirT[1] : dirT[1];
    const ox = g.rollX ? tStart : g.lat, oz = g.rollX ? g.lat : tStart;
    out.push({ layout: idx, ox, oy: y0, oz, dx, dz, key: `L${idx}|${ox},${y0},${oz}|${dx},${dz}` });
  }
  return out;
}

const live = new Map();     // session -> { blocks, count, belts: Map(key -> state) }
function removeBelt(st) { try { st.assembly?.rzDetachExtra?.(st.entity); } catch {} try { if (st.entity?.isValid) st.entity.remove(); } catch {} }
function setProp(st, name, value) {
  if (st.props.get(name) === value) return;
  try { st.entity.setProperty(name, value); st.props.set(name, value); } catch {}
}

function updateSession(session, tick) {
  const assembly = session.assembly;
  let rec = live.get(session);
  if (!assembly?.isValid || !assembly.body?.isValid) { if (rec) { for (const s of rec.belts.values()) removeBelt(s); live.delete(session); } return; }
  if (rec === undefined) live.set(session, rec = { blocks: null, count: -1, belts: new Map(), cfgRev: -1 });
  const blocks = assembly.blocks;
  if (rec.blocks !== blocks || rec.count !== blocks.length) {
    rec.blocks = blocks; rec.count = blocks.length;
    const list = cfg.enabled ? analyzeTrackBelts(blocks) : [];
    const next = new Map();
    for (const w of list) {
      const old = rec.belts.get(w.key);
      if (old) { next.set(w.key, old); rec.belts.delete(w.key); } else next.set(w.key, { w, entity: null, props: new Map(), still: false });
    }
    for (const s of rec.belts.values()) removeBelt(s);
    rec.belts = next;
  }
  const body = assembly.body;
  const sleeping = body.isSleeping === true;
  const anchor = assembly.visualAnchor ?? { x: 0, y: 1, z: 0 };
  for (const st of rec.belts.values()) {
    const w = st.w;
    if (!st.entity?.isValid) {
      try {
        const p = body.localPointToWorld(anchor);
        const e = session.dimension.spawnEntity(ENTITY, p);
        e.addTag(TAG);
        st.entity = e; st.assembly = assembly; st.props = new Map(); st.prev = null; st.speed = 0; st.attached = false;
        setProp(st, "create_physics:track_layout", w.layout);
        // положение внутри конструкции задаётся один раз: локальные координаты относительно якоря визуалов (как у блоков)
        setProp(st, "create_physics:local_pitch", 0); setProp(st, "create_physics:local_roll", 0);
        setProp(st, "create_physics:local_yaw", Math.atan2(-w.dx, -w.dz) * 180 / Math.PI + cfg.yawOffset);
        setProp(st, "create_physics:local_x", w.ox + cfg.offX - anchor.x);
        setProp(st, "create_physics:local_y", w.oy + cfg.offY - anchor.y);
        setProp(st, "create_physics:local_z", w.oz + cfg.offZ - anchor.z);
      } catch { continue; }
    }
    if (!st.attached) {
      try { st.attached = assembly.rzAttachExtra(st.entity) === true; } catch { st.attached = false; }
      if (!st.attached) continue;                                      // коллектор ещё не готов или заполнен: повтор в следующий тик
      try { assembly.syncVisuals(true); } catch {}
    }
    try {
      // скорость ленты: смещение точки борта (середина ячейки 0 ленты) между тиками, спроецированное на направление ленты
      const c = body.localPointToWorld({ x: w.ox, y: w.oy + 0.5, z: w.oz });
      let speed = st.speed;
      if (!sleeping && st.prev) {
        const f = body.localPointToWorld({ x: w.ox + w.dx, y: w.oy, z: w.oz + w.dz });
        const f0 = body.localPointToWorld({ x: w.ox, y: w.oy, z: w.oz });
        const dxw = f.x - f0.x, dyw = f.y - f0.y, dzw = f.z - f0.z, l = Math.hypot(dxw, dyw, dzw);
        if (l > 1e-6) {
          const dt = Math.max(1, tick - st.prev.tick);
          const vx = (c.x - st.prev.x) / dt, vy = (c.y - st.prev.y) / dt, vz = (c.z - st.prev.z) / dt;   // блоков/тик
          const target = (vx * dxw + vy * dyw + vz * dzw) / l * 20 * PX_PER_BLOCK * (cfg.beltInv ? -1 : 1);
          speed = st.speed + (target - st.speed) * 0.5;                // небольшое сглаживание шума позиции
        }
      } else if (sleeping) speed = 0;
      st.prev = { x: c.x, y: c.y, z: c.z, tick };
      st.speed = speed;
      setProp(st, "create_physics:track_speed", Math.max(-4000, Math.min(4000, Math.round(speed * 2) / 2)));
    } catch { /* сущность могла выгрузиться: пересоздадим в следующий тик */ }
  }
}

let lastClean = 0;
function cleanOrphans(tick) {
  if (tick - lastClean < 100) return; lastClean = tick;
  const alive = new Set();
  for (const rec of live.values()) for (const s of rec.belts.values()) if (s.entity?.isValid) alive.add(s.entity.id);
  for (const dim of ["overworld", "nether", "the_end"]) {
    try { for (const e of world.getDimension(dim).getEntities({ type: ENTITY })) if (!alive.has(e.id)) e.remove(); } catch {}
  }
}

export function installTrackBelts(sessions) {
  system.runInterval(() => {
    const tick = system.currentTick;
    try {
      for (const session of sessions.values()) updateSession(session, tick);
      for (const session of [...live.keys()]) if (![...sessions.values()].includes(session)) { for (const s of live.get(session).belts.values()) removeBelt(s); live.delete(session); }
      cleanOrphans(tick);
    } catch (err) { if (tick % 200 === 0) console.warn("[track_belt] " + err); }
  }, 1);
  system.afterEvents.scriptEventReceive.subscribe(ev => {
    if (ev.id !== "rzlite:track") return;
    const [cmd, a, b, c] = ev.message.trim().split(/\s+/);
    const say = m => { try { (ev.sourceEntity ?? world).sendMessage?.(m); } catch {} };
    if (cmd === "flip") cfg.yawOffset = (cfg.yawOffset + 180) % 360;
    else if (cmd === "yaw") cfg.yawOffset = Number(a) || 0;
    else if (cmd === "inv") cfg.beltInv = !cfg.beltInv;
    else if (cmd === "off") { cfg.offX = Number(a) || 0; cfg.offY = Number(b) || 0; cfg.offZ = Number(c) || 0; }
    else if (cmd === "off_reset") { cfg.offX = cfg.offY = cfg.offZ = 0; cfg.yawOffset = 0; cfg.beltInv = false; }
    else if (cmd === "off_on") cfg.enabled = true;
    else if (cmd === "off_off") { cfg.enabled = false; for (const rec of live.values()) { for (const s of rec.belts.values()) removeBelt(s); rec.belts.clear(); rec.count = -1; } }
    else { say("§e[track] flip | yaw <deg> | inv | off <x> <y> <z> | off_reset | off_on | off_off"); }
    for (const rec of live.values()) { rec.count = -1; }     // пересчёт
    for (const rec of live.values()) for (const s of rec.belts.values()) removeBelt(s);
    saveCfg(); say("§a[track] " + JSON.stringify(cfg));
  });
}
