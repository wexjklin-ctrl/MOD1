# 03e — Хранилища на конструкциях: сундуки, бочки, vault, баки, handles

Статус: **READ построчно** `blocks/vault.js` (110), `blocks/tank.js` (182), `blocks/tank_storage_bridge.js` (37), `blocks/chest.js` (98), `blocks/double_chest.js` (143); в main.js: `capturePhysicsStorageEntities` и соседи (L23456–23750), `configurePhysicsVaultEntities/TankEntities` (L21022–21093), разлом/слом блока (L19023–19100), `rzRotFinish` (L19255), `createPhysicsHandleInteractionEntities` + sync/remove (L22350, 23751–23777), `resolveStoredHandlesEndpoint` и соседи (L2167–2230), восстановление (L20142–20232). Поведение в игре НЕ проверено.

## 0. Главная идея
Блок-контейнер мира нельзя двигать вместе с телом, поэтому при сборке его содержимое переезжает в **сущность-носитель инвентаря**, которая каждый тик телепортируется к точке блока на теле. Блок мира удаляется, а визуал (`create_physics:chest|barrel|vault|tank`) рисует сам блок. Единственная связь «блок ↔ инвентарь» — поле `snapshot.storageEntityId` (сохраняется в сессии, `entry[5]` в формате L22075; в записи L21963). Общая карта `physicsStorageEntities: Map<entityId, {assembly, entity, localLocation, chestPairAxis?, ...}>`.

Типы носителей:
| носитель | для чего |
|---|---|
| `create_physics:physics_chest` | сундуки (обычные, trapped, медные 4 стадии окисления и вощёные), бочки `minecraft:barrel`; 27 слотов, 54 для двойного (событие `create_physics:double_inventory`, обратно `single_inventory`) |
| `create_physics:storage_container` | СТАРЫЙ носитель бочек (54 слота); `upgradePhysicsBarrelInventory` заменяет его на `physics_chest`, если слоты 27+ пусты (иначе оставляет) |
| `create:vault_storage_anchor` (`VAULT_ANCHOR_ID`) | ОРИГИНАЛЬНАЯ сущность хранилища из другого мода Create: инвентарь не копируется, переезжает сама сущность (без потери слотов) |
| деплоер: «рука» (`ensurePhysicsDeployerHands`, см. 03c) | предмет в руке |

## 1. Сундуки и бочки
- Сборка (`capturePhysicsStorageEntities`, L23523): сначала vault и руки деплоера; потом для каждого сундука/бочки читает контейнер блока, спавнит `physics_chest` в `point.y−0.5` (двойной сундук — со `spawnEvent:"create_physics:double_inventory"`), копирует слоты, **очищает блок-источник**. При любой ошибке откат: предметы возвращаются в блок, носитель удаляется. Пустой двойной, чей партнёр уже имеет носитель, пропускается.
- `ensureEmptyPhysicsChestInventories`: носитель для снапшотов без `storageEntityId` (например, сундук поставлен на уже собранную конструкцию).
- Бочка: `nameTag = "§r"×6` (скрытый маркер для маршрутизации UI), сундуки: `physicsChestInventoryTitle` — `§r` ×2/3 (обычный/двойной) или ×4/5 (медный). Видимый заголовок рисует зарегистрированный UI, носитель невидим (эффект `invisibility` на 20000000 тиков).
- Носитель неуязвим: `entityHurt → cancel` (chest.js L29). Добычу блока ведёт физика.
- Анимация крышки (`initializePhysicsChestAnimation`): события `entityContainerOpened/Closed` (если есть в API), иначе пульс на `playerInteractWithEntity` на 50 тиков (приседающие игнорируются); раз в 4 тика проверка. Обновляет свойство визуала `create_physics:chest_open|barrel_open`, играет звук. Состояние `storage.chestOpen`.
- Двойной сундук (`double_chest.js`): партнёр = сосед по линии вдоль оси того же `yaw`, пары считаются по чётности внутри непрерывной линии (`physicsChestPartner`). `configurePhysicsChests` объединяет два инвентаря в один носитель (владелец — тот, у кого контейнер больше), ставит ему позицию в середину пары, `chestPairAxis`, модель визуала (`chest_model`: 0 одиночный, 1/2 — левая/правая половина владельца, 3 — партнёр), `chest_variant` (0 обычный, 1 trapped, 2–5 медные). Если предметов больше, чем помещается в 54 — партнёрство отменяется, предметы не теряются. Хитбокс: `syncPhysicsChestHitbox` шлёт сущности событие `create_physics:single_hitbox|double_x_hitbox|double_z_hitbox` по текущей ориентации пары в мире.
- `detachPhysicsChest` (до слома одной половины): разрезает 54 слота на два носителя по 27 (первые 27 остаются, вторые 27 уходят новой сущности), только если у второй половины нет своего носителя.
- Восстановление блоков (`restorePhysicsStorageInventory`): копия слотов в контейнер блока; **переполнение** (двойной → два одиночных) вываливается предметами в мир, не теряется. Носитель удаляется. Для vault: сущность не копируется, а телепортируется на блок, теги переписываются (§2). Деплоер: рука восстанавливается как `create:deployer_entity`.
- Слом блока в конструкции (L19058): все предметы носителя спавнятся в точке блока, носитель удалён. Гниение обломка (`rzRotFinish`, L19255): предметы всех носителей высыпаются в точке тела.
- Синхронизация позиции: `syncPhysicsStorageEntities` каждый тик, `getArticulatedLocalLocation` — чтобы сундук на вращающейся голове башни ехал с блоком (шаг 142). У сундука `y−0.5`. Для vault-носителей реже: спящее тело — раз в 60 тиков, активное — раз в 5 тиков с шагом по `vaultIndex%5`.
- Загрузка чанка: `entitySpawn` для `storage_container`/`physics_chest`/движущихся vault-якорей → `reconnectLoadedPhysicsStorageEntity` через `system.run` (L18319). `reconnectPhysicsStorageEntities(session)` — то же при загрузке сессии.

## 2. Vault (`create:vault`, чужой мод Create)
- Состояния блока: `create:size` (1/2/3), `create:section` (single/start/middle/end), `create:pos_h`, `create:pos_v`, ось из `minecraft:cardinal_direction` (east/west→x, иначе z).
- `updateVaultConnections(snapshots, field)` — **пересчёт мультиблока только при смене топологии**, не в тике: для size 3,2,1, по сидам в порядке x,y,z выбирает квадрат size×size и до `3·size` слоёв вдоль оси; слой должен быть полным и той же оси. Записывает `size/section/pos_h/pos_v` в permutation (для оси x `pos_h` зеркалится `size−1−h`). `positionField` может быть `"targetLocation"` (при разборке).
- `connectedVaultBlocks(snapshot, dimension)`: найти ВЕСЬ существующий мультиблок мира по состояниям, даже если приклеен только один блок (используется при склейке L24448); бросает «Vault incompleto…», если часть не загружена.
- Носитель: `capturePhysicsVaultStorage`: берёт существующий `VAULT_ANCHOR_ID`-якорь по тегу `storage_block_X_Y_Z` (пропуская движущиеся), иначе спавнит; ставит теги `create_physics_vault_moving`, `create_physics_vault_origin_X_Y_Z`, `create_physics_vault_pending`; телепортирует в точку блока. Не загруженный чанк — отложить (`deferUnloaded`), повтор через 20 тиков (`ensurePhysicsVaultInventories`); **«незагруженный якорь не равен пустому инвентарю»**.
- Восстановление: якорь телепортируется в центр блока, старые теги `storage_block_*`/`storage_id_*` снимаются, ставятся `storage_block_<новый>`, `create_vault_storage_anchor`, `create_physics_vault_restored`, снимается `..._moving`.
- Визуал: `vaultVisualProperties` → `create_physics:vault_size|section|h|v`; применяет `configurePhysicsVaultEntities` (и в `block.visualProperties` сборки, и в уже созданные сущности).

## 3. Баки (`create:fluid_tank`, `create:creative_fluid_tank`)
- `updateTankConnections`: для каждого типа ищет по сидам (y,x,z) максимальный по объёму столб ширины 3/2/1 (до 32 по высоте); пишет в permutation `create:size/height(single|bottom|middle|top)/pos_x/pos_z`, и в снапшоты: `tankFluid {fluid, amount на клетку}`, `tankFluidBottom` (0.0625 у нижней), `tankFluidLevel` (доля высоты клетки). Ёмкость клетки **6000** (мБ-единиц, в коде просто число); уровень `(h−0.125)*amount/(vol*6000)+0.0625`.
- Жидкость хранится у ОРИГИНАЛЬНОГО мода Create в `world.getDynamicProperty("<typeId>:<dim>:<x,y,z>")` = `{fluid, amount}` (общая сумма мультиблока повторяется в ключе КАЖДОЙ клетки). Динамические свойства принадлежат паку: чужой пак их не прочитает, поэтому есть мост.
- `captureTankFluids` (сборка): суммирует по `connectedTankBlocks`, делит поровну на клетки (`amount/cells`), потолок `cells*6000`. `clearCapturedTankFluids`: очищает свойства снятых блоков, шлёт `sendTankStorage("clear",…)`, удаляет статичную сущность `create:fluid_tank_fluid` над столбом, если ВСЕ её клетки уже сняты.
- `restoreTankFluids` (разборка): пересобирает мультиблок по целевым клеткам, суммирует, пишет в dynamic property КАЖДОЙ клетки и шлёт `sendTankStorage("restore",…,{fluid,amount})`; спавнит/переиспользует `create:fluid_tank_fluid` (свойства `tank_width/tank_height/fluid_height/fluid_type`), дубликаты удаляет.
- Мост `tank_storage_bridge.js`: `sendTankStorage(action, dim, typeId, positions, state)` → `scriptevent create_physics:tank_storage` пачками по 24 позиции. Обратный канал: `scriptEventReceive` `create_physics:tank_state` → записывает `{fluid,amount}` в dynamic property этого пака (только если блок с таким `typeId` ещё стоит: «запоздавшее сообщение не должно пополнить уже захваченную клетку»). При старте шлёт `snapshot` с пустым списком.
- Визуал: `tankVisualProperties` → `create_physics:tank_size|height|pos_x|pos_z|off|creative|fluid_height|fluid_bottom|fluid_type`; тип жидкости: lava/honey/chocolate/milk по подстроке id, иначе water. Сущности `create_physics:tank` и `tank_fluid`.

## 4. «Handles» — ДВА разных понятия (ловушка)
1. `create_physics:handles` — блок-поручень/ручка, сиденье-прокси: `createPhysicsHandleInteractionEntities` (L22350) спавнит `create_physics:handles_interaction` в `point.y−0.7`, ведёт тик-синхронизацию `syncPhysicsHandleInteractionEntities`. Что именно делает прокси при ПКМ (посадка), не читал.
2. «Handles» в именах `handlesParticleLinks`, `findPhysicsHandlesEndpoint`, `resolveStoredHandlesEndpoint`, `refreshHandlesEndpoint`, `rebindHandlesRopesAfterPhysicsRestore` — это **концы веревки (`create_physics:rope_hook`)**, не блок `handles`. `resolveStoredHandlesEndpoint(dim, loc)`: если на `loc` стоит блок `rope_hook` → конец `{kind:"block"}`; иначе ищет `rope_hook` с такими же исходными координатами среди снапшотов живых сессий → `{kind:"physics", assembly, localLocation}`. `rebind…AfterPhysicsRestore` превращает концы `physics` обратно в `block` по `targetLocation` после разборки. Верёвки — 03c.

## 5. Разборка и готовность
`restorePhysicsBlockBelow` отказывает (`return false`), пока не все носители с `storageEntityId` `isValid` (незагруженный носитель ≠ пустой) или пока целевая клетка занята (`physicsRestoreCellAvailable`: воздух или `lamp_light`). Затем `finishPhysicsBlockRestore` ещё раз, через 6 тиков (для рельс-груза — сразу). Баки: `restoreTankFluids`.

## 6. Для переписывания
(1) Носитель инвентаря + `storageEntityId` как единственная связь; (2) копировать с откатом при ошибке; (3) не считать незагруженную сущность пустой; (4) мультиблоки (vault, tank) пересчитывать только при смене топологии, хранить состояния в permutation; (5) жидкость бака — общая сумма, хранить по клеткам делением, при слиянии суммировать; (6) мост между паками только через scriptevent, dynamic properties изолированы.

## 7. Не прочитано
UI-реакция `handles_interaction`/посадка; `ensurePhysicsDeployerHands` (деплоер, 03c: indexed); `block.visualProperties` и как рендер передаёт их в сущность (ContraptionRenderer, 03).
