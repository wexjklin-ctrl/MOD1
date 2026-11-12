package com.rzauto.client;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import net.minecraft.client.renderer.texture.OverlayTexture;
import org.joml.Matrix4f;
import org.joml.Vector3f;

/**
 * Загрузчик Bedrock geo 1.12 (assets/rz_auto/geo/NAME.geo.json). Система координат (проверена offline на 458):
 * файл: перед модели = -Z, файловая ось X зеркальна компасной. Java (перед = +Z): x_j = x_файл, z_j = -z_файл, всё /16.
 * Повороты (Эйлер ZYX, X применяется первым) в Java-системе: X на +rx, Y на -ry, Z на -rz.
 * Текстурные развёртки — «box UV» (east/north/west/south в ряд, up/down сверху), mirror меняет east/west и разворачивает по u.
 */
final class GeoModel {
	private static final Map<String, GeoModel> CACHE = new HashMap<>();

	/** Модель по id геометрии ("geometry.458") или null, если файла нет / он не разобрался. */
	static synchronized GeoModel get(String geometryId) {
		if (geometryId == null) return null;
		if (CACHE.containsKey(geometryId)) return CACHE.get(geometryId);
		GeoModel m = null;
		try {
			String name = geometryId.startsWith("geometry.") ? geometryId.substring(9) : geometryId;
			var in = GeoModel.class.getResourceAsStream("/assets/rz_auto/geo/" + name + ".geo.json");
			if (in != null) try (var r = new InputStreamReader(in, StandardCharsets.UTF_8)) { m = parse(JsonParser.parseReader(r).getAsJsonObject(), geometryId); }
		} catch (Throwable t) {
			com.rzauto.RzAutoMod.LOG.error("geo {} не загрузилась", geometryId, t);
		}
		CACHE.put(geometryId, m);
		return m;
	}

	private static final class Cube {
		final float[] pos = new float[72], uv = new float[48], nrm = new float[18];
	}

	private static final class Bone {
		String name, parentName;
		int parent = -1;
		float px, py, pz, rx, ry, rz;
		final List<Cube> cubes = new ArrayList<>();
	}

	private final Bone[] bones;

	private GeoModel(Bone[] bones) { this.bones = bones; }

	private static float f(JsonArray a, int i) { return a.get(i).getAsFloat(); }

	private static GeoModel parse(JsonObject root, String id) {
		JsonObject geo = null;
		for (JsonElement e : root.getAsJsonArray("minecraft:geometry")) {
			JsonObject g = e.getAsJsonObject();
			if (id.equals(g.getAsJsonObject("description").get("identifier").getAsString())) { geo = g; break; }
		}
		if (geo == null) return null;
		JsonObject d = geo.getAsJsonObject("description");
		float tw = d.get("texture_width").getAsFloat(), th = d.get("texture_height").getAsFloat();
		List<Bone> list = new ArrayList<>();
		Map<String, Integer> idx = new HashMap<>();
		for (JsonElement e : geo.getAsJsonArray("bones")) {
			JsonObject o = e.getAsJsonObject();
			Bone b = new Bone();
			b.name = o.get("name").getAsString();
			b.parentName = o.has("parent") ? o.get("parent").getAsString() : null;
			JsonArray pv = o.getAsJsonArray("pivot");
			b.px = f(pv, 0) / 16f; b.py = f(pv, 1) / 16f; b.pz = -f(pv, 2) / 16f;
			if (o.has("rotation")) { JsonArray r = o.getAsJsonArray("rotation"); b.rx = f(r, 0); b.ry = f(r, 1); b.rz = f(r, 2); }
			if (o.has("cubes")) for (JsonElement ce : o.getAsJsonArray("cubes")) b.cubes.add(cube(ce.getAsJsonObject(), tw, th));
			idx.put(b.name, list.size());
			list.add(b);
		}
		for (Bone b : list) if (b.parentName != null && idx.containsKey(b.parentName)) b.parent = idx.get(b.parentName);
		return new GeoModel(list.toArray(new Bone[0]));
	}

	private static Cube cube(JsonObject o, float tw, float th) {
		JsonArray og = o.getAsJsonArray("origin"), sz = o.getAsJsonArray("size"), uvA = o.getAsJsonArray("uv");
		float inf = o.has("inflate") ? o.get("inflate").getAsFloat() : 0f;
		float ws = f(sz, 0), hs = f(sz, 1), ds = f(sz, 2);
		float u = f(uvA, 0), v = f(uvA, 1);
		boolean mirror = o.has("mirror") && o.get("mirror").getAsBoolean();
		float X0 = f(og, 0) - inf, y0 = f(og, 1) - inf, z0 = f(og, 2) - inf;
		float X1 = X0 + ws + 2 * inf, y1 = y0 + hs + 2 * inf, z1 = z0 + ds + 2 * inf;
		float x0 = -X1, x1 = -X0;   // компасные координаты (x' = -x_файл)

		// грани: углы TL, TR, BR, BL «снаружи» (компасные координаты), порядок: north, south, east, west, up, down
		float[][] c = {
			{x1, y1, z0, x0, y1, z0, x0, y0, z0, x1, y0, z0},
			{x0, y1, z1, x1, y1, z1, x1, y0, z1, x0, y0, z1},
			{x1, y1, z1, x1, y1, z0, x1, y0, z0, x1, y0, z1},
			{x0, y1, z0, x0, y1, z1, x0, y0, z1, x0, y0, z0},
			{x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1},
			{x0, y0, z1, x1, y0, z1, x1, y0, z0, x0, y0, z0}};
		float[][] rect = {   // u, v, w, h в пикселях текстуры
			{u + ds, v + ds, ws, hs},
			{u + ds + ws + ds, v + ds, ws, hs},
			{u, v + ds, ds, hs},
			{u + ds + ws, v + ds, ds, hs},
			{u + ds, v, ws, ds},
			{u + ds + ws, v, ws, ds}};

		Matrix4f cr = new Matrix4f();
		float pvx = 0, pvy = 0, pvz = 0;
		boolean rot = o.has("rotation");
		if (rot) {
			JsonArray r = o.getAsJsonArray("rotation");
			cr.rotateZ((float) Math.toRadians(-f(r, 2))).rotateY((float) Math.toRadians(-f(r, 1))).rotateX((float) Math.toRadians(f(r, 0)));
			if (o.has("pivot")) { JsonArray p = o.getAsJsonArray("pivot"); pvx = f(p, 0) / 16f; pvy = f(p, 1) / 16f; pvz = -f(p, 2) / 16f; }
		}
		Cube out = new Cube();
		Vector3f t = new Vector3f();
		for (int face = 0; face < 6; face++) {
			float[] fr = rect[face];
			if (mirror && (face == 2 || face == 3)) fr = rect[5 - face];   // east <-> west
			float[] uvs = {fr[0], fr[1], fr[0] + fr[2], fr[1], fr[0] + fr[2], fr[1] + fr[3], fr[0], fr[1] + fr[3]};
			if (mirror) uvs = new float[] {uvs[2], uvs[3], uvs[0], uvs[1], uvs[6], uvs[7], uvs[4], uvs[5]};
			Vector3f[] p = new Vector3f[4];
			for (int k = 0; k < 4; k++) {
				t.set(-c[face][k * 3] / 16f, c[face][k * 3 + 1] / 16f, -c[face][k * 3 + 2] / 16f);
				if (rot) { t.sub(pvx, pvy, pvz); cr.transformDirection(t); t.add(pvx, pvy, pvz); }
				p[k] = new Vector3f(t);
			}
			// наружная нормаль: (BL-TL) x (TR-TL)
			Vector3f n = new Vector3f(p[3]).sub(p[0]).cross(new Vector3f(p[1]).sub(p[0])).normalize();
			out.nrm[face * 3] = n.x; out.nrm[face * 3 + 1] = n.y; out.nrm[face * 3 + 2] = n.z;
			// порядок вершин против часовой стрелки снаружи: TL, BL, BR, TR
			int[] order = {0, 3, 2, 1};
			for (int k = 0; k < 4; k++) {
				int s = order[k], o4 = face * 4 + k;
				out.pos[o4 * 3] = p[s].x; out.pos[o4 * 3 + 1] = p[s].y; out.pos[o4 * 3 + 2] = p[s].z;
				out.uv[o4 * 2] = uvs[s * 2] / tw; out.uv[o4 * 2 + 1] = uvs[s * 2 + 1] / th;
			}
		}
		return out;
	}

	private Matrix4f world(int i, Matrix4f[] memo) {
		if (memo[i] != null) return memo[i];
		Bone b = bones[i];
		Matrix4f m = b.parent >= 0 && b.parent != i ? new Matrix4f(world(b.parent, memo)) : new Matrix4f();
		m.translate(b.px, b.py, b.pz)
			.rotateZ((float) Math.toRadians(-b.rz)).rotateY((float) Math.toRadians(-b.ry)).rotateX((float) Math.toRadians(b.rx))
			.translate(-b.px, -b.py, -b.pz);
		memo[i] = m;
		return m;
	}

	/** Статичная поза (анимации колёс, руля и подвески добавляются позже через повороты костей по имени). */
	void render(PoseStack.Pose pp, VertexConsumer vc, int light) {
		Matrix4f[] memo = new Matrix4f[bones.length];
		Vector3f v = new Vector3f(), n = new Vector3f();
		for (int i = 0; i < bones.length; i++) {
			Bone b = bones[i];
			if (b.cubes.isEmpty()) continue;
			Matrix4f m = world(i, memo);
			for (Cube c : b.cubes) {
				for (int k = 0; k < 24; k++) {
					v.set(c.pos[k * 3], c.pos[k * 3 + 1], c.pos[k * 3 + 2]);
					m.transformPosition(v);
					int face = k / 4;
					n.set(c.nrm[face * 3], c.nrm[face * 3 + 1], c.nrm[face * 3 + 2]);
					m.transformDirection(n);
					vc.addVertex(pp, v.x, v.y, v.z).setColor(-1).setUv(c.uv[k * 2], c.uv[k * 2 + 1])
						.setOverlay(OverlayTexture.NO_OVERLAY).setLight(light).setNormal(pp, n.x, n.y, n.z);
				}
			}
		}
	}
}
