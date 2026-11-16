/* CLAUDE-MAP-BEGIN
 FILE: api/physics.js  (0 KB, 13 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: Thin re-export of ../physics.js public API.
 IMPORTS: physics.js
 IMPORTED BY: main.js, main.js, main.js, main.js
 EXPORTS: PhysicsAssembly, PhysicsBody, PhysicsDimension, PhysicsWorld, createDefaultAssemblyBuoyancyPoints, createDefaultAssemblyCollider, handlePhysicsCollisionProxyLoad, physicsWorld, resolveBlockCollisionShape
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// Public physics API used by block modules. Keep engine internals in one place.
export {
  PhysicsAssembly,
  PhysicsBody,
  PhysicsDimension,
  PhysicsWorld,
  createDefaultAssemblyBuoyancyPoints,
  createDefaultAssemblyCollider,
  handlePhysicsCollisionProxyLoad,
  physicsWorld,
  resolveBlockCollisionShape
} from "../physics.js";
