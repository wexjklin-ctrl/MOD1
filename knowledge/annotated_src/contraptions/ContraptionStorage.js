/* CLAUDE-MAP-BEGIN
 FILE: contraptions/ContraptionStorage.js  (2 KB, 48 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: @minecraft/server
 IMPORTED BY: contraptions/ContraptionBuilder.js, main.js
 EXPORTS: MAX_CONTRAPTION_BLOCKS, DEFAULT_CONTRAPTION_BLOCKS, normalizeBlockLimit, getContraptionBlockLimit, setContraptionBlockLimit, cachedContraptionStore, persistedContraptionKey, recoverPreparedContraption
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): recoverPreparedContraption@25(23L); cachedContraptionStore@14(4L); persistedContraptionKey@18(4L); normalizeBlockLimit@6(3L); getContraptionBlockLimit@10(1L); setContraptionBlockLimit@11(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { world } from "@minecraft/server";

const LIMIT_KEY = "create_physics:contraption_block_limit";
export const MAX_CONTRAPTION_BLOCKS = 4096;
export const DEFAULT_CONTRAPTION_BLOCKS = 1000;
export function normalizeBlockLimit(value) {
  return Number.isFinite(value) ? Math.max(16, Math.min(MAX_CONTRAPTION_BLOCKS, Math.round(value))) : DEFAULT_CONTRAPTION_BLOCKS;
}
// Fixed construction limit; old slider values must not restrict existing worlds.
export function getContraptionBlockLimit() { return MAX_CONTRAPTION_BLOCKS; }
export function setContraptionBlockLimit(value) { world.setDynamicProperty(LIMIT_KEY, normalizeBlockLimit(value)); }

// Cache the existing generation-based, chunked stores, keeping old world keys.
export function cachedContraptionStore(stores, id, createStore) {
  if (!stores.has(id)) stores.set(id, createStore(id));
  return stores.get(id);
}
export function persistedContraptionKey(data) {
  return typeof data.k === "string" && (data.k.startsWith(`${data.d}|`) || data.k.startsWith(`handrail|${data.d}|`))
    ? data.k : `${data.d}|${data.c.x},${data.c.y},${data.c.z}`;
}

// A prepared save is a rollback journal, never a second moving structure.
// Restore only empty or unchanged source cells; occupied/unloaded cells defer.
export function recoverPreparedContraption(data, snapshots, dimension, services) {
  if (!Array.isArray(data.p) || data.p.length !== snapshots.length) return false;
  const originals = snapshots.map((snapshot, i) => ({ ...snapshot,
    permutation: services.resolvePermutation(snapshot.typeId, data.p[i]) }));
  for (let i = 0; i < originals.length; i++) {
    const snapshot = originals[i];
    const block = dimension.getBlock(snapshot.location);
    if (!block || !services.storageReady(snapshot)) return false;
    if (block.isAir) continue;
    const states = block.permutation.getAllStates();
    if (block.typeId !== snapshot.typeId || !Object.entries(data.p[i])
      .every(([name, value]) => states[name] === value)) return false;
  }
  for (const snapshot of originals) {
    const block = dimension.getBlock(snapshot.location);
    if (block.isAir) block.setPermutation(snapshot.permutation);
  }
  services.restoreFluids(originals);
  for (const snapshot of originals) {
    if (services.restoreInventory(snapshot, dimension.getBlock(snapshot.location)) === false) return false;
  }
  return true;
}
