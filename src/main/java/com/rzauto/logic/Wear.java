package com.rzauto.logic;

import java.util.Random;

/** main.js trackMileage: пороги пробега и шанс поломки. checkedIndex стартует с -1; сброс при замене шестерни. */
public final class Wear {
	public static final int[] THRESHOLDS = {1000, 10000, 20000, 50000, 100000};

	public static final class Result {
		public double mileage;
		public int checkedIndex = -1;
		public boolean broken;
	}

	/** Прибавляет dist*gearWearMult к пробегу и проверяет пересечённые пороги (как в оригинале, поломка прерывает цикл). */
	public static void track(VehicleSpec s, Result r, double dist, double gearWearMult, Random rnd) {
		if (r.broken) return;
		r.mileage += dist * gearWearMult;
		int checked = r.checkedIndex;
		for (int i = checked + 1; i < THRESHOLDS.length; i++) {
			if (r.mileage < THRESHOLDS[i]) break;
			checked = i;
			int chance = i < s.breakdownChancesPct().length ? s.breakdownChancesPct()[i] : 0;
			if (chance > 0 && rnd.nextDouble() * 100 < chance) { r.broken = true; break; }
		}
		r.checkedIndex = checked;
	}

	/** Замена шестерни: ремонт, пробег 0, 7-ю передачу можно вернуть. */
	public static void replaceGear(Result r) { r.mileage = 0; r.checkedIndex = -1; r.broken = false; }
}
