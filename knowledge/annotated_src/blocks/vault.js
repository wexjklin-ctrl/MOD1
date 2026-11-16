/* CLAUDE-MAP-BEGIN
 FILE: blocks/vault.js  (4 KB, 111 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: -
 IMPORTED BY: blocks/mechanical_harvester.js, main.js
 EXPORTS: VAULT_ID, VAULT_ANCHOR_ID, VAULT_MOVING_TAG, VAULT_RESTORED_TAG, physicsVaultSnapshots, vaultAxis, updateVaultConnections, vaultVisualProperties, connectedVaultBlocks, vaultBlockTag
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): updateVaultConnections@23(37L); connectedVaultBlocks@72(35L); vaultVisualProperties@61(9L); physicsVaultSnapshots@8(8L); vaultAxis@16(4L); vaultBlockTag@108(3L); key@6(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
export const VAULT_ID = "create:vault";
export const VAULT_ANCHOR_ID = "create:vault_storage_anchor";
export const VAULT_MOVING_TAG = "create_physics_vault_moving";
export const VAULT_RESTORED_TAG = "create_physics_vault_restored";

const key = p => `${p.x},${p.y},${p.z}`;
const physicalVaultLists=new WeakMap();
export function physicsVaultSnapshots(session) {
  let entry=physicalVaultLists.get(session);
  if(!entry || entry.source!==session.snapshots || entry.count!==session.snapshots.length) {
    entry={source:session.snapshots,count:session.snapshots.length,vaults:session.snapshots.filter(s=>s.typeId===VAULT_ID)};
    physicalVaultLists.set(session,entry);
  }
  return entry.vaults;
}
export function vaultAxis(snapshot) {
  const direction = snapshot.permutation.getState("minecraft:cardinal_direction");
  return direction === "east" || direction === "west" ? "x" : "z";
}

// Partition only when the topology changes, never in the physics tick loop.
// The original vault allows square profiles of 1, 2 or 3, up to 3 * size long.
export function updateVaultConnections(snapshots, positionField = "location") {
  const vaults = snapshots.filter(snapshot => snapshot.typeId === VAULT_ID);
  const remaining = new Map(vaults.map(snapshot => [key(snapshot[positionField]), snapshot]));
  const ordered = [...vaults].sort((a, b) => {
    const p = a[positionField], q = b[positionField];
    return p.x - q.x || p.y - q.y || p.z - q.z;
  });
  for (const size of [3, 2, 1]) {
    for (const seed of ordered) {
      const origin = seed[positionField];
      if (!remaining.has(key(origin))) continue;
      const axis = vaultAxis(seed);
      const slices = [];
      for (let depth = 0; depth < size * 3; depth++) {
        const slice = [];
        for (let h = 0; h < size; h++) for (let v = 0; v < size; v++) {
          const p = {x: origin.x + (axis === "x" ? depth : h), y: origin.y + v, z: origin.z + (axis === "z" ? depth : h)};
          const entry = remaining.get(key(p));
          if (entry && vaultAxis(entry) === axis) slice.push({entry, h, v});
        }
        if (slice.length !== size * size) break;
        slices.push(slice);
      }
      if (!slices.length) continue;
      for (let depth = 0; depth < slices.length; depth++) {
        const section = slices.length === 1 ? "single" : depth === 0 ? "start" : depth === slices.length - 1 ? "end" : "middle";
        for (const {entry, h, v} of slices[depth]) {
          entry.permutation = entry.permutation
            .withState("create:size", size).withState("create:section", section)
            .withState("create:pos_h", axis === "x" ? size - 1 - h : h)
            .withState("create:pos_v", v);
          remaining.delete(key(entry[positionField]));
        }
      }
    }
  }
}

export function vaultVisualProperties(snapshot) {
  const state = name => snapshot.permutation.getState("create:" + name);
  return {
    "create_physics:vault_size": state("size") ?? 1,
    "create_physics:vault_section": state("section") ?? "single",
    "create_physics:vault_h": state("pos_h") ?? 0,
    "create_physics:vault_v": state("pos_v") ?? 0
  };
}

// Include every block of the existing multiblock even if only one was glued.
export function connectedVaultBlocks(snapshot, dimension) {
  const axis = vaultAxis(snapshot);
  const size = Number(snapshot.permutation.getState("create:size")) || 1;
  const h = Number(snapshot.permutation.getState("create:pos_h")) || 0;
  const v = Number(snapshot.permutation.getState("create:pos_v")) || 0;
  const min = {...snapshot.location, y: snapshot.location.y - v};
  if (axis === "z") min.x -= h;
  else min.z -= size - 1 - h;
  const get = p => { try { return dimension.getBlock(p); } catch { return undefined; } };
  const matches = block => block?.typeId === VAULT_ID && vaultAxis(block) === axis && block.permutation.getState("create:size") === size;
  for (let n = 0; n < size * 3 - 1; n++) {
    const current = get(min);
    if (!matches(current) || !["middle", "end"].includes(current.permutation.getState("create:section"))) break;
    const previous = {...min, [axis]: min[axis] - 1};
    if (!matches(get(previous))) break;
    min[axis]--;
  }
  const result = [];
  for (let depth = 0; depth < size * 3; depth++) {
    const base = {...min, [axis]: min[axis] + depth};
    const first = get(base);
    if (!matches(first)) break;
    const section = first.permutation.getState("create:section");
    if (depth > 0 && (section === "start" || section === "single")) break;
    for (let dh = 0; dh < size; dh++) for (let dv = 0; dv < size; dv++) {
      const p = {...base, y: base.y + dv};
      p[axis === "z" ? "x" : "z"] += dh;
      const block = get(p);
      if (!matches(block)) throw new Error("Vault incompleto ou fora dos chunks carregados.");
      result.push(block);
    }
    if (section === "single" || section === "end") break;
  }
  return result;
}

export function vaultBlockTag(position) {
  return `storage_block_${Math.floor(position.x)}_${Math.floor(position.y)}_${Math.floor(position.z)}`;
}
