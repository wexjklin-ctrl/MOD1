/* CLAUDE-MAP-BEGIN
 FILE: blocks/mechanical_saw.js  (5 KB, 95 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: @minecraft/server, blocks/mechanical_harvester.js
 IMPORTED BY: main.js
 EXPORTS: isSawLog, isSawLeaves, sawTarget, createSawJob, cutSawBlock, tickPhysicsSaws
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): tickPhysicsSaws@62(33L); expandTree@30(17L); cutSawBlock@47(15L); sawTarget@14(13L); isSawLeaves@7(4L); isSawLog@4(3L); createSawJob@27(3L); frontFor@13(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { system } from "@minecraft/server";
import { structureInventories, collectHarvestDrops } from "./mechanical_harvester.js";
const cache=new WeakMap();
export function isSawLog(block) {
  return !!block && /^minecraft:(?:log2?|[a-z_]+_log|(?:crimson|warped)_stem)$/.test(block.typeId);
}
export function isSawLeaves(block) {
  if (!block || !/^minecraft:(?:leaves2?|[a-z_]+_leaves|nether_wart_block|warped_wart_block)$/.test(block.typeId)) return false;
  try {return block.permutation.getState("persistent_bit")!==true;} catch {return true;}
}
// The physical saw's blade occupies model +Z, mirrored into world -Z.
// Keep its existing visible rotation; probe the blade rather than the rear shaft.
const frontFor=direction=>({north:{x:0,y:0,z:1},south:{x:0,y:0,z:-1},east:{x:-1,y:0,z:0},west:{x:1,y:0,z:0}}[direction] ?? {x:0,y:0,z:-1});
export function sawTarget(session,snapshot) {
  const front=frontFor(snapshot.permutation.getState("minecraft:cardinal_direction"));
  const local={x:snapshot.location.x-session.location.x,y:snapshot.location.y-session.location.y,z:snapshot.location.z-session.location.z};
  const seen=new Set();
  for (const distance of [0.7,1,1.4]) for(const [side,height] of [[0,0],[-0.4,0],[0.4,0],[0,-0.4],[0,0.4],[-0.4,-0.4],[-0.4,0.4],[0.4,-0.4],[0.4,0.4]]) {
    const p=session.assembly.body.localPointToWorld(session.assembly.getArticulatedLocalLocation({x:local.x+front.x*distance+front.z*side,y:local.y+height,z:local.z+front.z*distance-front.x*side}));
    const position={x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z)}, key=`${position.x},${position.y},${position.z}`;
    if (seen.has(key)) continue;seen.add(key);
    let block;try {block=session.dimension.getBlock(position);} catch {continue;}
    if (isSawLog(block)) return block;
    // Off-center ground or neighboring blocks must not hide a trunk touching the blade.
  }
}
export function createSawJob(seed) {
  return {origin:{...seed.location},queue:[{location:{...seed.location},distance:0,typeId:seed.typeId}],head:0,seen:new Set([`${seed.location.x},${seed.location.y},${seed.location.z}`]),logs:0,leaves:0};
}
function expandTree(dimension,job,block,distance) {
  const log=isSawLog(block);
  if (!log && distance>=4) return;
  for(let x=-1;x<=1;x++) for(let y=-1;y<=1;y++) for(let z=-1;z<=1;z++) {
    if(!x&&!y&&!z)continue;
    const location={x:block.location.x+x,y:block.location.y+y,z:block.location.z+z};
    if(Math.abs(location.x-job.origin.x)>16 || Math.abs(location.z-job.origin.z)>16 || location.y<job.origin.y-2 || location.y>job.origin.y+64)continue;
    const key=`${location.x},${location.y},${location.z}`;
    if(job.seen.has(key)||job.seen.size>=4096)continue;
    let next;try {next=dimension.getBlock(location);} catch {continue;}
    // Never cross from foliage into another trunk: nearby trees remain separate.
    if ((log && isSawLog(next) && job.logs<256) || (isSawLeaves(next) && job.leaves<768)) {
      job.seen.add(key);
      job.queue.push({location,distance:isSawLog(next)?0:distance+1,typeId:next.typeId});
    }
  }
}
export function cutSawBlock(dimension,job,node,containers) {
  const block=dimension.getBlock(node.location);
  if (!block || block.typeId!==node.typeId) return false;
  const log=isSawLog(block);
  if ((!log&&!isSawLeaves(block)) || (log?job.logs>=256:job.leaves>=768)) return false;
  const center={x:node.location.x+0.5,y:node.location.y+0.5,z:node.location.z+0.5};
  const old=containers.length?new Set(dimension.getEntities({type:"minecraft:item",location:center,maxDistance:1.5}).map(e=>e.id)):undefined;
  // Discover connected branches before removing this trunk block.
  expandTree(dimension,job,block,node.distance);
  const {x,y,z}=node.location;
  if (!dimension.runCommand(`setblock ${x} ${y} ${z} air destroy`).successCount) return false;
  if(log)job.logs++;else job.leaves++;
  if(containers.length)system.run(()=>{try {collectHarvestDrops(dimension,center,old,containers);} catch {}});
  return true;
}
export function tickPhysicsSaws(sessions,storages,ensureVaults,refreshTerrain) {
  let budget=12, probes=48;
  for(const session of sessions.values()) {
    if(!session.assembly?.isValid || session.streamingMotion)continue;
    let state=cache.get(session);
    if(!state) {state={jobs:new Map()};cache.set(session,state);}
    if(state.source!==session.snapshots || state.sourceCount!==session.snapshots.length) {
      state.source=session.snapshots;state.sourceCount=session.snapshots.length;
      state.saws=session.snapshots.filter(s=>s.typeId==="create:mechanical_saw");
      const remaining=new Set(state.saws);
      for(const snapshot of state.jobs.keys())if(!remaining.has(snapshot))state.jobs.delete(snapshot);
    }
    const saws=state.saws;
    if(!saws.length)continue;
    ensureVaults?.(session);
    const containers=structureInventories(session,storages),changed=[];
    const offset=(Math.floor(system.currentTick/4)*12)%saws.length;
    for(let index=0;index<saws.length;index++) {
      const snapshot=saws[(offset+index)%saws.length];
      if(probes<=0 || budget<=0)break;
      probes--;
      let job=state.jobs.get(snapshot);
      if(!job) {const seed=sawTarget(session,snapshot);if(seed){job=createSawJob(seed);state.jobs.set(snapshot,job);}}
      if(!job)continue;
      while(job.head<job.queue.length && budget>0 && probes>0) {
        const node=job.queue[job.head++];probes--;
        try {if(cutSawBlock(session.dimension,job,node,containers)){budget--;changed.push(node.location);}} catch {}
      }
      if(job.head>=job.queue.length)state.jobs.delete(snapshot);
    }
    if(changed.length)refreshTerrain?.(session,changed);
  }
}
