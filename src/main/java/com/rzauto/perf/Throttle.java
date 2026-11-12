package com.rzauto.perf;

/** Периодические задачи (DriveGate, износ, пересадка, спидометр) со сдвигом фазы по id: нагрузка размазывается по тикам, а не бьёт пиком. */
public final class Throttle {
	public static boolean due(long tick, int id, int interval) {
		if (interval <= 1) return true;
		return Math.floorMod(tick + id, (long) interval) == 0;
	}
}
