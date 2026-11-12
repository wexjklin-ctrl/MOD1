package com.rzauto.logic;

/** vehicle_speedo.js: текст спидометра. Скорость берётся из реального движения (1 блок = 1 м). */
public final class Speedo {
	public record Unit(String label, String suffix) {}
	public static final Unit[] UNITS = {
		new Unit("Километры в час (км/ч)", "км/ч"),
		new Unit("Блоки в секунду (бл/с)", "бл/с"),
		new Unit("Единицы скорости (ед.)", "ед."),
	};
	public static final double RED_FRACTION = 0.98;

	/**
	 * @param vx,vz   фактическая скорость сущности (блоков/тик)
	 * @param speed   внутренняя скорость физики (со знаком)
	 * @param maxSpeed текущий предел в направлении движения
	 * @return строка с цветовыми кодами § (как в оригинале; в Java Edition они тоже работают в Component.literal)
	 */
	public static String text(int unit, double vx, double vz, double speed, double maxSpeed) {
		if (unit < 0 || unit >= UNITS.length) unit = 0;
		double bps = Math.hypot(vx, vz) * 20;
		String value = switch (unit) {
			case 0 -> Long.toString(Math.round(bps * 3.6));
			case 1 -> String.format(java.util.Locale.ROOT, "%.1f", bps);
			default -> String.format(java.util.Locale.ROOT, "%.2f", Math.abs(speed));
		};
		boolean atMax = maxSpeed > 0 && Math.abs(speed) >= maxSpeed * RED_FRACTION;
		return (atMax ? "§c" : "§f") + value + " " + (atMax ? "" : "§7") + UNITS[unit].suffix();
	}
}
