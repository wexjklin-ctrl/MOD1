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

	private static void disc(GuiGraphicsExtractor g, int cx, int cy, int r, int color) {
		for (int dy = -r; dy <= r; dy++) {
			int half = (int) Math.round(Math.sqrt((double) r * r - (double) dy * dy));
			g.fill(cx - half, cy + dy, cx + half, cy + dy + 1, color);
		}
	}

	/** Круглый спидометр (шкала 270°, ноль слева внизу, красная стрелка), топливо и статус под ним. */
	private static void gauge(GuiGraphicsExtractor g, Minecraft mc, VehicleEntity ve) {
		VehicleSpec s = VehicleRegistry.specOf(ve.getType());
		if (s == null) return;
		final int R = 40;
		int cx = g.guiWidth() - R - 12, cy = g.guiHeight() - R - 34;
		double kmh = Math.abs(ve.syncedSpeed()) * 72.0;
		double topKmh = s.topSpeed() * 72.0;
		int max = (int) Math.max(120, Math.ceil(topKmh * 1.05 / 40.0) * 40);
		int labelStep = max <= 240 ? 20 : 40;
		disc(g, cx, cy, R + 2, 0xFF2A2E35);
		disc(g, cx, cy, R, 0xFF050607);
		final double START = -135, SWEEP = 270;
		int minor = labelStep / 2;
		for (int v = 0; v <= max; v += minor) {
			double a = Math.toRadians(START + SWEEP * v / max);
			boolean major = v % labelStep == 0;
			g.pose().pushMatrix();
			g.pose().translate(cx, cy);
			g.pose().rotate((float) a);
			g.fill(major ? -1 : 0, -R + 2, major ? 1 : 1, -R + (major ? 8 : 5), major ? 0xFFFFFFFF : 0xFFB0B4BC);
			g.pose().popMatrix();
			if (major) {
				String t = Integer.toString(v);
				double rr = R - 15;
				float px = (float) (cx + rr * Math.sin(a)), py = (float) (cy - rr * Math.cos(a));
				g.pose().pushMatrix();
				g.pose().translate(px, py);
				g.pose().scale(0.5f, 0.5f);
				g.text(mc.font, t, -mc.font.width(t) / 2, -4, 0xFFFFFFFF, false);
				g.pose().popMatrix();
			}
		}
		// цифровое табло
		String num = Long.toString(Math.round(kmh));
		g.fill(cx - 14, cy + 14, cx + 14, cy + 25, 0xFF1A1C20);
		g.text(mc.font, num, cx - mc.font.width(num) / 2, cy + 15, 0xFFFFA030, false);
		g.pose().pushMatrix();
		g.pose().translate(cx + 15, cy + 19);
		g.pose().scale(0.5f, 0.5f);
		g.text(mc.font, "км/ч", 0, 0, DIM, false);
		g.pose().popMatrix();
		// стрелка
		double na = Math.toRadians(START + SWEEP * Math.min(kmh, max) / max);
		g.pose().pushMatrix();
		g.pose().translate(cx, cy);
		g.pose().rotate((float) na);
		g.fill(-1, -R + 6, 1, 6, 0xFFE02020);
		g.pose().popMatrix();
		disc(g, cx, cy, 4, 0xFF303338);
		// топливо (лава) и статус под циферблатом
		double fuel = ve.fuelValue() / Math.max(s.maxFuel(), 0.01);
		int bx = cx - R, by = cy + R + 6, bw = 2 * R;
		g.fill(bx, by, bx + bw, by + 4, 0xFF2A2E35);
		int fw = (int) Math.round(bw * Math.max(0, Math.min(1, fuel)));
		if (fw > 0) g.fill(bx, by, bx + fw, by + 4, fuel < 0.15 ? 0xFFFF4A3D : 0xFFFF8A00);
		String eng = ve.isBroken() ? "СЛОМАНА" : ve.isEngineOn() ? "ДВИГАТЕЛЬ" : "ЗАГЛУШЕН";
		int ec = ve.isBroken() ? 0xFFFF4A3D : ve.isEngineOn() ? 0xFF3DDC84 : DIM;
		g.pose().pushMatrix();
		g.pose().translate(bx, by + 7);
		g.pose().scale(0.6f, 0.6f);
		g.text(mc.font, eng + (ve.lightsOn() ? "  ФАРЫ" : "") + (ve.sirenOn() ? "  СИРЕНА" : "") + "  [" + RzAutoClient.MENU.getTranslatedKeyMessage().getString() + "] меню", 0, 0, ec, false);
		g.pose().popMatrix();
		if (fuel <= 0.12 && System.currentTimeMillis() / 400 % 2 == 0) g.text(mc.font, "МАЛО ТОПЛИВА", cx - R, cy - R - 12, 0xFFFF6A00, true);
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
