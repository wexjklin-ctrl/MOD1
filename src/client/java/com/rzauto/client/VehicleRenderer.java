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
		public boolean hide;
		public GeoModel model;
		public GeoModel.Baked bake, bakeE;
		/** путь вперёд в блоках (по модулю 18, чтобы не терять точность) и скорость поворота (град/с) для колёс и руля */
		public float dist, steer;
		public Identifier tex, texE;
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
		float yaw, steer;
		long ns;
	}
	private static final java.util.Map<VehicleEntity, Track> TRACKS = new java.util.WeakHashMap<>();

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
			}
			float dyaw = net.minecraft.util.Mth.wrapDegrees(yaw - t.yaw);
			float rate = net.minecraft.util.Mth.clamp(dyaw / dt, -150f, 150f);
			t.steer += (rate - t.steer) * (1f - (float) Math.exp(-dt / 0.15f));
		} else if (dt >= 1f) {
			t.steer = 0;
		}
		t.init = true; t.x = x; t.z = z; t.yaw = yaw; t.ns = now;
		s.dist = (float) (t.dist % 18.0);
		s.steer = t.steer;
	}

	@Override
	public State createRenderState() { return new State(); }

	@Override
	public void extractRenderState(VehicleEntity e, State s, float partial) {
		super.extractRenderState(e, s, partial);
		s.yaw = e.getYRot(partial);
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
			s.bakeE = s.texE != null ? s.model.baked(s.texE) : null;
			if (s.bakeE != null && s.bakeE.quads() == 0) { s.bakeE = null; s.texE = null; }
		}
	}

	@Override
	public void submit(State s, PoseStack pose, SubmitNodeCollector collector, CameraRenderState camera) {
		if (s.model != null && s.tex != null) {
			pose.pushPose();
			pose.mulPose(new Matrix4f().rotationY((float) Math.toRadians(-s.yaw)));
			pose.scale(com.rzauto.RzConfig.renderScale, com.rzauto.RzConfig.renderScale, com.rzauto.RzConfig.renderScale);
			final int lt = s.lightCoords;
			final GeoModel gm = s.model;
			collector.submitCustomGeometry(pose, RenderTypes.entityCutout(s.tex), (p, vc) -> gm.render(s.bake, p, vc, lt, s.dist, s.steer));
			if (s.texE != null) collector.submitCustomGeometry(pose, RenderTypes.eyes(s.texE), (p, vc) -> gm.render(s.bakeE, p, vc, 0xF000F0, s.dist, s.steer));
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
