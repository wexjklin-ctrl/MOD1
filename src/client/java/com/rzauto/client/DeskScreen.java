package com.rzauto.client;

import com.rzauto.item.Passport;
import com.rzauto.net.DeskActionPayload;
import com.rzauto.net.DeskEditPayload;
import com.rzauto.net.DeskViolationPayload;
import java.util.List;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.world.item.ItemStack;

/**
 * Паспортный стол. Вкладки: ПАСПОРТ (страна и герб), НАРУШЕНИЕ (ник вручную или из списка онлайн, текст вручную, печать),
 * УДАЛЕНИЕ (нарушения выбранного игрока, удалять можно только свои). Печать справа (SEAL_*) не заходит на поля и кнопки слева (они кончаются на FIELD_W).
 */
final class DeskScreen extends net.minecraft.client.gui.screens.Screen {
	private static final int PW = 300, PH = 190;
	/** Левая колонка полей/кнопок: x0 + LX .. x0 + LX + FIELD_W. */
	private static final int LX = 16, FIELD_W = 180;
	/** Печать: справа от колонки полей, не пересекается с ней. */
	private static final int SEAL_SZ = 72, SEAL_X = PW - 16 - SEAL_SZ, SEAL_Y = 40;
	private static final int ROWS = 4;
	private final BlockPos pos;
	private int tab = 0, seal = -1, page = 0, seenVer = -1, onlineIdx = -1;
	private boolean stamped;
	private String country, target = "", text = "";

	DeskScreen(BlockPos pos) {
		super(Component.literal("Паспортный стол"));
		this.pos = pos;
	}

	private ItemStack myPassport() {
		if (minecraft == null || minecraft.player == null) return ItemStack.EMPTY;
		var inv = minecraft.player.getInventory();
		String me = minecraft.player.getUUID().toString();
		for (int i = 0; i < inv.getContainerSize(); i++) {
			ItemStack st = inv.getItem(i);
			if (Passport.signed(st) && Passport.ownerUuid(st).equals(me)) return st;
		}
		return ItemStack.EMPTY;
	}

	private int x0() { return (width - PW) / 2; }
	private int y0() { return (height - PH) / 2; }
	private String me() { return minecraft != null && minecraft.player != null ? minecraft.player.getName().getString() : ""; }

	private void query() { ClientPlayNetworking.send(new DeskActionPayload(pos.asLong(), 0, target, 0, "")); }

	/** Следующий ник из списка онлайн в поле игрока. */
	private void nextOnline() {
		List<String> on = PassportClient.deskOnline;
		if (on.isEmpty()) { query(); return; }
		onlineIdx = (onlineIdx + 1) % on.size();
		target = on.get(onlineIdx);
		if (tab == 2) { page = 0; query(); }
		rebuildWidgets();
	}

	private void nickRow(int x0, int y0, int boxW) {
		EditBox t1 = new EditBox(font, x0 + LX, y0 + 44, boxW, 18, Component.literal("Игрок"));
		t1.setMaxLength(16); t1.setValue(target); t1.setResponder(s -> target = s);
		addRenderableWidget(t1);
		addRenderableWidget(Button.builder(Component.literal("Онлайн"), b -> nextOnline()).bounds(x0 + LX + boxW + 4, y0 + 44, FIELD_W - boxW - 4, 18).build());
	}

	@Override
	protected void init() {
		ItemStack pass = myPassport();
		if (country == null) country = Passport.country(pass);
		if (seal < 0) seal = Passport.sealIndex(pass);
		if (seenVer < 0) { seenVer = PassportClient.deskVer; query(); }
		int x0 = x0(), y0 = y0();
		if (pass.isEmpty()) return;
		int n = Passport.SEALS.length;
		if (tab == 0) {
			EditBox eb = new EditBox(font, x0 + LX, y0 + 44, FIELD_W, 18, Component.literal("Страна"));
			eb.setMaxLength(32);
			eb.setValue(country);
			eb.setResponder(s -> country = s);
			addRenderableWidget(eb);
			addRenderableWidget(Button.builder(Component.literal("<"), b -> { seal = (seal + n - 1) % n; }).bounds(x0 + LX, y0 + 88, 20, 18).build());
			addRenderableWidget(Button.builder(Component.literal(">"), b -> { seal = (seal + 1) % n; }).bounds(x0 + LX + FIELD_W - 20, y0 + 88, 20, 18).build());
			addRenderableWidget(Button.builder(Component.literal("Сохранить в паспорт"), b -> ClientPlayNetworking.send(new DeskEditPayload(pos.asLong(), country, seal))).bounds(x0 + LX, y0 + 130, FIELD_W, 20).build());
		} else if (tab == 1) {
			nickRow(x0, y0, 116);
			EditBox t2 = new EditBox(font, x0 + LX, y0 + 80, FIELD_W, 18, Component.literal("Нарушение"));
			t2.setMaxLength(80); t2.setValue(text); t2.setResponder(s -> text = s);
			addRenderableWidget(t2);
			addRenderableWidget(Button.builder(Component.literal(stamped ? "Печать приложена" : "Приложить печать"), b -> { stamped = !stamped; rebuildWidgets(); }).bounds(x0 + LX, y0 + 106, FIELD_W, 18).build());
			addRenderableWidget(Button.builder(Component.literal("Отправить нарушение"), b -> { ClientPlayNetworking.send(new DeskViolationPayload(pos.asLong(), target, text)); text = ""; stamped = false; rebuildWidgets(); }).bounds(x0 + LX, y0 + 130, FIELD_W, 20).build()).active = stamped;
		} else {
			nickRow(x0, y0, 116);
			addRenderableWidget(Button.builder(Component.literal("Показать"), b -> { page = 0; query(); }).bounds(x0 + LX + FIELD_W + 4, y0 + 44, PW - LX * 2 - FIELD_W - 4, 18).build());
			List<String[]> v = PassportClient.deskTarget.equalsIgnoreCase(target) ? PassportClient.deskViol : List.of();
			int pages = Math.max(1, (v.size() + ROWS - 1) / ROWS);
			page = Math.max(0, Math.min(page, pages - 1));
			for (int r = 0; r < ROWS; r++) {
				int idx = page * ROWS + r;
				if (idx >= v.size()) break;
				String[] row = v.get(idx);
				boolean mine = row.length > 4 && row[4].equalsIgnoreCase(me());
				final int fi = idx; final String ft = row[0];
				addRenderableWidget(Button.builder(Component.literal("X"), b -> ClientPlayNetworking.send(new DeskActionPayload(pos.asLong(), 1, target, fi, ft))).bounds(x0 + PW - LX - 20, y0 + 70 + r * 20, 20, 18).build()).active = mine;
			}
			addRenderableWidget(Button.builder(Component.literal("<"), b -> { page--; rebuildWidgets(); }).bounds(x0 + LX, y0 + 160, 20, 18).build()).active = page > 0;
			addRenderableWidget(Button.builder(Component.literal(">"), b -> { page++; rebuildWidgets(); }).bounds(x0 + LX + 24, y0 + 160, 20, 18).build()).active = page < pages - 1;
		}
	}

	@Override
	public void tick() {
		super.tick();
		if (minecraft.player == null || minecraft.player.distanceToSqr(pos.getX() + 0.5, pos.getY() + 0.5, pos.getZ() + 0.5) > 64) { onClose(); return; }
		if (seenVer != PassportClient.deskVer) { seenVer = PassportClient.deskVer; if (tab == 2) rebuildWidgets(); }
	}

	private int tabX(int i) { return x0() + PW - 8 - (3 - i) * 96; }

	@Override
	public boolean mouseClicked(MouseButtonEvent e, boolean dbl) {
		for (int i = 0; i < 3; i++) {
			int tx = tabX(i);
			if (e.x() >= tx && e.x() < tx + 92 && e.y() >= y0() - 14 && e.y() < y0() + 4) { if (tab != i) { tab = i; page = 0; rebuildWidgets(); } return true; }
		}
		return super.mouseClicked(e, dbl);
	}

	@Override
	public boolean isPauseScreen() { return false; }

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mx, int my, float pt) {
		int x0 = x0(), y0 = y0();
		g.fillGradient(0, 0, width, height, 0xB004100A, 0xD006180F);
		String[] names = { "ПАСПОРТ", "НАРУШЕНИЕ", "УДАЛЕНИЕ" };
		int[] cols = { 0xFF9BDB8A, 0xFFE0583A, 0xFFE8B84A };
		for (int i = 0; i < 3; i++) {
			int tx = tabX(i), top = tab == i ? y0 - 14 : y0 - 10;
			g.fill(tx, top, tx + 92, y0 + 4, 0xFF2E6BC8);
			g.fill(tx + 1, top + 1, tx + 91, y0 + 4, cols[i]);
			g.centeredText(font, names[i], tx + 46, top + 5, 0xFF202020);
		}
		for (int k = 3; k >= 1; k--) { g.fill(x0 + k * 4, y0 + k * 4, x0 + PW + k * 4, y0 + PH + k * 4, 0xFF2E6BC8); g.fill(x0 + k * 4 + 1, y0 + k * 4 + 1, x0 + PW + k * 4 - 1, y0 + PH + k * 4 - 1, 0xFFD8CCA6); }
		g.fill(x0, y0, x0 + PW, y0 + PH, 0xFFEADFBE);
		g.fill(x0 + 4, y0 + 4, x0 + PW - 4, y0 + 6, 0xFF2E6BC8);
		g.fill(x0 + 4, y0 + PH - 6, x0 + PW - 4, y0 + PH - 4, 0xFF2E6BC8);
		g.fill(x0 + 4, y0 + 4, x0 + 6, y0 + PH - 4, 0xFF2E6BC8);
		g.fill(x0 + PW - 6, y0 + 4, x0 + PW - 4, y0 + PH - 4, 0xFF2E6BC8);
		g.text(font, "ПАСПОРТНЫЙ СТОЛ", x0 + 12, y0 + 10, 0xFF1D4F9E, false);
		ItemStack pass = myPassport();
		if (pass.isEmpty()) { g.text(font, "Нужен ваш подписанный паспорт", x0 + LX, y0 + 70, 0xFF8A2A2A, false); super.extractRenderState(g, mx, my, pt); return; }
		int c = 0xFF6A5F3E;
		if (tab != 2) {
			int sx = x0 + SEAL_X, sy = y0 + SEAL_Y;
			g.fill(sx - 4, sy - 4, sx + SEAL_SZ + 4, sy + SEAL_SZ + 4, 0xFFD3C79F);
			int shown = tab == 0 ? seal : Passport.sealIndex(pass);
			if (tab == 0 || stamped) g.blit(RenderPipelines.GUI_TEXTURED, Identifier.fromNamespaceAndPath("rz_auto", "textures/gui/" + Passport.sealPath(shown) + ".png"), sx, sy, 0f, 0f, SEAL_SZ, SEAL_SZ, 256, 256, 256, 256);
			else g.centeredText(font, "место для печати", sx + SEAL_SZ / 2, sy + SEAL_SZ / 2 - 4, 0xFF9A8E68);
		}
		if (tab == 0) {
			g.text(font, "Название страны", x0 + LX, y0 + 32, c, false);
			g.text(font, "Герб", x0 + LX, y0 + 76, c, false);
			g.centeredText(font, Passport.SEAL_NAMES[Math.floorMod(seal, Passport.SEALS.length)], x0 + LX + FIELD_W / 2, y0 + 93, 0xFF1A1A1A);
		} else if (tab == 1) {
			g.text(font, "Игрок (ник вручную или «Онлайн»)", x0 + LX, y0 + 32, c, false);
			g.text(font, "Нарушение (текст вручную)", x0 + LX, y0 + 68, c, false);
			g.text(font, clip(Passport.country(pass), FIELD_W), x0 + LX, y0 + 158, 0xFF4A6FA8, false);
		} else {
			g.text(font, "Игрок", x0 + LX, y0 + 32, c, false);
			List<String[]> v = PassportClient.deskTarget.equalsIgnoreCase(target) ? PassportClient.deskViol : List.of();
			if (target.isEmpty()) g.text(font, "Введите ник или нажмите «Онлайн»", x0 + LX, y0 + 74, 0xFF9A8E68, false);
			else if (v.isEmpty()) g.text(font, "Нарушений нет (нажмите «Показать»)", x0 + LX, y0 + 74, 0xFF9A8E68, false);
			for (int r = 0; r < ROWS; r++) {
				int idx = page * ROWS + r;
				if (idx >= v.size()) break;
				String[] row = v.get(idx);
				boolean mine = row.length > 4 && row[4].equalsIgnoreCase(me());
				g.text(font, clip((row.length > 1 ? row[1] + "  " : "") + row[0], PW - LX * 2 - 26), x0 + LX, y0 + 75 + r * 20, mine ? 0xFF1A1A1A : 0xFF8A8268, false);
			}
			g.text(font, "Удалять можно только свои нарушения", x0 + LX + 52, y0 + 165, c, false);
		}
		super.extractRenderState(g, mx, my, pt);
	}

	private String clip(String s, int w) {
		if (font.width(s) <= w) return s;
		while (s.length() > 3 && font.width(s + "...") > w) s = s.substring(0, s.length() - 1);
		return s + "...";
	}
}
