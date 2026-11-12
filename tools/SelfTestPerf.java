import com.rzauto.logic.*;
import com.rzauto.perf.*;
public class SelfTestPerf {
	static void check(boolean ok, String m) { System.out.println((ok ? "OK   " : "FAIL ") + m); if (!ok) System.exit(1); }
	public static void main(String[] a) {
		// сжатие
		double maxE = 0, maxY = 0;
		for (double v = -3; v <= 3; v += 0.00137) maxE = Math.max(maxE, Math.abs(Quantize.speed(Quantize.speed(v)) - v));
		for (double y = -180; y <= 180; y += 0.0173) { double d = Math.abs(Quantize.yaw(Quantize.yaw(y)) - y); d = Math.min(d, 360 - d); maxY = Math.max(maxY, d); }
		check(maxE <= 0.0005 + 1e-12, "скорость: ошибка ≤ 0.0005 (" + maxE + ")");
		check(maxY <= 0.0055 + 1e-9, "угол: ошибка ≤ 0.0055° (" + maxY + ")");
		check(Math.abs(Quantize.yaw(Quantize.yaw(179.999)) - 179.999) < 0.006 && Math.abs(Math.abs(Quantize.yaw(Quantize.yaw(-180))) - 180) < 0.006, "угол на шве ±180");
		// сеть: за 20 тиков езды при interval 2 — 10 пакетов, а не 20; стоя — почти ноль
		NetSync n = new NetSync(); int sent = 0;
		for (int t = 0; t < 20; t++) if (n.poll(t, 1 + t * 0.01, t * 0.5, 0, 0, 2)) sent++;
		check(sent <= 11 && sent >= 9, "езда: пакетов за 20 тиков = " + sent + " (вместо 20)");
		NetSync s = new NetSync(); sent = 0;
		for (int t = 0; t < 1000; t++) if (s.poll(t, 0, 90, 0, 0, 2)) sent++;
		check(sent == 10, "стоит 50 с: " + sent + " пакетов (сердцебиение раз в 5 с)");
		NetSync u = new NetSync(); u.poll(0, 2, 0, 0, 0, 4);
		check(u.poll(1, 0.5, 0, 0, 0, 4), "резкое торможение шлётся сразу, не ждёт интервал");
		check(u.poll(2, 0.5, 30, 0, 0, 4), "резкий поворот шлётся сразу");
		// фаза
		int on = 0; for (int id = 0; id < 100; id++) if (Throttle.due(7, id, 5)) on++;
		check(on == 20, "из 100 машин в тик задачу делают 20 (размазано), а не все 100");
		// активный набор
		ActiveSet set = new ActiveSet();
		for (int i = 0; i < 1000; i++) set.add(i * 7919);
		check(set.size() == 1000 && !set.add(7919), "набор: 1000 без дублей");
		for (int i = 0; i < 1000; i += 2) set.remove(i * 7919);
		boolean ok = set.size() == 500; for (int i = 0; i < set.size(); i++) ok &= set.contains(set.get(i)) && (set.get(i) / 7919) % 2 == 1;
		check(ok, "swap-remove сохраняет целостность");
		// сон
		Physics.State st = new Physics.State(); st.speed = 1;
		check(!Idle.canSleep(st, false, true) && !Idle.canSleep(st, true, true), "едущая/занятая не спит");
		int ticks = 0; while (!Idle.canSleep(st, false, true)) { Idle.coast(st, 0.5); ticks++; if (ticks > 1000) break; }
		check(ticks == 40 || ticks == 41, "пустая машина с 1.0 останавливается и засыпает за " + ticks + " тиков");
		check(!Idle.canSleep(st, false, false), "в воздухе не спит");
		// кэш покрытия
		SurfaceCache c = new SurfaceCache(); int[] calls = {0};
		for (int t = 0; t < 100; t++) c.get(t, 10, 64, 10, (x, y, z) -> { calls[0]++; return "sand"; });
		check(calls[0] == 5, "стоящая машина: 5 чтений мира за 100 тиков вместо 100 (" + calls[0] + ")");
		for (int t = 100; t < 110; t++) c.get(t, 10 + t, 64, 10, (x, y, z) -> { calls[0]++; return "sand"; });
		check(calls[0] >= 15, "смена блока — читаем заново");
		check(Surface.effect("sand") == Surface.effect("red_sand"), "Surface.effect без аллокаций");
		// регулятор
		Governor g = new Governor();
		for (int i = 0; i < 100; i++) g.update(20);
		check(g.level() == 0 && g.particlesAllowed() && g.syncInterval() == 2, "20 мс: норма");
		for (int i = 0; i < 100; i++) g.update(40);
		check(g.level() == 1, "40 мс: уровень 1");
		for (int i = 0; i < 100; i++) g.update(55);
		check(g.level() == 3 && !g.particlesAllowed() && g.syncInterval() == 6 && g.effectRadius() == 0, "55 мс: аварийный, частицы выкл.");
		for (int i = 0; i < 100; i++) g.update(36);
		check(g.level() == 1, "гистерезис: вернулись на 1 при 36 мс");
		for (int i = 0; i < 200; i++) g.update(10);
		check(g.level() == 0, "10 мс: обратно норма");
		// скорость без аллокаций совпадает
		double[] o = new double[2], r = Physics.horizontalVelocity(37, 1.3, 0.2); Physics.horizontalVelocity(37, 1.3, 0.2, o);
		check(o[0] == r[0] && o[1] == r[1], "horizontalVelocity(out) идентична");
		System.out.println("ALL PASSED");
	}
}
