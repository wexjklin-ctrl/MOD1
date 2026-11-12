package com.rzauto.logic;

/** vehicle_gears.js: 6 передач (10/28/46/64/82/100 % мощности) + 7-я у части моделей. */
public final class Gears {
	public static final int COUNT = 6, GEAR7 = 7;
	public static final double[] POWER_PCT = {10, 28, 46, 64, 82, 100};
	/** Допустимые значения меню «Скорость» вне режима передач. */
	public static final int[] SPEED_LEVELS = {10, 30, 50, 70, 100};
	public static final int DEFAULT_SPEED_PERCENT = 100;

	/** Максимальная передача, на которую сейчас можно переключиться. */
	public static int maxGear(VehicleSpec s, boolean gear7Locked) {
		return s.hasGear7() && !gear7Locked ? GEAR7 : COUNT;
	}

	public static int normalize(VehicleSpec s, int gear) {
		if (gear < 1) return 1;
		if (gear > COUNT) return gear == GEAR7 && s.hasGear7() ? GEAR7 : COUNT;
		return gear;
	}

	/** Мощность в % от top_speed (7-я может быть выше 100%). */
	public static double power(VehicleSpec s, int gear) {
		gear = normalize(s, gear);
		if (gear == GEAR7) return s.gear7Speed() / s.topSpeed() * 100.0;
		return POWER_PCT[gear - 1];
	}

	/** Сколько тиков держится 7-я (gear7_left при включении). */
	public static int gear7Ticks(VehicleSpec s) { return (int) Math.round(s.gear7Seconds() * 20); }

	public static double fuelMult(VehicleSpec s, int gear, boolean gearMode) { return (gearMode && gear == GEAR7 && s.hasGear7()) ? s.gear7FuelMult() : 1.0; }
	public static double wearMult(VehicleSpec s, int gear, boolean gearMode) { return (gearMode && gear == GEAR7 && s.hasGear7()) ? s.gear7WearMult() : 1.0; }
}
