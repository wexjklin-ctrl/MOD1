package com.rzauto.logic;

/** main.js: замок машины (lock_state) и правила посадки/руля. Имена игроков сравниваются как в оригинале. */
public final class Access {
	public enum Lock {
		OPEN("open"), PASSENGERS("passengers"), LOCKED("locked"), SEALED("sealed");
		public final String key;
		Lock(String key) { this.key = key; }
		/** getLockState: неизвестное значение → open; старое булево locked=true → locked. */
		public static Lock parse(String s, boolean legacyLocked) {
			for (Lock l : values()) if (l.key.equals(s)) return l;
			return legacyLocked ? LOCKED : OPEN;
		}
	}

	public enum Entry { ALLOW, DENY_SEALED, DENY_DRIVER_ONLY_OWNER, DENY_LOCKED }

	/**
	 * Может ли игрок сесть (playerInteractWithEntity без приседания).
	 * @param ownerAtWheel сидит ли владелец на месте водителя (первый в списке riders)
	 */
	public static Entry canEnter(Lock lock, String owner, String player, boolean ownerAtWheel) {
		switch (lock) {
			case OPEN: return Entry.ALLOW;
			case SEALED: return Entry.DENY_SEALED;
			case PASSENGERS:
				if (owner == null || owner.equals(player)) return Entry.ALLOW;
				return ownerAtWheel ? Entry.ALLOW : Entry.DENY_DRIVER_ONLY_OWNER;
			default: // LOCKED
				return (owner == null || owner.equals(player)) ? Entry.ALLOW : Entry.DENY_LOCKED;
		}
	}

	public enum Sneak { CLAIM_AND_OPEN_MENU, OPEN_MENU, DENY_NOT_OWNER }

	/** Приседание + клик: первый получает владение, дальше меню только у владельца. */
	public static Sneak onSneakInteract(String owner, String player) {
		if (owner == null) return Sneak.CLAIM_AND_OPEN_MENU;
		return owner.equals(player) ? Sneak.OPEN_MENU : Sneak.DENY_NOT_OWNER;
	}

	/** Идентификатор для сообщений: «Владелец: …» (— если не задан). */
	public static String ownerLabel(String owner) { return owner == null ? "—" : owner; }
}
