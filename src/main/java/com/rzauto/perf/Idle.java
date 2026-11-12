package com.rzauto.perf;

import com.rzauto.logic.Physics;

/** Когда машину можно убрать из ActiveSet (перестать тикать) и когда разбудить. */
public final class Idle {
	public static final double STOP_EPS = 1e-3;

	/** Пустая, на земле, остановилась (скорость и занос ~0) — спит. С водителем или в воздухе не спит никогда. */
	public static boolean canSleep(Physics.State st, boolean hasRider, boolean onGround) {
		return !hasRider && onGround && Math.abs(st.speed) < STOP_EPS && Math.abs(st.lat) < STOP_EPS;
	}

	/** Выбег пустой машины без полной физики: тот же шаг торможения двигателем, что в Physics.tick при нулевом вводе. */
	public static void coast(Physics.State st, double brakeSpeedPerSecond) {
		st.speed = Physics.stepTowards(st.speed, 0, brakeSpeedPerSecond / 20.0);
		st.lat = Physics.stepTowards(st.lat, 0, brakeSpeedPerSecond / 20.0);
		if (Math.abs(st.speed) < STOP_EPS && Math.abs(st.lat) < STOP_EPS) { st.speed = 0; st.lat = 0; }
	}
}
