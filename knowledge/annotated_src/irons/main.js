/* CLAUDE-MAP-BEGIN
 FILE: irons/main.js  (25 KB, 606 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: Iron's Arms n Artifice guns port; scriptevent irons:kit.
 IMPORTS: @minecraft/server
 IMPORTED BY: main.js
 EVENTS: itemUse, playerLeave, playerSpawn, projectileHitBlock, projectileHitEntity, scriptEventReceive
 DYN-PROPS: ia_mag
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): tryFire@502(28L); startReload@406(25L); syncHand@559(13L); hurt@461(11L); spawnBullet@450(10L); takeBullets@395(9L); updatePose@550(9L); aimDir@434(8L); onUse@532(8L); renderHud@376(7L); setMag@363(5L); countBullets@390(5L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// Iron's Arms 'n Artifice — Bedrock port (guns, ammo, animations). Gun stats extracted from the Java mod's bytecode.
// Gun animation is done by attachables in the resource pack. 3rd-person arm pose is a player-bone animation started from here via playAnimation (no player.entity.json override).
import { world, system, ItemStack } from "@minecraft/server";

const NS = "irons_artifice";
const GUNS = {
 "flintlock": {
  "id": "flintlock",
  "name": "Flintlock",
  "mag": 1,
  "reload": 40,
  "auto": false,
  "dmg": 20.0,
  "spread": 3.0,
  "blowback": 0.5,
  "delay": 1,
  "recoil": [
   35.0,
   0.45
  ],
  "speed": 0.75,
  "pellets": 1,
  "flash": [
   "large"
  ],
  "shot": "item.flintlock.shoot",
  "echo": [
   "entity.bullet.echo.muzzleloader",
   1.1
  ],
  "equip": [
   "item.flintlock.equip",
   0.75
  ],
  "cues": [
   [
    0.0,
    "item.six_shooter.holster",
    0.75
   ],
   [
    0.2,
    "item.flintlock.reload.insert_bullet",
    1.25
   ],
   [
    1.0,
    "item.flintlock.reload.pack_bullet",
    1.25
   ],
   [
    1.75,
    "item.generic.leather_accent",
    0.75
   ],
   [
    1.85,
    "item.generic.cock_hammer",
    1.25
   ]
  ],
  "firecues": [],
  "animLen": 2.2083
 },
 "musket": {
  "id": "musket",
  "name": "Musket",
  "mag": 1,
  "reload": 60,
  "auto": false,
  "dmg": 18.0,
  "spread": 0.5,
  "blowback": 0.0,
  "delay": 1,
  "recoil": [
   30.0,
   0.45
  ],
  "speed": 1.5,
  "pellets": 1,
  "flash": [
   "large"
  ],
  "shot": "item.musket.shoot",
  "echo": [
   "entity.bullet.echo.muzzleloader",
   1.15
  ],
  "equip": [
   "item.musket.equip",
   0.75
  ],
  "cues": [
   [
    0.0,
    "item.six_shooter.holster",
    1.25
   ],
   [
    0.9,
    "item.flintlock.reload.insert_bullet",
    1.25
   ],
   [
    1.7,
    "item.flintlock.reload.pack_bullet",
    1.25
   ],
   [
    2.88,
    "item.generic.leather_accent",
    1.25
   ],
   [
    2.88,
    "item.generic.cock_hammer",
    1.25
   ]
  ],
  "firecues": [],
  "animLen": 3.4167
 },
 "blackpowder_revolver": {
  "id": "blackpowder_revolver",
  "name": "Blackpowder Revolver",
  "mag": 6,
  "reload": 40,
  "auto": false,
  "dmg": 10.0,
  "spread": 1.0,
  "blowback": 0.125,
  "delay": 10,
  "recoil": [
   25.0,
   0.33
  ],
  "speed": 1.0,
  "pellets": 1,
  "flash": [
   "large"
  ],
  "shot": "item.blackpowder_revolver.shoot",
  "echo": [
   "entity.bullet.echo.generic_pistol",
   0.9
  ],
  "equip": [
   "item.blackpowder_revolver.equip",
   0.75
  ],
  "cues": [
   [
    0.0,
    "item.blackpowder_revolver.reload.start",
    1.25
   ],
   [
    1.33,
    "item.blackpowder_revolver.reload.mid",
    1.25
   ],
   [
    1.71,
    "item.blackpowder_revolver.reload.end",
    1.25
   ]
  ],
  "firecues": [
   [
    1.0,
    "item.generic.cock_hammer",
    1.0
   ]
  ],
  "animLen": 2.1667
 },
 "six_shooter": {
  "id": "six_shooter",
  "name": "Six-Shooter",
  "mag": 6,
  "reload": 20,
  "auto": false,
  "dmg": 8.0,
  "spread": 2.5,
  "blowback": 0.0,
  "delay": 3,
  "recoil": [
   15.0,
   0.5
  ],
  "speed": 1.0,
  "pellets": 1,
  "flash": [
   "small_star"
  ],
  "shot": "item.six_shooter.shoot",
  "echo": [
   "entity.bullet.echo.generic_pistol",
   1.1
  ],
  "equip": [
   "item.six_shooter.equip",
   0.75
  ],
  "cues": [
   [
    0.1,
    "item.six_shooter.holster",
    1.25
   ],
   [
    0.38,
    "item.six_shooter.equip",
    1.25
   ]
  ],
  "firecues": [],
  "animLen": 1.25
 },
 "blunderbuss": {
  "id": "blunderbuss",
  "name": "Blunderbuss",
  "mag": 2,
  "reload": 30,
  "auto": false,
  "dmg": 22.0,
  "spread": 7.0,
  "blowback": 0.75,
  "delay": 1,
  "recoil": [
   30.0,
   0.35
  ],
  "speed": 1.0,
  "pellets": 8,
  "flash": [
   "large"
  ],
  "shot": "item.blunderbuss.shoot",
  "echo": [
   "entity.bullet.echo.muzzleloader",
   0.75
  ],
  "equip": [
   "item.blunderbuss.reload.break_action_close",
   0.75
  ],
  "cues": [
   [
    0.25,
    "item.blunderbuss.reload.break_action_open",
    1.25
   ],
   [
    0.9,
    "item.blunderbuss.reload.mid",
    1.25
   ],
   [
    1.15,
    "item.generic.cock_hammer",
    1.25
   ],
   [
    1.27,
    "item.blunderbuss.reload.break_action_close",
    1.25
   ]
  ],
  "firecues": [],
  "animLen": 1.9167
 },
 "clockwork_rifle": {
  "id": "clockwork_rifle",
  "name": "Clockwork Rifle",
  "mag": 10,
  "reload": 30,
  "auto": true,
  "dmg": 7.0,
  "spread": 2.0,
  "blowback": 0.05,
  "delay": 4,
  "recoil": [
   7.5,
   0.35
  ],
  "speed": 1.0,
  "pellets": 1,
  "flash": [
   "triangle",
   "small_star"
  ],
  "shot": "item.clockwork_rifle.shoot",
  "echo": [
   "entity.bullet.echo.generic",
   1.0
  ],
  "equip": [
   "item.clockwork_rifle.equip",
   0.75
  ],
  "cues": [
   [
    0.38,
    "item.clockwork_rifle.reload.eject_mag",
    1.25
   ],
   [
    1.04,
    "item.clockwork_rifle.reload.insert_mag",
    1.25
   ]
  ],
  "firecues": [],
  "animLen": 1.625
 }
};
// RZ release: boosted damage. Unarmoured 20 HP mobs die in 1-2 hits (heavy guns 1, light guns 2), 40 HP mobs in 1-4 hits.
const RZ_DMG = { flintlock: 40, musket: 40, blackpowder_revolver: 20, six_shooter: 10, blunderbuss: 60, clockwork_rifle: 10 };
for (const [k, v] of Object.entries(RZ_DMG)) GUNS[k].dmg = v;
// colour variants of the clockwork rifle: same stats, bigger magazine
for (const [suffix, name, mag] of [["grey", "Clockwork Rifle (Grey)", 27], ["purple", "Clockwork Rifle (Purple)", 60]]) {
  const id = `clockwork_rifle_${suffix}`; GUNS[id] = { ...GUNS.clockwork_rifle, id, name, mag };
}
// gold / pink variants: same stats and animations as the originals, only look differs; the pink dual is two six-shooters (6+6 rounds, alternating hands)
const variant = (src, id, name, extra = {}) => { GUNS[id] = { ...GUNS[src], id, name, ...extra }; };
variant("musket", "musket_gold", "Golden Musket", { glyph: 0xE720 });
variant("blunderbuss", "blunderbuss_gold", "Golden Blunderbuss", { glyph: 0xE720 });   // gold guns: gold-ingot ammo icons, normal projectiles
variant("blackpowder_revolver", "blackpowder_revolver_gold", "Golden Blackpowder Revolver", { glyph: 0xE720 });
variant("six_shooter", "six_shooter_pink", "Pink Six-Shooter", { flash: ["small_star_pink"], glyph: 0xE710 });
variant("six_shooter", "six_shooter_dual_pink", "Pink Dual Six-Shooters", { flash: ["small_star_pink"], glyph: 0xE710, mag: 12, reload: 40, dual: true, animLen: 2.0, cues: [[0.1, "item.six_shooter.holster", 1.25], [0.38, "item.six_shooter.equip", 1.25], [1.1, "item.six_shooter.holster", 1.25], [1.38, "item.six_shooter.equip", 1.25]] });
const DUAL_LEFT_CD = 13;   // left-hand shot cooldown (ticks); right-hand shot uses the normal cd. The RP controller tells the hands apart by this cooldown length
const BULLET = `${NS}:bullet`;
const BULLET_ENT = `${NS}:bullet_projectile`, SHOT_ENT = `${NS}:shot_projectile`;   // flying projectile entities: brass cartridge / grey pellet
const PROJ = { blackpowder_revolver: BULLET_ENT, six_shooter: BULLET_ENT, clockwork_rifle: BULLET_ENT, clockwork_rifle_grey: BULLET_ENT, clockwork_rifle_purple: BULLET_ENT, flintlock: SHOT_ENT, musket: SHOT_ENT, blunderbuss: SHOT_ENT };   // which projectile each gun fires
const HEART_ENT = `${NS}:heart_projectile`;   // pink guns fire hearts
Object.assign(PROJ, { musket_gold: SHOT_ENT, blunderbuss_gold: SHOT_ENT, blackpowder_revolver_gold: BULLET_ENT, six_shooter_pink: HEART_ENT, six_shooter_dual_pink: HEART_ENT });
const isProj = (id) => id === BULLET_ENT || id === SHOT_ENT || id === HEART_ENT;
const BULLET_SPEED = 2.5;                 // blocks per tick, multiplied by gun speed
// fire cooldown (ticks) = length of the fire animation, so the animation always finishes between shots; must match the RP controllers
const FIRE_ANIM = { flintlock: 1.0, musket: 0.7917, blackpowder_revolver: 0.75, six_shooter: 0.4583, blunderbuss: 0.7083, clockwork_rifle: 0.375, clockwork_rifle_grey: 0.375, clockwork_rifle_purple: 0.375, musket_gold: 0.7917, blunderbuss_gold: 0.7083, blackpowder_revolver_gold: 0.75, six_shooter_pink: 0.4583, six_shooter_dual_pink: 0.4583 };
for (const g of Object.values(GUNS)) g.cd = g.auto ? Math.max(2, g.delay) : Math.max(g.delay, Math.ceil(FIRE_ANIM[g.id] * 20));
const cat = (g) => `ia_${g.id}`;          // cooldown category, same as in the item json

const gunOf = (item) => (item && item.typeId.startsWith(NS + ":")) ? GUNS[item.typeId.slice(NS.length + 1)] : undefined;
const rand = (a, b) => a + Math.random() * (b - a);
const V = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  mul: (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
  len: (a) => Math.hypot(a.x, a.y, a.z),
  norm: (a) => { const l = V.len(a) || 1; return V.mul(a, 1 / l); },
  cross: (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }),
  dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
};
const safe = (fn) => { try { return fn(); } catch (e) { return undefined; } };

// ---------- per-player runtime state ----------
const S = new Map(); // id -> { nextFire, reload:{token,end,slot,gun}, lastUseTick, lastSlot, lastType, wasSneak }
const st = (p) => { let s = S.get(p.id); if (!s) { s = { nextFire: 0, reload: null, auto: false, lastUseTick: -1, lastSlot: -1, lastType: "", token: 0 }; S.set(p.id, s); } return s; };

// ---------- ammo in magazine is stored on the stack ----------
const getMag = (item) => item.getDynamicProperty("ia_mag") ?? 0;
function setMag(player, slot, item, n, g) {
  item.setDynamicProperty("ia_mag", n);
  item.setLore([`§7${g.name}`, `§6Ammo: ${n}/${g.mag}`]);
  player.getComponent("inventory").container.setItem(slot, item);
}
// ---------- ammo HUD: one cartridge glyph per magazine slot (font/glyph_E7.png, U+E700..E705 = brass -> grey), shown in the action bar (moved to the right corner by ui/hud_screen.json) ----------
const GLYPH = 0xE700, GLYPH_FRAMES = 5;
function slotsOf(s, g) { if (!s.slots || s.slots.length !== g.mag) s.slots = Array.from({ length: g.mag }, () => ({ v: 0, t: 0 })); return s.slots; }
function setAmmo(player, g, n, snap = false) { const sl = slotsOf(st(player), g); for (let i = 0; i < sl.length; i++) { sl[i].t = i < n ? 0 : 1; if (snap) sl[i].v = sl[i].t; } }
function hud(player, g, n, extra = "") {                 // targets only; renderHud() animates towards them
  const s = st(player); setAmmo(player, g, n);
  s.msg = null;                                           // no text next to the cartridges (it shifted them); feedback is sound only
}
function renderHud(player, s, g, force) {
  const now = system.currentTick, sl = slotsOf(s, g);
  for (const x of sl) { const d = x.t - x.v; if (d !== 0) x.v = Math.abs(d) < 0.01 ? x.t : x.v + Math.sign(d) * (x.t === 1 ? 0.25 : 0.2); }
  let str = g.mag > 12 ? String.fromCharCode(g.glyph ?? GLYPH) + " " + sl.reduce((a, x) => a + (x.v < 0.5 ? 1 : 0), 0) + "/" + g.mag : sl.map((x) => String.fromCharCode((g.glyph ?? GLYPH) + Math.round(Math.min(1, Math.max(0, x.v)) * GLYPH_FRAMES))).join("");
  if (s.msg && now < s.msg.until) str += "  " + s.msg.t;
  if (force || str !== s.lastHud || now - (s.lastHudTick ?? -99) >= 20) { s.lastHud = str; s.lastHudTick = now; safe(() => player.onScreenDisplay.setActionBar(str)); }
}

// ---------- sounds ----------
function snd(dim, loc, ev, vol = 1, pmin = 1, pmax = 1, range = 1) {
  safe(() => dim.playSound(`${NS}.${ev}`, loc, { volume: vol * range, pitch: rand(pmin, pmax) }));
}

// ---------- inventory helpers (ammo = loose bullet items) ----------
function countBullets(player) {
  const c = player.getComponent("inventory").container; let n = 0;
  for (let i = 0; i < c.size; i++) { const it = c.getItem(i); if (it?.typeId === BULLET) n += it.amount; }
  return n;
}
function takeBullets(player, want) {
  const c = player.getComponent("inventory").container; let left = want;
  for (let i = 0; i < c.size && left > 0; i++) {
    const it = c.getItem(i); if (it?.typeId !== BULLET) continue;
    const t = Math.min(it.amount, left); left -= t;
    if (it.amount - t <= 0) c.setItem(i, undefined); else { it.amount -= t; c.setItem(i, it); }
  }
  return want - left;
}

// ---------- reload ----------
function startReload(player, slot, item, g) {
  const s = st(player), now = system.currentTick;
  if (s.reload) return;
  const mag = getMag(item);
  if (mag >= g.mag) { hud(player, g, mag, " §a(full)"); return; }
  const have = countBullets(player);
  if (have <= 0) { snd(player.dimension, player.location, "item.generic.cock_hammer", 0.4, 1.4, 1.5); hud(player, g, mag, " §c(no bullets)"); return; }
  s.side = false;                                    // dual guns always start again with the right hand after a reload
  const token = ++s.token; const ticks = g.reload;
  s.reload = { token, end: now + ticks, slot, gun: g.id };
  safe(() => player.startItemCooldown(cat(g), ticks));   // blocks use of the gun until the reload is over; the RP controller plays the reload animation off this cooldown
  hud(player, g, mag);
  const fill = Math.min(g.mag - mag, have);
  const step = Math.max(1, Math.ceil(fill / 12));   // big magazines are filled in at most 12 steps
  for (let k = 0; k < fill; k += step) { const end = Math.min(fill, k + step); system.runTimeout(() => { if (s.reload?.token === token) { const sl = slotsOf(s, g); for (let j = k; j < end; j++) sl[mag + j].t = 0; } }, Math.round(ticks * (0.25 + 0.65 * end / fill))); }
  const scale = ticks / 20 / g.animLen; // cue times are in animation seconds -> real seconds
  for (const c of g.cues) system.runTimeout(() => { if (s.reload?.token === token) snd(player.dimension, player.location, c[1], c[2], 0.9, 1.1); }, Math.round(c[0] * scale * 20));
  system.runTimeout(() => {
    if (s.reload?.token !== token) return; s.reload = null;
    const cur = player.getComponent("inventory").container.getItem(slot);
    if (!cur || cur.typeId !== `${NS}:${g.id}`) return;
    const need = g.mag - getMag(cur), got = takeBullets(player, need);
    const total = getMag(cur) + got; setMag(player, slot, cur, total, g); hud(player, g, total);
  }, ticks);
}
const cancelReload = (player) => { const s = st(player); if (s.reload) { const g = GUNS[s.reload.gun]; s.reload = null; s.token++; if (g) safe(() => player.startItemCooldown(cat(g), 0)); } };

// ---------- ballistics: real projectile entities, damage applied by script on hit ----------
function aimDir(player, spread) {
  const d = player.getViewDirection();
  if (spread <= 0) return d;
  const up = Math.abs(d.y) > 0.99 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const r = V.norm(V.cross(d, up)), u = V.cross(r, d);
  const a = Math.tan((spread * Math.PI) / 180) * Math.sqrt(Math.random()), t = rand(0, Math.PI * 2);
  return V.norm(V.add(d, V.add(V.mul(r, Math.cos(t) * a), V.mul(u, Math.sin(t) * a))));
}
function knock(entity, dir, h, v) {
  try { entity.applyKnockback({ x: dir.x * h, z: dir.z * h }, v); }            // newer API
  catch (e1) { try { entity.applyKnockback(dir.x, dir.z, h, v); } catch (e2) { /* unsupported */ } } // older API
}
const BUL = new Map();      // projectile entity id -> { dmg, shot, owner }
const SHOTS = new Map();    // shot id -> Map(entity id -> { e, dmg, dir, src })   (pellets of one shot are summed so damage cooldown does not eat them)
let shotCounter = 0;

function spawnBullet(player, g, origin, dir, dmgEach, shot) {
  const dim = player.dimension;
  const e = dim.spawnEntity(PROJ[g.id] ?? SHOT_ENT, V.add(origin, V.mul(dir, 0.6)));
  const pc = e.getComponent("minecraft:projectile");
  safe(() => { pc.owner = player; });
  pc.shoot(V.mul(dir, BULLET_SPEED * g.speed), { uncertainty: 0 });
  safe(() => e.setRotation({ x: -Math.asin(Math.max(-1, Math.min(1, dir.y))) * 180 / Math.PI, y: Math.atan2(-dir.x, dir.z) * 180 / Math.PI }));   // point the model along the flight direction
  BUL.set(e.id, { dmg: dmgEach, shot, owner: player.id });
  system.runTimeout(() => BUL.delete(e.id), 80);
}
const LASTHIT = new Map();   // entity id -> tick of the last gun hit
function hurt(e, dmg, src) {
  const now = system.currentTick, id = e.id, last = LASTHIT.get(id) ?? -99;
  LASTHIT.set(id, now); system.runTimeout(() => { if (LASTHIT.get(id) === now) LASTHIT.delete(id); }, 40);
  const hc = safe(() => e.getComponent("minecraft:health")), before = hc ? safe(() => hc.currentValue) : undefined;
  e.applyDamage(dmg, { cause: "projectile", damagingEntity: src });
  if (!hc || before === undefined || e.typeId === "minecraft:player" || now - last >= 10) return;
  // second hit inside the ~10 tick hurt cooldown: vanilla swallows it, so apply the missing part directly
  const after = safe(() => hc.currentValue); if (after === undefined) return;   // already dead
  const missing = dmg - (before - after);
  if (missing > 0.01) { if (after - missing <= 0) safe(() => e.kill()); else safe(() => hc.setCurrentValue(after - missing)); }
}
function flushShot(shot) {
  const m = SHOTS.get(shot); SHOTS.delete(shot); if (!m) return;
  for (const h of m.values()) { safe(() => hurt(h.e, h.dmg, h.src)); knock(h.e, h.dir, 0.3, 0.1); }
}
world.afterEvents.projectileHitEntity.subscribe((ev) => {
  const p = ev.projectile; if (!p || !isProj(p.typeId)) return;
  const info = BUL.get(p.id); BUL.delete(p.id); if (!info) return;
  const e = safe(() => ev.getEntityHit()?.entity); const dim = p.dimension, hp = ev.location;
  safe(() => dim.spawnParticle(p.typeId === HEART_ENT ? "minecraft:heart_particle" : "minecraft:critical_hit_emitter", hp));
  snd(dim, hp, "entity.bullet.impact.generic", 0.6, 0.9, 1.1);
  if (!e || e.id === info.owner) return;
  let m = SHOTS.get(info.shot); if (!m) { m = new Map(); SHOTS.set(info.shot, m); system.runTimeout(() => flushShot(info.shot), 1); }
  const dir = V.norm(ev.hitVector ?? { x: 0, y: 0, z: 1 });
  const h = m.get(e.id) ?? { e, dmg: 0, dir, src: ev.source }; h.dmg += info.dmg; m.set(e.id, h);
  safe(() => p.remove());
});
world.afterEvents.projectileHitBlock.subscribe((ev) => {
  const p = ev.projectile; if (!p || !isProj(p.typeId)) return;
  BUL.delete(p.id); const dim = p.dimension, hp = ev.location;
  safe(() => dim.spawnParticle(p.typeId === HEART_ENT ? "minecraft:heart_particle" : "minecraft:basic_smoke_particle", hp));
  snd(dim, hp, Math.random() < 0.15 ? "entity.bullet.impact.ricochet" : "entity.bullet.impact.generic", 0.8, 0.9, 1.1);
  safe(() => p.remove());
});

function recoil(player, g) {
  const k = g.recoil[0] * 0.055, yaw = rand(-1, 1) * g.recoil[1] * k * 0.5;
  const kick = (f) => safe(() => { const r = player.getRotation(); player.setRotation({ x: Math.max(-89, r.x - k * f), y: r.y + yaw * f }); });
  kick(0.5); system.runTimeout(() => kick(0.5), 1);   // 2 steps instead of 3: same total kick, one timer less per shot
}

function tryFire(player, slot, item, g) {
  const s = st(player), now = system.currentTick;
  if (s.reload) return false;                       // cannot shoot until the reload finishes
  if (now < s.nextFire) return false;               // fire cooldown
  const mag = getMag(item);
  if (mag <= 0) {
    if (safe(() => player.getComponent("riding"))) { startReload(player, slot, item, g); return false; }   // crouch would dismount, so an empty click reloads on a mount
    snd(player.dimension, player.location, "item.generic.cock_hammer", 0.5, 1.6, 1.7); hud(player, g, 0, " §c— sneak to reload"); return false;
  }
  const leftShot = !!g.dual && !!s.side; if (g.dual) s.side = !s.side;   // dual: right, left, right, ...
  const cdT = leftShot ? DUAL_LEFT_CD : g.cd;
  s.nextFire = now + cdT;
  safe(() => player.startItemCooldown(cat(g), cdT));  // RP controller plays the fire animation off this cooldown
  setMag(player, slot, item, mag - 1, g); hud(player, g, mag - 1);
  const dim = player.dimension, eye = player.getHeadLocation(), look = player.getViewDirection();
  const up = { x: 0, y: 1, z: 0 }; const right = V.norm(V.cross(look, up));
  const muzzle = V.add(eye, V.add(V.mul(look, 0.9), V.add(V.mul(right, g.dual ? (leftShot ? -0.28 : 0.28) : 0.18), V.mul(up, -0.16))));
  const spread = g.spread * (player.isSneaking ? 0.6 : 1) * (player.isOnGround ? 1 : 1.8);
  const shot = ++shotCounter;
  for (let i = 0; i < g.pellets; i++) safe(() => spawnBullet(player, g, eye, aimDir(player, spread), g.dmg / g.pellets, shot));
  for (const f of g.flash) safe(() => dim.spawnParticle(`${NS}:muzzle_flash_${f}`, muzzle));
  snd(dim, eye, g.shot, 3.0, 0.97, 1.03);
  system.runTimeout(() => snd(dim, eye, g.echo[0], 2.0, g.echo[1] * 0.95, g.echo[1] * 1.05), 3);
  for (const c of g.firecues) system.runTimeout(() => snd(dim, player.location, c[1], c[2], 0.9, 1.1), Math.round(c[0] * 20 * 0.5));
  recoil(player, g);
  if (g.blowback > 0) { const d = V.mul(look, -1); knock(player, d, g.blowback * 0.5, 0.0); }
  return true;
}

// ---------- input: plain right-click (item has no use duration, only a cooldown) ----------
function onUse(player, item) {
  const s = st(player), now = system.currentTick;
  const g = gunOf(item); if (!g) return;
  if (s.lastUseTick === now) return; s.lastUseTick = now;
  const slot = player.selectedSlotIndex;
  if (player.isSneaking) { startReload(player, slot, item, g); return; }
  tryFire(player, slot, item, g);
}
world.afterEvents.itemUse.subscribe((e) => onUse(e.source, e.itemStack));

// ---------- hand tracking ----------
// Slot changes, inventory changes and the crouch button come from events when this game version provides them (EVENT_MODE).
// Then players without a gun are not polled at all (only a slow 2 s safety check); otherwise they are checked every 4 ticks.
const EVT = { slot: world.afterEvents.playerHotbarSelectedSlotChange, inv: world.afterEvents.playerInventoryItemChange, btn: world.afterEvents.playerButtonInput };
const EVENT_MODE = !!(EVT.slot && EVT.inv && EVT.btn);
const IDLE_EVERY = EVENT_MODE ? 40 : 4;
const ANIMS = { h: "animation.irons_artifice.hold", r: "animation.irons_artifice.hold_reload", h2: "animation.irons_artifice.hold2", r2: "animation.irons_artifice.hold2_reload", h3: "animation.irons_artifice.hold3", r3: "animation.irons_artifice.hold3_reload" };   // 3 = both arms raised (dual guns)
const ANIM_HOLD = "animation.irons_artifice.hold", ANIM_RELOAD = "animation.irons_artifice.hold_reload", ANIM_HOLD2 = "animation.irons_artifice.hold2", ANIM_RELOAD2 = "animation.irons_artifice.hold2_reload";
function updatePose(p, s, it, g, now) {      // raise the right arm like a crossbow while a gun is held; restart only on change (restarting often made the arm blink)
  const two = !!g && /:((musket|blunderbuss)(_gold)?|clockwork_rifle(_grey|_purple)?)$/.test(it.typeId), dual = !!g && g.dual;   // long guns: left hand grips the barrel
  const key = (g && !p.isSwimming) ? (s.reload ? "r" : "h") + (dual ? "3" : two ? "2" : "") : "";
  if (key && (key !== s.armKey || now - (s.armTick ?? 0) > 200)) {
    p.playAnimation(ANIMS[key], { nextState: "a", blendOutTime: 9999 });
    s.armTick = now;
  } else if (!key && s.armKey) p.playAnimation(ANIM_HOLD, { nextState: "a", blendOutTime: 0 });
  s.armKey = key;
}
function syncHand(p, s, now) {               // equip sound, cancel reload on swap, ammo counter on/off, arm pose on change
  const slot = p.selectedSlotIndex, c = p.getComponent("inventory")?.container; if (!c) return null;
  const it = c.getItem(slot), g = gunOf(it), type = it?.typeId ?? "";
  if (slot !== s.lastSlot || type !== s.lastType) {
    if (s.reload && (s.reload.slot !== slot || !g || s.reload.gun !== g.id)) cancelReload(p);
    if (g) { snd(p.dimension, p.location, g.equip[0], g.equip[1], 0.9, 1.1); setAmmo(p, g, getMag(it), true); s.msg = null; renderHud(p, s, g, true); }
    else if (s.lastType && gunOf({ typeId: s.lastType })) safe(() => p.onScreenDisplay.setActionBar(""));
    s.lastSlot = slot; s.lastType = type;
    safe(() => updatePose(p, s, it, g, now));
  }
  s.armed = !!g;
  return { slot, it, g };
}
const noRide = (p) => !safe(() => p.getComponent("riding"));
if (EVENT_MODE) {
  const wake = (p) => { if (p) safe(() => syncHand(p, st(p), system.currentTick)); };
  EVT.slot.subscribe((e) => wake(e.player));
  EVT.inv.subscribe((e) => wake(e.player));
  world.afterEvents.playerSpawn.subscribe((e) => wake(e.player));
  EVT.btn.subscribe((e) => {                 // crouch pressed = reload, when the magazine is not full
    if (e.button !== "Sneak" || e.newButtonState !== "Pressed") return;
    const p = e.player, s = st(p); if (!s.armed || s.reload) return;
    safe(() => { const slot = p.selectedSlotIndex, it = p.getComponent("inventory").container.getItem(slot), g = gunOf(it); if (g && getMag(it) < g.mag && noRide(p)) startReload(p, slot, it, g); });
  });
}
system.runInterval(() => {
  const now = system.currentTick;
  for (const p of world.getAllPlayers()) {
    const s = st(p);
    if (!s.armed && now % IDLE_EVERY !== 0) continue;   // nothing in hand: skip this tick
    const h = syncHand(p, s, now); if (!h) continue;
    if (!EVENT_MODE) { const sn = p.isSneaking, edge = sn && !s.wasSneak; s.wasSneak = sn; if (edge && h.g && !s.reload && getMag(h.it) < h.g.mag && noRide(p)) startReload(p, h.slot, h.it, h.g); }
    if (h.g) {
      if (now % 2 === 0) renderHud(p, s, h.g, false);   // animate cartridges + keep the counter on screen
      if (now % 5 === 0) safe(() => updatePose(p, s, h.it, h.g, now));   // follows reload state changes
    }
  }
}, 1);
world.afterEvents.playerLeave.subscribe((e) => S.delete(e.playerId));

// ---------- /scriptevent irons:kit  — gives every gun + ammo (all guns are craftable now, this is a debug shortcut) ----------
system.afterEvents.scriptEventReceive.subscribe((e) => {
  if (e.id !== "irons:kit") return; const p = e.sourceEntity; if (!p || p.typeId !== "minecraft:player") return;
  const c = p.getComponent("inventory").container;
  for (const id of Object.keys(GUNS)) { const it = new ItemStack(`${NS}:${id}`, 1); it.setDynamicProperty("ia_mag", GUNS[id].mag); it.setLore([`§7${GUNS[id].name}`, `§6Ammo: ${GUNS[id].mag}/${GUNS[id].mag}`]); c.addItem(it); }
  c.addItem(new ItemStack(BULLET, 64));
}, { namespaces: ["irons"] });
