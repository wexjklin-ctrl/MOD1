import com.rzauto.logic.*;
import java.util.*;
public class SelfTest {
	static VehicleSpec mk(String id, boolean moto, double top, double acc, int[] bd, double g7) {
		return new VehicleSpec(id, id.split(":")[0] + ":", moto, top, acc, 2.0, 500000, 10000, bd, g7, 2, 2, 2, 1.2, 20);
	}
	static void check(boolean ok, String msg) { System.out.println((ok ? "OK   " : "FAIL ") + msg); if (!ok) System.exit(1); }
	public static void main(String[] a) {
		VehicleSpec f = mk("f458:blue", false, 2.1, 0.5, new int[]{0,0,0,90,100}, 3);
		VehicleSpec jeep = mk("jeep:yjbase", false, 1.25, 4.8, new int[]{10,29,30,95,100}, 0);
		VehicleSpec ford = mk("ford:base", false, 1.9, 4, new int[]{0,0,0,0,100}, 2.5);

		// разгон: accel = секунды до максимума (≈ accel*20 тиков)
		Physics.State st = new Physics.State(); int ticks = 0;
		while (st.speed < 2.1 - 1e-9 && ticks < 2000) { Physics.tick(f, st, new Physics.Input(0, 1), 2.1, false, 1); ticks++; }
		check(ticks >= 9 && ticks <= 12, "458 (accel 0.5) разгон до максимума за " + ticks + " тиков (~10)");
		st = new Physics.State(); ticks = 0;
		while (st.speed < 1.25 - 1e-9 && ticks < 2000) { Physics.tick(jeep, st, new Physics.Input(0, 1), 1.25, false, 1); ticks++; }
		check(ticks >= 95 && ticks <= 98, "Jeep YJ (accel 4.8) за " + ticks + " тиков (~96)");

		// руль: 0 скорости — 0 поворота; на максимуме полный
		st = new Physics.State(); Physics.tick(f, st, new Physics.Input(1, 0), 2.1, false, 1);
		check(st.yawDeg == 0, "стоя руль не поворачивает");
		st = new Physics.State(); st.speed = 2.1; st.steer = 1; Physics.tick(f, st, new Physics.Input(1, 1), 2.1, false, 1);
		check(Math.abs(Math.abs(st.yawDeg) - 2.0) < 1e-9, "на максимуме 40°/с = 2°/тик (yaw=" + st.yawDeg + ")");
		// задний ход: знак поворота меняется
		Physics.State r = new Physics.State(); r.speed = -0.5; r.steer = 1; Physics.tick(f, r, new Physics.Input(1, -1), 2.1, false, 1);
		Physics.State fw = new Physics.State(); fw.speed = 0.5; fw.steer = 1; Physics.tick(f, fw, new Physics.Input(1, 1), 2.1, false, 1);
		check(Math.signum(r.yawDeg) == -Math.signum(fw.yawDeg), "руль зеркален при заднем ходе");

		// предел заднего хода 50%
		st = new Physics.State(); for (int i = 0; i < 500; i++) Physics.tick(f, st, new Physics.Input(0, -1), 2.1, false, 1);
		check(Math.abs(st.speed + 1.05) < 1e-6, "задний ход = 50% (" + st.speed + ")");

		// покрытие
		check(Physics.effectiveMax(f, 2.1, Surface.effect("sand")) < 0.64, "песок режет 458 до 30%");
		check(Physics.effectiveMax(jeep, 1.25, Surface.effect("sand")) == 1.25, "Jeep YJ иммунен");
		check(Physics.effectiveMax(ford, 1.9, Surface.effect("grass_block")) == 1.9, "Ford иммунен");
		check(Surface.effect("snow") != null && !Surface.effect("snow").reducesSpeed(), "снег — только пыль");
		check(Surface.effect("stone") == null, "камень — обычная земля");

		// передачи
		check(Gears.power(f, 1) == 10 && Gears.power(f, 6) == 100, "передачи 10%…100%");
		check(Math.abs(Gears.power(f, 7) - 3.0 / 2.1 * 100) < 1e-9, "7-я у 458 = 142.9% от top");
		check(Gears.power(jeep, 7) == 100, "у Jeep YJ 7-й нет, 7 → 6");
		check(Gears.maxGear(f, true) == 6 && Gears.maxGear(f, false) == 7, "7-я блокируется после траты");
		check(Gears.gear7Ticks(f) == 40, "7-я у 458 держится 2 с = 40 тиков");

		// currentMax (applySpeed)
		check(Physics.currentMax(f, 100, false, 0, true) == 0, "пустой бак — стоит");
		check(Physics.currentMax(f, 100, false, 5, false) == 0, "двигатель заглушен — стоит");
		check(Math.abs(Physics.currentMax(f, 50, false, 5, true) - 1.05) < 1e-9, "50% = 1.05");

		// топливо/износ
		check(Fuel.consume(f, 10000, 10, 1) == 9980, "расход 2/блок");
		check(Fuel.consume(f, 10000, 60, 1) == 10000, "телепорт >=50 блоков не считается");
		Wear.Result w = new Wear.Result(); Random rnd = new Random(5);
		Wear.track(f, w, 60000, 1, rnd);
		check(w.checkedIndex >= 3, "пороги пройдены до индекса " + w.checkedIndex + ", сломана=" + w.broken);
		Wear.Result w2 = new Wear.Result(); Wear.track(ford, w2, 99999, 1, rnd);
		check(!w2.broken, "Ford до 100k не ломается");
		Wear.replaceGear(w); check(w.mileage == 0 && w.checkedIndex == -1 && !w.broken, "замена шестерни сбрасывает износ");
		System.out.println("ALL PASSED");
	}
}
