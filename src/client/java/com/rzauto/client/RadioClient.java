package com.rzauto.client;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.rzauto.RzAutoMod;
import com.rzauto.entity.VehicleEntity;
import com.rzauto.net.VehicleActionPayload;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.Component;
import javax.sound.sampled.AudioFormat;
import javax.sound.sampled.AudioSystem;
import javax.sound.sampled.SourceDataLine;
import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * Радио в машинах, целиком на клиенте и по желанию игрока. Сервер хранит только номер станции у машины (одно число).
 * Пока у игрока «Приём радио» выключен (по умолчанию), здесь не происходит ничего: ни сети, ни потоков, ни декодера.
 * Если включён, ближайшая машина с радио в радиусе 40 блоков играет свою станцию с затуханием по расстоянию (в салоне полная громкость).
 * Поток читает каждый игрок сам напрямую (MP3), сервер звук не передаёт.
 */
final class RadioClient {
	record Station(String name, String url) {}

	/** Прямой MP3-поток Маруся ФМ (дал владелец). */
	static final String MARUSYA_URL = "http://radio-holding.ru:9000/marusya_default";
	/** Станции по умолчанию (после Маруси ФМ). Порядок менять нельзя: в машине хранится номер станции; новые добавлять только в конец.
	 * Ссылки помеченные (?) не проверялись из песочницы: если станция молчит, поправьте url в config/rz_auto_radio.json. */
	static final String[][] DEFAULTS = {
		{ "Европа Плюс", "https://europaplus.hostingradio.ru:8030/ep128" },
		{ "Русское Радио", "https://rusradio.hostingradio.ru/rusradio128.mp3" },
		{ "Радио Рекорд", "http://air.radiorecord.ru:8101/rr_320" },                       // (?)
		{ "Record Супердискотека 90-х", "http://online.radiorecord.ru:8102/sd90_128" },
		{ "Маяк", "http://icecast.vgtrk.cdnvideo.ru/mayakfm_mp3_192kbps" },               // (?)
		{ "Вести ФМ", "http://icecast.vgtrk.cdnvideo.ru/vestifm_mp3_128kbps" },
		{ "Радио России", "http://icecast.vgtrk.cdnvideo.ru/rr_mp3_192kbps" },            // (?)
		{ "Радио Культура", "http://icecast.vgtrk.cdnvideo.ru/kulturafm_mp3_192kbps" },   // (?)
		{ "Коммерсантъ FM", "http://kommersant77.hostingradio.ru:8016/kommersant128.mp3" }, // (?)
		{ "Комсомольская Правда", "http://kpradio.hostingradio.ru:8000/128" },            // (?)
		{ "Хайп FM", "https://hfm.amgradio.ru/HypeFM" },
		{ "AniSon FM", "http://pool.anison.fm:9000/AniSonFM(320)" } };
	/** Ступени громкости: у нуля мелкий шаг, чтобы можно было сделать почти беззвучно или выключить совсем. */
	static final float[] VOL_STEPS = { 0f, 0.01f, 0.02f, 0.04f, 0.06f, 0.08f, 0.1f, 0.15f, 0.2f, 0.3f, 0.4f, 0.5f, 0.6f, 0.7f, 0.8f, 0.9f, 1f };
	static final double RADIUS = 40.0;
	static boolean enabled;
	static float volume = 0.8f;
	static final List<Station> stations = new ArrayList<>();
	static int lastIdx;
	/** Состояние для меню: пусто, «подключение…», «играет», «ошибка …». */
	static volatile String status = "";

	private static final Path FILE = net.fabricmc.loader.api.FabricLoader.getInstance().getConfigDir().resolve("rz_auto_radio.json");

	static void load() {
		stations.clear();
		try {
			if (Files.exists(FILE)) {
				JsonObject o = JsonParser.parseString(Files.readString(FILE)).getAsJsonObject();
				if (o.has("radioEnabled")) enabled = o.get("radioEnabled").getAsBoolean();
				if (o.has("radioVolume")) volume = Math.max(0f, Math.min(1f, o.get("radioVolume").getAsFloat()));
				if (o.has("stations")) for (var e : o.getAsJsonArray("stations")) {
					JsonObject s = e.getAsJsonObject();
					stations.add(new Station(s.has("name") ? s.get("name").getAsString() : "Станция", s.has("url") ? s.get("url").getAsString().trim() : ""));
				}
			}
		} catch (Exception ex) { RzAutoMod.LOG.warn("rz_auto_radio.json не прочитался: {}", ex.toString()); }
		if (stations.isEmpty()) stations.add(new Station("Маруся ФМ", MARUSYA_URL));
		// добавить станции по умолчанию, которых ещё нет (по названию); порядок существующих не меняется
		for (String[] d : DEFAULTS) {
			boolean has = false;
			for (Station st : stations) if (st.name().equalsIgnoreCase(d[0])) { has = true; break; }
			if (!has) stations.add(new Station(d[0], d[1]));
		}
		// старый конфиг с пустой ссылкой у Маруси ФМ: подставляем поток
		for (int i = 0; i < stations.size(); i++) {
			Station st = stations.get(i);
			if (st.url().isEmpty() && st.name().equals("Маруся ФМ")) stations.set(i, new Station(st.name(), MARUSYA_URL));
		}
		save();
	}

	static void save() {
		try {
			JsonObject o = new JsonObject();
			o.addProperty("_help", "radioEnabled: принимать радио из машин (true/false). radioVolume: 0.0..1.0 (0 = тишина). stations: name и url ПРЯМОГО MP3-потока (не страницы сайта). Порядок станций лучше держать одинаковым у всех игроков сервера: в машине хранится номер станции.");
			o.addProperty("radioEnabled", enabled);
			o.addProperty("radioVolume", Math.round(volume * 100) / 100.0);
			JsonArray a = new JsonArray();
			for (Station s : stations) { JsonObject so = new JsonObject(); so.addProperty("name", s.name()); so.addProperty("url", s.url()); a.add(so); }
			o.add("stations", a);
			Files.writeString(FILE, new Gson().newBuilder().setPrettyPrinting().create().toJson(o));
		} catch (Exception ignored) { }
	}

	static void addVolume(float d) {
		int cur = 0;
		for (int i = 0; i < VOL_STEPS.length; i++) if (Math.abs(VOL_STEPS[i] - volume) < Math.abs(VOL_STEPS[cur] - volume)) cur = i;
		if (d > 0 && VOL_STEPS[cur] <= volume + 1e-4f) cur++;
		else if (d < 0 && VOL_STEPS[cur] >= volume - 1e-4f) cur--;
		volume = VOL_STEPS[Math.max(0, Math.min(VOL_STEPS.length - 1, cur))];
		save();
	}

	static void setEnabled(boolean v) { enabled = v; if (!v) stop(); save(); }

	static String stationName(int idx) { return idx >= 0 && idx < stations.size() ? stations.get(idx).name() : "Станция " + (idx + 1); }

	// ---- управление: серверу уходит только номер станции ----
	static void toggle(Minecraft mc, VehicleEntity ve) {
		if (ve.radioValue() > 0) { ClientPlayNetworking.send(new VehicleActionPayload(ve.getId(), VehicleEntity.ACT_RADIO_OFF)); return; }
		sendStation(mc, ve, Math.max(0, Math.min(lastIdx, stations.size() - 1)));
	}

	static void step(Minecraft mc, VehicleEntity ve, int dir) {
		int n = stations.size();
		int idx = ve.radioValue() > 0 ? ve.radioValue() - 1 : lastIdx;
		sendStation(mc, ve, ((idx + dir) % n + n) % n);
	}

	private static void sendStation(Minecraft mc, VehicleEntity ve, int idx) {
		lastIdx = idx;
		ClientPlayNetworking.send(new VehicleActionPayload(ve.getId(), VehicleEntity.ACT_RADIO_BASE + Math.min(idx, VehicleEntity.RADIO_MAX - 1)));
		Station st = stations.get(idx);
		String msg = !enabled ? "Радио: " + st.name() + " (у вас выключен «Приём радио», включите в меню)"
			: st.url().isEmpty() ? "Радио: " + st.name() + ": впишите ссылку потока в config/rz_auto_radio.json" : "Радио: " + st.name();
		if (mc.gui != null) mc.gui.hud.setOverlayMessage(Component.literal(msg), false);
	}

	// ---- приём ----
	private static Receiver rx;
	private static String playingUrl = "";
	private static long idleSince;

	static void tick(Minecraft mc) {
		if (!enabled || mc.level == null || mc.player == null) { if (rx != null) stop(); return; }
		if (mc.player.tickCount % 4 != 0) return;
		String bestUrl = null;
		double bestGain = 0;
		for (VehicleEntity e : ClientVehicles.LIST) {
			if (e.isRemoved()) continue;
			int r = e.radioValue();
			if (r <= 0 || r - 1 >= stations.size()) continue;
			String url = stations.get(r - 1).url();
			if (url.isEmpty()) continue;
			boolean inCar = mc.player.getVehicle() == e;
			double d = Math.sqrt(e.distanceToSqr(mc.player));
			if (!inCar && d >= RADIUS) continue;
			double g = inCar ? 1.0 : Math.pow(1.0 - d / RADIUS, 2.0);   // затухание до нуля на 40 блоках
			if (g > bestGain) { bestGain = g; bestUrl = url; }
		}
		long now = System.currentTimeMillis();
		if (bestUrl == null) {
			if (rx != null) { rx.target = 0f; if (now - idleSince > 8000) stop(); }
			return;
		}
		idleSince = now;
		if (rx == null || !bestUrl.equals(playingUrl)) { stop(); start(bestUrl); }
		if (rx != null) rx.target = (float) (bestGain * volume);
	}

	private static void start(String url) {
		playingUrl = url;
		rx = new Receiver(url);
		status = "подключение…";
		Thread t = new Thread(rx, "rz_auto-radio");
		t.setDaemon(true);
		rx.thread = t;
		t.start();
	}

	static void stop() {
		Receiver p = rx;
		rx = null; playingUrl = "";
		if (p != null) p.close();
		status = "";
	}

	/** Поток: HTTP -> MP3 (JLayer) -> звуковая карта (Java Sound); громкость плавно тянется к target. */
	private static final class Receiver implements Runnable {
		final String url;
		volatile boolean stop;
		volatile float target;
		float cur;
		Thread thread;
		private volatile HttpURLConnection conn;
		private volatile SourceDataLine line;

		Receiver(String url) { this.url = url; }

		void close() {
			stop = true;
			try { HttpURLConnection c = conn; if (c != null) c.disconnect(); } catch (Throwable ignored) { }
			if (thread != null) thread.interrupt();
		}

		@Override
		public void run() {
			int fails = 0;
			while (!stop) {
				try {
					int frames = playOnce();
					fails = frames > 50 ? 0 : fails + 1;
				} catch (Throwable t) {
					if (stop) break;
					fails++;
					RzAutoMod.LOG.warn("Радио: {}", t.toString());
				}
				if (stop) break;
				if (fails >= 4) { status = "ошибка потока (нужен прямой MP3-поток)"; break; }
				status = "переподключение…";
				try { Thread.sleep(Math.min(20000, 2000L * Math.max(1, fails))); } catch (InterruptedException e) { break; }
			}
			closeLine();
		}

		private void closeLine() {
			SourceDataLine l = line; line = null;
			if (l != null) try { l.stop(); l.flush(); l.close(); } catch (Throwable ignored) { }
		}

		private InputStream open(String u) throws Exception {
			for (int hop = 0; hop < 6; hop++) {
				HttpURLConnection c = (HttpURLConnection) URI.create(u).toURL().openConnection();
				conn = c;
				c.setConnectTimeout(8000); c.setReadTimeout(15000); c.setInstanceFollowRedirects(false);
				c.setRequestProperty("User-Agent", "RZAuto-Minecraft-Mod/0.1");
				int code = c.getResponseCode();
				if (code >= 300 && code < 400 && c.getHeaderField("Location") != null) { u = URI.create(u).resolve(c.getHeaderField("Location")).toString(); c.disconnect(); continue; }
				if (code != 200) throw new java.io.IOException("HTTP " + code);
				String ct = String.valueOf(c.getContentType()).toLowerCase();
				if (ct.startsWith("text/") || ct.contains("mpegurl") || ct.contains("scpls") || u.endsWith(".m3u") || u.endsWith(".pls")) {
					String next = null;
					try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
						String ln; int cnt = 0;
						while ((ln = r.readLine()) != null && cnt++ < 200) { ln = ln.trim(); if (ln.startsWith("File1=")) ln = ln.substring(6); if (ln.startsWith("http")) { next = ln; break; } }
					}
					c.disconnect();
					if (next == null) throw new java.io.IOException("плейлист без ссылок");
					u = next; continue;
				}
				return new BufferedInputStream(c.getInputStream(), 1 << 16);
			}
			throw new java.io.IOException("слишком много перенаправлений");
		}

		private int playOnce() throws Exception {
			int frames = 0;
			try (InputStream in = open(url)) {
				javazoom.jl.decoder.Bitstream bs = new javazoom.jl.decoder.Bitstream(in);
				javazoom.jl.decoder.Decoder dec = new javazoom.jl.decoder.Decoder();
				byte[] buf = new byte[0];
				while (!stop) {
					javazoom.jl.decoder.Header h = bs.readFrame();
					if (h == null) break;
					javazoom.jl.decoder.SampleBuffer sb = (javazoom.jl.decoder.SampleBuffer) dec.decodeFrame(h, bs);
					bs.closeFrame();
					if (line == null) {
						AudioFormat af = new AudioFormat(sb.getSampleFrequency(), 16, sb.getChannelCount(), true, false);
						SourceDataLine l = AudioSystem.getSourceDataLine(af);
						l.open(af, sb.getSampleFrequency() * sb.getChannelCount());   // ~0,5 с буфера
						l.start();
						line = l;
						status = "играет";
					}
					short[] pcm = sb.getBuffer();
					int n = sb.getBufferLength();
					if (buf.length < n * 2) buf = new byte[n * 2];
					cur += (target - cur) * 0.25f;
					float g = cur < 0.003f ? 0f : cur;
					for (int i = 0; i < n; i++) {
						int v = Math.max(-32768, Math.min(32767, Math.round(pcm[i] * g)));
						buf[i * 2] = (byte) v; buf[i * 2 + 1] = (byte) (v >> 8);
					}
					line.write(buf, 0, n * 2);
					frames++;
				}
			} finally { conn = null; }
			return frames;
		}
	}
}
