package com.rzauto.logic;

import java.util.Set;

/** vehicle_surfaces.js: какое покрытие режет скорость и какую пыль даёт. id блоков — без "minecraft:". */
public final class Surface {
	public record Effect(boolean reducesSpeed, String particle) {}

	private static final Set<String> SAND = Set.of("sand", "red_sand");
	private static final Set<String> MUD = Set.of("mud", "muddy_mangrove_roots");
	private static final Set<String> EARTH = Set.of("dirt", "coarse_dirt", "rooted_dirt", "podzol", "mycelium", "farmland",
			"dirt_path", "grass_block", "moss_block", "moss_carpet", "pale_moss_block", "pale_moss_carpet");
	private static final Set<String> SNOW = Set.of("snow"); // слои снега; у Java snow_block в оригинале не учитывался

	// Неизменяемые общие экземпляры: effect() вызывается часто, аллокаций быть не должно.
	private static final Effect E_SAND = new Effect(true, "rz_auto:wheel_dust_sand"), E_MUD = new Effect(true, "rz_auto:wheel_dust_mud"),
			E_DIRT = new Effect(true, "rz_auto:wheel_dust_dirt"), E_SNOW = new Effect(false, "rz_auto:wheel_dust_snow");

	/** null = обычная земля: без штрафа и пыли. */
	public static Effect effect(String blockId) {
		if (blockId == null) return null;
		if (SAND.contains(blockId)) return E_SAND;
		if (MUD.contains(blockId)) return E_MUD;
		if (EARTH.contains(blockId)) return E_DIRT;
		if (SNOW.contains(blockId)) return E_SNOW;
		return null;
	}

	// ---- vehicle_surfaces.js getRoadSound: шум шин по блоку под машиной (клиентский звук) ----
	public record Road(String key, double vol) {}
	public static final String[] ROAD_KEYS = {"asphalt", "gravel", "dirt", "sand", "grass"};
	private static final Set<String> ROAD_GRASS = Set.of("grass_block", "short_grass", "tall_grass", "fern", "large_fern");
	private static final Set<String> ROAD_GRAVEL = Set.of("gravel", "suspicious_gravel");
	private static final Set<String> ROAD_NONE = Set.of("water", "lava", "air", "cave_air", "void_air");
	private static final Road R_SAND = new Road("sand", 0.85), R_GRAVEL = new Road("gravel", 1.0), R_GRASS = new Road("grass", 0.8),
			R_DIRT = new Road("dirt", 0.95), R_SNOW = new Road("grass", 0.5), R_ASPHALT = new Road("asphalt", 0.85);

	/** null = тишина (воздух, вода, лава или блока нет). Порядок проверок как в оригинале: трава раньше земли. */
	public static Road roadSound(String blockId) {
		if (blockId == null || ROAD_NONE.contains(blockId)) return null;
		if (SAND.contains(blockId)) return R_SAND;
		if (ROAD_GRAVEL.contains(blockId)) return R_GRAVEL;
		if (ROAD_GRASS.contains(blockId)) return R_GRASS;
		if (MUD.contains(blockId) || EARTH.contains(blockId)) return R_DIRT;
		if (SNOW.contains(blockId) || blockId.equals("powder_snow")) return R_SNOW;
		return R_ASPHALT;
	}
}
