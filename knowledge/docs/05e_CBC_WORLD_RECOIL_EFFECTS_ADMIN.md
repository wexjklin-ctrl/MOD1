# 05e — CBC: мир (заряжание/выстрел/редстоун), откат и наводка, эффекты, админ-меню

Статус: **READ построчно** — `cbc/world.js` (790 стр.), `cbc/recoil.js` (545), `cbc/effects.js` (155), `cbc/admin.js` (160). Поведение в игре **не проверено** (в коде много `TODO-VERIFY`). Пути относительно `Trackwork_RZ_BP/scripts/`. Строки `__t(id)` — i18n, расшифровка в `_generated/`.

Это обычная («стационарная») пушка CBC в мире блоков. Снаряд после `spawnProjectile` живёт в `cbc/projectiles.js` (см. 05c). Пушка на физической конструкции переносит заряд через `getLoadAt/setLoadAt` (см. §1.6).

## 1. cbc/world.js — адаптер Script API для мультиблока

### 1.1 Чтение блоков
- `makeReader(origin)` → `pos => {typeId, facing}`; `facing` берётся из состояния `minecraft:facing_direction`, только если значение из `north/south/east/west/up/down`. Ошибка/незагруженный чанк → `undefined`. Передаётся в `findCannon` (multiblock.js, см. 05b).
- `findCannon(pos, reader)` → `{breech, scan}`; `scan.valid`, `scan.reason`, `scan.direction`, `scan.breechPos`, `scan.muzzlePos`, `scan.chambers`, `scan.barrels`, `scan.materialId`, `scan.mortars`.

### 1.2 Состояние заряжания (хранится в dynamic properties МИРА)
- Ключ: `cbc:load:<dimId>:<x>,<y>,<z>`, координаты = **казённик (задний блок)**. Значение: JSON `{projectileId, charges, fuze}` (`fuze` число, `charges` число; битый JSON → пустой заряд).
- Угол наводки: `cbc:elev:<dimId>:<x>,<y>,<z>` (число градусов; 0 = ключ удаляется).
- `setLoad` вызывает `syncArmed`: заряжена = `projectileId && charges>0` → ключ в `armed` (Set) и запускается опрос.
- При ломании/взрыве любой части (`parsePart(typeId)`) вызывается `releaseByPos` + `clearLoadAt` (чистит load, elev, armed, lastPowered, partsCache, lastShot). Запись привязана к заднему блоку; для остальных блоков ключа нет, вызов безвреден. Если казённик исчез без события, опрос сам вызывает `clearLoadAt`.
- Загрузка мира: `armFromWorld` перебирает `world.getDynamicPropertyIds()` по regexp `LOAD_KEY_RE` и берёт заряженные пушки под наблюдение.

### 1.3 Вертикальная наводка
- `ELEV_STEP = 5°`. `elevRange(scan)`: только горизонтальные пушки (`north/south/east/west`), диапазон `rulesOf(scan).elevMin/elevMax` (по комментарию: сталь −10..50°, чугун 0..10°, реальные числа в `CANNON_RULES`, 05b). Вертикальные и материалы без `elevMax` → 0..0.
- `canAim` = диапазон не нулевой. `effElev` = сохранённый угол, срезанный до диапазона, либо 0.
- Наводка: `gauntletInfo(itemStack)` (core/gauntlet.js) в режиме `aim` = +5°, `aimdn` = −5°; клик по блоку пушки в beforeEvent, действие через `system.run → adjustElevation`. Обычная палка не работает (комментарий в коде).
- `adjustElevation`: `next = canElevate(scan) ? clampElevation(dim, scan, want, 5) : want`; сохраняет `setElev`, сообщает в actionBar (разные `__t(189..191)`: упёрся в блоки / в предел диапазона / ок), затем `syncRaise`.
- `syncRaise(block)`: визуальный наклон = угол игрока **только если пушка заряжена** (снаряд И заряд), иначе 0. Перед этим угол ещё раз зажимается `clampElevation` (проверка блоков на пути ствола — только в момент события).
- `tiltVec(v, dir, deg)`: поворот вектора скорости по формуле Родрига вокруг горизонтальной оси `k = (−d.z, 0, d.x)`.

### 1.4 Заряжание / извлечение
- Предмет в руке: если это гравипушка (`gauntletInfo`), берётся `gg.virtual` (подставной typeId), иначе `itemStack.typeId`. Если `ammoKind(typeId)` пусто — клик не перехватывается.
- Обычный клик боеприпасом: `ev.cancel = true`, затем `system.run → loadInto`: `applyLoad(scan, getLoad, typeId, fuze)` (loading.js, 05b); при `res.ok` предмет списывается `consumeHeld` (не в креативе; если предмета уже нет в руке — зарядка отменяется, бесплатно зарядить нельзя), потом `setLoad`+`syncRaise`. Взрыватель берётся `fuzeFromItem(itemStack)` из описания предмета ДО списания.
- Shift+клик: если `canUnload` (`unloadFor(...).ok`), заряд/снаряд выпадает предметом (`spawnItem` у грани клика, `dropSpot` = центр блока + 0.8·нормаль). У снаряда с взрывателем в lore пишется `fuzeLore`. Если вынимать нечего — клик не перехватывается (снаряд ставится как декор).
- `alignParts`: при отчёте выравнивает `facing_direction` всех частей пушки по `scan.direction` (визуально), пропуская `*_hidden`.
- `report` (клик по собранной пушке, afterEvent `playerInteractWithBlock`, только `isFirstEvent`): `healHidden` + `alignParts` + `syncRaise`, затем в actionBar длинная сводка `__t(196)`: камеры/стволы/материал/дульная позиция/направление/заряд/ёмкость/дальность для текущего, 1 и макс. заряда/`barrelFactor`/угол/предупреждение о коротком стволе/миномёты. Дальность — `Math.round(estimateRange(r, charges))` (fire.js).

### 1.5 Выстрел `fireCannon(block, player?)`
Порядок проверок:
1. `S.frozen` → отказ.
2. `findCannon`; нет → отказ.
3. Кулдаун: `LIMITS.fireCooldownTicks` от `lastShot[key]`.
4. Если ствол ещё поднимается (`raiseRemaining(key) > 0`): выстрел откладывается `runTimeout(fireCannon, wait + RAISE_SETTLE_TICKS(6))`; множество `delayedFire` защищает от дубля.
5. `planShot(scan, load)` (fire.js): `plan.overloaded` → `setLoad(empty)`, `createExplosion(breech+0.5, r=2, breaksBlocks:true)`, кулдаун ставится; `!plan.ok` → сообщение.
6. `liveCount() >= LIMITS.maxProjectilesAlive` → отказ.
7. Геометрия: `d = dirVec(direction)`, `th = effElev`, `n` = манхэттен-длина breech→muzzle, `dt = (d.x·cosθ, d.y·cosθ + sinθ, d.z·cosθ)`, точка вылета `origin = p0 + dt·(n + 1.2)` (p0 — центр казённика).
8. Скорость `vel = tiltVec(plan.velocity, direction, th)`; если `scan.mortars>0` → `mortarScatter(vel, mortars, th, flightParams(munitionId), isVertical)`.
9. `spawnProjectile(dim, origin, vel, plan.munitionId, load.fuze ?? 0)`. Исключение → заряд остаётся в пушке, игрок получает `__t(161)` (сборка 40).
10. После успешного спавна: `lastShot`, `setLoad(empty)`, звук `cbc.fire_big_cannon` (volume 4), `muzzleBlast(dim, at(n+0.6), dt, charges)`, `shake(dim, at(n), charges)`, `fireRecoil(...)` (с колбэком `syncRaise` на казённике).

Источники выстрела: (а) огниво по блоку пушки (beforeEvent, поджог отменяется); (б) рычаг рядом (`leverAction`, `isPowered`, проверяются 6 соседей ЛЮБОГО блока пушки; первый найденный стреляет); (в) компонент `cbc:breech` (`onRedstoneUpdate`, фронт 0→>0, регистрируется `registerBreechComponent(registry)` в startup); (г) опрос красной пыли (§1.6).

### 1.6 Опрос редстоуна (без redstone_consumer)
- Работает **только пока есть заряженные пушки** (`armed.size>0`), иначе таймера нет. `ensurePoll` → `system.runInterval(…, POLL_TICKS=10)`; в нём же `sampleTps()` (perf.js).
- `POLL_RADIUS = 64`: пушка опрашивается, только если в том же измерении рядом есть игрок; иначе `lastPowered` стирается (сигнал за время отсутствия выстрела не даёт).
- Геометрия пушки кэшируется в `partsCache` на `RESCAN_TICKS=20`. `blockPowered(dim,pos)`: `getRedstonePower()>0` у блока, либо сосед `redstone_wire` с `redstone_signal>0`, либо сосед `redstone_block`.
- Выстрел по фронту `prev === false && powered`. Первое наблюдение (`prev === undefined`) не стреляет.
- `REDSTONE_TEST=false` (если true, опрос выключен и работает только компонент).
- Админ: `setCannonsFrozen(on)` (сохраняет `S.frozen`, гасит/поднимает опрос), `armedCount()`, `dischargeAll()` (стирает ВСЕ `cbc:load:*`).
- Экспорт для физических конструкций (v1.9.5+): `getLoadAt/setLoadAt/getElevAt/setElevAt/clearLoadAt`.

## 2. cbc/recoil.js — откат и визуальный наклон (сталь, чугун)

Идея: пока пушка заряжена и угол ≠ 0 (или идёт откат), блоки частей заменяются **невидимыми двойниками** `<typeId>_hidden` (состояние `cbc:f` = индекс в `FACINGS=[down,up,north,south,west,east]`), а на их месте стоят сущности-части, повёрнутые на угол вокруг центра казённика.

- Части: `RECOIL_PARTS` = steel_cannon_barrel/chamber, steel_mortar_barrel, cast_iron_cannon_barrel/chamber (нумерация `i` от казённика, сам казённик `i=0` не заменяется).
- Откат только у `steel` (`RECOIL_MATERIALS`); наклон у `steel` и `cast_iron` (`ELEV_MATERIALS`), только горизонтальные (`canElevate`).
- Сущности: `cbc:<pre>_<b|c><k>`; `pre` = `kp` (откат), `km` (миномёт с откатом), `tm` (миномёт без), `ci` (чугун), `tp` (сталь без отката); `b`=ствол, `c`=камера; `k` — индекс запечённого шага угла. Угол запечён в геометрию: `TILT_MIN=−10°`, `TILT_STEP=2.5°`, `TILT_N=29` (k=0..28 = −10..60°); `k=29/30` — вертикальные up/down; `k=31..40` = 62.5..85° (мортирный затвор, сборка 82). Для варианта с откатом k округляется до чётных. Должно совпадать с `tools/gen_recoil.py`/`gen_recoil_tilt.py` (знак `SIGN` там).
- `RECOIL_TICKS=24` (=1.2 с, как `RECOIL_SEC` в генераторе). Подъём `RAISE_TICKS=24`, подстройка `ADJUST_TICKS=12`, опускание `LOWER_TICKS=30`; минимум `0.8` тика/° на подъём и `1.0` тика/° на опускание.
- Сущность создаётся через `runCommand("summon <type> x y z yaw 0")`, затем ищется `getEntities({type, location, maxDistance:0.4})` (дубли удаляются). `YAW` south 0 / west 90 / north 180 / east −90.
- `animate(st,to,ticks,done)`: ease in-out `k²(3−2k)`; заранее считает, на каких тиках меняется шаг `k`, и ставит цепочку `runTimeout` только на эти моменты (не на каждый тик). Смена шага = `respawnPart` (новая сущность создаётся, потом удаляется старая).
- Страховки от «застрявших» скрытых блоков: список спрятанных блоков лежит в dynamic property `cbc:recoil_hidden`; `restoreRecoil()` при загрузке мира возвращает блоки и удаляет все сущности семейства `cbc_recoil_part` в overworld/nether/the_end; невозвращённые (чанк не загружен) → очередь `pending`, повтор раз в 60 тиков (`dim.isChunkLoaded`). `sweep(dim,center,radius)` убирает осиротевшие сущности, кроме отслеживаемых. `healHidden` лечит `_hidden`-блоки вне режима наводки.
- `clampElevation(dim, scan, want, step)` → наибольший свободный угол шагами `step` от 0. `tiltClear` проверяет 8 углов + середину каждой части (полуширина камеры 0.49, ствола 0.37); любой не-воздух, не-жидкость и не из `PASSABLE` (трава, лоза, снежный слой…) блок мешает; клетки самой пушки игнорируются; незагруженный чанк не блокирует.
- `fireRecoil(dim,scan,key,theta,after)`: чугун — отката нет, поднятый ствол плавно опускается; сталь — пересоздаёт сущности в режиме отката, `busy=true`, через 24 тика опускает до 0 (`animate(..., finish)`), затем `releaseNow` (сущности убираются, блоки возвращаются) и `after()`.
- `raiseRemaining(key)` = тиков до конца подъёма (0 при `busy`) — нужен `fireCannon` для задержки выстрела.

## 3. cbc/effects.js — частицы, тряска, облако яда
- Все частицы через `dim.spawnParticle(id, pos, MolangVariableMap)`; переменные `variable.dx/dy/dz/size/power`. Ошибки глотаются. Всё гейтится `S.particles` (`poisonCloud` — нет, зависит от `POISON_CLOUD.enabled` и `degrade()`).
- `degrade()` (perf.js): 0 норма, 1 нагрузка, 2 критично. `muzzleBlast`: считает выстрелы за последние 60 тиков (`recentBlasts`); уровень = `max(degrade(), n>=4 ? 2 : n>=2 ? 1 : 0)`: 0 всё, 1 без искр, 2 только дым; при `n>=3` мощность дыма 1. `light`=автопушка (`cbc:autocannon_smoke`, `flash` размер 1), `quiet`=глушитель (только слабый дым).
- `impactEffects(dim,pos,munitionId)`: ветки: `poison_shell` (облако + `cbc:poison_gas`), `smoke_shell` (`gas_cloud`), `ap_autocannon`, `flak_aa_*` (радиус 18), `he_autocannon` (радиус 6), `flak_autocannon` (старый), общий случай (flash/explosion_smoke/spark по `impactPlan`).
- `poisonCloud`: `spawnEntity(POISON_CLOUD.entity)` на +0.3 по Y, затем `projectile.shoot(0, −dropSpeed, 0)`; чанк не подгружается.
- `trail` (раз в тик на снаряд): `S.particles && S.trail`; при degrade 1 — через тик, при 2 — нет. `fuseSpark` — искра у лежащего снаряда с горящим взрывателем.
- `shake`: `camerashake add @s <intensity> <time> positional` всем игрокам в 32 блоках; интенсивность `min(1.5, (0.3+0.25·max(1,power))·(1−d/32))`, ×0.5 при degrade 1, нет при 2.

## 4. cbc/admin.js — /cbc:admin
- Команда `cbc:admin` (CustomCommandRegistry, `permissionLevel` Admin, `cheatsRequired:false`), только от игрока; открывает форму через `system.run`. `show()` повторяет `form.show` до 25 раз с паузой 10 тиков, пока `UserBusy` (чат открыт).
- Главное меню (кнопки): настройки / вкл-выкл пушки (`setCannonsFrozen`) / замер TPS 40 тиков (`measureTps`) / разрядить все (`dischargeAll`, с подтверждением) / удалить снаряды (`clearProjectiles`) / сброс настроек (`resetSettings`) / переключатель «фугасы известны» (`setFugasKnown`) / закрыть.
- Форма настроек (поля S): `tpsGuard`, `loadBelow` 12–19, `criticalBelow` 4–14 (всегда ≤ `loadBelow−1`), `slowLoad` 10–100 шаг 5, `slowCritical` 5–100 (≤ `slowLoad`), `maxProjectiles` 1–60, `fireCooldown` 5–100, `maxExplosionRadius` 1–8, `particles`, `trail`, `shake`. Сохранение `saveSettings()`.
- Заметка: `LIMITS.maxProjectilesAlive` (world.js) и `S.maxProjectiles` — разные имена; как они связаны, смотри `config/overrides.js`/`settings.js` (05b).

## 5. Подводные камни
- Заряд хранится по координатам КАЗЁННИКА в world dynamic properties: при переносе пушки без `getLoadAt/setLoadAt` заряд теряется/остаётся «мусором».
- Опрос пыли срабатывает на импульс ≥10 тиков и только если игрок ≤64 блоков.
- Смена `TILT_*` или числа шагов требует перегенерации сущностей (`tools/gen_recoil*.py`) и RP-анимаций.
- Скрытые двойники (`*_hidden`) должны возвращаться во всех путях (ломание, взрыв, выгрузка, перезапуск); иначе пушка «пропадает».

*Изменений в прошлых документах эта часть не вносит.*
