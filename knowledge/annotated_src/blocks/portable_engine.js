/* CLAUDE-MAP-BEGIN
 FILE: blocks/portable_engine.js  (8 KB, 206 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: @minecraft/server, blocks/physics_performance.js
 IMPORTED BY: blocks/index.js
 EXPORTS: PORTABLE_ENGINE_BLOCK_ID, PORTABLE_ENGINE_ENTITY_ID, PORTABLE_ENGINE_BLOCK_SHAFT_ENTITY_ID, PORTABLE_ENGINE_RPM, registerPortableEngineBlock, interactWithPortableEngine, syncPortableEngineEntities, portableEngineFuelFromPermutation
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): syncPortableEngineEntities@157(45L); syncBlockShaft@32(40L); registerPortableEngineBlock@100(39L); interactWithPortableEngine@140(16L); consumeSelectedItem@89(10L); removeBlockShaft@23(8L); setFuelLevel@78(5L); fuelLevel@73(4L); selectedItem@84(4L); blockKey@19(3L); portableEngineFuelFromPermutation@203(3L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { GameMode, world, system } from "@minecraft/server";
import { assemblyVisualEntitiesOfType, physicsSnapshotsOfType, setPhysicsVisualProperty } from "./physics_performance.js";

export const PORTABLE_ENGINE_BLOCK_ID = "create_physics:portable_engine";
export const PORTABLE_ENGINE_ENTITY_ID = "create_physics:portable_engine";
export const PORTABLE_ENGINE_BLOCK_SHAFT_ENTITY_ID = "create_physics:portable_engine_block_shaft";
export const PORTABLE_ENGINE_RPM = 64;

const FUEL_VALUES = new Map([
  ["minecraft:coal", 1],
  ["minecraft:charcoal", 1],
  ["minecraft:coal_block", 8]
]);
let lastPhysicalFuelTick = -1;
const blockShafts = new Map();
const blockBurnTicks = new Map();
const blockNetworkRunning = new Map();

function blockKey(block) {
  return `${block.dimension.id}|${block.location.x},${block.location.y},${block.location.z}`;
}

function removeBlockShaft(block) {
  const key = blockKey(block);
  const entity = blockShafts.get(key);
  try { if (entity?.isValid) entity.remove(); } catch {}
  blockShafts.delete(key);
  blockBurnTicks.delete(key);
  blockNetworkRunning.delete(key);
}

function syncBlockShaft(block, services) {
  const key = blockKey(block);
  const running = fuelLevel(block.permutation) > 0;
  let entity = blockShafts.get(key);
  if (!entity?.isValid) {
    try {
      entity = block.dimension.getEntities({
        type: PORTABLE_ENGINE_BLOCK_SHAFT_ENTITY_ID,
        location: { x: block.location.x + 0.5, y: block.location.y + 0.5, z: block.location.z + 0.5 },
        maxDistance: 0.75,
        closest: 1
      })[0];
    } catch {}
  }
  if (!entity?.isValid) {
    try {
      entity = block.dimension.spawnEntity(PORTABLE_ENGINE_BLOCK_SHAFT_ENTITY_ID, {
        x: block.location.x + 0.5,
        y: block.location.y,
        z: block.location.z + 0.5
      });
    } catch { return; }
  }
  blockShafts.set(key, entity);
  const facing = block.permutation.getState("minecraft:cardinal_direction") ?? "south";
  try {
    entity.teleport({ x: block.location.x + 0.5, y: block.location.y, z: block.location.z + 0.5 }, { rotation: { x: 0, y: 0 } });
    entity.setProperty("create_physics:block_facing", facing);
    entity.setProperty("create_physics:engine_rpm", running ? PORTABLE_ENGINE_RPM : 0);
    // create:rpm belongs to the kinetic solver (including overload stops).
  } catch {}
  const active = block.permutation.getState("create:active_generator") === true;
  if (active !== running) {
    try { block.setPermutation(block.permutation.withState("create:active_generator", running)); } catch {}
  }
  if (blockNetworkRunning.get(key) !== running || services.currentTick() < 20) {
    blockNetworkRunning.set(key, running);
    services.setGeneratorRpm(block, running ? PORTABLE_ENGINE_RPM : 0);
  }
}

function fuelLevel(permutation) {
  try { return Math.max(0, Math.min(8, Number(permutation.getState("create_physics:fuel_level")) || 0)); }
  catch { return 0; }
}

function setFuelLevel(permutation, value) {
  const level = Math.max(0, Math.min(8, Math.floor(value)));
  return permutation.withState("create_physics:fuel_level", level)
    .withState("create_physics:lit", level > 0);
}

function selectedItem(player) {
  try { return player.getComponent("minecraft:inventory")?.container?.getItem(player.selectedSlotIndex); }
  catch { return undefined; }
}

function consumeSelectedItem(player) {
  try {
    if (player.getGameMode() === GameMode.Creative) return;
    const container = player.getComponent("minecraft:inventory")?.container;
    const item = container?.getItem(player.selectedSlotIndex);
    if (!item) return;
    if (item.amount <= 1) container.setItem(player.selectedSlotIndex, undefined);
    else { item.amount--; container.setItem(player.selectedSlotIndex, item); }
  } catch {}
}

export function registerPortableEngineBlock(registry, services) {
  services.registerCreateCompatibility();
  registry.registerCustomComponent("create_physics:portable_engine_interact", {
    onPlayerInteract({ block, player }) {
      if (!block || !player) return;
      const item = selectedItem(player);
      const added = FUEL_VALUES.get(item?.typeId);
      if (!added) {
        services.showStatus(player, fuelLevel(block.permutation));
        return;
      }
      const current = fuelLevel(block.permutation);
      if (current >= 8) return;
      block.setPermutation(setFuelLevel(block.permutation, current + added));
      consumeSelectedItem(player);
      syncBlockShaft(block, services);
      services.showStatus(player, fuelLevel(block.permutation));
      try { block.dimension.playSound("fire.ignite", block.center(), { pitch: 0.8, volume: 0.7 }); } catch {}
    }
  });
  registry.registerCustomComponent("create_physics:portable_engine_tick", {
    onTick({ block }) {
      if (!block) return;
      const current = fuelLevel(block.permutation);
      const key = blockKey(block);
      const now = services.currentTick();
      const previous = blockBurnTicks.get(key) ?? now;
      if (current > 0 && now - previous >= 1600) {
        block.setPermutation(setFuelLevel(block.permutation, current - 1));
        blockBurnTicks.set(key, now);
      } else if (current > 0 && !blockBurnTicks.has(key)) blockBurnTicks.set(key, now);
      else if (current <= 0) blockBurnTicks.delete(key);
      syncBlockShaft(block, services);
    },
    onPlayerBreak({ block }) {
      if (block) removeBlockShaft(block);
    }
  });
}

export function interactWithPortableEngine(player, session, snapshot, services) {
  const item = selectedItem(player);
  const added = FUEL_VALUES.get(item?.typeId);
  let current = Number(snapshot.portableEngineFuel ?? fuelLevel(snapshot.permutation));
  if (added && current < 8) {
    current = Math.min(8, current + added);
    snapshot.portableEngineFuel = current;
    snapshot.permutation = setFuelLevel(snapshot.permutation, current);
    consumeSelectedItem(player);
    session.assembly.body.wakeUp();
    services.persist(session);
    try { player.dimension.playSound("fire.ignite", player.location, { pitch: 0.8, volume: 0.7 }); } catch {}
  }
  services.showStatus(player, current);
  syncPortableEngineEntities([session], services);
}

export function syncPortableEngineEntities(sessions, services, currentTick) {
  const consumeFuel = currentTick !== undefined && currentTick % 1600 === 0 && currentTick !== lastPhysicalFuelTick;
  if (consumeFuel) lastPhysicalFuelTick = currentTick;
  for (const session of sessions) {
    if (!session.assembly?.isValid) continue;
    const engines = physicsSnapshotsOfType(session,PORTABLE_ENGINE_BLOCK_ID);
    if (engines.length === 0) continue;
    let changed = false;
    if (consumeFuel) {
      for (const engine of engines) {
        const fuel = Math.max(0, Number(engine.portableEngineFuel ?? fuelLevel(engine.permutation)) || 0);
        if (fuel <= 0) continue;
        engine.portableEngineFuel = fuel - 1;
        engine.permutation = setFuelLevel(engine.permutation, fuel - 1);
        changed = true;
      }
    }
    const enginesByLocation = new Map(engines.map(engine => [
      `${engine.location.x-session.location.x},${engine.location.y-session.location.y},${engine.location.z-session.location.z}`,engine
    ]));
    for (const entity of assemblyVisualEntitiesOfType(session.assembly,PORTABLE_ENGINE_ENTITY_ID,world,currentTick ?? system.currentTick)) {
      try {
        const anchor = session.assembly.visualAnchor ?? {x:0,y:0,z:0};
        const local = session.assembly.getVisualBlock(entity.id)?.localLocation ?? {
          x: (Number(entity.getProperty("create_physics:local_x")) || 0)+anchor.x,
          y: (Number(entity.getProperty("create_physics:local_y")) || 0)+anchor.y,
          z: (Number(entity.getProperty("create_physics:local_z")) || 0)+anchor.z
        };
        let closest = enginesByLocation.get(`${local.x},${local.y},${local.z}`);
        let distance = Infinity;
        for (const engine of closest ? [] : engines) {
          const dx = engine.location.x - session.location.x - local.x;
          const dy = engine.location.y - session.location.y - local.y;
          const dz = engine.location.z - session.location.z - local.z;
          const score = dx * dx + dy * dy + dz * dz;
          if (score < distance) { distance = score; closest = engine; }
        }
        const running = Number(closest?.portableEngineFuel ?? fuelLevel(closest?.permutation)) > 0;
        setPhysicsVisualProperty(entity,"create_physics:engine_running",running,currentTick ?? system.currentTick);
        setPhysicsVisualProperty(entity,"create_physics:engine_rpm",running ? PORTABLE_ENGINE_RPM : 0,currentTick ?? system.currentTick);
      } catch {}
    }
    if (changed) services.persist(session);
  }
}

export function portableEngineFuelFromPermutation(permutation) {
  return fuelLevel(permutation);
}
