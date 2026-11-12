package com.rzauto.perf;

import com.rzauto.logic.Surface;

/** Покрытие под машиной: блок читается из мира ТОЛЬКО когда машина сменила блок (за тик это бывает редко). Один экземпляр на машину. */
public final class SurfaceCache {
	public interface BlockIdLookup { String idAt(int x, int y, int z); }
	private long key = Long.MIN_VALUE;
	private Surface.Effect value;
	public int lookups;     // для статистики/тестов

	private static long pack(int x, int y, int z) {
		return ((long) (x & 0x3FFFFFF) << 38) | ((long) (z & 0x3FFFFFF) << 12) | (y & 0xFFF);
	}
	public static final int REVALIDATE_TICKS = 20;   // блок под стоящей машиной могли заменить
	private long checkedAt = Long.MIN_VALUE / 2;

	public Surface.Effect get(long tick, int bx, int by, int bz, BlockIdLookup world) {
		long k = pack(bx, by, bz);
		if (k != key || tick - checkedAt >= REVALIDATE_TICKS) { key = k; checkedAt = tick; value = Surface.effect(world.idAt(bx, by, bz)); lookups++; }
		return value;
	}
	/** Блок мог измениться (игрок поставил/сломал) — сбросить кэш. */
	public void invalidate() { key = Long.MIN_VALUE; }
}
