import com.rzauto.logic.*;
public class SelfTestWheel {
	static void check(boolean ok, String m) { System.out.println((ok ? "OK   " : "FAIL ") + m); if (!ok) System.exit(1); }
	public static void main(String[] a) {
		VehicleSpec f = new VehicleSpec("f458:blue","f458:",false,2.1,0.5,2,500000,10000,new int[]{0,0,0,90,100},3,2,2,2,1.2,20);
		Wheel.Settings d = Wheel.Settings.defaults();
		check(Wheel.readInput(d, 0.03, 0.05).steer() == 0 && Wheel.readInput(d, 0.03, 0.05).pedal() == 0, "мёртвые зоны 3% / 5%");
		check(Math.abs(Wheel.readInput(d, 1, 1).steer() - 1) < 1e-12 && Math.abs(Wheel.readInput(d, 1, 1).pedal() - 1) < 1e-12, "полный ввод = 1");
		check(Wheel.readInput(new Wheel.Settings(1, 3, false, false, false), 0.5, 0).steer() < Wheel.readInput(d, 0.5, 0).steer(), "кривая «Очень мягкая» мягче линейной");
		// стоя руль не поворачивает
		Physics.State st = new Physics.State(); Physics.tickWheel(f, st, 1, 0, d, 2.1, null);
		check(st.yawDeg == 0, "режим руля: стоя не поворачивает");
		// газ 40% -> держит ~40% максимума
		st = new Physics.State(); for (int i = 0; i < 600; i++) Physics.tickWheel(f, st, 0, 0.4 * 1.0526 + 0.0, d, 2.1, null);
		double target = 2.1 * Wheel.readInput(d, 0, 0.4 * 1.0526).pedal();
		check(Math.abs(st.speed - target) < 1e-6, "педаль задаёт целевую скорость (" + st.speed + ")");
		// торможение: педаль назад при движении вперёд
		st = new Physics.State(); st.speed = 1; Physics.tickWheel(f, st, 0, -1, d, 2.1, null);
		check(st.speed < 1 && st.speed > 0, "педаль назад на ходу тормозит, а не едет назад");
		// полная сила руля с 25% скорости, на стороне ссылки
		st = new Physics.State(); st.speed = 0.525; Physics.tickWheel(f, st, 1, 0, d, 2.1, null);
		check(Math.abs(Math.abs(st.yawDeg) - 2.0) < 1e-9, "на 25% скорости полный поворот 2°/тик");
		// занос: плавный руль держит сцепление, резкий на скорости срывает
		Wheel.Settings dr = new Wheel.Settings(1, 1, false, false, true);
		st = new Physics.State(); st.speed = 2.1; Physics.tickWheel(f, st, 1, 1, dr, 2.1, null);
		check(!st.sliding && st.lat == 0, "чувств. 1: сцепление держит");
		Wheel.Settings dr3 = new Wheel.Settings(3, 1, false, false, true);
		st = new Physics.State(); st.speed = 2.1; Physics.tickWheel(f, st, 1, 1, dr3, 2.1, null);
		check(st.sliding && Math.abs(st.lat) > 0, "чувств. 3 на 2.1: срыв в занос, lat=" + st.lat);
		// песок режет сцепление
		check(Drift.gripScale(f, Surface.effect("sand"), 0, 1) == 0.7 && Drift.gripScale(f, Surface.effect("snow"), 0, 1) == 0.55, "сцепление: песок 0.7, снег 0.55");
		// эмуляция: руль зажимается на топ-скорости
		st = new Physics.State(); double r = Wheel.simulateSteer(st, 1, 2.1, 2.1);
		check(Math.abs(r - 0.5 * 0.6) < 1e-9, "эмуляция: вес 0.5 и зажим 40% на топ-скорости");
		// вектор скорости с боковой составляющей
		double[] v = Physics.horizontalVelocity(0, 1, 0.5);
		check(Math.abs(v[0] - 0.5) < 1e-9 && Math.abs(v[1] - 1) < 1e-9, "вектор: вперёд +Z, вправо +X");
		check(Wheel.steerVisual(f, 1, 1) == 960, "rz:steer = 1000 - 40 = 960");
		System.out.println("ALL PASSED");
	}
}
