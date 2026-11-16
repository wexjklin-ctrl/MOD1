/* CLAUDE-MAP-BEGIN
 FILE: blocks/airplane_wing_control.js  (3 KB, 79 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: @minecraft/server, blocks/symmetric_sails.js
 IMPORTED BY: main.js
 EXPORTS: registerAirplaneWingControl, updateAirplaneWingSails
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): updateAirplaneWingSails@28(50L); registerAirplaneWingControl@12(15L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { SYMMETRIC_SAIL_IDS, symmetricSailBase } from "./symmetric_sails.js";
const CONTROL = "create_physics:airplane_wing_control";
const SAILS = SYMMETRIC_SAIL_IDS;
const HORIZONTAL = "create_physics:horizontal";
const FRONTS = {
  north: { x: 0, z: 1 },
  east: { x: -1, z: 0 },
  south: { x: 0, z: -1 },
  west: { x: 1, z: 0 }
};

export function registerAirplaneWingControl(registry) {
  let lastTick = -1;
  const visitedByDimension = new Map();
  registry.registerCustomComponent("create_physics:wing_connection", {
    onTick({ block }) {
      if (lastTick !== system.currentTick) {
        lastTick = system.currentTick;
        visitedByDimension.clear();
      }
      let visited = visitedByDimension.get(block.dimension.id);
      if (!visited) visitedByDimension.set(block.dimension.id, visited = new Set());
      updateAirplaneWingSails(block.dimension, block.location, visited);
    }
  });
}

export function updateAirplaneWingSails(dimension, location, visited = new Set()) {
  const key = ({ x, y, z }) => `${x},${y},${z}`;
  const read = (position) => {
    try { return dimension.getBlock(position); } catch { return undefined; }
  };
  const positions = [location, ...Object.values(FRONTS).map(({ x, z }) => ({
    x: location.x + x, y: location.y, z: location.z + z
  }))];
  for (const position of positions) {
    if (visited.has(key(position))) continue;
    const first = read(position);
    if (!SAILS.has(first?.typeId)) continue;
    const sails = [first];
    const directions = new Set();
    visited.add(key(position));
    // Only edge-connected pieces on the wing's horizontal plane belong to it.
    for (let index = 0; index < sails.length; index++) {
      const current = sails[index].location;
      for (const [direction, offset] of Object.entries(FRONTS)) {
        const next = { x: current.x - offset.x, y: current.y, z: current.z - offset.z };
        const neighbor = read(next);
        if (neighbor?.typeId === CONTROL &&
            neighbor.permutation.getState("minecraft:cardinal_direction") === direction) {
          directions.add(direction);
        }
        if (SAILS.has(neighbor?.typeId) && !visited.has(key(next))) {
          visited.add(key(next));
          sails.push(neighbor);
        }
      }
    }
    // Fixed priority keeps a wing stable if more than one control touches it.
    const facing = Object.keys(FRONTS).find(direction => directions.has(direction));
    if (facing === undefined) continue;   // RZ Lite: без блока управления ориентацию не трогаем (её задаёт игрок: присед = горизонтально)
    // A horizontal sail carries that layout through every edge-connected sail.
    // This lets a wall-mounted panel be extended one block at a time.
    const horizontal = facing !== undefined ||
      sails.some(sail => sail.permutation.getState(HORIZONTAL) === true);
    const connectedHorizontal = sails.find(sail => sail.permutation.getState(HORIZONTAL) === true);
    const horizontalFacing = facing ?? connectedHorizontal?.permutation.getState("minecraft:cardinal_direction");
    for (const sail of sails) {
      if (sail.permutation.getState(HORIZONTAL) !== horizontal ||
          (horizontal && horizontalFacing !== undefined && sail.permutation.getState("minecraft:cardinal_direction") !== horizontalFacing)) {
        let permutation = sail.permutation.withState(HORIZONTAL, horizontal);
        if (horizontalFacing !== undefined) permutation = permutation.withState("minecraft:cardinal_direction", horizontalFacing);
        sail.setPermutation(permutation);
      }
    }
  }
}
import { system } from "@minecraft/server";
