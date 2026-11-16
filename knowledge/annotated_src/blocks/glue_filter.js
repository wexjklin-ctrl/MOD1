/* CLAUDE-MAP-BEGIN
 FILE: blocks/glue_filter.js  (2 KB, 30 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (auto, from first comment) RZ Lite: что НЕЛЬЗЯ склеивать. Склейка работает только для транспорта и строительных материалов машин и их деталей.
 IMPORTS: -
 IMPORTED BY: main.js
 EXPORTS: CORE_ID, isTerrainBlock
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): isTerrainBlock@23(7L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// RZ Lite: что НЕЛЬЗЯ склеивать. Склейка работает только для транспорта и строительных материалов машин и их деталей.
// Блоки ландшафта (земля, песок, природный камень, руды, растения, снег/лёд) не попадают в конструкцию:
// иначе при сборке «уезжает» кусок мира. Список правится здесь.
export const CORE_ID = "phys:core";

const TERRAIN_EXACT = new Set([
  "grass_block", "dirt", "coarse_dirt", "rooted_dirt", "podzol", "mycelium", "farmland", "dirt_path", "grass_path", "mud", "muddy_mangrove_roots",
  "sand", "red_sand", "suspicious_sand", "gravel", "suspicious_gravel", "clay", "soul_sand", "soul_soil",
  "stone", "granite", "diorite", "andesite", "deepslate", "tuff", "calcite", "dripstone_block", "pointed_dripstone", "basalt", "smooth_basalt",
  "netherrack", "end_stone", "bedrock", "magma", "crying_obsidian_natural", "sandstone", "red_sandstone",
  "snow", "snow_layer", "powder_snow", "ice", "packed_ice", "blue_ice", "frosted_ice",
  "moss_block", "moss_carpet", "sculk", "sculk_vein", "sculk_catalyst", "sculk_shrieker", "sculk_sensor",
  "tallgrass", "short_grass", "tall_grass", "fern", "large_fern", "double_plant", "yellow_flower", "red_flower", "deadbush", "dead_bush", "seagrass", "kelp",
  "vine", "cactus", "reeds", "sugar_cane", "bamboo", "bamboo_sapling", "waterlily", "sea_pickle", "brown_mushroom", "red_mushroom",
  "brown_mushroom_block", "red_mushroom_block", "mushroom_stem", "glow_lichen", "hanging_roots", "spore_blossom", "big_dripleaf", "small_dripleaf_block",
  "sweet_berry_bush", "cave_vines", "cave_vines_body_with_berries", "cave_vines_head_with_berries", "weeping_vines", "twisting_vines", "nether_sprouts",
  "crimson_fungus", "warped_fungus", "crimson_roots", "warped_roots", "crimson_nylium", "warped_nylium", "azalea", "flowering_azalea",
  "sponge", "wet_sponge", "web", "cobweb", "fire", "soul_fire", "torchflower", "pitcher_plant", "pink_petals", "cherry_leaves",
  "mangrove_roots", "bubble_column", "ancient_debris", "gilded_blackstone",
]);
const TERRAIN_RE = [/_ore$/, /_leaves$/, /_sapling$/, /_coral/, /^coral/, /_propagule$/, /_fungus$/, /_roots$/, /^sapling$/, /^leaves2?$/, /^double_plant$/, /_tulip$/, /_flower$/];

export function isTerrainBlock(typeId) {
  if (typeof typeId !== "string") return false;
  const colon = typeId.indexOf(":");
  if (colon < 0 || typeId.slice(0, colon) !== "minecraft") return false;   // блоки аддонов (машины и детали) - всегда можно
  const name = typeId.slice(colon + 1);
  return TERRAIN_EXACT.has(name) || TERRAIN_RE.some(r => r.test(name));
}
