package com.rzauto.logic;

/** main.js, интервал 5 тиков: условия, при которых водитель может ехать, и сообщение в action bar, если нет. Порядок проверок как в оригинале. */
public enum DriveGate {
	OK(null),
	NOT_OWNER("§eВ этой машине рулить может только владелец."),
	BROKEN("§cМашина сломана! Почините шестерёнкой: ПКМ по машине с шестерёнкой в руке или кнопка в меню (I)."),
	NO_LICENSE("§eБез водительских прав в одной из рук машина не поедет!"),
	ENGINE_OFF("§eДвигатель заглушен. Заведите его: меню (ПКМ правами) → Взаимодействия → Завести двигатель."),
	NO_FUEL("§cБак пуст! Заправьте машину ведром лавы (ПКМ правами в руке).");

	public static final String OUT_OF_FUEL_MSG = "§cТопливо закончилось! Заправьте машину ведром лавы (ПКМ правами в руке).";
	public final String message;
	DriveGate(String m) { message = m; }

	/** Только при OK машина едет (аналог engineOk / applySpeed). */
	public boolean canDrive() { return this == OK; }

	public static DriveGate check(VehicleState v, boolean driverIsOwner, boolean holdingLicense) {
		if (v.lock == Access.Lock.PASSENGERS && !driverIsOwner) return NOT_OWNER;
		if (v.wear.broken) return BROKEN;
		if (!holdingLicense) return NO_LICENSE;
		if (!v.engineOn) return ENGINE_OFF;
		if (!(v.fuel > 0)) return NO_FUEL;
		return OK;
	}
}
