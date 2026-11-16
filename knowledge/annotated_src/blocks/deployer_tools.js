/* CLAUDE-MAP-BEGIN
 FILE: blocks/deployer_tools.js  (4 KB, 57 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: @minecraft/server, blocks/block_hardness.js, blocks/mechanical_harvester.js
 IMPORTED BY: blocks/deployer.js
 EXPORTS: damageDeployerTool, usePhysicsDeployerTool
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): usePhysicsDeployerTool@13(45L); damageDeployerTool@4(9L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { system, BlockPermutation, ItemStack } from "@minecraft/server";
import { getBlockHardness } from "./block_hardness.js";
import { collectHarvestDrops, insertHarvestStack } from "./mechanical_harvester.js";
export function damageDeployerTool(hand,item) {
  const durability=item.getComponent("minecraft:durability");
  if(!durability)return;
  const enchant=item.getComponent("minecraft:enchantable")?.getEnchantment("unbreaking")?.level ?? 0;
  if(Math.random()>=1/(enchant+1))return;
  const updated=item.clone(), d=updated.getComponent("minecraft:durability");
  d.damage=Math.min(d.maxDurability,d.damage+1);
  hand.getComponent("minecraft:inventory").container.setItem(0,d.damage>=d.maxDurability ? undefined : updated);
}
export function usePhysicsDeployerTool(hand,item,block,point,containers) {
  if(!item)return false;
  const kind=item.typeId.match(/_(pickaxe|axe|shovel|hoe|sword)$/)?.[1] ?? (item.typeId==="minecraft:shears"?"shears":undefined);
  const dimension=hand.dimension ?? block?.dimension;
  if(!dimension || !kind)return false;
  if(kind==="sword") {
    const target=dimension.getEntities({location:point,maxDistance:1.1}).find(e=>e.id!==hand.id && e.typeId!=="minecraft:player" && !e.typeId.startsWith("create") && e.typeId!=="minecraft:item" && !!e.getComponent("minecraft:health"));
    if(!target)return false;
    const damage=item.typeId.includes("netherite")?8:item.typeId.includes("diamond")?7:item.typeId.includes("iron")?6:4;
    if(!target.applyDamage(damage,{cause:"entityAttack",damagingEntity:hand}))return false;
    damageDeployerTool(hand,item);return true;
  }
  if(!block || block.isAir || block.isLiquid || block.typeId==="create_physics:lamp_light" || getBlockHardness(block)<0)return false;
  const id=block.typeId, above=(kind==="hoe"||kind==="shovel") ? block.above() : undefined;
  let replacement;
  if(kind==="axe" && /^minecraft:(?:[a-z_]+_(?:log|wood)|(?:crimson|warped)_(?:stem|hyphae))$/.test(id) && !id.includes("stripped_")) replacement=id.replace("minecraft:","minecraft:stripped_");
  if(kind==="hoe" && above?.isAir) {
    if(id==="minecraft:coarse_dirt")replacement="minecraft:dirt";
    else if(["minecraft:dirt","minecraft:grass_block","minecraft:dirt_path","minecraft:grass_path","minecraft:podzol","minecraft:mycelium"].includes(id))replacement="minecraft:farmland";
  }
  if(kind==="shovel" && above?.isAir && ["minecraft:dirt","minecraft:grass_block","minecraft:coarse_dirt","minecraft:podzol","minecraft:mycelium"].includes(id))replacement="minecraft:grass_path";
  if(replacement) {
    let permutation;
    try {permutation=BlockPermutation.resolve(replacement,kind==="axe"?block.permutation.getAllStates():{});}catch{try{permutation=BlockPermutation.resolve(replacement);}catch{return false;}}
    block.setPermutation(permutation);damageDeployerTool(hand,item);return true;
  }
  const effective=kind==="pickaxe" ? /stone|ore|deepslate|andesite|diorite|granite|tuff|basalt|cobble|brick|copper|iron|gold|diamond|emerald|lapis|redstone|coal|quartz|obsidian/.test(id) :
    kind==="axe" ? /log|wood|planks|stem|hyphae|bamboo|fence|chest|barrel/.test(id) :
    kind==="shovel" ? /dirt|sand|gravel|clay|snow|mud/.test(id) :
    kind==="hoe" ? /leaves|wart_block|hay_block|moss/.test(id) : /leaves|wool|web|vine/.test(id);
  if(!effective)return false;
  const center={x:block.location.x+0.5,y:block.location.y+0.5,z:block.location.z+0.5};
  const old=containers.length?new Set(dimension.getEntities({type:"minecraft:item",location:center,maxDistance:1.5}).map(e=>e.id)):undefined;
  const shearedLeaves=kind==="shears"&&id.includes("leaves");
  if(shearedLeaves) {
    const drop=new ItemStack(id,1);block.setType("minecraft:air");
    let remainder=drop;for(const container of containers){if(!remainder)break;remainder=insertHarvestStack(container,remainder);}
    if(remainder)dimension.spawnItem(remainder,center);
  } else {
    const {x,y,z}=block.location;
    if(!dimension.runCommand(`setblock ${x} ${y} ${z} air destroy`).successCount)return false;
    if(containers.length)system.run(()=>{try {collectHarvestDrops(dimension,center,old,containers);}catch {}});
  }
  damageDeployerTool(hand,item);return true;
}