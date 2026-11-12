package com.rzauto.logic;

/** Плоское описание машины из data/vehicles.json (только то, что нужно логике). */
public record VehicleSpec(
		String bedrockId, String familyPrefix, boolean motorcycle,
		double topSpeed, double accel,
		double fuelMult, double maxFuel, double fuelPerBucket,
		int[] breakdownChancesPct, double gear7Speed, double gear7Seconds,
		double gear7FuelMult, double gear7WearMult, double stepHeight, int health) {

	/** 7-я передача есть не у всех машин (gear7Speed == 0 → нет). */
	public boolean hasGear7() { return gear7Speed > 0; }

	public String javaId() {
		return "rz_auto:" + bedrockId.replace(':', '_');
	}

	/** Бездорожье: штраф -70% на песке/грязи/земле/дёрне/моху, кроме этих семейств. */
	public boolean offroadExempt() {
		return bedrockId.startsWith("jeep:yj") || bedrockId.startsWith("jeep:xj") || bedrockId.startsWith("ford:");
	}
}
