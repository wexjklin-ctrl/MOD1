package com.rzauto;

import net.fabricmc.api.ModInitializer;
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
	}
}
