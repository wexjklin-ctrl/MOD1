package com.rzauto;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.List;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;
import net.minecraft.world.item.Item;
import net.minecraft.world.phys.Vec3;
import com.rzauto.entity.VehicleEntity;
import com.rzauto.item.VehicleItem;
import com.rzauto.logic.VehicleCatalog;
import com.rzauto.logic.VehicleSpec;

/** Регистрация сущностей и предметов-ключей для всех машин каталога. */
public final class VehicleRegistry {
	private VehicleRegistry() {}

	/** Тип сущности + предмет одной машины. */
	public record Entry(VehicleSpec spec, EntityType<VehicleEntity> type, Item item) {}

	private static final List<Entry> ENTRIES = new ArrayList<>();

	private static final Map<EntityType<?>, VehicleSpec> SPECS = new HashMap<>();

	public static List<Entry> entries() { return ENTRIES; }

	/** Описание машины по типу сущности (null для чужих типов). */
	public static VehicleSpec specOf(EntityType<?> type) { return SPECS.get(type); }

	public static void registerAll() {
		for (VehicleSpec spec : VehicleCatalog.all()) {
			String path = spec.javaId().substring(spec.javaId().indexOf(':') + 1);
			Identifier id = Identifier.fromNamespaceAndPath(RzAutoMod.MOD_ID, path);

			ResourceKey<EntityType<?>> typeKey = ResourceKey.create(Registries.ENTITY_TYPE, id);
			float k = RzConfig.renderScale;
			float w = (spec.motorcycle() ? 0.9f : 2.0f) * k;
			float h = (spec.motorcycle() ? 1.4f : 1.5f) * k;
			double[][] sd = VehicleCatalog.seats(spec.bedrockId());
			Vec3[] seatPts;
			if (sd == null || sd.length == 0) seatPts = new Vec3[] { new Vec3(0, 0.5, 0) };
			else {
				seatPts = new Vec3[Math.min(sd.length, 4)];
				// Bedrock: x,y,z в блоках от начала сущности; модель растёт в k раз, поэтому и места тоже
				for (int i = 0; i < seatPts.length; i++) seatPts[i] = new Vec3(sd[i][0] * k, sd[i][1] * k + RzConfig.seatYOffset, sd[i][2] * k);
			}
			EntityType<VehicleEntity> type = EntityType.Builder.<VehicleEntity>of(VehicleEntity::new, MobCategory.MISC)
					.sized(w, h)
					.passengerAttachments(seatPts)   // места из vehicles.json (x, z); высота пока общая
					.clientTrackingRange(8)   // 8 чанков = 128 блоков; уменьшить при нагрузке (см. PROMPT, «Обновление 4»)
					.updateInterval(1)
					.build(typeKey);
			Registry.register(BuiltInRegistries.ENTITY_TYPE, typeKey, type);

			ResourceKey<Item> itemKey = ResourceKey.create(Registries.ITEM, id);
			Item item = new VehicleItem(new Item.Properties().setId(itemKey).stacksTo(1), type);
			Registry.register(BuiltInRegistries.ITEM, itemKey, item);

			SPECS.put(type, spec);
			ENTRIES.add(new Entry(spec, type, item));
		}
	}
}
