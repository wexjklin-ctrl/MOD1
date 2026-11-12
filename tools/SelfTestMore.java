import com.rzauto.logic.*;
public class SelfTestMore {
	static void check(boolean ok, String m) { System.out.println((ok ? "OK   " : "FAIL ") + m); if (!ok) System.exit(1); }
	static VehicleSpec f458 = new VehicleSpec("f458:blue","f458:",false,2.1,0.5,2,500000,10000,new int[]{0,0,0,90,100},3,2,2,2,1.2,20);
	static VehicleSpec jeep = new VehicleSpec("jeep:yj","jeep:yj",false,1.25,4.8,1,200000,10000,new int[]{10,29,30,95,100},0,0,1,1,1.2,20);
	public static void main(String[] a) {
		// --- коробка передач
		GearBox g = new GearBox(); g.mode = true;
		check(g.shift(f458, +1).changed() && g.gear(f458) == 2, "вверх: 1→2");
		for (int i = 0; i < 4; i++) g.shift(f458, +1);
		check(g.gear(f458) == 6 && g.shift(f458, +1).changed() && g.gear(f458) == 7 && g.gear7Left == 40, "до 6-й, затем 7-я на 40 тиков");
		check(g.gear7Active(f458) && g.fuelMult(f458) == 2 && g.wearMult(f458) == 2 && Math.abs(g.power(f458) - 3.0 / 2.1 * 100) < 1e-9, "7-я: топливо ×2, износ ×2, мощность 142.9%");
		for (int i = 0; i < 39; i++) check(g.tick7(f458, true) == null, "тик 7-й " + i);
		check(g.tick7(f458, true) == null && g.gear7Left == 0, "7-я дотикала до 0");
		String msg = g.tick7(f458, true);
		check(msg != null && msg.contains("7-я передача закончилась") && g.gear(f458) == 6 && g.gear7Locked, "7-я кончилась: 6-я, блокировка");
		check(!g.shift(f458, +1).changed() && g.shift(f458, +1).hud().contains("заблокирована"), "7-я заблокирована до ремонта");
		g.unlockGear7(); g.shift(f458, +1); g.shift(f458, -1);
		check(g.gear(f458) == 6 && g.gear7Locked, "ручной уход с 7-й тоже тратит её");
		GearBox g2 = new GearBox(); g2.mode = true; g2.setGear(7); g2.gear7Left = 100; g2.mode = false; g2.tick7(f458, true);
		check(g2.gear7Locked && g2.gear(f458) == 6, "выключили режим на 7-й → потрачена");
		GearBox g3 = new GearBox(); g3.mode = true; g3.setGear(7); g3.gear7Left = 100;
		g3.tick7(f458, false); check(g3.gear7Left == 100, "7-я не тикает без пассажиров");
		check(g3.gear(jeep) == 6, "у Jeep YJ нет 7-й: gear 7 → 6");
		check(GearBox.hotbarDelta(1, 0) == 1 && GearBox.hotbarDelta(0, 1) == -1 && GearBox.hotbarDelta(0, 8) == 1 && GearBox.hotbarDelta(8, 0) == -1, "хотбар по кругу из 9");
		check(new GearBox().text(f458, "").equals("§bПередача §f1§7/7  §bМощность §f10%"), "HUD: " + new GearBox().text(f458, ""));
		// --- ввод водителя: Jump
		GearBox gj = new GearBox(); gj.mode = true; GearDriver d = new GearDriver(); GearDriver.Out o = new GearDriver.Out();
		d.tick(gj, f458, 0, 100, o); check(o.hud != null && o.shift == 0 && o.lockJump, "начало поездки: HUD, прыжок заблокирован");
		d.onJump(true, 101); d.onJump(false, 103); d.tick(gj, f458, 0, 104, o);
		check(o.shift == 1 && gj.gear(f458) == 2, "короткое нажатие Jump → выше");
		d.tick(gj, f458, 0, 108, o); d.onJump(true, 110); d.tick(gj, f458, 0, 115, o); check(o.shift == 0, "удержание 5 тиков ещё не срабатывает");
		d.tick(gj, f458, 0, 120, o); check(o.shift == -1 && gj.gear(f458) == 1, "удержание 10 тиков → ниже");
		d.onJump(false, 125); d.tick(gj, f458, 0, 126, o); check(o.shift == 0, "отпускание после удержания — не тап");
		// хотбар
		GearBox gh = new GearBox(); gh.mode = true; gh.setInput(GearBox.INPUT_HOTBAR); GearDriver dh = new GearDriver();
		dh.tick(gh, f458, 3, 200, o); check(!o.lockJump, "хотбар: прыжок не блокируется");
		dh.tick(gh, f458, 4, 201, o); check(o.shift == 1 && o.restoreSlot == 3, "слот 3→4: выше, слот вернуть на 3");
		dh.tick(gh, f458, 2, 202, o); check(o.shift == -1 && o.restoreSlot == 3, "слот 3→2: ниже");
		dh.tick(gh, f458, 3, 400, o); check(o.shift == 0 && o.hud != null, "перерыв >10 тиков — новая поездка");
		// --- звук
		check(Sound.profile("bmw:m3_g80").idle().equals("g80s58") && Sound.profile("ducati:x").move().equals("moto") && Sound.profile("unknown:x") == Sound.DEFAULT, "профили звука");
		check(Surface.roadSound("grass_block").key().equals("grass") && Surface.roadSound("dirt").key().equals("dirt") && Surface.roadSound("water") == null && Surface.roadSound("stone").key().equals("asphalt") && Surface.roadSound("snow").vol() == 0.5, "шум покрытия: трава раньше земли, вода — тишина");
		Sound.Mixer m = new Sound.Mixer();
		for (int i = 0; i < 60; i++) m.update(f458, true, 0, 2.1, true, "stone", false, 1, 1);
		check(m.idleVolume > 1.2 && m.moveVolume < 0.01, "стоим с заведённым: слышен холостой (" + m.idleVolume + ")");
		for (int i = 0; i < 80; i++) m.update(f458, true, 2.1, 2.1, true, "stone", false, 1, 1);
		check(m.idleVolume < 0.01 && m.moveVolume > 1.3 && m.roadVolume[0] > 0.9, "на максимуме: двигатель + асфальт, холостой затих");
		check(Math.abs(m.pitchMoveOut - 1.12) < 0.01, "тон на максимуме 1.12");
		for (int i = 0; i < 120; i++) m.update(f458, false, 0, 2.1, true, "stone", false, 1, 1);
		check(m.silent(false, 0), "двигатель заглушен, стоим → состояние можно забыть");
		Sound.Mixer m2 = new Sound.Mixer(); m2.update(f458, true, 1, 2.1, true, "sand", true, 3, 1); m2.update(f458, true, 1, 2.1, true, "sand", true, 4, 1);
		check(m2.gearShift == 1, "звук повышения передачи");
		m2.update(f458, true, 1, 2.1, true, "sand", true, 2, 1); check(m2.gearShift == -1, "звук понижения");
		m2.update(f458, true, 1, 2.1, true, "sand", true, 2, 0.5); check(m2.gearShift == 0 && m2.idleVolume < 1, "master 0.5 режет громкость");
		// --- камеры
		Cameras.World open = new Cameras.World() { public double hitDistance(Cameras.Vec3 o, Cameras.Vec3 d, double max) { return Double.POSITIVE_INFINITY; } public boolean solidAt(double x, double y, double z) { return false; } };
		Cameras.Free fc = new Cameras.Free(); Cameras.View v = new Cameras.View();
		fc.tick(0, 64, 0, 0, 1, 6, open, v);
		check(Math.abs(v.pos.z() - (v.look.z() - Math.cos(Math.atan2(0, 1)) * 0)) >= 0 && v.pos.z() < v.look.z() && v.pos.y() > v.look.y() && !v.fade, "свободная: камера сзади и выше машины (yaw 0 → камера на −Z)");
		for (int i = 0; i < 29; i++) fc.tick(0, 64, 0, 0, -0.5, 6, open, v);
		check(!fc.flipped(), "29 тиков назад — камера ещё не развернулась");
		fc.tick(0, 64, 0, 0, -0.5, 6, open, v); check(fc.flipped(), "30 тиков назад — разворот на 180°");
		for (int i = 0; i < 200; i++) fc.tick(0, 64, 0, 0, -0.5, 6, open, v);
		check(Math.abs(Math.abs(fc.heading()) - 180) < 1, "курс камеры доехал до 180° (" + fc.heading() + ")");
		for (int i = 0; i < 6; i++) fc.tick(0, 64, 0, 0, 0.5, 6, open, v); check(!fc.flipped(), "6 тиков вперёд — вернулась");
		Cameras.World wall = new Cameras.World() { public double hitDistance(Cameras.Vec3 o, Cameras.Vec3 d, double max) { return 2.0; } public boolean solidAt(double x, double y, double z) { return false; } };
		Cameras.Free f2 = new Cameras.Free(); for (int i = 0; i < 40; i++) f2.tick(0, 64, 0, 0, 1, 6, wall, v);
		double dist = Math.sqrt(Math.pow(v.pos.x() - v.look.x(), 2) + Math.pow(v.pos.y() - v.look.y(), 2) + Math.pow(v.pos.z() - v.look.z(), 2));
		check(dist < 2.0 && dist >= 1.0, "стена в 2 блоках: камера приблизилась (" + dist + ")");
		Cameras.World inside = new Cameras.World() { public double hitDistance(Cameras.Vec3 o, Cameras.Vec3 d, double max) { return Double.POSITIVE_INFINITY; } public boolean solidAt(double x, double y, double z) { return true; } };
		new Cameras.Free().tick(0, 64, 0, 0, 1, 6, inside, v); check(v.fade, "x-ray: камера в блоке → чёрный экран");
		Cameras.Racing rc = new Cameras.Racing();
		rc.tick(0, 64, 0, 0, 2, open, v);
		check(Math.abs(v.pos.z() - (-7)) < 1e-9 && Math.abs(v.pos.y() - 67) < 1e-9 && Math.abs(v.look.y() - 65.3) < 1e-9, "гоночная «Далеко»: сзади 7, выше 3, взгляд +1.3");
		Cameras.Racing r2 = new Cameras.Racing(); r2.tick(0, 64, 0, 0, 2, wall, v);
		double rd = Math.sqrt(Math.pow(v.pos.x() - v.look.x(), 2) + Math.pow(v.pos.y() - v.look.y(), 2) + Math.pow(v.pos.z() - v.look.z(), 2));
		check(Math.abs(rd - 1.5) < 1e-6, "гоночная: стена на 2 → камера на 2−0.5 = 1.5 (" + rd + ")");
		VehicleState vs = new VehicleState();
		Cameras.setRacing(vs, true); Cameras.setFree(vs, true); check(!vs.racingCamera && vs.freeCamera && Cameras.summary(vs).equals("Свободная"), "камеры взаимоисключающие");
		vs.setRacingCamZoom(9); check(vs.racingCamZoom() == 2, "зум вне диапазона → Далеко");
		vs.setFreeCameraDist(99); check(vs.freeCameraDist() == 15, "дальность ≤ 15");
		// --- меню
		VehicleState s = new VehicleState();
		check(!Menu.toggleEngine(s).ok() && Menu.toggleEngine(s).message().contains("Бак пуст"), "двигатель без топлива не заводится");
		Menu.Result r = Menu.refuel(f458, s, true); check(r.ok() && s.fuel == 10000 && r.message().contains("10000 / 500000"), "заправка: " + r.message());
		check(!Menu.refuel(f458, s, false).ok(), "нет ведра — отказ");
		check(Menu.toggleEngine(s).ok() && s.engineOn && Menu.toggleEngine(s).ok() && !s.engineOn, "завёл / заглушил");
		s.wear.broken = true; check(Menu.toggleEngine(s).message().contains("сломана"), "сломанная не заводится");
		s.gears.gear7Locked = true; Menu.Result rg = Menu.replaceGear(f458, s, true);
		check(rg.ok() && !s.wear.broken && !s.gears.gear7Locked && rg.message().contains("7-я передача снова доступна"), "шестерня: ремонт + возврат 7-й");
		check(!Menu.replaceGear(f458, s, false).ok(), "нет шестерни — отказ");
		check(Menu.toggleFeature(f458, s) == null && Menu.toggleFeature(jeep, s).contains("Тент натянут") && Menu.toggleFeature(jeep, s).contains("Тент снят"), "тент Jeep: вкл/выкл");
		check(Menu.applyFreeCamera(s, true, 7.3).contains("7.5") && s.freeCamera, "свободная камера: дальность округляется до шага 0.5");
		Menu.Applied ap = Menu.applyWheelForm(f458, s, new Menu.WheelForm(true, true, true, true, 0, true, 2.6, 2, false, false, false, 1, true, true));
		check(s.wheelMode && s.drift && s.wheelSim && s.gears.mode && s.wheelSens() == 2.5 && s.wheelCurve() == 2 && s.suspOn && s.seatFix && ap.clearSpeedo && ap.speedChanged, "форма руля применена, чувствительность → 2.5");
		check(ap.messages.stream().anyMatch(t -> t.contains("7-я передача")) && ap.messages.stream().anyMatch(t -> t.contains("Занос")), "сообщения: 7-я, занос");
		check(Menu.driveBody(f458, s).contains("Владелец: —") && Menu.driveBody(f458, s).contains("Режим передач: 1/7"), "тело меню");
		check(Menu.lockLabel(Access.Lock.LOCKED).startsWith("§e") && Menu.lockLabel(Access.Lock.SEALED).startsWith("§c"), "подписи замка как в оригинале");
		// --- регенерация
		check(Regen.power("ford:explorer") == 4 && Regen.power("maybach:gls") == 2 && Regen.power("bmw:m3") == 1 && Regen.power("zzz:") == 0, "регенерация: Ford ×4, Maybach ×2");
		System.out.println("ALL PASSED");
	}
}
