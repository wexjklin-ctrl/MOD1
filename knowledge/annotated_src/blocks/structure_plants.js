/* CLAUDE-MAP-BEGIN
 FILE: blocks/structure_plants.js  (1 KB, 27 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: -
 IMPORTED BY: blocks/structure_placement.js
 EXPORTS: isStructurePlant
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): isStructurePlant@21(6L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
const plants = new Set([
  "grass", "short_grass", "tallgrass", "tall_grass", "fern", "large_fern", "double_plant",
  "deadbush", "dead_bush", "bush", "sapling", "leaves", "leaves2", "azalea", "flowering_azalea",
  "mangrove_propagule", "leaf_litter", "short_dry_grass", "tall_dry_grass", "firefly_bush",
  "yellow_flower", "red_flower", "dandelion", "poppy", "blue_orchid", "allium", "azure_bluet",
  "red_tulip", "orange_tulip", "white_tulip", "pink_tulip", "oxeye_daisy", "cornflower",
  "lily_of_the_valley", "wither_rose", "sunflower", "lilac", "rose_bush", "peony",
  "pink_petals", "wildflowers", "open_eyeblossom", "closed_eyeblossom", "torchflower", "pitcher_plant",
  "brown_mushroom", "red_mushroom", "crimson_fungus", "warped_fungus", "crimson_roots", "warped_roots",
  "nether_sprouts", "hanging_roots", "vine", "vines", "weeping_vines", "twisting_vines",
  "cave_vines", "cave_vines_body_with_berries", "cave_vines_head_with_berries", "cave_vines_plant",
  "pale_hanging_moss", "moss_carpet", "pale_moss_carpet", "glow_lichen", "spore_blossom",
  "bamboo", "bamboo_sapling", "cactus", "cactus_flower", "reeds", "sugar_cane",
  "kelp", "kelp_plant", "seagrass", "tall_seagrass", "waterlily", "lily_pad",
  "big_dripleaf", "big_dripleaf_stem", "small_dripleaf_block", "small_dripleaf",
  "wheat", "carrots", "potatoes", "beetroot", "beetroots", "sweet_berry_bush", "nether_wart",
  "pumpkin_stem", "melon_stem", "attached_pumpkin_stem", "attached_melon_stem",
  "cocoa", "torchflower_crop", "pitcher_crop", "wheat_seeds", "beetroot_seeds", "pumpkin_seeds",
  "melon_seeds", "torchflower_seeds", "pitcher_pod"
]);
export function isStructurePlant(typeId) {
  if (!typeId?.startsWith("minecraft:")) return false;
  const name=typeId.slice(10);
  return plants.has(name) || name.endsWith("_sapling") || name.endsWith("_leaves") ||
    name.startsWith("potted_");
}
