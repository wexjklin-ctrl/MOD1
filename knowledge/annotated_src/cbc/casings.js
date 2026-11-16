/* CLAUDE-MAP-BEGIN
 FILE: cbc/casings.js  (2 KB, 35 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (auto, from first comment) Гильзы автопушки (сборка 62): визуальная сущность cbc:casing с физикой (падает, кувыркается), сама исчезает через ~1.8 с (таймер в BP-сущнос
 IMPORTS: @minecraft/server, cbc/perf.js, cbc/settings.js
 IMPORTED BY: cbc/twin.js
 EXPORTS: CASING_ENTITY, ejectCasing
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): ejectCasing@15(20L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// Гильзы автопушки (сборка 62): визуальная сущность cbc:casing с физикой (падает, кувыркается), сама исчезает через ~1.8 с (таймер в BP-сущности).
// Предметом не является (не засоряет мир и не нагружает сервер): подобрать нельзя. Начальная скорость задаётся applyImpulse сразу после создания.
// TODO-VERIFY (в игре не проверено): Entity.applyImpulse для сущности с minecraft:physics; если гильза просто падает вниз, импульс не применился.
import { system } from "@minecraft/server";
import { degrade } from "./perf.js";
import { S } from "./settings.js";
export const CASING_ENTITY = "cbc:casing";
const MAX_ALIVE = 24; // потолок гильз в мире одновременно (защита от лавины при частой стрельбе)
let recent = []; // тики последних выбросов, чтобы не плодить больше MAX_ALIVE за время жизни гильзы
const LIFE_TICKS = 40;
/**
 * Выбросить гильзу из точки pos со скоростью vel (блоков/тик). Возвращает true, если создана.
 * Ничего не делает, если частицы выключены в меню администратора или сервер под критичной нагрузкой.
 */
export function ejectCasing(dim, pos, vel) {
    if (!S.particles || degrade() >= 2)
        return false;
    const now = system.currentTick;
    recent = recent.filter((t) => now - t < LIFE_TICKS);
    if (recent.length >= MAX_ALIVE)
        return false;
    try {
        const e = dim.spawnEntity(CASING_ENTITY, pos);
        recent.push(now);
        try {
            e.applyImpulse(vel);
        }
        catch { /* импульс недоступен: гильза просто упадёт */ }
        return true;
    }
    catch {
        return false; // чанк не загружен / тип сущности недоступен
    }
}
