# Contraptions & sessions

**Block `create_physics:controller`** = the contraption root. Using it (`queueActivePhysicsControllerUse`, main.js L19452) toggles assembly; other special blocks hit by the same raycast (`raycastPhysicsControllerBlock`) are routed first: rope_hook (rope item/shears), RZ engine parts (fuel bucket `phys:fuel_bucket`, `tfmg:`/`cdg:`/`phys:(shaft|radiator|fuel_tank|blaze_burner|fluid_tank|steam_engine)` → `rzInteract`), `portable_engine`, `airplane_throttle`, `propeller_bearing` (just a hint message), `throttle_lever` (RZ air vs normal), steering wheels, then the controller itself. Interactions are debounced per player/assembly with a 5-tick map (`physicsControllerInteractionTicks`).

**Session** (`physicsControllerPhysicsSessions`: Map controllerKey → session). Fields seen in code: `assembly` (physics handle, `.isValid`, `.body`, `.id`, `getArticulatedLocalLocation`), `snapshots[]` (one per block: `typeId`, `permutation`, `location` world coords at assembly time, `storageEntityId`, `hasWheel`, propeller/tank/tower fields…), `location` (origin), `controllerLocation`, `dimension`, `preparedSources`, `streamingMotion` (state while chunks unloaded), `towerRoot`, `detachedComponent`, `rz` (RZ vehicle flag), `rzOccupied`, `handrailEntry`.

**Assembly rule** (from the earlier session's reading of the glue/assembly code; not re-verified here): blocks are glued (physics glue), a controller or tower core is mandatory, blocks are saved to snapshots and the world blocks replaced with air; visuals are entities.

## Persistence (READ: `persistPhysicsControllerSession`, main.js L21942)
Stored through `physicsControllerSessionStore(controllerKey).saveWithResult(data)` — a chunked JSON store in world dynamic properties (`dynamic-property-json-store.ts`, see `physicsControllerSessionPropertyId`). Old single-property saves are removed after a successful chunked save. One session is serialized every 10 ticks (`persistNextPhysicsControllerSession`) to avoid memory spikes ("script-memory watchdog").

JSON schema of one session (`data`):
| key | meaning |
|---|---|
| `k` | controller key |
| `p` | `preparedSources` |
| `a` | angular velocity |
| `b` | array of block tuples (index → meaning): 0-2 offset from origin, 3 typeId, 4 permutation states, 5 storageEntityId, 6 propeller speed (negative = reverse), 7 propellerEnabled, 8 fence connections, 9 hasWheel, 10 wall connections, 11 glued, 12 propellerSteeringControlled, 13 guidingWindAngle, 14 guidingWindHeading, 15 portable engine fuel, 16 wheelDriveSpeed, 17 wheelVariant, 18 wheelSteeringAngle, 19 tankFluid, 20 wheelRide (RZ), 21 rzReverse (RZ seat reversed), 22 towerAngle, 23 towerTarget, 24 towerPitchTarget |
| `c` | controllerLocation, `d` dimension id, `e` detachedComponent |
| `t` | tower root `{p:[x,y,z], a:[axis]…}` |
| `g` | AABB, `l` body location, `o` origin, `r` visual rotation, `s` sleeping, `v` velocity |
**Adding a field = append to `b` and handle in `restoredSnapshot…`/`finishPhysicsBlockRestore`, never reorder** (old saves).
Restore: `restorePersistedPhysicsControllerSessions` (every 20 ticks and at start), `unloadDistantPhysicsControllerSession` (every 100 ticks).

## Rendering batches (READ head of contraptions/ContraptionRenderer.js)
Plain full-cube textured blocks (palette `BATCH_PALETTE`: stone, cobble, bricks, metals, glass, 16 wool + 16 concrete colors, hot-air envelope colors) are packed up to `BATCH_SLOTS = 20` per entity `create_physics:contraption_batch` (and `tower_batch` for tower heads). One slot = one number `type*64³ + x + y*64 + z*64²` (x,y,z < 64 local offsets, `BATCH_EDGE=64`); < 2^24 so it survives float32 Molang. The RP reads those numbers per slot (render controller arrays share indices with `BATCH_PALETTE` — **keep order in sync with the RP**). Anything rotated, animated, with state/attachments, or a non-physics_block visual entity falls back to one entity per block (`batchTextureIndex` returns 0).
