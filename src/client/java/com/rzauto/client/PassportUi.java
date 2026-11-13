package com.rzauto.client;

import com.rzauto.item.Passport;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.resources.Identifier;

/**
 * Общая разметка паспорта и паспортного стола: задник-картинка 1024x572 (из pasport.zip), язычки и области в координатах картинки,
 * масштаб s подбирается под окно. Все положения (язычки, панель под фото, рабочая область) измерены по самим файлам, поэтому кнопки совпадают с картинкой.
 */
final class PassportUi {
	static final int IW = 1024, IH = 572;
	/** Номера страниц: цвет активного язычка; BEIGE = ни один не активен (документ не подписан, стол не для админа). */
	static final int GREEN = 0, RED = 1, BLUE = 2, BEIGE = 3;
	private static final Identifier[] BG = {
		Identifier.fromNamespaceAndPath("rz_auto", "textures/gui/passport_green.png"),
		Identifier.fromNamespaceAndPath("rz_auto", "textures/gui/passport_red.png"),
		Identifier.fromNamespaceAndPath("rz_auto", "textures/gui/passport_blue.png"),
		Identifier.fromNamespaceAndPath("rz_auto", "textures/gui/passport_beige.png") };
	/** Язычки (x, y, w, h) в пикселях картинки: зелёный, красный, синий. */
	private static final int[][] TABS = { { 296, 12, 137, 51 }, { 440, 12, 212, 51 }, { 658, 12, 178, 51 } };
	/** У бежевой страницы язычки стоят чуть иначе. */
	private static final int[][] TABS_BEIGE = { { 260, 12, 140, 51 }, { 407, 12, 245, 51 }, { 659, 12, 184, 51 } };
	/** Тёмная панель слева (под фото/герб): x, y, w, h в пикселях картинки. */
	static final int PHOTO_X = 78, PHOTO_Y = 109, PHOTO_W = 195, PHOTO_H = 366;
	/** Рабочая область справа от панели, внутри рамки, не заходит на стопку листов справа. */
	static final int AREA_X = 300, AREA_Y = 84, AREA_W = 615, AREA_H = 440;

	static final int INK = 0xFF1B1408, INK2 = 0xFF4A3A1E, WARN = 0xFF7A1A12;

	float s = 1f;
	int px, py, pw, ph;

	void layout(int sw, int sh) {
		s = Math.min(1.5f, Math.min((sw - 12) / (float) IW, (sh - 12) / (float) IH));
		pw = Math.round(IW * s); ph = Math.round(IH * s);
		px = (sw - pw) / 2; py = (sh - ph) / 2;
	}

	int x(int ix) { return px + Math.round(ix * s); }
	int y(int iy) { return py + Math.round(iy * s); }
	int len(int l) { return Math.round(l * s); }

	/** Рабочая область (GUI-пиксели) с небольшим отступом. */
	int ax() { return x(AREA_X) + 4; }
	int ay() { return y(AREA_Y) + 2; }
	int aw() { return len(AREA_W) - 8; }
	int ah() { return len(AREA_H) - 4; }

	void background(GuiGraphicsExtractor g, int page) {
		g.blit(RenderPipelines.GUI_TEXTURED, BG[Math.max(0, Math.min(3, page))], px, py, 0f, 0f, pw, ph, IW, IH, IW, IH);
	}

	private int[] tabRect(int i, boolean beige) {
		int[] t = (beige ? TABS_BEIGE : TABS)[i];
		return new int[] { x(t[0]), y(t[1]), len(t[2]), len(t[3]) };
	}

	boolean tabHit(double mx, double my, int i, boolean beige) {
		int[] r = tabRect(i, beige);
		return mx >= r[0] && mx < r[0] + r[2] && my >= r[1] && my < r[1] + r[3];
	}

	/** Подписи на язычках: без тени и без «двойной печати» (тень делала мелкий текст нечитаемым). Активный темнее. */
	void tabLabels(GuiGraphicsExtractor g, Font font, String[] names, int active, boolean beige) {
		for (int i = 0; i < names.length && i < 3; i++) {
			int[] r = tabRect(i, beige);
			String t = clip(font, names[i], r[2] - 6);
			int ty = r[1] + (r[3] - 8) / 2;
			ctext(g, font, t, r[0] + r[2] / 2, ty, i == active ? 0xFF000000 : 0xFF2E2110);
		}
	}

	/** Текст по центру x без тени. */
	static void ctext(GuiGraphicsExtractor g, Font font, String t, int cx, int y, int color) {
		g.text(font, t, cx - font.width(t) / 2, y, color, false);
	}

	/** Крупный текст (масштаб k) в точке x, y. */
	static void big(GuiGraphicsExtractor g, Font font, String text, int x, int y, float k, int color) {
		var m = g.pose();
		m.pushMatrix();
		m.translate(x, y);
		m.scale(k, k);
		g.text(font, text, 0, 0, color, false);
		m.popMatrix();
	}

	static Identifier sealTex(int idx) { return Identifier.fromNamespaceAndPath("rz_auto", "textures/gui/" + Passport.sealPath(idx) + ".png"); }

	/** Герб ровно, без наклона (x, y = левый верхний угол). */
	static void seal(GuiGraphicsExtractor g, int idx, int x, int y, int size) {
		g.blit(RenderPipelines.GUI_TEXTURED, sealTex(idx), x, y, 0f, 0f, size, size, 256, 256, 256, 256, 0xBEA0A4B4);
	}

	/**
	 * Печать нарушения: как будто поставили рукой впопыхах. По seed (он один и тот же при каждом показе) считаются небольшой сдвиг вверх-вниз и вбок,
	 * наклон до ±9 градусов, лёгкая разница размера и прозрачности чернил. cx, cy = центр печати.
	 */
	static void stamp(GuiGraphicsExtractor g, int idx, int cx, int cy, int size, int seed) {
		java.util.Random r = new java.util.Random(seed * 0x9E3779B97F4A7C15L + 12345L);
		float dx = (r.nextFloat() * 2 - 1) * 0.07f * size;
		float dy = (r.nextFloat() * 2 - 1) * 0.09f * size;
		float rot = (float) Math.toRadians((r.nextFloat() * 2 - 1) * 9.0);
		float sc = 0.95f + r.nextFloat() * 0.09f;
		int a = 140 + r.nextInt(40);
		var m = g.pose();
		m.pushMatrix();
		m.translate(cx + dx, cy + dy);
		m.rotate(rot);
		m.scale(sc, sc);
		g.blit(RenderPipelines.GUI_TEXTURED, sealTex(idx), -size / 2, -size / 2, 0f, 0f, size, size, 256, 256, 256, 256, (a << 24) | 0xA0A4B4);
		m.popMatrix();
	}

	/** Перенос текста по словам без тени (тень делает мелкий текст на цветной странице нечитаемым). Возвращает число строк. */
	static int wrap(GuiGraphicsExtractor g, Font font, String text, int x, int y, int w, int maxLines, int color) {
		java.util.List<net.minecraft.util.FormattedCharSequence> lines = font.split(net.minecraft.network.chat.Component.literal(text), w);
		int n = Math.min(lines.size(), maxLines);
		for (int i = 0; i < n; i++) g.text(font, lines.get(i), x, y + i * 10, color, false);
		return n;
	}

	static String clip(Font font, String s, int w) {
		if (font.width(s) <= w) return s;
		while (s.length() > 3 && font.width(s + "...") > w) s = s.substring(0, s.length() - 1);
		return s + "...";
	}
}
