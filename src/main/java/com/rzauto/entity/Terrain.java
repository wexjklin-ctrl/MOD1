package com.rzauto.entity;

import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.util.Mth;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.shapes.VoxelShape;

/** Рельеф под осями машины: нужен и серверу, и клиенту, чтобы сиденья шли вместе с наклонённым кузовом. */
public final class Terrain {
	private Terrain() {}

	public static double ground(Level level, double x, double y, double z) {
		int bx = Mth.floor(x), bz = Mth.floor(z), top = Mth.floor(y + 1.2);
		BlockPos.MutableBlockPos mp = new BlockPos.MutableBlockPos();
		for (int by = top; by >= top - 4; by--) {
			mp.set(bx, by, bz);
			if (level.getBlockState(mp).is(net.minecraft.tags.BlockTags.LEAVES)) continue;
			VoxelShape sh = level.getBlockState(mp).getCollisionShape(level, mp);
			if (sh.isEmpty()) continue;
			double h = by + sh.max(Direction.Axis.Y);
			if (h <= y + 1.2) return h;
		}
		return Double.NaN;
	}

	/**
	 * Блок, на котором реально стоит сущность. На плите/полублоке (дорога из полублоков) blockPosition().below() давало траву под дорогой,
	 * поэтому берём getOnPos() (учитывает высоту опоры), пропускаем воздух, листву и блоки без коллизии; слой снега в ногах считается покрытием.
	 */
	public static BlockPos supportPos(Level level, net.minecraft.world.entity.Entity e) {
		BlockPos feet = e.blockPosition();
		if (level.getBlockState(feet).is(net.minecraft.world.level.block.Blocks.SNOW)) return feet;
		BlockPos p = e.getOnPos();
		for (int i = 0; i < 3; i++) {
			var st = level.getBlockState(p);
			if (!st.isAir() && !st.is(net.minecraft.tags.BlockTags.LEAVES) && !st.getCollisionShape(level, p).isEmpty()) return p;
			p = p.below();
		}
		return e.getOnPos();
	}

	/** Путь id блока опоры без пространства имён (например «grass_block», «smooth_stone_slab»). */
	public static String supportId(Level level, net.minecraft.world.entity.Entity e) {
		return net.minecraft.core.registries.BuiltInRegistries.BLOCK.getKey(level.getBlockState(supportPos(level, e)).getBlock()).getPath();
	}

	/** {тангаж в градусах (+ = нос вниз), смещение кузова вниз (<= 0)}. */
	public static float[] pitchAndDy(Level level, double x, double y, double z, float yaw, double halfL) {
		double yr = Math.toRadians(yaw), fx = -Math.sin(yr), fz = Math.cos(yr);
		double hf = ground(level, x + fx * halfL, y, z + fz * halfL), hr = ground(level, x - fx * halfL, y, z - fz * halfL);
		if (Double.isNaN(hf)) hf = y;
		if (Double.isNaN(hr)) hr = y;
		float p = (float) -Math.toDegrees(Math.atan2(hf - hr, 2 * halfL));
		return new float[] { Mth.clamp(p, -32f, 32f), (float) Mth.clamp((hf + hr) / 2 - y, -1.0, 0.0) };
	}
}
