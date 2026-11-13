package com.rzauto.client;

import com.rzauto.VehicleRegistry;
import com.rzauto.entity.VehicleEntity;
import com.rzauto.logic.Fuel;
import com.rzauto.logic.VehicleCatalog;
import com.rzauto.logic.VehicleSpec;
import com.rzauto.net.VehicleActionPayload;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.network.chat.Component;
import org.joml.Quaternionf;
import org.joml.Vector3f;
import java.util.ArrayList;
import java.util.List;

/**
 * Меню машины (клавиша I): весь экран в зелёном стекле. Слева машина в 3D (наискосок, колесо довёрнуто) и её характеристики,
 * справа минималистичные кнопки с иконками. Нажатия обрабатывают обычные невидимые Button, их вид перекрывается своей отрисовкой.
 */
final class VehicleMenuScreen extends net.minecraft.client.gui.screens.Screen {
	private final VehicleEntity car;
	private int sig = -1;

	private static final int GLASS_TOP = 0xCC06291B, GLASS_BOT = 0xD9031A11, PANEL = 0x5522C77A, PANEL_EDGE = 0xAA4DE39A, SHEEN = 0x1CFFFFFF;
	private static final int ROW = 0xE60B3A27, ROW_HOVER = 0xF0156B45, ROW_OFF = 0xCC0A2519, ACCENT = 0xFF3DDC84, TXT = 0xFFE9FFF3, TXT_DIM = 0xFF8FC7A8, WARN = 0xFFFF6B5E;

	/** Один ряд правой колонки: иконка, подпись, состояние справа. */
	private record Row(int icon, String label, String state, boolean enabled, boolean accent, int x, int y, int w, int h) {}
	private final List<Row> rows = new ArrayList<>();
	private int rx, ry, rw, rh, lx, ly, lw, lh;

	VehicleMenuScreen(VehicleEntity car) {
		super(Component.literal("Автомобиль"));
		this.car = car;
	}

	private int signature() {
		return (CamMode.gta ? 1 << 24 : 0) | (car.isEngineOn() ? 1 : 0) | (car.isBroken() ? 2 : 0) | (car.lockState().ordinal() << 2) | (car.lightsOn() ? 16 : 0)
			| (car.roofOn() ? 1 << 25 : 0) | (car.sirenOn() ? 32 : 0) | (car.gearsOn() ? 64 : 0) | (car.radioValue() << 26) | (RadioClient.enabled ? 1 << 31 : 0) | (Math.round(car.sensValue() * 10) << 8) | (Math.round(car.hpValue()) << 16);
	}

	private void act(int action) { if (action == -3) { onClose(); return; } if (action == -2) return; if (action == -1) { CamMode.toggle(); rebuildWidgets(); return; }
		if (action == -8) { RadioClient.addVolume(-0.1f); rebuildWidgets(); return; }
		if (action == -9) { RadioClient.addVolume(0.1f); rebuildWidgets(); return; }
		if (action == -4) { RadioClient.setEnabled(!RadioClient.enabled); rebuildWidgets(); return; }
		if (action == -5) { RadioClient.toggle(net.minecraft.client.Minecraft.getInstance(), car); return; }
		if (action == -6) { RadioClient.step(net.minecraft.client.Minecraft.getInstance(), car, -1); return; }
		if (action == -7) { RadioClient.step(net.minecraft.client.Minecraft.getInstance(), car, 1); return; } ClientPlayNetworking.send(new VehicleActionPayload(car.getId(), action)); }

	/** Невидимая кнопка + запись для отрисовки. */
	private void row(int icon, String label, String state, boolean enabled, boolean accent, int action, int x, int y, int w, int h) {
		Button b = Button.builder(Component.empty(), bb -> act(action)).bounds(x, y, w, h).build();
		b.active = enabled;
		addRenderableWidget(b);
		rows.add(new Row(icon, label, state, enabled, accent, x, y, w, h));
	}

	@Override
	protected void init() {
		sig = signature();
		rows.clear();
		VehicleSpec sp = VehicleRegistry.specOf(car.getType());
		boolean jeepYj = sp != null && sp.bedrockId().startsWith("jeep:yj");
		boolean siren = sp != null && sp.hasSiren();
		int m = Math.max(10, Math.min(24, width / 40));
		lx = m; ly = m; lh = height - 2 * m;
		rw = Math.max(170, Math.min(260, width * 36 / 100)); rx = width - m - rw; ry = m; rh = height - 2 * m;
		lw = rx - m - lx;

		boolean rider = net.minecraft.client.Minecraft.getInstance().player != null && net.minecraft.client.Minecraft.getInstance().player.getVehicle() == car;
		int n = 6 + (siren ? 1 : 0) + (jeepYj ? 1 : 0) + 1 + 2 + (rider ? 2 : 0) + 1;   // основные + руль + приём/громкость + радио в машине + починить
		int pad = 10, top = ry + 28;
		int avail = rh - 28 - pad - 4;
		int gap = 3, h = Math.max(12, Math.min(26, (avail - gap * (n - 1)) / n));
		int x = rx + pad, w = rw - 2 * pad, y = top;
		boolean canRepair = car.isBroken() || car.hpValue() < (sp == null ? 20 : sp.health()) - 0.01f;

		row(0, "Двигатель", car.isEngineOn() ? "ВКЛ" : "ВЫКЛ", true, car.isEngineOn(), VehicleEntity.ACT_ENGINE, x, y, w, h); y += h + gap;
		row(1, "Замок", car.isLocked() ? "ЗАКРЫТО" : "ОТКРЫТО", true, !car.isLocked(), VehicleEntity.ACT_LOCK, x, y, w, h); y += h + gap;
		row(2, "Фары", car.lightsOn() ? "ВКЛ" : "ВЫКЛ", true, car.lightsOn(), VehicleEntity.ACT_LIGHTS, x, y, w, h); y += h + gap;
		if (siren) { row(3, "Сирена", car.sirenOn() ? "ВКЛ" : "ВЫКЛ", true, car.sirenOn(), VehicleEntity.ACT_SIREN, x, y, w, h); y += h + gap; }
		if (jeepYj) { row(4, "Крыша / тент", car.roofOn() ? "ЕСТЬ" : "СНЯТА", true, car.roofOn(), VehicleEntity.ACT_ROOF, x, y, w, h); y += h + gap; }
		row(5, "Пересесть", "", true, false, VehicleEntity.ACT_SEAT, x, y, w, h); y += h + gap;
		row(6, "Передачи", car.gearsOn() ? "ВКЛ" : "ВЫКЛ", true, car.gearsOn(), VehicleEntity.ACT_GEARS, x, y, w, h); y += h + gap;
		row(7, "Камера", CamMode.gta ? "GTA" : "СВОБОДНАЯ", true, false, -1, x, y, w, h); y += h + gap;
		// руль: [-]  Чувствительность  [+]
		int bw = Math.max(22, h + 4);
		row(8, "Руль", String.format(java.util.Locale.ROOT, "%.1f", car.sensValue()), true, false, VehicleEntity.ACT_SENS_DOWN, x, y, bw, h);
		rows.set(rows.size() - 1, new Row(10, "", "", true, false, x, y, bw, h));
		row(8, String.format(java.util.Locale.ROOT, "Руль GTA 5: %.1f", car.sensValue()), "", false, false, -2, x + bw + 3, y, w - 2 * bw - 6, h);
		row(11, "", "", true, false, VehicleEntity.ACT_SENS_UP, x + w - bw, y, bw, h); y += h + gap;
		row(13, "Приём радио", RadioClient.enabled ? "ВКЛ" : "ВЫКЛ", true, RadioClient.enabled, -4, x, y, w, h); y += h + gap;
		row(13, "", "", true, false, -8, x, y, bw, h);
		rows.set(rows.size() - 1, new Row(10, "", "", true, false, x, y, bw, h));
		row(13, "Громкость радио: " + Math.round(RadioClient.volume * 100) + "%", "", false, false, -2, x + bw + 3, y, w - 2 * bw - 6, h);
		row(11, "", "", true, false, -9, x + w - bw, y, bw, h); y += h + gap;
		if (rider) {
			int rv = car.radioValue();
			row(13, "Радио", rv > 0 ? "ИГРАЕТ" : "ВЫКЛ", true, rv > 0, -5, x, y, w, h); y += h + gap;
			row(10, "", "", true, false, -6, x, y, bw, h);
			row(13, RadioClient.stationName(rv > 0 ? rv - 1 : RadioClient.lastIdx), "", false, false, -2, x + bw + 3, y, w - 2 * bw - 6, h);
			row(11, "", "", true, false, -7, x + w - bw, y, bw, h); y += h + gap;
		}
		row(9, "Починить", canRepair ? "нужна шестерёнка" : "исправна", canRepair, false, VehicleEntity.ACT_REPAIR, x, y, w, h); y += h + gap;
	}

	@Override
	public void tick() {
		super.tick();
		if (car.isRemoved()) { onClose(); return; }
		if (signature() != sig) rebuildWidgets();
	}

	@Override
	public boolean keyPressed(KeyEvent e) {
		if (RzAutoClient.MENU.matches(e)) { onClose(); return true; }
		return super.keyPressed(e);
	}

	@Override
	public boolean isPauseScreen() { return false; }

	// ---- иконки 9x9 ----
	private static final String[][] ICONS = {
		{ "....#....", "....#....", ".##.#.##.", ".#..#..#.", "#...#...#", "#.......#", ".#.....#.", "..#####..", "........." },   // 0 двигатель (питание)
		{ "..#####..", ".#.....#.", ".#.....#.", "#########", "#########", "####.####", "####.####", "#########", "........." },   // 1 замок
		{ "..#####..", ".#######.", ".#######.", ".#######.", "..#####..", "..#####..", "...###...", "...###...", "....#...." },   // 2 фары
		{ "....#....", ".#..#..#.", "..#####..", "..#####..", ".#######.", ".#######.", "#########", "#########", "........." },   // 3 сирена
		{ ".........", "..#####..", ".#.....#.", "#########", "#.......#", "#########", ".##...##.", ".##...##.", "........." },   // 4 крыша
		{ ".#.......", ".#.......", ".#.......", ".#.......", ".########", ".########", ".##....##", ".##....##", "........." },   // 5 место
		{ "...#.#...", "..#####..", ".##...##.", "###...###", ".##...##.", "###...###", ".##...##.", "..#####..", "...#.#..." },   // 6 передачи
		{ ".........", ".#######.", "#.......#", "#..###..#", "#..#.#..#", "#..###..#", "#.......#", ".#######.", "........." },   // 7 камера
		{ "..#####..", ".#.....#.", "#..#.#..#", "#...#...#", "#.#####.#", "#...#...#", ".#..#..#.", "..#####..", "........." },   // 8 руль
		{ "......##.", ".....###.", "....###..", "...###...", "..###....", ".###.....", "###......", "##.......", "........." },   // 9 ремонт
		{ ".........", ".........", ".........", ".#######.", ".#######.", ".........", ".........", ".........", "........." },   // 10 минус
		{ "....#....", "....#....", "....#....", ".#######.", ".#######.", "....#....", "....#....", "....#....", "........." },   // 11 плюс
		{ "#.......#", ".#.....#.", "..#...#..", "...#.#...", "....#....", "...#.#...", "..#...#..", ".#.....#.", "#.......#" },   // 12 закрыть
		{ "......#..", ".....#...", "#######..", "#.....#..", "#.###.#..", "#.###.#..", "#.....#..", "#######..", "........." },   // 13 радио
	};

	private void icon(GuiGraphicsExtractor g, int id, int x, int y, int px, int color) {
		String[] b = ICONS[id];
		for (int j = 0; j < 9; j++) for (int i = 0; i < 9; i++) if (b[j].charAt(i) == '#') g.fill(x + i * px, y + j * px, x + i * px + px, y + j * px + px, color);
	}

	private void glass(GuiGraphicsExtractor g, int x, int y, int w, int h) {
		g.fill(x, y, x + w, y + h, PANEL);
		g.fillGradient(x, y, x + w, y + Math.max(8, h / 6), SHEEN, 0x00FFFFFF);   // блик стекла
		g.outline(x, y, w, h, PANEL_EDGE);
		g.fill(x + 1, y, x + w - 1, y + 1, 0xFFB5FFD6);
	}

	private void bar(GuiGraphicsExtractor g, int x, int y, int w, double f, int color) {
		g.fill(x, y, x + w, y + 5, 0xAA06150E);
		g.fill(x, y, x + (int) (w * Math.max(0, Math.min(1, f))), y + 5, color);
		g.outline(x, y, w, 5, 0x884DE39A);
	}

	private void drawCar(GuiGraphicsExtractor g, int x0, int y0, int x1, int y1, VehicleSpec sp) {
		Minecraft mc = Minecraft.getInstance();
		var st = mc.getEntityRenderDispatcher().extractEntity(car, 1.0F);
		if (!(st instanceof VehicleRenderer.State s)) return;
		s.hide = false; s.yaw = 215f; s.steer = 75f; s.dist = 0f; s.pitch = 0f; s.roll = 0f; s.dy = 0f;
		s.marks = null; s.wdy = null; s.siren = false; s.lights = car.lightsOn(); s.pop = car.lightsOn() ? 1f : 0f; s.lightCoords = 0xF000F0;
		double[] dm = sp == null ? null : VehicleCatalog.dims(sp.bedrockId());
		double len = dm == null ? 4.5 : dm[1], wid = dm == null ? 2.0 : dm[0];
		float scale = (float) ((x1 - x0) * 0.78 / (0.72 * (len + wid)));
		g.entity(st, scale, new Vector3f(0f, 0.7f, 0f), new Quaternionf().rotateZ((float) Math.PI), new Quaternionf(), x0, y0, x1, y1);
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mx, int my, float pt) {
		g.fillGradient(0, 0, width, height, GLASS_TOP, GLASS_BOT);
		glass(g, lx, ly, lw, lh);
		glass(g, rx, ry, rw, rh);
		VehicleSpec sp = VehicleRegistry.specOf(car.getType());

		// левая панель: заголовок, машина, характеристики
		g.text(font, car.getName().getString(), lx + 12, ly + 10, TXT, true);
		String owner = car.ownerNick();
		g.text(font, owner == null || owner.isEmpty() ? "Меню автомобиля" : "Владелец: " + owner, lx + 12, ly + 22, TXT_DIM, false);
		int statH = 78;
		int cy0 = ly + 36, cy1 = ly + lh - statH - 8;
		if (cy1 - cy0 > 40) drawCar(g, lx + 8, cy0, lx + lw - 8, cy1, sp);

		int sx = lx + 14, sy = ly + lh - statH, colW = (lw - 28) / 2;
		double kmh = sp == null ? 0 : sp.topSpeed() * VehicleEntity.SPEED_SCALE * 20 * 3.6;
		double fuel = car.fuelValue(), tank = sp == null ? Fuel.TANK_LITERS : Math.max(sp.maxFuel(), 0.01);
		double hpf = sp == null ? 1 : car.hpValue() / Math.max(sp.health(), 1);
		g.text(font, "Макс. скорость", sx, sy, TXT_DIM, false);
		g.text(font, String.format(java.util.Locale.ROOT, "%.0f км/ч", kmh), sx, sy + 11, TXT, false);
		g.text(font, "Пробег", sx + colW + 8, sy, TXT_DIM, false);
		g.text(font, String.format(java.util.Locale.ROOT, "%.1f км", car.odoBlocks() / 1000.0), sx + colW + 8, sy + 11, TXT, false);
		g.text(font, "Топливо (лава)", sx, sy + 28, TXT_DIM, false);
		g.text(font, String.format(java.util.Locale.ROOT, "%.1f / %.0f л  (~%d бл.)", fuel, tank, Math.round(fuel / Fuel.LITERS_PER_BLOCK)), sx + 0, sy + 39, fuel < tank * 0.1 ? WARN : TXT, false);
		bar(g, sx, sy + 51, lw - 28, fuel / tank, fuel < tank * 0.1 ? WARN : ACCENT);
		g.text(font, "Прочность", sx, sy + 58, TXT_DIM, false);
		bar(g, sx + 62, sy + 60, lw - 28 - 62, hpf, hpf > 0.5 ? ACCENT : hpf > 0.25 ? 0xFFFFC233 : WARN);

		// правая панель: кнопки (невидимые Button принимают нажатия, вид рисуем здесь поверх)
		g.text(font, "УПРАВЛЕНИЕ", rx + 12, ry + 10, TXT_DIM, false);
		super.extractRenderState(g, mx, my, pt);
		for (Row r : rows) {
			boolean hov = mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h;
			g.fill(r.x, r.y, r.x + r.w, r.y + r.h, !r.enabled ? ROW_OFF : hov ? ROW_HOVER : ROW);
			g.outline(r.x, r.y, r.w, r.h, r.accent ? ACCENT : hov ? 0xFF4DE39A : 0x66348F63);
			if (r.accent) g.fill(r.x, r.y + 2, r.x + 2, r.y + r.h - 2, ACCENT);
			int px = r.h >= 22 ? 2 : 1, isz = 9 * px;
			int ix = r.label.isEmpty() ? r.x + (r.w - isz) / 2 : r.x + 7, iy = r.y + (r.h - isz) / 2;
			icon(g, r.icon, ix, iy, px, !r.enabled ? 0xFF3F6B55 : r.accent ? ACCENT : TXT);
			int ty = r.y + (r.h - 8) / 2;
			if (!r.label.isEmpty()) g.text(font, r.label, ix + isz + 7, ty, !r.enabled ? 0xFF5B8A74 : TXT, false);
			if (!r.state.isEmpty() && (r.label.isEmpty() || ix + isz + 7 + font.width(r.label) + 8 < r.x + r.w - 7 - font.width(r.state))) g.text(font, r.state, r.x + r.w - 7 - font.width(r.state), ty, r.accent ? ACCENT : TXT_DIM, false);
		}
	}
}
