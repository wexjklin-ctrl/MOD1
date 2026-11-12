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
	static synchronized GeoModel get(String geometryId, String animId) {
		if (geometryId == null) return null;
		String key = geometryId + "|" + animId;
		if (CACHE.containsKey(key)) return CACHE.get(key);
		GeoModel m = null;
		try {
			String name = geometryId.startsWith("geometry.") ? geometryId.substring(9) : geometryId;
			var in = GeoModel.class.getResourceAsStream("/assets/rz_auto/geo/" + name + ".geo.json");
			if (in != null) try (var r = new InputStreamReader(in, StandardCharsets.UTF_8)) { m = parse(JsonParser.parseReader(r).getAsJsonObject(), geometryId); }
			if (m != null) m.applyStatic(animId);
		} catch (Throwable t) {
			com.rzauto.RzAutoMod.LOG.error("geo {} не загрузилась", geometryId, t);
		}
		CACHE.put(key, m);
		return m;
	}

	private static final class Cube {
		final float[] pos = new float[72], uv = new float[48], nrm = new float[18];
	}

	private static final class Bone {
		String name, parentName;
		int parent = -1;
		float px, py, pz, rx, ry, rz;
		/** статичная часть анимации езды: масштаб, добавка к повороту (градусы), смещение (блоки, Java-оси) */
		float sx = 1, sy = 1, sz = 1, ax, ay, az, tx, ty, tz;
		/** динамика поворота по осям X,Y,Z: {вид, k}; вид 0 = константа (градусы), 1 = пройденный путь (блоки) * k, 2 = скорость поворота (град/с) * k; null = нет */
		float[] dyn;
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
		// Bedrock раскладывает box-UV по ЦЕЛЫМ размерам (дробная часть отбрасывается), геометрия при этом дробная
		float wu = (float) Math.floor(ws + 1e-4), hu = (float) Math.floor(hs + 1e-4), du = (float) Math.floor(ds + 1e-4);
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
		float[][] rect = {   // u, v, w, h в пикселях текстуры (по целым размерам)
			{u + du, v + du, wu, hu},
			{u + du + wu + du, v + du, wu, hu},
			{u, v + du, du, hu},
			{u + du + wu, v + du, du, hu},
			{u + du, v, wu, du},
			{u + du + wu, v, wu, du}};

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
			// Ориентация верхней/нижней граней (проверено по стыкам цветов на 8 моделях, tools/seam_check.py): up повёрнута на 180°, down зеркальна по u
			if (face == 4) uvs = new float[] {uvs[4], uvs[5], uvs[6], uvs[7], uvs[0], uvs[1], uvs[2], uvs[3]};
			else if (face == 5) uvs = new float[] {uvs[2], uvs[3], uvs[0], uvs[1], uvs[6], uvs[7], uvs[4], uvs[5]};
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

	private static JsonObject STATIC;

	private static synchronized JsonObject staticData() {
		if (STATIC == null) {
			STATIC = new JsonObject();
			try (var in = GeoModel.class.getResourceAsStream("/assets/rz_auto/geo/anim_static.json")) {
				if (in != null) STATIC = JsonParser.parseReader(new InputStreamReader(in, StandardCharsets.UTF_8)).getAsJsonObject();
			} catch (Throwable t) { com.rzauto.RzAutoMod.LOG.error("anim_static.json", t); }
		}
		return STATIC;
	}

	/** Статичные каналы анимации езды (корневой масштаб 1.3..2.1, наклон руля и т.п.). Динамику (колёса, подвеска) добавим отдельно. */
	private void applyStatic(String animId) {
		if (animId == null) return;
		JsonObject a = staticData().has(animId) ? staticData().getAsJsonObject(animId) : null;
		if (a == null) return;
		for (Bone b : bones) {
			if (!a.has(b.name)) continue;
			JsonObject e = a.getAsJsonObject(b.name);
			if (e.has("scale")) { JsonArray v = e.getAsJsonArray("scale"); b.sx = f(v, 0); b.sy = f(v, 1); b.sz = f(v, 2); }
			if (e.has("rot")) { JsonArray v = e.getAsJsonArray("rot"); b.ax = f(v, 0); b.ay = f(v, 1); b.az = f(v, 2); }
			if (e.has("pos")) { JsonArray v = e.getAsJsonArray("pos"); b.tx = f(v, 0) / 16f; b.ty = f(v, 1) / 16f; b.tz = -f(v, 2) / 16f; }
		}
	}

	private static JsonObject DYN;

	private static synchronized JsonObject dynData() {
		if (DYN == null) {
			DYN = new JsonObject();
			try (var in = GeoModel.class.getResourceAsStream("/assets/rz_auto/geo/anim_dyn.json")) {
				if (in != null) DYN = JsonParser.parseReader(new InputStreamReader(in, StandardCharsets.UTF_8)).getAsJsonObject();
			} catch (Throwable t) { com.rzauto.RzAutoMod.LOG.error("anim_dyn.json", t); }
		}
		return DYN;
	}

	/** Динамические каналы анимации езды: вращение колёс, поворот передних колёс, руль, крен кузова (формулы из оригинала, tools/extract_anim_dyn.py). */
	private void applyDyn(String animId) {
		if (animId == null) return;
		JsonObject a = dynData().has(animId) ? dynData().getAsJsonObject(animId) : null;
		if (a == null) return;
		for (Bone b : bones) {
			if (!a.has(b.name)) continue;
			JsonArray c = a.getAsJsonArray(b.name);
			float[] d = new float[6];
			boolean any = false;
			boolean steerBone = b.name.toLowerCase().contains("steer") || b.name.toLowerCase().contains("fork");
			for (int k = 0; k < 3; k++) {
				JsonArray e = c.get(k).getAsJsonArray();
				float kind = f(e, 0), kv = f(e, 1);
				// крен кузова (steering на оси Z не у руля) не анимируем: из-за него весь кузов стал бы динамическим и дорогим в отрисовке
				if (kind == 2f && k == 2 && !steerBone) { kind = 0; kv = 0; }
				d[k * 2] = kind; d[k * 2 + 1] = kv;
				if (kind != 0f) any = true;
			}
			if (any) b.dyn = d;
		}
	}

	private static float dynVal(float kind, float k, float dist, float steer) {
		return kind == 1f ? dist * k : kind == 2f ? steer * k : k;
	}

	private Matrix4f world(int i, Matrix4f[] memo, float dist, float steer) {
		if (memo[i] != null) return memo[i];
		Bone b = bones[i];
		Matrix4f m = b.parent >= 0 && b.parent != i ? new Matrix4f(world(b.parent, memo, dist, steer)) : new Matrix4f();
		float ex = b.ax, ey = b.ay, ez = b.az;
		if (b.dyn != null) {
			ex = dynVal(b.dyn[0], b.dyn[1], dist, steer);
			ey = dynVal(b.dyn[2], b.dyn[3], dist, steer);
			ez = dynVal(b.dyn[4], b.dyn[5], dist, steer);
		}
		m.translate(b.tx, b.ty, b.tz).translate(b.px, b.py, b.pz)
			.rotateZ((float) Math.toRadians(-(b.rz + ez))).rotateY((float) Math.toRadians(-(b.ry + ey))).rotateX((float) Math.toRadians(b.rx + ex))
			.scale(b.sx, b.sy, b.sz)
			.translate(-b.px, -b.py, -b.pz);
		memo[i] = m;
		return m;
	}

	/** Готовая к отрисовке геометрия под конкретную текстуру: полностью прозрачные грани выброшены, неподвижные грани уже в системе модели. */
	static final class Baked {
		float[] sp = new float[0];   // 23 float на грань: 4 * (x,y,z,u,v) + (nx,ny,nz)
		int sn;
		Cube[] dc = new Cube[0];
		int[] db = new int[0], df = new int[0];
		int quads() { return sn + dc.length; }
	}

	private final Map<String, Baked> bakedCache = new HashMap<>();

	/** Геометрия для текстуры (файл PNG берётся из ресурсов; если не прочитался, рисуются все грани). */
	synchronized Baked baked(net.minecraft.resources.Identifier tex) {
		String key = tex.toString();
		Baked b = bakedCache.get(key);
		if (b != null) return b;
		int[] wh = new int[2];
		byte[] alpha = null;
		try {
			var res = net.minecraft.client.Minecraft.getInstance().getResourceManager().getResource(tex);
			if (res.isPresent()) try (var in = res.get().open()) { alpha = PngAlpha.read(in.readAllBytes(), wh); }
		} catch (Throwable t) { com.rzauto.RzAutoMod.LOG.warn("текстура {} не прочиталась для отбраковки граней: {}", tex, t.toString()); }
		b = bake(alpha, wh[0], wh[1]);
		bakedCache.put(key, b);
		return b;
	}

	private boolean isDyn(int i) {
		for (int g = 0; i >= 0 && g < 64; g++) {
			if (bones[i].dyn != null) return true;
			int p = bones[i].parent;
			if (p == i) return false;
			i = p;
		}
		return false;
	}

	private static boolean faceVisible(Cube c, int face, byte[] a, int w, int h) {
		if (a == null) return true;
		float umin = 9, umax = -9, vmin = 9, vmax = -9;
		for (int k = 0; k < 4; k++) {
			float u = c.uv[(face * 4 + k) * 2], v = c.uv[(face * 4 + k) * 2 + 1];
			umin = Math.min(umin, u); umax = Math.max(umax, u); vmin = Math.min(vmin, v); vmax = Math.max(vmax, v);
		}
		int x0 = Math.max(0, (int) Math.floor(umin * w + 0.01f)), x1 = Math.min(w, Math.max(x0 + 1, (int) Math.ceil(umax * w - 0.01f)));
		int y0 = Math.max(0, (int) Math.floor(vmin * h + 0.01f)), y1 = Math.min(h, Math.max(y0 + 1, (int) Math.ceil(vmax * h - 0.01f)));
		for (int y = y0; y < y1; y++) for (int x = x0; x < x1; x++) if ((a[y * w + x] & 0xFF) > 25) return true;
		return false;
	}

	private Baked bake(byte[] alpha, int w, int h) {
		Baked out = new Baked();
		java.util.List<float[]> stat = new ArrayList<>();
		java.util.List<int[]> dyn = new ArrayList<>();
		java.util.List<Cube> dynCubes = new ArrayList<>();
		Matrix4f[] memo = new Matrix4f[bones.length];
		Vector3f v = new Vector3f(), n = new Vector3f();
		for (int i = 0; i < bones.length; i++) {
			Bone b = bones[i];
			if (b.cubes.isEmpty()) continue;
			boolean d = isDyn(i);
			Matrix4f m = d ? null : world(i, memo, 0f, 0f);
			for (Cube c : b.cubes) for (int face = 0; face < 6; face++) {
				if (!faceVisible(c, face, alpha, w, h)) continue;
				if (d) { dynCubes.add(c); dyn.add(new int[] {i, face}); continue; }
				float[] q = new float[23];
				for (int k = 0; k < 4; k++) {
					int vi = face * 4 + k;
					v.set(c.pos[vi * 3], c.pos[vi * 3 + 1], c.pos[vi * 3 + 2]);
					m.transformPosition(v);
					q[k * 5] = v.x; q[k * 5 + 1] = v.y; q[k * 5 + 2] = v.z; q[k * 5 + 3] = c.uv[vi * 2]; q[k * 5 + 4] = c.uv[vi * 2 + 1];
				}
				n.set(c.nrm[face * 3], c.nrm[face * 3 + 1], c.nrm[face * 3 + 2]);
				m.transformDirection(n); n.normalize();
				q[20] = n.x; q[21] = n.y; q[22] = n.z;
				stat.add(q);
			}
		}
		out.sn = stat.size();
		out.sp = new float[out.sn * 23];
		for (int i = 0; i < out.sn; i++) System.arraycopy(stat.get(i), 0, out.sp, i * 23, 23);
		out.dc = dynCubes.toArray(new Cube[0]);
		out.db = new int[dyn.size()]; out.df = new int[dyn.size()];
		for (int i = 0; i < dyn.size(); i++) { out.db[i] = dyn.get(i)[0]; out.df[i] = dyn.get(i)[1]; }
		return out;
	}

	/**
	 * Отрисовка: неподвижные грани копируются из заготовки, считаются заново только колёса и руль.
	 * @param dist  путь машины вперёд в блоках (назад = уменьшается), от него вращаются колёса
	 * @param steer скорость поворота в градусах за секунду (знак как у yaw в Minecraft), от неё поворачиваются передние колёса и руль
	 */
	void render(Baked bk, PoseStack.Pose pp, VertexConsumer vc, int light, float dist, float steer) {
		float[] sp = bk.sp;
		for (int q = 0; q < bk.sn; q++) {
			int o = q * 23;
			float nx = sp[o + 20], ny = sp[o + 21], nz = sp[o + 22];
			for (int k = 0; k < 4; k++) {
				int a = o + k * 5;
				vc.addVertex(pp, sp[a], sp[a + 1], sp[a + 2]).setColor(-1).setUv(sp[a + 3], sp[a + 4])
					.setOverlay(OverlayTexture.NO_OVERLAY).setLight(light).setNormal(pp, nx, ny, nz);
			}
		}
		if (bk.dc.length == 0) return;
		Matrix4f[] memo = new Matrix4f[bones.length];
		Vector3f v = new Vector3f(), n = new Vector3f();
		for (int i = 0; i < bk.dc.length; i++) {
			Cube c = bk.dc[i];
			int face = bk.df[i];
			Matrix4f m = world(bk.db[i], memo, dist, steer);
			n.set(c.nrm[face * 3], c.nrm[face * 3 + 1], c.nrm[face * 3 + 2]);
			m.transformDirection(n); n.normalize();
			for (int k = 0; k < 4; k++) {
				int vi = face * 4 + k;
				v.set(c.pos[vi * 3], c.pos[vi * 3 + 1], c.pos[vi * 3 + 2]);
				m.transformPosition(v);
				vc.addVertex(pp, v.x, v.y, v.z).setColor(-1).setUv(c.uv[vi * 2], c.uv[vi * 2 + 1])
					.setOverlay(OverlayTexture.NO_OVERLAY).setLight(light).setNormal(pp, n.x, n.y, n.z);
			}
		}
	}

	/** Минимальный разбор PNG: только альфа-канал (8 бит RGBA, без чересстрочности: так сохраняет tools/build_textures.py). */
	static final class PngAlpha {
		static byte[] read(byte[] d, int[] wh) throws java.io.IOException {
			int p = 8, w = 0, h = 0, depth = 0, type = 0, il = 0;
			java.io.ByteArrayOutputStream idat = new java.io.ByteArrayOutputStream();
			while (p + 8 <= d.length) {
				int len = ((d[p] & 255) << 24) | ((d[p + 1] & 255) << 16) | ((d[p + 2] & 255) << 8) | (d[p + 3] & 255);
				String t = new String(d, p + 4, 4, StandardCharsets.ISO_8859_1);
				if (t.equals("IHDR")) {
					w = ((d[p + 8] & 255) << 24) | ((d[p + 9] & 255) << 16) | ((d[p + 10] & 255) << 8) | (d[p + 11] & 255);
					h = ((d[p + 12] & 255) << 24) | ((d[p + 13] & 255) << 16) | ((d[p + 14] & 255) << 8) | (d[p + 15] & 255);
					depth = d[p + 16] & 255; type = d[p + 17] & 255; il = d[p + 20] & 255;
				} else if (t.equals("IDAT")) idat.write(d, p + 8, len);
				else if (t.equals("IEND")) break;
				p += 12 + len;
			}
			if (depth != 8 || type != 6 || il != 0 || w <= 0 || h <= 0) return null;
			java.util.zip.Inflater inf = new java.util.zip.Inflater();
			inf.setInput(idat.toByteArray());
			int stride = w * 4;
			byte[] raw = new byte[(stride + 1) * h];
			try { int off = 0; while (off < raw.length && !inf.finished()) { int r = inf.inflate(raw, off, raw.length - off); if (r == 0 && (inf.needsInput() || inf.needsDictionary())) break; off += r; } }
			catch (java.util.zip.DataFormatException e) { throw new java.io.IOException(e); }
			finally { inf.end(); }
			byte[] prev = new byte[stride], cur = new byte[stride], a = new byte[w * h];
			for (int y = 0; y < h; y++) {
				int ft = raw[y * (stride + 1)] & 255;
				System.arraycopy(raw, y * (stride + 1) + 1, cur, 0, stride);
				for (int i = 0; i < stride; i++) {
					int left = i >= 4 ? cur[i - 4] & 255 : 0, up = prev[i] & 255, ul = i >= 4 ? prev[i - 4] & 255 : 0, x = cur[i] & 255, r;
					switch (ft) {
						case 1 -> r = x + left;
						case 2 -> r = x + up;
						case 3 -> r = x + ((left + up) >> 1);
						case 4 -> { int pa = Math.abs(up - ul), pb = Math.abs(left - ul), pc = Math.abs(left + up - 2 * ul); r = x + (pa <= pb && pa <= pc ? left : pb <= pc ? up : ul); }
						default -> r = x;
					}
					cur[i] = (byte) r;
				}
				for (int x = 0; x < w; x++) a[y * w + x] = cur[x * 4 + 3];
				byte[] t = prev; prev = cur; cur = t;
			}
			wh[0] = w; wh[1] = h;
			return a;
		}
	}
}
