package com.rzauto.client;

import com.rzauto.item.Passport;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.player.PlayerSkin;
import net.minecraft.world.item.ItemStack;
import java.util.UUID;

/** Окно паспорта: актуальный скин владельца (вид спереди), ник, дата выдачи и печать. Открывается клавишей I с паспортом в руке вне машины. */
final class DocumentScreen extends net.minecraft.client.gui.screens.Screen {
	private final ItemStack doc;

	DocumentScreen(ItemStack doc) {
		super(Component.literal("Паспорт"));
		this.doc = doc.copy();
	}

	@Override
	public boolean keyPressed(KeyEvent e) {
		if (RzAutoClient.MENU.matches(e)) { onClose(); return true; }
		return super.keyPressed(e);
	}

	@Override
	public boolean isPauseScreen() { return false; }

	private static PlayerSkin skinOf(UUID id) {
		Minecraft mc = Minecraft.getInstance();
		if (id != null && mc.getConnection() != null) {
			PlayerInfo pi = mc.getConnection().getPlayerInfo(id);
			if (pi != null) return pi.getSkin();
		}
		return mc.player != null ? mc.player.getSkin() : net.minecraft.client.resources.DefaultPlayerSkin.getDefaultSkin();
	}

	/** Область текстуры скина 64x64 -> на экран с масштабом. */
	private static void part(GuiGraphicsExtractor g, Identifier tex, int dx, int dy, int dw, int dh, int u, int v, int uw, int vh) {
		g.blit(RenderPipelines.GUI_TEXTURED, tex, dx, dy, (float) u, (float) v, dw, dh, uw, vh, 64, 64);
	}

	private void body(GuiGraphicsExtractor g, PlayerSkin skin, int x, int y, int s) {
		Identifier t = skin.body().texturePath();
		boolean slim = skin.model() == net.minecraft.world.entity.player.PlayerModelType.SLIM;
		int aw = slim ? 3 : 4;
		for (int layer = 0; layer < 2; layer++) {
			int o = layer == 0 ? 0 : 16;   // внешний слой смещён по V на 16, по U на 16 для нижней части тела
			part(g, t, x + 4 * s, y, 8 * s, 8 * s, layer == 0 ? 8 : 40, 8, 8, 8);                       // голова
			part(g, t, x + 4 * s, y + 8 * s, 8 * s, 12 * s, 20, 20 + o, 8, 12);                          // тело
			part(g, t, x + (4 - aw) * s, y + 8 * s, aw * s, 12 * s, 44, 20 + o, aw, 12);                 // правая рука
			part(g, t, x + 12 * s, y + 8 * s, aw * s, 12 * s, layer == 0 ? 36 : 52, 52, aw, 12);         // левая рука
			part(g, t, x + 4 * s, y + 20 * s, 4 * s, 12 * s, 4, 20 + o, 4, 12);                          // правая нога
			part(g, t, x + 8 * s, y + 20 * s, 4 * s, 12 * s, layer == 0 ? 20 : 4, 52, 4, 12);            // левая нога
		}
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mx, int my, float pt) {
		g.fillGradient(0, 0, width, height, 0xB004100A, 0xD006180F);
		int pw = Math.min(width - 20, 340), ph = Math.min(height - 20, 200);
		int px = (width - pw) / 2, py = (height - ph) / 2;
		g.fill(px, py, px + pw, py + ph, 0xFFEADFBE);
		g.fill(px + 4, py + 4, px + pw - 4, py + 6, 0xFF2E6BC8);
		g.fill(px + 4, py + ph - 6, px + pw - 4, py + ph - 4, 0xFF2E6BC8);
		g.fill(px + 4, py + 4, px + 6, py + ph - 4, 0xFF2E6BC8);
		g.fill(px + pw - 6, py + 4, px + pw - 4, py + ph - 4, 0xFF2E6BC8);
		g.text(font, "ПАСПОРТ", px + 14, py + 12, 0xFF1D4F9E, false);
		g.text(font, "RZ Федеративное объединение", px + 14, py + 24, 0xFF4A6FA8, false);
		if (Passport.signed(doc)) {
			UUID id = null;
			try { id = UUID.fromString(Passport.ownerUuid(doc)); } catch (Exception ignored) { }
			int s = Math.max(2, Math.min(4, (ph - 56) / 32));
			int bx = px + 18, by = py + 40;
			g.fill(bx - 4, by - 4, bx + 16 * s + 4, by + 32 * s + 4, 0xFFD3C79F);
			body(g, skinOf(id), bx, by, s);
			int tx = bx + 16 * s + 20;
			g.text(font, "Владелец", tx, py + 44, 0xFF6A5F3E, false);
			g.text(font, Passport.ownerName(doc), tx, py + 56, 0xFF1A1A1A, false);
			g.text(font, "Дата выдачи", tx, py + 78, 0xFF6A5F3E, false);
			g.text(font, Passport.date(doc), tx, py + 90, 0xFF1A1A1A, false);
			g.text(font, "Положите в бардачок машины,", tx, py + 118, 0xFF6A5F3E, false);
			g.text(font, "оформленной на владельца.", tx, py + 130, 0xFF6A5F3E, false);
			g.text(font, "ПКМ с паспортом: сменить печать", tx, py + 148, 0xFF6A5F3E, false);
			int sz = Math.min(96, ph - 64);
			g.blit(RenderPipelines.GUI_TEXTURED, Identifier.fromNamespaceAndPath("rz_auto", "textures/gui/" + Passport.seal(doc) + ".png"), px + pw - sz - 14, py + ph - sz - 12, 0f, 0f, sz, sz, 256, 256, 256, 256);
		} else {
			g.text(font, "Документ не подписан", px + 14, py + 56, 0xFF8A2A2A, false);
			g.text(font, "Присядьте (Shift) и нажмите ПКМ,", px + 14, py + 76, 0xFF1A1A1A, false);
			g.text(font, "держа паспорт в руке, чтобы присвоить его себе.", px + 14, py + 88, 0xFF1A1A1A, false);
		}
		super.extractRenderState(g, mx, my, pt);
	}
}
