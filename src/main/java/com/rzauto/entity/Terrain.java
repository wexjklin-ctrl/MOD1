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
			VoxelShape sh = level.getBlockState(mp).getCollisionShape(level, mp);
			if (sh.isEmpty()) continue;
			double h = by + sh.max(Direction.Axis.Y);
			if (h <= y + 1.2) return h;
		}
		return Double.NaN;
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
