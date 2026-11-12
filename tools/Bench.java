import com.rzauto.logic.*;
import com.rzauto.perf.*;
/** Грубая оценка: 1000 машин, из них 20 едут. «Наивно» = как в оригинале (все тикают каждый тик, всё считается заново). Прогрев JIT, медиана. */
public class Bench {
	static final int N = 1000, DRIVEN = 20, TICKS = 600;
	static VehicleSpec spec = new VehicleSpec("f458:blue","f458:",false,2.1,0.5,2,500000,10000,new int[]{0,0,0,90,100},3,2,2,2,1.2,20);
	static double sink;
	static long naive() {
		Physics.State[] st = new Physics.State[N]; for (int i = 0; i < N; i++) st[i] = new Physics.State();
		long t0 = System.nanoTime();
		for (int t = 0; t < TICKS; t++) for (int i = 0; i < N; i++) {
			boolean d = i < DRIVEN;
			Physics.tick(spec, st[i], new Physics.Input(d ? Math.sin(t * 0.05) : 0, d ? 1 : 0), 2.1, false, 1);
			double[] v = Physics.horizontalVelocity(st[i].yawDeg, st[i].speed, st[i].lat);
			Quantize.speed(v[0]); sink += v[0] + (Surface.effect(i % 3 == 0 ? "sand" : "stone") == null ? 0 : 1) * 0;
		}
		return System.nanoTime() - t0;
	}
	static long optimized() {
		Physics.State[] st = new Physics.State[N]; NetSync[] ns = new NetSync[N]; for (int i = 0; i < N; i++) { st[i] = new Physics.State(); ns[i] = new NetSync(); }
		ActiveSet act = new ActiveSet(); for (int i = 0; i < DRIVEN; i++) act.add(i);
		double[] v = new double[2];
		long t0 = System.nanoTime();
		for (int t = 0; t < TICKS; t++) for (int k = act.size() - 1; k >= 0; k--) {
			int i = act.get(k);
			Physics.tick(spec, st[i], new Physics.Input(Math.sin(t * 0.05), 1), 2.1, false, 1);
			Physics.horizontalVelocity(st[i].yawDeg, st[i].speed, st[i].lat, v);
			if (ns[i].poll(t, st[i].speed, st[i].yawDeg, st[i].lat, st[i].steer, 2)) sink += v[0];
		}
		return System.nanoTime() - t0;
	}
	public static void main(String[] a) {
		for (int i = 0; i < 5; i++) { naive(); optimized(); }
		long[] n = new long[7], o = new long[7];
		for (int i = 0; i < 7; i++) { n[i] = naive(); o[i] = optimized(); }
		java.util.Arrays.sort(n); java.util.Arrays.sort(o);
		System.out.printf("naive: %.1f us/tick, optimized: %.1f us/tick, x%.1f%n", n[3] / 1000.0 / TICKS, o[3] / 1000.0 / TICKS, (double) n[3] / o[3]);
	}
}
