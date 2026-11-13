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

/**
 * Окно паспорта (клавиша I с паспортом в руке): вкладки ИНФО, НАРУШЕНИЯ, МАШИНЫ на задниках из pasport.zip (PassportUi).
 * Страна, герб и дата регистрации берутся из профиля игрока на сервере: все паспорта одного игрока показывают одно и то же.
 */
final class DocumentScreen extends net.minecraft.client.gui.screens.Screen {
	private static final String[] TABS = { "ИНФО", "НАРУШЕНИЯ", "МАШИНЫ" };
	private final ItemStack doc;
	private final PassportUi ui = new PassportUi();
	private int tab, scroll;

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

	private boolean signed() { return Passport.signed(doc); }

	@Override
	public boolean mouseClicked(MouseButtonEvent e, boolean dbl) {
		if (signed()) {
			for (int i = 0; i < 3; i++) {
				if (ui.tabHit(e.x(), e.y(), i, false)) { tab = i; scroll = 0; return true; }
			}
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
		return net.minecraft.client.resources.DefaultPlayerSkin.getDefaultSkin();
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

	private boolean profileReady() { return PassportClient.uuid.equals(Passport.ownerUuid(doc)); }

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mx, int my, float pt) {
		g.fillGradient(0, 0, width, height, 0xB004100A, 0xD006180F);
		ui.layout(width, height);
		boolean ok = signed();
		ui.background(g, ok ? (tab == 0 ? PassportUi.GREEN : tab == 1 ? PassportUi.RED : PassportUi.BLUE) : PassportUi.BEIGE);
		ui.tabLabels(g, font, TABS, ok ? tab : -1, !ok);
		if (!ok) {
			PassportUi.big(g, font, "ПАСПОРТ", ui.ax() + 4, ui.ay() + 10, 2f, PassportUi.INK);
			g.text(font, "Документ не подписан", ui.ax() + 4, ui.ay() + 40, PassportUi.WARN, false);
			g.text(font, "Shift + ПКМ с паспортом в руке: присвоить его себе", ui.ax() + 4, ui.ay() + 56, PassportUi.INK2, false);
			super.extractRenderState(g, mx, my, pt);
			return;
		}
		skinPanel(g);
		switch (tab) {
			case 0 -> info(g);
			case 1 -> violations(g);
			default -> cars(g);
		}
		super.extractRenderState(g, mx, my, pt);
	}

	/** Скин владельца в тёмной панели слева: на всех вкладках, чтобы панель не пустовала. */
	private void skinPanel(GuiGraphicsExtractor g) {
		UUID id = null;
		try { id = UUID.fromString(Passport.ownerUuid(doc)); } catch (Exception ignored) { }
		int pw = ui.len(PassportUi.PHOTO_W), phh = ui.len(PassportUi.PHOTO_H);
		int bs = Math.max(1, Math.min(pw / 18, phh / 34));
		body(g, skinOf(id), ui.x(PassportUi.PHOTO_X) + (pw - 16 * bs) / 2, ui.y(PassportUi.PHOTO_Y) + (phh - 32 * bs) / 2, bs);
	}

	private void info(GuiGraphicsExtractor g) {
		int ax = ui.ax() + 4, ay = ui.ay();
		boolean ready = profileReady();
		String[] pr = ready ? PassportClient.profile : new String[0];
		PassportUi.big(g, font, "ПАСПОРТ", ax, ay + 6, 2f, PassportUi.INK);
		String name = !PassportClient.name(pr).isEmpty() ? PassportClient.name(pr) : Passport.ownerName(doc);
		String date = !PassportClient.date(pr).isEmpty() ? PassportClient.date(pr) : Passport.date(doc);
		String country = PassportClient.country(pr);
		int y = ay + 34, step = Math.max(26, ui.len(54));
		g.text(font, "Владелец", ax, y, PassportUi.INK2, false);
		g.text(font, name, ax, y + 11, PassportUi.INK, false);
		g.text(font, "Дата регистрации", ax, y + step, PassportUi.INK2, false);
		g.text(font, date, ax, y + step + 11, PassportUi.INK, false);
		g.text(font, "Страна", ax, y + step * 2, PassportUi.INK2, false);
		if (!ready) g.text(font, "Загрузка...", ax, y + step * 2 + 11, PassportUi.INK2, false);
		else if (country.isEmpty()) g.text(font, PassportUi.clip(font, "не присвоена (вписывает администратор)", ui.aw() - 24), ax, y + step * 2 + 11, PassportUi.WARN, false);
		else g.text(font, PassportUi.clip(font, country, ui.aw() - 150), ax, y + step * 2 + 11, PassportUi.INK, false);
		// герб страны справа внизу
		int sz = Math.max(64, Math.min(ui.len(250), ui.ah() - 60));
		int sx = ui.x(915) - sz, sy = ui.y(525) - sz;
		int seal = PassportClient.seal(pr);
		if (ready && seal >= 0) PassportUi.seal(g, seal, sx, sy, sz);
		else {
			g.outline(sx, sy, sz, sz, 0x884A3A1E);
			PassportUi.ctext(g, font, "герб", sx + sz / 2, sy + sz / 2 - 10, PassportUi.INK2);
			PassportUi.ctext(g, font, "не присвоен", sx + sz / 2, sy + sz / 2 + 2, PassportUi.INK2);
		}
	}

	private void violations(GuiGraphicsExtractor g) {
		List<String[]> v = profileReady() ? PassportClient.violations : List.of();
		int ax = ui.ax() + 4, ay = ui.ay();
		int right = ui.ax() + ui.aw() - 6;   // правая граница рабочей области: ничего не заходит дальше
		PassportUi.big(g, font, "НАРУШЕНИЯ", ax, ay + 6, 2f, PassportUi.INK);
		int top = ay + 34, rh = Math.max(38, ui.len(60));
		int rows = Math.max(1, (ui.ay() + ui.ah() - top) / rh);
		scroll = Math.min(scroll, Math.max(0, v.size() - rows));
		if (v.isEmpty()) { g.text(font, profileReady() ? "Нарушений нет" : "Загрузка...", ax, top + 6, PassportUi.INK2, false); return; }
		// печать БОЛЬШЕ карточки: соседние печати намеренно налезают друг на друга (фишка), как поставленные рукой стопкой
		int seal = rh + 40, cardR = right - 64, textW = cardR - ax - 12;
		for (int i = 0; i < rows && scroll + i < v.size(); i++) {
			String[] r = v.get(scroll + i);
			if (r.length < 5) continue;
			int y = top + i * rh;
			g.fill(ax - 2, y, cardR, y + rh - 6, 0x26000000);
			PassportUi.wrap(g, font, r[0], ax + 4, y + 4, textW, 2, PassportUi.INK);
			g.text(font, PassportUi.clip(font, r[1] + "  выдал: " + r[4], textW), ax + 4, y + rh - 18, PassportUi.INK2, false);
		}
		// печати поверх карточек: у каждой свой сдвиг и наклон, приглушённые чернила
		for (int i = 0; i < rows && scroll + i < v.size(); i++) {
			String[] r = v.get(scroll + i);
			if (r.length < 5) continue;
			int cy = top + i * rh + (rh - 6) / 2;
			PassportUi.stamp(g, PassportClient.sealOf(r), right - seal / 2 + 4, cy, seal, PassportClient.seed(r));
		}
		if (v.size() > rows) {
			String cnt = (scroll + 1) + "-" + Math.min(v.size(), scroll + rows) + " из " + v.size();
			String ct = cnt + "  колесо мыши";
			g.text(font, ct, Math.min(ax + 150, right - font.width(ct)), ay + 14, PassportUi.INK2, false);
		}
	}

	/** Предмет машины по её названию (название сущности = название предмета); null, если не нашли. */
	private static final java.util.Map<String, ItemStack> ICONS = new java.util.HashMap<>();
	private static ItemStack iconOf(String name) {
		if (ICONS.isEmpty()) {
			for (com.rzauto.VehicleRegistry.Entry e : com.rzauto.VehicleRegistry.entries()) {
				ICONS.putIfAbsent(e.type().getDescription().getString(), new ItemStack(e.item()));
				ICONS.putIfAbsent(e.item().getName(new ItemStack(e.item())).getString(), new ItemStack(e.item()));
			}
		}
		return ICONS.getOrDefault(name, ItemStack.EMPTY);
	}

	private void cars(GuiGraphicsExtractor g) {
		List<String[]> c = profileReady() ? PassportClient.cars : List.of();
		int ax = ui.ax() + 4, ay = ui.ay();
		int right = ui.ax() + ui.aw() - 6;
		PassportUi.big(g, font, "МАШИНЫ", ax, ay + 6, 2f, PassportUi.INK);
		int top = ay + 40, rh = 18;
		int rows = Math.max(1, (ui.ay() + ui.ah() - top) / rh);
		scroll = Math.min(scroll, Math.max(0, c.size() - rows));
		if (c.isEmpty()) { g.text(font, profileReady() ? "Машин нет" : "Загрузка...", ax, top, PassportUi.INK2, false); return; }
		int x0 = ax + 14;   // список сдвинут правее: слева место под иконку предмета
		int coordsW = 0;
		for (int i = 0; i < rows && scroll + i < c.size(); i++) {
			String[] r = c.get(scroll + i);
			if (r.length >= 4) coordsW = Math.max(coordsW, font.width(r[1] + " " + r[2] + " " + r[3]));
		}
		for (int i = 0; i < rows && scroll + i < c.size(); i++) {
			String[] r = c.get(scroll + i);
			if (r.length < 4) continue;
			int y = top + i * rh;
			ItemStack ic = iconOf(r[0]);
			if (!ic.isEmpty()) g.item(ic, ax, y - 4);
			g.text(font, PassportUi.clip(font, r[0], right - x0 - coordsW - 24), x0 + 4, y, PassportUi.INK, false);
			String co = r[1] + " " + r[2] + " " + r[3];
			g.text(font, co, right - font.width(co), y, PassportUi.INK2, false);
		}
		if (c.size() > rows) {
			String cnt = (scroll + 1) + "-" + Math.min(c.size(), scroll + rows) + " из " + c.size();
			g.text(font, cnt, right - font.width(cnt), ay + 14, PassportUi.INK2, false);
		}
	}
}
