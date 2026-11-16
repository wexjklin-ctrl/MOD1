# Physics core

## Constants (physics.js L14495-14514, READ)
- `DEFAULT_FIXED_TIME_STEP = 1/60`, `DEFAULT_TICK_STEPS = 3` → **3 substeps of 1/60 s per game tick = 1/20 s**. (An earlier note said "step 1/20"; the substep is 1/60.) `main.js` never overrides `tickSteps`/`fixedTimeStep` (grep found none), though `PhysicsWorld.start(options)` and `applyPerformanceLevel_fn` can change them — re-check before relying.
- `DEFAULT_GRAVITY = {0,-11,0}`, `DEFAULT_SOLVER_ITERATIONS = 8`, `SABLE_DEFAULT_UNIVERSAL_DRAG = 0.09` (linear & angular damping), `SABLE_BASE_CONTACT_FRICTION = 0.525`. "SABLE" = constants taken from the Sable physics mod (collision tables `SABLE_*` L12637+).
- Broadphase: `SAPBroadphase` with bounding boxes; solver `GSSolver`; sleeping on.

## `CannonKernelRuntime.step()` (L~15611, READ)
1. run *before-substep* callbacks; `syncWorldBlockColliders()` if needed (terrain boxes built from real blocks, cached as "world mesh" chunks with refcounts and high/normal priority queues);
2. for each of `tickSteps` substeps: before-callbacks (index>0) → `applyGravityScaleForces` → `applyBuoyancyForces` → `world.step(1/60,undefined,1)` → after-substep callbacks ("hard positional limits") → indexed world sensors;
3. `body.writeTransform()` for all bodies → `stepCount++` → emit `afterEvents.step`.
Only steps if some body is awake or a before-callback exists.

## Bodies
`CannonKernelBody` wraps a cannon `Body`: mass, inertia tensor, center of mass, `applyForce(At)/Impulse/Torque`, `getVelocityAt`, `localPointToWorld`, `teleport`, `sleep/wakeUp`, `setCollider(Incrementally)` (shapes from contraption blocks), `setBuoyancyPoints`. Collision shapes per block come from `block-collision-shape-resolver` + `bedrock-block-collision.generated`/`sable-collision-reference.generated` tables.

## From body to screen
`writeTransform()` → PhysicsBody → visual entities moved with `teleport()` and rotation properties (`create_physics:pitch/yaw/roll`, see RP animations). Blocks of a contraption are rendered by entities, not by world blocks (world blocks are replaced by air on assembly). See `03_`.

## Terrain collision
Real world blocks near bodies are converted to static boxes (`addWorldColliderBox`, key-based), invalidated by `invalidateWorldMesh(dimension, loc, radius)` on block changes/explosions/pistons. Audit runs every `WORLD_MESH_AUDIT_INTERVAL_TICKS = 20`.

## NOT read line by line
OBB solver (`obb/internal/*`), fluid buoyancy details, performance levels, leaf/log physics. Index in `_generated/modules.md` + bundle map in the annotated header of physics.js.
