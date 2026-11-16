/* CLAUDE-MAP-BEGIN
 FILE: blocks/seat_persistence.js  (3 KB, 62 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: -
 IMPORTED BY: main.js
 EXPORTS: installSeatPersistence
 EVENTS: playerLeave, playerSpawn
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): installSeatPersistence@3(59L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
const PROPERTY="create_physics:physical_seat";

export function installSeatPersistence(world, system, sessions, seats) {
  const leaving=new Set();
  const pending=new Map();
  const remember=(seat,riders)=>{
    if (!seat.assembly?.isValid || !riders.some(r=>r.typeId==="minecraft:player")) return;
    if (sessions.get(seat.persistenceKey)?.assembly!==seat.assembly) {
      seat.persistenceKey=[...sessions].find(([,s])=>s.assembly===seat.assembly)?.[0];
    }
    const session=sessions.get(seat.persistenceKey);
    if (!session) return;
    for (const rider of riders) {
      if (rider.typeId!=="minecraft:player" || !rider.isValid || leaving.has(rider.id)) continue;
      const record=JSON.stringify({key:seat.persistenceKey,dimension:seat.dimension.id,local:seat.localLocation,driving:session.carDriverId===rider.id});
      if (rider.getDynamicProperty(PROPERTY)!==record) rider.setDynamicProperty(PROPERTY,record);
    }
  };
  const forget=player=>{
    if (player?.isValid && !leaving.has(player.id) && !pending.has(player.id)) player.setDynamicProperty(PROPERTY,undefined);
  };
  const queue=player=>{
    leaving.delete(player.id);
    if (typeof player.getDynamicProperty(PROPERTY)==="string") pending.set(player.id,{player,until:system.currentTick+600});
  };
  world.beforeEvents.playerLeave.subscribe(({player})=>{
    leaving.add(player.id);
    pending.delete(player.id);
  });
  world.afterEvents.playerSpawn.subscribe(({player,initialSpawn})=>{
    if (initialSpawn) system.run(()=>queue(player));
    else system.run(()=>{pending.delete(player.id);if(player.isValid) player.setDynamicProperty(PROPERTY,undefined);});
  });
  system.run(()=>{for (const player of world.getAllPlayers()) queue(player);});
  system.runInterval(()=>{
    for (const [id,state] of pending) {
      const player=state.player;
      if (!player.isValid) {pending.delete(id);continue;}
      let record;
      try {record=JSON.parse(player.getDynamicProperty(PROPERTY));} catch {pending.delete(id);continue;}
      if (!record || player.dimension.id!==record.dimension || system.currentTick>state.until) {
        player.setDynamicProperty(PROPERTY,undefined);pending.delete(id);continue;
      }
      const session=sessions.get(record.key);
      if (!session?.assembly?.isValid || session.streamingMotion) continue;
      const seat=[...seats.values()].find(s=>s.assembly===session.assembly && s.entity?.isValid &&
        s.localLocation?.x===record.local?.x && s.localLocation?.y===record.local?.y && s.localLocation?.z===record.local?.z);
      if (!seat) continue;
      const rideable=seat.entity.getComponent("minecraft:rideable");
      const riders=rideable?.getRiders() ?? [];
      if (riders.some(r=>r.id===id)) {pending.delete(id);continue;}
      if (riders.length || !rideable) continue;
      if (rideable.addRider(player)) {
        seat.previousRiders=new Map([[id,player]]);
        if (record.driving) session.carDriverId=id;
        pending.delete(id);
      }
    }
  },10);
  return {remember,forget,isLeaving:id=>leaving.has(id) || pending.has(id)};
}
