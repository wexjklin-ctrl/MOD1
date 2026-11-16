/* CLAUDE-MAP-BEGIN
 FILE: contraptions/ContraptionInteraction.js  (2 KB, 57 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: contraptions/ContraptionRenderer.js
 IMPORTED BY: main.js
 EXPORTS: INTERACTION_ENTITY, ContraptionInteraction
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { batchTextureIndex } from './ContraptionRenderer.js';


export const INTERACTION_ENTITY = 'create_physics:contraption_interaction';

// Visual batches have no native box per slot. Keep just one small, non-solid
// native target per aiming player; all actions still use the logical block ray.
export class ContraptionInteraction {
  constructor() { this.players = new Map(); this.entities = new Map(); }
  remove(id) {
    const record = this.players.get(id);
    if (!record) return;
    this.entities.delete(record.entity.id);
    try { if (record.entity.isValid) record.entity.remove(); } catch {}
    this.players.delete(id);
  }
  resolve(entity) {
    const record = this.entities.get(entity?.id);
    if (!record?.entity.isValid || !record.target.session.assembly.isValid) return;
    const { session, hit } = record.target;
    return { session, localLocation: hit.block.localLocation,
      worldPoint: session.assembly.body.localPointToWorld(session.assembly.getArticulatedLocalLocation(hit.block.localLocation)) };
  }
  tick(players, raycast) {
    const live = new Set();
    for (const player of players) {
      live.add(player.id);
      try {
        const target = raycast(player);
        const block = target?.hit?.block;
        if (!block || !batchTextureIndex(block)) { this.remove(player.id); continue; }
        const origin = player.getHeadLocation(), direction = player.getViewDirection();
        const length = Math.hypot(direction.x, direction.y, direction.z);
        if (!Number.isFinite(length) || length < 1e-8) { this.remove(player.id); continue; }
        // Place at the real hit surface, not at the batch root or its first slot.
        const distance = Math.max(0, target.hit.distance - 0.025);
        const point = { x: origin.x + direction.x / length * distance,
          y: origin.y + direction.y / length * distance - 0.1,
          z: origin.z + direction.z / length * distance };
        let record = this.players.get(player.id);
        if (record && (!record.entity.isValid || record.entity.dimension.id !== player.dimension.id)) {
          this.remove(player.id); record = undefined;
        }
        if (!record) {
          const entity = player.dimension.spawnEntity(INTERACTION_ENTITY, point);
          record = { entity, target };
          this.players.set(player.id, record); this.entities.set(entity.id, record);
        } else {
          record.entity.teleport(point, { dimension: player.dimension, checkForBlocks: false, keepVelocity: false });
          record.target = target;
        }
      } catch { this.remove(player.id); }
    }
    for (const id of this.players.keys()) if (!live.has(id)) this.remove(id);
  }
}
