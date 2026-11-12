package com.rzauto.client;

import com.rzauto.VehicleRegistry;
import com.rzauto.entity.VehicleEntity;
import com.rzauto.logic.Access;
import com.rzauto.logic.VehicleSpec;
import com.rzauto.net.VehicleActionPayload;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.network.chat.Component;

/** Меню машины (клавиша I): двигатель, замок, ремонт, режим руля. Состояние берётся из синхронизированных данных сущности. */
final class VehicleMenuScreen extends net.minecraft.client.gui.screens.Screen {
	private final VehicleEntity car;
	private int sig = -1;
	private static final int PW = 230, PH = 196;

	VehicleMenuScreen(VehicleEntity car) {
		super(Component.literal("Автомобиль"));
		this.car = car;
	}

	private int signature() {
		return (car.isEngineOn() ? 1 : 0) | (car.isBroken() ? 2 : 0) | (car.lockState().ordinal() << 2);
	}

	private void act(int action) { ClientPlayNetworking.send(new VehicleActionPayload(car.getId(), action)); }

	@Override
	protected void init() {
		sig = signature();
		int x = (width - PW) / 2 + 15, y = (height - PH) / 2 + 58, w = PW - 30, h = 20, gap = 4;
		addRenderableWidget(Button.builder(Component.literal(car.isEngineOn() ? "Двигатель: ВКЛ  (заглушить)" : "Двигатель: ВЫКЛ  (завести)"), b -> act(VehicleEntity.ACT_ENGINE)).bounds(x, y, w, h).build());
		addRenderableWidget(Button.builder(Component.literal(car.isLocked() ? "Замок: ЗАКРЫТО  (открыть)" : "Замок: ОТКРЫТО  (закрыть)"), b -> act(VehicleEntity.ACT_LOCK)).bounds(x, y + (h + gap), w, h).build());
		Button repair = Button.builder(Component.literal(car.isBroken() ? "Починить" : "Исправна"), b -> act(VehicleEntity.ACT_REPAIR)).bounds(x, y + 2 * (h + gap), w, h).build();
		repair.active = car.isBroken();
		addRenderableWidget(repair);
		Button steer = Button.builder(Component.literal("Руль: GTA 5  ✓"), b -> { }).bounds(x, y + 3 * (h + gap), w, h).build();
		steer.active = false;   // пока единственный режим
		addRenderableWidget(steer);
		addRenderableWidget(Button.builder(Component.literal("Закрыть"), b -> onClose()).bounds(x, y + 4 * (h + gap) + 4, w, h).build());
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

	@Override
	public void extractRenderState(GuiGraphicsExtractor g, int mx, int my, float pt) {
		int x = (width - PW) / 2, y = (height - PH) / 2;
		g.fill(0, 0, width, height, 0x70000000);
		g.fill(x, y, x + PW, y + PH, 0xF0121418);
		g.fill(x, y, x + PW, y + 3, VehicleHud.EDGE);
		g.outline(x, y, PW, PH, 0xFF2A2E35);
		VehicleSpec s = VehicleRegistry.specOf(car.getType());
		g.text(font, car.getName().getString(), x + 15, y + 12, VehicleHud.WHITE, true);
		String lk = car.lockState() == Access.Lock.OPEN ? "открыта" : "закрыта";
		g.text(font, "Меню автомобиля", x + 15, y + 25, VehicleHud.DIM, false);
		double fuel = s == null ? 0 : car.fuelValue() / Math.max(s.maxFuel(), 0.01);
		g.text(font, "ЛАВА", x + 15, y + 40, VehicleHud.DIM, false);
		g.fill(x + 50, y + 41, x + PW - 15, y + 47, 0xFF2A2E35);
		g.fill(x + 50, y + 41, x + 50 + (int) ((PW - 65) * Math.max(0, Math.min(1, fuel))), y + 47, 0xFFFF7A00);
		super.extractRenderState(g, mx, my, pt);
	}
}
