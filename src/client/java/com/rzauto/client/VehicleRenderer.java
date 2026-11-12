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
		public Identifier tex;
	}

	public VehicleRenderer(EntityRendererProvider.Context ctx) {
		super(ctx);
	}

	@Override
	public State createRenderState() { return new State(); }

	@Override
	public void extractRenderState(VehicleEntity e, State s, float partial) {
		super.extractRenderState(e, s, partial);
		s.yaw = e.getYRot(partial);
		net.minecraft.client.Minecraft mc = net.minecraft.client.Minecraft.getInstance();
		// Камера от первого лица внутри коробки: не рисуем её для самого водителя/пассажира
		s.hide = mc.player != null && mc.player.getVehicle() == e && mc.options.getCameraType().isFirstPerson();
		VehicleSpec spec = VehicleRegistry.specOf(e.getType());
		if (spec != null) {
			int h = spec.bedrockId().hashCode();
			int r = 90 + (h & 0x7F), g = 90 + ((h >> 7) & 0x7F), b = 90 + ((h >> 14) & 0x7F);
			s.color = 0xFF000000 | (r << 16) | (g << 8) | b;
			s.moto = spec.motorcycle();
			s.model = GeoModel.get(com.rzauto.logic.VehicleCatalog.geometry(spec.bedrockId()));
			String tn = com.rzauto.logic.VehicleCatalog.texture(spec.bedrockId());
			s.tex = (s.model != null && tn != null) ? Identifier.fromNamespaceAndPath("rz_auto", "textures/entity/" + tn + ".png") : null;
		}
	}

	@Override
	public void submit(State s, PoseStack pose, SubmitNodeCollector collector, CameraRenderState camera) {
		if (s.model != null && s.tex != null) {
			pose.pushPose();
			pose.mulPose(new Matrix4f().rotationY((float) Math.toRadians(-s.yaw)));
			final int lt = s.lightCoords;
			final GeoModel gm = s.model;
			collector.submitCustomGeometry(pose, RenderTypes.entityCutout(s.tex), (p, vc) -> gm.render(p, vc, lt));
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
