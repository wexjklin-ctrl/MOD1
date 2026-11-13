package com.rzauto.client;

import com.rzauto.entity.VehicleEntity;
import com.rzauto.item.Passport;
import com.rzauto.net.VehicleActionPayload;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.world.item.ItemStack;

/** Бардачок: картинка бардачка как фон и один слот. Нажатие на слот: положить предмет из руки или забрать содержимое. */
final class GloveboxScreen extends net.minecraft.client.gui.screens.Screen {
	private static final Identifier BG = Identifier.fromNamespaceAndPath("rz_auto", "textures/gui/glovebox.png");
	private static final int TW = 1024, TH = 572;
	private final VehicleEntity car;
	private int ix, iy, iw, ih, sx, sy, ss;

	GloveboxScreen(VehicleEntity car) {
		super(Component.literal("Бардачок"));
		this.car = car;
	}

	@Override
	protected void init() {
		double k = Math.min(width * 0.92 / TW, height * 0.80 / TH);
		iw = (int) (TW * k); ih = (int) (TH * k);
		ix = (width - iw) / 2; iy = (height - ih) / 2 - 8;
		ss = Math.max(32, (int) (90 * k));
		sx = ix + (int) (672 * k) - ss / 2;
		sy = iy + (int) (285 * k) - ss / 2;
		Button b = Button.builder(Component.empty(), bb -> {
			boolean empty = car.gloveStack().isEmpty();
			ClientPlayNetworking.send(new VehicleActionPayload(car.getId(), empty ? VehicleEntity.ACT_GLOVE_PUT : VehicleEntity.ACT_GLOVE_TAKE));
		}).bounds(sx, sy, ss, ss).build();
		addRenderableWidget(b);
	}

	@Override
	public void tick() {
		super.tick();
		if (car.isRemoved()) onClose();
	}

	@Override
	public boolean keyPressed(KeyEvent e) {
		if (RzAutoClient.MENU.matches(e)) { Minecraft.getInstance().setScreenAndShow(null); return true; }
		return super.keyPressed(e);
	}

	@Override
	public void onClose() { Minecraft.getInstance().setScreenAndShow(new VehicleMenuScreen(car)); }

	@Override
	public boolean isPauseScreen() { return false; }

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mx, int my, float pt) {
		g.fillGradient(0, 0, width, height, 0xCC04100A, 0xEE06180F);
		g.blit(RenderPipelines.GUI_TEXTURED, BG, ix, iy, 0f, 0f, iw, ih, TW, TH, TW, TH);
		g.fill(ix, iy, ix + iw, iy + 1, 0xFF3DDC84); g.fill(ix, iy + ih - 1, ix + iw, iy + ih, 0xFF3DDC84);
		g.fill(ix, iy, ix + 1, iy + ih, 0xFF3DDC84); g.fill(ix + iw - 1, iy, ix + iw, iy + ih, 0xFF3DDC84);
		super.extractRenderState(g, mx, my, pt);
		boolean hov = mx >= sx && mx < sx + ss && my >= sy && my < sy + ss;
		g.fill(sx, sy, sx + ss, sy + ss, hov ? 0xAA1C5A3A : 0xAA0A2A1C);
		g.fill(sx, sy, sx + ss, sy + 2, 0xFF3DDC84); g.fill(sx, sy + ss - 2, sx + ss, sy + ss, 0xFF3DDC84);
		g.fill(sx, sy, sx + 2, sy + ss, 0xFF3DDC84); g.fill(sx + ss - 2, sy, sx + ss, sy + ss, 0xFF3DDC84);
		ItemStack st = car.gloveStack();
		if (!st.isEmpty()) {
			float k = (ss - 8) / 16f;
			g.pose().pushMatrix();
			g.pose().translate(sx + 4, sy + 4);
			g.pose().scale(k, k);
			g.item(st, 0, 0);
			g.pose().popMatrix();
		}
		g.text(font, "Бардачок", ix + 10, iy + 8, 0xFFEFFFF5, true);
		String status;
		int col = 0xFFB5FFD6;
		if (st.isEmpty()) status = "Пусто. Нажмите на ячейку: положить предмет из руки";
		else if (Passport.isDoc(st)) {
			boolean mine = false;
			try { mine = car.isOwnedBy(java.util.UUID.fromString(Passport.ownerUuid(st))); } catch (Exception ignored) { }
			if (!Passport.signed(st)) { status = "Паспорт не подписан (присядьте и ПКМ с ним в руке)"; col = 0xFFFFC233; }
			else if (mine) status = "Паспорт владельца " + Passport.ownerName(st) + ": машина поедет у любого водителя";
			else { status = "Чужой паспорт (" + Passport.ownerName(st) + "): машина не поедет"; col = 0xFFFF6B6B; }
			status += ". Нажмите на ячейку: забрать";
		} else status = st.getHoverName().getString() + ". Нажмите на ячейку: забрать";
		g.centeredText(font, status, width / 2, iy + ih + 6, col);
		g.centeredText(font, "Esc: назад в меню   I: закрыть", width / 2, iy + ih + 18, 0xFF8FB9A3);
	}
}
