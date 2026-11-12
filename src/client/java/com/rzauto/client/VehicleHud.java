package com.rzauto.client;

import com.rzauto.VehicleRegistry;
import com.rzauto.entity.VehicleEntity;
import com.rzauto.logic.Access;
import com.rzauto.logic.VehicleSpec;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElement;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;

/** Подсказка «F — сесть» у машины и панель приборов (скорость, топливо-лава, двигатель, замок) для водителя. */
final class VehicleHud implements HudElement {
	static final int BG = 0xD0121418, EDGE = 0xFFFF8A00, DIM = 0xFF8A8F98, WHITE = 0xFFFFFFFF;

	/** Машина под прицелом в пределах руки (или null). */
	static VehicleEntity looked(Minecraft mc) {
		if (mc.player == null || mc.player.getVehicle() != null) return null;
		if (mc.crosshairPickEntity instanceof VehicleEntity ve && !ve.isRemoved() && ve.distanceToSqr(mc.player) <= 36) return ve;
		return null;
	}

	static VehicleEntity riding(Minecraft mc) {
		return mc.player != null && mc.player.getVehicle() instanceof VehicleEntity ve ? ve : null;
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, DeltaTracker dt) {
		Minecraft mc = Minecraft.getInstance();
		if (mc.player == null || mc.gui.hud.isHidden() || mc.gui.screen() != null) return;
		VehicleEntity ride = riding(mc);
		if (ride != null) { gauge(g, mc, ride); return; }
		VehicleEntity ve = looked(mc);
		if (ve != null) prompt(g, mc, ve);
	}

	private static void prompt(GuiGraphicsExtractor g, Minecraft mc, VehicleEntity ve) {
		String name = ve.getName().getString();
		String key = RzAutoClient.ENTER.getTranslatedKeyMessage().getString();
		String line = "Сесть в машину";
		boolean locked = ve.isLocked();
		int w = Math.max(mc.font.width(name), mc.font.width(line) + 26) + 24, h = locked ? 50 : 38;
		int cx = g.guiWidth() / 2, x = cx - w / 2, y = g.guiHeight() / 2 + 28;
		g.fill(x, y, x + w, y + h, BG);
		g.fill(x, y, x + 3, y + h, EDGE);
		g.fill(x, y, x + w, y + 1, 0x40FFFFFF);
		g.text(mc.font, name, x + 10, y + 5, DIM, false);
		// «кнопка» клавиши
		int kw = Math.max(16, mc.font.width(key) + 8);
		g.fill(x + 10, y + 17, x + 10 + kw, y + 31, EDGE);
		g.text(mc.font, key, x + 10 + (kw - mc.font.width(key)) / 2, y + 20, 0xFF101010, false);
		g.text(mc.font, line, x + 16 + kw, y + 20, WHITE, true);
		if (locked) g.text(mc.font, "Закрыта владельцем", x + 10, y + 36, 0xFFFF6A5A, false);
	}

	private static void gauge(GuiGraphicsExtractor g, Minecraft mc, VehicleEntity ve) {
		VehicleSpec s = VehicleRegistry.specOf(ve.getType());
		if (s == null) return;
		int w = 150, h = 74, x = g.guiWidth() - w - 12, y = g.guiHeight() - h - 12;
		g.fill(x, y, x + w, y + h, BG);
		g.fill(x, y + h - 2, x + w, y + h, EDGE);
		// скорость
		double kmh = Math.abs(ve.syncedSpeed()) * 72.0;
		double frac = Math.min(1.0, Math.abs(ve.syncedSpeed()) / Math.max(s.topSpeed(), 0.05));
		String sp = Long.toString(Math.round(kmh));
		g.pose().pushMatrix();
		g.pose().translate(x + 10, y + 7);
		g.pose().scale(2.5f, 2.5f);
		g.text(mc.font, sp, 0, 0, frac > 0.95 ? 0xFFFF5A4A : WHITE, true);
		g.pose().popMatrix();
		g.text(mc.font, "км/ч", x + 14 + (int) (mc.font.width(sp) * 2.5f), y + 20, DIM, false);
		// шкала скорости
		bar(g, x + 10, y + 34, w - 20, 5, frac, 0xFF3DDC84, 0xFFFFC233, 0xFFFF4A3D);
		// топливо (лава)
		double fuel = ve.fuelValue() / Math.max(s.maxFuel(), 0.01);
		g.text(mc.font, "ЛАВА", x + 10, y + 44, DIM, false);
		bar(g, x + 40, y + 45, w - 50, 7, Math.min(1.0, fuel), 0xFFFF6A00, 0xFFFF8A00, 0xFFFFC233);
		// статус
		String eng = ve.isBroken() ? "СЛОМАНА" : ve.isEngineOn() ? "ДВИГАТЕЛЬ" : "ЗАГЛУШЕН";
		int ec = ve.isBroken() ? 0xFFFF4A3D : ve.isEngineOn() ? 0xFF3DDC84 : DIM;
		g.fill(x + 10, y + 59, x + 14, y + 63, ec);
		g.text(mc.font, eng, x + 18, y + 58, ec, false);
		String lk = ve.lockState() == Access.Lock.OPEN ? "открыта" : "закрыта";
		String hint = "[" + RzAutoClient.MENU.getTranslatedKeyMessage().getString() + "] меню";
		g.text(mc.font, hint, x + w - 10 - mc.font.width(hint), y + 58, DIM, false);
		if (fuel <= 0.12 && System.currentTimeMillis() / 400 % 2 == 0) g.text(mc.font, "МАЛО ТОПЛИВА", x + 10, y - 11, 0xFFFF6A00, true);
	}

	private static void bar(GuiGraphicsExtractor g, int x, int y, int w, int h, double frac, int c1, int c2, int c3) {
		g.fill(x, y, x + w, y + h, 0xFF2A2E35);
		int fw = (int) Math.round(w * Math.max(0, Math.min(1, frac)));
		if (fw <= 0) return;
		int c = frac < 0.6 ? c1 : frac < 0.85 ? c2 : c3;
		g.fill(x, y, x + fw, y + h, c);
		g.fill(x, y, x + fw, y + 1, 0x40FFFFFF);
	}
}
