/* CLAUDE-MAP-BEGIN
 FILE: cbc/admin.js  (7 KB, 161 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: @minecraft/server, cbc/fuze.js, cbc/perf.js, cbc/projectiles.js, cbc/settings.js, cbc/world.js, i18n/i18n.js
 IMPORTED BY: cbc/main.js
 EXPORTS: openMenu, registerAdminCommand
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): openMenu@85(53L); settingsForm@49(31L); registerAdminCommand@139(22L); show@15(17L); statusText@33(12L); confirm@80(5L); snap@45(4L); wait@13(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { __t, __R } from "../i18n/i18n.js";
// Команда администратора /cbc:admin: всплывающее меню (форма) для настройки защиты сервера и отключения заряженных пушек.
// Команда требует права оператора (permissionLevel Admin). Форма не открывается, пока открыт чат, поэтому показ повторяется (UserBusy).
// API: CustomCommandRegistry (@minecraft/server 2.1.0+), ActionFormData/ModalFormData (@minecraft/server-ui 2.0.0).
import * as mc from "@minecraft/server";
import { ui as ui } from "../i18n/i18n.js";
import { DEFAULTS, S, resetSettings, saveSettings } from "./settings.js";
import { measureTps, tpsInfo } from "./perf.js";
import { clearProjectiles, liveCount } from "./projectiles.js";
import { armedCount, dischargeAll, setCannonsFrozen } from "./world.js";
import { fugasInfo, setFugasKnown } from "./fuze.js";
const { system } = mc;
const wait = (ticks) => new Promise((res) => system.runTimeout(() => res(), ticks));
/** Показать форму; если игрок в чате (UserBusy), пробуем снова до ~12 секунд. undefined = не показалась или игрок вышел. */
async function show(form, player) {
    for (let i = 0; i < 25; i++) {
        let r;
        try {
            r = await form.show(player);
        }
        catch {
            return undefined;
        }
        if (r.canceled && String(r.cancelationReason) === "UserBusy") {
            await wait(10);
            continue;
        }
        return r;
    }
    return undefined;
}
const MODE_NAMES = [__t(0), __t(1), __t(2)];
function statusText() {
    const { tps, mode } = tpsInfo();
    const t = tps === undefined ? __t(3) : `${tps.toFixed(1)} §r(${MODE_NAMES[mode]}§r)`;
    return [
        `TPS: ${t}`,
        __t(6, S.tpsGuard ? __t(4) : __t(5), S.loadBelow, S.criticalBelow),
        __t(7, liveCount(), S.maxProjectiles),
        __t(8, armedCount()),
        (() => { const f = fugasInfo(); return __t(12, f.known && !f.overflow ? __t(9) : __t(10), f.count, f.overflow ? __t(11) : ""); })(),
        __t(15, S.frozen ? __t(13) : __t(14)),
    ].join("\n");
}
function snap(v, min, max, step) {
    const n = Math.round((Math.max(min, Math.min(max, Number(v))) - min) / step) * step + min;
    return Math.max(min, Math.min(max, n));
}
async function settingsForm(player) {
    const m = new ui.ModalFormData().title(__t(16));
    m.toggle(__t(17), { defaultValue: S.tpsGuard });
    m.slider(__t(18), 12, 19, { defaultValue: snap(S.loadBelow, 12, 19, 1), valueStep: 1 });
    m.slider(__t(19), 4, 14, { defaultValue: snap(S.criticalBelow, 4, 14, 1), valueStep: 1 });
    m.slider(__t(20), 10, 100, { defaultValue: snap(S.slowLoad, 10, 100, 5), valueStep: 5 });
    m.slider(__t(21), 5, 100, { defaultValue: snap(S.slowCritical, 5, 100, 5), valueStep: 5 });
    m.slider(__t(22), 1, 60, { defaultValue: snap(S.maxProjectiles, 1, 60, 1), valueStep: 1 });
    m.slider(__t(23), 5, 100, { defaultValue: snap(S.fireCooldown, 5, 100, 1), valueStep: 1 });
    m.slider(__t(24), 1, 8, { defaultValue: snap(S.maxExplosionRadius, 1, 8, 1), valueStep: 1 });
    m.toggle(__t(25), { defaultValue: S.particles });
    m.toggle(__t(26), { defaultValue: S.trail });
    m.toggle(__t(27), { defaultValue: S.shake });
    const r = await show(m, player);
    if (!r || r.canceled || !r.formValues)
        return;
    const v = r.formValues;
    S.tpsGuard = !!v[0];
    S.loadBelow = Number(v[1]);
    S.criticalBelow = Math.min(Number(v[2]), S.loadBelow - 1); // «критично» всегда ниже «нагрузки»
    S.slowLoad = Number(v[3]);
    S.slowCritical = Math.min(Number(v[4]), S.slowLoad); // при критичной нагрузке не быстрее, чем при обычной
    S.maxProjectiles = Number(v[5]);
    S.fireCooldown = Number(v[6]);
    S.maxExplosionRadius = Number(v[7]);
    S.particles = !!v[8];
    S.trail = !!v[9];
    S.shake = !!v[10];
    saveSettings();
    __R.sendMessage(player, __t(28));
}
async function confirm(player, text, yes) {
    const f = new ui.ActionFormData().title(__t(29)).body(text).button(__t(30)).button(yes);
    const r = await show(f, player);
    return !!r && !r.canceled && r.selection === 1;
}
export async function openMenu(player) {
    for (let guard = 0; guard < 50; guard++) {
        const f = new ui.ActionFormData().title(__t(31)).body(statusText());
        f.button(__t(32));
        f.button(S.frozen ? __t(33) : __t(34));
        f.button(__t(35));
        f.button(__t(36));
        f.button(__t(37));
        f.button(__t(38));
        f.button(fugasInfo().known ? __t(39) : __t(40));
        f.button(__t(41));
        const r = await show(f, player);
        if (!r || r.canceled)
            return;
        switch (r.selection) {
            case 0:
                await settingsForm(player);
                break;
            case 1:
                setCannonsFrozen(!S.frozen);
                __R.sendMessage(player, S.frozen ? __t(42) : __t(43));
                break;
            case 2:
                __R.sendMessage(player, __t(44));
                await measureTps(40);
                break;
            case 3:
                if (await confirm(player, __t(45), __t(46))) {
                    __R.sendMessage(player, __t(47, dischargeAll()));
                }
                break;
            case 4:
                __R.sendMessage(player, __t(48, clearProjectiles()));
                break;
            case 5:
                if (await confirm(player, __t(49, DEFAULTS.loadBelow, DEFAULTS.criticalBelow, DEFAULTS.maxProjectiles, DEFAULTS.fireCooldown, DEFAULTS.maxExplosionRadius), __t(50))) {
                    resetSettings();
                    __R.sendMessage(player, __t(51));
                }
                break;
            case 6: {
                const on = !fugasInfo().known;
                if (!on || await confirm(player, __t(52), __t(53))) {
                    setFugasKnown(on);
                    __R.sendMessage(player, on ? __t(54) : __t(55));
                }
                break;
            }
            default:
                return;
        }
    }
}
/** Регистрация команды: вызывать из system.beforeEvents.startup. */
export function registerAdminCommand(registry) {
    const level = mc.CommandPermissionLevel ?? mc.CustomCommandPermissionLevel; // имя enum зависит от версии модуля
    const status = mc.CustomCommandStatus;
    registry.registerCommand({
        name: "cbc:admin",
        description: "CBC: admin menu (TPS, limits, cannon shutdown)",
        permissionLevel: level?.Admin ?? 2,
        cheatsRequired: false,
    }, __R.cmd((origin) => {
        const player = origin.sourceEntity;
        if (!player || player.typeId !== "minecraft:player") {
            return { status: status?.Failure ?? 1, message: __t(56) };
        }
        system.run(() => {
            openMenu(player).catch((e) => { try {
                __R.sendMessage(player, __t(57, String(e)));
            }
            catch { /* игрок вышел */ } });
        });
        return { status: status?.Success ?? 0, message: __t(58) };
    }));
}
