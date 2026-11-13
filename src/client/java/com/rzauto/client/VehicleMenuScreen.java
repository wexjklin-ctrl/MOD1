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
	private static final int PW = 240;
	private int ph = 220;

	VehicleMenuScreen(VehicleEntity car) {
		super(Component.literal("Автомобиль"));
		this.car = car;
	}

	private int signature() {
		return (CamMode.gta ? 1 << 24 : 0) | (car.isEngineOn() ? 1 : 0) | (car.isBroken() ? 2 : 0) | (car.lockState().ordinal() << 2) | (car.lightsOn() ? 16 : 0)
			| (car.roofOn() ? 1 << 25 : 0) | (car.sirenOn() ? 32 : 0) | (car.gearsOn() ? 64 : 0) | (Math.round(car.sensValue() * 10) << 8) | (Math.round(car.hpValue()) << 16);
	}

	private void act(int action) { if (action == -1) { CamMode.toggle(); rebuildWidgets(); return; } ClientPlayNetworking.send(new VehicleActionPayload(car.getId(), action)); }

	private Button btn(String text, int action, int x, int y, int w, int h) {
		Button b = Button.builder(Component.literal(text), bb -> act(action)).bounds(x, y, w, h).build();
		addRenderableWidget(b);
		return b;
	}

	@Override
	protected void init() {
		sig = signature();
		VehicleSpec sp = VehicleRegistry.specOf(car.getType());
		boolean jeepYj = sp != null && sp.bedrockId().startsWith("jeep:yj");
		int rows = 9 + (sp != null && sp.hasSiren() ? 1 : 0) + (jeepYj ? 1 : 0);
		ph = 66 + rows * 24 + 8;
		int x = (width - PW) / 2 + 15, y = (height - ph) / 2 + 66, w = PW - 30, h = 20, step = h + 4;
		int r = 0;
		btn(car.isEngineOn() ? "Двигатель: ВКЛ  (заглушить)" : "Двигатель: ВЫКЛ  (завести)", VehicleEntity.ACT_ENGINE, x, y + step * r++, w, h);
		btn(car.isLocked() ? "Замок: ЗАКРЫТО  (открыть)" : "Замок: ОТКРЫТО  (закрыть)", VehicleEntity.ACT_LOCK, x, y + step * r++, w, h);
		btn(car.lightsOn() ? "Фары: ВКЛ  (выключить)" : "Фары: ВЫКЛ  (включить)", VehicleEntity.ACT_LIGHTS, x, y + step * r++, w, h);
		if (sp != null && sp.hasSiren()) btn(car.sirenOn() ? "Сирена: ВКЛ  (выключить)" : "Сирена: ВЫКЛ  (включить)", VehicleEntity.ACT_SIREN, x, y + step * r++, w, h);
		if (jeepYj) btn(car.roofOn() ? "Крыша / тент: ЕСТЬ  (снять)" : "Крыша / тент: СНЯТА  (поставить)", VehicleEntity.ACT_ROOF, x, y + step * r++, w, h);
		btn("Пересесть на другое место", VehicleEntity.ACT_SEAT, x, y + step * r++, w, h);
		btn(car.gearsOn() ? "Передачи: ВКЛ (Shift выше, Ctrl ниже, выход F)" : "Передачи: ВЫКЛ  (включить)", VehicleEntity.ACT_GEARS, x, y + step * r++, w, h);
		btn(CamMode.gta ? "Камера: GTA (за машиной)  - сменить" : "Камера: свободная  - сменить", -1, x, y + step * r++, w, h);
		int ry = y + step * r++;
		btn("-", VehicleEntity.ACT_SENS_DOWN, x, ry, 24, h);
		Button lab = Button.builder(Component.literal("Руль GTA 5, чувствительность: " + String.format("%.1f", car.sensValue())), b -> { }).bounds(x + 28, ry, w - 56, h).build();
		lab.active = false;
		addRenderableWidget(lab);
		btn("+", VehicleEntity.ACT_SENS_UP, x + w - 24, ry, 24, h);
		Button repair = btn(car.isBroken() || car.hpValue() < (sp == null ? 20 : sp.health()) - 0.01f ? "Починить (нужна шестерёнка)" : "Исправна", VehicleEntity.ACT_REPAIR, x, y + step * r++, w, h);
		repair.active = car.isBroken() || car.hpValue() < (sp == null ? 20 : sp.health()) - 0.01f;
		addRenderableWidget(Button.builder(Component.literal("Закрыть"), b -> onClose()).bounds(x, y + step * r++ + 4, w, h).build());
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
		int x = (width - PW) / 2, y = (height - ph) / 2;
		g.fill(0, 0, width, height, 0x70000000);
		g.fill(x, y, x + PW, y + ph, 0xF00C1A12);
		g.fill(x, y, x + PW, y + 3, VehicleHud.EDGE);
		g.outline(x, y, PW, ph, 0xFF1F4A33);
		VehicleSpec s = VehicleRegistry.specOf(car.getType());
		g.text(font, car.getName().getString(), x + 15, y + 12, VehicleHud.WHITE, true);
		String lk = car.lockState() == Access.Lock.OPEN ? "открыта" : "закрыта";
		g.text(font, "Меню автомобиля", x + 15, y + 25, VehicleHud.DIM, false);
		double fuel = s == null ? 0 : car.fuelValue() / Math.max(s.maxFuel(), 0.01);
		g.text(font, "ЛАВА", x + 15, y + 40, VehicleHud.DIM, false);
		g.fill(x + 80, y + 41, x + PW - 15, y + 47, 0xFF1F4A33);
		g.fill(x + 80, y + 41, x + 80 + (int) ((PW - 95) * Math.max(0, Math.min(1, fuel))), y + 47, 0xFF2ECC71);
		double hpf = s == null ? 1 : car.hpValue() / Math.max(s.health(), 1);
		g.text(font, "ПРОЧНОСТЬ", x + 15, y + 52, VehicleHud.DIM, false);
		g.fill(x + 80, y + 53, x + PW - 15, y + 59, 0xFF1F4A33);
		g.fill(x + 80, y + 53, x + 80 + (int) ((PW - 95) * Math.max(0, Math.min(1, hpf))), y + 59, hpf > 0.5 ? 0xFF3DDC84 : hpf > 0.25 ? 0xFFFFC233 : 0xFFFF4A3D);
		super.extractRenderState(g, mx, my, pt);
	}
}
