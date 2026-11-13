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
	public static float renderScale = 1.0f;
	/** Смещение высоты сидений Java относительно значений Bedrock (блоки). */
	public static float seatYOffset = 0.36f;
	/** Новая машина с полным баком (в оригинале бак пуст, заправка ведром лавы). */
	public static boolean startFullTank = false;
	/** Двигатель заводится сам, когда водитель садится (иначе: меню → «Завести двигатель»). */
	public static boolean autoStartEngine = true;
	/** Чтобы ехать, нужны водительские права в одной из рук (как в оригинале). */
	public static boolean requireLicense = true;

	public static void load() {
		try {
			Path p = FabricLoader.getInstance().getConfigDir().resolve("rz_auto.json");
			if (Files.exists(p)) {
				JsonObject o = JsonParser.parseString(Files.readString(p)).getAsJsonObject();
				if (o.has("renderScale")) renderScale = o.get("renderScale").getAsFloat();
				if (o.has("seatYOffset")) seatYOffset = o.get("seatYOffset").getAsFloat();
				if (o.has("autoStartEngine")) autoStartEngine = o.get("autoStartEngine").getAsBoolean();
				if (o.has("requireLicense")) requireLicense = o.get("requireLicense").getAsBoolean();
			} else {
				JsonObject o = new JsonObject();
				o.addProperty("renderScale", renderScale);
				o.addProperty("seatYOffset", seatYOffset);
				o.addProperty("startFullTank", startFullTank);
				o.addProperty("autoStartEngine", autoStartEngine);
				o.addProperty("requireLicense", requireLicense);
				Gson g = new GsonBuilder().setPrettyPrinting().create();
				Files.writeString(p, g.toJson(o));
			}
		} catch (Throwable t) { RzAutoMod.LOG.warn("rz_auto.json не прочитан, значения по умолчанию", t); }
		RzAutoMod.LOG.info("RZ Auto: renderScale={}, seatYOffset={}", renderScale, seatYOffset);
	}
}
