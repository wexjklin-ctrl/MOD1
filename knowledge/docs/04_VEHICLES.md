# RZ Lite vehicles

Vehicles are **kinematic**: the physics body exists, but wheels are not physical objects; scripts sample blocks under each wheel, compute support height/tilt, and set body velocity. Full line-by-line description of `applyPhysicsWheelForces`: `04b_WHEEL_GROUND_MODEL.md`.

## rz_drive.js (config READ)
`DRIVE` object (editable at runtime through `rzlite:drive` scriptevent, persisted in world property `rzlite:drive` as `cfg`): ACCEL_K 3 / ACCEL_MAX 18, heat model (HEAT_SECONDS 60, COOL_SECONDS 40, RAD_COOL…), fuel (BUCKET_L 20, TANK_PER_ENGINE 40, TANK_PER_BLOCK 60, IDLE_FUEL 0.06), speed caps (SPEED_CAP 55 m/s, TRK_SPEED_KMH 22, MAX_REVERSE 6, surface caps SOFT 50 / HARD 75 / CONCRETE 85 km/h), STRAIGHT_* (straight-line speed bonus), `REQUIRE_ENGINE=1` (no RZ engine → no motion), tipping (TIP_K, TIP_TICKS 40, LIE_CALM 6), steering variants (`STEER_V2`, `TRACK_TURN_V2`, `INVERT_INPUT` — author toggles for bug-fixes by "step" number; see `_generated/step_journal.md`), `FLIP_FORWARD`.
`STEAM` object: steam tank/engine model. `DT = 1/20`.
Per-vehicle fuel/water/burner state is kept in `store` (Map id → `{f,b,w}`), saved lazily (`dirty`, `lastSave`) to the world property.
Functions: `build` (207 lines: analyze cluster of engine blocks → power, mass, capacity), `stepRzDrive(sessions,tick)` (L405), `topSpeed`, `fuelBurn`, `stepHeat`, `rzHud`, `rzInteract`, `rzCanDrive`, `rzMarkTrackBroken`, `rzTrackTurnScale`.

## rz_susp.js (config + spring READ)
`SUSP`: spring K 110, damping C 15, UP 0.45 (max sink), VMAX 9, wheel visual travel −0.35..0.25 (`suspOffset` quantized to 1/40), AIR_GAP 0.6, flip logic (IMPACT 9 m/s, FLIP_ENTER cos 0.45 ≈63°, FLIP_EXIT 0.78 ≈39°), CALM/SLIDE_DAMP/LATERAL (damps sideways slide), STEP 0.3 (stair height), HULL (nose/belly probes), TIP (center-of-mass pitch, 12°/block, max 22°).
`suspSpring(rest, err, target)`: damped spring `vy += (K*err − C*(vy − vt))*0.05` (0.05 = one tick), clamps, returns `{vy, snap}`; `vt` is support velocity so the spring follows ramps without lag. Other exports: `rzGroundVel`, `rzFlipStep`, `rzLyingStep`, `rzAirTrack`, `rzRideOf/Recalc`, `rzTipBias`, `rzHullProbes`, `installRzSusp` (scriptevent `rzlite:susp`, property `rzlite:susp`).

## Other vehicle modules (INDEXED ONLY)
`track_belt.js` (tracks, `rzlite:track`, `rzlite:track_cfg`), `rz_parts.js` (block → visual entity/rotation; `RZ_SEAT_IDS`), `rz_block_mass.js` (weights/buoyancy, `rzlite:weight`), `rz_block_strength.js`, `rz_air_control.js`/`rz_air_lever.js`/`rz_air_mode.js`/`rz_air_rig.js` + `airplane_*.js` (aircraft), `propeller_bearing*.js`, `balloon_flight.js`, `hot_air_*`, `wheel_*.js`, `car_drive.js`, `tower.js`, `rz_hud.js`, `rz_sound.js` (`rzlite:sound`).

## Admin commands
`/scriptevent rzlite:drive|susp|air|rot|track|weight|sound <cmd> …` (sub-command parsing: `ev.message.trim().split(/\s+/)`), `cbc:admin`, `irons:kit`, `create_physics:tank_state`. Read each file's handler for exact commands.
