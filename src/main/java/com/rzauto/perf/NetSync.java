package com.rzauto.perf;

/**
 * Решает, нужно ли слать состояние машины клиентам. Сервер НЕ шлёт пакет каждый тик:
 *  - едущая машина — раз в {@code interval} тиков (клиент интерполирует и предсказывает по скорости/руля);
 *  - если ничего не изменилось (стоит) — только «сердцебиение» раз в {@link #HEARTBEAT} тиков;
 *  - резкое изменение (удар, остановка, срыв в занос) шлётся сразу.
 * Состояние на машину — 4 short + номер тика, без аллокаций.
 */
public final class NetSync {
	public static final int HEARTBEAT = 100;            // 5 с
	public static final int SPEED_JUMP = 150;           // 0.15 бл/тик за один тик = резкое изменение (в единицах кванта 0.001)
	public static final int YAW_JUMP = 1820;            // ≈10°

	private short sSpeed, sYaw, sLat, sSteer;
	private long lastSent = Long.MIN_VALUE / 2;
	private boolean everSent;

	/** @return true, если пора слать; тогда внутреннее «последнее отправленное» обновляется. */
	public boolean poll(long tick, double speed, double yawDeg, double lat, double steer, int interval) {
		short qs = Quantize.speed(speed), qy = Quantize.yaw(yawDeg), ql = Quantize.speed(lat), qt = Quantize.steer(steer);
		boolean changed = qs != sSpeed || qy != sYaw || ql != sLat || qt != sSteer;
		long since = tick - lastSent;
		boolean urgent = everSent && (Math.abs(qs - sSpeed) >= SPEED_JUMP || Math.abs(((qy - sYaw + 32768) & 0xFFFF) - 32768) >= YAW_JUMP);
		boolean send = !everSent || urgent || (changed && since >= interval) || since >= HEARTBEAT;
		if (send) { sSpeed = qs; sYaw = qy; sLat = ql; sSteer = qt; lastSent = tick; everSent = true; }
		return send;
	}
	public short speed() { return sSpeed; }
	public short yaw() { return sYaw; }
	public short lat() { return sLat; }
	public short steer() { return sSteer; }
}
