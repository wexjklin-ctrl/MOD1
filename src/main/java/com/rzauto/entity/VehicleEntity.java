package com.rzauto.entity;

import java.util.UUID;
import net.minecraft.network.syncher.SynchedEntityData;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.MoverType;
import net.minecraft.world.entity.player.Input;
import net.minecraft.world.entity.player.Player;
import com.rzauto.VehicleRegistry;
import com.rzauto.logic.GearDriver;
import com.rzauto.logic.Physics;
import com.rzauto.logic.VehicleState;
import net.minecraft.network.chat.Component;
import com.rzauto.logic.VehicleSpec;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;
import net.minecraft.world.phys.Vec3;

/**
 * Машина. Этап 2: серверная физика (com.rzauto.logic.Physics). Водитель = первый пассажир-игрок;
 * клавиши берутся из ServerPlayer.getLastClientInput() (ваниль уже шлёт их на сервер, свой пакет не нужен).
 * Клиент машину не симулирует (getControllingPassenger = null), а только интерполирует позицию от сервера.
 * Двигатель пока всегда заведён, мощность 100% (передачи, топливо и условия езды подключаются позже).
 * Пустая стоящая машина на земле выходит из тика сразу (стоимость ~0).
 */
public class VehicleEntity extends Entity {
	/** Владелец (тот, кто поставил машину). null, пока не задан. */
	private UUID owner;

	private VehicleSpec spec;
	private final Physics.State st = new Physics.State();
	private final double[] vel = new double[2];
	/** Состояние (передачи и т.д.); режим передач включён по умолчанию, чтобы скорость не была сразу 100%. */
	private final VehicleState vs = newState();
	private final GearDriver gearDriver = new GearDriver();
	private final GearDriver.Out gearOut = new GearDriver.Out();
	private boolean lastJump;
	private String lastHud = "";

	private static VehicleState newState() {
		VehicleState v = new VehicleState();
		v.gears.mode = true;
		return v;
	}
	private static final double TURN_STRENGTH = com.rzauto.logic.VehicleState.DEFAULT_TURN_STRENGTH;   // по умолчанию 1 (как в оригинале)
	private static final double GRAVITY = 0.08;

	public VehicleEntity(EntityType<?> type, Level level) {
		super(type, level);
	}

	private VehicleSpec spec() {
		if (spec == null) spec = VehicleRegistry.specOf(getType());
		return spec;
	}

	@Override
	public float maxUpStep() {
		VehicleSpec s = spec();
		return s != null ? (float) s.stepHeight() : 0.6f;
	}

	/** Сервер авторитетен: клиент водителя не симулирует машину. */
	@Override
	public LivingEntity getControllingPassenger() { return null; }

	@Override
	public void tick() {
		super.tick();
		if (level().isClientSide()) return;
		VehicleSpec s = spec();
		if (s == null) return;

		ServerPlayer driver = null;
		if (!getPassengers().isEmpty() && getPassengers().get(0) instanceof ServerPlayer p) driver = p;

		double x = 0, y = 0;
		if (driver != null) {
			Input in = driver.getLastClientInput();
			x = (in.left() ? 1 : 0) - (in.right() ? 1 : 0);   // как в Bedrock: влево = +1
			y = (in.forward() ? 1 : 0) - (in.backward() ? 1 : 0);
			// Передачи: Прыжок (пробел) — короткое нажатие выше, удержание ниже (как в оригинале)
			long now = level().getGameTime();
			boolean jump = in.jump();
			if (jump != lastJump) { gearDriver.onJump(jump, now); lastJump = jump; }
			gearDriver.tick(vs.gears, s, driver.getInventory().getSelectedSlot(), now, gearOut);
			if (gearOut.hud != null && (!gearOut.hud.equals(lastHud) || now % 10 == 0)) {
				lastHud = gearOut.hud;
				driver.sendSystemMessage(Component.literal(gearOut.hud), true);
			}
		}
		String m7 = vs.gears.tick7(s, driver != null);
		if (m7 != null && driver != null) driver.sendSystemMessage(Component.literal(m7), true);
		// Спящая машина: пусто, стоит, на земле, нет скорости → ничего не считаем.
		if (driver == null && onGround() && st.speed == 0 && st.lat == 0) return;

		st.yawDeg = getYRot();
		double max = Physics.currentMax(s, vs.gears.speedPercent(s, vs.speedPercent), false, 1, true);
		Physics.tick(s, st, new Physics.Input(x, y), max, false, TURN_STRENGTH);

		Physics.horizontalVelocity(st.yawDeg, st.speed, st.lat, vel);
		double vy = onGround() ? -GRAVITY : (getDeltaMovement().y - GRAVITY) * 0.98;
		setDeltaMovement(vel[0], vy, vel[1]);
		move(MoverType.SELF, getDeltaMovement());
		if (horizontalCollision) st.speed = Physics.collisionBleed(st.speed, max);
		setYRot((float) st.yawDeg);
	}

	/** Только для тестов CI. */
	public void debugSetSpeed(double v) { st.speed = v; }
	public double debugSpeed() { return st.speed; }

	public UUID getOwner() { return owner; }
	public void setOwner(UUID owner) { this.owner = owner; }

	@Override
	protected void defineSynchedData(SynchedEntityData.Builder builder) {
		// синхронизируемых полей пока нет
	}

	@Override
	protected void readAdditionalSaveData(ValueInput in) {
		String s = in.getStringOr("owner", "");
		try { owner = s.isEmpty() ? null : UUID.fromString(s); } catch (IllegalArgumentException e) { owner = null; }
	}

	@Override
	protected void addAdditionalSaveData(ValueOutput out) {
		if (owner != null) out.putString("owner", owner.toString());
	}

	@Override
	public boolean hurtServer(ServerLevel level, DamageSource source, float amount) {
		return false; // этап 1: машина неуязвима
	}

	@Override
	public boolean isPickable() { return !isRemoved(); }

	@Override
	protected boolean canAddPassenger(Entity passenger) {
		return getPassengers().size() < 2;
	}

	@Override
	public InteractionResult interact(Player player, InteractionHand hand, Vec3 hit) {
		if (player.isSecondaryUseActive()) return InteractionResult.PASS;
		if (!level().isClientSide()) {
			if (player.startRiding(this)) {
				player.setYRot(getYRot());   // водитель смотрит вперёд по ходу машины
				player.setXRot(0);
				player.setYHeadRot(getYRot());
			}
		}
		return InteractionResult.SUCCESS;
	}
}
