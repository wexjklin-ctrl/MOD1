package com.rzauto.logic;

import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Читает vehicles.json (Gson входит в состав Minecraft). */
public final class VehicleCatalog {
	private static final Map<String, VehicleSpec> BY_ID = new LinkedHashMap<>();
	private static final Map<String, double[][]> SEATS = new HashMap<>();
	private static final Map<String, String> GEOM = new HashMap<>(), TEX = new HashMap<>();

	public static void load() {
		try (var in = VehicleCatalog.class.getResourceAsStream("/data/vehicles.json")) {
			if (in == null) throw new IllegalStateException("data/vehicles.json не найден");
			parse(new InputStreamReader(in, StandardCharsets.UTF_8));
		} catch (IOException e) {
			throw new UncheckedIOException(e);
		}
	}

	public static void parse(Reader r) {
		BY_ID.clear();
		SEATS.clear(); GEOM.clear(); TEX.clear();
		for (JsonElement el : JsonParser.parseReader(r).getAsJsonArray()) {
			JsonObject o = el.getAsJsonObject(), p = o.getAsJsonObject("profile");
			JsonObject f = p.getAsJsonObject("fuel");
			JsonObject g = (p.has("gear7") && p.get("gear7").isJsonObject()) ? p.getAsJsonObject("gear7") : null; // у части машин 7-й передачи нет
			JsonArray ch = p.getAsJsonArray("breakdown_chances_pct");
			int[] chances = new int[ch.size()];
			for (int i = 0; i < chances.length; i++) chances[i] = ch.get(i).getAsInt();
			VehicleSpec s = new VehicleSpec(
				o.get("id").getAsString(), o.get("family_prefix").getAsString(), o.get("is_motorcycle").getAsBoolean(),
				p.get("top_speed").getAsDouble(), p.get("accel").getAsDouble(),
				f.get("fuelMult").getAsDouble(), f.get("maxFuel").getAsDouble(), f.get("fuelPerBucket").getAsDouble(),
				chances, g == null ? 0 : g.get("speed").getAsDouble(), g == null ? 0 : g.get("seconds").getAsDouble(),
				g == null ? 1 : g.get("fuelMult").getAsDouble(), g == null ? 1 : g.get("wearMult").getAsDouble(),
				o.get("max_auto_step").getAsDouble(), o.get("health").getAsInt());
			BY_ID.put(s.bedrockId(), s);
			if (o.has("geometry")) GEOM.put(s.bedrockId(), o.get("geometry").getAsString());
			if (o.has("texture")) { String t = o.get("texture").getAsString(); TEX.put(s.bedrockId(), t.substring(t.lastIndexOf('/') + 1).toLowerCase()); }
			if (o.has("seats") && o.get("seats").isJsonArray()) {
				JsonArray sa = o.getAsJsonArray("seats");
				double[][] seats = new double[sa.size()][3];
				for (int i = 0; i < seats.length; i++) for (int k = 0; k < 3; k++) seats[i][k] = sa.get(i).getAsJsonArray().get(k).getAsDouble();
				SEATS.put(s.bedrockId(), seats);
			}
		}
	}

	/** Места из Bedrock (x, y, z относительно машины; первое = водитель); null, если нет. */
	public static double[][] seats(String bedrockId) { return SEATS.get(bedrockId); }

	/** id геометрии Bedrock ("geometry.458") или null. */
	public static String geometry(String bedrockId) { return GEOM.get(bedrockId); }
	/** Имя текстуры без пути и расширения, строчными (textures/entity/NAME.png) или null. */
	public static String texture(String bedrockId) { return TEX.get(bedrockId); }

	public static Collection<VehicleSpec> all() { return BY_ID.values(); }
	public static VehicleSpec get(String bedrockId) { return BY_ID.get(bedrockId); }
}
