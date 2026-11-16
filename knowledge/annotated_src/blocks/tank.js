/* CLAUDE-MAP-BEGIN
 FILE: blocks/tank.js  (9 KB, 183 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: blocks/tank_storage_bridge.js
 IMPORTED BY: main.js
 EXPORTS: isPhysicsTank, updateTankConnections, tankVisualProperties, tankFluidVisualType, captureTankFluids, clearCapturedTankFluids, restoreTankFluids, connectedTankBlocks
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): updateTankConnections@5(49L); restoreTankFluids@126(29L); clearCapturedTankFluids@99(27L); connectedTankBlocks@156(27L); captureTankFluids@76(23L); tankVisualProperties@54(15L); tankFluidVisualType@69(4L); isPhysicsTank@3(1L); key@4(1L); storageKey@73(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { sendTankStorage } from "./tank_storage_bridge.js";
// Connected tank visuals use the same square profiles and height limit as Create.
export const isPhysicsTank = id => id === "create:fluid_tank" || id === "create:creative_fluid_tank";
const key = p => `${p.x},${p.y},${p.z}`;
export function updateTankConnections(snapshots, positionField = "location") {
  for (const typeId of ["create:fluid_tank", "create:creative_fluid_tank"]) {
    const tanks = snapshots.filter(s => s.typeId === typeId);
    const remaining = new Map(tanks.map(s => [key(s[positionField]),s]));
    const ordered = [...tanks].sort((a,b) => {
      const p=a[positionField], q=b[positionField];
      return p.y-q.y || p.x-q.x || p.z-q.z;
    });
    const layer = (x,y,z,width) => {
      const cells=[];
      for(let dx=0;dx<width;dx++) for(let dz=0;dz<width;dz++) {
        const s=remaining.get(key({x:x+dx,y,z:z+dz}));
        if(!s) return undefined;
        cells.push({s,dx,dz});
      }
      return cells;
    };
    for(const seed of ordered) {
      const p=seed[positionField];
      if(!remaining.has(key(p))) continue;
      let best;
      for(let width=3;width>=1;width--) for(let ox=0;ox<width;ox++) for(let oz=0;oz<width;oz++) {
        const x=p.x-ox,z=p.z-oz;
        if(!layer(x,p.y,z,width)) continue;
        let bottom=p.y,top=p.y;
        while(top-bottom+1<32 && layer(x,bottom-1,z,width)) bottom--;
        while(top-bottom+1<32 && layer(x,top+1,z,width)) top++;
        const volume=width*width*(top-bottom+1);
        if(!best || volume>best.volume || volume===best.volume && width>best.width)
          best={x,z,bottom,top,width,volume};
      }
      if(!best) continue;
      const members=[];
      for(let y=best.bottom;y<=best.top;y++) members.push(...layer(best.x,y,best.z,best.width).map(c=>({...c,y})));
      const fluid=members.find(c=>c.s.tankFluid?.fluid && c.s.tankFluid.amount>0)?.s.tankFluid.fluid;
      const amount=Math.min(best.volume*6000,members.reduce((sum,c)=>sum+(c.s.tankFluid?.fluid===fluid?Math.max(0,Number(c.s.tankFluid?.amount)||0):0),0));
      const level=(best.top-best.bottom+1-0.125)*amount/(best.volume*6000)+0.0625;
      for(const {s,dx,dz,y} of members) {
        s.tankFluid={fluid,amount:amount/best.volume};
        s.tankFluidBottom=y===best.bottom?0.0625:0;
        s.tankFluidLevel=fluid?Math.max(0,Math.min(1,level-(y-best.bottom))-s.tankFluidBottom):0;
        const height=best.bottom===best.top?"single":y===best.bottom?"bottom":y===best.top?"top":"middle";
        s.permutation=s.permutation.withState("create:size",best.width).withState("create:height",height)
          .withState("create:pos_x",dx).withState("create:pos_z",dz);
        remaining.delete(key(s[positionField]));
      }
    }
  }
}
export function tankVisualProperties(snapshot) {
  const state=n=>snapshot.permutation.getState("create:"+n);
  return {
    "create_physics:tank_size":state("size")??1,
    "create_physics:tank_height":state("height")??"single",
    // Match the entity model's corner orientation to the assembly grid.
    "create_physics:tank_pos_x":(state("size")??1)-1-(state("pos_x")??0),
    "create_physics:tank_pos_z":(state("size")??1)-1-(state("pos_z")??0),
    "create_physics:tank_off":state("off")??false,
    "create_physics:tank_creative":snapshot.typeId==="create:creative_fluid_tank",
    "create_physics:tank_fluid_height":snapshot.tankFluidLevel??0,
    "create_physics:tank_fluid_bottom":snapshot.tankFluidBottom??0,
    "create_physics:tank_fluid_type":tankFluidVisualType(snapshot.tankFluid?.fluid)
  };
}
export function tankFluidVisualType(fluid) {
  const id=String(fluid??"").toLowerCase();
  return ["lava","honey","chocolate","milk"].find(type=>id.includes(type))??"water";
}
const storageKey=(snapshot,dimension,positionField="location")=>`${snapshot.typeId}:${dimension.id}:${key(snapshot[positionField])}`;
// The original tank repeats the whole multiblock amount in every cell's key.
// Store one proportional share per moving cell, so splitting never duplicates it.
export function captureTankFluids(snapshots,dimension,world) {
  const visited=new Set();
  for(const snapshot of snapshots) {
    if(!isPhysicsTank(snapshot.typeId) || snapshot.tankFluid || visited.has(key(snapshot.location))) continue;
    let block;
    try {block=dimension.getBlock(snapshot.location);}catch{}
    if(block?.typeId!==snapshot.typeId) {snapshot.tankFluid={amount:0};continue;}
    const cells=connectedTankBlocks(snapshot,dimension);
    let state={amount:0};
    for(const cell of cells) {
      try {
        const raw=world.getDynamicProperty(storageKey(cell,dimension));
        const candidate=typeof raw==="string"?JSON.parse(raw):undefined;
        if(candidate?.fluid && Number(candidate.amount)>0) {state=candidate;break;}
      }catch{}
    }
    const cellKeys=new Set(cells.map(c=>key(c.location)));
    for(const s of snapshots) if(s.typeId===snapshot.typeId && cellKeys.has(key(s.location)) && !s.tankFluid) {
      s.tankFluid={fluid:state.fluid,amount:Math.min(cells.length*6000,Math.max(0,Number(state.amount)||0))/Math.max(1,cells.length)};
      visited.add(key(s.location));
    }
  }
}
export function clearCapturedTankFluids(snapshots,dimension,world) {
  const tanks=snapshots.filter(s=>isPhysicsTank(s.typeId));
  for(const s of tanks) {
    let block;
    try {block=dimension.getBlock(s.location);}catch{continue;}
    if(block?.typeId===s.typeId) continue;
    world.setDynamicProperty(storageKey(s,dimension),undefined);
  }
  for (const typeId of ["create:fluid_tank","create:creative_fluid_tank"]) {
    const captured = tanks.filter(s => s.typeId === typeId && dimension.getBlock(s.location)?.typeId !== typeId);
    if (captured.length) sendTankStorage("clear",dimension,typeId,captured.map(s=>s.location));
  }
  if(!tanks.length) return;
  // Remove the stationary visual only after its source blocks were captured.
  let visuals=[];
  try {visuals=dimension.getEntities({type:"create:fluid_tank_fluid"});}catch{}
  for(const entity of visuals) {
    try {
      const width=Number(entity.getProperty("create:tank_width"))||1;
      const height=Number(entity.getProperty("create:tank_height"))||1;
      const p=entity.location;
      const covered=tanks.filter(s=>s.location.x+0.5>p.x-width/2 && s.location.x+0.5<p.x+width/2 &&
        s.location.z+0.5>p.z-width/2 && s.location.z+0.5<p.z+width/2 && s.location.y>=p.y-height && s.location.y<p.y);
      if(covered.length && covered.every(s=>dimension.getBlock(s.location)?.typeId!==s.typeId)) entity.remove();
    }catch{}
  }
}
export function restoreTankFluids(snapshots,dimension,world) {
  const tanks=snapshots.filter(s=>isPhysicsTank(s.typeId) && s.tankFluid).map(s=>({...s,location:{...(s.targetLocation??s.location)}}));
  updateTankConnections(tanks);
  const visited=new Set(), map=new Map(tanks.map(s=>[key(s.location),s]));
  for(const s of tanks) {
    if(visited.has(key(s.location))) continue;
    const dimensionView={getBlock:p=>map.get(key(p))};
    const cells=connectedTankBlocks(s,dimensionView);
    const amount=cells.reduce((n,c)=>n+(Number(c.tankFluid?.amount)||0),0);
    const fluid=cells.find(c=>c.tankFluid?.fluid)?.tankFluid.fluid;
    for(const c of cells) {
      visited.add(key(c.location));
      world.setDynamicProperty(storageKey(c,dimension),amount>0&&fluid?JSON.stringify({fluid,amount}):undefined);
    }
    if (cells.length) sendTankStorage("restore",dimension,s.typeId,cells.map(c=>c.location),{fluid,amount});
    if(!fluid || amount<=0 || !cells.length) continue;
    const width=s.permutation.getState("create:size");
    const minX=Math.min(...cells.map(c=>c.location.x)), minZ=Math.min(...cells.map(c=>c.location.z));
    const minY=Math.min(...cells.map(c=>c.location.y)), maxY=Math.max(...cells.map(c=>c.location.y));
    const position={x:minX+width/2,y:maxY+1,z:minZ+width/2};
    const existing=dimension.getEntities({type:"create:fluid_tank_fluid",location:position,maxDistance:0.05});
    const entity=existing[0]??dimension.spawnEntity("create:fluid_tank_fluid",position);
    for(const duplicate of existing.slice(1)) duplicate.remove();
    entity.setProperty("create:tank_width",width);
    entity.setProperty("create:tank_height",maxY-minY+1);
    entity.setProperty("create:fluid_height",Math.max(0.01,(maxY-minY+1-0.125)*amount/(cells.length*6000)));
    entity.setProperty("create:fluid_type",tankFluidVisualType(fluid));
  }
}
// Capture only the existing multiblock, rather than unrelated neighboring tanks.
export function connectedTankBlocks(snapshot, dimension) {
  const state=n=>snapshot.permutation.getState("create:"+n);
  const size=state("size")??1;
  const x=snapshot.location.x-(state("pos_x")??0),z=snapshot.location.z-(state("pos_z")??0);
  const get=(dx,y,dz)=>{try{return dimension.getBlock({x:x+dx,y,z:z+dz});}catch{return undefined;}};
  const matches=(b,dx,dz)=>b?.typeId===snapshot.typeId && b.permutation.getState("create:size")===size
    && b.permutation.getState("create:pos_x")===dx && b.permutation.getState("create:pos_z")===dz;
  let bottom=snapshot.location.y;
  for(let n=0;n<31;n++) {
    const b=get(0,bottom,0);
    if(!matches(b,0,0) || !["middle","top"].includes(b.permutation.getState("create:height"))) break;
    if(!matches(get(0,bottom-1,0),0,0)) break;
    bottom--;
  }
  const result=[];
  for(let y=bottom;y<bottom+32;y++) {
    const first=get(0,y,0);
    if(!matches(first,0,0)) break;
    if(y>bottom && ["single","bottom"].includes(first.permutation.getState("create:height"))) break;
    for(let dx=0;dx<size;dx++) for(let dz=0;dz<size;dz++) {
      const b=get(dx,y,dz);
      if(matches(b,dx,dz)) result.push(b);
    }
    if(["single","top"].includes(first.permutation.getState("create:height"))) break;
  }
  return result;
}
