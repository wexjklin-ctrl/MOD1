package com.rzauto.client;

import com.rzauto.item.Passport;
import com.rzauto.net.PassportRequestPayload;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.player.PlayerSkin;
import net.minecraft.world.item.ItemStack;
import java.util.List;
import java.util.UUID;

/** Окно паспорта (клавиша I с паспортом в руке): вкладки ИНФО, НАРУШЕНИЯ, МАШИНЫ. Страна и герб задаются в паспортном столе. */
final class DocumentScreen extends net.minecraft.client.gui.screens.Screen {
	private static final String[] TABS = { "ИНФО", "НАРУШЕНИЯ", "МАШИНЫ" };
	private static final int[] TAB_COL = { 0xFF9BDB8A, 0xFFE0583A, 0xFF5FA4E0 };
	private final ItemStack doc;
	private int tab, scroll;
	private int px, py, pw, ph;

	DocumentScreen(ItemStack doc) {
		super(Component.literal("Паспорт"));
		this.doc = doc.copy();
		if (Passport.signed(doc)) ClientPlayNetworking.send(new PassportRequestPayload(Passport.ownerUuid(doc)));
	}

	@Override
	public boolean keyPressed(KeyEvent e) {
		if (RzAutoClient.MENU.matches(e)) { onClose(); return true; }
		return super.keyPressed(e);
	}

	@Override
	public boolean isPauseScreen() { return false; }

	private int tabX(int i) { return px + pw - 8 - (3 - i) * 84; }

	@Override
	public boolean mouseClicked(MouseButtonEvent e, boolean dbl) {
		for (int i = 0; i < 3; i++) {
			int tx = tabX(i);
			if (e.x() >= tx && e.x() < tx + 80 && e.y() >= py - 14 && e.y() < py + 4) { tab = i; scroll = 0; return true; }
		}
		return super.mouseClicked(e, dbl);
	}

	@Override
	public boolean mouseScrolled(double x, double y, double dx, double dy) {
		scroll = Math.max(0, scroll - (int) Math.signum(dy));
		return true;
	}

	private static PlayerSkin skinOf(UUID id) {
		Minecraft mc = Minecraft.getInstance();
		if (id != null && mc.getConnection() != null) {
			PlayerInfo pi = mc.getConnection().getPlayerInfo(id);
			if (pi != null) return pi.getSkin();
		}
		return mc.player != null ? mc.player.getSkin() : net.minecraft.client.resources.DefaultPlayerSkin.getDefaultSkin();
	}

	private static void part(GuiGraphicsExtractor g, Identifier tex, int dx, int dy, int dw, int dh, int u, int v, int uw, int vh) {
		g.blit(RenderPipelines.GUI_TEXTURED, tex, dx, dy, (float) u, (float) v, dw, dh, uw, vh, 64, 64);
	}

	private void body(GuiGraphicsExtractor g, PlayerSkin skin, int x, int y, int s) {
		Identifier t = skin.body().texturePath();
		boolean slim = skin.model() == net.minecraft.world.entity.player.PlayerModelType.SLIM;
		int aw = slim ? 3 : 4;
		for (int layer = 0; layer < 2; layer++) {
			int o = layer == 0 ? 0 : 16;
			part(g, t, x + 4 * s, y, 8 * s, 8 * s, layer == 0 ? 8 : 40, 8, 8, 8);
			part(g, t, x + 4 * s, y + 8 * s, 8 * s, 12 * s, 20, 20 + o, 8, 12);
			part(g, t, x + (4 - aw) * s, y + 8 * s, aw * s, 12 * s, 44, 20 + o, aw, 12);
			part(g, t, x + 12 * s, y + 8 * s, aw * s, 12 * s, layer == 0 ? 36 : 52, 52, aw, 12);
			part(g, t, x + 4 * s, y + 20 * s, 4 * s, 12 * s, 4, 20 + o, 4, 12);
			part(g, t, x + 8 * s, y + 20 * s, 4 * s, 12 * s, layer == 0 ? 20 : 4, 52, 4, 12);
		}
	}

	private static void seal(GuiGraphicsExtractor g, int idx, int x, int y, int size) {
		g.blit(RenderPipelines.GUI_TEXTURED, Identifier.fromNamespaceAndPath("rz_auto", "textures/gui/" + Passport.sealPath(idx) + ".png"), x, y, 0f, 0f, size, size, 256, 256, 256, 256);
	}

	private String clip(String s, int w) {
		if (font.width(s) <= w) return s;
		while (s.length() > 3 && font.width(s + "...") > w) s = s.substring(0, s.length() - 1);
		return s + "...";
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mx, int my, float pt) {
		g.fillGradient(0, 0, width, height, 0xB004100A, 0xD006180F);
		pw = Math.min(width - 20, 340); ph = Math.min(height - 40, 200);
		px = (width - pw) / 2; py = (height - ph) / 2 + 8;
		for (int i = 0; i < 3; i++) {   // вкладки над панелью
			int tx = tabX(i), top = tab == i ? py - 14 : py - 10;
			g.fill(tx, top, tx + 80, py + 4, 0xFF2E6BC8);
			g.fill(tx + 1, top + 1, tx + 79, py + 4, TAB_COL[i]);
			g.centeredText(font, TABS[i], tx + 40, top + 5, 0xFF202020);
		}
		g.fill(px, py, px + pw, py + ph, 0xFFEADFBE);
		g.fill(px + 4, py + 4, px + pw - 4, py + 6, 0xFF2E6BC8);
		g.fill(px + 4, py + ph - 6, px + pw - 4, py + ph - 4, 0xFF2E6BC8);
		g.fill(px + 4, py + 4, px + 6, py + ph - 4, 0xFF2E6BC8);
		g.fill(px + pw - 6, py + 4, px + pw - 4, py + ph - 4, 0xFF2E6BC8);
		g.text(font, "ПАСПОРТ", px + 14, py + 12, 0xFF1D4F9E, false);
		if (!Passport.signed(doc)) { g.text(font, "Документ не подписан", px + 14, py + 40, 0xFF8A2A2A, false); super.extractRenderState(g, mx, my, pt); return; }
		g.text(font, clip(Passport.country(doc), pw - 40), px + 14, py + 24, 0xFF4A6FA8, false);
		switch (tab) {
			case 0 -> info(g);
			case 1 -> violations(g);
			default -> cars(g);
		}
		super.extractRenderState(g, mx, my, pt);
	}

	private void info(GuiGraphicsExtractor g) {
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
		int sz = Math.min(96, ph - 64);
		seal(g, Passport.sealIndex(doc), px + pw - sz - 14, py + ph - sz - 12, sz);
	}

	private void violations(GuiGraphicsExtractor g) {
		List<String[]> v = PassportClient.uuid.equals(Passport.ownerUuid(doc)) ? PassportClient.violations : List.of();
		int rows = Math.max(1, (ph - 50) / 28);
		scroll = Math.min(scroll, Math.max(0, v.size() - rows));
		if (v.isEmpty()) { g.text(font, "Нарушений нет", px + 14, py + 44, 0xFF6A5F3E, false); return; }
		for (int i = 0; i < rows && scroll + i < v.size(); i++) {
			String[] r = v.get(scroll + i);
			if (r.length < 5) continue;
			int y = py + 40 + i * 28;
			g.fill(px + 12, y, px + pw - 12, y + 26, 0xFFDDD0A8);
			g.text(font, clip(r[0], pw - 90), px + 18, y + 4, 0xFF1A1A1A, false);
			g.text(font, clip(r[1] + "  " + r[2], pw - 90), px + 18, y + 15, 0xFF6A5F3E, false);
			int si; try { si = Integer.parseInt(r[3]); } catch (NumberFormatException e) { si = 0; }
			seal(g, si, px + pw - 12 - 26, y, 26);
		}
	}

	private void cars(GuiGraphicsExtractor g) {
		List<String[]> c = PassportClient.uuid.equals(Passport.ownerUuid(doc)) ? PassportClient.cars : List.of();
		int rows = Math.max(1, (ph - 50) / 14);
		scroll = Math.min(scroll, Math.max(0, c.size() - rows));
		if (c.isEmpty()) { g.text(font, "Машин нет", px + 14, py + 44, 0xFF6A5F3E, false); return; }
		for (int i = 0; i < rows && scroll + i < c.size(); i++) {
			String[] r = c.get(scroll + i);
			if (r.length < 4) continue;
			int y = py + 40 + i * 14;
			g.text(font, clip(r[0], pw - 160), px + 18, y, 0xFF1A1A1A, false);
			g.text(font, r[1] + " " + r[2] + " " + r[3], px + pw - 130, y, 0xFF6A5F3E, false);
		}
	}
}
