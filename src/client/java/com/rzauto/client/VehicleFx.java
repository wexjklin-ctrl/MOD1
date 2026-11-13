package com.rzauto.client;

import com.rzauto.VehicleRegistry;
import com.rzauto.entity.VehicleEntity;
import com.rzauto.logic.Surface;
import com.rzauto.logic.VehicleCatalog;
import net.minecraft.client.Minecraft;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.BlockParticleOption;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.level.block.state.BlockState;
import java.util.Map;
import java.util.WeakHashMap;

/** Пыль из-под задних колёс: по песку, земле/грязи и снегу своя (частицы блока под колесом, для снега облако и снежинки). */
final class VehicleFx {
	private static final Map<VehicleEntity, double[]> LAST = new WeakHashMap<>();

	static void tick(Minecraft mc) {
		if (mc.level == null || mc.player == null) { LAST.clear(); return; }
		for (net.minecraft.world.entity.Entity ent : mc.level.entitiesForRendering()) {
			if (!(ent instanceof VehicleEntity e) || e.isRemoved() || e.distanceToSqr(mc.player) > 40 * 40) continue;
			double[] l = LAST.computeIfAbsent(e, k -> new double[] { e.getX(), e.getZ() });
			double v = Math.hypot(e.getX() - l[0], e.getZ() - l[1]);
			l[0] = e.getX(); l[1] = e.getZ();
			if (v < 0.12 || !e.onGround() || e.getPassengers().isEmpty()) continue;
			var spec = VehicleRegistry.specOf(e.getType());
			double[] dm = spec == null ? null : VehicleCatalog.dims(spec.bedrockId());
			double halfW = dm == null ? 0.8 : dm[0] * 0.38, back = dm == null ? 1.6 : dm[1] * 0.33;
			double yr = Math.toRadians(e.getYRot()), fx = -Math.sin(yr), fz = Math.cos(yr);
			BlockPos below = e.blockPosition().below();
			BlockState st = mc.level.getBlockState(below), feet = mc.level.getBlockState(e.blockPosition());
			String id = BuiltInRegistries.BLOCK.getKey(feet.getBlock()).getPath().equals("snow") ? "snow" : BuiltInRegistries.BLOCK.getKey(st.getBlock()).getPath();
			Surface.Effect fxe = Surface.effect(id);
			if (fxe == null) continue;
			boolean snow = id.equals("snow");
			for (int side = -1; side <= 1; side += 2) {
				double px = e.getX() - fx * back + (-fz) * halfW * side, pz = e.getZ() - fz * back + fx * halfW * side;
				double dx = -fx * v * 0.4 + (java.util.concurrent.ThreadLocalRandom.current().nextDouble() - 0.5) * 0.06, dz = -fz * v * 0.4 + (java.util.concurrent.ThreadLocalRandom.current().nextDouble() - 0.5) * 0.06;
				if (snow) {
					mc.level.addParticle(ParticleTypes.CLOUD, px, e.getY() + 0.15, pz, dx, 0.05, dz);
					mc.level.addParticle(ParticleTypes.SNOWFLAKE, px, e.getY() + 0.2, pz, dx, 0.08, dz);
				} else {
					BlockState src = feet.isAir() ? st : st;
					int n = id.contains("sand") ? 3 : 2;
					for (int i = 0; i < n; i++)
						mc.level.addParticle(new BlockParticleOption(ParticleTypes.BLOCK, src), px, e.getY() + 0.1, pz, dx, 0.12 + java.util.concurrent.ThreadLocalRandom.current().nextDouble() * 0.1, dz);
					if (id.contains("sand") || id.equals("dirt") || id.equals("coarse_dirt")) mc.level.addParticle(ParticleTypes.CAMPFIRE_COSY_SMOKE, px, e.getY() + 0.2, pz, dx * 0.5, 0.02, dz * 0.5);
				}
			}
		}
	}
}
