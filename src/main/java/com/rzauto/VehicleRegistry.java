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
	private static final Map<EntityType<?>, Item> ITEMS = new HashMap<>();

	/** Шестерёнка (ремонт) и водительские права (держать в руке, чтобы ехать). */
	public static Item GEAR, LICENSE;

	/** Ключ-предмет машины (для выпадения при поломке). */
	public static Item itemOf(EntityType<?> type) { return ITEMS.get(type); }

	public static List<Entry> entries() { return ENTRIES; }

	/** Описание машины по типу сущности (null для чужих типов). */
	public static VehicleSpec specOf(EntityType<?> type) { return SPECS.get(type); }

	public static net.minecraft.world.level.block.Block BENCH;
	public static Item BENCH_ITEM;
	public static net.minecraft.world.level.block.Block PASSPORT_DESK;
	public static Item PASSPORT_DESK_ITEM;

	private static void registerPassportDesk() {
		Identifier id = Identifier.fromNamespaceAndPath(RzAutoMod.MOD_ID, "passport_desk");
		ResourceKey<net.minecraft.world.level.block.Block> bk = ResourceKey.create(Registries.BLOCK, id);
		PASSPORT_DESK = Registry.register(BuiltInRegistries.BLOCK, bk, new com.rzauto.block.PassportDeskBlock(
			net.minecraft.world.level.block.state.BlockBehaviour.Properties.of().setId(bk).strength(2.5f).sound(net.minecraft.world.level.block.SoundType.WOOD)));
		ResourceKey<Item> ik = ResourceKey.create(Registries.ITEM, id);
		PASSPORT_DESK_ITEM = Registry.register(BuiltInRegistries.ITEM, ik, new net.minecraft.world.item.BlockItem(PASSPORT_DESK, new Item.Properties().setId(ik)));
	}

	private static void registerBench() {
		Identifier id = Identifier.fromNamespaceAndPath(RzAutoMod.MOD_ID, "bench");
		ResourceKey<net.minecraft.world.level.block.Block> bk = ResourceKey.create(Registries.BLOCK, id);
		BENCH = Registry.register(BuiltInRegistries.BLOCK, bk, new com.rzauto.block.BenchBlock(
			net.minecraft.world.level.block.state.BlockBehaviour.Properties.of().setId(bk).strength(2.5f).sound(net.minecraft.world.level.block.SoundType.WOOD)));
		ResourceKey<Item> ik = ResourceKey.create(Registries.ITEM, id);
		BENCH_ITEM = Registry.register(BuiltInRegistries.ITEM, ik, new net.minecraft.world.item.BlockItem(BENCH, new Item.Properties().setId(ik)));
	}

	private static Item simple(String path) {
		ResourceKey<Item> key = ResourceKey.create(Registries.ITEM, Identifier.fromNamespaceAndPath(RzAutoMod.MOD_ID, path));
		return Registry.register(BuiltInRegistries.ITEM, key, new Item(new Item.Properties().setId(key)));
	}

	public static void registerAll() {
		registerBench();
		registerPassportDesk();
		GEAR = simple("gear");
		{
			ResourceKey<Item> lk = ResourceKey.create(Registries.ITEM, Identifier.fromNamespaceAndPath(RzAutoMod.MOD_ID, "driver_license"));
			LICENSE = Registry.register(BuiltInRegistries.ITEM, lk, new com.rzauto.item.PassportItem(new Item.Properties().setId(lk).stacksTo(16)));
		}
		for (VehicleSpec spec : VehicleCatalog.all()) {
			String path = spec.javaId().substring(spec.javaId().indexOf(':') + 1);
			Identifier id = Identifier.fromNamespaceAndPath(RzAutoMod.MOD_ID, path);

			ResourceKey<EntityType<?>> typeKey = ResourceKey.create(Registries.ENTITY_TYPE, id);
			float k = RzConfig.renderScale;
			// хитбокс (в Minecraft он квадратный в плане и не поворачивается): 70% ширины модели, 1.3..2.2 блока; раньше был до 3.2 и цеплялся за воздух
			double[] dm = VehicleCatalog.dims(spec.bedrockId());
			float w = (spec.motorcycle() ? 0.9f : 2.0f) * k, h = (spec.motorcycle() ? 1.4f : 1.5f) * k;
			if (dm != null) {
				w = (float) (spec.motorcycle() ? Math.max(0.7, Math.min(1.1, dm[0] * 0.7)) : Math.max(1.3, Math.min(2.2, dm[0] * 0.7))) * k;   // уже кузова: лучше проехать впритык, чем цепляться за воздух
				h = (float) Math.max(1.0, Math.min(2.4, dm[2])) * k;
			}
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
			ITEMS.put(type, item);
			ENTRIES.add(new Entry(spec, type, item));
		}
	}
}
