package com.rzauto.client;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;
import com.rzauto.VehicleRegistry;

public class RzAutoClient implements ClientModInitializer {
	@Override
	public void onInitializeClient() {
		for (VehicleRegistry.Entry e : VehicleRegistry.entries()) {
			EntityRendererRegistry.register(e.type(), VehicleRenderer::new);
		}
	}
}
