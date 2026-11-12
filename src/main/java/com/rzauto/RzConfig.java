package com.rzauto;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.file.Files;
import java.nio.file.Path;
import net.fabricmc.loader.api.FabricLoader;

/** Настройки: файл config/rz_auto.json (создаётся при первом запуске). Должен быть одинаковым на сервере и у игроков. */
public final class RzConfig {
	private RzConfig() {}

	/** Во сколько раз увеличить машины сверх размера из оригинала (модель, посадочные места, хитбокс). 1.0 = как в Bedrock. */
	public static float renderScale = 1.25f;
	/** Смещение высоты сидений Java относительно значений Bedrock (блоки). */
	public static float seatYOffset = 0.36f;

	public static void load() {
		try {
			Path p = FabricLoader.getInstance().getConfigDir().resolve("rz_auto.json");
			if (Files.exists(p)) {
				JsonObject o = JsonParser.parseString(Files.readString(p)).getAsJsonObject();
				if (o.has("renderScale")) renderScale = o.get("renderScale").getAsFloat();
				if (o.has("seatYOffset")) seatYOffset = o.get("seatYOffset").getAsFloat();
			} else {
				JsonObject o = new JsonObject();
				o.addProperty("renderScale", renderScale);
				o.addProperty("seatYOffset", seatYOffset);
				Gson g = new GsonBuilder().setPrettyPrinting().create();
				Files.writeString(p, g.toJson(o));
			}
		} catch (Throwable t) { RzAutoMod.LOG.warn("rz_auto.json не прочитан, значения по умолчанию", t); }
		RzAutoMod.LOG.info("RZ Auto: renderScale={}, seatYOffset={}", renderScale, seatYOffset);
	}
}
