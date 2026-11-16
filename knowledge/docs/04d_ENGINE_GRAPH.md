# RZ drivetrain graph — `rz_drive.js` tables and `build(session)` (READ L1-72, L161-367)
Header of the file: port of RZ Physics `core/drivetrain.js, fuel.js, steam.js` (simplified), author notes "NOT tested in game". Rule: **at least one RZ engine block ⇒ "engine mode"** (CM thrust scaled by RZ power/fuel). No engine ⇒ `build` returns `undefined` ⇒ with `DRIVE.REQUIRE_ENGINE=1` the car does not move (`rzCarDrive` returns target 0).

## Block ids
fuel item `phys:fuel_bucket`; `phys:blaze_burner`, `phys:fluid_tank` (steam tank), `phys:steam_engine`, `phys:shaft`, `phys:radiator`, `phys:fuel_tank`; gearboxes `tfmg:steel_gearbox`, `tfmg:engine_gearbox`; propellers `aero:block__smart_propeller__*`, `create_physics:propeller_bearing`, `create_physics:andesite_propeller`; wheel mounts via `isWheelMountId`.
## ENGINES table (power "hp", heat, speed multiplier, scalable cluster params, mass, fuel L/s at full throttle)
| engine | power | heat | speed | scalable | mass | fuel |
|---|---|---|---|---|---|---|
| tfmg:simple_large_engine | 180 | 1.0 | 1.1 | no (only 1 counts) | 2.0 | .025 |
| tfmg:large_engine | 260 | 1.5 | 1.2 | any axis, gain .8 decay .6 max 6 | 2.5 | .040 |
| cdg:diesel_engine | 150 | .9 | 1.1 | line, .85/.8/6 | 1.4 | .018 |
| cdg:modular_diesel_engine | 300 | 1.7 | 1.25 | line, .9/.75/4 | 2.4 | .045 |
| phys:steam_engine | 130 | 0 | 1.0 | linear sum | 1.5 | 0 (steam) |
Cluster multiplier `clusterMult(spec,n)`: k=min(n,max); `1 + gain·(1−decay^(k−1))/(1−decay)` (diminishing returns). Block masses for non-engine parts: shaft .15, radiator .7, fuel tank .8, burner 1.2, steam tank 1.0, gearboxes 1.0/.9; with `RZW.ON` use `rzBlockMass(typeId)` for every block (default 1/block). `mass = max(1, Σ·MASS_SCALE)`.

## Algorithm of `build`
1. Index all snapshots into `cells` (coords relative to origin) and classify: engines, shafts, gears, wheels (mount with `hasWheel`) or `emptyMounts` (mount whose roller was removed — still conducts to the track), props, burners, steam tanks, radiators (`nRad`), fuel tanks (`nTankBlocks`).
2. **Steam boilers**: each burner + a column of 1..3 `fluid_tank` above it; steam engines adjacent horizontally to those tanks (max `ENG_PER_TANK`=3 per tank, sorted by position) are "valid". Invalid steam engines and duplicate non-scalable engines count as `inactive`.
3. **Graph nodes** (kind E engine, G gearbox, S shaft, W wheel, P prop). Shaft axis from `minecraft:block_face`, engine axis from `cardinal_direction`. A steam engine's output cell is `E + 2·facing`: real shaft (axis must match), gearbox, or a created *virtual shaft* if empty; blocked/wrong-axis otherwise.
4. **Links** (6 neighbours): loads (W,P) never link to each other or to engines directly; E–E link only for same scalable non-steam type (any axis, or along the shared axis for "line" engines); shafts conduct only along their axis; gearboxes conduct all ways. Two union-find structures: `net` (power network) and `clu` (engine clusters). Steam engines join the net via their output node.
5. Per cluster: `power = spec.power·mult` (steam: `power·n`), `heat = spec.heat·n`; accumulate per net `{power, heat, speedW(power·speed), fuel, steamPower, wheels:Set, props}`; wheels/props attach to the net of any adjacent conductor.
6. **Tracks**: wheel variants 4-7 are track rollers; plane key = axis letter + coordinate + direction. If power reaches any roller of a plane, all rollers of that plane are driven. A plane that lost a roller (`rzMarkTrackBroken`, or an empty mount in the plane) is **broken** until roller count returns to the peak ⇒ its rollers are removed from driven set ⇒ tank stands.
7. Totals over nets that have power>0 **and** a load: `basePower, heatGen, speedW, fuelRate, steamPower, props`, `drivenWheels`. Result object: `{mode:"engine", mass, nRad, nTankBlocks, boilers, hasSteam, basePower, heatGen, cooling: nRad·RAD_COOL, speedF: speedW/basePower, nEngines, nFuelEngines, inactive, fuelRate, steamPower, clusters[{type,n,mult,power,heat,connected}], wheelsDriven, props, trackMode, wheelMode, brokenTrack}`.
Cache: `analyze` keyed by (snapshots array, count, wheel-with-tire count, `assembly.blocks`) in a WeakMap-like `cache`.

Feeds `stepRzDrive` (see 04c) → `session.rz`. Tuning at runtime: `/scriptevent rzlite:drive set <KEY> <number>` (persisted in `rzlite:drive.cfg`). Unread bits: `axisOf` (L109), fueling/inspection `rzInteract` (L555+), `rzHud`.
