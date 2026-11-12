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
			float w = spec.motorcycle() ? 0.9f : 2.0f;
			float h = spec.motorcycle() ? 1.4f : 1.5f;
			EntityType<VehicleEntity> type = EntityType.Builder.<VehicleEntity>of(VehicleEntity::new, MobCategory.MISC)
					.sized(w, h)
					.passengerAttachments(0.5f)   // этап 2: все пассажиры в центре; точные места из vehicles.json позже
					.clientTrackingRange(8)   // 8 чанков = 128 блоков; уменьшить при нагрузке (см. PROMPT, «Обновление 4»)
					.updateInterval(2)
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
