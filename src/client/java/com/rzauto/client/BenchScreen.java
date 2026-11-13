package com.rzauto.client;

import com.rzauto.bench.BenchRecipes;
import com.rzauto.net.BenchCraftPayload;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.world.item.ItemStack;
import java.util.*;

/** Верстак в стиле ванильного: серая панель, слоты 3x3 с рецептом, слот результата, список машин по маркам слева. */
final class BenchScreen extends net.minecraft.client.gui.screens.Screen {
	private static final int PW = 340, PH = 214, ROWS = 7, RH = 22;
	private final BlockPos pos;
	private final List<String> groups = new ArrayList<>();
	private int group, page, sel;
	private boolean onlyCraftable;
	private boolean desk;
	private int deskPage, carPage;
	private static final String[] DESK = { "Паспорт", "Машины", "Нарушения", "Территории", "Информация об игроке" };
	private static final int CARS = 6;
	private List<BenchRecipes.Recipe> shown = new ArrayList<>();

	BenchScreen(BlockPos pos) {
		super(Component.literal("Верстак"));
		this.pos = pos;
		groups.add("");
		TreeSet<String> g = new TreeSet<>();
		for (BenchRecipes.Recipe r : BenchRecipes.all()) if (!r.group().isEmpty()) g.add(r.group());
		groups.addAll(g);
	}

	private static ItemStack stack(String id, int n) {
		var item = BuiltInRegistries.ITEM.getValue(Identifier.parse(id));
		return item == null || id.isEmpty() ? ItemStack.EMPTY : new ItemStack(item, n);
	}

	private static String itemName(String id) {
		ItemStack st = stack(id, 1);
		return st.isEmpty() ? id : st.getHoverName().getString();
	}

	private Map<String, Integer> inventory() {
		Map<String, Integer> have = new HashMap<>();
		if (minecraft == null || minecraft.player == null) return have;
		var inv = minecraft.player.getInventory();
		for (int i = 0; i < inv.getContainerSize(); i++) {
			ItemStack st = inv.getItem(i);
			if (!st.isEmpty()) have.merge(BuiltInRegistries.ITEM.getKey(st.getItem()).toString(), st.getCount(), Integer::sum);
		}
		return have;
	}

	private static boolean can(BenchRecipes.Recipe r, Map<String, Integer> have) {
		for (var n : r.need().entrySet()) if (have.getOrDefault(n.getKey(), 0) < n.getValue()) return false;
		return true;
	}

	private void refilter() {
		Map<String, Integer> have = inventory();
		String key = groups.get(group);
		shown = new ArrayList<>();
		for (BenchRecipes.Recipe r : BenchRecipes.all()) {
			if (!key.isEmpty() && !r.group().equals(key)) continue;
			if (onlyCraftable && !can(r, have)) continue;
			shown.add(r);
		}
		page = Math.max(0, Math.min(page, Math.max(0, (shown.size() - 1) / ROWS)));
		sel = Math.max(0, Math.min(sel, Math.max(0, shown.size() - 1)));
	}

	private int x0() { return (width - PW) / 2; }
	private int y0() { return (height - PH) / 2; }

	@Override
	protected void init() {
		refilter();
		int x0 = x0(), y0 = y0();
		addRenderableWidget(Button.builder(Component.literal(desk ? "Верстак" : "Паспортный стол"), b -> { desk = !desk; rebuildWidgets(); }).bounds(x0 + PW - 118, y0 + 3, 110, 14).build());
		if (desk) { initDesk(x0, y0); return; }
		Map<String, Integer> have = inventory();
		addRenderableWidget(Button.builder(Component.literal("<"), b -> { group = (group + groups.size() - 1) % groups.size(); page = 0; sel = 0; rebuildWidgets(); }).bounds(x0 + 8, y0 + 18, 20, 18).build());
		addRenderableWidget(Button.builder(Component.literal(">"), b -> { group = (group + 1) % groups.size(); page = 0; sel = 0; rebuildWidgets(); }).bounds(x0 + 130, y0 + 18, 20, 18).build());
		for (int i = 0; i < ROWS; i++) {
			int idx = page * ROWS + i;
			if (idx >= shown.size()) break;
			final int fi = idx;
			addRenderableWidget(Button.builder(Component.literal(clip(itemName(shown.get(idx).result()), 112)), b -> { sel = fi; rebuildWidgets(); }).bounds(x0 + 30, y0 + 40 + i * RH, 120, 20).build());
		}
		int by = y0 + 40 + ROWS * RH + 2;
		addRenderableWidget(Button.builder(Component.literal("Назад"), b -> { page--; rebuildWidgets(); }).bounds(x0 + 8, by, 70, 18).build()).active = page > 0;
		addRenderableWidget(Button.builder(Component.literal("Далее"), b -> { page++; rebuildWidgets(); }).bounds(x0 + 80, by, 70, 18).build()).active = (page + 1) * ROWS < shown.size();
		addRenderableWidget(Button.builder(Component.literal(onlyCraftable ? "Только доступные: ДА" : "Только доступные: НЕТ"), b -> { onlyCraftable = !onlyCraftable; page = 0; sel = 0; rebuildWidgets(); }).bounds(x0 + 166, y0 + 18, 166, 18).build());
		if (!shown.isEmpty()) {
			BenchRecipes.Recipe r = shown.get(sel);
			Button cb = Button.builder(Component.literal("Создать"), b -> ClientPlayNetworking.send(new BenchCraftPayload(pos.asLong(), r.id()))).bounds(x0 + 166 + 70, y0 + 40 + 3 * 18 + 70, 96, 20).build();
			cb.active = can(r, have);
			addRenderableWidget(cb);
		}
		addRenderableWidget(Button.builder(Component.literal("Закрыть"), b -> onClose()).bounds(x0 + 166, y0 + 40 + 3 * 18 + 70, 66, 20).build());
	}

	private net.minecraft.world.item.ItemStack myPassport() {
		if (minecraft == null || minecraft.player == null) return ItemStack.EMPTY;
		var inv = minecraft.player.getInventory();
		String me = minecraft.player.getUUID().toString();
		for (int i = 0; i < inv.getContainerSize(); i++) {
			ItemStack st = inv.getItem(i);
			if (com.rzauto.item.Passport.signed(st) && com.rzauto.item.Passport.ownerUuid(st).equals(me)) return st;
		}
		return ItemStack.EMPTY;
	}

	/** Машины игрока, загруженные на клиенте (в пределах 128 блоков). */
	private List<com.rzauto.entity.VehicleEntity> myCars() {
		List<com.rzauto.entity.VehicleEntity> out = new ArrayList<>();
		if (minecraft == null || minecraft.player == null || minecraft.level == null) return out;
		var pl = minecraft.player;
		for (var v : minecraft.level.getEntitiesOfClass(com.rzauto.entity.VehicleEntity.class, pl.getBoundingBox().inflate(128))) if (v.isOwnedBy(pl.getUUID())) out.add(v);
		out.sort(Comparator.comparingDouble(pl::distanceToSqr));
		return out;
	}

	private void initDesk(int x0, int y0) {
		for (int i = 0; i < DESK.length; i++) {
			final int fi = i;
			Button b = Button.builder(Component.literal(DESK[i]), bb -> { deskPage = fi; rebuildWidgets(); }).bounds(x0 + 8, y0 + 24 + i * 22, 112, 20).build();
			b.active = deskPage != i;
			addRenderableWidget(b);
		}
		if (deskPage == 0 && !myPassport().isEmpty()) {
			int cur = com.rzauto.item.Passport.sealIndex(myPassport());
			int n = com.rzauto.item.Passport.SEALS.length;
			addRenderableWidget(Button.builder(Component.literal("<"), b -> { ClientPlayNetworking.send(new com.rzauto.net.PassportSealPayload(pos.asLong(), (cur + n - 1) % n)); onClose(); }).bounds(x0 + 136, y0 + 120, 24, 18).build());
			addRenderableWidget(Button.builder(Component.literal(">"), b -> { ClientPlayNetworking.send(new com.rzauto.net.PassportSealPayload(pos.asLong(), (cur + 1) % n)); onClose(); }).bounds(x0 + 290, y0 + 120, 24, 18).build());
		}
		if (deskPage == 1) {
			int total = myCars().size();
			carPage = Math.max(0, Math.min(carPage, Math.max(0, (total - 1) / CARS)));
			addRenderableWidget(Button.builder(Component.literal("Назад"), b -> { carPage--; rebuildWidgets(); }).bounds(x0 + 136, y0 + PH - 50, 70, 18).build()).active = carPage > 0;
			addRenderableWidget(Button.builder(Component.literal("Далее"), b -> { carPage++; rebuildWidgets(); }).bounds(x0 + 210, y0 + PH - 50, 70, 18).build()).active = (carPage + 1) * CARS < total;
		}
		addRenderableWidget(Button.builder(Component.literal("Закрыть"), b -> onClose()).bounds(x0 + 8, y0 + PH - 50, 112, 20).build());
	}

	private void extractDesk(GuiGraphicsExtractor g, int x0, int y0) {
		int tx = x0 + 136, ty = y0 + 24, c = 0xFF404040;
		g.text(font, "Паспортный стол  -  " + DESK[deskPage], x0 + 8, y0 + 6, c, false);
		var pl = minecraft.player;
		ItemStack pass = myPassport();
		switch (deskPage) {
			case 0 -> {
				if (pass.isEmpty()) { g.text(font, "У вас нет подписанного паспорта.", tx, ty, 0xFFA02020, false); g.text(font, "Сделайте паспорт на верстаке и подпишите", tx, ty + 12, c, false); g.text(font, "его (Shift + ПКМ).", tx, ty + 24, c, false); break; }
				g.text(font, "Владелец: " + com.rzauto.item.Passport.ownerName(pass), tx, ty, c, false);
				g.text(font, "Дата подписи: " + com.rzauto.item.Passport.date(pass), tx, ty + 12, c, false);
				int idx = com.rzauto.item.Passport.sealIndex(pass);
				g.text(font, "Печать: " + com.rzauto.item.Passport.SEAL_NAMES[idx], tx, ty + 30, c, false);
				g.text(font, "Выберите печать стрелками:", tx, ty + 48, c, false);
				g.text(font, com.rzauto.item.Passport.SEAL_NAMES[idx], tx + 36, y0 + 125, c, false);
			}
			case 1 -> {
				List<com.rzauto.entity.VehicleEntity> cars = myCars();
				g.text(font, "Ваши машины рядом (до 128 блоков): " + cars.size(), tx, ty, c, false);
				g.text(font, (carPage + 1) + "/" + Math.max(1, (cars.size() + CARS - 1) / CARS), tx + 150, ty + 12, c, false);
				if (cars.isEmpty()) g.text(font, "Машин нет.", tx, ty + 14, c, false);
				for (int i = 0; i < CARS; i++) {
					int idx = carPage * CARS + i;
					if (idx >= cars.size()) break;
					var v = cars.get(idx);
					String line = clip(v.getName().getString(), 110) + "  " + (int) v.getX() + " " + (int) v.getY() + " " + (int) v.getZ() + "  (" + (int) Math.sqrt(pl.distanceToSqr(v)) + " м)";
					g.text(font, clip(line, 196), tx, ty + 26 + i * 12, c, false);
				}
			}
			case 2 -> g.text(font, "Нарушений нет.", tx, ty, c, false);
			case 3 -> {
				g.text(font, "Территории пока не заданы.", tx, ty, c, false);
				g.text(font, "Вы сейчас: " + (int) pl.getX() + " " + (int) pl.getY() + " " + (int) pl.getZ(), tx, ty + 14, c, false);
			}
			case 4 -> {
				g.text(font, "Игрок: " + pl.getName().getString(), tx, ty, c, false);
				g.text(font, "Паспорт: " + (pass.isEmpty() ? "нет" : "есть, подписан " + com.rzauto.item.Passport.date(pass)), tx, ty + 12, c, false);
				g.text(font, "Машин рядом: " + myCars().size(), tx, ty + 24, c, false);
				g.text(font, "Нарушений: 0", tx, ty + 36, c, false);
			}
		}
	}

	private String clip(String s, int w) {
		if (font.width(s) <= w) return s;
		while (s.length() > 3 && font.width(s + "...") > w) s = s.substring(0, s.length() - 1);
		return s + "...";
	}

	@Override
	public void tick() {
		super.tick();
		if (minecraft.player == null || minecraft.player.distanceToSqr(pos.getX() + 0.5, pos.getY() + 0.5, pos.getZ() + 0.5) > 64) onClose();
	}

	@Override
	public boolean isPauseScreen() { return false; }

	private static void panel(GuiGraphicsExtractor g, int x, int y, int w, int h) {
		g.fill(x, y, x + w, y + h, 0xFF000000);
		g.fill(x + 1, y + 1, x + w - 1, y + h - 1, 0xFFFFFFFF);
		g.fill(x + 3, y + 3, x + w - 1, y + h - 1, 0xFF555555);
		g.fill(x + 3, y + 3, x + w - 3, y + h - 3, 0xFFC6C6C6);
	}

	private static void slot(GuiGraphicsExtractor g, int x, int y) {
		g.fill(x, y, x + 18, y + 18, 0xFF8B8B8B);
		g.fill(x, y, x + 17, y + 1, 0xFF373737);
		g.fill(x, y, x + 1, y + 17, 0xFF373737);
		g.fill(x + 1, y + 17, x + 18, y + 18, 0xFFFFFFFF);
		g.fill(x + 17, y + 1, x + 18, y + 18, 0xFFFFFFFF);
	}

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mx, int my, float pt) {
		int x0 = x0(), y0 = y0();
		g.fill(0, 0, width, height, 0x60000000);
		panel(g, x0, y0, PW, PH);
		if (desk) { extractDesk(g, x0, y0); super.extractRenderState(g, mx, my, pt); return; }
		String gk = groups.get(group);
		g.text(font, "Верстак  -  " + (gk.isEmpty() ? "все марки" : gk), x0 + 8, y0 + 6, 0xFF404040, false);
		g.text(font, (page + 1) + "/" + Math.max(1, (shown.size() + ROWS - 1) / ROWS), x0 + 66, y0 + 22, 0xFF404040, false);
		Map<String, Integer> have = inventory();
		for (int i = 0; i < ROWS; i++) {
			int idx = page * ROWS + i;
			if (idx >= shown.size()) break;
			int ry = y0 + 40 + i * RH;
			slot(g, x0 + 9, ry + 1);
			g.item(stack(shown.get(idx).result(), 1), x0 + 10, ry + 2);
			if (idx == sel) g.outline(x0 + 29, ry - 1, 122, 22, 0xFF2ECC71);
		}
		if (shown.isEmpty()) return;
		BenchRecipes.Recipe r = shown.get(sel);
		int gx = x0 + 176, gy = y0 + 44;
		for (int row = 0; row < 3; row++) for (int col = 0; col < 3; col++) {
			int sx = gx + col * 18, sy = gy + row * 18;
			slot(g, sx, sy);
			String it = r.grid()[row * 3 + col];
			if (!it.isEmpty()) g.item(stack(it, 1), sx + 1, sy + 1);
		}
		// стрелка и слот результата
		int ax = gx + 3 * 18 + 8, ay = gy + 22;
		g.fill(ax, ay + 3, ax + 16, ay + 7, 0xFF8B8B8B);
		g.fill(ax + 12, ay, ax + 14, ay + 10, 0xFF8B8B8B);
		g.fill(ax + 14, ay + 2, ax + 16, ay + 8, 0xFF8B8B8B);
		int rx = ax + 26, ry2 = gy + 18;
		g.fill(rx - 4, ry2 - 4, rx + 26, ry2 + 26, 0xFF8B8B8B);
		slot(g, rx, ry2);
		g.item(stack(r.result(), r.count()), rx + 1, ry2 + 1);
		g.text(font, clip(itemName(r.result()) + (r.count() > 1 ? " x" + r.count() : ""), 150), gx, gy + 60, 0xFF404040, false);
		int ty = gy + 72;
		for (var n : r.need().entrySet()) {
			int h = have.getOrDefault(n.getKey(), 0);
			g.text(font, clip(itemName(n.getKey()), 110) + "  " + h + "/" + n.getValue(), gx, ty, h >= n.getValue() ? 0xFF1E7A3C : 0xFFA02020, false);
			ty += 10;
			if (ty > y0 + PH - 52) break;
		}
		super.extractRenderState(g, mx, my, pt);
	}
}
