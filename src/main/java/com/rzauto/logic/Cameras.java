package com.rzauto.logic;

/**
 * Гоночная (main.js) и свободная GTA-камера (vehicle_freecam.js). Считаются на КЛИЕНТЕ водителя (сервер камерой не занят).
 * Мир абстрагирован интерфейсом {@link World}: клиент реализует его через raycast/BlockGetter.
 */
public final class Cameras {
	public record Vec3(double x, double y, double z) {
		Vec3 lerp(Vec3 b, double t) { return new Vec3(x + (b.x - x) * t, y + (b.y - y) * t, z + (b.z - z) * t); }
	}

	public interface World {
		/** Расстояние от origin вдоль единичного dir до первого твёрдого блока; +∞, если в пределах maxDist преград нет. */
		double hitDistance(Vec3 origin, Vec3 dir, double maxDist);
		/** Твёрдый ли блок в точке (не воздух/жидкость/проходимый). */
		boolean solidAt(double x, double y, double z);
	}

	/** Итог тика камеры. fade — на этот тик погасить экран в чёрный (камера в блоке). */
	public static final class View { public Vec3 pos, look; public boolean fade; }

	public static double forwardX(double yawDeg) { return -Math.sin(Math.toRadians(yawDeg)); }
	public static double forwardZ(double yawDeg) { return Math.cos(Math.toRadians(yawDeg)); }

	// ---------------- гоночная камера ----------------
	public record Zoom(String label, double distance, double height) {}
	public static final Zoom[] RACING_ZOOM = {new Zoom("Близко", 4, 1.7), new Zoom("Средне", 5.5, 2.35), new Zoom("Далеко", 7, 3)};
	public static final int RACING_ZOOM_DEFAULT = RACING_ZOOM.length - 1;
	static final double R_LOOK = 1.3, R_MIN_FACTOR = 0.57, R_SMOOTH = 0.25, R_CLIP_MARGIN = 0.5, R_CLIP_MIN = 1.2;
	public static final double RACING_EASE_S = 0.3, FREE_EASE_S = 0.2;

	public static final class Racing {
		private Vec3 pos, look;
		public void reset() { pos = null; look = null; }
		/** @param carYaw рыскание машины; водителю нужно выставить это же рыскание (тело по ходу машины). */
		public void tick(double baseX, double baseY, double baseZ, double carYaw, int zoomIndex, World w, View out) {
			Zoom z = RACING_ZOOM[zoomIndex >= 0 && zoomIndex < RACING_ZOOM.length ? zoomIndex : RACING_ZOOM_DEFAULT];
			double fx = forwardX(carYaw), fz = forwardZ(carYaw);
			Vec3 lookRaw = new Vec3(baseX, baseY + R_LOOK, baseZ);
			Vec3 desired = new Vec3(baseX - fx * z.distance(), baseY + z.height(), baseZ - fz * z.distance());
			Vec3 sp = pos != null ? pos.lerp(desired, R_SMOOTH) : desired;
			Vec3 sl = look != null ? look.lerp(lookRaw, R_SMOOTH) : lookRaw;

			double dx = sp.x - sl.x, dy = sp.y - sl.y, dz = sp.z - sl.z, dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
			double minD = z.distance() * R_MIN_FACTOR;
			if (dist > 1e-4 && dist < minD) { double k = minD / dist; sp = new Vec3(sl.x + dx * k, sl.y + dy * k, sl.z + dz * k); }

			dx = sp.x - sl.x; dy = sp.y - sl.y; dz = sp.z - sl.z; dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
			if (dist > 1e-4) {
				Vec3 dir = new Vec3(dx / dist, dy / dist, dz / dist);
				double hit = w.hitDistance(sl, dir, dist);
				if (hit < Double.POSITIVE_INFINITY) {
					double safe = Math.max(R_CLIP_MIN, hit - R_CLIP_MARGIN);
					if (safe < dist) sp = new Vec3(sl.x + dir.x * safe, sl.y + dir.y * safe, sl.z + dir.z * safe);
				}
			}
			out.fade = w.solidAt(sp.x, sp.y, sp.z);
			pos = sp; look = sl;
			out.pos = sp; out.look = sl;
		}
	}

	// ---------------- свободная камера (GTA) ----------------
	public static final double FREE_DIST_MIN = 2, FREE_DIST_MAX = 15, FREE_DIST_STEP = 0.5, FREE_DIST_DEFAULT = 6;
	static final double LOOK_HEIGHT = 1.3, HEIGHT_PER_DIST = 0.43, HEIGHT_MIN = 1.2, SPEED_EPS = 0.04;
	static final int REVERSE_FLIP_TICKS = 30, FORWARD_UNFLIP_TICKS = 6;
	static final double FOLLOW_RATE = 0.12, FLIP_RATE = 0.045, MIN_STEP_DEG = 0.4, LOOK_SMOOTHING = 0.3;
	static final double CLIP_MARGIN = 0.5, MIN_CAM_DIST = 1.0, PULL_IN_RATE = 0.4, RELEASE_RATE = 0.05, SIDE_OFFSET = 0.35, UP_OFFSET = 0.25, XRAY_PAD = 0.22;

	public static final class Free {
		private boolean init, flipped;
		private double heading, dist;
		private int revTicks, fwdTicks;
		private Vec3 look;
		public boolean flipped() { return flipped; }
		public double heading() { return heading; }
		public void reset() { init = false; }

		public void tick(double baseX, double baseY, double baseZ, double carYaw, double signedSpeed, double desiredDist, World w, View out) {
			Vec3 lookRaw = new Vec3(baseX, baseY + LOOK_HEIGHT, baseZ);
			if (!init) { init = true; heading = carYaw; flipped = false; revTicks = fwdTicks = 0; dist = desiredDist; look = lookRaw; }

			if (signedSpeed < -SPEED_EPS) { revTicks++; fwdTicks = 0; }
			else if (signedSpeed > SPEED_EPS) { fwdTicks++; revTicks = 0; }
			if (!flipped && revTicks >= REVERSE_FLIP_TICKS) flipped = true;
			else if (flipped && fwdTicks >= FORWARD_UNFLIP_TICKS) flipped = false;

			double target = carYaw + (flipped ? 180 : 0);
			double diff = Physics.normalizeAngle(target - heading);
			boolean swinging = Math.abs(diff) > 30 && (flipped ? revTicks > 0 : fwdTicks > 0);
			double step = diff * (swinging ? FLIP_RATE : FOLLOW_RATE);
			if (Math.abs(diff) > 0.01 && Math.abs(step) < MIN_STEP_DEG) step = Math.signum(diff) * Math.min(MIN_STEP_DEG, Math.abs(diff));
			heading = Physics.normalizeAngle(heading + step);

			look = look.lerp(lookRaw, LOOK_SMOOTHING);

			double height = Math.max(HEIGHT_MIN, desiredDist * HEIGHT_PER_DIST);
			double fx = forwardX(heading), fz = forwardZ(heading), rise = height - LOOK_HEIGHT;
			double ox = -fx * desiredDist, oy = rise, oz = -fz * desiredDist;
			double full = Math.sqrt(ox * ox + oy * oy + oz * oz);
			Vec3 dir = new Vec3(ox / full, oy / full, oz / full);

			double sx = -fz, sz = fx;
			Vec3[] origins = {look,
				new Vec3(look.x + sx * SIDE_OFFSET, look.y, look.z + sz * SIDE_OFFSET),
				new Vec3(look.x - sx * SIDE_OFFSET, look.y, look.z - sz * SIDE_OFFSET),
				new Vec3(look.x, look.y + UP_OFFSET, look.z)};
			double safe = full;
			for (Vec3 o : origins) {
				double h = w.hitDistance(o, dir, full);
				double c = h == Double.POSITIVE_INFINITY ? full : Math.min(full, Math.max(0, h - CLIP_MARGIN));
				safe = Math.min(safe, c);
			}
			safe = Math.max(MIN_CAM_DIST, safe);

			double targetDist = Math.min(full, safe);
			if (targetDist < dist) { dist += (targetDist - dist) * PULL_IN_RATE; dist = Math.min(dist, targetDist + CLIP_MARGIN * 0.5); }
			else dist += (targetDist - dist) * RELEASE_RATE;
			dist = Physics.clamp(dist, MIN_CAM_DIST, FREE_DIST_MAX * 2);

			Vec3 cam = new Vec3(look.x + dir.x * dist, look.y + dir.y * dist, look.z + dir.z * dist);
			out.fade = insideSolid(w, cam);
			out.pos = cam; out.look = look;
		}

		static boolean insideSolid(World w, Vec3 p) {
			if (w.solidAt(p.x, p.y, p.z)) return true;
			double[] d = {-XRAY_PAD, XRAY_PAD};
			for (double a : d) for (double b : d) for (double c : d) if (w.solidAt(p.x + a, p.y + b, p.z + c)) return true;
			return false;
		}
	}

	/** Камеры взаимоисключающие (меню «Камера»): включение одной выключает другую. */
	public static void setRacing(VehicleState v, boolean on) { v.racingCamera = on; if (on) v.freeCamera = false; }
	public static void setFree(VehicleState v, boolean on) { v.freeCamera = on; if (on) v.racingCamera = false; }
	public static String summary(VehicleState v) { return v.freeCamera ? "Свободная" : v.racingCamera ? "Гоночная" : "Обычная"; }
}
