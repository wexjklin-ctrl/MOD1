/* CLAUDE-MAP-BEGIN
 FILE: blocks/rz_block_mass.js  (12 KB, 143 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: Weight and buoyancy per block (RZ values); scriptevent rzlite:weight.
 IMPORTS: @minecraft/server, blocks/rz_block_strength.js
 IMPORTED BY: blocks/balloon_flight.js, blocks/car_drive.js, blocks/rz_air_rig.js, blocks/rz_drive.js, main.js
 EXPORTS: RZW, rzBlockMass, rzBlockBuoyVolume, rzWeightMass, rzWeightBuoy, rzMassOf, installRzWeight
 EVENTS: scriptEventReceive
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): installRzWeight@124(19L); rzBlockMass@80(15L); rzBlockBuoyVolume@98(9L); shapeOf@74(5L); rzMassOf@114(5L); rzWeightMass@109(1L); rzWeightBuoy@111(1L); save@122(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// RZ Lite: вес и плавучесть блоков по таблице RZ (RZ_Physics_BP/scripts/lib/blockMass.js).
// Новая система (RZW.ON = 1, по умолчанию): масса блока в движке = масса RZ (дерево 0.65, камень 2.5, железо 7.9 ...), объём вытеснения
// воды = объём формы блока (как buoy в RZ). Тогда вес реально влияет на разгон (rz_drive.js), самолёт (rz_air_rig.js) и плавучесть.
// Отключить: /scriptevent rzlite:weight off (действует на конструкции, собранные после переключения). Старые массы Lite остаются запасным режимом.
// Всё считается один раз на тип блока (кэш) и один раз при сборке конструкции: в тике нагрузки нет.
// Правила как в RZ: для minecraft:* применяются ВСЕ подходящие правила по порядку, последнее перекрывает предыдущие; по умолчанию 1.
import { world, system } from "@minecraft/server";
import { getBlockStrength } from "./rz_block_strength.js";   // броня блока (твёрдость/сопротивление) из RZ; потребитель - гниение и урон блокам (следующие шаги)

export const RZW = {
  ON: 1,            // 1 = массы и плавучесть по RZ, 0 = старые массы Lite (0.25 на блок)
  WHEEL_MASS: 0.5,  // масса невидимого блока-шины, которым Lite добавляет колесо (было 0.18)
  BALLOON_ENV_LIFT: 1.0, // шар: сколько массы груза поднимает одна оболочка при полной горелке (единицы массы RZ)
  BUOY_K: 1 / 1.05  // плотность воды в движке Lite 1.05 (physics.js), в RZ 1: объём делим на 1.05, чтобы дерево/камень плавали и тонули как в RZ
};
const RULES = [
  [/stone|cobble|andesite|diorite|granite|tuff|calcite|dripstone_block|basalt|deepslate|brick|sandstone|quartz|purpur|prismarine|end_stone|terracotta|concrete|obsidian|netherrack|blackstone|amethyst_block|budding_amethyst|sulfur|cinnabar/, 2.5],
  [/deepslate|basalt|blackstone/, 2.8],
  [/netherrack|tuff|^mud_brick|packed_mud|resin_brick/, 1.8],
  [/terracotta|hardened_clay|^brick|_bricks?$/, 2],
  [/sandstone/, 2.2],
  [/_ore$|ancient_debris|^raw_/, 3.2],
  [/furnace|smoker|dispenser|dropper|observer|piston|lodestone|stonecutter|grindstone|enchanting_table|ender_chest|respawn_anchor|beacon|bedrock|reinforced|crafter|vault|trial_spawner|mob_spawner|redstone_lamp|^target$/, 2.2],
  [/dirt|grass_block|^grass_path|podzol|mycelium|farmland|rooted|^mud$|^clay$|moss_block|nylium|soul_soil/, 1.4],
  [/^mud$|muddy/, 1.7],
  [/moss_block/, 0.5],
  [/sand$|gravel|concrete_powder|soul_sand/, 1.6],
  [/^snow$|powder_snow/, 0.4],
  [/^(oak|spruce|birch|jungle|acacia|dark_oak|darkoak|mangrove|cherry|bamboo|crimson|warped|pale_oak|poplar|petrified_oak)_/, 0.65],
  [/planks|_log$|_wood$|_stem$|hyphae|bamboo_block|bamboo_mosaic|bookshelf|crafting_table|cartography|fletching|smithing|loom|barrel|chest|note|jukebox|lectern|composter|beehive|bee_nest|_shelf$|scaffolding|campfire|daylight_detector|_hanging_sign|creaking_heart/, 0.65],
  [/chest|barrel|composter|scaffolding|beehive|bee_nest|_shelf$/, 0.4],
  [/iron_block|anvil|copper|^chain$|iron_chain|iron_bars|cauldron|hopper|lightning_rod|heavy_core|netherite_block|gold_block|lantern/, 7.9],
  [/copper/, 8.9],
  [/gold_block/, 19.3],
  [/netherite_block/, 12],
  [/heavy_core/, 20],
  [/_bars$|chain$|_grate$|cauldron|hopper|lantern|lightning_rod|_bulb$/, 1.5],
  [/diamond_block/, 3.5],
  [/emerald_block|lapis_block|redstone_block/, 2.7],
  [/coal_block/, 1.4],
  [/glass/, 2.5],
  [/glass_pane/, 0.4],
  [/wool/, 0.2],
  [/leaves|azalea/, 0.15],
  [/hay_block|dried_kelp_block|sponge|mushroom_block|mushroom_stem|shroomlight|wart_block|honeycomb_block|target/, 0.3],
  [/wet_sponge/, 1],
  [/melon|pumpkin|cactus|carved|jack_o/, 0.8],
  [/bone_block|coral_block|glowstone|sea_lantern|froglight|magma|sculk/, 1.6],
  [/tnt/, 1.6],
  [/shulker_box|^bed$|_bed$/, 0.4],
  [/ice/, 0.92],
  [/slime/, 1],
  [/honey_block/, 1.4],
  [/^air$|_air$|^light_block|structure_void|^water$|^lava$|flowing_|bubble_column|^fire$|soul_fire|portal$|end_gateway/, 0.01],
  [/sapling|flower|tulip|orchid|allium|bluet|daisy|dandelion|poppy|cornflower|lily|rose|peony|lilac|sunflower|torchflower|pitcher|eyeblossom|cactus_flower|petals|wildflowers|leaf_litter|bush$|^short_|^tall_|fern|_grass$|seagrass|kelp|^vine$|vines|lichen|sculk_vein|roots$|sprouts|fungus|nether_wart$|^wheat$|carrots|potatoes|beetroot|cocoa|sugar_cane|reeds|^bamboo$|bamboo_sapling|dripleaf|spore_blossom|propagule|moss_carpet|_carpet$|^snow_layer$|frogspawn|turtle_egg|sniffer_egg|sea_pickle|coral$|coral_fan|_fan$|web$|firefly|^(brown|red)_mushroom$|shelf_mushroom|frog_spawn|hanging_moss|^red_shrub$/, 0.02],
  [/torch|redstone_wire|repeater|comparator|lever$|button|pressure_plate|tripwire|trip_wire|^rail$|_rail$|_sign$|standing_sign|wall_sign|banner|^ladder$|flower_pot|_head$|skull|candle|item_frame|^frame$|end_rod|lantern|chain$|lightning_rod|^bell$|brewing_stand|amethyst_bud|amethyst_cluster|pointed_dripstone|^cake$|_cake$|string|conduit|decorated_pot|hanging_roots|resin_clump|dried_ghast|copper_golem|_statue$|^camera$/, 0.1],
  [/chorus_flower|decorated_pot/, 0.5],
  [/mangrove_roots/, 0.5],
  [/muddy_mangrove_roots/, 1.5]
];
// блоки RZ и Lite с известной массой в RZ (aircraft.js: крыло и руль 0.3, винт 0.7; ядро 2.5)
// Привод (числа те же, что ENGINES/BLOCK_MASS в rz_drive.js)
// Масса крыльев и рулей с металлической обшивкой (шерсть = 0.3). Не критично больше, чем у блоков.
const SAIL_MATERIAL_MASS = { copper: 0.45, iron: 0.6, netherite: 0.85 };
const FIXED = new Map([["aero:block__smart_propeller__propeller_reversed", 0.7], ["aero:block__smart_propeller__propeller_medium", 1.3], ["aero:block__smart_propeller__propeller_large", 2.2], ["aero:block__smart_propeller__propeller_huge", 4.0],
  ["sim:block__black_symmetric_sail", 0.3], ["sim:block__gray_symmetric_sail", 0.3], ["sim:block__brown_symmetric_sail", 0.3], ["sim:block__white_symmetric_sail", 0.3], ["sim:block__light_gray_symmetric_sail", 0.3], ["sim:block__red_symmetric_sail", 0.3], ["sim:block__orange_symmetric_sail", 0.3], ["sim:block__yellow_symmetric_sail", 0.3], ["sim:block__lime_symmetric_sail", 0.3], ["sim:block__green_symmetric_sail", 0.3], ["sim:block__cyan_symmetric_sail", 0.3], ["sim:block__light_blue_symmetric_sail", 0.3], ["sim:block__blue_symmetric_sail", 0.3], ["sim:block__purple_symmetric_sail", 0.3], ["sim:block__magenta_symmetric_sail", 0.3], ["sim:block__pink_symmetric_sail", 0.3], ["sim:block__copper_symmetric_sail", 0.45], ["sim:block__iron_symmetric_sail", 0.6], ["sim:block__netherite_symmetric_sail", 0.85], ["phys:core", 2.5],
  ["tfmg:simple_large_engine", 2.0], ["tfmg:large_engine", 2.5], ["cdg:diesel_engine", 1.4], ["cdg:modular_diesel_engine", 2.4], ["phys:steam_engine", 1.5],
  ["create_physics:wheel_mount", 1.0], ["create_physics:wheel_mount_iron", 2.5], ["create_physics:wheel_mount_netherite", 4.0], ["phys:shaft", 0.15], ["phys:radiator", 0.7], ["phys:fuel_tank", 0.8], ["phys:blaze_burner", 1.2], ["phys:fluid_tank", 1.0],
  ["tfmg:steel_gearbox", 1.0], ["tfmg:engine_gearbox", 0.9]]);
// Своя форма: во сколько раз объём блока меньше полного (в RZ масса и вытеснение идут по объёму коробки; у форм состояния минимум 0.25)
const SHAPE = [[/slab/, 0.5], [/stairs/, 0.75], [/_wall$/, 0.5], [/fence_gate/, 0.25], [/fence/, 0.25], [/trapdoor|_door$/, 0.25], [/_pane$|_bars$|^chain$|iron_chain/, 0.25], [/anvil|hopper|cauldron/, 0.75]];
const cache = new Map();

function shapeOf(n) {
  if (/double/.test(n)) return 1;
  for (const [re, f] of SHAPE) if (re.test(n)) return f;
  return 1;
}

export function rzBlockMass(typeId) {
  let m = cache.get(typeId);
  if (m !== undefined) return m;
  if (FIXED.has(typeId)) m = FIXED.get(typeId);
  else if (typeId.startsWith("create_physics:symmetric_sail")) m = SAIL_MATERIAL_MASS[typeId.replace(/^create_physics:symmetric_sail(_side)?_/, "")] ?? 0.3;   // шерсть 0.3, обшивка: медь/железо/незерит тяжелее
  else if (typeId.startsWith("minecraft:")) {
    const n = typeId.slice(10);
    m = 1;
    for (const [re, v] of RULES) if (re.test(n)) m = v;
    m *= shapeOf(n);
  } else if (/seat|armchair/.test(typeId)) m = 0.4;   // как кровать/ящик RZ
  else m = 1;                                         // блоки аддонов: как в RZ (1)
  cache.set(typeId, m);
  return m;
}

const buoyCache = new Map();
/** Объём вытеснения воды блоком (единицы объёма движка Lite): форма блока * BUOY_K; лёгкая мелочь (факелы, цветы) почти не вытесняет. */
export function rzBlockBuoyVolume(typeId) {
  let v = buoyCache.get(typeId);
  if (v !== undefined) return v;
  const m = rzBlockMass(typeId);
  const n = typeId.startsWith("minecraft:") ? typeId.slice(10) : "";
  v = shapeOf(n) * (m <= 0.1 ? 0.1 : 1) * RZW.BUOY_K;
  buoyCache.set(typeId, v);
  return v;
}

/** Для physicsMassForBlock в main.js: масса RZ или undefined (флаг выключен - старые массы Lite). */
export const rzWeightMass = typeId => RZW.ON ? rzBlockMass(String(typeId ?? "")) : undefined;
/** Для сборки конструкции: объём вытеснения или undefined (движок возьмёт свой). */
export const rzWeightBuoy = typeId => RZW.ON ? rzBlockBuoyVolume(String(typeId ?? "")) : undefined;

/** Масса конструкции «по RZ» (сумма по блокам). Вызывать только при смене состава блоков. */
export function rzMassOf(snapshots) {
  let m = 0;
  for (const s of snapshots) m += rzBlockMass(s.typeId);
  return Math.max(1, m);
}

// ------------------------------------------------------------------ флаг и команды
const PROP_KEY = "rzlite:weight";
const save = () => { try { world.setDynamicProperty(PROP_KEY, JSON.stringify({ on: RZW.ON ? 1 : 0 })); } catch {} };

export function installRzWeight() {
  try {
    system.run(() => {
      try {
        const raw = world.getDynamicProperty(PROP_KEY);
        if (typeof raw === "string") { const o = JSON.parse(raw); if (o && (o.on === 0 || o.on === 1)) RZW.ON = o.on; }
      } catch {}
    });
    system.afterEvents.scriptEventReceive.subscribe(ev => {
      if (ev.id !== "rzlite:weight") return;
      const reply = m => { try { (ev.sourceEntity ?? world).sendMessage?.(m); } catch {} };
      const a = ev.message.trim().toLowerCase().split(/\s+/);
      if (a[0] === "on" || a[0] === "off") { RZW.ON = a[0] === "on" ? 1 : 0; save(); reply(`[weight] ${RZW.ON ? "веса RZ включены" : "старые массы Lite"}. Действует на конструкции, собранные заново (разберите и соберите).`); }
      else if (a[0] === "set" && ["WHEEL_MASS", "BALLOON_ENV_LIFT"].includes((a[1] ?? "").toUpperCase()) && Number.isFinite(Number(a[2]))) { RZW[a[1].toUpperCase()] = Math.max(0, Number(a[2])); reply(`[weight] ${a[1]} = ${a[2]}`); }
      else if (a[0] === "block" && a[1]) { const id = a[1].includes(":") ? a[1] : "minecraft:" + a[1]; { const st = getBlockStrength(id); reply(`[weight] ${id}: масса ${rzBlockMass(id)}, вытеснение ${rzBlockBuoyVolume(id).toFixed(3)}, броня: твёрдость ${st.hardness}, сопротивление ${st.resistance}`); } }
      else reply(`[weight] ON=${RZW.ON} WHEEL_MASS=${RZW.WHEEL_MASS} BALLOON_ENV_LIFT=${RZW.BALLOON_ENV_LIFT}. Команды: on | off | block <id> | set <WHEEL_MASS|BALLOON_ENV_LIFT> <число>`);
    });
  } catch {}
}
