package com.rzauto.client;

import com.rzauto.logic.BenchRecipes;
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

/** Верстак: список рецептов (по маркам), кнопка «Создать», материалы берутся из инвентаря на сервере. */
final class BenchScreen extends net.minecraft.client.gui.screens.Screen {
	private static final int PW = 330, ROWS = 7, RH = 30;
	private final BlockPos pos;
	private final List<String> groups = new ArrayList<>();
	private int group, page;
	private boolean onlyCraftable;
	private List<BenchRecipes.Recipe> shown = new ArrayList<>();

	BenchScreen(BlockPos pos) {
		super(Component.literal("Верстак"));
		this.pos = pos;
		groups.add("");
		TreeSet<String> g = new TreeSet<>();
		for (BenchRecipes.Recipe r : BenchRecipes.all()) if (!r.group().isEmpty()) g.add(r.group());
		groups.addAll(g);
	}

	private static String itemName(String id) {
		var item = BuiltInRegistries.ITEM.getValue(Identifier.parse(id));
		return item == null ? id : new ItemStack(item).getHoverName().getString();
	}

	private Map<String, Integer> inventory() {
		Map<String, Integer> have = new HashMap<>();
		var pl = minecraft.player;
		if (pl == null) return have;
		var inv = pl.getInventory();
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
			boolean other = r.group().isEmpty();
			if (!key.isEmpty() ? !r.group().equals(key) : false) continue;
			if (onlyCraftable && !can(r, have)) continue;
			if (key.isEmpty() && !other && false) continue;
			shown.add(r);
		}
		int pages = Math.max(1, (shown.size() + ROWS - 1) / ROWS);
		page = Math.max(0, Math.min(page, pages - 1));
	}

	@Override
	protected void init() {
		refilter();
		int ph = 70 + ROWS * RH + 40, x0 = (width - PW) / 2, y0 = (height - ph) / 2;
		Map<String, Integer> have = inventory();
		addRenderableWidget(Button.builder(Component.literal("<"), b -> { group = (group + groups.size() - 1) % groups.size(); page = 0; rebuildWidgets(); }).bounds(x0 + 12, y0 + 28, 20, 20).build());
		addRenderableWidget(Button.builder(Component.literal(">"), b -> { group = (group + 1) % groups.size(); page = 0; rebuildWidgets(); }).bounds(x0 + 36, y0 + 28, 20, 20).build());
		addRenderableWidget(Button.builder(Component.literal(onlyCraftable ? "Только доступные: ДА" : "Только доступные: НЕТ"), b -> { onlyCraftable = !onlyCraftable; page = 0; rebuildWidgets(); }).bounds(x0 + PW - 162, y0 + 28, 150, 20).build());
		int top = y0 + 54;
		for (int i = 0; i < ROWS; i++) {
			int idx = page * ROWS + i;
			if (idx >= shown.size()) break;
			BenchRecipes.Recipe r = shown.get(idx);
			Button cb = Button.builder(Component.literal("Создать"), b -> ClientPlayNetworking.send(new BenchCraftPayload(pos.asLong(), r.id()))).bounds(x0 + PW - 82, top + i * RH + 4, 70, 20).build();
			cb.active = can(r, have);
			addRenderableWidget(cb);
		}
		int by = y0 + 54 + ROWS * RH + 6;
		addRenderableWidget(Button.builder(Component.literal("Назад"), b -> { page--; rebuildWidgets(); }).bounds(x0 + 12, by, 60, 20).build()).active = page > 0;
		addRenderableWidget(Button.builder(Component.literal("Далее"), b -> { page++; rebuildWidgets(); }).bounds(x0 + 78, by, 60, 20).build()).active = (page + 1) * ROWS < shown.size();
		addRenderableWidget(Button.builder(Component.literal("Закрыть"), b -> onClose()).bounds(x0 + PW - 82, by, 70, 20).build());
	}

	@Override
	public void tick() {
		super.tick();
		if (minecraft.player == null || minecraft.player.distanceToSqr(pos.getX() + 0.5, pos.getY() + 0.5, pos.getZ() + 0.5) > 64) onClose();
	}

	@Override
	public boolean isPauseScreen() { return false; }

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mx, int my, float pt) {
		int ph = 70 + ROWS * RH + 40, x0 = (width - PW) / 2, y0 = (height - ph) / 2;
		g.fill(0, 0, width, height, 0x70000000);
		g.fill(x0, y0, x0 + PW, y0 + ph, 0xF0121418);
		g.fill(x0, y0, x0 + PW, y0 + 3, VehicleHud.EDGE);
		g.outline(x0, y0, PW, ph, 0xFF2A2E35);
		String gk = groups.get(group);
		g.text(font, "Верстак автомобилей  -  " + (gk.isEmpty() ? "все" : gk), x0 + 12, y0 + 12, VehicleHud.WHITE, true);
		int pages = Math.max(1, (shown.size() + ROWS - 1) / ROWS);
		g.text(font, (page + 1) + "/" + pages, x0 + 150, y0 + 54 + ROWS * RH + 12, VehicleHud.DIM, false);
		Map<String, Integer> have = inventory();
		int top = y0 + 54;
		for (int i = 0; i < ROWS; i++) {
			int idx = page * ROWS + i;
			if (idx >= shown.size()) break;
			BenchRecipes.Recipe r = shown.get(idx);
			int ry = top + i * RH;
			g.fill(x0 + 8, ry, x0 + PW - 8, ry + RH - 2, 0xFF1B1F26);
			g.text(font, itemName(r.result()) + (r.count() > 1 ? " x" + r.count() : ""), x0 + 12, ry + 3, can(r, have) ? VehicleHud.WHITE : VehicleHud.DIM, false);
			StringBuilder sb = new StringBuilder();
			for (var n : r.need().entrySet()) {
				if (sb.length() > 0) sb.append(", ");
				sb.append(itemName(n.getKey())).append(" ").append(have.getOrDefault(n.getKey(), 0)).append('/').append(n.getValue());
			}
			String s = sb.toString();
			if (font.width(s) > PW - 110) { while (s.length() > 4 && font.width(s + "...") > PW - 110) s = s.substring(0, s.length() - 1); s += "..."; }
			g.text(font, s, x0 + 12, ry + 15, 0xFF8A93A0, false);
		}
		super.extractRenderState(g, mx, my, pt);
	}
}
