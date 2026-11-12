import com.rzauto.logic.*;
import java.util.List;
public class SelfTestState {
	static void check(boolean ok, String m) { System.out.println((ok ? "OK   " : "FAIL ") + m); if (!ok) System.exit(1); }
	public static void main(String[] a) {
		// замок
		check(Access.Lock.parse(null, true) == Access.Lock.LOCKED && Access.Lock.parse("junk", false) == Access.Lock.OPEN, "lock: миграция locked=true, мусор → open");
		check(Access.canEnter(Access.Lock.OPEN, "A", "B", false) == Access.Entry.ALLOW, "open: все садятся");
		check(Access.canEnter(Access.Lock.SEALED, "A", "A", false) == Access.Entry.DENY_SEALED, "sealed: никто, даже владелец");
		check(Access.canEnter(Access.Lock.LOCKED, "A", "B", false) == Access.Entry.DENY_LOCKED && Access.canEnter(Access.Lock.LOCKED, "A", "A", false) == Access.Entry.ALLOW, "locked: только владелец");
		check(Access.canEnter(Access.Lock.PASSENGERS, "A", "B", false) == Access.Entry.DENY_DRIVER_ONLY_OWNER && Access.canEnter(Access.Lock.PASSENGERS, "A", "B", true) == Access.Entry.ALLOW, "passengers: чужой — только если владелец за рулём");
		check(Access.onSneakInteract(null, "B") == Access.Sneak.CLAIM_AND_OPEN_MENU && Access.onSneakInteract("A", "B") == Access.Sneak.DENY_NOT_OWNER, "приседание: захват владения / отказ");
		// пересадка
		check(Seating.needsOwnerToWheel(Access.Lock.PASSENGERS, "A", List.of("B", "A")) && !Seating.needsOwnerToWheel(Access.Lock.PASSENGERS, "A", List.of("A", "B")) && !Seating.needsOwnerToWheel(Access.Lock.OPEN, "A", List.of("B", "A")), "пересадка владельца за руль");
		check(Seating.ownerFirst("A", List.of("B", "C", "A")).equals(List.of("A", "B", "C")), "порядок: владелец, затем прежний");
		// условия езды
		VehicleState v = new VehicleState();
		check(DriveGate.check(v, true, true) == DriveGate.ENGINE_OFF, "новая машина заглушена");
		v.engineOn = true; check(DriveGate.check(v, true, true) == DriveGate.NO_FUEL, "двигатель есть, бак пуст");
		v.fuel = 5; check(DriveGate.check(v, true, false) == DriveGate.NO_LICENSE, "нет прав");
		check(DriveGate.check(v, true, true).canDrive(), "всё в порядке — едет");
		v.wear.broken = true; check(DriveGate.check(v, true, true) == DriveGate.BROKEN, "сломана");
		v.wear.broken = false; v.lock = Access.Lock.PASSENGERS; check(DriveGate.check(v, false, true) == DriveGate.NOT_OWNER, "чужой за рулём в режиме passengers");
		// настройки
		v.setTurnStrength(2.5); check(v.turnStrength() == 2.5, "turn_strength 2.5 допустим");
		v.setTurnStrength(2.3); check(v.turnStrength() == 1, "turn_strength 2.3 → 1");
		v.setSpeedPercent(30); check(v.speedPercent == 30, "speed_percent 30");
		v.setSpeedPercent(33); check(v.speedPercent == 100, "speed_percent 33 → 100");
		v.setWheelSens(9); check(v.wheelSens() == 5, "wheel_sens зажат до 5");
		v.setWheelSens(0.1); check(v.wheelSens() == 0.25, "wheel_sens ≥ 0.25");
		v.setWheelCurve(7); check(v.wheelCurve() == 1, "wheel_curve вне диапазона → линейная");
		v.motion.lat = 0.3; v.setDrift(false); check(v.motion.lat == 0, "выкл. занос обнуляет lat");
		v.motion.wheelPos = 0.5; v.motion.yawRate = 1; v.setWheelSim(false); check(v.motion.wheelPos == 0 && v.motion.yawRate == 0, "выкл. эмуляцию обнуляет вес руля");
		check(v.suspOn && !v.engineOn == false, "подвеска включена по умолчанию");
		// оборудование
		check(Features.kindOf("jeep:yj_wrangler") == Features.Kind.TENT && Features.kindOf("ford:explorer") == Features.Kind.LIGHTS && Features.kindOf("maybach:gls600") == Features.Kind.BOUNCE && Features.kindOf("bmw:m3") == null && Features.kindOf("jeep:xj") == null, "оборудование по префиксам");
		// спидометр
		check(Speedo.text(0, 0, 1, 1, 2).equals("§f72 §7км/ч"), "спидометр: 1 блок/тик = 72 км/ч → " + Speedo.text(0, 0, 1, 1, 2));
		check(Speedo.text(1, 0, 0.5, 0.5, 2).equals("§f10.0 §7бл/с"), "спидометр: бл/с");
		check(Speedo.text(2, 0, 0, -1.7, 1.7).equals("§c1.70 ед."), "спидометр: у предела красный, ед. по модулю");
		// каталог ключей совпадает с найденными в оригинале
		check(VehicleState.KEYS.length == 41, "41 ключ свойств (без locked)");
		System.out.println("ALL PASSED");
	}
}
