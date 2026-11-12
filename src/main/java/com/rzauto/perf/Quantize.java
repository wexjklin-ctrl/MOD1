package com.rzauto.perf;

/**
 * Сжатие состояния для сети: вместо 4 double (32 байта) — 4 short (8 байт). Ошибка: скорость/боковая ±0.0005 бл/тик
 * (≈0.04 км/ч), угол ±0.0055°, руль ±0.0005. Клиент интерполирует между пакетами.
 */
public final class Quantize {
	public static final double SPEED_SCALE = 1000;       // short: ±32.7 бл/тик, с запасом (макс. ≈3)
	public static final double STEER_SCALE = 10000;

	public static short speed(double v) { return (short) Math.max(-32767, Math.min(32767, Math.round(v * SPEED_SCALE))); }
	public static double speed(short q) { return q / SPEED_SCALE; }
	public static short steer(double v) { return (short) Math.round(Math.max(-1, Math.min(1, v)) * STEER_SCALE); }
	public static double steer(short q) { return q / STEER_SCALE; }
	/** Угол −180…180° → 0…65535 по кругу. */
	public static short yaw(double deg) {
		double d = deg % 360; if (d < 0) d += 360;
		return (short) (Math.round(d / 360.0 * 65536.0) & 0xFFFF);
	}
	public static double yaw(short q) {
		double d = (q & 0xFFFF) / 65536.0 * 360.0;
		return d > 180 ? d - 360 : d;
	}
}
