/* CLAUDE-MAP-BEGIN
 FILE: i18n/i18n.js  (5 KB, 166 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (auto, from first comment) RZ Physics i18n: ru / en / es_MX.
 IMPORTS: @minecraft/server, @minecraft/server-ui, i18n/strings.js
 IMPORTED BY: cbc/admin.js, cbc/admin.js, cbc/cmMount.js, cbc/config/overrides.js, cbc/fire.js, cbc/fuze.js, cbc/impact.js, cbc/loading.js, cbc/main.js, cbc/multiblock.js, cbc/projectiles.js, cbc/recoil.js, cbc/twin.js, cbc/twin_scan.js, cbc/world.js, core/cbcMount.js
 EXPORTS: LANGS, langName, getDefaultLang, setDefaultLang, getLang, setLang, __t, resolve, deep, T, __R, ActionFormData, ModalFormData, MessageFormData, ui
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): lazyForm@142(20L); readText@66(14L); getLang@36(12L); getDefaultLang@20(10L); readMarker@80(10L); deep@95(8L); setDefaultLang@30(6L); __t@55(5L); fill@61(5L); resolve@90(5L); setLang@48(4L); langName@19(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// RZ Physics i18n: ru / en / es_MX.
// Text in code is stored as markers (__t) and resolved into the viewer's language at output (__R.*).
import { world } from "@minecraft/server";
import * as serverUi from "@minecraft/server-ui";
import { S } from "./strings.js";

export const LANGS = [
  { code: "ru", name: "Русский", idx: 0 },
  { code: "en", name: "English", idx: 1 },
  { code: "es", name: "Español (México)", idx: 2 },
];
const IDX = { ru: 0, en: 1, es: 2 };
const PROP = "rz:lang";
const WPROP = "rz:lang_default";
let defaultLang = "ru";
let defaultLoaded = false;
const cache = new Map();

export function langName(code) { return (LANGS[IDX[code]] ?? LANGS[0]).name; }
export function getDefaultLang() {
  if (!defaultLoaded) {
    try {
      const v = world.getDynamicProperty(WPROP);
      if (typeof v === "string" && IDX[v] !== undefined) defaultLang = v;
      defaultLoaded = true;
    } catch { /* world is not ready yet */ }
  }
  return defaultLang;
}
export function setDefaultLang(code) {
  if (IDX[code] === undefined) return false;
  defaultLang = code; defaultLoaded = true;
  try { world.setDynamicProperty(WPROP, code); } catch { /* ignore */ }
  return true;
}
export function getLang(player) {
  try {
    const id = player?.id;
    if (id !== undefined) {
      const c = cache.get(id);
      if (c !== undefined) return c;
      const v = player.getDynamicProperty(PROP);
      if (typeof v === "string" && IDX[v] !== undefined) { cache.set(id, v); return v; }
    }
  } catch { /* ignore */ }
  return getDefaultLang();
}
export function setLang(player, code) {
  if (IDX[code] === undefined) return false;
  try { player.setDynamicProperty(PROP, code); cache.set(player.id, code); return true; } catch { return false; }
}

// ---- markers
const OPEN = "\uE000", SEP = "\uE001", CLOSE = "\uE002";
export function __t(id, ...args) {
  let s = OPEN + id;
  for (const a of args) s += SEP + String(a);
  return s + CLOSE;
}
let curIdx = 0;
function fill(id, args) {
  const e = S[id];
  let t = e === undefined ? "" : (e[curIdx] ?? e[0]);
  return t.replace(/\{(\d+)\}/g, (m, n) => (args[+n] !== undefined ? args[+n] : m));
}
function readText(s, i, inMarker) {
  let out = "", start = i;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === 0xE000) {
      out += s.slice(start, i);
      const r = readMarker(s, i + 1);
      out += r[0]; i = r[1]; start = i; continue;
    }
    if (inMarker && (c === 0xE001 || c === 0xE002)) { out += s.slice(start, i); return [out, i]; }
    i++;
  }
  return [out + s.slice(start, i), i];
}
function readMarker(s, i) {
  let j = i;
  while (j < s.length && s.charCodeAt(j) >= 48 && s.charCodeAt(j) <= 57) j++;
  const id = Number(s.slice(i, j));
  const args = [];
  i = j;
  while (i < s.length && s[i] === SEP) { const r = readText(s, i + 1, true); args.push(r[0]); i = r[1]; }
  if (s[i] === CLOSE) i++;
  return [fill(id, args), i];
}
export function resolve(str, lang) {
  if (typeof str !== "string" || str.indexOf(OPEN) === -1) return str;
  curIdx = IDX[lang] ?? 0;
  try { return readText(str, 0, false)[0]; } catch { return str; }
}
export function deep(x, lang) {
  if (typeof x === "string") return resolve(x, lang);
  if (Array.isArray(x)) return x.map(v => deep(v, lang));
  if (x !== null && typeof x === "object" && Object.getPrototypeOf(x) === Object.prototype) {
    const o = {}; for (const k of Object.keys(x)) o[k] = deep(x[k], lang); return o;
  }
  return x;
}
/** Resolve text for a specific player. */
export function T(player, text) { return deep(text, getLang(player)); }

// ---- sinks
export const __R = {
  sendMessage(target, msg) {
    if (target === undefined || target === null) return;
    if (typeof target.getAllPlayers === "function") {
      for (const p of target.getAllPlayers()) { try { p.sendMessage(deep(msg, getLang(p))); } catch { /* ignore */ } }
      return;
    }
    if (typeof target.sendMessage !== "function") return;
    return target.sendMessage(deep(msg, getLang(target)));
  },
  actionBar(player, text) {
    return player.onScreenDisplay.setActionBar(deep(text, getLang(player)));
  },
  setLore(item, lore, who) {
    return item.setLore(deep(lore, who ? getLang(who) : getDefaultLang()));
  },
  log(kind, ...args) {
    const l = getDefaultLang();
    (console[kind] ?? console.log).call(console, ...args.map(a => (typeof a === "string" ? resolve(a, l) : a)));
  },
  cmd(handler) {
    return function (origin, ...rest) {
      const r = handler.call(this, origin, ...rest);
      try {
        if (r && typeof r === "object" && typeof r.message === "string") {
          const who = origin?.sourceEntity ?? origin?.initiator;
          return { ...r, message: resolve(r.message, getLang(who)) };
        }
      } catch { /* ignore */ }
      return r;
    };
  },
};

// ---- forms: texts are resolved at show(player)
function lazyForm(Native) {
  return class {
    constructor(...ctorArgs) {
      const calls = [];
      const proxy = new Proxy({}, {
        get(_, k) {
          if (typeof k === "symbol" || k === "then") return undefined;
          if (k === "show") return (player) => {
            const f = new Native(...ctorArgs);
            const lang = getLang(player);
            for (const [m, a] of calls) f[m](...a.map(v => deep(v, lang)));
            return f.show(player);
          };
          return (...a) => { calls.push([k, a]); return proxy; };
        },
      });
      return proxy;
    }
  };
}
export const ActionFormData = lazyForm(serverUi.ActionFormData);
export const ModalFormData = lazyForm(serverUi.ModalFormData);
export const MessageFormData = lazyForm(serverUi.MessageFormData);
export const ui = { ...serverUi, ActionFormData, ModalFormData, MessageFormData };
