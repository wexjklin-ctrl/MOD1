/* CLAUDE-MAP-BEGIN
 FILE: blocks/tank_storage_bridge.js  (1 KB, 38 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: @minecraft/server
 IMPORTED BY: blocks/tank.js
 EXPORTS: sendTankStorage
 EVENTS: scriptEventReceive
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): sendTankStorage@6(8L); isTank@3(1L); positionKey@4(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { system, world } from "@minecraft/server";

const isTank = id => id === "create:fluid_tank" || id === "create:creative_fluid_tank";
const positionKey = p => `${p.x},${p.y},${p.z}`;

export function sendTankStorage(action, dimension, typeId, positions, state) {
  for (let i=0;i<Math.max(1,positions.length);i+=24) {
    const data = {action,dimension:dimension.id,typeId,positions:positions.slice(i,i+24),state};
    const message = JSON.stringify(data);
    if (typeof system.sendScriptEvent === "function") system.sendScriptEvent("create_physics:tank_storage",message);
    else dimension.runCommand(`scriptevent create_physics:tank_storage ${message}`);
  }
}

// Dynamic properties are scoped to each behavior pack. Receive the original
// tank's state explicitly instead of reading another pack's private storage.
system.afterEvents.scriptEventReceive.subscribe(event => {
  if (event.id !== "create_physics:tank_state") return;
  try {
    const data = JSON.parse(event.message);
    if (!isTank(data.typeId) || !Array.isArray(data.positions)) return;
    const dimension = world.getDimension(data.dimension);
    const amount = Math.max(0,Number(data.state?.amount)||0);
    const value = amount>0 && typeof data.state?.fluid === "string"
      ? JSON.stringify({fluid:data.state.fluid,amount}) : undefined;
    for (const p of data.positions) {
      if (![p.x,p.y,p.z].every(Number.isInteger)) continue;
      // A delayed message must not refill an already captured source cell.
      if (dimension.getBlock(p)?.typeId !== data.typeId) continue;
      world.setDynamicProperty(`${data.typeId}:${dimension.id}:${positionKey(p)}`,value);
    }
  } catch { /* A tank's chunk may have unloaded while the message was in flight. */ }
});

system.run(() => {
  sendTankStorage("snapshot",world.getDimension("overworld"),"create:fluid_tank",[]);
});
