# 03d — Башня конструкции (tower.js), propeller_bearing.js, airplane_throttle.js

Статус: **READ построчно** `blocks/tower.js` (283), `blocks/propeller_bearing.js` (216), `blocks/airplane_throttle.js` (95), `blocks/aircraft_motion.js` (104), `findTowerForStructure` (main.js L20005), места интеграции в main.js (L614, 1295, 19302–19345, 19426, 19494, 20048–20080, 21987, 22118–22123, 24967–24983). Не читал: `tower_batch.json` (клиентская часть: откуда берутся `v.tw/v.twc/v.tws`), `airplane_math.js`. Поведение в игре НЕ проверено.

## 1. Переименования (важно, ломает догадки по ID)
| ID блока | Раньше | Сейчас |
|---|---|---|
| `create_physics:propeller_bearing` (`TOWER`) | Propeller Bearing | «Башня конструкции» |
| `create_physics:airplane_throttle` (`TOWER_PANEL`) | Airplane Throttle | «Пульт управления башни» |

`propellerGroups()` в propeller_bearing.js теперь **всегда возвращает []** (шаг 138): старые роторы с парусами (`legacyPropellerGroups`) мертвы, их код остаётся. Живое в `addPropellerBearingMotion` — только (а) RZ-винт (`vehicleSystems(session).rzProp`, §4) и (б) общая математика поз.

## 2. Идея
Башня = шарнир. Всё, что связано по граням с её стороны «головы» (грань `minecraft:block_face`, любое из 6 направлений; `towerAxis`), поворачивается вокруг оси башни. Угол слайдером в пульте: ±180° (`TOWER_RANGE`), скорость 3°/тик (`TOWER_RATE`). Подъём пушки: −10…50° (`PITCH_MIN/MAX`), 2°/тик, только если ось вертикальна и в голове есть пушка CBC.

Два режима:
1. **Башня вместо ядра** (`session.towerRoot`). В конструкции нет `RZ_CORE_ID`; башня остаётся блоком мира (из снапшотов вычёркивается, main.js L20052), а конструкция собирается с `motionType:"static"` (ноль физики) и вращается только голова. Сообщения об ошибках: «нет Ядра или Башни», «к башне ничего не приклеено».
2. **Башня внутри машины с ядром**: башня — обычный блок-снапшот, `buildGroups` ищет все башни, сортирует по ключу `x,y,z`, голова каждой — `headOf` с общим `claimed` (голова не заходит в чужую башню).

## 3. Алгоритмы
- `findTowerForStructure` (main.js L20005): своя башня среди снапшотов → иначе соседний с любым снапшотом блок-башня; приоритет у той, у которой клетка `башня+ось` = этот снапшот (блок в голове); иначе первый fallback.
- `headOf`: BFS по 6 граням от клетки `tower+axis`, не более `TOWER_MAX_BLOCKS=1500`, отбрасывает клетки со скалярным произведением `(p−tower)·axis < 1` и блоки-башни. То есть голова — связная область ВЫШЕ плоскости башни по оси (корпус ниже башни не вращается).
- `markTowerHeads(snapshots, root)` (зовётся из `physicsBlocksWithAttachedWheels`, main.js L615): ставит `snapshot.towerHead = "x,y,z"` башни; только для вертикальной оси. Это даёт `towerKey` блоку (L635) → в `ContraptionRenderer.js` (L61,69) блоки головы идут в свои батчи `tower|<key>` → сущность `create_physics:tower_batch`.
- `addTowerMotion(session, transforms)` — раз в тик из `applyGuidingWindSteering` (aircraft_motion.js L46, после `addPropellerBearingMotion`). Топология кэшируется по `session.snapshots`/длине/`assembly`. Каждый тик: двигает `towerAngle→towerTarget` и `towerPitch→towerPitchTarget`, если `|d|>0.0005`; **позы пересчитываются только при смене `stateKey = angle*1000+pitch`**. Позу блока головы даёт `rotorPose` (вращение вокруг оси башни) или `pitchedPose` (клетка пушки: сначала подъём вокруг казённика, ось `k=(−d.z,0,d.x)` по направлению ствола, потом поворот башни). Во время движения `collisionResponse=false` (голова не толкает корпус), после остановки возвращается true. При движении `body.wakeUp()`.
- Пушки головы (`cannonsOf`): только при вертикальной оси; для каждой детали из `parsePart` вызывается `findCannon` (cbc/multiblock.js), берутся только направления north/south/east/west, дубли по казённику отсекаются; клетки пушки = от казённика вдоль ствола. У башни может быть несколько пушек, поднимаются ВСЕ разом одним слайдером (шаг 150).
- `towerTurnOf(session, cell)` — мост к CBC: для клетки в голове даёт `{active, dir(v), point(p)}` (повернуть вектор/точку на текущие углы). Используют `cbc/cmMount.js` L119/167/287: пушка на башне не наводится своей ±5°-наводкой, а стреляет из повёрнутого положения; «поднимайте пультом башни».
- Клиентское вращение батчей: `writeTowerBatches` пишет в `tower_batch` свойства `create_physics:tw_rot` (= angle·axis.y), `tw_px`, `tw_pz` (точка башни минус `visualAnchor`), только при смене. Анимация `tower_batch.animation.json` (RP) вращает 20 слотов `slot0..19` вокруг этой точки; позиция слота кодируется в `bN_data` (6 бит x, 6 бит y, 6 бит z: `mod(d,64)`, `mod(floor(d/64),64)`, `mod(floor(d/4096),64)`) + `batch_x/y/z`. Откуда берутся `v.tw/v.twc/v.tws` — НЕ читал.

## 4. Связи в main.js
- Сохранение: `t:{p,a,g,t,q}` = положение башни, ось, текущий угол `towerAngle`, цель `towerTarget`, **цель** подъёма `towerPitchTarget` (L21987, строка прочитана целиком). При загрузке (L22123) `towerAngle=g`, `towerTarget=t`, а `towerPitch` и `towerPitchTarget` оба = `q`: подъём после загрузки сразу в целевом положении, без плавного подъёма.
- Статичный режим при загрузке: `data.t → motionType:"static"` (L22118).
- Разлом (L19302–19345): башня-основание добавляется в граф связности как **узел без блока** (`snapshot:null`), иначе корпус под башней и голова считались бы разорванными; одна башня без блоков — не кусок; кусок, связанный с узлом, получает `splitSession.towerRoot` (L19426), остальное гниёт (`rzRotMark`).
- Слом башни: `onTowerBlockBroken` (L24969): `playerBreakBlock` и `blockExplode` → у сессии `towerRoot=undefined`, `assembly.makeDynamic()`, гниение. Других способов уничтожить блок (поршни, команды) не ловит.
- Водитель в голове башни: `carFacingForward` берёт «вперёд» по креслу корпуса (L1295, `towerKeys`).
- `vehicle_systems.js` L23, L32: пульт и `towerRoot` помечают сессию `articulated` (но не самолётом).
- `aircraft_motion.js` L69–74: когда у сессии есть `towerGroups`, визуальный проход трогает ТОЛЬКО блоки, у которых есть поза башни/руля/закрылка (иначе затирал бы колёса и дуло значениями по умолчанию; шаг 141).
- Разборка (`restorePhysicsBlockBelow`, main.js L20153–20161): если башня повёрнута или поднята (`towerAngle/towerPitch != 0`) и `force` не задан, разборка ОТКАЗЫВАЕТ: цели ставятся в 0, сообщение «Башня возвращается в исходное положение, затем разберите конструкцию». Повторная разборка после возврата проходит (блоки встают в исходные клетки).
- Взаимодействие: ПКМ по `airplane_throttle` внутри конструкции → `showTowerPanel` (main.js L19494, дебаунс 5 тиков). Вне собранной конструкции блок сам шлёт сообщение «поставьте его в конструкцию, приклеенную к башне» (`registerAirplaneThrottle`).

## 5. Пульт (`showTowerPanel`)
`CustomForm`+`ObservableNumber(clientWritable)`: слайдер «Поворот башни» (шаг 5°), «Подъём пушки» (если `towerHasCannon`), кнопка «Вернуть в исходное». Слайдер пишет `state.towerTarget/towerPitchTarget` и вызывает `persist`. Пульт принадлежит башне, в чьей голове стоит (`towerForPanel`; в режиме 1 всегда единственной группе `panelHost`).

## 6. Легаси airplane_throttle.js
Сохранён от самолётной версии. `showAirplaneThrottle` (форма Left/Right, Pitch −7…7, Enable propellers) в main.js/blocks **нигде не вызывается** (grep: только определение). Живое: `registerAirplaneThrottle` (сообщение при ПКМ вне конструкции, main.js L117) и `setAirplaneVisualAngles` (используется `airplane_flight.js` L74/162: пишет `airplane_angle` и `airplane_pitch_angle` визуалам руля/пульта). Остальная самолётная часть (`airplane_flight`) описана в 04e.

## 7. RZ-винт в `addPropellerBearingMotion`
Для `vehicleSystems(session).rzProp`: скорость вращения стремится к `AIRCFG.SPIN` (с тягой `rig.thr>0.02` и `rzDrivePowered`: `SPIN*(0.15+0.85*thr)`, без тяги — `min(SPIN, |airspeed|*1.25)`; без `rzRig` — вкл/выкл по `airEngineOn`), знак от `AIRCFG.PROP_INV`, разгон ±2°/тик. Поза каждого блока из `RZ_PROP_IDS` — `rotorPose` вокруг `propAxis(snap)`. Коллизия блока выключена, пока винт крутится. Подробности тяги — 04e.

## 8. Для переписывания
Минимум: (1) голова = BFS выше плоскости башни; (2) поворот позы = Родриг вокруг оси через клетку башни + кватернионы; (3) пересчёт только при смене угла; (4) пачки головы вращаются на клиенте одной парой свойств, не по-блочно; (5) башня-основание — узел связности без блока; (6) `towerTurnOf` как единственный мост для расчёта выстрела.

## 9. Изменения в прошлых документах
Исправлено: 00_START_HERE помечал `propeller_bearing.js`/`airplane_throttle.js` как «indexed only» — теперь READ. `tower helpers: indexed only` (03b) → см. этот документ.
