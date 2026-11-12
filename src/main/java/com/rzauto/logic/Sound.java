package com.rzauto.logic;

/**
 * vehicle_sound.js, КЛИЕНТСКАЯ часть. В Bedrock звук резался на куски по 0.2–0.4 с и запускался сервером ~5 раз в секунду
 * на каждую машину (тяжело). В Java клиент играет по 3 зацикленных SoundInstance (холостой / двигатель / покрытие),
 * следующих за сущностью, а сервер звук не трогает вовсе. Здесь — вся математика микса: уровни слоёв, тон, смена передач.
 */
public final class Sound {
	/** Профиль двигателя: ключ холостого (assets/rz_auto/sounds/idle/<ключ>), категория движения. Первое совпадение префикса. */
	public record Profile(String prefix, String idle, String move, double idleVol, double moveVol) {}
	private static Profile p(String a, String b, String c) { return new Profile(a, b, c, 1, 1); }
	public static final Profile[] PROFILES = {
		p("bmw:e46", "e46s54", "jeep"), p("bmw:m3", "g80s58", "jeep"), p("bmw:f30", "g80s58", "jeep"), p("bmw:f31", "g80s58", "jeep"),
		p("ford:", "v8classic", "jeep"), p("maybach:", "v8sc", "jeep"), p("jeep:yj", "yj", "jeep"), p("jeep:xj", "xj", "jeep"),
		p("toyota:", "e46s54", "jeep"), p("chevrolet:", "c2", "jeep"), p("porsche:", "flat6", "jeep"), p("p911t:", "p911t", "jeep"),
		p("f458:", "f40", "jeep"), p("ferrari:", "f40", "jeep"), p("laf:", "laf", "jeep"), p("lamborghini:", "v12", "jeep"),
		p("koenigsegg:", "v8sc", "jeep"), p("mcl:", "v8sc", "jeep"),
		p("ducati:", "moto", "moto"), p("ktm:", "moto", "moto"), p("yamaha:", "moto", "moto"),
	};
	public static final Profile DEFAULT = p("", "e46s54", "jeep");

	public static Profile profile(String bedrockId) {
		for (Profile pr : PROFILES) if (bedrockId.startsWith(pr.prefix())) return pr;
		return DEFAULT;
	}

	// ---- микс (значения оригинала)
	public static final double IDLE_VOLUME = 1.25, MOVE_VOLUME = 1.45, ROAD_VOLUME = 1.2, GEAR_VOLUME = 1.4;
	public static final double MIX_FROM = 0.03, MIX_TO = 0.30, ROAD_FROM = 0.02, ROAD_TO = 0.45;
	public static final double MOVE_PITCH_MIN = 0.94, MOVE_PITCH_MAX = 1.12, ROAD_PITCH_MIN = 0.92, ROAD_PITCH_MAX = 1.15, PITCH_SMOOTH = 0.2;
	public static final double IDLE_UP = 0.22, IDLE_DOWN = 0.12, MOVE_UP = 0.16, MOVE_DOWN = 0.07, ROAD_UP = 0.18, ROAD_DOWN = 0.08, STOP_DOWN = 0.2;
	public static final double MIN_AUDIBLE = 0.04, MIN_MOVING = 0.05;
	public static final int GEAR_UP_VARIANTS = 4;

	static double clamp01(double x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
	static double smooth(double a, double b, double x) { double t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }
	static double approach(double v, double target, double up, double down) { return v + (target - v) * (target > v ? up : down); }

	/** Состояние звука одной машины на клиенте. */
	public static final class Mixer {
		public double idleLevel, moveLevel, pitchMove = 1, pitchRoad = 1;
		public final double[] roadLevel = new double[Surface.ROAD_KEYS.length];
		private int lastGear = -1;   // -1 = не отслеживаем

		// ---- выходы (для SoundInstance): итоговая громкость слоя и тон
		public double idleVolume, moveVolume, pitchMoveOut, pitchRoadOut;
		public final double[] roadVolume = new double[Surface.ROAD_KEYS.length];
		/** +1 повышение, −1 понижение, 0 — нет; выбирать звук rz.gear.up1..4 / rz.gear.down. */
		public int gearShift;

		/**
		 * @param engineOn   двигатель заведён и водитель на месте (DriveGate OK, state с сервера)
		 * @param speed      внутренняя скорость (бл/тик), maxSpeed — текущий лимит, top — паспортная скорость
		 * @param gearMode,gear  режим передач и текущая передача (для звука переключения)
		 * @param master     общая громкость 0..2
		 */
		public void update(VehicleSpec s, boolean engineOn, double speed, double maxSpeed, boolean grounded, String surfaceBlockId,
				boolean gearMode, int gear, double master) {
			Profile pr = profile(s.bedrockId());
			double v = Math.abs(speed);
			double top = Math.max(s.topSpeed(), 0.05);
			double ref = Math.max(Math.min(top, maxSpeed), 0.05);
			double rev = v / ref, speedRel = v / top;

			double x = smooth(MIX_FROM, MIX_TO, rev);
			double idleT = engineOn ? Math.cos(x * Math.PI / 2) : 0, moveT = engineOn ? Math.sin(x * Math.PI / 2) : 0;
			idleLevel = approach(idleLevel, idleT, IDLE_UP, engineOn ? IDLE_DOWN : STOP_DOWN);
			moveLevel = approach(moveLevel, moveT, MOVE_UP, engineOn ? MOVE_DOWN : STOP_DOWN);

			Surface.Road road = grounded ? Surface.roadSound(surfaceBlockId) : null;
			double roadMix = smooth(ROAD_FROM, ROAD_TO, speedRel);
			for (int i = 0; i < roadLevel.length; i++) {
				double target = (road != null && road.key().equals(Surface.ROAD_KEYS[i])) ? roadMix * road.vol() : 0;
				double next = approach(roadLevel[i], target, ROAD_UP, ROAD_DOWN);
				roadLevel[i] = (next < 0.005 && target == 0) ? 0 : next;
			}
			pitchMove += (MOVE_PITCH_MIN + (MOVE_PITCH_MAX - MOVE_PITCH_MIN) * clamp01(rev) - pitchMove) * PITCH_SMOOTH;
			pitchRoad += (ROAD_PITCH_MIN + (ROAD_PITCH_MAX - ROAD_PITCH_MIN) * clamp01(speedRel) - pitchRoad) * PITCH_SMOOTH;

			gearShift = 0;
			if (engineOn && gearMode) {
				if (lastGear >= 0 && gear != lastGear) gearShift = gear > lastGear ? 1 : -1;
				lastGear = gear;
			} else lastGear = -1;

			idleVolume = idleLevel * pr.idleVol() * IDLE_VOLUME * master;
			moveVolume = moveLevel * pr.moveVol() * MOVE_VOLUME * master;
			pitchMoveOut = pitchMove; pitchRoadOut = pitchRoad;
			for (int i = 0; i < roadLevel.length; i++) roadVolume[i] = roadLevel[i] * ROAD_VOLUME * master;
		}

		/** Слой слышен (иначе SoundInstance можно останавливать). */
		public boolean audible(double volume, double level) { return level > MIN_AUDIBLE && volume > 0; }

		/** Всё затихло, стоим, двигатель выключен — состояние можно забыть. */
		public boolean silent(boolean engineOn, double speed) {
			if (engineOn || Math.abs(speed) >= MIN_MOVING || idleLevel >= 0.01 || moveLevel >= 0.01) return false;
			for (double r : roadLevel) if (r > 0) return false;
			return true;
		}
	}
}
