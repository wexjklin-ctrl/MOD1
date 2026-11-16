# Architecture

## Layers (bottom → top)
1. **cannon-es** (physics.js L5590-12632, vendored `node_modules/cannon-es`): rigid-body engine.
2. **CannonKernelRuntime / CannonKernelBody** (physics.js L14494+): adds world-mesh terrain colliders, fluids/buoyancy, sleeping, collision events, OBB sensors.
3. **PhysicsWorld → PhysicsDimension → PhysicsBody** (physics.js `physics.ts` L19054+): public adapter. `PhysicsWorld.start()` runs `system.runInterval(() => this.step(), 1)`. Events: `afterEvents.collision | step | waterEntry | lavaEntry`.
4. **create_physics base game layer** (main.js, bundle of `src/PhysicsPhysics/*`): contraptions (controller block → assembly), visuals, persistence, glue, ropes/handles, harvesters/drills/saws/deployers, propellers, balloons, settings UI.
5. **RZ Lite layer** (`blocks/rz_*.js`, `track_belt.js`, …) hooked into the step event: drive, suspension, tracks, aircraft control, HUD, sound, weights.
6. **Ports**: `cbc/*` (Create Big Cannons), `irons/*` (Iron's Arms n Artifice), blocks for `sim:`, `tfmg:`, `cdg:` namespaces.

## Two bundles
`main.js` (25k lines) and `physics.js` (19k lines) are **esbuild output** of TypeScript (`src/PhysicsPhysics/...`): look for `// src/...` markers (listed in each annotated header). Private fields are compiled to WeakMaps (`__privateGet(this, _x)`); `world2…world8`, `system2…system7` are renamed duplicate imports of the same `world`/`system`. Hand-written RZ code was appended/patched directly into the bundle (e.g. L24714+ uses plain `system`).

## Tick order (physicsWorld.afterEvents.step, main.js L18563)
fallenPhysics tick → rope towing/constraints → interaction entities sync → ladder climbing → collision entities → **applyPhysicsWheelForces** → balloon lift → propeller thrust → guiding wind → rope constraints → gravity gauntlet → wheel traction → `stepRzDrive` → `stepRzRot` → `stepRzAirControl` → `stepRzAirLever` → steering-wheel drive → parked wheels → wheel attachments → seats → storage entities → every 10 ticks persist ONE session → every 200 ticks prune caches.
Note: this hook runs *after* `runtime.step()` finished all substeps; RZ forces therefore act on the next tick.

## Event subscriptions
See `_generated/events.md`. Main groups: item use / block / entity interaction (assembly, wrench, glue), explosions (`explosion-assembly-physics`), pistons, player spawn/leave, entityLoad (re-attach visuals), `scriptEventReceive` (rzlite:*).

## Dead code (not imported from main.js)
`config.js` (old engine), `core/cbcMount.js`, `core/cbcLooks.js`, `blocks/wheel_marks.js`, `contraptions/ContraptionSailRenderer.js`, `cbc/types.js`. `core/cbcMount.js` imports files that do not exist (`lib/*`, `core/parking.js`…): confirms it is leftovers from another project layout.
