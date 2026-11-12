package com.rzauto.logic;

import java.util.Arrays;

/**
 * Все настройки и состояние одной машины — аналог dynamic properties из BP/scripts (имена ключей сохранены
 * в комментариях, чтобы их можно было переносить из мира Bedrock). Без зависимостей от Minecraft:
 * на стороне мода это сериализуется в NBT сущности (ключи те же, что в {@link #KEYS}).
 */
public final class VehicleState {
	public static final int[] SPEED_LEVELS = {10, 30, 50, 70, 100};   // main.js SPEED_LEVELS
	public static final int DEFAULT_SPEED_PERCENT = 100;
	public static final double DEFAULT_TURN_STRENGTH = 1;               // уровни 1.0…10.0 шагом 0.5

	/** Ключи свойств Bedrock → поля (для миграции мира, SPEC.md раздел 7). */
	public static final String[] KEYS = {
		"owner", "lock_state", "engine_on", "fuel_blocks", "mileage_blocks", "mileage_checked_index", "broken_down",
		"speed_percent", "turn_strength", "gta_steering", "gear_mode", "gear", "gear_input", "gear_jump_lock",
		"gear7_left", "gear7_locked", "gv_jump_locked", "gv_speed", "gv_yaw", "gv_steer", "gv_lat", "gv_wheelpos", "gv_yawrate",
		"wheel_mode", "wheel_sens", "wheel_curve", "wheel_compensate", "wheel_debug", "wheel_sim", "drift_mode",
		"susp_on", "speedo_on", "speedo_unit", "seat_fix", "seat_fix_applied",
		"rz_sound_on", "rz_sound_vol", "racing_camera", "racing_camera_zoom", "free_camera", "free_camera_dist"
	};

	// --- владение и замок
	public String owner;                       // имя игрока; null = ещё не заявлен
	public Access.Lock lock = Access.Lock.OPEN;

	// --- двигатель / топливо / износ
	public boolean engineOn;                   // по умолчанию заглушен (!)
	public double fuel;                        // fuel_blocks
	public Wear.Result wear = new Wear.Result();

	// --- старое управление
	public int speedPercent = DEFAULT_SPEED_PERCENT;
	private double turnStrength = DEFAULT_TURN_STRENGTH;
	public boolean gta;

	// --- режим руля и занос
	public boolean wheelMode, wheelCompensate, wheelDebug, wheelSim, drift;
	private double wheelSens = Wheel.SENS_DEFAULT;
	private int wheelCurve = Wheel.CURVE_DEFAULT;

	// --- прочее
	public boolean suspOn = true;              // по умолчанию подвеска включена
	public boolean speedoOn;
	private int speedoUnit;
	public boolean seatFix, seatFixApplied;
	public boolean soundOn = true;
	public double soundVolume = 1;
	public boolean racingCamera, freeCamera;
	private int racingCamZoom = Cameras.RACING_ZOOM_DEFAULT;
	private double freeCameraDist = Cameras.FREE_DIST_DEFAULT;
	public boolean featureOn;                  // тент / мигалки / подвеска: minecraft:variant == 1
	public final GearBox gears = new GearBox();

	/** Динамика движения (gv_speed, gv_yaw, gv_steer, gv_lat, gv_wheelpos, gv_yawrate). */
	public final Physics.State motion = new Physics.State();

	// ---- значения с проверкой допустимого диапазона (как getX() в оригинале)
	public double turnStrength() { return turnStrength; }
	/** turn_strength допустим только из {1.0, 1.5, …, 10.0}; иначе значение по умолчанию. */
	public void setTurnStrength(double v) {
		boolean ok = v >= 1 && v <= 10 && Math.abs(v * 2 - Math.rint(v * 2)) < 1e-9;
		turnStrength = ok ? v : DEFAULT_TURN_STRENGTH;
	}

	public void setSpeedPercent(int p) { speedPercent = Arrays.stream(SPEED_LEVELS).anyMatch(l -> l == p) ? p : DEFAULT_SPEED_PERCENT; }

	public int racingCamZoom() { return racingCamZoom; }
	public void setRacingCamZoom(int i) { racingCamZoom = (i >= 0 && i < Cameras.RACING_ZOOM.length) ? i : Cameras.RACING_ZOOM_DEFAULT; }
	public double freeCameraDist() { return freeCameraDist; }
	public void setFreeCameraDist(double v) { freeCameraDist = Physics.clamp(v, Cameras.FREE_DIST_MIN, Cameras.FREE_DIST_MAX); }

	public double wheelSens() { return wheelSens; }
	public void setWheelSens(double v) { wheelSens = Physics.clamp(v, Wheel.SENS_MIN, Wheel.SENS_MAX); }
	public int wheelCurve() { return wheelCurve; }
	public void setWheelCurve(int i) { wheelCurve = (i >= 0 && i < Wheel.CURVE_GAMMA.length) ? i : Wheel.CURVE_DEFAULT; }
	public int speedoUnit() { return speedoUnit; }
	public void setSpeedoUnit(int i) { speedoUnit = (i >= 0 && i < Speedo.UNITS.length) ? i : 0; }

	/** Выключили занос → боковая скорость обнуляется (setDriftMode). */
	public void setDrift(boolean on) { drift = on; if (!on) motion.lat = 0; }
	/** Выключили эмуляцию руля → gv_wheelpos / gv_yawrate = 0 (setWheelSim). */
	public void setWheelSim(boolean on) { wheelSim = on; if (!on) { motion.wheelPos = 0; motion.yawRate = 0; } }

	public Wheel.Settings wheelSettings() { return new Wheel.Settings(wheelSens, wheelCurve, wheelCompensate, wheelSim, drift); }
}
