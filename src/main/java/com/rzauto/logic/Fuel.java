package com.rzauto.logic;

/** Топливо в «блоках хода». Бак изначально ПУСТ (DEFAULT_FUEL = 0). */
public final class Fuel {
	public static final double DEFAULT_FUEL = 0;
	public static final double TANK_LITERS = 150, BUCKET_LITERS = 10, LITERS_PER_BLOCK = 0.01;
	public static final double MAX_COUNTED_DIST = 50; // скачки >= 50 блоков (телепорт) не считаются

	public static double addBucket(VehicleSpec s, double fuel) { return Math.min(s.maxFuel(), fuel + s.fuelPerBucket()); }

	/** Новое значение бака после проезда dist блоков; gearFuelMult = Gears.fuelMult(...). */
	public static double consume(VehicleSpec s, double fuel, double dist, double gearFuelMult) {
		if (!(dist > 0 && dist < MAX_COUNTED_DIST)) return fuel;
		return Math.max(0, Math.min(s.maxFuel(), fuel - dist * s.fuelMult() * gearFuelMult));
	}
}
