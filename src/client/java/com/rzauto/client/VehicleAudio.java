package com.rzauto.client;

import com.rzauto.VehicleRegistry;
import com.rzauto.entity.VehicleEntity;
import com.rzauto.logic.Sound;
import com.rzauto.logic.Surface;
import com.rzauto.logic.VehicleSpec;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import net.minecraft.client.Minecraft;
import net.minecraft.client.resources.sounds.AbstractSoundInstance;
import net.minecraft.client.resources.sounds.SoundInstance;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.sounds.SoundSource;

/**
 * Звук двигателя на клиенте. Оригинал нарезан на куски: холостой 0.46 с, движение и дорога 0.26 с. Клиент раз в тик
 * (20 раз/с) смотрит, пора ли запустить следующий кусок слоя, и играет его с громкостью/тоном из {@link Sound.Mixer}.
 * Сервер звук не трогает. Передачи (rz.gear.*) и сирена пока не подключены.
 */
final class VehicleAudio {
	private static final double HEARD_RANGE = 48;
	private static final double IDLE_PERIOD = 8.0, MOVE_PERIOD = 4.6;   // тики между кусками (чуть короче длины куска, чтобы не было щелей)

	private static final class St {
		final Sound.Mixer mixer = new Sound.Mixer();
		double x, z; boolean init;
		double speed;
		double idleT, moveT;
		final double[] roadT = new double[Surface.ROAD_KEYS.length];
	}

	private static final Map<VehicleEntity, St> STATE = new HashMap<>();
	private static final java.util.Random RND = new java.util.Random();

	private static final class Shot extends AbstractSoundInstance {
		Shot(Identifier id, float vol, float pitch, double x, double y, double z) {
			super(id, SoundSource.NEUTRAL, SoundInstance.createUnseededRandom());
			this.volume = vol; this.pitch = pitch; this.x = x; this.y = y; this.z = z;
		}
	}

	/** Сирена: зацикленный звук, привязан к машине, пока сирена включена. */
	private static final class Siren extends net.minecraft.client.resources.sounds.AbstractTickableSoundInstance {
		private final VehicleEntity car;
		Siren(VehicleEntity car) {
			super(net.minecraft.sounds.SoundEvent.createVariableRangeEvent(Identifier.fromNamespaceAndPath("rz_auto", "explorer.siren")), SoundSource.NEUTRAL, SoundInstance.createUnseededRandom());
			this.car = car; this.looping = true; this.volume = 1.4f; this.pitch = 1f;
			this.x = car.getX(); this.y = car.getY(); this.z = car.getZ();
		}
		@Override public void tick() {
			if (car.isRemoved() || !car.sirenOn()) { stop(); return; }
			this.x = car.getX(); this.y = car.getY(); this.z = car.getZ();
		}
	}
	private static final Map<VehicleEntity, Siren> SIRENS = new HashMap<>();

	private static void sirens(Minecraft mc) {
		for (net.minecraft.world.entity.Entity ent : mc.level.entitiesForRendering()) {
			if (ent instanceof VehicleEntity e && !e.isRemoved() && e.sirenOn() && !SIRENS.containsKey(e)) {
				Siren si = new Siren(e);
				SIRENS.put(e, si);
				mc.getSoundManager().play(si);
			}
		}
		SIRENS.entrySet().removeIf(en -> en.getKey().isRemoved() || !en.getKey().sirenOn());
	}

	private static void play(String event, double vol, double pitch, VehicleEntity e) {
		Minecraft.getInstance().getSoundManager().play(new Shot(Identifier.fromNamespaceAndPath("rz_auto", event),
			(float) Math.min(vol, 1.6), (float) Math.max(0.5, Math.min(2.0, pitch)), e.getX(), e.getY(), e.getZ()));
	}

	static void tick(Minecraft mc) {
		if (mc.level == null || mc.player == null) { STATE.clear(); SIRENS.clear(); return; }
		sirens(mc);
		for (net.minecraft.world.entity.Entity ent : mc.level.entitiesForRendering()) {
			if (!(ent instanceof VehicleEntity e) || e.isRemoved()) continue;
			if (e.distanceToSqr(mc.player) > HEARD_RANGE * HEARD_RANGE) continue;
			STATE.computeIfAbsent(e, k -> new St());
		}
		float master = 1f;
		Iterator<Map.Entry<VehicleEntity, St>> it = STATE.entrySet().iterator();
		while (it.hasNext()) {
			Map.Entry<VehicleEntity, St> en = it.next();
			VehicleEntity e = en.getKey(); St s = en.getValue();
			if (e.isRemoved() || e.distanceToSqr(mc.player) > (HEARD_RANGE + 8) * (HEARD_RANGE + 8)) { it.remove(); continue; }
			VehicleSpec spec = VehicleRegistry.specOf(e.getType());
			if (spec == null) { it.remove(); continue; }
			double dx = e.getX() - s.x, dz = e.getZ() - s.z;
			double v = s.init ? Math.hypot(dx, dz) : 0;   // блоков за тик = внутренняя скорость
			s.speed += (v - s.speed) * 0.5; s.x = e.getX(); s.z = e.getZ(); s.init = true;
			boolean engineOn = !e.getPassengers().isEmpty();
			String surface = BuiltInRegistries.BLOCK.getKey(mc.level.getBlockState(e.blockPosition().below()).getBlock()).toString();
			s.mixer.update(spec, engineOn, s.speed, spec.topSpeed(), e.onGround(), surface, false, 0, master);
			if (s.mixer.silent(engineOn, s.speed)) { it.remove(); continue; }
			Sound.Profile pr = Sound.profile(spec.bedrockId());
			boolean moto = pr.idle().equals("moto");
			if (--s.idleT <= 0 && s.mixer.audible(s.mixer.idleVolume, s.mixer.idleLevel)) {
				s.idleT += IDLE_PERIOD;
				play(String.format("rz.idle.%s.%02d", pr.idle(), RND.nextInt(moto ? 15 : 24)), s.mixer.idleVolume, 1.0, e);
			} else if (s.idleT < -2) s.idleT = 0;
			if (--s.moveT <= 0 && s.mixer.audible(s.mixer.moveVolume, s.mixer.moveLevel)) {
				s.moveT += MOVE_PERIOD;
				play(String.format("rz.move.%s.%02d", pr.move(), RND.nextInt(25)), s.mixer.moveVolume, s.mixer.pitchMoveOut, e);
			} else if (s.moveT < -2) s.moveT = 0;
			for (int i = 0; i < s.roadT.length; i++) {
				if (--s.roadT[i] <= 0 && s.mixer.audible(s.mixer.roadVolume[i], s.mixer.roadLevel[i])) {
					s.roadT[i] += MOVE_PERIOD;
					play(String.format("rz.road.%s.%02d", Surface.ROAD_KEYS[i], RND.nextInt(25)), s.mixer.roadVolume[i], s.mixer.pitchRoadOut, e);
				} else if (s.roadT[i] < -2) s.roadT[i] = 0;
			}
		}
	}
}
