package com.rzauto.passport;

import com.google.gson.*;
import com.rzauto.entity.VehicleEntity;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import net.fabricmc.loader.api.FabricLoader;

/** Серверное хранилище: нарушения игроков, их машины, известные ники. Файл config/rz_auto_passports.json. */
public final class PassportStore {
	private PassportStore() {}

	public record Violation(String text, String date, String country, int seal, String issuer) {}
	public record CarRec(String name, int x, int y, int z) {}

	private static final Map<UUID, List<Violation>> VIOL = new HashMap<>();
	private static final Map<UUID, Map<UUID, CarRec>> CARS = new HashMap<>();
	private static final Map<String, UUID> NAMES = new HashMap<>();
	private static boolean dirty;

	private static Path file() { return FabricLoader.getInstance().getConfigDir().resolve("rz_auto_passports.json"); }

	public static void rememberName(UUID id, String name) {
		if (id == null || name == null || name.isEmpty()) return;
		if (!id.equals(NAMES.put(name.toLowerCase(Locale.ROOT), id))) dirty = true;
	}
	public static UUID byName(String name) { return name == null ? null : NAMES.get(name.toLowerCase(Locale.ROOT)); }

	public static void addViolation(UUID target, Violation v) {
		VIOL.computeIfAbsent(target, k -> new ArrayList<>()).add(v);
		dirty = true;
		save();
	}
	public static List<Violation> violations(UUID id) { return VIOL.getOrDefault(id, List.of()); }

	public static void touchCar(VehicleEntity v) {
		UUID o = v.getOwner();
		if (o == null) return;
		CarRec n = new CarRec(v.getName().getString(), (int) v.getX(), (int) v.getY(), (int) v.getZ());
		CarRec old = CARS.computeIfAbsent(o, k -> new LinkedHashMap<>()).put(v.getUUID(), n);
		if (!n.equals(old)) dirty = true;
	}
	public static void removeCar(UUID owner, UUID car) {
		if (owner == null) return;
		Map<UUID, CarRec> m = CARS.get(owner);
		if (m != null && m.remove(car) != null) dirty = true;
	}
	public static List<CarRec> cars(UUID owner) { return new ArrayList<>(CARS.getOrDefault(owner, Map.of()).values()); }

	private static String clean(String s) { return s.replace('\u0001', ' ').replace('\u0002', ' '); }

	/** Поля через \u0001, записи через \u0002; новые нарушения первыми. */
	public static String encodeViolations(UUID id) {
		List<Violation> l = violations(id);
		StringBuilder sb = new StringBuilder();
		int shown = 0;
		for (int i = l.size() - 1; i >= 0 && shown < 40; i--, shown++) {
			Violation v = l.get(i);
			if (shown > 0) sb.append('\u0002');
			sb.append(clean(v.text())).append('\u0001').append(clean(v.date())).append('\u0001').append(clean(v.country())).append('\u0001').append(v.seal()).append('\u0001').append(clean(v.issuer()));
		}
		return sb.toString();
	}
	public static String encodeCars(UUID id) {
		StringBuilder sb = new StringBuilder();
		int shown = 0;
		for (CarRec c : cars(id)) {
			if (shown++ >= 60) break;
			if (shown > 1) sb.append('\u0002');
			sb.append(clean(c.name())).append('\u0001').append(c.x()).append('\u0001').append(c.y()).append('\u0001').append(c.z());
		}
		return sb.toString();
	}

	public static void load() {
		VIOL.clear(); CARS.clear(); NAMES.clear();
		try {
			Path p = file();
			if (!Files.exists(p)) return;
			JsonObject root = JsonParser.parseString(Files.readString(p)).getAsJsonObject();
			if (root.has("violations")) for (var e : root.getAsJsonObject("violations").entrySet()) {
				List<Violation> l = new ArrayList<>();
				for (JsonElement je : e.getValue().getAsJsonArray()) {
					JsonObject o = je.getAsJsonObject();
					l.add(new Violation(o.get("text").getAsString(), o.get("date").getAsString(), o.get("country").getAsString(), o.get("seal").getAsInt(), o.get("issuer").getAsString()));
				}
				VIOL.put(UUID.fromString(e.getKey()), l);
			}
			if (root.has("cars")) for (var e : root.getAsJsonObject("cars").entrySet()) {
				Map<UUID, CarRec> m = new LinkedHashMap<>();
				for (var c : e.getValue().getAsJsonObject().entrySet()) {
					JsonObject o = c.getValue().getAsJsonObject();
					m.put(UUID.fromString(c.getKey()), new CarRec(o.get("name").getAsString(), o.get("x").getAsInt(), o.get("y").getAsInt(), o.get("z").getAsInt()));
				}
				CARS.put(UUID.fromString(e.getKey()), m);
			}
			if (root.has("names")) for (var e : root.getAsJsonObject("names").entrySet()) NAMES.put(e.getKey(), UUID.fromString(e.getValue().getAsString()));
		} catch (Throwable t) { com.rzauto.RzAutoMod.LOG.error("rz_auto_passports.json не прочитался", t); }
		dirty = false;
	}

	public static void saveIfDirty() { if (dirty) save(); }

	public static void save() {
		try {
			JsonObject root = new JsonObject();
			JsonObject viol = new JsonObject();
			for (var e : VIOL.entrySet()) {
				JsonArray a = new JsonArray();
				for (Violation v : e.getValue()) {
					JsonObject o = new JsonObject();
					o.addProperty("text", v.text()); o.addProperty("date", v.date()); o.addProperty("country", v.country()); o.addProperty("seal", v.seal()); o.addProperty("issuer", v.issuer());
					a.add(o);
				}
				viol.add(e.getKey().toString(), a);
			}
			root.add("violations", viol);
			JsonObject cars = new JsonObject();
			for (var e : CARS.entrySet()) {
				JsonObject m = new JsonObject();
				for (var c : e.getValue().entrySet()) {
					JsonObject o = new JsonObject();
					o.addProperty("name", c.getValue().name()); o.addProperty("x", c.getValue().x()); o.addProperty("y", c.getValue().y()); o.addProperty("z", c.getValue().z());
					m.add(c.getKey().toString(), o);
				}
				cars.add(e.getKey().toString(), m);
			}
			root.add("cars", cars);
			JsonObject names = new JsonObject();
			for (var e : NAMES.entrySet()) names.addProperty(e.getKey(), e.getValue().toString());
			root.add("names", names);
			Files.writeString(file(), new GsonBuilder().setPrettyPrinting().create().toJson(root));
			dirty = false;
		} catch (Throwable t) { com.rzauto.RzAutoMod.LOG.error("rz_auto_passports.json не записался", t); }
	}
}
