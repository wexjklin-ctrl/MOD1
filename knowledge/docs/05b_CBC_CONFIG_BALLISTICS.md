# 05b. CBC: конфиг, баллистика, сборка пушки, заряжание, расчёт выстрела

Статус: READ построчно: cbc/main.js, settings.js, ballistics.js, casings.js, loading.js, multiblock.js, fire.js, perf.js, config/overrides.js, config/materials|propellants.generated.js (целиком), munitions.generated.js (только таблица ниже, поля по ключам не все). В игре НЕ проверено. Остальное CBC (twin, world, impact, projectiles, recoil, fuze, admin, effects, cmMount, twin_scan, core/cbcMount, core/cbcLooks) см. следующие документы 05c+ (если их нет, значит ещё не прочитано).
Замечание: числа в overrides.js помечены в комментариях как СОБСТВЕННЫЕ автора («подбирать по ощущениям»), не данные Create Big Cannons.

## 1. Точка входа cbc/main.js
- `system.beforeEvents.startup`: `registerBreechComponent` (казённик, world.js), `registerTwinComponent` (ручки спаренной пушки, twin.js), `registerAdminCommand` (`/cbc:admin`, admin.js); каждая в try/catch.
- `world.afterEvents.worldLoad`: по шагам (каждый в try/catch): `loadSettings`, `restoreRecoil`, `registerInteraction`, `registerFuze`, `restoreTwins`, `registerTwin`, `startFlightLoop`; запасной путь меню админа `scriptevent cbc:admin`.

## 2. Настройки админа (settings.js)
World dynamic property `cbc:admin_settings` (JSON). По умолчанию: tpsGuard=true, loadBelow=18, criticalBelow=10, slowLoad=60 %, slowCritical=25 %, maxProjectiles=LIMITS.maxProjectilesAlive, fireCooldown=LIMITS.fireCooldownTicks, maxExplosionRadius, particles/trail/shake=true, frozen=false, `balanceRev`=71 (если сохранённая ревизия другая, сохранённые maxProjectiles/fireCooldown/maxExplosionRadius игнорируются). `applyToLimits` пишет три значения в `LIMITS`.

## 3. LIMITS и правила (config/overrides.js, значения по умолчанию)
- LIMITS: maxProjectilesAlive 45, maxBlocksBrokenPerExplosion 200, projectileMaxLifetimeTicks 1200, maxExplosionRadius 6, fireCooldownTicks 50.
- CANNON_RULES: чугун — камеры 1..1, стволов ≤15, зарядов/камеру 3, rangePerCharge 0.94, rangeBonus 1.44, elev 0..10°; сталь — камеры 1..6, стволов ≤30, 3 заряда/камеру, rangePerCharge 0.65 (запасное), maxRange 650, elev −10..50°. Миномётный затвор (`steel_mortar_breech`): правила стали, но maxBarrels 6, elevMax 85°. `rulesOf(scan)` учитывает mortarBreech.
- SHORT_BARREL: стволов <2 → +8° разброса. LONG_BARREL: стволов ≥10 → разброс ×0.7. BARREL_SPEED min 0.75 / max 1.08. MORTAR: ≤3 миномётных ствола (только сталь), радиус круга падения {1:200, 2:45, 3:22} блоков, не более 0.8 дальности, конус для вертикальной {1:30°, 2:15°, 3:8°}.
- ALLOWED_AMMO (RESTRICT_AMMO=true): чугун — shot, ap_shot; сталь — smoke_shell, poison_shell, shrapnel_shell, he_shell, ap_shell. SPEED_PER_POWER=1.
- LONG_RANGE (подгрузка чанков по пути снаряда через ticking areas): lookahead 12 тиков, chunkBudget 0.6/тик, maxPendingLoads 4, minSpeedFactor 0.15, maxChunks 8, maxAheadAreas 6, maxHoldTicks 400.
- IMPACT (по снарядам): shot (pierce, budget 8, direct 30, area r4/dmg15), ap_shot (burst, area r15/25, это «картечь»), smoke/poison (burst без урона), shrapnel_shell (area r54/25), he_shell (area r11.25/dmg140, воронка earth/soft 7.125, stone 3.375, metal 1.875, cap 1320, chain 6), powder_charge (блок: area r8/70, cap 300, chain 4), ap_shell (pierce, budget 60, direct 150, entryArea r15/40), автопушка: ap_autocannon (прямой урон 9, пробивает 3 существа), flak_aa_15/20/50 (airburst на 15/20/50 блоков, minHeight 15, area r18/12), he_autocannon (area r6/30). AREA_COVER_FACTOR 0.25; ARMOR_MODEL perPoint 0.03, netheriteBonus 0.02, maxArmorReduction 0.8, perEpf 0.04, epfCap 20. FUZE: max 5 с, ticksPerEarth 20, depthBudget 3. CHAIN: baseDelay 2 тика, 0.5 тика/блок, jitter 2, vanilla 3.5..12 блоков, maxActiveScans 8. CRATER smooth: smoothOpen 4, passes 6.
- AUTOCANNON (speed, блоков/тик): ap 3.5, flak 3.0, he 2.6. AUTOCANNON_MODS: без пружины +4° разброса; дульный тормоз speed×1.12, +0.4°, gravity×0.5; глушитель speed×1.25, gravity×1.4; powerMin/Max 0.85..1.15; AUTOCANNON_HIT_PAD 1 блок. FLYBY: радиус 7.
- POISON_CLOUD: сущность `cbc:poison_cloud_proj`; чанк не подгружается.

## 4. Данные мода (generated)
MATERIALS (maxSafePropellantStress / minimumSpread / spreadReductionPerBarrel): bronze 4 / 0.03 / 1.4; cast_iron 2 / 0.05 / 2.0; steel 8 / 0.025 / 1.4; nethersteel 10 / 0.02 / 1.15; wrought_iron 1 / 0.1 / 1.0; log 0 / 1.5 / 1.0; example 9 / 0.1 / 1.0. PROPELLANTS: powder_charge strength 2, addedSpread 2, addedStress 1, explosionPower 6; big_cartridge strength 2. MUNITIONS (баллистика, ручная правка сборки 71 для автопушки):
| ключ | gravity | drag | quadraticDrag | entityDamage | blockDamagingExplosivePower |
|---|---|---|---|---|---|
| ap_autocannon | 0 | 0.01 | False | 14.0 | - |
| ap_shell | -0.05 | 0.01 | False | 50.0 | 5 |
| ap_shot | -0.05 | 0.01 | False | 50.0 | - |
| bag_of_grapeshot | - | - | - | - | - |
| drop_mortar_shell | -0.05 | 0.01 | False | 20.0 | 2 |
| flak_autocannon | -0.025 | 0.01 | False | 10.0 | 1 |
| flak_burst | -0.025 | 0 | - | 6.0 | - |
| fluid_blob_burst | -0.3 | 0 | - | 0.0 | - |
| fluid_shell | -0.05 | 0.01 | False | 30.0 | 2 |
| grapeshot_burst | -0.025 | 0 | - | 15.0 | - |
| he_shell | -0.05 | 0.01 | False | 30.0 | 8 |
| machine_gun_bullet | -0.025 | 0.01 | False | 8.0 | - |
| mortar_stone | -0.025 | 0.01 | False | 50.0 | - |
| shot | -0.05 | 0.01 | False | 30.0 | - |
| shrapnel_burst | -0.025 | 0 | - | 8.0 | - |
| shrapnel_shell | -0.05 | 0.01 | False | 30.0 | 2 |
| smoke_shell | -0.05 | 0.01 | False | 30.0 | - |
| poison_shell | -0.05 | 0.01 | False | 30.0 | - |
| traffic_cone | -0.05 | 0.01 | False | 100.0 | - |
| flak_aa_15 | 0 | 0.01 | False | 10.0 | 1 |
| flak_aa_20 | 0 | 0.01 | False | 10.0 | 1 |
| flak_aa_50 | 0 | 0.01 | False | 10.0 | 1 |
| he_autocannon | -0.04 | 0.01 | False | 10.0 | 1 |
## 5. Баллистика ballistics.js
`stepFlight(s,p)` за тик: сопротивление (квадратичное: k=min(1, drag·|v|), иначе k=drag), затем `vel *= (1−k)`, `vel.y += gravity`, `pos += vel`. `applySpread(dir, rad)` — равномерный наклон на угол до rad в случайную сторону. `orientation(vel)` — yaw=atan2(−x,z), pitch=atan2(y,|xz|) в градусах.

## 6. Сборка пушки multiblock.js (чистая логика, без Script API)
`parsePart(typeId)`: `cbc:<материал>_<часть>[_hidden]`; части: sliding_breech/screw_breech/quickfiring_breech/mortar_breech → breech; cannon_chamber → chamber; cannon_barrel и mortar_barrel → barrel; cannon_end → end. `scanCannon(breechPos, read, dir)`: от казённика вперёд до 40 блоков: камеры → стволы → опционально end; смешивать материалы нельзя; камера после ствола или блок после end — ошибка; нужен ≥1 ствол; mortars ≤3; минимальная/максимальная камеры и стволы по `rulesFor(weakest)` (слабейший материал по maxSafePropellantStress). Результат `{valid, reason, breechPos, direction, chambers, barrels, mortars, materialId, muzzlePos, mortarBreech}`. `findBreech`/`findCannon` ищут казённик от ЛЮБОГО блока пушки по прямой в 6 сторон; направление определяется геометрией, не `facing` частей.

## 7. Заряжание loading.js
`ammoKind`: `cbc:powder_charge` → заряд; `cbc:{he_shell,ap_shell,ap_shot,solid_shot,shrapnel_shell,smoke_shell,poison_shell}` → снаряд (solid_shot → ключ `shot`). `chargeCapacity = chambers · chargesPerChamber`. `applyLoad`: заряд — пока меньше ёмкости; снаряд — только один, проверка ALLOWED_AMMO; взрыватель `fuze` (секунды, округление) сохраняется только у he_shell. `unloadFor` — Shift+клик достаёт заряд или снаряд обратно. Состояние `load = {charges, projectileId?, fuze?}`.

## 8. Расчёт выстрела fire.js `planShot(scan, load, rnd)`
1. Проверки: scan.valid, projectileId, charges ≥1, есть материал.
2. `charges = min(load.charges, capacity)`; `baseSpeed = 2·SPEED_PER_POWER = 2` блока/тик; `bf = barrelFactor(barrels,maxBarrels)` = max − (max−min)·(1−t)², t=(barrels−1)/(maxBarrels−1); `v1 = baseSpeed·bf`.
3. Дальность растёт линейно с зарядами: целевая `mult = (1 + gain·(charges−1))·rangeBonus` (`gain` = rangePerCharge, а при заданном maxRange (сталь) выводится из условия «полная пушка бьёт ровно на maxRange при 45°»), скорость находится бисекцией по симуляции (`speedForRange`, 40 итераций, кэш).
4. Разброс: `max(minimumSpread, addedSpread·charges − spreadReductionPerBarrel·barrels)` градусов, плюс SHORT_BARREL, ×LONG_BARREL; направление `applySpread`.
5. `mortarScatter(vel, mortars, th, params, vertical)` — разлёт точки падения (круг, не конус): боковой сдвиг поворачивает скорость вокруг Y, продольный меняет |v| (дальность ~ v²), множитель k∈[0.3,1.4]; вертикально — конус.
`estimateRange(scan, charges)` для отчёта; `impactPlan(id)` — радиус эффектов (для частиц): из IMPACT, иначе из данных мода (max(blockPower, entityPower) ≤ maxExplosionRadius).

## 9. Вспомогательное
- casings.js: `ejectCasing` спавнит `cbc:casing`, ≤24 одновременно (40 тиков жизни), только если particles и degrade()<2; импульс может не примениться (помечено TODO-VERIFY автором).
- perf.js: TPS меряется из существующих циклов окном в 20 тиков; режимы 0/1/2 по loadBelow/criticalBelow с гистерезисом 1 TPS; данные устаревают через 200 тиков (тогда норма). `slowFactor()` = доля тиков, на которых снаряд движется (1, slowLoad/100, slowCritical/100), `degrade()` = 0..2.
