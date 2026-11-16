# 05c. CBC: полёт снарядов (projectiles.js) и попадание (impact.js)

Статус: READ построчно cbc/projectiles.js (547 строк) и cbc/impact.js (667). Числа и правила IMPACT/FUZE/LONG_RANGE — в `05b`. В игре НЕ проверено; автор сам помечает TODO-VERIFY: `Entity.teleport(pos,{facingLocation})`, `spawnEntity` с событием.
Связанные, НЕ прочитанные: effects.js (частицы/следы), fuze.js, world.js, twin.js, recoil.js, core/cbcMount.js (подключает `setStructureHook`).

## 1. Снаряд как объект
`spawnProjectile(dim, pos, vel, munitionId, fuzeSec=0, opts{gravityMult,power,owner})` создаёт сущность `cbc:projectile` с событием-вариантом `cbc:set_<visual|munitionId>` (запасной вариант без события) и запись в массиве `live`: `{entity, dim, origin, power, owner, st:{pos,vel,age}, params:{gravity,drag,quadraticDrag}, munitionId, fuzeTicks (только he_shell, сек·20), keys:Set, hold, waited, tickN, acc, dead}`. Полёт и попадание НЕ зависят от сущности: она лишь телепортируется на новую точку (`moveEntity`, при потере пересоздаётся). Цикл `system.runInterval(…,1)` включается при первом снаряде и сам останавливается, когда `live` пуст.
`startFlightLoop` при загрузке мира: удаляет все сущности `cbc:projectile` в overworld/nether/the_end и `removeAllTickingAreas()`.

## 2. Тик снаряда `advance(p)` (по порядку)
1. Горящий взрыватель → `advanceFuze`.
2. `manageChunks` раз в 2 тика (каждый тик, пока ждёт чанк).
3. Замедление `f = min(slow (если есть удерживаемые чанки), tpsSlow)`; если f<1 — накопитель `acc`: снаряд двигается не каждый тик (время идёт медленнее, баллистика не меняется).
4. `s1 = stepFlight(s0, params)`; возраст > 1200 тиков → исчезает (сообщение в чат при дальности ≥150).
5. Чанк впереди не загружен (`isChunkLoaded`, высота зажата −60..300) → ждёт до `maxHoldTicks`(400) подряд (всего ≤1600), иначе пропадает с сообщением.
6. Особые случаи: попадание в поднятую бронзовую автопушку (`probeTwin`, только снаряды с `cannonRadius`, age ≥4, дальше 5 блоков от старта) → взрыв; зенитный (`airburst`) взрывается на высоте `burstHeight` над точкой выстрела.
7. Путь за тик режется на отрезки (до 40 итераций): `getBlockFromRay` по миру; отдельный луч по ФИЗИЧЕСКИМ КОНСТРУКЦИЯМ `structureRay` (их блоков нет в мире; собственная конструкция стрелка игнорируется первые 25 тиков (`OWN_STRUCT_GRACE_TICKS`), и ещё первые 10 тиков если попадание ближе 4 блоков к дулу); `findEntityHit` — существо на пути (ближе блока). Для пуль автопушки поиск «толстый» (запас 1 блок).
8. Существо: для `pierceEntities` (серый патрон) — урон и летит дальше (до N существ); иначе взрыв в точке попадания.
9. Блок: бронебойный `entryCrater`/`entryArea` один раз у точки входа; `tryPierce` (бюджет пробития); `fuzeTicks>0` → `startFuze`; зенитный ниже `minHeight` просто исчезает; иначе `explode` (точка отступает на 0.25 блока назад по ходу).
10. Если ничего не задето: `trail`, звук пролёта (`flyby` автопушке), `moveEntity`.

## 3. Взрыватель с задержкой (только he_shell)
`startFuze`: бюджет глубины `FUZE.depthBudget·clamp(v/speedRef, 0.5, 1.5)`; снаряд встаёт в точку удара, скорость 0. `advanceFuze` каждый тик: `left--`, по взрыву `blast`; пока есть бюджет и впереди блок с известным классом, ползёт на `1/(ticksPerEarth·cost)` блока за тик (класс → FUZE.cost: soft 0.5, earth 1, stone 2.5, metal 6; воздух/обсидиан/бедрок/конец бюджета → «лежит»; если так и не вошёл в блок, садится на поверхность на 0.3 блока назад); на поверхности раз в 5 тиков искры.

## 4. Дальний выстрел: подгрузка чанков
Каждый снаряд держит ticking areas по одному чанку (`cbc_c<N>`) на пути вперёд (`pathChunks`: выборка каждые 0.5 блока на `lookaheadTicks`=12 тиков, до 2000 точек), только для не загруженных кем-то чанков; не более `maxAheadAreas`=6 на снаряд и `maxChunks`=8 всего (в мире ~10 областей); общий счётчик ссылок `refs`, пройденные чанки отпускаются, ещё грузящиеся помечаются `drop`. Неудача создания — повтор не чаще раза в 10 тиков. `updateThrottle`: спрос = Σ|v_xz|/16 по снарядам над незагруженной землёй; `slow = clamp(budget/demand, minSpeedFactor 0.15..1)`, ×0.5 если ожидающих областей > `maxPendingLoads`(4). Звук/сообщения: `notifyLong` — в чат всем при дальности ≥150 блоков (координаты воронки).

## 5. Попадание impact.js
**Классы блоков** `classify(typeId)`: cbc:* = metal; затем по regex: air, liquid, unbreakable (bedrock, barrier, command_block, portal…), hard (obsidian, beacon, spawner…), `_ore` → stone, metal, earth, soft, иначе stone.
**Броня** `mitigation(pieces, kind)`: очки брони по материалам (leather…netherite), `armorRed = min(0.8, 0.03·очки + 0.02·число незеритовых)`, зачарования: epf = Protection + 2·(Blast|Projectile Protection), `enchRed = min(0.8, 0.04·min(20, epf))`; итог `(1−armorRed)(1−enchRed)`.
**Урон** `hurt(e, raw, kind, kb)`: `applyDamage(dmg, {cause:"override"})` (в обход ванильной брони), если игра срезала >10% — досчитывает напрямую (`setCurrentValue` или `kill`), тотем бессмертия обрабатывается вручную (1 HP, регенерация 900 тиков ур.2, поглощение 100, огнестойкость 800), отбрасывание `applyKnockback` (3 варианта сигнатуры, запасной — `applyImpulse`). Цели `targetable`: есть health, не cbc:*, не предмет/орб, не игрок в творческом/наблюдателе.
**Прямое попадание** `findEntityHit`: `getEntitiesFromRay(ignoreBlockCollision)`; при pad>0 запасной поиск: три точки по высоте (0.15/0.5/0.9 роста) ближе pad к линии полёта, существа ближе 2.5 блока к точке выстрела пропускаются.
**Урон по площади** `areaHit`: сущности в радиусе area.radius+1.5, максимум 80 (ближайшие); `raw = damage·(1 − falloff·min(1,d/radius))`, d от центра тела (+0.9) минус 0.5; если между центром и телом есть блок (кроме листвы/снега/травы/ковров `BLAST_PASS`), урон ×0.25 (`AREA_COVER_FACTOR`); отбрасывание ослабевает с расстоянием.
**Воронка** `breakBlocks(dim, c, radii, cap, drops, hScale)`: центр привязывается к сетке (x,z центр блока, y кратно 0.5); эллипсоид (вертикальный радиус R=max по классам, горизонтальный R·hScale); для каждого блока класс и расстояние, ломается если d ≤ radii[класс]; сглаживание (до 6 проходов: неломаемый блок с ≥4 открытыми из 6 соседей тоже убирается); сортировка по расстоянию, до `cap` блоков; блок сначала сверяется (изменился → пропуск); блоки с инвентарём всегда выпадают; остальные с шансом `drops.chance` до `drops.max`; выполнение порциями через `system.runJob` (по 120 ячеек сканирования и 60 удалений за порцию). Если воронка шире загруженных чанков — на время работы создаётся одна общая ticking area (`cbc_k<N>`), если прямоугольник ≤16 чанков; при нехватке ёмкости — повтор через 10 тиков, затем ломает что может. `removeBlock(drop)`: `setblock … air [] destroy` (с дропом) иначе `setType(air)`.
**Пробитие** `tryPierce(p, block, speed)`: `p.pen = budget·clamp(speed/speedRef, 0.5, 1.5)` при первом блоке; цена по классу; блоки `cbc:he_shell` и `cbc:powder_charge` не пробиваются; пробитые блоки выпадают (`PIERCE_DROPS`).
**`applyImpact(dim, id, at, entity, dir, power)`** по порядку: (1) урон КОНСТРУКЦИЯМ первым и отдельно: `structHook.blast(dim, at, structPower(spec)·power)`, где `structPower`: 0 для снарядов без урона, при `blocks` 1.5+area.damage/40, при `direct` 1+direct/60, иначе 1, потолок 8 (шкала ТНТ=4); (2) прямой урон ×power; (3) area (damage×power); (4) воронка; (5) `hurtCannons` (если задан `cannonRadius`): ищет блоки `cbc:(cast_iron|steel|bronze_vt)_*` в радиусе, ломает до 6 ближайших с шансом 0.9−0.75·d/R, плюс `twinHook` для поднятой автопушки; (6) цепная детонация `chainHook(dim, at, chain)` (fuze.js).
**Хуки** (чтобы избежать циклов импорта): `setTwinHooks`, `setStructureHook` (подключает core/cbcMount.js: `ray` и `blast`), `setChainHook`.

## 6. Для переписывания
Баллистика и попадание не используют физику Cannon: это кинематический трассировщик, шаг = 1 тик. Конструкции участвуют только через два вызова (`ray`, `blast`). Не прочитано, как `blast` ломает блоки конструкции (см. следующий документ, когда прочитаю core/cbcMount.js и rz_block_strength.js).
