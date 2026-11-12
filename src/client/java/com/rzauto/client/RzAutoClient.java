package com.rzauto.client;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;
import com.rzauto.VehicleRegistry;

public class RzAutoClient implements ClientModInitializer {
	@Override
	public void onInitializeClient() {
		net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents.END_CLIENT_TICK.register(VehicleAudio::tick);
		for (VehicleRegistry.Entry e : VehicleRegistry.entries()) {
			EntityRendererRegistry.register(e.type(), VehicleRenderer::new);
		}
	}
}
