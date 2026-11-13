package com.rzauto.logic;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Логика и тексты меню водителя (main.js: openDriveMenu, openInteractMenu, openClassicControlMenu, openCameraMenu, форма «Режим руля»).
 * Сами экраны рисует клиент (Screen); здесь — действия над VehicleState и сообщения игроку. Предметы (ведро, шестерня) проверяет и
 * списывает вызывающая сторона на сервере: действие возвращает {@link Result#ok}.
 */
public final class Menu {
	public record Result(boolean ok, String message) {}
	public static final String LAVA_BUCKET = "minecraft:lava_bucket", EMPTY_BUCKET = "minecraft:bucket", GEAR_ITEM = "carworkshop:gear", LICENSE_ITEM = "carworkshop:driver_license";

	static String n(double v) { return String.format(Locale.forLanguageTag("ru-RU"), "%,d", Math.round(v)); }

	// ---- действия
	/** Завести / заглушить. */
	public static Result toggleEngine(VehicleState v) {
		if (v.engineOn) { v.engineOn = false; return new Result(true, "§7Двигатель заглушен."); }
		if (v.wear.broken) return new Result(false, "§cМашина сломана: двигатель не заводится. Замените шестерню.");
		if (!(v.fuel > 0)) return new Result(false, "§cБак пуст: двигатель не заводится. Заправьте машину ведром лавы.");
		v.engineOn = true;
		return new Result(true, "§aДвигатель заведён. Можно ехать (права должны быть в руке).");
	}

	/** Заправка: вызывать, когда у игрока есть ведро лавы; ведро заменить пустым. */
	public static Result refuel(VehicleSpec s, VehicleState v, boolean hasLavaBucket) {
		if (!hasLavaBucket) return new Result(false, "§cУ вас нет ведра с лавой в инвентаре.");
		v.fuel = Fuel.addBucket(s, v.fuel);
		return new Result(true, "§aБак заправлен. Топливо: " + Math.round(v.fuel) + " / " + Math.round(s.maxFuel()) + " л.");
	}

	/** Замена шестерни: вызывать, когда у игрока есть предмет carworkshop:gear (списать 1). */
	public static Result replaceGear(VehicleSpec s, VehicleState v, boolean hasGearItem) {
		if (!hasGearItem) return new Result(false, "§cУ вас нет шестерни в инвентаре. Скрафтите её в автомастерской (4 слитка железа).");
		boolean wasBroken = v.wear.broken;
		Wear.replaceGear(v.wear);
		boolean back = wasBroken && s.hasGear7() && v.gears.gear7Locked;
		if (back) v.gears.unlockGear7();
		return new Result(true, back
			? "§aШестерня заменена. Машина отремонтирована, пробег обнулён. §67-я передача снова доступна!"
			: "§aШестерня заменена. Машина отремонтирована, пробег обнулён.");
	}

	/** Тент / мигалки / подвеска. Возвращает сообщение или null, если у машины нет оборудования. */
	public static String toggleFeature(VehicleSpec s, VehicleState v) {
		Features.Kind k = Features.kindOf(s.bedrockId());
		if (k == null) return null;
		v.featureOn = !v.featureOn;
		return v.featureOn ? k.msgOn : k.msgOff;
	}

	// ---- камера
	public static String setRacingCamera(VehicleState v, boolean on) {
		Cameras.setRacing(v, on);
		return on ? "§aГоночная камера включена. Камера от третьего лица плавно следует за машиной." : "§7Гоночная камера выключена.";
	}
	public static String applyFreeCamera(VehicleState v, boolean enabled, double distance) {
		double dist = Math.round(distance / Cameras.FREE_DIST_STEP) * Cameras.FREE_DIST_STEP;
		v.setFreeCameraDist(dist);
		boolean was = v.freeCamera;
		Cameras.setFree(v, enabled);
		if (enabled) return String.format(Locale.ROOT, "§aСвободная камера включена (дальность %.1f). Едешь вперёд - смотрит вперёд; если долго ехать назад - плавно развернётся; у препятствий приближается к машине.", v.freeCameraDist());
		return was ? "§7Свободная камера выключена." : null;
	}

	// ---- форма «Режим руля»
	public record WheelForm(boolean enabled, boolean drift, boolean sim, boolean gearMode, int gearInput, boolean jumpLock, double sens, int curve,
			boolean compensate, boolean debug, boolean speedo, int speedoUnit, boolean susp, boolean seatFix) {}
	public static final class Applied { public final List<String> messages = new ArrayList<>(); public boolean clearSpeedo, speedChanged; }

	public static Applied applyWheelForm(VehicleSpec s, VehicleState v, WheelForm f) {
		Applied a = new Applied();
		double sens = Math.round(f.sens() / Wheel.SENS_STEP) * Wheel.SENS_STEP;
		v.wheelMode = f.enabled();
		v.setDrift(f.drift());
		v.setWheelSim(f.sim());
		v.setWheelSens(sens);
		v.setWheelCurve(f.curve());
		v.wheelCompensate = f.compensate();
		v.wheelDebug = f.debug();
		v.speedoOn = f.speedo();
		v.setSpeedoUnit(f.speedoUnit());
		v.suspOn = f.susp();
		boolean seatWas = v.seatFix;
		v.seatFix = f.seatFix();
		if (f.seatFix() != seatWas) a.messages.add(f.seatFix()
			? "§aПосадка персонажа включена. Вступит в силу, когда выйдешь из машины и сядешь снова."
			: "§7Посадка персонажа выключена. Вступит в силу после выхода из машины и новой посадки.");
		if (!f.speedo()) a.clearSpeedo = true;

		boolean gearWas = v.gears.mode;
		v.gears.mode = f.gearMode();
		v.gears.setInput(f.gearInput());
		v.gears.jumpLock = f.jumpLock();
		if (f.gearMode() && !gearWas) v.gears.setGear(1);
		if (f.gearMode() != gearWas) a.speedChanged = true;
		if (f.gearMode() && !gearWas) {
			if (s.hasGear7()) a.messages.add("§6У этой машины есть 7-я передача: скорость выше, но держится " + fmt(s.gear7Seconds()) + " с, топливо ×" + fmt(s.gear7FuelMult()) + ", износ ×" + fmt(s.gear7WearMult())
				+ ". После окончания - сброс на 6-ю, вернётся после замены шестерни после поломки.");
			a.messages.add(v.gears.input() == GearBox.INPUT_JUMP
				? "§aРежим передач включён: 1-я передача (" + (int) Gears.POWER_PCT[0] + "%). Кнопка прыжка (пробел / A): короткое нажатие - выше, удержание - ниже."
				: "§aРежим передач включён: 1-я передача (" + (int) Gears.POWER_PCT[0] + "%). Выше - колесо мыши вниз / RB, ниже - колесо вверх / LB.");
		} else if (!f.gearMode() && gearWas) a.messages.add("§7Режим передач выключен: мощность снова по настройке «Скорость».");

		if (f.enabled()) {
			a.messages.add(String.format(Locale.ROOT, "§aРежим руля включён. Чувствительность: x%.2f, кривая: %s.", sens, Wheel.CURVE_LABELS[v.wheelCurve()]));
			if (f.drift()) a.messages.add("§cЗанос / инерция включены: быстрый резкий поворот срывает машину в занос, выкрути руль в сторону заноса, чтобы выйти.");
			if (f.sim()) a.messages.add("§cЭмуляция руля включена: руль «весит», на скорости угол поворота уменьшается - при необходимости поднимай чувствительность.");
		} else a.messages.add("§7Режим руля выключен: управление как раньше (клавиатура/геймпад).");
		return a;
	}
	static String fmt(double d) { return d == Math.rint(d) ? Long.toString((long) d) : Double.toString(d); }

	// ---- «Старое управление»
	public static void setSpeedPercentFromMenu(VehicleState v, int percent) { v.setSpeedPercent(percent); }

	// ---- тексты
	public static String gear7Line(VehicleSpec s, VehicleState v) {
		if (!s.hasGear7()) return "";
		return v.gears.gear7Locked ? "\n§c7-я передача заблокирована до замены шестерни после поломки"
			: "\n§67-я передача доступна: держится " + fmt(s.gear7Seconds()) + " с, топливо ×" + fmt(s.gear7FuelMult()) + ", износ ×" + fmt(s.gear7WearMult());
	}
	public static String gearModeNote(VehicleSpec s, VehicleState v) {
		if (!v.gears.mode) return "";
		return "\n§bРежим передач: " + v.gears.gear(s) + "/" + v.gears.total(s) + " (мощность " + Math.round(v.gears.power(s))
			+ "%) - кнопки «Скорость» сейчас не действуют" + gear7Line(s, v);
	}
	/** Тело главного меню «Управление автомобилем». */
	public static String driveBody(VehicleSpec s, VehicleState v) {
		String status = v.wear.broken ? "§cМашина сломана! Требуется замена шестерни."
			: (s.breakdownChancesPct() != null && s.breakdownChancesPct().length > 0) ? "Пробег с последней шестерни: " + n(v.wear.mileage) + " л" : "";
		return "Владелец: " + Access.ownerLabel(v.owner) + "\nДвигатель: " + (v.engineOn ? "§aзаведён" : "§7заглушен") + "§r\nТопливо: " + Math.round(v.fuel) + " / " + Math.round(s.maxFuel()) + " л"
			+ (status.isEmpty() ? "" : "\n" + status) + gearModeNote(s, v);
	}
	public static String interactBody(VehicleSpec s, VehicleState v) {
		return "Двигатель: " + (v.engineOn ? "§aзаведён" : "§7заглушен") + "§r\nТопливо: " + Math.round(v.fuel) + " / " + Math.round(s.maxFuel()) + " л";
	}
	public static String refuelButton(VehicleSpec s) { return "Заправить (1 ведро лавы = +" + n(s.fuelPerBucket()) + " л)"; }
	public static String classicBody(VehicleSpec s, VehicleState v) { return "Скорость и сила поворота." + gearModeNote(s, v); }
	public static String lockLabel(Access.Lock l) {
		switch (l) { case OPEN: return "§aОткрыта"; case PASSENGERS: return "§bОткрыта для пассажиров (руль только у владельца)"; case LOCKED: return "§eЗакрыта (только владелец)"; default: return "§cПолностью закрыта"; }
	}
}
