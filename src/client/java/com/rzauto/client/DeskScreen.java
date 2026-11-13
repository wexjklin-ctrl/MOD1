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
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;

/**
 * Паспортный стол (только для админа сервера; остальные видят пояснение). Задники и язычки из pasport.zip (PassportUi).
 * Вкладки: ПАСПОРТ (админ вписывает игроку страну и герб; их показывают все паспорта игрока), НАРУШЕНИЕ (ник вручную или из «Онлайн», текст вручную,
 * печать выбирается независимо от герба в паспорте), УДАЛЕНИЕ (любое нарушение выбранного игрока).
 * Слева, в тёмной панели картинки, показывается печать/герб, всё остальное справа в рабочей области, поэтому ничего не пересекается.
 */
final class DeskScreen extends net.minecraft.client.gui.screens.Screen {
	private static final String[] TABS = { "ПАСПОРТ", "НАРУШЕНИЕ", "УДАЛЕНИЕ" };
	private final BlockPos pos;
	private final PassportUi ui = new PassportUi();
	private final int ver0 = PassportClient.deskVer;
	private int tab = 0, seal = 0, vSeal = 0, page = 0, seenVer = -1, onlineIdx = -1;
	private String country = "", target = "", text = "", filledFor = "";

	DeskScreen(BlockPos pos) {
		super(Component.literal("Паспортный стол"));
		this.pos = pos;
		// клик по столу паспортом в руке: сразу выбран владелец этого паспорта, его данные загружаются для правки
		String pre = com.rzauto.block.PassportDeskBlock.PREFILL;
		com.rzauto.block.PassportDeskBlock.PREFILL = "";
		if (pre != null && !pre.isEmpty()) { target = pre; }
	}

	private boolean loaded() { return PassportClient.deskVer > ver0; }
	private boolean admin() { return loaded() && PassportClient.deskAdmin; }
	private boolean targetMatches() { return !target.isEmpty() && PassportClient.deskTarget.equalsIgnoreCase(target); }
	private String[] targetProfile() { return targetMatches() ? PassportClient.deskProfile : new String[0]; }
	/** Профиль выбранного игрока найден (у игрока есть паспорт). */
	private boolean hasProfile() { return targetProfile().length > 0; }
	private List<String[]> targetViol() { return targetMatches() ? PassportClient.deskViol : List.of(); }

	private void query() { ClientPlayNetworking.send(new DeskActionPayload(pos.asLong(), 0, target, 0, "")); }

	/** Следующий ник из списка онлайн в поле игрока. */
	private void nextOnline() {
		List<String> on = PassportClient.deskOnline;
		if (on.isEmpty()) { query(); return; }
		onlineIdx = (onlineIdx + 1) % on.size();
		target = on.get(onlineIdx);
		page = 0;
		query();
		rebuildWidgets();
	}

	/** Шаг между полями: растёт с окном (34..54), чтобы стол не жался вверх на больших экранах и влезал на маленьких. */
	private int grp() { return Math.max(34, Math.min(54, ui.ah() / 8)); }
	private int lx() { return ui.ax() + 4; }
	private int fw() { return Math.min(ui.aw() - 8, 400); }
	private int y0() { return ui.ay() + 34; }

	private void nickRow(int y) {
		int boxW = fw() - 136;
		EditBox t1 = new EditBox(font, lx(), y + 11, boxW, 18, Component.literal("Игрок"));
		t1.setMaxLength(16); t1.setValue(target); t1.setResponder(s -> target = s);
		addRenderableWidget(t1);
		addRenderableWidget(Button.builder(Component.literal("Онлайн"), b -> nextOnline()).bounds(lx() + boxW + 4, y + 11, 64, 18).build());
		addRenderableWidget(Button.builder(Component.literal("Найти"), b -> { page = 0; query(); }).bounds(lx() + boxW + 72, y + 11, 64, 18).build());
	}

	/** Строка выбора печати: < имя > (под подписью на y). */
	private void sealRow(int y, boolean forViolation) {
		int n = Passport.SEALS.length;
		addRenderableWidget(Button.builder(Component.literal("<"), b -> { if (forViolation) vSeal = (vSeal + n - 1) % n; else seal = (seal + n - 1) % n; }).bounds(lx(), y + 11, 22, 18).build());
		addRenderableWidget(Button.builder(Component.literal(">"), b -> { if (forViolation) vSeal = (vSeal + 1) % n; else seal = (seal + 1) % n; }).bounds(lx() + fw() - 22, y + 11, 22, 18).build());
	}

	private int rows() { return Math.max(2, Math.min(10, (ui.ay() + ui.ah() - (y0() + 44) - 26) / 20)); }

	@Override
	protected void init() {
		ui.layout(width, height);
		if (seenVer < 0) { seenVer = PassportClient.deskVer; query(); }
		if (!admin()) return;
		int y0 = y0();
		if (tab == 0) {
			nickRow(y0);
			EditBox eb = new EditBox(font, lx(), y0 + grp() + 11, fw(), 18, Component.literal("Страна"));
			eb.setMaxLength(32); eb.setValue(country); eb.setResponder(s -> country = s);
			addRenderableWidget(eb);
			sealRow(y0 + grp() * 2, false);
			boolean can = hasProfile() && !country.trim().isEmpty();
			addRenderableWidget(Button.builder(Component.literal("Вписать страну и герб в паспорт"), b -> ClientPlayNetworking.send(new DeskEditPayload(pos.asLong(), target, country, seal))).bounds(lx(), y0 + grp() * 3 + 2, fw(), 20).build()).active = can;
		} else if (tab == 1) {
			nickRow(y0);
			EditBox t2 = new EditBox(font, lx(), y0 + grp() + 11, fw(), 18, Component.literal("Нарушение"));
			t2.setMaxLength(80); t2.setValue(text); t2.setResponder(s -> text = s);
			addRenderableWidget(t2);
			sealRow(y0 + grp() * 2, true);
			boolean can = !target.trim().isEmpty() && !text.trim().isEmpty();
			addRenderableWidget(Button.builder(Component.literal("Выдать нарушение"), b -> { ClientPlayNetworking.send(new DeskViolationPayload(pos.asLong(), target, text, vSeal)); text = ""; rebuildWidgets(); }).bounds(lx(), y0 + grp() * 3 + 2, fw(), 20).build()).active = can;
		} else {
			nickRow(y0);
			List<String[]> v = targetViol();
			int rows = rows();
			int pages = Math.max(1, (v.size() + rows - 1) / rows);
			page = Math.max(0, Math.min(page, pages - 1));
			for (int r = 0; r < rows; r++) {
				int idx = page * rows + r;
				if (idx >= v.size()) break;
				final int fi = idx; final String ft = v.get(idx)[0];
				addRenderableWidget(Button.builder(Component.literal("X"), b -> ClientPlayNetworking.send(new DeskActionPayload(pos.asLong(), 1, target, fi, ft))).bounds(lx() + fw() - 22, y0 + 44 + r * 20, 22, 18).build());
			}
			int by = ui.ay() + ui.ah() - 22;
			addRenderableWidget(Button.builder(Component.literal("<"), b -> { page--; rebuildWidgets(); }).bounds(lx(), by, 22, 18).build()).active = page > 0;
			addRenderableWidget(Button.builder(Component.literal(">"), b -> { page++; rebuildWidgets(); }).bounds(lx() + 26, by, 22, 18).build()).active = page < pages - 1;
		}
	}

	@Override
	public void tick() {
		super.tick();
		if (minecraft.player == null || minecraft.player.distanceToSqr(pos.getX() + 0.5, pos.getY() + 0.5, pos.getZ() + 0.5) > 64) { onClose(); return; }
		if (seenVer != PassportClient.deskVer) {
			seenVer = PassportClient.deskVer;
			// пришли данные игрока: подставить его страну и герб в поля (один раз для каждого ника)
			String[] pr = targetProfile();
			if (pr.length > 0 && !filledFor.equalsIgnoreCase(target)) {
				filledFor = target;
				country = PassportClient.country(pr);
				seal = Math.max(0, PassportClient.seal(pr));
			}
			rebuildWidgets();
		}
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent e, boolean dbl) {
		if (admin()) {
			for (int i = 0; i < 3; i++) {
				if (ui.tabHit(e.x(), e.y(), i, false)) { if (tab != i) { tab = i; page = 0; rebuildWidgets(); } return true; }
			}
		}
		return super.mouseClicked(e, dbl);
	}

	@Override
	public boolean isPauseScreen() { return false; }

	private void label(GuiGraphicsExtractor g, String s, int y) { g.text(font, s, lx(), y, PassportUi.INK2, false); }

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mx, int my, float pt) {
		g.fillGradient(0, 0, width, height, 0xB004100A, 0xD006180F);
		ui.layout(width, height);
		boolean adm = admin();
		ui.background(g, adm ? tab : PassportUi.BEIGE);
		ui.tabLabels(g, font, TABS, adm ? tab : -1, !adm);
		int ax = lx(), ay = ui.ay();
		PassportUi.big(g, font, "ПАСПОРТНЫЙ СТОЛ", ax, ay + 6, 2f, PassportUi.INK);
		if (!adm) {
			if (!loaded()) g.text(font, "Загрузка...", ax, ay + 40, PassportUi.INK2, false);
			else {
				g.text(font, "Только администратор сервера может:", ax, ay + 40, PassportUi.WARN, false);
				g.text(font, "- вписывать игроку страну и герб,", ax, ay + 54, PassportUi.INK, false);
				g.text(font, "- выдавать нарушения,", ax, ay + 66, PassportUi.INK, false);
				g.text(font, "- отменять нарушения.", ax, ay + 78, PassportUi.INK, false);
				g.text(font, "Свой паспорт: клавиша I с паспортом в руке.", ax, ay + 98, PassportUi.INK2, false);
			}
			super.extractRenderState(g, mx, my, pt);
			return;
		}
		int y0 = y0();
		int pw = ui.len(PassportUi.PHOTO_W), ph = ui.len(PassportUi.PHOTO_H);
		int pcx = ui.x(PassportUi.PHOTO_X) + pw / 2, pcy = ui.y(PassportUi.PHOTO_Y) + ph / 2;
		int big = Math.min(pw, ph) - 16;
		label(g, "Игрок (ник вручную или «Онлайн»)", y0);
		if (tab == 0) {
			label(g, "Название страны", y0 + grp());
			label(g, "Герб", y0 + grp() * 2);
			PassportUi.ctext(g, font, Passport.SEAL_NAMES[Math.floorMod(seal, Passport.SEALS.length)], lx() + fw() / 2, y0 + grp() * 2 + 16, PassportUi.INK);
			PassportUi.seal(g, seal, pcx - big / 2, pcy - big / 2, big);
			String st = target.isEmpty() ? "Введите ник или нажмите «Онлайн»" : !targetMatches() ? "Нажмите «Найти», чтобы загрузить паспорт игрока" : !hasProfile() ? "У игрока нет паспорта" : "Паспорт найден: регистрация " + PassportClient.date(targetProfile());
			g.text(font, PassportUi.clip(font, st, fw()), lx(), y0 + grp() * 3 + 28, !hasProfile() && targetMatches() ? PassportUi.WARN : PassportUi.INK2, false);
		} else if (tab == 1) {
			label(g, "Текст нарушения (вручную)", y0 + grp());
			label(g, "Печать (не зависит от герба в паспорте)", y0 + grp() * 2);
			PassportUi.ctext(g, font, Passport.SEAL_NAMES[Math.floorMod(vSeal, Passport.SEALS.length)], lx() + fw() / 2, y0 + grp() * 2 + 16, PassportUi.INK);
			PassportUi.ctext(g, font, "так будет выглядеть", pcx, ui.y(PassportUi.PHOTO_Y) + 6, PassportUi.INK2);
			PassportUi.stamp(g, vSeal, pcx, pcy, big, 20260);
		} else {
			List<String[]> v = targetViol();
			int rows = rows();
			if (target.isEmpty()) g.text(font, "Введите ник или нажмите «Онлайн»", lx(), y0 + 48, PassportUi.INK2, false);
			else if (!targetMatches()) g.text(font, "Нажмите «Найти»", lx(), y0 + 48, PassportUi.INK2, false);
			else if (v.isEmpty()) g.text(font, "Нарушений нет", lx(), y0 + 48, PassportUi.INK2, false);
			for (int r = 0; r < rows; r++) {
				int idx = page * rows + r;
				if (idx >= v.size()) break;
				String[] row = v.get(idx);
				g.text(font, PassportUi.clip(font, (row.length > 1 ? row[1] + "  " : "") + row[0], fw() - 28), lx(), y0 + 49 + r * 20, PassportUi.INK, false);
			}
			g.text(font, "Любое нарушение удаляется кнопкой X", lx() + 56, ui.ay() + ui.ah() - 17, PassportUi.INK2, false);
			PassportUi.ctext(g, font, "Нарушений:", pcx, pcy - 10, PassportUi.INK);
			PassportUi.ctext(g, font, targetMatches() ? String.valueOf(v.size()) : "-", pcx, pcy + 4, PassportUi.INK);
		}
		super.extractRenderState(g, mx, my, pt);
	}
}
