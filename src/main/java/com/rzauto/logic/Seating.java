package com.rzauto.logic;

import java.util.ArrayList;
import java.util.List;

/**
 * Порядок посадки. В Bedrock место определялось порядком riders (первый = водитель). В Java у пассажиров явные
 * сиденья, но правило «руль только у владельца» (lock = PASSENGERS) переносится тем же порядком.
 */
public final class Seating {
	/** Нужна ли пересадка: чужой первый, владелец сидит дальше (main.js, интервал 10 тиков, кулдаун 40). */
	public static boolean needsOwnerToWheel(Access.Lock lock, String owner, List<String> riders) {
		if (lock != Access.Lock.PASSENGERS || owner == null || riders.size() < 2) return false;
		return !owner.equals(riders.get(0)) && riders.contains(owner);
	}

	/** Новый порядок: владелец первым, остальные в прежнем порядке. */
	public static List<String> ownerFirst(String owner, List<String> riders) {
		List<String> out = new ArrayList<>();
		out.add(owner);
		for (String r : riders) if (!r.equals(owner)) out.add(r);
		return out;
	}
}
