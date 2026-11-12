package com.rzauto.client;

import net.minecraft.client.renderer.entity.EntityRenderer;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.entity.state.EntityRenderState;
import com.rzauto.entity.VehicleEntity;

/** Этап 1: заглушка рендера (без модели). Нужна, чтобы клиент не падал при появлении сущности. */
public class VehicleRenderer extends EntityRenderer<VehicleEntity, EntityRenderState> {
	public VehicleRenderer(EntityRendererProvider.Context ctx) {
		super(ctx);
	}

	@Override
	public EntityRenderState createRenderState() {
		return new EntityRenderState();
	}
}
