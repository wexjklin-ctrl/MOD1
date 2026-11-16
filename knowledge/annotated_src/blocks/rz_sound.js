/* CLAUDE-MAP-BEGIN
 FILE: blocks/rz_sound.js  (5 KB, 97 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (auto, from first comment) RZ Lite: звук работающего двигателя (порт core/engineSound.js из RZ).
 IMPORTS: @minecraft/server
 IMPORTED BY: blocks/rz_drive.js
 EXPORTS: rzEngineSound, rzEngineSoundCleanup, installRzSound
 EVENTS: scriptEventReceive
 DYN-PROPS: rzlite:snd_on, rzlite:snd_vol
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): rzEngineSound@44(33L); installRzSound@80(17L); loadProps@35(7L); profileOf@30(5L); playAt@26(4L); rzEngineSoundCleanup@77(3L); clamp01@20(1L); lerp@21(1L); approach@22(1L); smooth@23(1L); pad2@24(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// RZ Lite: звук работающего двигателя (порт core/engineSound.js из RZ).
// playSound() запускает звук в одной точке, поэтому запись нарезана на короткие куски
// (холостой: 24 по 0.4 с, движение: 25 по 0.2 с), а скрипт запускает следующий кусок впереди машины.
// Команда: /scriptevent rzlite:sound on | off | vol <0..2>
import { system, world } from "@minecraft/server";

const IDLE_CHUNKS = 24, MOVE_CHUNKS = 25, IDLE_PERIOD = 8, MOVE_PERIOD = 4;
const IDLE_VOLUME = 1.25, MOVE_VOLUME = 1.45, MIX_FROM = 0.03, MIX_TO = 0.30;
const PITCH_MIN = 0.94, PITCH_MAX = 1.12, PITCH_CEIL = 1.25, PITCH_SMOOTH = 0.2;
const IDLE_UP = 0.22, IDLE_DOWN = 0.12, MOVE_UP = 0.16, MOVE_DOWN = 0.07, STOP_DOWN = 0.2, MIN_AUDIBLE = 0.04;
const PROFILES = {
  "tfmg:simple_large_engine": { idle: "v8classic", move: "normal" },
  "tfmg:large_engine": { idle: "c2", move: "normal" },
  "cdg:diesel_engine": { idle: "yj", move: "jeep" },
  "cdg:modular_diesel_engine": { idle: "xj", move: "jeep" },
};
const DEFAULT_PROFILE = { idle: "v8classic", move: "normal" };
let enabled = true, master = 1, loaded = false;
const states = new Map();
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;
const approach = (v, t, up, down) => v + (t - v) * (t > v ? up : down);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const pad2 = n => (n < 10 ? "0" + n : String(n));

function playAt(dim, id, pos, volume, pitch) {
  try { dim.playSound(id, pos, { volume, pitch }); }
  catch { try { dim.runCommand(`playsound ${id} @a ${pos.x.toFixed(2)} ${pos.y.toFixed(2)} ${pos.z.toFixed(2)} ${volume.toFixed(2)} ${pitch.toFixed(3)}`); } catch {} }
}
function profileOf(info) {
  let best, bp = -1;
  for (const c of info?.clusters ?? []) if (c.connected !== false && c.power > bp) { bp = c.power; best = c; }
  return (best ? PROFILES[best.type] : undefined) ?? DEFAULT_PROFILE;
}
function loadProps() {
  try {
    if (world.getDynamicProperty("rzlite:snd_on") === false) enabled = false;
    const v = world.getDynamicProperty("rzlite:snd_vol"); if (typeof v === "number" && v >= 0 && v <= 2) master = v;
    loaded = true;
  } catch {}
}

/** Раз в тик для машины с двигателем RZ. on: двигатель работает; speed, vmax в м/с; throttle 0..1; b: { px,py,pz,vx,vz }. */
export function rzEngineSound(tick, key, dim, info, on, speed, vmax, throttle, b) {
  if (!loaded) loadProps();
  if (!enabled) return;
  let st = states.get(key);
  if (!st) {
    if (!on) return;
    let h = 7; for (const ch of String(key)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0; h = Math.abs(h);
    st = { seen: tick, idle: 0, move: 0, pitch: 1, idleCur: h % IDLE_CHUNKS, moveCur: (h >> 3) % MOVE_CHUNKS, idleNext: tick + (h % IDLE_PERIOD), moveNext: tick + (h % MOVE_PERIOD), profile: profileOf(info) };
    states.set(key, st);
  }
  st.seen = tick;
  if (on && tick % 40 === 0) st.profile = profileOf(info);
  const prof = st.profile;
  const rev = clamp01(Math.max(speed / Math.max(vmax, 1), throttle * 0.35));
  const x = smooth(MIX_FROM, MIX_TO, rev);
  st.idle = approach(st.idle, on ? Math.cos(x * Math.PI / 2) : 0, IDLE_UP, on ? IDLE_DOWN : STOP_DOWN);
  st.move = approach(st.move, on ? Math.sin(x * Math.PI / 2) : 0, MOVE_UP, on ? MOVE_DOWN : STOP_DOWN);
  st.pitch += (lerp(PITCH_MIN, PITCH_MAX, rev) - st.pitch) * PITCH_SMOOTH;
  const lead = t => ({ x: b.px + b.vx * t / 20, y: b.py + 0.5, z: b.pz + b.vz * t / 20 });
  if (tick >= st.idleNext) {
    st.idleNext = tick - st.idleNext > IDLE_PERIOD ? tick + IDLE_PERIOD : st.idleNext + IDLE_PERIOD;
    const level = st.idle * IDLE_VOLUME * master;
    if (st.idle > MIN_AUDIBLE && level > 0) playAt(dim, `phys.eng.idle.${prof.idle}.${pad2(st.idleCur)}`, lead(IDLE_PERIOD / 2), level, 1);
    st.idleCur = (st.idleCur + 1) % IDLE_CHUNKS;
  }
  if (tick >= st.moveNext) {
    st.moveNext = tick - st.moveNext > MOVE_PERIOD ? tick + MOVE_PERIOD : st.moveNext + MOVE_PERIOD;
    const level = st.move * MOVE_VOLUME * master;
    if (st.move > MIN_AUDIBLE && level > 0) playAt(dim, `phys.eng.move.${prof.move}.${pad2(st.moveCur)}`, lead(MOVE_PERIOD / 2), level, Math.min(st.pitch, PITCH_CEIL));
    st.moveCur = (st.moveCur + 1) % MOVE_CHUNKS;
  }
  if (!on && st.idle < 0.01 && st.move < 0.01) states.delete(key);
}
export function rzEngineSoundCleanup(tick) {
  for (const [k, st] of states) if (tick - st.seen > 60) states.delete(k);
}
export function installRzSound() {
  loadProps();
  try {
    system.afterEvents.scriptEventReceive.subscribe(ev => {
      if (ev.id !== "rzlite:sound") return;
      const reply = t => { try { ev.sourceEntity?.sendMessage?.(t); } catch {} };
      const a = ev.message.trim().toLowerCase().split(/\s+/);
      if (a[0] === "off") { enabled = false; world.setDynamicProperty("rzlite:snd_on", false); reply("Звук двигателей: выкл"); }
      else if (a[0] === "on") { enabled = true; world.setDynamicProperty("rzlite:snd_on", true); reply("Звук двигателей: вкл"); }
      else if (a[0] === "vol") {
        const v = Number(a[1]);
        if (Number.isFinite(v) && v >= 0 && v <= 2) { master = v; world.setDynamicProperty("rzlite:snd_vol", v); reply(`Громкость двигателей: ${v}`); }
        else reply("Использование: rzlite:sound vol <0..2>");
      } else reply(`Звук двигателей: ${enabled ? "вкл" : "выкл"}, громкость ${master}. Команды: on | off | vol <0..2>`);
    });
  } catch {}
}
