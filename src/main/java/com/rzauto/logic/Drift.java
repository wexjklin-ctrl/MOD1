package com.rzauto.logic;

/** vehicle_drift.js: занос/инерция. Скорость = продольная (speed) + боковая (lat, gv_lat). */
public final class Drift {
	public static final double GRIP_LIMIT = 0.10, SLIDE_GRIP_RATIO = 0.65, SLIDE_SPEED_DRAG = 0.012;
	public static final double ALIGN_GAIN = 0.05, ALIGN_MAX_ANGLE_DEG = 70, ALIGN_SPEED_FRACTION = 0.3;

	/**
	 * Один тик заноса после расчёта педалей и руля. Входные speed/lat/yaw берутся из st (speed — продольная ДО поворота),
	 * результат записывается обратно в st (speed, lat, yawDeg, sliding).
	 */
	public static void step(Physics.State st, double yawOldDeg, double referenceMax, double gripScale) {
		double speed = st.speed, lat = st.lat, yawTotal = st.yawDeg;
		if (speed > 0.02) {
			double slipDeg = Physics.clamp(Math.toDegrees(Math.atan2(lat, speed)), -ALIGN_MAX_ANGLE_DEG, ALIGN_MAX_ANGLE_DEG);
			double v = Math.hypot(speed, lat);
			double ref = referenceMax > 0 ? referenceMax : 1;
			double alignScale = Physics.clamp(v / (ref * ALIGN_SPEED_FRACTION), 0, 1);
			yawTotal = Physics.normalizeAngle(st.yawDeg - slipDeg * ALIGN_GAIN * alignScale);
		}
		double delta = Math.toRadians(Physics.normalizeAngle(yawTotal - yawOldDeg));
		double cos = Math.cos(delta), sin = Math.sin(delta);
		double longV = speed * cos - lat * sin;
		double latV = speed * sin + lat * cos;

		double limit = GRIP_LIMIT * Physics.clamp(gripScale, 0.05, 1);
		boolean sliding = false;
		if (Math.abs(latV) <= limit) {
			latV = 0;
		} else {
			sliding = true;
			latV -= Math.signum(latV) * limit * SLIDE_GRIP_RATIO;
			longV -= longV * SLIDE_SPEED_DRAG * Physics.clamp(Math.abs(latV) / (limit * 3), 0.3, 1);
		}
		st.speed = longV; st.lat = latV; st.yawDeg = yawTotal; st.sliding = sliding;
	}

	/** Множитель сцепления: поверхность (песок/грязь 0.7, иммунные 0.85, снег 0.55) и торможение (−35% * сила). */
	public static double gripScale(VehicleSpec s, Surface.Effect surface, double pedal, double speed) {
		double g = 1;
		if (surface != null) g = surface.reducesSpeed() ? (s.offroadExempt() ? 0.85 : 0.7) : 0.55;
		double brake = (pedal < 0 && speed > 0.05) ? Math.abs(pedal) : 0;
		return g * (1 - 0.35 * brake);
	}
}
