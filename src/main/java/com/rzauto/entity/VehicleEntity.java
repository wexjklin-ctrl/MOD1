package com.rzauto.entity;

import java.util.UUID;
import net.minecraft.network.syncher.EntityDataAccessor;
import net.minecraft.network.syncher.EntityDataSerializers;
import net.minecraft.network.syncher.SynchedEntityData;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import com.rzauto.logic.Access;
import com.rzauto.logic.DriveGate;
import com.rzauto.logic.Fuel;
import com.rzauto.logic.Wear;
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
		v.gta = true;   // управление как в GTA, без ручных передач (скорость всегда 100%)
		return v;
	}
	private static final double TURN_STRENGTH = com.rzauto.logic.VehicleState.DEFAULT_TURN_STRENGTH;   // по умолчанию 1 (как в оригинале)
	private static final double GRAVITY = 0.08;

	public static final EntityDataAccessor<Boolean> DATA_ENGINE = SynchedEntityData.defineId(VehicleEntity.class, EntityDataSerializers.BOOLEAN);
	public static final EntityDataAccessor<Float> DATA_FUEL = SynchedEntityData.defineId(VehicleEntity.class, EntityDataSerializers.FLOAT);
	public static final EntityDataAccessor<Byte> DATA_LOCK = SynchedEntityData.defineId(VehicleEntity.class, EntityDataSerializers.BYTE);
	public static final EntityDataAccessor<Boolean> DATA_BROKEN = SynchedEntityData.defineId(VehicleEntity.class, EntityDataSerializers.BOOLEAN);
	public static final EntityDataAccessor<Float> DATA_SPEED = SynchedEntityData.defineId(VehicleEntity.class, EntityDataSerializers.FLOAT);

	/** Действия из меню / клавиши F (пакет VehicleActionPayload). */
	public static final int ACT_ENTER = 0, ACT_ENGINE = 1, ACT_LOCK = 2, ACT_REPAIR = 3;

	private boolean fuelInit, hadDriver;
	private int gateMsgCooldown;
	private final java.util.Random rnd = new java.util.Random();

	// ---- состояние для клиента (HUD, меню)
	public boolean isEngineOn() { return entityData.get(DATA_ENGINE); }
	public float fuelValue() { return entityData.get(DATA_FUEL); }
	public boolean isBroken() { return entityData.get(DATA_BROKEN); }
	/** Внутренняя скорость физики (блоков/тик, со знаком). */
	public float syncedSpeed() { return entityData.get(DATA_SPEED); }
	public Access.Lock lockState() { int i = entityData.get(DATA_LOCK); Access.Lock[] v = Access.Lock.values(); return v[Math.max(0, Math.min(v.length - 1, i))]; }
	public boolean isLocked() { return lockState() != Access.Lock.OPEN; }

	private String ownerKey() { return owner == null ? null : owner.toString(); }

	public VehicleEntity(EntityType<?> type, Level level) {
		super(type, level);
	}

	/** Плавное движение на клиенте между пакетами позиции (как у лодок). */
	@Override
	protected net.minecraft.world.entity.InterpolationHandler createInterpolationHandler() {
		return net.minecraft.world.entity.LinearInterpolationHandler.create(this, 3);
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
		initFuel();

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

		if (driver != null && !hadDriver && com.rzauto.RzConfig.autoStartEngine && !vs.wear.broken && vs.fuel > 0) vs.engineOn = true;
		hadDriver = driver != null;
		DriveGate gate = DriveGate.check(vs, true, true);
		boolean canDrive = gate.canDrive();
		if (driver != null && !canDrive && gateMsgCooldown-- <= 0) { gateMsgCooldown = 40; if (gate.message != null) driver.sendSystemMessage(Component.literal(gate.message), true); }
		if (!canDrive) { x = 0; y = 0; }

		st.yawDeg = getYRot();
		double max = canDrive ? Physics.currentMax(s, vs.gears.speedPercent(s, vs.speedPercent), vs.wear.broken, vs.fuel, vs.engineOn) : s.topSpeed();
		if (vs.gta) Physics.tickGta(s, st, new Physics.Input(x, y), max);
		else Physics.tick(s, st, new Physics.Input(x, y), max, false, TURN_STRENGTH);
		if (canDrive && driver != null) {
			double d = Math.abs(st.speed);
			vs.fuel = Fuel.consume(s, vs.fuel, d, 1.0);
			Wear.track(s, vs.wear, d, 1.0, rnd);
			if (vs.fuel <= 0) { vs.engineOn = false; driver.sendSystemMessage(Component.literal(DriveGate.OUT_OF_FUEL_MSG), true); }
		}
		syncState();

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
		builder.define(DATA_ENGINE, false);
		builder.define(DATA_FUEL, 0f);
		builder.define(DATA_LOCK, (byte) 0);
		builder.define(DATA_BROKEN, false);
		builder.define(DATA_SPEED, 0f);
	}

	@Override
	protected void readAdditionalSaveData(ValueInput in) {
		String s = in.getStringOr("owner", "");
		try { owner = s.isEmpty() ? null : UUID.fromString(s); } catch (IllegalArgumentException e) { owner = null; }
		try {
			if (!in.getStringOr("fuel", "").isEmpty()) { vs.fuel = Double.parseDouble(in.getStringOr("fuel", "0")); fuelInit = true; }
			vs.engineOn = "1".equals(in.getStringOr("engine", "0"));
			vs.lock = Access.Lock.parse(in.getStringOr("lock", "open"), false);
			vs.wear.broken = "1".equals(in.getStringOr("broken", "0"));
			vs.wear.mileage = Double.parseDouble(in.getStringOr("mileage", "0"));
			vs.wear.checkedIndex = Integer.parseInt(in.getStringOr("mileage_idx", "-1"));
		} catch (NumberFormatException e) { /* оставляем значения по умолчанию */ }
	}

	@Override
	protected void addAdditionalSaveData(ValueOutput out) {
		if (owner != null) out.putString("owner", owner.toString());
		out.putString("fuel", Double.toString(vs.fuel));
		out.putString("engine", vs.engineOn ? "1" : "0");
		out.putString("lock", vs.lock.key);
		out.putString("broken", vs.wear.broken ? "1" : "0");
		out.putString("mileage", Double.toString(vs.wear.mileage));
		out.putString("mileage_idx", Integer.toString(vs.wear.checkedIndex));
	}

	@Override
	public boolean hurtServer(ServerLevel level, DamageSource source, float amount) {
		return false; // этап 1: машина неуязвима
	}

	@Override
	public boolean isPickable() { return !isRemoved(); }

	@Override
	protected boolean canAddPassenger(Entity passenger) {
		double[][] sd = spec() == null ? null : com.rzauto.logic.VehicleCatalog.seats(spec().bedrockId());
		return getPassengers().size() < Math.max(1, sd == null ? 2 : Math.min(sd.length, 4));
	}

	private void initFuel() {
		VehicleSpec s = spec();
		if (fuelInit || s == null) return;
		fuelInit = true;
		if (com.rzauto.RzConfig.startFullTank) vs.fuel = s.maxFuel();
		syncState();
	}

	private void syncState() {
		entityData.set(DATA_ENGINE, vs.engineOn);
		entityData.set(DATA_FUEL, (float) (Math.round(vs.fuel * 10) / 10.0));
		entityData.set(DATA_LOCK, (byte) vs.lock.ordinal());
		entityData.set(DATA_BROKEN, vs.wear.broken);
		entityData.set(DATA_SPEED, (float) (Math.round(st.speed * 50) / 50.0));
	}

	private static void msg(Player p, String text) { if (p instanceof ServerPlayer sp) sp.sendSystemMessage(Component.literal(text), true); }

	/** Посадка с проверкой замка. Владельцем становится первый севший. */
	private void tryEnter(Player player) {
		VehicleSpec sp0 = spec();
		if (sp0 == null) return;
		if (owner == null) owner = player.getUUID();
		boolean ownerAtWheel = !getPassengers().isEmpty() && getPassengers().get(0).getUUID().equals(owner);
		Access.Entry e = Access.canEnter(vs.lock, ownerKey(), player.getUUID().toString(), ownerAtWheel);
		if (e != Access.Entry.ALLOW) { msg(player, "§cМашина закрыта владельцем."); return; }
		if (player.startRiding(this)) {
			player.setYRot(getYRot());   // водитель смотрит вперёд по ходу машины
			player.setXRot(0);
			player.setYHeadRot(getYRot());
		}
	}

	/** Действие игрока из меню или клавиши F; вызывается на сервере. */
	public void handleAction(ServerPlayer p, int action) {
		initFuel();
		VehicleSpec s = spec();
		if (s == null || isRemoved()) return;
		if (p.getVehicle() != this && p.distanceToSqr(this) > 36) return;
		if (action == ACT_ENTER) { if (p.getVehicle() == null) tryEnter(p); return; }
		if (owner == null) owner = p.getUUID();
		if (!owner.equals(p.getUUID())) { msg(p, "§eМеню доступно только владельцу машины."); return; }
		switch (action) {
			case ACT_ENGINE -> {
				if (vs.engineOn) vs.engineOn = false;
				else if (vs.wear.broken) msg(p, DriveGate.BROKEN.message);
				else if (!(vs.fuel > 0)) msg(p, DriveGate.NO_FUEL.message);
				else vs.engineOn = true;
			}
			case ACT_LOCK -> vs.lock = vs.lock == Access.Lock.OPEN ? Access.Lock.LOCKED : Access.Lock.OPEN;
			case ACT_REPAIR -> { if (vs.wear.broken) { Wear.replaceGear(vs.wear); msg(p, "§aМашина отремонтирована."); } }
			default -> { }
		}
		syncState();
	}

	@Override
	public InteractionResult interact(Player player, InteractionHand hand, Vec3 hit) {
		if (player.isSecondaryUseActive()) return InteractionResult.PASS;
		if (!level().isClientSide()) {
			initFuel();
			ItemStack held = player.getItemInHand(hand);
			VehicleSpec s = spec();
			if (s != null && held.is(Items.LAVA_BUCKET)) {
				if (vs.fuel >= s.maxFuel()) { msg(player, "§eБак полон."); return InteractionResult.SUCCESS; }
				vs.fuel = Fuel.addBucket(s, vs.fuel);
				if (!player.isCreative()) { held.shrink(1); ItemStack b = new ItemStack(Items.BUCKET); if (held.isEmpty()) player.setItemInHand(hand, b); else player.getInventory().add(b); }
				syncState();
				msg(player, "§6Заправлено: лава в бак.");
				return InteractionResult.SUCCESS;
			}
			tryEnter(player);
		}
		return InteractionResult.SUCCESS;
	}
}
