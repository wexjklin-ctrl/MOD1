package com.rzauto.client;

import java.nio.file.*;

/** Режим камеры в машине: GTA (камера за машиной, персонаж смотрит вперёд) или свободная (обычная камера Minecraft). Хранится в config/rz_auto_camera.txt. */
final class CamMode {
	static boolean gta = true;
	private static final Path FILE = net.fabricmc.loader.api.FabricLoader.getInstance().getConfigDir().resolve("rz_auto_camera.txt");

	static void load() {
		loadDist();
		try { if (Files.exists(FILE)) gta = !Files.readString(FILE).trim().equals("free"); } catch (Exception ignored) { }
	}

	/** Дистанция камеры GTA от машины, множитель 0.6..2.0 (100% = как раньше). */
	static float dist = 1.0f;
	private static final Path DFILE = net.fabricmc.loader.api.FabricLoader.getInstance().getConfigDir().resolve("rz_auto_camera_dist.txt");

	static void loadDist() {
		try { if (Files.exists(DFILE)) dist = Math.max(0.6f, Math.min(2.0f, Float.parseFloat(Files.readString(DFILE).trim()))); } catch (Exception ignored) { }
	}

	static void addDist(float d) {
		dist = Math.max(0.6f, Math.min(2.0f, Math.round((dist + d) * 10f) / 10f));
		try { Files.writeString(DFILE, Float.toString(dist)); } catch (Exception ignored) { }
	}

	static void toggle() {
		gta = !gta;
		try { Files.writeString(FILE, gta ? "gta" : "free"); } catch (Exception ignored) { }
	}
}
