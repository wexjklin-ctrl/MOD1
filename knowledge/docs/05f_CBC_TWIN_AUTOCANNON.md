# 05f — CBC: бронзовая спаренная автопушка (twin_scan.js + twin.js)

Статус: **READ построчно** — `cbc/twin_scan.js` (130 стр.), `cbc/twin.js` (899). Поведение в игре **не проверено** (в комментариях автора: «в игре НЕ проверен» для механизма сборки 47). Пути от `Trackwork_RZ_BP/scripts/`.

«Вертикальная» в заголовке twin.js означает две трубки одна над другой (A нижняя, B верхняя), а не вертикальную стрельбу: направления только `north/south/east/west`.

## 1. twin_scan.js — чистая логика сборки (без @minecraft/server)
- Префикс блоков `cbc:bronze_vt_`. Части (`TWIN_PARTS`): `breech`(B), `recoil_spring`(S), `barrel`(b), `muzzle_brake`(M), `silencer`(N) + служебные `handles` (ручки), `mount` (станина), `ammo_box`.
- Раскладка по оси: **`B B S? b{1..6} (M|N)?`**: сборка 63 требует ВТОРОЙ (задний) казённик. «Рабочий» казённик = передний (крайний у ствола): ось поворота, источник гильз, считается раскладка. `RE = /^BS?b{1,6}[MN]?$/`.
- `TWIN_LAYOUTS` — 36 строк (6 длин ствола × {без, M, N} × {без S, с S}); **индекс = номер геометрии** сущности `cbc:bt<индекс>` (порядок сгенерирован из `layouts.json`, должен совпадать с RP). `TWIN_MAX_LEN=10`.
- `scanTwin(breechPos, dir, read)`: если впереди по `dir` тоже казённик — стартовый был задним, рабочий сдвигается вперёд. Ряд читается до первой не-детали (или `handles/mount/ammo_box`); второй `breech` внутри ряда — ошибка. `cells[0]` = передний казённик, задний — **последним**. Результат: `{valid, seq, layout, cells, barrels, dir, breechPos, rearPos, hasHandles, hasMount, handlesPos, boxes}`.
  - `handles` ищутся за задним казёнником (`rearPos − v`); `mount` — блок под любым из двух казёнников; `ammo_box` — сбоку (поперёк оси) любого из двух казёнников, `boxes[i] = {pos, which:'f'|'r', lat, facing, slot}`.
  - `boxSlot(dir, which, lat)` → 0..3: 0 передний-левый, 1 передний-правый, 2 задний-левый, 3 задний-правый (модели `cbc:btx0..3`).
- `findTwin(start, read)`: по ЛЮБОМУ блоку пушки. Станина → казённик сверху; ящик → казённик сбоку, кандидаты — перпендикуляры; ручки → казённик спереди; казённик → направление из его `facing` приоритетно, затем остальные; прочие детали → идём по прямой в 4 стороны до казённика. Возвращает первый валидный скан, иначе «самую длинную» неудачу.

## 2. twin.js — состояние, посадка, стрельба

### 2.1 Хранение
- World dynamic property `cbc:btc:<dimId>:<x>,<y>,<z>` (координаты переднего казённика), JSON `{v:1, a:{n,q}, b:{n,q}, next:'a'|'b', active, cap, cells?, layout?, seq?, dir?, barrels?, dim?}`. `q` — строка очереди патронов ствола (`a`=бронебойный, `e`=фугасный; прочие символы выкидываются `queueOf`, старые зенитные f/g/h удалены). `cells` = снимок блоков `{p:[x,y,z], t:typeId, s:allStates}` на время посадки.
- `pruneStates` (раз в 6000 тиков, только при посадке, постоянного таймера нет) удаляет записи, чей казённик не `cbc:bronze_vt_breech` (взрыв, команда).
- Вместимость: `ROUND_CAP=8` на ствол; с ящиком сбоку `BOX_CAP=45` на ствол (90 всего); `capFor(found)`. Сломанный ящик (`dropBoxAmmo`) выбрасывает патроны сверх 8 на ствол предметами (стаками по 64).
- Патроны (`ROUNDS`): `cbc:ap_autocannon_round` (код a, munition `ap_autocannon`), `cbc:he_autocannon_round` (код e, `he_autocannon`). Заряжание `applyTwinLoad`: в ствол с меньшей очередью (при равенстве A), если оба полны — отказ.

### 2.2 Посадка (`mount`)
Триггеры: компонент блока `cbc:twin_handles` (`onPlayerInteract`, нужен, чтобы пустая рука вообще давала событие), before/after `playerInteractWithBlock` по `handles` (без Shift, не патрон). Дубль защищён `tryMount` (10 тиков на игрока). `AUTO_MOUNT=false`.
Условия: не `S.frozen`, скан валиден, есть `mount` и `handles`, пушка не занята, игрок не сидит в другой.
Порядок (важен, чтобы не терять блоки): выровнять ручки/ящики → снять `cells` (все части + ручки + ящики) → `sweep` старых сущностей (14 блоков) → создать сиденье `cbc:btc_seat` на окружности за казёнником (`SEAT_BACK=3.1`) → `refreshVisual(force)` (при неудаче блоки не трогаются) → **записать состояние** → `setType(air)` для всех блоков пушки → `act.set` + `ensureLoop` → `addRider`; запасной путь `/ride … teleport_rider` через 2 тика; предупреждение через 12 тиков; `faceFwd` (setRotation = yaw пушки) на тиках 0/1/3.

### 2.3 Живой цикл
`system.runInterval(tick, 1)` существует ТОЛЬКО пока `act.size>0`. `stepOne` на тик:
- `pending` (блоки не удалось вернуть) → повтор `restore` раз в 20 тиков, до 30 попыток, затем запись остаётся, вернётся при загрузке мира.
- Сиденье пропало → `restore` сразу. Любая часть модели невалидна → `refreshVisual(force)` не чаще раза в 10 тиков.
- Есть седок: `slew` — пушка догоняет взгляд игрока (`TURN_RATE=2°/тик` yaw, `ELEV_RATE=1.5°/тик` pitch, наклон `PMIN=−12 … PMAX=60`), `placeSeat` (сиденье на окружности по yaw; если перенос сбросил седока → `orbit=false`, сиденье в центре), `refreshVisual`, `updateRecoil`, `updateCamera`; раз в 10 тиков actionBar со статусом.
- Седока нет и (`seen` или вышло `grace=40` тиков) → `returning`: сиденье удаляется, плавный возврат yaw (`3°/тик`) и наклона к 0, затем `restore`.
- `restore`: блоки из `cells` возвращаются `BlockPermutation.resolve(t, s)` (кроме разбитых `a.lost`); `st.active=false`, `cells/eid` удаляются; сущности убираются + `sweep` 14 блоков.
- `restoreTwins()` при загрузке мира: для каждой записи `active` вызывает `restore`; неудавшиеся уходят в цикл; затем удаляет все сущности семейств `cbc_btc` и `cbc_btc_seat`, кроме отслеживаемых.

### 2.4 Модель
Сиденье и модель разделены. Модель **неподвижна**, пересоздаётся командой `summon <id> x y z yaw pitch <event>` при смене квантованного yaw (`YAW_STEP=4°`, не чаще раза в `VIS_MIN_INTERVAL=2` тика) или наклона (`PSTEP=3°`); запасной путь `spawnEntity` + `setRotation/teleport`. (Комментарий в шапке файла говорит «6°», код — 4°: актуально значение кода.) Три сущности + ящики: корпус `cbc:bt<layout>`, стволы `cbc:bt<layout>a` (нижний) и `…b` (верхний), ящики `cbc:btx<slot>`. Шаг наклона передаётся событием `cbc:pk<k>`, `k = round((pitch−PMIN)/PSTEP)`.
Откат: ствол сдвигается назад `teleport` каждый тик по `recoilD`: без пружины `RECOIL_TICKS=10`, `RECOIL_DIST=0.3`; с пружиной `SPRING_TICKS=16`, `SPRING_DIST=0.88`; затухание `(1−u)²`.
Камера: если в руке «спуск» `cbc:autocannon_trigger` — `camera.setCamera('minecraft:free')` из дула (`CAM_USE_GUN_DIR=true`: по направлению ствола, не взгляду); защита от «иксрея»: 7 точек вокруг камеры, любая внутри твёрдого блока/незагруженного чанка → `camera.fade` чёрный (повтор раз в 5 тиков, проверка раз в 2 тика, кэш 10 тиков).

### 2.5 Выстрел (`shoot`)
Источники: ПКМ по блоку/сущности, `itemUse`, (Jump отключён `JUMP_FIRES=false`). Ограничения: `S.frozen`, один выстрел в тик, `MOUNT_FIRE_DELAY=20` тиков после посадки, `GLOBAL_CD=6`, `BARREL_CD=20` на ствол, `liveCount() < LIMITS.maxProjectilesAlive`. Стволы чередуются A/B (`st.next`); если очередь выбранного пуста — стреляет другой, оба пусты → сообщение.
Баллистика: `planShot` с псевдо-сканом бронзы `{materialId:'bronze', chambers:1, barrels}` даёт `spreadDeg`; затем:
- `braked` (в seq есть M): `speedMult/gravityMult/spreadDeg` из `AUTOCANNON_MODS.brake`; `muffled` (seq кончается на N): `AUTOCANNON_MODS.silencer`; нет пружины: `+noSpringSpreadDeg`.
- `power = powerMin + (powerMax−powerMin)·(barrels−1)/5`; `speed = AUTOCANNON[munition].speed · (0.92 + 0.08·barrels/6) · modSpeed`.
- Точка вылета: `pivot + dir·(len−0.5+0.7) + up·(±0.25)` (A −0.25, B +0.25); направление с разбросом `applySpread`.
- `spawnProjectile(dim, origin, vel, munitionId, 0, {gravityMult, power})`; затем очередь −1, `next` переключается, состояние пишется, откат этой трубки, звук `cbc.fire_autocannon` (с глушителем тише и выше), гильза `ejectCasing` (A вправо, B влево) и звук экстракции через 3 тика, `muzzleBlast(light=true, quiet=silenced)`, тряска только без пружины.
Конфиги `AUTOCANNON`, `AUTOCANNON_MODS` лежат в `config/overrides.js` (05b).

### 2.6 Урон по пушке
`setTwinHooks(damageTwins, probeTwinHit)` (impact.js) регистрирует хуки. `probeTwinHit` — три точки пушки (база, сиденье, середина ствола) в радиусе r от снаряда. `damageTwins(dim, at, R)`: если `dmin ≤ R+1.5`, теряются 1 деталь (2, если `dmin ≤ 0.5R+1`) из `cells` случайно (`a.lost`), сиденье удаляется → `stepOne` сразу `restore`; потерянные детали не возвращаются, при `restore` выпадают предметом с шансом 50% (только `cbc:*`); разбитый ящик роняет патроны. Один раз на тик (`hurtTick`).

### 2.7 События
`registerTwin()`: before `playerInteractWithBlock` (сидящий: отмена + выстрел/заряжание; иначе заряжание патроном по любой детали, с Shift не перехватывается), after (ручки → посадка; остальное/Shift → `report`), before `playerInteractWithEntity` (патрон по сущности пушки = зарядить), `itemUse`, `playerButtonInput` (Jump), `playerSpawn` (снять забытые спуски и камеру), `playerPlaceBlock` (автовыравнивание ручек и ящиков `facing` к казённику), `playerBreakBlock` (казённик → стереть запись; ящик → `dropBoxAmmo`).

## 3. Подводные камни
- Блоки пушки физически **удаляются** на время посадки; единственная копия — `cells` в dynamic property. Любой путь, не доходящий до `restore`, теряет пушку.
- Порядок слоёв в `TWIN_LAYOUTS` и номера `cbc:bt<n>` связаны с генератором RP; менять только вместе.
- Ящики и ручки выравниваются по `facing`: поведение зависит от геометрии (сборки 57–64).

*В прошлых документах изменений нет.*
