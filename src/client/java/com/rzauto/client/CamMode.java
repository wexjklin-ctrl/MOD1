package com.rzauto.client;

import java.nio.file.*;

/** Режим камеры в машине: GTA (камера за машиной, персонаж смотрит вперёд) или свободная (обычная камера Minecraft). Хранится в config/rz_auto_camera.txt. */
final class CamMode {
	static boolean gta = true;
	private static final Path FILE = net.fabricmc.loader.api.FabricLoader.getInstance().getConfigDir().resolve("rz_auto_camera.txt");

	static void load() {
		try { if (Files.exists(FILE)) gta = !Files.readString(FILE).trim().equals("free"); } catch (Exception ignored) { }
	}

	static void toggle() {
		gta = !gta;
		try { Files.writeString(FILE, gta ? "gta" : "free"); } catch (Exception ignored) { }
	}
}
