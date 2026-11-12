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
		RzConfig.load();
		VehicleCatalog.load();
		LOG.info("RZ Auto: загружено {} машин", VehicleCatalog.all().size());
		VehicleRegistry.registerAll();
		LOG.info("RZ Auto: зарегистрировано сущностей и предметов: {}", VehicleRegistry.entries().size());
		// яйца призыва: ключи всех машин во вкладке творческого режима «Spawn Eggs»
		net.fabricmc.fabric.api.creativetab.v1.CreativeModeTabEvents.modifyOutputEvent(net.minecraft.world.item.CreativeModeTabs.SPAWN_EGGS)
				.register(entries -> { entries.accept(VehicleRegistry.BENCH_ITEM); entries.accept(VehicleRegistry.GEAR); entries.accept(VehicleRegistry.LICENSE); for (VehicleRegistry.Entry e : VehicleRegistry.entries()) entries.accept(e.item()); });
		net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry.serverboundPlay().register(com.rzauto.net.VehicleActionPayload.TYPE, com.rzauto.net.VehicleActionPayload.CODEC);
		net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking.registerGlobalReceiver(com.rzauto.net.VehicleActionPayload.TYPE, (payload, ctx) -> {
			net.minecraft.world.entity.Entity ent = ctx.player().level().getEntity(payload.entityId());
			if (ent instanceof VehicleEntity ve) ve.handleAction(ctx.player(), payload.action());
		});
		net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry.serverboundPlay().register(com.rzauto.net.BenchCraftPayload.TYPE, com.rzauto.net.BenchCraftPayload.CODEC);
		net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking.registerGlobalReceiver(com.rzauto.net.BenchCraftPayload.TYPE, (payload, ctx) -> benchCraft(ctx.player(), payload));
		if (System.getProperty("rz.smoke") != null) installSmokeTest();
	}

	/** Крафт на верстаке: проверка близости к верстаку, наличия материалов в инвентаре, списание и выдача. */
	private static void benchCraft(net.minecraft.server.level.ServerPlayer p, com.rzauto.net.BenchCraftPayload pl) {
		net.minecraft.core.BlockPos pos = net.minecraft.core.BlockPos.of(pl.pos());
		if (p.distanceToSqr(pos.getX() + 0.5, pos.getY() + 0.5, pos.getZ() + 0.5) > 64 || !p.level().getBlockState(pos).is(VehicleRegistry.BENCH)) return;
		com.rzauto.bench.BenchRecipes.Recipe r = com.rzauto.bench.BenchRecipes.byId(pl.recipe());
		if (r == null) return;
		net.minecraft.world.Container inv = p.getInventory();
		java.util.Map<String, Integer> have = new java.util.HashMap<>();
		for (int i = 0; i < inv.getContainerSize(); i++) {
			net.minecraft.world.item.ItemStack st = inv.getItem(i);
			if (!st.isEmpty()) have.merge(net.minecraft.core.registries.BuiltInRegistries.ITEM.getKey(st.getItem()).toString(), st.getCount(), Integer::sum);
		}
		for (var n : r.need().entrySet()) if (have.getOrDefault(n.getKey(), 0) < n.getValue()) { p.sendSystemMessage(net.minecraft.network.chat.Component.literal("§cНе хватает материалов."), true); return; }
		net.minecraft.world.item.Item out = net.minecraft.core.registries.BuiltInRegistries.ITEM.getValue(net.minecraft.resources.Identifier.parse(r.result()));
		if (out == null || out == net.minecraft.world.item.Items.AIR) return;
		for (var n : r.need().entrySet()) {
			int left = n.getValue();
			for (int i = 0; i < inv.getContainerSize() && left > 0; i++) {
				net.minecraft.world.item.ItemStack st = inv.getItem(i);
				if (st.isEmpty() || !net.minecraft.core.registries.BuiltInRegistries.ITEM.getKey(st.getItem()).toString().equals(n.getKey())) continue;
				int take = Math.min(left, st.getCount());
				st.shrink(take); left -= take;
			}
		}
		net.minecraft.world.item.ItemStack give = new net.minecraft.world.item.ItemStack(out, r.count());
		if (!p.getInventory().add(give)) p.spawnAtLocation(p.level(), give);
		inv.setChanged();
		p.sendSystemMessage(net.minecraft.network.chat.Component.literal("§aСоздано: " + give.getHoverName().getString()), true);
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
		double x0 = v.getX(), y0 = v.getY(), z0 = v.getZ();
		boolean ok = false;
		for (int k = 0; k < 4 && !ok; k++) {   // случайный рельеф CI: пробуем 4 направления, пока не упрёмся в стену сразу
			v.setPos(x0, y0, z0);
			v.setYRot(90f * k);
			v.debugSetSpeed(0.2);   // 1-я передача = 10% от top_speed, лимит ~0.21
			int ticks = 0;
			for (; ticks < 400 && (v.debugSpeed() != 0 || ticks == 0); ticks++) v.tick();
			double dist = Math.hypot(v.getX() - x0, v.getZ() - z0);
			LOG.info("RZ SMOKE: заезд (курс {}): проехала {} блоков, остановилась за {} тиков, speed={}", 90 * k, String.format("%.1f", dist), ticks, v.debugSpeed());
			ok = dist > 0.2 && v.debugSpeed() == 0;
		}
		LOG.info("RZ SMOKE: заезд {}", ok ? "OK" : "FAIL");
		v.discard();
	}
}
