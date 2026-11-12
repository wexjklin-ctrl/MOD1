package com.rzauto.client;

import com.mojang.blaze3d.platform.InputConstants;
import com.rzauto.VehicleRegistry;
import com.rzauto.entity.VehicleEntity;
import com.rzauto.net.VehicleActionPayload;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.resources.Identifier;

public class RzAutoClient implements ClientModInitializer {
	static final KeyMapping.Category CATEGORY = KeyMapping.Category.register(Identifier.fromNamespaceAndPath("rz_auto", "keys"));
	/** F: сесть в машину под прицелом (совпадает с «поменять предметы местами», при конфликте переназначьте в настройках управления). */
	static final KeyMapping ENTER = KeyMappingHelper.registerKeyMapping(new KeyMapping("key.rz_auto.enter", InputConstants.KEY_F, CATEGORY));
	/** I: меню машины. */
	static final KeyMapping MENU = KeyMappingHelper.registerKeyMapping(new KeyMapping("key.rz_auto.menu", InputConstants.KEY_I, CATEGORY));

	@Override
	public void onInitializeClient() {
		for (VehicleRegistry.Entry e : VehicleRegistry.entries()) {
			EntityRendererRegistry.register(e.type(), VehicleRenderer::new);
		}
		HudElementRegistry.addLast(Identifier.fromNamespaceAndPath("rz_auto", "vehicle_hud"), new VehicleHud());
		net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents.END_CLIENT_TICK.register(mc -> { VehicleAudio.tick(mc); keys(mc); });
	}

	private static void keys(Minecraft mc) {
		if (mc.player == null || mc.level == null) return;
		while (ENTER.consumeClick()) {
			VehicleEntity ve = VehicleHud.looked(mc);
			if (ve != null && mc.screen == null) ClientPlayNetworking.send(new VehicleActionPayload(ve.getId(), VehicleEntity.ACT_ENTER));
		}
		while (MENU.consumeClick()) {
			VehicleEntity ve = VehicleHud.riding(mc);
			if (ve == null) ve = VehicleHud.looked(mc);
			if (ve != null && mc.screen == null) mc.setScreenAndShow(new VehicleMenuScreen(ve));
		}
	}
}
