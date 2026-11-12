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
			try { driveTest(w); } catch (Throwable t) { LOG.error("RZ SMOKE: заезд упал", t); }
			server.halt(false);
		});
	}

	/** Заезд без игрока: падение на землю, разгон по инерции, торможение (проверка Physics + move на сервере). */
	private static void driveTest(ServerLevel w) {
		VehicleRegistry.Entry en = VehicleRegistry.entries().get(0);
		VehicleEntity v = en.type().create(w, EntitySpawnReason.COMMAND);
		net.minecraft.core.BlockPos sp = w.getRespawnData().pos();
		v.setPos(sp.getX() + 0.5, sp.getY() + 20, sp.getZ() + 0.5);
		w.addFreshEntity(v);
		for (int i = 0; i < 120; i++) v.tick();
		LOG.info("RZ SMOKE: после падения y={} (старт {}), onGround={}", v.getY(), sp.getY() + 20, v.onGround());
		double x0 = v.getX(), z0 = v.getZ();
		v.debugSetSpeed(0.2);   // 1-я передача = 10% от top_speed, лимит ~0.21
		int ticks = 0;
		for (; ticks < 400 && (v.debugSpeed() != 0 || ticks == 0); ticks++) v.tick();
		double dist = Math.hypot(v.getX() - x0, v.getZ() - z0);
		LOG.info("RZ SMOKE: заезд: проехала {} блоков, остановилась за {} тиков, speed={}", String.format("%.1f", dist), ticks, v.debugSpeed());
		LOG.info("RZ SMOKE: заезд {}", (dist > 0.5 && v.debugSpeed() == 0) ? "OK" : "FAIL");
		v.discard();
	}
}
