/* CLAUDE-MAP-BEGIN
 FILE: cbc/main.js  (2 KB, 42 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: Create Big Cannons port entry; scriptevent cbc:admin.
 IMPORTS: @minecraft/server, cbc/admin.js, cbc/fuze.js, cbc/projectiles.js, cbc/recoil.js, cbc/settings.js, cbc/twin.js, cbc/world.js, i18n/i18n.js
 IMPORTED BY: main.js
 EVENTS: scriptEventReceive, startup, worldLoad
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { __t, __R } from "../i18n/i18n.js";
import { system, world } from "@minecraft/server";
import { startFlightLoop } from "./projectiles.js";
import { openMenu as openAdminMenu, registerAdminCommand } from "./admin.js";
import { loadSettings } from "./settings.js";
import { restoreRecoil } from "./recoil.js";
import { registerBreechComponent, registerInteraction } from "./world.js";
import { registerFuze } from "./fuze.js";
import { registerTwin, registerTwinComponent, restoreTwins } from "./twin.js";
// Точка входа. Логика в модулях (multiblock, loading, fire, projectiles, world).
// Пользовательские компоненты блоков регистрируются в startup (до загрузки мира), подписки на события мира: в worldLoad.
let twinCompErr = __t(90);
system.beforeEvents.startup.subscribe((ev) => {
    try { registerBreechComponent(ev.blockComponentRegistry); } catch (e) { __R.log("warn", `[CBC] компонент казённика не зарегистрирован: ${String(e)}`); }
    try { registerTwinComponent(ev.blockComponentRegistry); twinCompErr = ""; } catch (e) { twinCompErr = String(e); __R.log("warn", `[CBC] компонент ручек не зарегистрирован: ${twinCompErr}`); }
    try {
        registerAdminCommand(ev.customCommandRegistry); // /cbc:admin
    }
    catch (e) {
        __R.log("warn", `[CBC] команда /cbc:admin не зарегистрирована: ${String(e)}`);
    }
});
world.afterEvents.worldLoad.subscribe(() => {
    // каждый шаг отдельно: если один упал, остальные всё равно подключаются, а ошибка видна в чате
    const step = (name, fn) => { try { fn(); } catch (e) { __R.log("warn", `[CBC] ошибка запуска «${name}»: ${String(e)}`); } };
    step(__t(91), loadSettings); // настройки администратора (до армирования пушек: учитывается «пушки отключены»)
    step(__t(92), restoreRecoil);
    step(__t(93), registerInteraction);
    step(__t(94), registerFuze);
    step(__t(95), restoreTwins); // бронзовая спаренная пушка: вернуть блоки после падения/выгрузки
    step(__t(96), () => { registerTwin(); });
    step(__t(97), startFlightLoop);
    // запасной путь к меню админа (если пользовательская команда не зарегистрировалась): /scriptevent cbc:admin
    step("scriptevent cbc:admin", () => {
        system.afterEvents.scriptEventReceive.subscribe((ev) => {
            if (ev.id !== "cbc:admin") return;
            const p = ev.sourceEntity;
            if (p && p.typeId === "minecraft:player") openAdminMenu(p).catch((e) => { try { __R.sendMessage(p, __t(57, String(e))); } catch { /* вышел */ } });
        });
    });
});
