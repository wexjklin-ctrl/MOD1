package com.rzauto.logic;

/** Регенерация HP машины: раз в 20 тиков +0.25 HP * power (×1…×4), см. REGEN_PROFILES в main.js. */
public final class Regen {
	public static final double BASE_HP_PER_SECOND = 0.25;
	public static final int INTERVAL_TICKS = 20;
	public static double heal(double hp, double maxHp, double power) { return Math.min(maxHp, hp + BASE_HP_PER_SECOND * power); }

	private static final Object[][] TABLE = {
		{"maybach:", 2},
		{"bmw:e46", 1},
		{"bmw:m3", 1},
		{"bmw:f30", 1},
		{"bmw:f31", 1},
		{"ford:", 4},
		{"jeep:yj", 1},
		{"jeep:xj", 1},
		{"toyota:", 1},
		{"lamborghini:", 1},
		{"f458:", 1},
		{"laf:", 1},
		{"chevrolet:", 1},
		{"porsche:", 1},
		{"ducati:", 1},
		{"ktm:", 1},
		{"yamaha:", 1},
		{"koenigsegg:", 1},
		{"mcl:", 1},
		{"p911t:", 1},
		{"ferrari:", 1}
	};
	/** REGEN_PROFILES: первое совпадение префикса; 0 — модель без регенерации. */
	public static int power(String bedrockId) {
		for (Object[] r : TABLE) if (bedrockId.startsWith((String) r[0])) return ((Integer) r[1]);
		return 0;
	}
}
