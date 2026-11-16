/* CLAUDE-MAP-BEGIN
 FILE: core/gauntlet.js  (6 KB, 115 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (auto, from first comment) RZ Lite: гравитационная перчатка с режимами RZ на предмете CreateMovement (create_physics:gravity_gauntlet).
 IMPORTS: @minecraft/server, @minecraft/server-ui
 IMPORTED BY: cbc/cmMount.js, cbc/world.js, core/cbcMount.js, main.js
 EXPORTS: GLOVE_ID, gauntletInfo, isGauntletTypeId, effectiveTypeId, heldGauntlet, setModeChangeHandler, setMode, openModeMenu
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): openModeMenu@64(23L); openSettingsMenu@99(16L); setMode@47(15L); heldGauntlet@34(7L); gauntletInfo@22(6L); effectiveTypeId@30(4L); isGauntletTypeId@28(1L); loreFor@41(1L); onModeChange@43(1L); setModeChangeHandler@45(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// RZ Lite: гравитационная перчатка с режимами RZ на предмете CreateMovement (create_physics:gravity_gauntlet).
// Режим хранится в dynamic property предмета "gg_mode" и показывается в описании. Смена режима: присесть + ПКМ (если ничего не держишь).
//   grab  - как в CreateMovement: ПКМ берёт конструкцию, присед фиксирует, ещё ПКМ отпускает (виртуально phys:gg_slime)
//   aim   - ПКМ по пушке: ствол выше на 5° (phys:gg_aim)
//   aimdn - ПКМ по пушке: ствол ниже на 5° (phys:gg_aim_dn)
//   Сборка конструкций - только клеем CM (контроллер + клей, внутри нужно «Ядро конструкции» phys:core). Режимы select/red убраны по просьбе автора.
// Режимы «камера» и «админская» не переносились.
// Пушки (cbc/world.js, cbc/cmMount.js) спрашивают у перчатки «виртуальный предмет в руке» через gauntletInfo/effectiveTypeId.
import { EntityComponentTypes, EquipmentSlot, system } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

export const GLOVE_ID = "create_physics:gravity_gauntlet";
const PROP = "gg_mode";
const MODES = [
  { key: "grab", virtual: "phys:gg_slime", color: "§e", title: "Захват", hint: "ПКМ - взять конструкцию, присед - зафиксировать, ещё ПКМ - отпустить" },
  { key: "aim", virtual: "phys:gg_aim", color: "§9", title: "Наводка +5°", hint: "ПКМ по пушке: ствол выше на 5°" },
  { key: "aimdn", virtual: "phys:gg_aim_dn", color: "§3", title: "Наводка -5°", hint: "ПКМ по пушке: ствол ниже на 5°" },
];
const BY_KEY = Object.fromEntries(MODES.map(m => [m.key, m]));

/** {admin, mode, virtual} либо undefined, если это не перчатка. */
export function gauntletInfo(item) {
  if (item?.typeId !== GLOVE_ID) return undefined;
  let k; try { k = item.getDynamicProperty(PROP); } catch {}
  const m = BY_KEY[k] ?? MODES[0];
  return { admin: false, mode: m.key, virtual: m.virtual };
}
export function isGauntletTypeId(id) { return id === GLOVE_ID; }
/** typeId, как его должен «видеть» остальной код (перчатка в режиме наводки = phys:gg_aim и т.д.). */
export function effectiveTypeId(item) {
  const g = gauntletInfo(item);
  return g !== undefined ? g.virtual : item?.typeId;
}
export function heldGauntlet(player) {
  try {
    const item = player.getComponent(EntityComponentTypes.Equippable)?.getEquipment(EquipmentSlot.Mainhand);
    const info = gauntletInfo(item);
    return info !== undefined ? { item, info } : undefined;
  } catch { return undefined; }
}
const loreFor = key => { const m = BY_KEY[key]; return [`${m.color}Режим: ${m.title}`, `§8${m.hint}`, "§8Присесть + ПКМ - сменить режим"]; };

let onModeChange = () => {};
/** main.js регистрирует сброс захвата при смене режима. */
export function setModeChangeHandler(fn) { onModeChange = fn; }

export function setMode(player, key) {
  const held = heldGauntlet(player), m = BY_KEY[key];
  if (!held || !m) return false;
  const old = held.info.mode;
  if (old === key) return true;
  try {
    const it = held.item;
    it.setDynamicProperty(PROP, key);
    it.setLore(loreFor(key));
    player.getComponent(EntityComponentTypes.Equippable).setEquipment(EquipmentSlot.Mainhand, it);
  } catch { return false; }
  try { onModeChange(player, old, key); } catch {}
  try { player.playSound("random.orb", { pitch: 1.4, volume: 0.8 }); player.onScreenDisplay.setActionBar(`${m.color}${m.title}§r §7${m.hint}`); } catch {}
  return true;
}

const opening = new Map();
export function openModeMenu(player) {
  if (!player.isValid) return;
  const since = opening.get(player.id);
  if (since !== undefined && system.currentTick - since < 100) return;
  const held = heldGauntlet(player); if (!held) return;
  opening.set(player.id, system.currentTick);
  const cur = held.info.mode;
  const form = new ActionFormData().title("Перчатка").body(`Режим сейчас: ${BY_KEY[cur].color}${BY_KEY[cur].title}`);
  for (const m of MODES) form.button(`${m.color}${m.title}${m.key === cur ? " §r§7(выбран)" : ""}\n§r§8${m.hint}`);
  form.button("§bНастройки\n§r§8Звук двигателей, отчёт по приводу, самолёт");
  (async () => {
    let res;
    for (let i = 0; i < 12; i++) {   // чат/HUD заняты - пробуем снова
      res = await form.show(player);
      if (res.cancelationReason !== "UserBusy") break;
      await system.waitTicks(10);
    }
    opening.delete(player.id);
    if (!res || res.canceled || res.selection === undefined) return;
    if (res.selection === MODES.length) { openSettingsMenu(player); return; }
    const m = MODES[res.selection]; if (m) setMode(player, m.key);
  })().catch(() => opening.delete(player.id));
}

// Настройки (бывшее меню RZ): всё выполняется командами rzlite:*, поэтому те же команды доступны и из чата.
const SETTINGS = [
  ["Звук двигателей: включить", "rzlite:sound on"],
  ["Звук двигателей: выключить", "rzlite:sound off"],
  ["Громкость двигателей: 50%", "rzlite:sound vol 0.5"],
  ["Громкость двигателей: 100%", "rzlite:sound vol 1"],
  ["Громкость двигателей: 150%", "rzlite:sound vol 1.5"],
  ["Отчёт по приводу (двигатели, топливо, цепь)", "rzlite:drive report"],
  ["Самолёт: инвертировать крен (A/D)", "rzlite:air roll_inv"],
  ["Самолёт: инвертировать тангаж (W/S)", "rzlite:air pitch_inv"],
];
function openSettingsMenu(player) {
  if (!player.isValid) return;
  const form = new ActionFormData().title("Настройки RZ Lite").body("Выберите действие. Те же команды работают в чате: /scriptevent <команда>");
  for (const [t] of SETTINGS) form.button(t);
  (async () => {
    let res;
    for (let i = 0; i < 12; i++) {
      res = await form.show(player);
      if (res.cancelationReason !== "UserBusy") break;
      await system.waitTicks(10);
    }
    if (!res || res.canceled || res.selection === undefined) return;
    const e = SETTINGS[res.selection]; if (!e) return;
    try { player.runCommand(`scriptevent ${e[1]}`); } catch {}
  })().catch(() => {});
}
