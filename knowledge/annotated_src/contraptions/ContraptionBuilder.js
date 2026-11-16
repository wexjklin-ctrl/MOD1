/* CLAUDE-MAP-BEGIN
 FILE: contraptions/ContraptionBuilder.js  (2 KB, 54 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: contraptions/ContraptionStorage.js
 IMPORTED BY: main.js
 EXPORTS: validateContraptionSnapshots, validateContraptionSources, restoreContraptionCells
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): restoreContraptionCells@30(24L); validateContraptionSnapshots@4(14L); validateContraptionSources@20(9L); key@3(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { getContraptionBlockLimit } from "./ContraptionStorage.js";

const key = p => `${p.x},${p.y},${p.z}`;
export function validateContraptionSnapshots(snapshots, origin, limit = getContraptionBlockLimit()) {
  if (!snapshots.length || snapshots.length > limit) throw new Error(`Contraption block limit: ${snapshots.length}/${limit}.`);
  const seen = new Set();
  for (const snapshot of snapshots) {
    if (!snapshot.typeId || !snapshot.permutation) throw new Error("Missing block identifier or permutation.");
    if (!["x", "y", "z"].every(axis => Number.isInteger(snapshot.location[axis]) &&
        Number.isFinite(origin[axis]) && Math.abs(snapshot.location[axis] - origin[axis]) <= 384))
      throw new Error("Contraption exceeds the supported local coordinate range (384 blocks).");
    const id = key(snapshot.location);
    if (seen.has(id)) throw new Error(`Duplicate contraption cell: ${id}.`);
    seen.add(id);
  }
  return snapshots;
}

// Validate every source again before the first destructive world write.
export function validateContraptionSources(dimension, snapshots) {
  for (const snapshot of snapshots) {
    const block = dimension.getBlock(snapshot.location);
    if (!block || block.typeId !== snapshot.typeId) throw new Error("Contraption source changed during assembly.");
    const states = block.permutation.getAllStates();
    if (!Object.entries(snapshot.permutation.getAllStates()).every(([name, value]) => states[name] === value))
      throw new Error("Contraption source states changed during assembly.");
  }
}

export function restoreContraptionCells(dimension, snapshots, available) {
  const cells = new Set();
  const targets = snapshots.map(snapshot => {
    const id = key(snapshot.targetLocation);
    if (cells.has(id)) throw new Error("Two contraption blocks would occupy the same destination.");
    cells.add(id);
    if (!available(snapshot)) throw new Error("Contraption restoration space is obstructed or unloaded.");
    const block = dimension.getBlock(snapshot.targetLocation);
    return { block, before: block.permutation, snapshot };
  });
  const written = [];
  try {
    for (const cell of targets) {
      const states = cell.before.getAllStates();
      if (cell.block.typeId === cell.snapshot.typeId && Object.entries(cell.snapshot.permutation.getAllStates())
          .every(([name, value]) => states[name] === value)) continue;
      cell.block.setPermutation(cell.snapshot.permutation);
      written.push(cell);
    }
  } catch (error) {
    for (let i = written.length - 1; i >= 0; i--) written[i].block.setPermutation(written[i].before);
    throw error;
  }
}
