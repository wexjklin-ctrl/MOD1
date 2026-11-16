# START HERE — Trackwork_RZ addon map (for a new Claude session)

**What this is.** Bedrock add-on "Trackwork_RZ: Lite Edition 2.5 Alpha" (manifest author: Reichsarzt Wer). Release tag `1` of `wexjklin-ctrl/MOD1`, asset `RZ5t.mcaddon` (sha256 `244ba6c0…becac`, 7.5 MB). It is a Bedrock port of "Create"-style physics contraptions + vehicles ("RZ Lite" layer) + Create Big Cannons (CBC) + Iron's Arms. **Not** the Fabric mod: `HANDOFF.md`/`PROGRESS.md`/`src/` in the repo are a *different* task (Fabric port "RZ Auto"). Do not mix them.

**Packs.** `Trackwork_RZ_BP` (behavior: scripts, blocks 186, entities 582, items 65, recipes 251) and `Trackwork_RZ_RP` (resources). Script API `@minecraft/server` (+ `-ui`), entry `scripts/main.js`.

**Read order**
1. `01_ARCHITECTURE.md` — layers, tick order, data flow.
2. `02_PHYSICS_CORE.md` — cannon-es runtime, constants, how bodies reach the screen.
3. `03_CONTRAPTIONS_SESSIONS.md` — assembly, session object, persistence format, render batching. Then `03b_ASSEMBLY_SPLIT_GLUE.md` — assemble/place/break/split/glue/rot; `03c_ROPES_MACHINES.md` — ropes, drill/harvester/saw/deployer/funnel; `03d_TOWER_TURRET.md` — башня, пульт, пушки на башне; `03e_STORAGE_VAULT_TANK_CHEST.md` — сундуки, vault, баки, мост между паками; `03f_GLUE_UI_HANDRAIL_CARGO.md` — UI клея, фильтр ландшафта, поручень-груз.
4. `04_VEHICLES.md` + `04b_WHEEL_GROUND_MODEL.md` + `04c_DRIVE_STEERING.md` + `04d_ENGINE_GRAPH.md` + `04e_AIRCRAFT_PROPELLERS.md` + `04f_SUSPENSION_TRACKS_HUD.md` — RZ Lite drive/suspension/wheels (kinematic vehicles).
5. `05b_CBC_CONFIG_BALLISTICS.md` + `05c_CBC_PROJECTILES_IMPACT.md` + `05e_CBC_WORLD_RECOIL_EFFECTS_ADMIN.md` + `05f_CBC_TWIN_AUTOCANNON.md` + `05g_CBC_ON_STRUCTURES.md` + `05h_IRONS_ARTIFICE.md` (CBC, Iron's), `05_CBC_AND_IRONS.md`, `06_RESOURCE_PACK.md`, `07_DATA_FORMATS.md` — coverage notes (see honesty table).
6. `08_REWRITE_GUIDE.md` — how to rewrite the core, `09_GOTCHAS.md`, `10_WORKFLOW.md`, `GLOSSARY.md`.
7. `_generated/*.md` — machine-made tables (modules, blocks, events, strings `__t(id)`, recipes, step journal).
8. `annotated_src/` — all 124 scripts with a `CLAUDE-MAP` header; code unchanged (`tools/strip_annotations.py` restores bytes).

**Honesty table (what was actually read vs only indexed)**
| area | status |
|---|---|
| physics.js: cannon-kernel runtime (constructor, configure, step), PhysicsWorld.start | READ |
| main.js: step hook (L18563), controller interaction (L19452), persistence (L21942), wheel/tick wiring | READ |
| contraptions/ContraptionRenderer.js batch encoding | READ (head) |
| blocks/rz_drive.js (DRIVE/STEAM config), rz_susp.js (SUSP, spring) | READ (config + spring) |
| applyPhysicsWheelForces (main.js L1508-1924) | READ → `04b_WHEEL_GROUND_MODEL.md` |
| car_drive.js, wheel_surface.js, stepRzDrive, rzCarDrive, traction | READ → `04c_DRIVE_STEERING.md` |
| rz_drive.js tables + build() drivetrain graph | READ → `04d_ENGINE_GRAPH.md` |
| aircraft RZ (airplane_flight, rz_air_*, rz_flap_pose, rz_block_mass, AirRig), andesite_propeller thrust | READ → `04e_AIRCRAFT_PROPELLERS.md` (airplane_throttle, propeller_bearing, applyGuidingWindSteering — читан в 03d §4, но guidingWindSailGroups/руль Guiding Wind: indexed only) |
| rz_susp.js (flip/lying/air/tip/hull), track_belt.js, rz_hud.js, rzInteract/rzHud | READ → `04f_SUSPENSION_TRACKS_HUD.md` |
| assembly (activatePhysicsBlockBelow), place/remove block, split into pieces, glue, rz_rot.js | READ → `03b_ASSEMBLY_SPLIT_GLUE.md` (createPhysicsControllerAssembly, refreshPhysicsStructureConnections, tower helpers: indexed only) |
| «break planner» / fallen-physics = tree felling, appears to be DEAD CODE (no callers of prepare/executePhysicsBreak/register) | PARTLY READ (planner, executePhysicsBreak, handleCollision, tick) → 03b §7; register/decay/settlement/topology: indexed only |
| rope/rope_hook (rope_simulation.js, tick, towing), drill, harvester, saw, deployer, funnel | READ → `03c_ROPES_MACHINES.md` (vault/tank/chest, handle interaction entities → 03e; handrail: indexed only) |
| CBC: main, settings, config/*, ballistics, multiblock, loading, fire, casings, perf | READ → `05b_CBC_CONFIG_BALLISTICS.md` |
| CBC: projectiles.js, impact.js | READ → `05c_CBC_PROJECTILES_IMPACT.md` |
| CBC: fuze.js, цепная детонация, rzExplodeSessions и хук конструкций (main.js L19105–19286), гниение smoke/finish | READ → `05d_CBC_FUZE_STRUCTURE_DAMAGE.md` |
| CBC: world.js (заряжание/выстрел/редстоун), recoil.js, effects.js, admin.js | READ → `05e_CBC_WORLD_RECOIL_EFFECTS_ADMIN.md` |
| CBC: twin.js, twin_scan.js (бронзовая спаренная автопушка) | READ → `05f_CBC_TWIN_AUTOCANNON.md` |
| cbc/cmMount.js (пушки на конструкциях, РАБОЧИЙ); core/cbcMount.js и core/cbcLooks.js (**мёртвые, битые импорты**) | READ → `05g_CBC_ON_STRUCTURES.md` |
| irons/main.js (Iron's Arms, огнестрел) | READ → `05h_IRONS_ARTIFICE.md` |
| Граф импортов: 118 из 124 файлов достижимы от main.js; недостижимы wheel_marks, cbc/types, config.js, ContraptionSailRenderer, core/cbcLooks, core/cbcMount | STATIC (`tools/reach.py`) → 05g §0 |
| blocks/tower.js (башня-шарнир), propeller_bearing.js, airplane_throttle.js, aircraft_motion.js, интеграция в main.js | READ → `03d_TOWER_TURRET.md` (tower_batch client: indexed only) |
| blocks/vault.js, tank.js, tank_storage_bridge.js, chest.js, double_chest.js; capturePhysicsStorageEntities и соседи (main.js L23456–23750); resolveStoredHandlesEndpoint; createPhysicsHandleInteractionEntities | READ → `03e_STORAGE_VAULT_TANK_CHEST.md` (UI handles_interaction: indexed only) |
| UI клея (handlePhysicsGlueAreaUse и визуалы, main.js L23848–24408), physics_glue.js, glue_filter.js, handrail_cargo.js + фабрика configureHandrailCargo, block_hardness.js | READ → `03f_GLUE_UI_HANDRAIL_CARGO.md` (слайдер handrailEntry: драйвера в сборке нет, см. 03f §4b; фабрика L24787–24923 прочитана целиком) |
| In-game behavior | NOT TESTED |

**Rule for future Claudes:** upgrade a row to READ only after reading it line by line; update this table when you do.
