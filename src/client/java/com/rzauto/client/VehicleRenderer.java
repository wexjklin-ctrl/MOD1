package com.rzauto.client;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import org.joml.Matrix4f;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.entity.EntityRenderer;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.entity.state.EntityRenderState;
import net.minecraft.client.renderer.rendertype.RenderTypes;
import net.minecraft.client.renderer.state.level.CameraRenderState;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.resources.Identifier;
import com.rzauto.VehicleRegistry;
import com.rzauto.entity.VehicleEntity;
import com.rzauto.logic.VehicleSpec;

/**
 * Этап 2: временная модель-коробка (цвет по id машины, перед красный).
 * Настоящие geo-модели из оригинала подключаются на этапе 3.
 */
public class VehicleRenderer extends EntityRenderer<VehicleEntity, VehicleRenderer.State> {
	private static final Identifier WHITE = Identifier.withDefaultNamespace("textures/block/white_concrete.png");

	public static class State extends EntityRenderState {
		public float yaw;
		public int color = 0xFF8899AA;
		public boolean moto;
		public boolean hide, lights, siren;
		public GeoModel model;
		public GeoModel.Baked bake, bakeE, bakeBar;
		/** путь вперёд в блоках (по модулю 18, чтобы не терять точность) и скорость поворота (град/с) для колёс и руля */
		public float dist, steer, pitch, roll;
		public Identifier tex, texE;
		/** сдвиг каждого колеса по высоте (в единицах модели) по рельефу под ним */
		public float[] wdy;
	}

	public VehicleRenderer(EntityRendererProvider.Context ctx) {
		super(ctx);
	}

	private static final java.util.Map<String, Boolean> EMISSIVE = new java.util.HashMap<>();
	/** Есть ли маска свечения NAME_e.png (фары, стопы): рисуется вторым слоем без освещения. */
	private static boolean hasEmissive(String tn) {
		return EMISSIVE.computeIfAbsent(tn, k -> net.minecraft.client.Minecraft.getInstance().getResourceManager()
			.getResource(Identifier.fromNamespaceAndPath("rz_auto", "textures/entity/" + k + "_e.png")).isPresent());
	}

	/** Клиентская кинематика для анимации: пройденный путь вперёд и сглаженная скорость поворота. Машина сама по клиенту не считается, только позиция с сервера. */
	private static final class Track {
		boolean init;
		double x, z, dist;
		float yaw, steer, vel, acc, pitch, roll, pp, pv, rp, rv;
		final float[] wy = new float[8];
		long wns;
		long ns;
	}
	private static final java.util.Map<VehicleEntity, Track> TRACKS = new java.util.WeakHashMap<>();


	/** Высота опоры (верх блока с коллизией) под точкой, не выше y+1.2; NaN, если опоры нет. */
	private static double ground(net.minecraft.world.level.Level level, double x, double y, double z) {
		int bx = net.minecraft.util.Mth.floor(x), bz = net.minecraft.util.Mth.floor(z), top = net.minecraft.util.Mth.floor(y + 1.2);
		net.minecraft.core.BlockPos.MutableBlockPos mp = new net.minecraft.core.BlockPos.MutableBlockPos();
		for (int by = top; by >= top - 4; by--) {
			mp.set(bx, by, bz);
			net.minecraft.world.phys.shapes.VoxelShape sh = level.getBlockState(mp).getCollisionShape(level, mp);
			if (sh.isEmpty()) continue;
			double h = by + sh.max(net.minecraft.core.Direction.Axis.Y);
			if (h <= y + 1.2) return h;
		}
		return Double.NaN;
	}

	/** Наклон кузова по рельефу под колёсами {тангаж, крен} в градусах (положительный тангаж = нос вниз). */
	private static float[] terrain(VehicleEntity e, VehicleSpec spec, double x, double y, double z, float yaw) {
		double[] dm = spec == null ? null : com.rzauto.logic.VehicleCatalog.dims(spec.bedrockId());
		double halfL = dm == null ? 1.3 : Math.max(0.5, dm[1] * 0.33), halfW = dm == null ? 0.7 : Math.max(0.3, dm[0] * 0.33);
		double yr = Math.toRadians(yaw), fx = -Math.sin(yr), fz = Math.cos(yr), lx = Math.cos(yr), lz = Math.sin(yr);
		net.minecraft.world.level.Level lv = e.level();
		double hf = ground(lv, x + fx * halfL, y, z + fz * halfL), hr = ground(lv, x - fx * halfL, y, z - fz * halfL);
		double hl = ground(lv, x + lx * halfW, y, z + lz * halfW), hrr = ground(lv, x - lx * halfW, y, z - lz * halfW);
		if (Double.isNaN(hf)) hf = y; if (Double.isNaN(hr)) hr = y; if (Double.isNaN(hl)) hl = y; if (Double.isNaN(hrr)) hrr = y;
		float p = (float) -Math.toDegrees(Math.atan2(hf - hr, 2 * halfL));
		float r = (float) Math.toDegrees(Math.atan2(hl - hrr, 2 * halfW));
		return new float[] { net.minecraft.util.Mth.clamp(p, -32f, 32f), net.minecraft.util.Mth.clamp(r, -22f, 22f) };
	}

	/** Подвеска колёс: каждое колесо идёт по высоте земли под ним относительно плоскости кузова (по методу наименьших квадратов). */
	private static void wheelSurface(VehicleEntity e, State s, float partial) {
		float[][] wp = s.model == null ? new float[0][] : s.model.wheelPoints();
		int n = wp.length;
		if (n == 0) { s.wdy = null; return; }
		Track t = TRACKS.get(e);
		if (t == null) return;
		net.minecraft.world.phys.Vec3 pos = e.getPosition(partial);
		double yr = Math.toRadians(e.getYRot(partial)), c = Math.cos(yr), sn = Math.sin(yr);
		double[] h = new double[n];
		for (int i = 0; i < n; i++) {
			double mx = wp[i][0], mz = wp[i][1];
			double wx = pos.x + mx * c - mz * sn, wz = pos.z + mx * sn + mz * c;
			double g = ground(e.level(), wx, pos.y, wz);
			h[i] = Double.isNaN(g) ? pos.y : g;
		}
		// плоскость h = a + b*x + c*z по всем колёсам (с лёгкой регуляризацией, чтобы два колеса у мотоцикла не давали вырожденную систему)
		double[][] A = new double[3][4];
		for (int i = 0; i < n; i++) {
			double[] r = {1, wp[i][0], wp[i][1]};
			for (int a = 0; a < 3; a++) { for (int b = 0; b < 3; b++) A[a][b] += r[a] * r[b]; A[a][3] += r[a] * h[i]; }
		}
		A[1][1] += 1e-3; A[2][2] += 1e-3;
		for (int col = 0; col < 3; col++) {
			int piv = col;
			for (int r = col + 1; r < 3; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
			double[] tmp = A[col]; A[col] = A[piv]; A[piv] = tmp;
			if (Math.abs(A[col][col]) < 1e-9) continue;
			for (int r = 0; r < 3; r++) if (r != col) { double f = A[r][col] / A[col][col]; for (int k = col; k < 4; k++) A[r][k] -= f * A[col][k]; }
		}
		double pa = A[0][3] / A[0][0], pb = A[1][3] / A[1][1], pc = A[2][3] / A[2][2];
		long now = System.nanoTime();
		float dt = t.wns == 0 ? 0f : net.minecraft.util.Mth.clamp((now - t.wns) / 1.0e9f, 0f, 0.1f);
		t.wns = now;
		float k = dt == 0f ? 1f : 1f - (float) Math.exp(-dt / 0.05f);
		if (s.wdy == null || s.wdy.length != n) s.wdy = new float[n];
		for (int i = 0; i < n; i++) {
			double fit = pa + pb * wp[i][0] + pc * wp[i][1];
			float target = (float) net.minecraft.util.Mth.clamp(h[i] - fit, -0.3, 0.3);
			t.wy[i] += (target - t.wy[i]) * k;
			s.wdy[i] = t.wy[i] / wp[i][2];
		}
	}

	private static void track(VehicleEntity e, State s, float partial) {
		Track t = TRACKS.computeIfAbsent(e, k -> new Track());
		net.minecraft.world.phys.Vec3 pos = e.getPosition(partial);
		double x = pos.x, z = pos.z;
		float yaw = e.getYRot(partial);
		long now = System.nanoTime();
		float dt = (now - t.ns) / 1.0e9f;
		if (t.init && dt > 1e-4f && dt < 1f) {
			double dx = x - t.x, dz = z - t.z;
			double step = Math.hypot(dx, dz);
			if (step < 8) {
				double yr = Math.toRadians(yaw);
				double fwd = dx * -Math.sin(yr) + dz * Math.cos(yr);   // перед машины в мире: (-sin yaw, cos yaw)
				t.dist += fwd;
				float dtT = dt * 20f;
				float vt = (float) (fwd / dtT);   // блоков за тик
				float nv = t.vel + (vt - t.vel) * (1f - (float) Math.exp(-dt / 0.12f));
				float ac = (nv - t.vel) / dtT;
				t.vel = nv;
				t.acc += (ac - t.acc) * (1f - (float) Math.exp(-dt / 0.18f));
			}
			float dyaw = net.minecraft.util.Mth.wrapDegrees(yaw - t.yaw);
			float rate = net.minecraft.util.Mth.clamp(dyaw / dt, -150f, 150f);
			t.steer += (rate - t.steer) * (1f - (float) Math.exp(-dt / 0.15f));
		} else if (dt >= 1f) {
			t.steer = 0;
		}
		// подвеска по блокам: пружина тянет тангаж/крен к наклону рельефа под колёсами (на склоне, ступеньках, плитах), стоя тоже держит наклон
		float[] tg = terrain(e, VehicleRegistry.specOf(e.getType()), x, pos.y, z, yaw);
		if (!t.init) { t.pp = tg[0]; t.rp = tg[1]; t.pv = 0; t.rv = 0; }
		else {
			float h = net.minecraft.util.Mth.clamp(dt, 0f, 0.05f);
			t.pv += ((tg[0] - t.pp) * 85f - t.pv * 9f) * h; t.pp += t.pv * h;
			t.rv += ((tg[1] - t.rp) * 85f - t.rv * 9f) * h; t.rp += t.rv * h;
		}
		t.init = true; t.x = x; t.z = z; t.yaw = yaw; t.ns = now;
		// наклон кузова по инерции: торможение клюёт носом, разгон приседает, на повороте крен наружу
		float pt = net.minecraft.util.Mth.clamp(-t.acc * 28f, -3.5f, 4.5f);
		float lat = t.vel * (-t.steer) * 0.0174533f / 20f;
		float rt = net.minecraft.util.Mth.clamp(lat * 70f, -4.5f, 4.5f);
		float k = 1f - (float) Math.exp(-Math.max(dt, 0f) / 0.15f);
		t.pitch += (pt - t.pitch) * k; t.roll += (rt - t.roll) * k;
		s.pitch = t.pitch + t.pp; s.roll = t.roll + t.rp;
		s.dist = (float) (t.dist % 18.0);
		s.steer = t.steer;
	}

	@Override
	public State createRenderState() { return new State(); }

	@Override
	public void extractRenderState(VehicleEntity e, State s, float partial) {
		super.extractRenderState(e, s, partial);
		s.yaw = e.getYRot(partial);
		s.lights = e.lightsOn(); s.siren = e.sirenOn();
		track(e, s, partial);
		net.minecraft.client.Minecraft mc = net.minecraft.client.Minecraft.getInstance();
		// Камера от первого лица внутри коробки: не рисуем её для самого водителя/пассажира
		s.hide = mc.player != null && mc.player.getVehicle() == e && mc.options.getCameraType().isFirstPerson();
		VehicleSpec spec = VehicleRegistry.specOf(e.getType());
		if (spec != null) {
			int h = spec.bedrockId().hashCode();
			int r = 90 + (h & 0x7F), g = 90 + ((h >> 7) & 0x7F), b = 90 + ((h >> 14) & 0x7F);
			s.color = 0xFF000000 | (r << 16) | (g << 8) | b;
			s.moto = spec.motorcycle();
			s.model = GeoModel.get(com.rzauto.logic.VehicleCatalog.geometry(spec.bedrockId()), com.rzauto.logic.VehicleCatalog.driveAnim(spec.bedrockId()));
			String tn = com.rzauto.logic.VehicleCatalog.texture(spec.bedrockId());
			s.tex = (s.model != null && tn != null) ? Identifier.fromNamespaceAndPath("rz_auto", "textures/entity/" + tn + ".png") : null;
			s.texE = (s.tex != null && hasEmissive(tn)) ? Identifier.fromNamespaceAndPath("rz_auto", "textures/entity/" + tn + "_e.png") : null;
			s.bake = s.tex != null ? s.model.baked(s.tex) : null;
			s.bakeE = s.texE != null ? s.model.baked(s.texE, 2) : null;
			s.bakeBar = s.texE != null ? s.model.baked(s.texE, 1) : null;
			if (s.bakeE != null && s.bakeE.quads() == 0) s.bakeE = null;
			if (s.bakeBar != null && s.bakeBar.quads() == 0) s.bakeBar = null;
			if (s.bakeE == null && s.bakeBar == null) s.texE = null;
			wheelSurface(e, s, partial);
		}
	}

	@Override
	public void submit(State s, PoseStack pose, SubmitNodeCollector collector, CameraRenderState camera) {
		if (s.model != null && s.tex != null) {
			pose.pushPose();
			pose.mulPose(new Matrix4f().rotationY((float) Math.toRadians(-s.yaw)));
			pose.translate(0f, 0.4f, 0f);
			pose.mulPose(new Matrix4f().rotationX((float) Math.toRadians(s.pitch)).rotateZ((float) Math.toRadians(s.roll)));
			pose.translate(0f, -0.4f, 0f);
			pose.scale(com.rzauto.RzConfig.renderScale, com.rzauto.RzConfig.renderScale, com.rzauto.RzConfig.renderScale);
			final int lt = s.lightCoords;
			final GeoModel gm = s.model;
			collector.submitCustomGeometry(pose, RenderTypes.entityCutout(s.tex), (p, vc) -> gm.render(s.bake, p, vc, lt, s.dist, s.steer, 0f, s.wdy));
			if (s.texE != null && s.bakeE != null && s.lights) collector.submitCustomGeometry(pose, RenderTypes.eyes(s.texE), (p, vc) -> gm.render(s.bakeE, p, vc, 0xF000F0, s.dist, s.steer, 0.006f, s.wdy));
			if (s.texE != null && s.bakeBar != null && s.siren && (System.currentTimeMillis() / 220 % 2 == 0)) collector.submitCustomGeometry(pose, RenderTypes.eyes(s.texE), (p, vc) -> gm.render(s.bakeBar, p, vc, 0xF000F0, s.dist, s.steer, 0.006f, s.wdy));
			pose.popPose();
			super.submit(s, pose, collector, camera);
			return;
		}
		if (s.hide) { super.submit(s, pose, collector, camera); return; }
		pose.pushPose();
		pose.mulPose(new Matrix4f().rotationY((float) Math.toRadians(-s.yaw)));
		final int light = s.lightCoords;
		final float hw = s.moto ? 0.25f : 0.6f, hl = s.moto ? 0.9f : 1.1f, hh = s.moto ? 0.9f : 1.0f;
		collector.submitCustomGeometry(pose, RenderTypes.entitySolid(WHITE), (p, vc) -> box(p, vc, hw, hl, hh, s.color, light));
		pose.popPose();
		super.submit(s, pose, collector, camera);
	}

	/** Коробка: x — ширина, z — длина (перед = +z в системе сущности до разворота на 180°), y вверх от земли. */
	private static void box(PoseStack.Pose pp, VertexConsumer vc, float hw, float hl, float hh, int color, int light) {
		int front = 0xFFCC2222;
		// верх / низ
		quad(pp, vc, -hw, hh, -hl,  hw, hh, -hl,  hw, hh, hl,  -hw, hh, hl,  0, 1, 0, color, light);
		quad(pp, vc, -hw, 0, hl,  hw, 0, hl,  hw, 0, -hl,  -hw, 0, -hl,  0, -1, 0, color, light);
		// бока
		quad(pp, vc, hw, 0, -hl,  hw, 0, hl,  hw, hh, hl,  hw, hh, -hl,  1, 0, 0, color, light);
		quad(pp, vc, -hw, 0, hl,  -hw, 0, -hl,  -hw, hh, -hl,  -hw, hh, hl,  -1, 0, 0, color, light);
		// перед (красный) / зад
		quad(pp, vc, hw, 0, hl,  -hw, 0, hl,  -hw, hh, hl,  hw, hh, hl,  0, 0, 1, front, light);
		quad(pp, vc, -hw, 0, -hl,  hw, 0, -hl,  hw, hh, -hl,  -hw, hh, -hl,  0, 0, -1, color, light);
	}

	private static void quad(PoseStack.Pose pp, VertexConsumer vc,
			float x1, float y1, float z1, float x2, float y2, float z2,
			float x3, float y3, float z3, float x4, float y4, float z4,
			float nx, float ny, float nz, int color, int light) {
		v(pp, vc, x1, y1, z1, 0, 0, nx, ny, nz, color, light);
		v(pp, vc, x2, y2, z2, 1, 0, nx, ny, nz, color, light);
		v(pp, vc, x3, y3, z3, 1, 1, nx, ny, nz, color, light);
		v(pp, vc, x4, y4, z4, 0, 1, nx, ny, nz, color, light);
		// обратная сторона (нет отсечения граней у entitySolid): те же вершины в обратном порядке
		v(pp, vc, x4, y4, z4, 0, 1, -nx, -ny, -nz, color, light);
		v(pp, vc, x3, y3, z3, 1, 1, -nx, -ny, -nz, color, light);
		v(pp, vc, x2, y2, z2, 1, 0, -nx, -ny, -nz, color, light);
		v(pp, vc, x1, y1, z1, 0, 0, -nx, -ny, -nz, color, light);
	}

	private static void v(PoseStack.Pose pp, VertexConsumer vc, float x, float y, float z, float u, float w,
			float nx, float ny, float nz, int color, int light) {
		vc.addVertex(pp, x, y, z).setColor(color).setUv(u, w).setOverlay(OverlayTexture.NO_OVERLAY).setLight(light).setNormal(pp, nx, ny, nz);
	}
}
