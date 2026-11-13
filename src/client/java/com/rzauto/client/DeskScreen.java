package com.rzauto.client;

import com.rzauto.item.Passport;
import com.rzauto.net.DeskEditPayload;
import com.rzauto.net.DeskViolationPayload;
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

/** Паспортный стол: вкладка «Паспорт» (название страны и герб) и вкладка «Нарушение» (отправка нарушения игроку с печатью страны). */
final class DeskScreen extends net.minecraft.client.gui.screens.Screen {
	private static final int PW = 300, PH = 190;
	private final BlockPos pos;
	private int tab = 0, seal = -1;
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

	@Override
	protected void init() {
		ItemStack pass = myPassport();
		if (country == null) country = Passport.country(pass);
		if (seal < 0) seal = Passport.sealIndex(pass);
		int x0 = x0(), y0 = y0();
		addRenderableWidget(Button.builder(Component.literal("Паспорт"), b -> { tab = 0; rebuildWidgets(); }).bounds(x0 + 12, y0 + 22, 90, 16).build()).active = tab != 0;
		addRenderableWidget(Button.builder(Component.literal("Нарушение"), b -> { tab = 1; rebuildWidgets(); }).bounds(x0 + 106, y0 + 22, 90, 16).build()).active = tab != 1;
		if (pass.isEmpty()) return;
		int n = Passport.SEALS.length;
		if (tab == 0) {
			EditBox eb = new EditBox(font, x0 + 16, y0 + 62, 150, 18, Component.literal("Страна"));
			eb.setMaxLength(32);
			eb.setValue(country);
			eb.setResponder(s -> country = s);
			addRenderableWidget(eb);
			addRenderableWidget(Button.builder(Component.literal("<"), b -> { seal = (seal + n - 1) % n; }).bounds(x0 + 16, y0 + 106, 20, 18).build());
			addRenderableWidget(Button.builder(Component.literal(">"), b -> { seal = (seal + 1) % n; }).bounds(x0 + 146, y0 + 106, 20, 18).build());
			addRenderableWidget(Button.builder(Component.literal("Сохранить в паспорт"), b -> ClientPlayNetworking.send(new DeskEditPayload(pos.asLong(), country, seal))).bounds(x0 + 16, y0 + 150, 150, 20).build());
		} else {
			EditBox t1 = new EditBox(font, x0 + 16, y0 + 62, 150, 18, Component.literal("Игрок"));
			t1.setMaxLength(16); t1.setValue(target); t1.setResponder(s -> target = s);
			addRenderableWidget(t1);
			EditBox t2 = new EditBox(font, x0 + 16, y0 + 102, 268, 18, Component.literal("Нарушение"));
			t2.setMaxLength(80); t2.setValue(text); t2.setResponder(s -> text = s);
			addRenderableWidget(t2);
			addRenderableWidget(Button.builder(Component.literal("Отправить нарушение"), b -> { ClientPlayNetworking.send(new DeskViolationPayload(pos.asLong(), target, text)); text = ""; rebuildWidgets(); }).bounds(x0 + 16, y0 + 150, 150, 20).build());
		}
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
		int x0 = x0(), y0 = y0();
		g.fillGradient(0, 0, width, height, 0xB004100A, 0xD006180F);
		g.fill(x0, y0, x0 + PW, y0 + PH, 0xFFEADFBE);
		g.fill(x0 + 4, y0 + 4, x0 + PW - 4, y0 + 6, 0xFF2E6BC8);
		g.fill(x0 + 4, y0 + PH - 6, x0 + PW - 4, y0 + PH - 4, 0xFF2E6BC8);
		g.fill(x0 + 4, y0 + 4, x0 + 6, y0 + PH - 4, 0xFF2E6BC8);
		g.fill(x0 + PW - 6, y0 + 4, x0 + PW - 4, y0 + PH - 4, 0xFF2E6BC8);
		g.text(font, "ПАСПОРТНЫЙ СТОЛ", x0 + 12, y0 + 10, 0xFF1D4F9E, false);
		ItemStack pass = myPassport();
		if (pass.isEmpty()) { g.text(font, "Нужен ваш подписанный паспорт", x0 + 16, y0 + 70, 0xFF8A2A2A, false); super.extractRenderState(g, mx, my, pt); return; }
		int c = 0xFF6A5F3E;
		int sz = 96, sx = x0 + PW - sz - 16, sy = y0 + 50;
		g.fill(sx - 4, sy - 4, sx + sz + 4, sy + sz + 4, 0xFFD3C79F);
		int shown = tab == 0 ? seal : Passport.sealIndex(pass);
		g.blit(RenderPipelines.GUI_TEXTURED, Identifier.fromNamespaceAndPath("rz_auto", "textures/gui/" + Passport.sealPath(shown) + ".png"), sx, sy, 0f, 0f, sz, sz, 256, 256, 256, 256);
		if (tab == 0) {
			g.text(font, "Название страны", x0 + 16, y0 + 50, c, false);
			g.text(font, "Герб", x0 + 16, y0 + 94, c, false);
			g.centeredText(font, Passport.SEAL_NAMES[Math.floorMod(seal, Passport.SEALS.length)], x0 + 91, y0 + 111, 0xFF1A1A1A);
		} else {
			g.text(font, "Игрок", x0 + 16, y0 + 50, c, false);
			g.text(font, "Нарушение", x0 + 16, y0 + 90, c, false);
			g.text(font, "Печать: " + Passport.country(pass), x0 + 16, y0 + 130, 0xFF1A1A1A, false);
		}
		super.extractRenderState(g, mx, my, pt);
	}
}
