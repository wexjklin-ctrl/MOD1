package com.rzauto.logic;

/**
 * Ввод переключения передач одного водителя (gearTick из vehicle_gears.js). Состояние на игрока.
 * Кнопка Jump: короткое нажатие — выше, удержание ≥10 тиков — ниже. Хотбар: щелчок слота ±.
 * Вызывать ТОЛЬКО на клиенте водителя; на сервер уходит готовое «сдвиг ±1» (экономия трафика).
 */
public final class GearDriver {
	private int anchor;
	private long lastTick = Long.MIN_VALUE / 2, hudUntil;
	private boolean down, longFired, tap, started;
	private long downAt;

	/** Результат опроса за тик. */
	public static final class Out {
		public int shift;          // +1 / −1 / 0
		public String hud;         // текст в action bar или null
		public boolean lockJump;   // запретить прыжок водителю (в режиме Jump и jumpLock)
		public int restoreSlot = -1; // вернуть выбранный слот хотбара сюда (если ≥0)
		void reset() { shift = 0; hud = null; restoreSlot = -1; }
	}

	public void onJump(boolean pressed, long tick) {
		if (pressed) { down = true; downAt = tick; longFired = false; }
		else { if (down && !longFired) tap = true; down = false; }
	}

	public void tick(GearBox g, VehicleSpec s, int selectedSlot, long now, Out out) {
		out.reset();
		if (!g.mode) { started = false; lastTick = Long.MIN_VALUE / 2; return; }
		boolean jumpInput = g.input() == GearBox.INPUT_JUMP;
		out.lockJump = jumpInput && g.jumpLock;

		if (!started || now - lastTick > 10) {   // новая поездка
			started = true; anchor = selectedSlot; lastTick = now; hudUntil = now + GearBox.HUD_TICKS;
			tap = false; longFired = down;       // прыжки до посадки не считаются
			out.hud = g.text(s, "");
			return;
		}
		lastTick = now;

		if (jumpInput) {
			if (tap) { tap = false; apply(g, s, +1, now, out); }
			else if (down && !longFired && now - downAt >= GearBox.HOLD_TICKS) { longFired = true; apply(g, s, -1, now, out); }
			anchor = selectedSlot;
			if (out.hud == null && now < hudUntil) out.hud = g.text(s, "");
			return;
		}
		if (selectedSlot == anchor) { if (now < hudUntil) out.hud = g.text(s, ""); return; }
		int dir = Integer.signum(GearBox.hotbarDelta(selectedSlot, anchor));
		out.restoreSlot = anchor;               // предмет в руке (права) не должен меняться
		if (dir != 0) apply(g, s, dir, now, out);
	}

	private void apply(GearBox g, VehicleSpec s, int dir, long now, Out out) {
		GearBox.Shift r = g.shift(s, dir);
		hudUntil = now + GearBox.HUD_TICKS;
		out.hud = r.hud();
		out.shift = r.changed() ? dir : 0;
	}
}
