# 05g — CBC на физических конструкциях: cbc/cmMount.js (рабочий) и core/cbcMount.js + core/cbcLooks.js (МЁРТВЫЕ)

Статус: **READ построчно** — `cbc/cmMount.js` (302 стр.), `core/cbcMount.js` (625), `core/cbcLooks.js` (102). Поведение в игре **не проверено**. Пути от `Trackwork_RZ_BP/scripts/`.

## 0. Главный вывод: два адаптера, живой только один
Статический граф импортов от `scripts/main.js` (`knowledge/tools/reach.py`; динамических импортов не ловит): из 124 файлов **достижимы 118**, недостижимы 6: `blocks/wheel_marks.js`, `cbc/types.js`, `config.js`, `contraptions/ContraptionSailRenderer.js`, **`core/cbcLooks.js`, `core/cbcMount.js`**.
- `core/cbcMount.js` импортирует несуществующие в аддоне модули: `../lib/blockMass.js`, `../lib/math.js`, `./explosions.js`, `./parking.js`, `./parts.js`, `./structures.js`, `./tps.js` (в `core/` лежат только `cbcLooks.js`, `cbcMount.js`, `gauntlet.js`; папки `lib/` нет). `core/cbcLooks.js` импортирует `../lib/shapes/index.js` (нет). Т.е. это остатки ДРУГОГО проекта (физика «phys:*», сущности `phys:block/phys:part`, `structures.js`), скопированные в пакет. Если подключить их к `main.js`, модуль не загрузится.
- Живой путь для пушек на технике: **`cbc/cmMount.js`** (импорт `main.js:5`, адаптер к сессиям `physicsControllerPhysicsSessions` «RZ Lite»/CreateMovement-подобной физики аддона).
- Разница в хранении: cmMount — `Map` в памяти + world dynamic properties; core/cbcMount — `extra` клетки конструкции (`cbc:ld`, `cbc:el`).

## 1. cbc/cmMount.js (живой)
Логика пушки (скан, баллистика, снаряды, заряжание) общая с миром: `findCannon`, `planShot`, `applyLoad`, `spawnProjectile` (см. 05b, 05c, 05e). Здесь только адаптер.

### 1.1 Подключение (main.js)
`installCbcMount(physicsControllerPhysicsSessions)` (main.js L24924); `cbcQueueUse(event, player, raycastPhysicsControllerBlock)` вызывается первой строкой в обработчиках клика (L18340, L18360, L18389; сенсорный ввод L18636: `swingSource !== Mine`); `cbcOnAssemble(session, controllerKey)` (L20082) и `cbcOnDisassemble(session, controllerKey, restoreSnapshots)` (L20257); визуальная наводка: `cbcAimVersion()`/`cbcAimPoses(session)` → `applyCbcAim` (L24952–24962, режим `Math.sign(RZ_DRIVE.AIM_VIS)`).

### 1.2 Данные
- `sessions` (Map ключ→сессия). Ключ сессии содержит `|` (`измерение|x,y,z`); ключ заряда/угла = `<ключ сессии>|x,y,z` клетки КАЗЁННИКА в локальных координатах конструкции.
- `loads: Map<key, "снаряд,заряды,взрыватель">` (`-` = нет снаряда), `elevs: Map<key, градусы>`. Персистентность: dynamic properties `cbc:cm_loads` и `cbc:cm_elev` (JSON), читаются на `worldLoad`, пишутся раз в 100 тиков при `dirty`.
- Чистка (шаг 112, исправление бага): записи, чья сессия не жива (`owner(k) = k.slice(0, k.lastIndexOf("|"))`), удаляются только при `sessions.size>0`. Раньше ключ резался по первому `|` и заряды стирались каждые 5 с.
- Чтение блоков: `readerOf(session)` — из `session.assembly.blocks` (`localLocation`, `contraptionStates["minecraft:facing_direction"]`, `typeId ?? itemTypeId`); вне конструкции — воздух.

### 1.3 Клики (`cbcQueueUse`)
Условия: есть сессии, `isFirstEvent !== false`. Предмет: пусто (отчёт), огниво, перчатка наводки (`phys:gg_aim`=+5°, `phys:gg_aim_dn`=−5°, через `effectiveTypeId` из core/gauntlet.js) или боеприпас (`ammoKind`). Попадание определяется `raycast(player)` → `hit.hit.block.localLocation` и `parsePart`. `event.cancel = true`; один клик приходит из нескольких событий (itemUse/блок/сущность), поэтому «одно действие на 5 тиков на игрока» (`lastUse`, шаг 110). Действия в `system.run`: отчёт `describeLoad (ёмкость)` / `fire` / `adjustElevation` / Shift: `unloadFrom` (предмет выпадает у ИГРОКА, не у грани) / `loadInto` (+`fuzeFromItem`).
Наводка (`adjustElevation`): шаг 5°, диапазон из `rulesOf(scan)`; **на башне (`towerTurnOf(session, breech)`, blocks/tower.js) отказ**: «поднимайте и поворачивайте её пультом башни» (русская строка прямо в коде, не через `__t`).

### 1.4 Выстрел (`fire`)
`S.frozen`, кулдаун `LIMITS.fireCooldownTicks`, `planShot(scan, load)`, `liveCount() < LIMITS.maxProjectilesAlive`. Отличия от мирового `fireCannon`: нет отложенного выстрела до конца подъёма и нет разрыва при перегрузе (`plan.overloaded` не обработан отдельно: просто `!plan.ok`); нет визуального отката (`fireRecoil`). Геометрия: направление ствола `d` с учётом наводки `th` (0, если башня), `p0` центр казённика (локально), точка вылета `atWorld(n+1.2)` через `body.localPointToWorld`. Если пушка на башне (`towerTurnOf(...).active`) — точки/направления переводятся `tw.point/tw.dir`. Скорость снаряда = направление (мировое) × `plan.velocity` + скорость точки дула `body.getVelocityAt(origin)/20` (шаг 150: физика даёт блоки/с, снаряд летит в блоках/тик). `spawnProjectile(dim, origin, vel, munitionId, fuze, {owner: session})`: `owner` (сессия-стрелок) нужен `projectiles.js` L386: пока возраст снаряда < `OWN_STRUCT_GRACE_TICKS` = 25 тиков (шаг 150), луч по конструкциям игнорирует свою конструкцию (иначе снаряд бьёт стоящие в луче блоки башни); дальше своя конструкция уже цель. Отдача: импульс `min(speed·(2+charges), 3·mass)/20` через `body.applyImpulseAt(point, vec)` в точке казённика против ствола.
Заряд после выстрела сбрасывается (`putLoad(empty)`), звук/дым/тряска как в мире.

### 1.5 Перенос между миром и конструкцией
`cbcOnAssemble(session, key)`: для каждого снимка блока пушки (`session.snapshots`) берёт мировой заряд/угол (`getLoadAt/getElevAt`), находит клетку (`cellMatches` — точное совпадение или допуск 0.51 блока), кладёт в `loads/elevs` и стирает мировую запись (`clearLoadAt`). `cbcOnDisassemble(session, key, restoreSnapshots)`: обратный перенос на `s.targetLocation` (`setLoadAt/setElevAt`), затем удаляет ключи. Вызывать до удаления сессии.

### 1.6 Визуальная наводка (шаг 114)
`cbcAimPoses(session)` → `Map<"x,y,z", {dx,dy,dz,pitch,roll}>`: для каждой пушки с углом≠0 (кроме башенных) каждая деталь i=0..n смещается как `R(k,θ)·(d·i) − d·i` и поворачивается на `θ` вокруг оси `k=(−d.z,0,d.x)` (север/юг → ось X, восток/запад → ось Z). Версия `aimVersion++` при каждой смене угла — main.js перерисовывает по ней. Откат ствола на технике не рисуется.

## 2. core/cbcMount.js и core/cbcLooks.js (мёртвый код, для справки)
Не подключены (см. §0). Содержат более полную реализацию «чужой» архитектуры; пригодна как идея для переписывания:
- `cbcLooks.js`: запечённая геометрия деталей (`GEO0=2084`, `TEX0=1148`, `PARTS` 9 деталей, `LIFT_KIND` 33..36 для поднимаемых), `fixForFacing(facing)` подбирает код поворота `phys:fix` (64 варианта) под `minecraft:transformation` блока (`ROT`: up 0,0; down 180,0; north 90,0; south 90,180; east 90,90; west 90,270), `/scriptevent phys:veh cbcflip` разворачивает на 180°.
- `cbcMount.js`: массы блоков (`steel 7.9`, `cast_iron 7.2`, трение 0.45) через `registerBlockPhysics`; заряд в `extra` клетки; анимация подъёма на сущностях `phys:part` (`ANGLE_SPEED=2.5°/тик`, `RECOIL_BLOCKS=0.45`, `RECOIL_TICKS` из cbc/recoil.js, `SETTLE_TICKS=4`), флаг `cbc:lift` скрывает блоки на время анимации; `tickCbc(tick)`; `/scriptevent phys:cbc help|perf|boom|flip`; `setStructureHook({ray, blast})` (урон по конструкциям через `explodeStructures`) — **этот хук в живом коде ставит main.js L19183** (см. 05d), не этот файл.

## 3. Подводные камни
- Не путать `cbc/cmMount.js` (рабочий) и `core/cbcMount.js` (мёртвый): имена похожи.
- Пушка на конструкции не имеет визуального отката и отложенного выстрела; перегруз не взрывает казённик (в мировой версии взрывает).
- Ключ заряда = `<сессия>|<клетка>`; при переименовании формата ключа чистка по `lastIndexOf('|')` сломается.

*Проверено после написания:* роль `owner` сверена по `cbc/projectiles.js` L386, `setStructureHook` в живом коде действительно в `main.js` L19183 (L6 импорт из `cbc/impact.js`).

*Исправление прошлых утверждений:* в `00_START_HERE.md` строка про `core/cbcMount`, `core/cbcLooks` была «INDEXED ONLY» без пометки, что они мёртвые; теперь исправлено.
