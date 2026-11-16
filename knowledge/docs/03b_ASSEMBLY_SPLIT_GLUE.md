# 03b. Сборка, добавление/поломка блоков, разделение на куски, клей, гниение, «рубка деревьев»

Статус: READ построчно (main.js, номера строк — оригинал). Поведение в игре НЕ проверено.
Связанное: `03_CONTRAPTIONS_SESSIONS.md` (сессия, сохранение), `04_VEHICLES.md`.

## 1. Клей (physics_glue)
- Два вида: (а) одиночный блок: dynamic property `create_physics:glue_<dim>_<p|n><x>_<y>_<z>` = true (`physicsGluePropertyId` L23870, `togglePhysicsGlue` L23886); (б) область: массив `physicsGlueAreas` (только в памяти, не в сохранении), области со смежными/пересекающимися AABB сливаются (`doPhysicsGlueAreasTouch` L24370, `mergePhysicsGlueArea` L24024), при слиянии каждая ячейка области тоже получает property. Область — это объём целиком, включая воздух между кусками.
- Лимиты: скан области `PHYSICS_GLUE_MAX_SCAN_VOLUME`=32768 ячеек (`createPhysicsGlueArea` L24120), таймаут выделения 600 тиков, размер конструкции `MAX_CONTRAPTION_BLOCKS`=4096 (ContraptionStorage.js L4; `getContraptionBlockLimit()` всегда его возвращает).
- Ломание блока в мире снимает property и вычёркивает ячейку из областей (playerBreakBlock, L18496).
- `collectPhysicsGlueStructure(sourceBlock, attachedRoot)` L24409 — BFS: старт = блок под контроллером. Если ни область, ни property, ни хранилище/бак — возвращает только его самого. Иначе: (1) все блоки областей (кроме воздуха, жидкости, ландшафта `rzIsTerrain`, lamp_light, controller…); (2) расширение BFS по 6 граням (`PHYSICS_GLUE_NEIGHBORS`): сосед берётся, только если он не воздух/жидкость/ландшафт/lamp_light/controller/gravity_gauntlet И `isPhysicsGlued(block)` (property клея = true, либо это `hot_air_envelope`) — условие L24479 прочитано целиком; блоки областей (п.1) берутся без проверки property (L24426). Ранний выход L24412: без области, без клея на старте и не vault/tank — только сам блок; (3) двери добавляют вторую половину, vault и tank — все связанные блоки (`connectedVaultBlocks`, `connectedTankBlocks`); (4) воздушный шар: у `hot_air_envelope` соседство 26 направлений, из него в необолочечные блоки идёт только клей.
  Ландшафт (земля, песок, природный камень) никогда не склеивается (`glue_filter.js: isTerrainBlock`).

## 2. Сборка (контроллер → физическое тело) `activatePhysicsBlockBelow` L20023
1. Ключ контроллера `physicsControllerKey` = `dim|x,y,z`; если сессия уже есть — выход. Блок под контроллером: воздух/жидкость/controller/lamp_light → отказ; ландшафт → сообщение.
2. `collectPhysicsGlueStructure` → при необходимости `cbcReleaseRaised` (вернуть пушки, поднятые в мире) и пересбор.
3. RZ-правило: нужен блок `CORE_ID` (glue_filter.js) ИЛИ «башня» (`findTowerForStructure`). Нет ни того ни другого → сообщение, отказ. Режим башни (шаг 138): башня остаётся блоком мира, конструкция — `motionType:"static"`, вращается вокруг оси башни; session.towerRoot={location,axis,towerAngle:0,towerTarget:0}.
4. В набор добавляется сам контроллер; захват заборов, колёс (`captureWheelAttachments`), хранилищ; `createPhysicsControllerAssembly`; `validateContraption*`.
5. Журнал: сессия кладётся в `physicsControllerPhysicsSessions`, `persistPhysicsControllerSession` (с `preparedSources`), только потом блоки мира заменяются на `minecraft:air`, баки очищаются, кожухи пересчитываются; создаются сущности (ручки, пропеллеры, горелки, кресла, коллизии, колёса); второй persist без `preparedSources`; `consumePhysicsGlueAreas` стирает использованные области.
6. При любой ошибке — откат: удалить сессию/сохранение/assembly, вернуть блоки из `sourceSnapshots`, вернуть содержимое хранилищ и жидкости.
Вызывается из `togglePhysicsBlockBelow` L19980 (`contraptions.mount`).

## 3. Добавление блока к собранной конструкции `placeBlockOnPhysicsController` L19675
- Условия: креатив/выживание, предмет в руке совпадает, не гаечный ключ/клей/верёвка/gravity_gauntlet, не запрещённый (`isBlockedStructureItem`). Колесо → `attachWheelToPhysicsMount`. Не чаще раза в 3 тика на игрока.
- Нормаль грани берётся из луча в ЛОКАЛЬНОЙ сетке конструкции (`sailPlacementNormal`), обязана быть единичным осевым вектором; клетка-сосед не должна быть занята; лимит 4096 (иначе actionbar `too_large`).
- Состояние блока: `physicsPlacementPermutation` L19833 — по взгляду игрока, переведённому в локальные координаты тела: cardinal/facing/pillar_axis/vertical_half/top_slot/upside_down, особые случаи: copycat_step, windmill sail, hatch, funnel, drill/deployer (острие к игроку), barrel, лестницы, люки, ladder. Парус (symmetric sail): присед = горизонтальное крыло (RZ).
- Двери занимают 2 клетки. Затем `orientAirplaneSails`, `orientPropellerSails`.
- Применение: `addBlocksToAssembly(assembly, additions, [PHYSICS_CONTROLLER_VISUAL_TAG])` → `body.teleport` в ту же позу/скорость → `wakeUp` → `syncVisuals(true)`. Потом пересоздаются ручки/пропеллеры/горелки/кресла/коллизии/колёса, ВСЕ блоки получают `glued=true` (кроме контроллера), `persist`, списание предмета (не креатив), звук `use.stone`.

## 4. Поломка блока конструкции `removePhysicsSnapshotBlock` L19008
- Вызывается из добычи игроком (L18978–19005: прогресс по ударам, `physicsBlockBreakHits`; креатив или `disassembly_wrench` = мгновенно), из взрывов (шаг 112: RZ_BLAST_POWER, ослабление 0.75/блок, лимит `RZ_BLAST_MAX_BLOCKS`=24 за взрыв, ломается если остаток > (сопротивление+0.3)*0.3) и от снарядов.
- Парные блоки: дверь (обе половины), колесо на креплении (колесо ниже/спереди, дроп колеса, `rzMarkTrackBroken`).
- `removeBlocksAtLocalLocations`; снапшот удаляется из session.snapshots; если сломали последнее ядро (а блоки остались) — вся сессия `rzRotMark`; `refreshPhysicsStructureConnections`; дроп содержимого хранилища и предмета (не креатив).
- Если блоков не осталось — сессия удаляется, сущности снимаются; иначе `splitDisconnectedPhysicsControllerSession`; если разделения нет — пересборка сундуков/vault/tank и persist.

## 5. Разделение `splitDisconnectedPhysicsControllerSession` L19287
- Граф: узлы = snapshots (локальные координаты), рёбра = 6 соседей. Компоненты BFS. Для поручня (`handrailEntry`) добавляется виртуальный узел 0,0,0 (слайдер); для башни — узел башни (связывает корпус и голову).
- Предохранитель: >64 компонентов → разделение отменено (возврат false).
- Сортировка по размеру (при поручне — сначала компонент с рельсой). Первая компонента сохраняет `controllerKey` и `controllerLocation`.
- Каждый кусок: `createAssembly` в позе старого тела (`bodyLocation`, `bodyRotation`, `visualRotationReference`), скорость `inheritSeparatedBodyMotion`: v нового центра масс = v старого тела в этой точке, угловая скорость копируется (0 для зажатых поручнем). Кусок на башне — `motionType:"static"`. Кусок с поручнем: `dynamic`, без сна, linearFactor по оси рельсы, angularFactor 0.
- Блоки берутся из старых `originalBlocks` (не пересоздаются). При ошибке создания — откат всех созданных кусков.
- Старая сборка удаляется; storage-сущности и верёвочные частицы переприписываются ближайшей компоненте (`assemblyForLocal`). Новые ключи сессий: `controllerKey` для первого, иначе `dim|x,y,z` первого снимка (+`_split_<tick>_<i>` при коллизии ключей). Каждой сессии: сущности, `persist`; `detachedComponent = index!=0`.
- Гниение (RZ): если у части компонент есть ядро, а у других нет — безъядерные помечаются `rzRotMark` (также если сессия уже гнила, или режим башни).

## 6. Гниение обломков `blocks/rz_rot.js` (56 строк, READ)
`ROT.ON`=1, `STAGE_TICKS`=14: стадии темнения 1..3, на 4*14=56 тике `finish` (без выпадения блоков; содержимое сундуков выпадает). Таблица `dying` в памяти (не сохраняется). Команды `scriptevent rzlite:rot on|off|stage <n>`; настройки в world dynamic property `rzlite:rot`. Реализация `smoke/finish` передаётся из main.js (я их не читал).

## 7. «Рубка деревьев» (planner разлома) и fallen-physics — ПОХОЖЕ НА МЁРТВЫЙ КОД
Классы `PhysicsBreakPlanner` (L16451) и `FallenPhysicsLifecycle` (L12408) — наследие мода физики падающих деревьев (logs/leaves/roots, `createChopMotion`, `getPhysicsFellingToolProfile`), а НЕ разлом машин. Статический grep по main.js и по остальным .js: `physicsBreakPlanner.prepare`, `executePhysicsBreak` и `fallenPhysicss.register` НЕ вызываются нигде, кроме собственных определений (planner используется лишь через `invalidateNear` при поршнях; `pendingBreaks` объявлен и не используется). Подписки живы: `collision`, `waterEntry`, `lavaEntry`, `step` → `fallenPhysicss.tick`, но при пустых таблицах tick выходит сразу (L12738). Значит дерево физически не падает, если только состояние не загружено из старого сохранения (`create_physics:fallen_physicss`). Не проверено в игре. Прочитано: `prepare`/`invalidateNear`/`commitBreak`, `executePhysicsBreak`, `handleCollision`, `tick`. НЕ прочитано: `register`, `tickDecay`, `tickSettlement`, `damageEntities`, топология (`collectConnectedLogs`, `analyzeRoots`).
Для переписывания: этот блок можно не переносить.

## 8. Дочитано позже (добавлено во второй проход)
- `createPhysicsControllerAssembly` L24721: `validateContraptionSnapshots`, `captureTankFluids`, затем `createAssembly({angularVelocity:0, blocks:[...physicsBlocksWithAttachedWheels(snapshots, location, towerRoot), ...baseBlocks], location: blockCenter(location), name: "Glued physics structure" (>1 блока) | "Controller physics block", velocity:0, ...motion, visualEntityTags:[PHYSICS_CONTROLLER_VISUAL_TAG,...]})`. Любые лишние опции (`motionType`, `allowSleep`, `linearFactor`…) пробрасываются в createAssembly.
- `refreshPhysicsStructureConnections` L20889: girders, баки, заборы, решётки, стены, лестницы. `schedulePhysicsFenceEntityConfiguration` L20899 — то же + сундуки, vault, кожухи, люки, плиты, ковры, люки-трапы, copycat, и повтор через 1/2/4/8/16 тиков (визуалы сущностей приходят позже).
- Башня: `findTowerForStructure` L20005 — своя башня в наборе, иначе соседний с ней блок мира типа TOWER, у которого «голова» (`b.location + towerAxis`) стоит на блоке конструкции; иначе любой соседний (`fallback`). `onTowerBlockBroken` L24969: при сломе башни (игрок или взрыв) у сессии стираются towerRoot/Groups/Keys/Topo, `assembly.makeDynamic()`, `rzRotMark`, persist. Файл `blocks/tower.js` (283 строки) НЕ читал.
- `syncHandrailControllerSession` / `handrailAssemblyOptions` (L24736–24780): поручень-рельса: тело `dynamic`, `allowSleep:false`, linearFactor 1 только по оси рельсы, angularFactor 0, базовый блок `handrail_panel` (масса 2, без рендера, без collisionResponse). Остальное в поручнях не читал.

## 9. Всё ещё не прочитано
`physicsBlocksWithAttachedWheels` (L614), `capturePhysicsStorageEntities`, `restorePhysicsBlockBelow`, `handlePhysicsGlueAreaUse` (UI выделения), `rzAssembleNotify`, `blocks/tower.js`, реализации `smoke/finish` гниения.
