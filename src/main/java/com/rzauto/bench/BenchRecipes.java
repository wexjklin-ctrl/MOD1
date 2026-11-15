package com.rzauto.bench;

import com.google.gson.*;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Рецепты верстака из data/recipes.json (оригинальный аддон): результат и требуемые предметы с количеством. */
public final class BenchRecipes {
	public record Recipe(String id, String result, int count, String group, Map<String, Integer> need, String[] grid) {}

	private static final List<Recipe> ALL = new ArrayList<>();
	private static final Map<String, Recipe> BY_ID = new HashMap<>();

	private static String mapItem(String id) {
		return switch (id) {
			case "carworkshop:gear" -> "rz_auto:gear";
			case "carworkshop:driver_license" -> "rz_auto:driver_license";
			default -> id;
		};
	}

	public static synchronized List<Recipe> all() {
		if (!ALL.isEmpty()) return ALL;
		try (var in = BenchRecipes.class.getResourceAsStream("/data/recipes.json")) {
			JsonArray arr = JsonParser.parseReader(new InputStreamReader(in, StandardCharsets.UTF_8)).getAsJsonArray();
			for (JsonElement e : arr) {
				JsonObject o = e.getAsJsonObject();
				JsonObject r = o.getAsJsonObject("result");
				String srcItem = r.get("item").getAsString();
				String res = r.has("java_item") ? r.get("java_item").getAsString() : mapItem(srcItem);
				int cnt = r.has("count") ? r.get("count").getAsInt() : 1;
				Map<String, Integer> need = new LinkedHashMap<>();
				String[] grid = new String[9];
				Arrays.fill(grid, "");
				int gi = 0;
				if (o.has("pattern")) {
					JsonObject key = o.getAsJsonObject("key");
					int ri = 0;
					for (JsonElement row : o.getAsJsonArray("pattern")) {
						int ci = 0;
						for (char ch : row.getAsString().toCharArray()) {
							if (ch != ' ' && key.has(String.valueOf(ch))) {
								String it = key.get(String.valueOf(ch)).getAsString();
								need.merge(it, 1, Integer::sum);
								if (ri < 3 && ci < 3) grid[ri * 3 + ci] = it;
							}
							ci++;
						}
						ri++;
					}
				} else if (o.has("ingredients")) {
					for (JsonElement ie : o.getAsJsonArray("ingredients")) {
						JsonObject io = ie.getAsJsonObject();
						String it = io.get("item").getAsString();
						need.merge(it, io.has("count") ? io.get("count").getAsInt() : 1, Integer::sum);
						if (gi < 9) grid[gi++] = it;
					}
				}
				int c = srcItem.indexOf(':');
				String group = srcItem.endsWith("_spawn_egg") && c > 0 ? srcItem.substring(0, c) : "";
				Recipe rc = new Recipe(o.get("id").getAsString(), res, cnt, group, need, grid);
				ALL.add(rc); BY_ID.put(rc.id(), rc);
			}
			// Предметы без марки (паспортный стол, паспорт, шестерёнка) идут первыми, а не в конце списка машин.
			ALL.sort(Comparator.comparing(r -> !r.group().isEmpty()));
		} catch (Throwable t) { com.rzauto.RzAutoMod.LOG.error("recipes.json верстака не прочитался", t); }
		return ALL;
	}

	public static Recipe byId(String id) { all(); return BY_ID.get(id); }
}
