package com.rzauto.client;

import com.rzauto.entity.VehicleEntity;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientEntityEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import java.util.ArrayList;
import java.util.List;

/**
 * Список машин, загруженных у клиента. Ведётся событиями загрузки/выгрузки сущностей, поэтому звук, дым и радио
 * обходят только машины, а не все сущности мира каждый тик (на сервере с мобами и предметами это основная экономия).
 */
final class ClientVehicles {
	static final List<VehicleEntity> LIST = new ArrayList<>();

	static void register() {
		ClientEntityEvents.ENTITY_LOAD.register((entity, world) -> { if (entity instanceof VehicleEntity v && !LIST.contains(v)) LIST.add(v); });
		ClientEntityEvents.ENTITY_UNLOAD.register((entity, world) -> { if (entity instanceof VehicleEntity v) LIST.remove(v); });
		ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> LIST.clear());
	}
}
