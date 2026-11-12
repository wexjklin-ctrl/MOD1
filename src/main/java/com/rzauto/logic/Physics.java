package com.rzauto.logic;

/**
 * Наземная физика, перенесённая 1-в-1 из BP/scripts/vehicle_physics.js + vehicle_math.js + vehicle_profiles.js.
 * Единицы: скорость в блоках/тик (1.0 = 72 км/ч); тик = 1/20 с. Без зависимостей от Minecraft.
 * Здесь НЕТ режима руля (vehicle_wheel.js) и заноса (vehicle_drift.js) — это отдельный этап.
 */
public final class Physics {
	public static final double SURFACE_SPEED_MULTIPLIER = 0.3;  // vehicle_surfaces.js: −70%
	public static final double THROTTLE_DEADZONE = 0.2;
	public static final double COLLISION_BLEED = 0.1;
	public static final double STEER_EASE_RATE = 0.18;
	public static final int AIR_GRACE_TICKS = 4;
	public static final double BRAKE_FADE_START = 0.35, BRAKE_FADE_MIN = 0.4;

	/** Общие параметры (CAR_PROFILE / MOTORCYCLE_PROFILE); acceleration берётся из VehicleSpec.accel (секунды до максимума). */
	public record Params(double rotationSpeed, double brakeSpeed, double brakeForce, double reverseModifier) {
		public static final Params CAR = new Params(40, 0.5, 3, 0.5);
		public static final Params MOTO = new Params(65, 0.8, 4, 0.15);
		public static Params of(VehicleSpec s) { return s.motorcycle() ? MOTO : CAR; }
	}

	/** Изменяемое состояние машины (динамические свойства gv_speed / gv_yaw / gv_steer). */
	public static final class State {
		public double speed, yawDeg, steer;
		public double lat;                 // gv_lat: боковая скорость (занос)
		public double wheelPos, yawRate;   // gv_wheelpos / gv_yawrate (эмуляция руля)
		public boolean sliding;            // только для дыма/звука, не хранится
	}

	/** Ввод водителя: x = руль (-1..1), y = газ/тормоз (-1..1, как inputInfo.getMovementVector). */
	public record Input(double x, double y) {}

	public static double clamp(double v, double lo, double hi) { return Math.min(Math.max(v, lo), hi); }

	public static double normalizeAngle(double a) {
		a = a % 360;
		if (a <= -180) a += 360;
		if (a > 180) a -= 360;
		return a;
	}

	/** Шаг фиксированной величины к цели (не lerp). */
	public static double stepTowards(double value, double target, double amount) {
		if (value > target) return Math.max(value - amount, target);
		if (value < target) return Math.min(value + amount, target);
		return target;
	}

	public static double brakeFade(double speed, double referenceMax) {
		if (!(referenceMax > 0)) return 1;
		double f = clamp(Math.abs(speed) / referenceMax, 0, 1);
		if (f <= BRAKE_FADE_START) return 1;
		double t = (f - BRAKE_FADE_START) / (1 - BRAKE_FADE_START);
		return 1 - (1 - BRAKE_FADE_MIN) * t;
	}

	/**
	 * Текущий лимит скорости (аналог movement.currentValue из applySpeed в main.js):
	 * top_speed * процент/100, а при поломке / пустом баке / заглушенном двигателе — 0.
	 * percent: либо мощность передачи (Gears.power), либо speed_percent из меню (10/30/50/70/100).
	 */
	public static double currentMax(VehicleSpec s, double percent, boolean broken, double fuel, boolean engineOn) {
		double p = (!broken && fuel > 0 && engineOn) ? percent : 0;
		return s.topSpeed() * (p / 100.0);
	}

	/** Лимит с учётом покрытия: песок/грязь/земля режут до 30% (кроме jeep:yj, jeep:xj, ford:). */
	public static double effectiveMax(VehicleSpec s, double maxSpeed, Surface.Effect surface) {
		return (surface != null && surface.reducesSpeed() && !s.offroadExempt()) ? maxSpeed * SURFACE_SPEED_MULTIPLIER : maxSpeed;
	}

	/**
	 * Один тик ведения (ветка без «режима руля»). Меняет st.speed / st.yawDeg / st.steer.
	 * @param effMax эффективный лимит скорости (effectiveMax)
	 * @param gta "Руль GTA"; @param turnStrength 1..10
	 */
	public static void tick(VehicleSpec s, State st, Input in, double effMax, boolean gta, double turnStrength) {
		Params p = Params.of(s);
		double speed = st.speed;

		// 3.3 руль: угол ∝ скорости, знак меняется при заднем ходе; ровно 0 скорости = 0 поворота
		double direction = speed > 0 ? 1 : speed < 0 ? -1 : 1;
		double turnFactor = gta ? (speed != 0 ? -direction : 0) : (effMax > 0 ? -speed / effMax : 0);
		st.steer = stepTowards(st.steer, in.x(), STEER_EASE_RATE);
		double response = gta ? Math.signum(st.steer) * st.steer * st.steer : st.steer;
		double rotationStepDeg = (p.rotationSpeed() / 20.0) * response * turnFactor * turnStrength;
		st.yawDeg = normalizeAngle(st.yawDeg + rotationStepDeg);

		// 3.4 разгон / торможение
		boolean throttling = Math.abs(in.y()) > THROTTLE_DEADZONE;
		double reverseFactor = speed >= 0 ? 1 : p.reverseModifier();
		boolean braking = throttling && speed != 0 && Math.signum(in.y()) != Math.signum(speed);
		if (braking) {
			speed = stepTowards(speed, 0, (p.brakeForce() / 20.0) * brakeFade(speed, s.topSpeed()));
		} else if (throttling && Math.abs(speed) <= effMax * Math.abs(in.y())) {
			// accel = секунды разгона до максимума (больше = медленнее)
			speed += Math.signum(in.y()) * (effMax / 20.0 / s.accel()) * reverseFactor;
		}
		if (!throttling) speed = stepTowards(speed, 0, p.brakeSpeed() / 20.0);

		st.speed = clamp(speed, -effMax * p.reverseModifier(), effMax);
	}


	/** Максимальный угол поворота кузова за тик (градусы): автомобиль / мотоцикл. */
	public static final double GTA_YAW_CAR = 4.8, GTA_YAW_MOTO = 6.0;

	/**
	 * Управление «как в GTA»: поворот работает сразу на малой скорости (радиус ~4 блока на 20 км/ч, вписывается в городские повороты),
	 * на высокой скорости угол поворота уменьшается; разгон резче с места, торможение сильнее, без разгона машина сама замедляется.
	 */
	public static void tickGta(VehicleSpec s, State st, Input in, double effMax) { tickGta(s, st, in, effMax, 1.0); }

	/** @param sens чувствительность руля (множитель скорости и угла поворота) */
	public static void tickGta(VehicleSpec s, State st, Input in, double effMax, double sens) {
		Params p = Params.of(s);
		double top = Math.max(s.topSpeed(), 0.05), v = st.speed, av = Math.abs(v);
		st.steer = stepTowards(st.steer, in.x(), (in.x() == 0 ? 0.40 : 0.30) * Math.max(1.0, sens));
		double low = clamp(av / 0.12, 0, 1);
		double high = 1 - 0.6 * clamp((av - 0.4) / Math.max(top - 0.4, 0.1), 0, 1);
		double yawMax = (s.motorcycle() ? GTA_YAW_MOTO : GTA_YAW_CAR) * sens;
		st.yawDeg = normalizeAngle(st.yawDeg - st.steer * yawMax * low * high * (v >= 0 ? 1 : -1));

		boolean throttling = Math.abs(in.y()) > THROTTLE_DEADZONE;
		boolean braking = throttling && av > 0.02 && Math.signum(in.y()) != Math.signum(v);
		double reverseFactor = v >= 0 ? 1 : p.reverseModifier();
		if (braking) {
			v = stepTowards(v, 0, (p.brakeForce() / 20.0) * 1.4 * brakeFade(v, top));
		} else if (throttling && av <= effMax * Math.abs(in.y())) {
			double launch = 1 + 1.2 * (1 - clamp(av / top, 0, 1));
			v += Math.signum(in.y()) * (effMax / 20.0 / s.accel()) * reverseFactor * launch;
		}
		if (!throttling) v = stepTowards(v, 0, 0.03);
		st.speed = clamp(v, -effMax * p.reverseModifier(), effMax);
	}

	/**
	 * Тик в «режиме руля» (ветка isWheelMode в groundEntityTick): аналоговый ввод, опционально эмуляция руля и занос.
	 * @param rawX,rawY сырой ввод стика; @param surface текущее покрытие (null = обычное)
	 */
	public static void tickWheel(VehicleSpec s, State st, double rawX, double rawY, Wheel.Settings cfg, double effMax, Surface.Effect surface) {
		double ref = s.topSpeed();
		Wheel.WheelInput in = Wheel.readInput(cfg, rawX, rawY);
		if (!cfg.drift()) st.lat = 0;
		if (cfg.sim()) in = new Wheel.WheelInput(Wheel.simulateSteer(st, in.steer(), st.speed, ref), in.pedal());
		double yawOld = st.yawDeg;
		double steerSpeed = cfg.drift() ? Math.hypot(st.speed, st.lat) : Double.NaN;
		Wheel.drive(s, st, in, cfg, effMax, ref, steerSpeed);
		if (cfg.sim()) st.yawDeg = normalizeAngle(yawOld + Wheel.simulateYawStep(st, normalizeAngle(st.yawDeg - yawOld)));
		st.sliding = false;
		if (cfg.drift()) Drift.step(st, yawOld, ref, Drift.gripScale(s, surface, in.pedal(), st.speed));
	}

	/** Сброс скорости при упоре в препятствие (3.6): вызывать, если заданная скорость не превратилась в движение. */
	public static double collisionBleed(double speed, double maxSpeed) {
		return stepTowards(speed, 0, Math.max(Math.abs(maxSpeed) * 0.25, COLLISION_BLEED));
	}

	/** Горизонтальный вектор скорости: forward = (-sin(yaw), cos(yaw)) * speed; yaw в градусах, как у Minecraft. */
	public static double[] horizontalVelocity(double yawDeg, double speed) { return horizontalVelocity(yawDeg, speed, 0); }

	/** С боковой составляющей заноса: ось «вправо» = (cos, sin). */
	public static double[] horizontalVelocity(double yawDeg, double speed, double lat) {
		double r = Math.toRadians(yawDeg);
		return new double[] { -Math.sin(r) * speed + Math.cos(r) * lat, Math.cos(r) * speed + Math.sin(r) * lat };
	}

	/** Без аллокаций: результат пишется в out[0..1] (для горячего цикла сервера). */
	public static void horizontalVelocity(double yawDeg, double speed, double lat, double[] out) {
		double r = Math.toRadians(yawDeg), sn = Math.sin(r), cs = Math.cos(r);
		out[0] = -sn * speed + cs * lat;
		out[1] = cs * speed + sn * lat;
	}
}
