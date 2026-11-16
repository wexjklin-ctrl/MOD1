# Drive, steering, traction (READ: blocks/car_drive.js whole, blocks/wheel_surface.js whole, rz_drive.js stepRzDrive/topSpeed/fuelBurn/stepHeat/rzCarDrive/rzCanDrive, main.js L1019-1034, L1278, L1374-1387, L1925-1953)

## Per-tick pipeline for a car (all inside physicsWorld `step` hook, see 01)
`applyPhysicsWheelForces` (04b: support, tilt, spring) → `stepRzDrive` (engine state) → … → `applySteeringWheelDrive` (main.js L1278: `rzAssignDrivers`, `rzUpdateAutoSteer`, then `applyCarDrive` from car_drive.js) → … → `applyPhysicsWheelTraction` (L1928).

## Input
`carMovementInput(movement)` (car_drive.js L31): vector from `player.inputInfo.getMovementVector()`; deadzone 0.1 rescaled; sign `k = (INVERT_INPUT===0?1:-1) * (STEER_V2?-1:1)`; returns `{forward:-k*y, turn:-k*x}`. Seat without steering block: `armchairThrottleForAssembly` (rider's movement.y via `normalizeWheelDriveInput`). Throttle seen by wheel code: `wheelThrottleForAssembly` → 0 if `!rzCanDrive`, else `carDriveCommand(frame, driver, steering.wheelDriveSpeed) * (axis.x+axis.z)/3.2`.

## `applyCarDrive(sessions, services)` (car_drive.js L38-175)
Skips: held by gauntlet, streaming, rzAir sessions, flipped/airborne (`session.rzFlipped/rzAirborne` → `wheelAcceleration=0`). Needs a steering block (`rzCarSteering` or `create_physics:steering_contro_wheel` with finite `wheelDriveSpeed`) and `carWheelDriveFrame` (`axis`, `mounts`, `steerable`).
1. **Geometry**: mount points (loc − origin + front offset, y−1); `pivot` = mean of fixed (non-steering) wheels; `steeringCenter`; `wheelbase = max(2, |axleSpan|)`.
2. **Steering angle**: requested = driver.turn·45° (or block's stored angle); limit = min(30°, atan(5·wheelbase/max(1,v²))); eased `previous + clamp((target−previous)·0.08, ±1°)` per tick; `syncSteeringWheelAngle` updates visuals.
3. **Yaw rate** (Ackermann): `turn = clamp(−v·axleSign·tan(angle)/wheelbase·180/π/20, ±2.5)` degrees/tick. With `RZW.ON`: scaled by front axle load fraction `clamp(frontLoad/0.5, .55, 1.2)`, and reduced if lateral acceleration `v²|tan|/wheelbase` exceeds `11·halfTrack/heightCOM·0.9` (rollover guard → understeer).
4. **Tracked vehicles** (≥2 mounts with `wheelVariant ≥ 4` and ≥ half of mounts): spot-turn about the roller centre (or COM if RZW): input ramp `rzTrackTurn` (±0.12/tick, 0.25 gain) · 2.4°/tick · `rzTrackTurnScale` (0.3..1 = accel / TRK_TURN_REF 6); zero if broken track or `!rzCanDrive`. `TRACK_TURN_V2`/`STEER_V2` flip signs.
5. **Apply yaw**: `setRotation(y+turn)`, `teleport` so the pivot point stays fixed, rotate horizontal velocity by the same angle blended by `grip`.
6. **Target speed**: `carDriveCommand(...)` (CM base ±9.775 m/s full throttle), replaced by `rzCarDrive(session,target)`: `frac = target/CM_FULL_SPEED`; forward target `frac·vmax`, reverse `frac·vrev`; `maxAccelTick = max(0.05, accel/20)`; no thrust ⇒ target 0 (coast). `REQUIRE_ENGINE=1` ⇒ no RZ engine ⇒ no motion.
7. **Surface cap** (wheeled only): `surfaceSpeedCap(groundTypeIds)` km/h by block regex: concrete 85, sandstone/other hard 75, soft ground (dirt|grass|sand|gravel|mud|snow|farmland|…) 50; averaged over wheels. Cap × (`STRAIGHT_MIN` 0.7 + 0.3·`rzStraight`); `rzStraight` falls 0.08/tick while steering, rises 0.012/tick straight (≈4 s to full).
8. **No target** → coast: velocity × `wheelCoastFactor` (= 0 under 0.06 m/s, else e^(−2.6·grip/20)) unless roped.
9. **Accelerate**: `desired = clamp((target−speed)·0.18, −0.32.. accelCap)·√grip` (reverse mirrored); `acceleration` smoothed ±0.045/tick toward desired (0.3 gain); no accel while descending faster than `HILL_VY` (1.5 m/s, wheeled); over-cap speed is pulled back ≤0.2/tick. Final `setVelocity(forward·(speed+acc) + sideways·(1−grip))`; yaw angular velocity ×0.25; `wakeUp`.

## Traction (`applyPhysicsWheelTraction`, main.js L1928; wheel_surface.js)
For each car with ground contact or parked pose: axis = plane ground-forward / steering-frame axis / first wheel's `rollingAxis`; `wheelSurfaceVelocity(v, axis, grip)` = project horizontal velocity onto the axis with weight `grip` (`v + (axis·speed − v)·grip`) → kills sideways slide on normal ground, keeps it on ice. Planes without RZ rig use `airplaneGroundRollVelocity`.
Grip per block (`wheelSurfaceGrip`): blue_ice 0.015, packed_ice 0.03, ice/frosted_ice 0.05, else 1; car grip = mean over touching wheels.

## Engine model (`stepRzDrive`, rz_drive.js L405)
Per session each tick: `info = analyze(session)` (cached graph of engines/shafts/gearboxes/wheels/props/tanks/radiators; `build` L161-367 — NOT yet read); `load` = clamp(|throttle|) when driving or moving (>1 m/s) else −1 (engine off).
- Heat: `stepHeat`: need = heatGen·(IDLE_HEAT + (1−IDLE_HEAT)·load); equilibrium vs `cooling` + ambient; rate d/HEAT_SECONDS (60 s) heating, d/COOL_SECONDS (40 s) cooling; `eff = 1 − HEAT_LOSS(0.6)·heat`.
- Steam engines: boiler holds `STEAM.HOLD_S` 4 s after use; burns `r.b` (burn ticks) and water `r.w`; `steamK` ramps 2.5 s up / 1.5 s down.
- Fuel: capacity = fuelEngines·40 + tankBlocks·60 L; burn/s = `fuelRate·FUEL_K·(IDLE_FUEL + (1−IDLE_FUEL)·load)·(1+0.3·mass/10)·(1+1.5·(v/55)²)`; no fuel ⇒ `fuelOk=false` ⇒ no non-steam power.
- `power = (basePower − steamPower)·eff·[fuelOk] + steamPower·steamK`; `vmax = max(1, topSpeed)`: `55·(1−exp(−(power/mass)·speedF/18))`, tracked-only capped 22 km/h (+30 % saturating bonus if also wheels); `vrev = min(vmax, 6·min(1,speedF))`; `accel = clamp(power·3/mass, 0, 18)`; `thrust = power>0.5 && (wheelsDriven>0 || props>0)`.
- Results live in `session.rz` = {info, heat, fuel/cap, water, burn, eff, power, vmax, vrev, accel, thrust, load, steamK, driving}. Persistence of fuel/water/burner: `store` Map → world property `rzlite:drive` (saved ≤ once per 100 ticks).
- Also: engine sound (`rzEngineSound`), HUD to driver every 2 ticks (4 for planes) through `rzHud` (title channel, UI `ui/rz_hud.json`).

## Unread neighbours
`rz_drive.js build/analyze` (L149-367), `car_directions.js` (`carDriveCommand`), `rzAssignDrivers`/`rzUpdateAutoSteer`/`rzCarSteering`/`carWheelDriveFrame`, `rz_susp.js rzFlipStep/rzLyingStep/rzAirTrack/rzTipBias`, track_belt.js.
