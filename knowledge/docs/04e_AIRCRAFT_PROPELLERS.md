# 04e. Самолёты и пропеллеры (RZ Lite + остатки CM)

Статус: **READ построчно** (адд-он RZ5t, 2.5 Alpha): `blocks/airplane_flight.js`, `rz_air_mode.js`, `rz_air_control.js`, `rz_air_lever.js`, `rz_air_rig.js`, `rz_flap_pose.js`, `rz_block_mass.js`, `vehicle_systems.js`, `airplane_math.js`, `airplane_stop.js`, `airplane_takeoff.js`; `main.js` `applyPhysicsPropellerThrust` (L23256-23404), `rzSeatedPilot` (L1203), клик по рычагу (L19512-19521).
**Только проиндексировано:** `airplane_throttle.js`, `propeller_bearing.js`, `symmetric_sails.js`, `rz_parts.js` (rzBlockRotation), `rz_drive.js` rzAirplane() (см. 04d), `applyGuidingWindSteeringSystem`, колёсная часть самолёта (`airplaneWheelGroundContact`).
**В игре не проверено.**

## 1. Два режима самолёта
`vehicleSystems(session)` (vehicle_systems.js, кэш WeakMap по snapshots/count/assembly.blocks):
- `rzProp` = есть винт `aero:block__smart_propeller__{propeller_reversed|medium|large|huge}`.
- `rzAir = airplane = true`, если `rzProp && sails>0 && !throttle` (`throttle` нигде не выставляется в true; блок газа CM самолётом больше не делает: шаг 138). `sails` = блоки из `SYMMETRIC_SAIL_IDS` (любые, не только горизонтальные).
- `rzProp` ставит `articulated = true`.
- Старый режим CM (блок `create_physics:airplane_throttle` + `airplane_wing_control` + `propeller_bearing`) в `addAirplaneFlight` остаётся как код, но `session.rzAirInfo` непустой => ранний `return` в `rzFlight`. Ветка CM достижима только если `vehicleSystems().rzAir` ложь, а `throttles` из CM-блоков есть; но `airplane` для CM-блока газа не выставляется. Достижимость ветки CM в игре **не проверена**.

## 2. Цепочка вызовов за тик
1. `main.js` L18586: `stepRzAirControl(sessions, rzSeatedPilot, tick)` и L18587 `stepRzAirLever`.
2. `applyGuidingWindSteeringSystem(...)` (L23220) получает `addAirplaneFlight` и зовёт его для articulated-сессий (тело функции не читалось).
3. `addAirplaneFlight(session, transforms)` -> при `session.rzAirInfo` -> `rzFlight(session)` -> `rzAirFly` -> `AirRig.step` -> `body.applyForceAt(CoM)` + `body.applyTorque`.
4. `applyPhysicsPropellerThrust()` (L18576) **не** участвует в самолёте RZ (см. §7).

Пересборка кэша в `addAirplaneFlight` (L24): при смене `session.snapshots`/длины/assembly/`AIRCFG.THRUST_INV` считаются `airplaneGroups`, `propellerGroups`, `airplaneThrottles`, `rzAirInfo` (только если `rzAir`), `airplaneElevators` (число блоков `sim:block__*_symmetric_sail`), сбрасывается `airplaneTakeoff`. Если `rzAirInfo` нет, сбрасываются `rzRig/rzRigTopo/rzRigKey`.

## 3. Управление (rz_air_control.js)
Только для `vehicleSystems(session).rzAir`. Пилот: `rzSeatedPilot` = `rzAutoDriver(session)?.player` (кресло водителя; `rzAutoDriver` не читался).
- `pilot.inputInfo.getMovementVector()` (x>0 = A/влево, y>0 = W), мёртвая зона 0.05.
- `fr = -sx` (крен вправо = D), `fp = -sy` (W = нос вниз => pitch = -1). Флаги `CFG.ROLL_INV/PITCH_INV` меняют знак. Значения без округления идут в `session.rzAirCtl.fr/.fp`; округлённые `roll(-3..3)`, `pitch(-7..7)` пишутся в `ctl.roll/.pitch` (для виртуального газа CM, в RZ-режиме не используются).
- Пробел (`InputButton.Jump`, фронт нажатия) переключает `ctl.on`. Сообщение в actionbar по `session.rzRig.load` (>1.6 «не потянет», >1 «перегруз»).
- `body.wakeUp()` при изменении ввода.
- Нет пилота: `rzAirPilotId = undefined`, `ctl.roll/pitch/fr/fp = 0`, `ctl.on = false` (двигатель гаснет сразу).
- Прыжок отключается как действие: `InputPermissionCategory.Jump=false` для игроков в `jumpLocked`, переустановка раз в 40 тиков; при выходе включается обратно.
- `/scriptevent rzlite:air` `roll_inv|pitch_inv|thrust_inv|prop_inv|force_scale <n|auto>|flap_inv|status`.
- Блок газа CM-ветка (`throttles`) в коде мертва: `const throttles = []` (шаг 147).

## 4. Рычаг тяги (rz_air_lever.js)
Блок `create_physics:throttle_lever` на `rzAir`-конструкции. Клик (main.js L19512, антидребезг 5 тиков) -> `rzLeverInteract`: взять/отпустить; `session.rzLeverGrab = {id, pitch}`. Каждый тик: `lever = clamp(lever - (pitch - grab.pitch)/50, 0, 1)` (камера вверх = больше). Присесть или выйти = отпустить. `ctl.lever` по умолчанию 1. Визуал: `create_physics:throttle_power = lever*128` через `setPhysicsVisualProperty`. Множитель тяги: `rzFlight`: `thr = ctl.on ? (ctl.lever ?? 1) : 0`.

## 5. Разбор конструкции (rz_air_mode.js, rz_air_rig.js rzAirModel)
- `PROP_SPEC` (eff / cap / spd): reversed 1/30/0.80; medium 1.7/80/0.86; large 2.6/160/0.93; huge 4.2/340/1.0. `cap` = масса RZ, которую винт тянет без потерь.
- `AIRCFG`: `THRUST_INV=true` (тяга против `minecraft:facing_direction`), `PROP_INV=false`, `SPIN=36`.
- `rzAirInfo`: тяга = нормированная сумма горизонтальных осей винтов * (−1 при THRUST_INV); вертикальные винты вперёд не тянут; `center` = среднее горизонтальных крыльев (`create_physics:horizontal===true`).
- `rzForward2(thrust)` -> целая ось сетки `[±1,0]` или `[0,±1]`.
- `rzAirModel`: координаты клеток Lite - центры блоков, AirRig ждёт угол клетки, поэтому `-0.5`. Типы:
  - винт -> `props{x,y,z,dx,dy,dz,eff,cap,spd}` (направление = `sg * propAxis`);
  - рули `FELEV` (`sim:block__*_symmetric_sail`) -> пластина `ctrl:true`, нормаль по `minecraft:block_face` (north/south -> Z, east/west -> X, иначе Y), шарнир `h = (0,1,0)`; для горизонтальной `h = поперёк носа`;
  - прочие `SYMMETRIC_SAIL_IDS` -> неподвижная пластина, нормаль: горизонтальная = вверх, вертикальная по `cardinal_direction` (`symmetric_sail_side*` перпендикулярно).
- Список `FELEV` и `RZ_ELEVATORS` обрезан в выводе (строки >400 символов); полный список смотри в исходнике.

## 6. Модель полёта AirRig (rz_air_rig.js, порт RZ v1.9.65-1.9.79)
Тело в виде `b`: `rot[9]` (из localPointToWorld осей), `inertia[6]` (диагональ * Mrz/M), масса = **масса по RZ** `Mrz = rzMassOf(snapshots)` (кэшируется при смене топологии), `vx..wz`, `py`, CoM, `gravityScale=1`. Результат `b.f*, b.t*` умножается на `k = M/Mrz * G_LITE/G_RZ = M/Mrz*11/9.81` (или `RZ_AIR_LITE.SCALE`) и применяется к CoM силой и моментом. Шаг `DT = 1/20` (один тик).

Константы `AIR`: RHO 0.06, CN_SLOPE 5, CN_STALL 0.34, CN_POST 0.7, CD0 0.05, BODY_DRAG 0.0006, THRUST_K 1.3, THRUST_ACC_MAX 20, VMAX_K 1.35, DOWN_K 2, DEFL_MAX 20°, SERVO 8, RATE_PITCH 1.0 / ROLL 1.6 / YAW 0.7, FF 0.7, KP 0.55, YAW_MIX 0.45, INCIDENCE 5°, LEVEL 0.35, ANG_DAMP 0.5, THR_RATE 0.6, MIN_AIRSPEED 0.3, OVERLOAD_MAX 1.8, OVERLOAD_SPD 0.5 (мин 0.5), FADE_FRAC 0.08, MAX_KMH 70, CEILING_Y 0 (авто: `dim.heightRange.max-10`), CEIL_FADE 20, MAX_FORCE_G 4.

`step`:
1. Рычаг: `thr` тянется к `clamp(inp.thr,0,1)` со скоростью `THR_RATE*dt`.
2. `dens = clamp((ceilY - py)/CEIL_FADE, 0, 1)`.
3. Перегрузка: `load = Mrz/max(1,Σcap)`; `tf = 1` при load≤1, иначе линейно до 0 при load=1.8; `sf = clamp(1-0.5*(load-1), 0.5, 1)`; `vcap = MAX_KMH/3.6 * max(spd) * sf` (70 км/ч = 19.4 м/с).
4. Тяга (если `powered && thr>0.001 && props && dens>0`): `a = clamp(acc*1.3, 0, 20)`, `share = Mrz*a*thr*dens*tf/N`; на каждый винт `f = share*eff*k`, где `k = min(clamp(1-va/limP,0,1), clamp((vcapP-va)/(vcapP*0.08),0,1))`, `va` = скорость вдоль оси винта, `limP = max(lim*(1+0.3(eff-1)), vcapP*4)`, `lim = max(1, vlim*1.35)`. Сила в мировую ось винта в его позиции (момент от несимметричной тяги считается сам).
5. Управление (если есть рули): цель угловых скоростей `tPitch = ip*1.0`, `tRoll = ir*1.6` (или `LEVEL*rightY` при ir=0), `tYaw = ir*0.7*0.45`; `auth = clamp(V/8,0,1)`; `pitch = (FF*ip + KP*(tPitch-q))*auth`, при `<0` умножается на DOWN_K; roll/yaw аналогично. Отклонение руля `defl += (tg-defl)*min(1,8*dt)`, `tg = clamp(gp*pitch+gr*roll+gy*yaw)*20°`. Усиления `gp/gr/gy` калибруются по положению руля относительно CoM (`calibrate`, нормировка по максимуму, порог 0.15, ключ по CoM/направлению/числу пластин).
6. Пластины (при `V>0.3`): сила `F = -CN(sinA) q S n` + паразитное `-CD0 q S v/|v|`, `q=0.5*RHO*dens*v²`, `v` в точке пластины = `v + w×r`; CN линейна до `sinA=0.34`, дальше постоянна `5*0.34*0.7`; ограничение `fmax = 4*Mrz*9.81`. Неуправляемым горизонтальным пластинам впереди CoM (`rel > -1.5`) нормаль наклоняется на INCIDENCE=5° носом вверх (`calibrate`). Рули: `n' = n cos d + (h×n) sin d`. Плюс сопротивление корпуса `-0.0006*V*Mrz*v`.
7. Выше `vcap`: торможение `-min(6,(V-vcap)*2.5)*M/V * v`.
8. Демпфирование вращения `-0.5*I*w` (по осям сетки, с недиагональными членами; для Lite недиагональные = 0).

`rzFlight` (airplane_flight.js L160): вход `inp = pilot ? {thr: on?(lever??1):0, pitch: fp, roll: fr} : null`. Привод `drive`: если есть `session.rz.info` -> `{acc: session.rz.accel, vlim: session.rz.vmax, powered: rzAirplane(session).ok}`; иначе при `RZ_DRIVE.REQUIRE_ENGINE` -> нулевой; иначе fallback `acc 8, vmax 30, powered true`. `rzAirplane` и `session.rz.*` описаны в 04d (не перечитывал). Побочные записи: `rzDrivePowered`, `airplaneHandlesPropulsion=true`, `airplaneEnginePower = rig.thr`, `airplaneWingDriveActive`, `airplaneGroundForward`, `rzLiftAcc = fy/M` -> `airplaneLiftAcceleration` (для колёс). Без пилота `inp=null`: тяга уходит в 0 по THR_RATE, руль в ноль.

Визуал рулей (`rz_flap_pose.js`): угол `plate.defl` (рад) -> градусы, `±40°`, квантование 1.5°, поворот кватерниона базовой позы вокруг шарнира `h`; результат `session.rzFlapPoses` (Map "x,y,z" -> {rotation}), `rzFlapVersion` растёт при изменении. Коллайдеры не трогаются. Эйлер порядок YZX.

## 7. Пропеллер Create/CM `andesite_propeller` (applyPhysicsPropellerThrust) - это НЕ самолёт RZ
Только блок `create_physics:andesite_propeller`, сессии с `vehicleSystems().propeller`. На каждый винт за тик: `propellerAngle += max(8,speed)*0.75` (speed 0..32), синк свойств сущности `propeller_speed/enabled/angle`. Работает только если `enabled && speed>0` и (есть колёсное крепление `hasWheel` ИЛИ `session.rz.thrust===true`, шаг 134).
- Направление = `cardinal_direction` в мир. Вызывается `emitPhysicsPropellerWind`.
- С колёсами: направление берётся из средней оси качения колёс (знак подгоняется к направлению винта), `y=0`, заносится в `physicsWheelDriveDirections[assembly.id]`; `targetSpeed = speed/32*7`; `acc = clamp((target - v_fwd)*1.15, 0, 3.2)`; сила через CoM `m*acc`; затем коррекция скорости `+0.22*(target - v_hor_fwd)`, выравнивание крена (`uprightResponse 0.12`), гашение `angularVelocity.x/z`, момент самовыравнивания по `localUp`.
- Без колёс (шар/судно): тяга горизонтальная, `propellerReverse` меняет знак; `targetSpeed = speed/32*(2.78 | 1.67 при reverse)`; `acc = clamp((target - v_fwd)*0.6, 0, 1.05)`; сила `m*acc` через CoM (без момента). Рули курса - `applyGuidingWindHullTurn` (не читался).

## 8. CM-аэродинамика (мёртвая/запасная ветка, airplane_math.js flightForces)
Читал. Кратко: подъём при `poweredWings&&flightMode` = `mass*clamp(11 + (pitch*3 - vy)*2, 0, 17)*airspeedLift/up.y`; без мотора `mass*9.81*clamp(v²/10.24,0,1.4)*wingLoading`; крутящие моменты - ПД к целевому крену (макс 45°) и тангажу (±35°), рыскание от `turnRate = 9.81*tan(bank)/max(v,2)`; тяга `mass*clamp((5.8-v)*1.2,0,4)*enginePower`; `airplaneStoppingForce` = `-v*m*0.12` в воздухе, `-3` на земле. Остальные подмодули CM (`airplane_throttle`, `propeller_bearing`) только проиндексированы.

## 9. Открытые вопросы / для переписывания
- Масштаб `k = M/Mrz*11/9.81`: сила делится на RZ-массу, множится на массу Lite: поведение определяется отношением масс, ручная подстройка `force_scale`.
- Тяга и скорость зависят от `session.rz.accel/vmax` (граф привода 04d); без двигателя при `REQUIRE_ENGINE` самолёт не летит. Значение `REQUIRE_ENGINE` по умолчанию в 04d.
- Колёса самолёта (`airplaneWheelGroundContact`) не разбирал.
- Не проверено: знаки управления, `THRUST_INV`, визуал рычага/винта.
