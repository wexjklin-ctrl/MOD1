package com.rzauto;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.EntitySpawnReason;
import com.rzauto.entity.VehicleEntity;
import com.rzauto.logic.VehicleCatalog;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Этап 1: пустая загрузка + чтение каталога. Регистрация EntityType/Item (этап 3) добавляется здесь по API 26.3. */
public class RzAutoMod implements ModInitializer {
	public static final String MOD_ID = "rz_auto";
	public static final Logger LOG = LoggerFactory.getLogger(MOD_ID);

	@Override
	public void onInitialize() {
		VehicleCatalog.load();
		LOG.info("RZ Auto: загружено {} машин", VehicleCatalog.all().size());
		VehicleRegistry.registerAll();
		LOG.info("RZ Auto: зарегистрировано сущностей и предметов: {}", VehicleRegistry.entries().size());
		if (System.getProperty("rz.smoke") != null) installSmokeTest();
	}

	/** Проверка в CI: сервер стартует, все 307 сущностей создаются, затем сервер останавливается. */
	private static void installSmokeTest() {
		ServerLifecycleEvents.SERVER_STARTED.register(server -> {
			ServerLevel w = server.overworld();
			int ok = 0;
			for (VehicleRegistry.Entry e : VehicleRegistry.entries()) {
				VehicleEntity v = e.type().create(w, EntitySpawnReason.COMMAND);
				if (v != null) { ok++; v.discard(); }
			}
			LOG.info("RZ SMOKE: создано {} из {}", ok, VehicleRegistry.entries().size());
			server.halt(false);
		});
	}
}
