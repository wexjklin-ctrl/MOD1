package com.rzauto.perf;

/**
 * Регулятор нагрузки. Меряет время, которое мод тратит за тик, и усреднённый MSPT сервера; при перегрузке
 * отключает ТОЛЬКО второстепенное. Физика едущих машин не деградирует никогда (иначе рассинхрон и телепорты).
 * Уровни: 0 норма; 1 лёгкая экономия; 2 сильная; 3 аварийная. Вход/выход с гистерезисом, чтобы не мигало.
 */
public final class Governor {
	private static final double[] ENTER = {0, 35, 42, 48};   // MSPT (бюджет тика 50 мс)
	private static final double[] EXIT  = {0, 30, 38, 44};
	private static final double EMA = 0.1;
	private double msptEma;
	private int level;

	/** Вызывать раз в тик с MSPT сервера (из API сервера: averageTickTime / tickTimes). */
	public void update(double msptThisTick) {
		msptEma = msptEma == 0 ? msptThisTick : msptEma + (msptThisTick - msptEma) * EMA;
		while (level < 3 && msptEma > ENTER[level + 1]) level++;
		while (level > 0 && msptEma < EXIT[level]) level--;
	}
	public int level() { return level; }
	public double msptEma() { return msptEma; }

	/** Интервал сетевой синхронизации едущей машины, тиков. */
	public int syncInterval() { return new int[]{2, 3, 4, 6}[level]; }
	/** Интервал обновления спидометра. */
	public int speedoInterval() { return new int[]{4, 6, 10, 20}[level]; }
	/** Интервал DriveGate/износа/топлива (оригинал: 5). */
	public int logicInterval() { return new int[]{5, 5, 10, 10}[level]; }
	/** Пыль и дым от колёс (сервер шлёт частицы только близким игрокам; на 2+ уровне — выключено). */
	public boolean particlesAllowed() { return level < 2; }
	/** Радиус рассылки частиц/звука в блоках. */
	public int effectRadius() { return new int[]{48, 32, 16, 0}[level]; }
	/** Кулдаун поиска поверхности под колёсами (тиков), если блок под машиной не менялся — кэш всегда. */
	public boolean allowGearScan() { return level < 3; }
}
