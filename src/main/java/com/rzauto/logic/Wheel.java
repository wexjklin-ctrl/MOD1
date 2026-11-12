package com.rzauto.logic;

/** vehicle_wheel.js: «Режим руля» — аналоговый руль и педали (x360ce → левый стик). Перенос 1-в-1. */
public final class Wheel {
	public static final double SENS_MIN = 0.25, SENS_MAX = 5, SENS_STEP = 0.25, SENS_DEFAULT = 1;
	/** Кривые руля: Резкая 0.7, Линейная 1, Мягкая 1.5, Очень мягкая 2. */
	public static final String[] CURVE_LABELS = {"Резкая", "Линейная", "Мягкая", "Очень мягкая"};
	public static final double[] CURVE_GAMMA = {0.7, 1, 1.5, 2};
	public static final int CURVE_DEFAULT = 1;

	static final double STEER_DEADZONE = 0.03, PEDAL_DEADZONE = 0.05;
	static final double FULL_STEER_SPEED_FRACTION = 0.25, MIN_BRAKE_AMOUNT = 0.15;
	static final double SIM_WHEEL_FOLLOW = 0.5, SIM_LOCK_LOSS = 0.4, SIM_YAW_FOLLOW = 0.35;

	/** Настройки на машине (wheel_sens, wheel_curve, wheel_compensate, wheel_sim, drift_mode). */
	public record Settings(double sens, int curveIndex, boolean compensate, boolean sim, boolean drift) {
		public static Settings defaults() { return new Settings(SENS_DEFAULT, CURVE_DEFAULT, false, false, false); }
	}

	/** steer: -1..1 после мёртвой зоны и кривой; pedal: -1..1 газ(+)/тормоз-назад(−). */
	public record WheelInput(double steer, double pedal) {}

	static double applyDeadzone(double value, double dz) {
		double a = Math.abs(value);
		if (a <= dz) return 0;
		return Math.signum(value) * Math.min((a - dz) / (1 - dz), 1);
	}

	public static WheelInput readInput(Settings cfg, double x, double y) {
		if (cfg.compensate()) {
			double m = Math.max(Math.abs(x), Math.abs(y));
			if (m > 0 && Math.hypot(x, y) > 0.98) { x /= m; y /= m; }
		}
		double gamma = CURVE_GAMMA[cfg.curveIndex() >= 0 && cfg.curveIndex() < CURVE_GAMMA.length ? cfg.curveIndex() : CURVE_DEFAULT];
		double s = applyDeadzone(x, STEER_DEADZONE);
		double steer = Math.signum(s) * Math.pow(Math.abs(s), gamma);
		return new WheelInput(steer, applyDeadzone(y, PEDAL_DEADZONE));
	}

	/** Вес руля + зажим угла на скорости. Меняет st.wheelPos. */
	public static double simulateSteer(Physics.State st, double target, double speed, double referenceMax) {
		double pos = st.wheelPos + (target - st.wheelPos) * SIM_WHEEL_FOLLOW;
		if (Math.abs(pos) < 0.001) pos = 0;
		st.wheelPos = pos;
		double frac = referenceMax > 0 ? Physics.clamp(Math.abs(speed) / referenceMax, 0, 1) : 0;
		return pos * (1 - SIM_LOCK_LOSS * Math.pow(frac, 1.5));
	}

	/** Инерция рыскания: step — желаемый поворот кузова за тик (градусы). Меняет st.yawRate. */
	public static double simulateYawStep(Physics.State st, double step) {
		double rate = st.yawRate + (step - st.yawRate) * SIM_YAW_FOLLOW;
		if (Math.abs(rate) < 0.001) rate = 0;
		st.yawRate = rate;
		return rate;
	}

	/**
	 * wheelDrive: новые speed/yaw. Радиус поворота привязан к ПАСПОРТНОЙ скорости (referenceMax), а не к текущему пределу.
	 * @param steerSpeed полная скорость для силы поворота (в заносе hypot(speed, lat)), или NaN → |speed|
	 */
	public static void drive(VehicleSpec s, Physics.State st, WheelInput in, Settings cfg,
			double effMax, double referenceMax, double steerSpeed) {
		Physics.Params p = Physics.Params.of(s);
		double speed = st.speed;

		double fullSteerSpeed = (referenceMax > 0 ? referenceMax : effMax) * FULL_STEER_SPEED_FRACTION;
		double sp = Double.isNaN(steerSpeed) ? Math.abs(speed) : steerSpeed;
		double speedFactor = fullSteerSpeed > 0 ? Physics.clamp(sp / fullSteerSpeed, 0, 1) : 0;
		double turnFactor = -Math.signum(speed) * speedFactor;
		double rotationStepDeg = (p.rotationSpeed() / 20.0) * in.steer() * turnFactor * cfg.sens();
		st.yawDeg = Physics.normalizeAngle(st.yawDeg + rotationStepDeg);

		double dir = Math.signum(in.pedal()), amount = Math.abs(in.pedal()), ns = speed;
		if (dir == 0) {
			ns = Physics.stepTowards(speed, 0, p.brakeSpeed() / 20.0);
		} else if (speed != 0 && Math.signum(speed) != dir) {
			ns = Physics.stepTowards(speed, 0, (p.brakeForce() / 20.0) * Math.max(amount, MIN_BRAKE_AMOUNT) * Physics.brakeFade(speed, referenceMax));
		} else {
			double top = dir > 0 ? effMax : effMax * p.reverseModifier();
			double target = dir * top * amount;
			if (Math.abs(speed) < Math.abs(target)) {
				double rf = dir > 0 ? 1 : p.reverseModifier();
				ns = Physics.stepTowards(speed, target, (effMax / 20.0 / s.accel()) * rf);
			} else {
				ns = Physics.stepTowards(speed, target, p.brakeSpeed() / 20.0);
			}
		}
		st.speed = ns;
		st.steer = in.steer();
	}

	/** Значение свойства rz:steer для анимации колёс (смещение +1000; 0 = не используется). */
	public static int steerVisual(VehicleSpec s, double steer, double sens) {
		double sn = Math.min(sens, 1.5);
		return (int) Math.round(-steer * sn * Physics.Params.of(s).rotationSpeed()) + 1000;
	}
}
