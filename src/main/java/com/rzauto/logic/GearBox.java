package com.rzauto.logic;

/** vehicle_gears.js: режим передач и 7-я передача (состояние на машине). Тексты HUD — как в оригинале. */
public final class GearBox {
	public static final int INPUT_JUMP = 0, INPUT_HOTBAR = 1;
	public static final int HOLD_TICKS = 10, HOTBAR_SLOTS = 9, HUD_TICKS = 40;
	public static final String[] INPUT_LABELS = {
		"Прыжок (пробел / A): нажатие - выше, удержание - ниже", "Хотбар (колесо мыши / RB / LB)"};

	public boolean mode;                 // gear_mode
	public boolean jumpLock = true;      // gear_jump_lock (по умолчанию вкл)
	public boolean gear7Locked;          // gear7_locked
	public int gear7Left;                // gear7_left, тиков
	private int gear = 1;                // gear (сырое)
	private int input = INPUT_JUMP;      // gear_input

	public int input() { return input; }
	public void setInput(int v) { input = v == INPUT_HOTBAR ? INPUT_HOTBAR : INPUT_JUMP; }
	public int rawGear() { return gear; }
	public void setGear(int g) { gear = Math.min(Math.max(g, 1), Gears.GEAR7); }
	public int gear(VehicleSpec s) { return Gears.normalize(s, gear); }
	public int total(VehicleSpec s) { return s.hasGear7() ? Gears.GEAR7 : Gears.COUNT; }
	public int maxGear(VehicleSpec s) { return Gears.maxGear(s, gear7Locked); }
	public boolean gear7Active(VehicleSpec s) { return mode && gear(s) == Gears.GEAR7; }
	public double power(VehicleSpec s) { return Gears.power(s, gear(s)); }
	public double fuelMult(VehicleSpec s) { return Gears.fuelMult(s, gear(s), mode); }
	public double wearMult(VehicleSpec s) { return Gears.wearMult(s, gear(s), mode); }

	/** Тратим 7-ю: на 6-ю и блокировка до ремонта. Возвращает текст для водителя (или null). */
	public String exitGear7(String message) {
		if (gear == Gears.GEAR7) gear = Gears.COUNT;
		gear7Left = 0;
		gear7Locked = true;
		return message;
	}
	/** Замена шестерни после реальной поломки возвращает 7-ю. */
	public void unlockGear7() { gear7Locked = false; }

	/** Таймер 7-й; каждый тик. Возвращает сообщение водителю, если 7-я закончилась. */
	public String tick7(VehicleSpec s, boolean hasRider) {
		if (gear != Gears.GEAR7) return null;
		if (!s.hasGear7() || !mode) { exitGear7(null); return null; }
		if (!hasRider) return null;
		if (gear7Left <= 0) return exitGear7("§e7-я передача закончилась: 6-я. Вернётся после замены шестерни после поломки.");
		gear7Left--;
		return null;
	}

	public String text(VehicleSpec s, String extra) {
		int g = gear(s), pw = (int) Math.round(power(s));
		if (g == Gears.GEAR7) return "§6Передача §f7§7/" + Gears.GEAR7 + "  §6Мощность §f" + pw + "%  §eосталось " + (int) Math.ceil(gear7Left / 20.0) + " с" + extra;
		return "§bПередача §f" + g + "§7/" + total(s) + "  §bМощность §f" + pw + "%" + extra;
	}

	/** Результат сдвига: текст для HUD и признак, что передача реально сменилась (тогда пересчитать лимит скорости). */
	public record Shift(String hud, boolean changed) {}

	public Shift shift(VehicleSpec s, int dir) {
		int before = gear(s), after = Math.min(Math.max(before + dir, 1), maxGear(s));
		if (before == Gears.GEAR7 && after < before)
			return new Shift(exitGear7("§e7-я передача потрачена. Вернётся после замены шестерни после поломки."), true);
		if (after != before) {
			setGear(after);
			if (after == Gears.GEAR7) gear7Left = (int) Math.round(s.gear7Seconds() * 20);
			return new Shift(text(s, ""), true);
		}
		String note = dir > 0 ? " §7(максимальная)" : " §7(минимальная)";
		if (dir > 0 && before == Gears.COUNT && s.hasGear7() && gear7Locked) note = " §c(7-я заблокирована: нужна поломка и замена шестерни)";
		return new Shift(text(s, note), false);
	}

	/** Кратчайшая разница слотов хотбара по кругу из 9: −4…+4. */
	public static int hotbarDelta(int cur, int anchor) { return ((cur - anchor + HOTBAR_SLOTS + 4) % HOTBAR_SLOTS) - 4; }

	/** Лимит скорости, который задаёт режим передач (иначе — speed_percent). */
	public double speedPercent(VehicleSpec s, int menuPercent) { return mode ? power(s) : menuPercent; }
}
