/* CLAUDE-MAP-BEGIN
 FILE: contraptions/ContraptionManager.js  (1 KB, 28 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: contraptions/ContraptionMovement.js, contraptions/ContraptionPhysics.js
 IMPORTED BY: main.js
 EXPORTS: ContraptionManager
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { contraptionPose, moveContraption, localToWorld, worldToLocal } from "./ContraptionMovement.js";
import { stopContraption } from "./ContraptionPhysics.js";

// One registry: the controller, handrail, streaming and vehicle code share it.
export class ContraptionManager {
  constructor(sessions, { assemble, disassemble, persist }) {
    this.sessions = sessions; this.assemble = assemble; this.disassemble = disassemble; this.persist = persist;
  }
  mount(controllerBlock) { return this.assemble(controllerBlock); }
  unmount(key) { return this.disassemble(key); }
  get(key) { return this.sessions.get(key); }
  list() { return [...this.sessions.keys()]; }
  pose(key) { return contraptionPose(this.require(key).assembly); }
  localToWorld(key, point) { return localToWorld(this.require(key).assembly, point); }
  worldToLocal(key, point) { return worldToLocal(this.require(key).assembly, point); }
  move(key, location, rotation) {
    const session = this.require(key);
    moveContraption(session.assembly, location, rotation);
    return this.persist(key, session);
  }
  stop(key) { return stopContraption(this.require(key).assembly); }
  require(key) {
    const session = this.get(key);
    if (!session?.assembly?.isValid) throw new Error("Contraption is not loaded.");
    return session;
  }
}
