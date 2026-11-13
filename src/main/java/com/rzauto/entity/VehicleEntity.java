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
import net.minecraft.world.entity.EntityDimensions;
import net.minecraft.tags.DamageTypeTags;
import com.rzauto.logic.VehicleCatalog;

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
	public static final EntityDataAccessor<String> DATA_OWNER_NAME = SynchedEntityData.defineId(VehicleEntity.class, EntityDataSerializers.STRING);
	public static final EntityDataAccessor<String> DATA_OWNER = SynchedEntityData.defineId(VehicleEntity.class, EntityDataSerializers.STRING);
	public static final EntityDataAccessor<Boolean> DATA_LIGHTS = SynchedEntityData.defineId(VehicleEntity.class, EntityDataSerializers.BOOLEAN);
	public static final EntityDataAccessor<Boolean> DATA_SIREN = SynchedEntityData.defineId(VehicleEntity.class, EntityDataSerializers.BOOLEAN);
	public static final EntityDataAccessor<Boolean> DATA_GEARS = SynchedEntityData.defineId(VehicleEntity.class, EntityDataSerializers.BOOLEAN);
	public static final EntityDataAccessor<Float> DATA_SENS = SynchedEntityData.defineId(VehicleEntity.class, EntityDataSerializers.FLOAT);
	public static final EntityDataAccessor<Float> DATA_HP = SynchedEntityData.defineId(VehicleEntity.class, EntityDataSerializers.FLOAT);
	/** Номера мест пассажиров по порядку в списке (4 бита на каждого, 15 = не задано). */
	public static final EntityDataAccessor<Integer> DATA_SEATS = SynchedEntityData.defineId(VehicleEntity.class, EntityDataSerializers.INT);

	/** Действия из меню / клавиши F (пакет VehicleActionPayload). */
	public static final int ACT_ENTER = 0, ACT_ENGINE = 1, ACT_LOCK = 2, ACT_REPAIR = 3, ACT_LIGHTS = 4, ACT_SIREN = 5, ACT_SEAT = 6, ACT_SENS_DOWN = 7, ACT_SENS_UP = 8, ACT_GEARS = 9, ACT_EXIT = 10, ACT_ROOF = 11;
	public static final EntityDataAccessor<Boolean> DATA_ROOF = SynchedEntityData.defineId(VehicleEntity.class, EntityDataSerializers.BOOLEAN);
	private boolean roof = true;
	public boolean roofOn() { return entityData.get(DATA_ROOF); }
	public static final double SPEED_SCALE = 1.0 / 1.5, OFFROAD_MULT = 0.6;
	private int lastHitTick = -1000;
	public static final float SENS_MIN = 0.6f, SENS_MAX = 3.0f, SENS_STEP = 0.2f, SENS_DEFAULT = 1.4f;

	private boolean fuelInit, hadDriver, lastSprint, lastSneak;
	private float hp = -1f, sens = SENS_DEFAULT;
	private boolean lights = true, siren;
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

	public boolean lightsOn() { return entityData.get(DATA_LIGHTS); }
	public boolean sirenOn() { return entityData.get(DATA_SIREN); }
	public boolean gearsOn() { return entityData.get(DATA_GEARS); }
	public float sensValue() { return entityData.get(DATA_SENS); }
	public float hpValue() { return entityData.get(DATA_HP); }
	/** Владелец ещё не задан (машина «ничья»)? */
	public boolean isUnclaimed() { return entityData.get(DATA_OWNER).isEmpty(); }
	public boolean isOwnedBy(UUID id) { return id != null && entityData.get(DATA_OWNER).equals(id.toString()); }

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
		return s != null ? Math.min(1.0f, (float) s.stepHeight()) : 0.6f;
	}

	/** Сервер авторитетен: клиент водителя не симулирует машину. */
	@Override
	public LivingEntity getControllingPassenger() { return null; }


	// ---- места: номер места пассажира хранится в синхронизированном int (на клиенте и сервере одинаково)
	private int seatCount() {
		double[][] sd = spec() == null ? null : VehicleCatalog.seats(spec().bedrockId());
		return Math.max(1, sd == null ? 2 : Math.min(sd.length, 4));
	}
	private int seatAt(int idx) {
		if (idx < 0 || idx > 7) return idx;
		int v = (entityData.get(DATA_SEATS) >> (4 * idx)) & 15;
		return v == 15 ? idx : v;
	}
	private void setSeatAt(int idx, int seat) {
		if (idx < 0 || idx > 7) return;
		int m = entityData.get(DATA_SEATS);
		m = (m & ~(15 << (4 * idx))) | ((seat & 15) << (4 * idx));
		entityData.set(DATA_SEATS, m);
	}
	/** Водитель = пассажир на месте 0. */
	private Entity driverEntity() {
		java.util.List<Entity> ps = getPassengers();
		for (int i = 0; i < ps.size(); i++) if (seatAt(i) == 0) return ps.get(i);
		return null;
	}
	public int seatOf(Entity e) { return seatAt(getPassengers().indexOf(e)); }

	@Override
	protected void addPassenger(Entity p) {
		super.addPassenger(p);
		if (level().isClientSide()) return;
		java.util.List<Entity> ps = getPassengers();
		int idx = ps.indexOf(p);
		boolean[] used = new boolean[16];
		for (int i = 0; i < ps.size(); i++) if (i != idx) used[seatAt(i)] = true;
		int seat = 0;
		while (seat < 15 && used[seat]) seat++;
		setSeatAt(idx, seat);
	}

	@Override
	protected void removePassenger(Entity p) {
		int idx = getPassengers().indexOf(p);
		super.removePassenger(p);
		if (level().isClientSide() || idx < 0) return;
		int n = getPassengers().size();
		for (int i = idx; i < n; i++) setSeatAt(i, seatAt(i + 1));
		setSeatAt(n, 15);
	}

	private float tiltPitch, tiltDy;
	/** Сглаженный наклон и просадка кузова по рельефу (одинаково на сервере и клиенте): по ним смещаются сиденья. */
	private void tiltTick() {
		VehicleSpec sp = spec();
		if (sp == null || getPassengers().isEmpty()) { tiltPitch *= 0.8f; tiltDy *= 0.8f; return; }
		double[] dm = VehicleCatalog.dims(sp.bedrockId());
		double halfL = dm == null ? 1.3 : Math.max(0.5, dm[1] * 0.33);
		float[] t = Terrain.pitchAndDy(level(), getX(), getY(), getZ(), getYRot(), halfL);
		tiltPitch += (t[0] - tiltPitch) * 0.3f;
		tiltDy += (t[1] - tiltDy) * 0.3f;
	}

	/** Клиентский рендер отдаёт сюда реальные тангаж и крен кузова {pitch, roll} (градусы), чтобы сиденье шло ровно за нарисованным кузовом. */
	public static java.util.function.Function<VehicleEntity, float[]> CLIENT_POSE;

	@Override
	protected Vec3 getPassengerAttachmentPoint(Entity passenger, EntityDimensions dims, float scale) {
		double[][] sd = spec() == null ? null : VehicleCatalog.seats(spec().bedrockId());
		if (sd == null || sd.length == 0) return super.getPassengerAttachmentPoint(passenger, dims, scale);
		int seat = Math.max(0, Math.min(sd.length - 1, seatOf(passenger)));
		double k = com.rzauto.RzConfig.renderScale;
		double sx = sd[seat][0] * k, sy = sd[seat][1] * k + com.rzauto.RzConfig.seatYOffset, sz = sd[seat][2] * k;
		float pitch = tiltPitch, roll = 0f;
		if (level().isClientSide() && CLIENT_POSE != null) {
			float[] c = CLIENT_POSE.apply(this);
			if (c != null) { pitch = c[0]; roll = c[1]; }
		}
		// та же матрица, что у кузова в рендере: поворот вокруг оси (0; 0,4) по тангажу (X), затем крену (Z); просадки кузова нет, поэтому и у сиденья её нет
		double th = Math.toRadians(pitch), rl = Math.toRadians(roll);
		double x0 = sx, y0 = sy - 0.4, z0 = sz;
		double x1 = x0 * Math.cos(rl) - y0 * Math.sin(rl), y1 = x0 * Math.sin(rl) + y0 * Math.cos(rl);
		double y2 = y1 * Math.cos(th) - z0 * Math.sin(th), z2 = y1 * Math.sin(th) + z0 * Math.cos(th);
		Vec3 v = new Vec3(x1, y2 + 0.4, z2);
		return v.yRot((float) (-getYRot() * Math.PI / 180.0));
	}

	/** Сменить место: ближайшее свободное по кругу. */
	private void changeSeat(ServerPlayer p) {
		int idx = getPassengers().indexOf(p), n = seatCount();
		if (idx < 0) return;
		boolean[] used = new boolean[16];
		for (int i = 0; i < getPassengers().size(); i++) if (i != idx) used[seatAt(i)] = true;
		int cur = seatAt(idx);
		for (int d = 1; d < n; d++) {
			int c = (cur + d) % n;
			if (!used[c]) { setSeatAt(idx, c); msg(p, c == 0 ? "§aМесто водителя." : "§aПассажирское место " + c + "."); return; }
		}
		msg(p, "§eСвободных мест нет.");
	}

	@Override
	public void tick() {
		super.tick();
		tiltTick();
		if (level().isClientSide()) return;
		VehicleSpec s = spec();
		if (s == null) return;
		initFuel();
		if (owner != null && tickCount % 40 == 0 && (ownerName.isEmpty() || !ownerName.equals(entityData.get(DATA_OWNER_NAME)))) refreshOwnerName();
		if (hp >= 0 && hp < maxHp() && tickCount - lastHitTick > 100 && tickCount % 10 == 0) { hp = Math.min(maxHp(), hp + maxHp() * 0.01f); syncState(); }

		ServerPlayer driver = null;
		if (driverEntity() instanceof ServerPlayer p) driver = p;

		double x = 0, y = 0;
		if (driver != null) {
			Input in = driver.getLastClientInput();
			x = (in.left() ? 1 : 0) - (in.right() ? 1 : 0);   // как в Bedrock: влево = +1
			y = (in.forward() ? 1 : 0) - (in.backward() ? 1 : 0);
			// Передачи (если включены в меню): Shift — выше, Ctrl — ниже
			if (vs.gears.mode) {
				if (in.shift() && !lastSneak) shiftGear(driver, s, +1);
				if (in.sprint() && !lastSprint) shiftGear(driver, s, -1);
			}
			lastSprint = in.sprint(); lastSneak = in.shift();
		}
		String m7 = vs.gears.tick7(s, driver != null);
		if (m7 != null && driver != null) driver.sendSystemMessage(Component.literal(m7), true);
		// Спящая машина: пусто, стоит, на земле, нет скорости → ничего не считаем.
		if (driver == null && onGround() && st.speed == 0 && st.lat == 0) return;

		if (driver != null && !hadDriver && com.rzauto.RzConfig.autoStartEngine && !vs.wear.broken && vs.fuel > 0) vs.engineOn = true;
		hadDriver = driver != null;
		DriveGate gate = DriveGate.check(vs, true, !com.rzauto.RzConfig.requireLicense || (driver != null && holdsLicense(driver)));
		boolean canDrive = gate.canDrive();
		if (driver != null && !canDrive && gateMsgCooldown-- <= 0) { gateMsgCooldown = 40; if (gate.message != null) driver.sendSystemMessage(Component.literal(gate.message), true); }
		if (!canDrive) { x = 0; y = 0; }

		st.yawDeg = getYRot();
		double max = canDrive ? Physics.currentMax(s, vs.gears.speedPercent(s, vs.speedPercent), vs.wear.broken, vs.fuel, vs.engineOn) : s.topSpeed();
		max *= SPEED_SCALE;   // скорость Bedrock делим на 1.5
		if (isInWater()) max *= 0.1;   // по воде только 10% скорости
		if (!(s.offroadExempt() || s.hasSiren() || s.bedrockId().startsWith("jeep:"))) {
			var fx = com.rzauto.logic.Surface.effect(net.minecraft.core.registries.BuiltInRegistries.BLOCK.getKey(level().getBlockState(blockPosition().below()).getBlock()).getPath());
			if (fx != null) max *= OFFROAD_MULT;   // земля, песок, грязь: -40% (джипы и полиция не страдают)
		}
		if (vs.gta) Physics.tickGta(s, st, new Physics.Input(x, y), max, sens);
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
		if (horizontalCollision) {
			double av = Math.abs(st.speed);
			// урон только от сильного лобового удара; скольжение боком и полублоки на поворотах не считаются
			if (av > 1.3 && Math.abs(st.speed) > 1.3) damage((float) ((av - 1.3) * 2.0));
			st.speed = Physics.collisionBleed(st.speed, max);
		}
		setYRot((float) st.yawDeg);
	}

	/** Только для тестов CI. */
	public void debugSetSpeed(double v) { st.speed = v; }
	public double debugSpeed() { return st.speed; }


	private boolean holdsLicense(Player p) {
		return VehicleRegistry.LICENSE != null && (p.getMainHandItem().is(VehicleRegistry.LICENSE) || p.getOffhandItem().is(VehicleRegistry.LICENSE));
	}

	private void shiftGear(ServerPlayer driver, VehicleSpec s, int dir) {
		com.rzauto.logic.GearBox.Shift r = vs.gears.shift(s, dir);
		if (r.hud() != null) driver.sendSystemMessage(Component.literal(r.hud()), true);
	}

	private float maxHp() { VehicleSpec s = spec(); return s == null ? 20f : Math.max(1f, s.health()); }

	/** Урон машине: на нуле она ломается (чинится шестерёнкой), окончательно — только рукой или взрывом. */
	private void damage(float amount) {
		if (level().isClientSide() || amount <= 0 || vs.wear.broken) return;
		if (hp < 0) hp = maxHp();
		hp = Math.max(0f, hp - amount);
		if (hp <= 0f) { vs.wear.broken = true; vs.engineOn = false; }
		syncState();
	}

	/** Падение: урон машине (3 блока бесплатно, дальше 1.5 за блок). */
	@Override
	public boolean causeFallDamage(double distance, float multiplier, DamageSource source) {
		if (!level().isClientSide() && distance > 6) damage((float) ((distance - 6) * 0.5));
		return false;
	}

	@Override
	public boolean canBeCollidedWith(Entity other) { return false; }

	private void destroy(boolean drop) {
		if (level() instanceof ServerLevel sl) {
			if (drop) { net.minecraft.world.item.Item it = VehicleRegistry.itemOf(getType()); if (it != null) spawnAtLocation(sl, new ItemStack(it)); }
			ejectPassengers();
			discard();
		}
	}

	/** Починка шестерёнкой: берём из руки/инвентаря. */
	private boolean repairWithGear(ServerPlayer p) {
		if (!vs.wear.broken && (hp < 0 || hp >= maxHp() - 0.01f)) { msg(p, "§eМашина исправна."); return false; }
		ItemStack found = ItemStack.EMPTY;
		if (!p.isCreative()) {
			for (int i = 0; i < p.getInventory().getContainerSize(); i++) {
				ItemStack st0 = p.getInventory().getItem(i);
				if (st0.is(VehicleRegistry.GEAR)) { found = st0; break; }
			}
			if (found.isEmpty()) { msg(p, "§cНужна шестерёнка в инвентаре."); return false; }
			found.shrink(1);
		}
		Wear.replaceGear(vs.wear);
		vs.gears.unlockGear7();
		hp = maxHp();
		syncState();
		msg(p, "§aМашина отремонтирована.");
		return true;
	}

	public UUID getOwner() { return owner; }
	private String ownerName = "";
	public String ownerNick() { return entityData.get(DATA_OWNER_NAME); }
	private void refreshOwnerName() {
		if (owner == null) { ownerName = ""; }
		else { var pl = level().getPlayerByUUID(owner); if (pl != null) ownerName = pl.getName().getString(); }
		entityData.set(DATA_OWNER_NAME, ownerName);
	}
	public void setOwner(UUID owner) { this.owner = owner; if (!level().isClientSide()) { entityData.set(DATA_OWNER, owner == null ? "" : owner.toString()); refreshOwnerName(); } }

	@Override
	protected void defineSynchedData(SynchedEntityData.Builder builder) {
		builder.define(DATA_ENGINE, false);
		builder.define(DATA_FUEL, 0f);
		builder.define(DATA_LOCK, (byte) 0);
		builder.define(DATA_BROKEN, false);
		builder.define(DATA_SPEED, 0f);
		builder.define(DATA_OWNER, "");
		builder.define(DATA_OWNER_NAME, "");
		builder.define(DATA_LIGHTS, true);
		builder.define(DATA_ROOF, true);
		builder.define(DATA_SIREN, false);
		builder.define(DATA_GEARS, false);
		builder.define(DATA_SENS, SENS_DEFAULT);
		builder.define(DATA_HP, 20f);
		builder.define(DATA_SEATS, -1);
	}

	@Override
	protected void readAdditionalSaveData(ValueInput in) {
		String s = in.getStringOr("owner", "");
		try { owner = s.isEmpty() ? null : UUID.fromString(s); } catch (IllegalArgumentException e) { owner = null; }
		ownerName = in.getStringOr("owner_name", "");
		try {
			if (!in.getStringOr("fuel", "").isEmpty()) { vs.fuel = Double.parseDouble(in.getStringOr("fuel", "0")); fuelInit = true; }
			vs.engineOn = "1".equals(in.getStringOr("engine", "0"));
			vs.lock = Access.Lock.parse(in.getStringOr("lock", "open"), false);
			vs.wear.broken = "1".equals(in.getStringOr("broken", "0"));
			vs.wear.mileage = Double.parseDouble(in.getStringOr("mileage", "0"));
			vs.wear.checkedIndex = Integer.parseInt(in.getStringOr("mileage_idx", "-1"));
			hp = Float.parseFloat(in.getStringOr("hp", "-1"));
			sens = Float.parseFloat(in.getStringOr("sens", Float.toString(SENS_DEFAULT)));
			lights = !"0".equals(in.getStringOr("lights", "1"));
			roof = !"0".equals(in.getStringOr("roof", "1"));
			vs.gears.mode = "1".equals(in.getStringOr("gears", "0"));
		} catch (NumberFormatException e) { /* оставляем значения по умолчанию */ }
	}

	@Override
	protected void addAdditionalSaveData(ValueOutput out) {
		if (owner != null) out.putString("owner", owner.toString());
		if (!ownerName.isEmpty()) out.putString("owner_name", ownerName);
		out.putString("fuel", Double.toString(vs.fuel));
		out.putString("engine", vs.engineOn ? "1" : "0");
		out.putString("lock", vs.lock.key);
		out.putString("broken", vs.wear.broken ? "1" : "0");
		out.putString("mileage", Double.toString(vs.wear.mileage));
		out.putString("mileage_idx", Integer.toString(vs.wear.checkedIndex));
		out.putString("hp", Float.toString(hp));
		out.putString("sens", Float.toString(sens));
		out.putString("lights", lights ? "1" : "0");
		out.putString("roof", roof ? "1" : "0");
		out.putString("gears", vs.gears.mode ? "1" : "0");
	}

	@Override
	public boolean hurtServer(ServerLevel level, DamageSource source, float amount) {
		if (source.is(DamageTypeTags.IS_EXPLOSION)) { destroy(true); return true; }
		// Кулак (пустая рука): как удар по мобу, снимает часть HP; на нуле машина разбивается. Машина сама регенерирует HP.
		if (source.getEntity() instanceof Player p && source.getDirectEntity() == p && p.getMainHandItem().isEmpty()) {
			if (hp < 0) hp = maxHp();
			lastHitTick = tickCount;
			hp -= Math.max(1f, amount) * 1.5f;
			if (hp <= 0f) { destroy(!p.isCreative()); return true; }
			syncState();
			level.playSound(null, getX(), getY(), getZ(), net.minecraft.sounds.SoundEvents.ANVIL_LAND, net.minecraft.sounds.SoundSource.NEUTRAL, 0.4f, 1.6f);
			return true;
		}
		return false;
	}

	@Override
	public boolean isPickable() { return !isRemoved(); }

	@Override
	protected boolean canAddPassenger(Entity passenger) {
		return getPassengers().size() < seatCount();
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
		entityData.set(DATA_LIGHTS, lights);
		entityData.set(DATA_ROOF, roof);
		entityData.set(DATA_SIREN, siren);
		entityData.set(DATA_GEARS, vs.gears.mode);
		entityData.set(DATA_SENS, sens);
		entityData.set(DATA_HP, hp < 0 ? maxHp() : hp);
		entityData.set(DATA_OWNER, owner == null ? "" : owner.toString());
		entityData.set(DATA_SPEED, (float) (Math.round(st.speed * 50) / 50.0));
	}

	private static void msg(Player p, String text) { if (p instanceof ServerPlayer sp) sp.sendSystemMessage(Component.literal(text), true); }

	/** Посадка с проверкой замка. Владельцем становится первый севший. */
	private void tryEnter(Player player) {
		VehicleSpec sp0 = spec();
		if (sp0 == null) return;
		if (owner == null) setOwner(player.getUUID());
		Entity dr0 = driverEntity();
		boolean ownerAtWheel = dr0 != null && dr0.getUUID().equals(owner);
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
		boolean rider = p.getVehicle() == this;
		if (action == ACT_EXIT && rider) { p.stopRiding(); return; }
		if (action == ACT_LIGHTS && rider) { lights = !lights; syncState(); return; }
		if (action == ACT_SIREN && rider) { if (s.hasSiren()) siren = !siren; syncState(); return; }
		if (action == ACT_SEAT && rider) { changeSeat(p); return; }
		if (action == ACT_ROOF && isOwnedBy(p.getUUID()) && s.bedrockId().startsWith("jeep:yj")) { roof = !roof; syncState(); return; }
		if (owner == null) setOwner(p.getUUID());
		if (!owner.equals(p.getUUID())) { msg(p, "§eМеню доступно только владельцу машины."); return; }
		switch (action) {
			case ACT_ENGINE -> {
				if (vs.engineOn) vs.engineOn = false;
				else if (vs.wear.broken) msg(p, DriveGate.BROKEN.message);
				else if (!(vs.fuel > 0)) msg(p, DriveGate.NO_FUEL.message);
				else vs.engineOn = true;
			}
			case ACT_LOCK -> vs.lock = vs.lock == Access.Lock.OPEN ? Access.Lock.LOCKED : Access.Lock.OPEN;
			case ACT_REPAIR -> repairWithGear(p);
			case ACT_SENS_DOWN -> sens = Math.max(SENS_MIN, Math.round((sens - SENS_STEP) * 10f) / 10f);
			case ACT_SENS_UP -> sens = Math.min(SENS_MAX, Math.round((sens + SENS_STEP) * 10f) / 10f);
			case ACT_GEARS -> vs.gears.mode = !vs.gears.mode;
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
			if (s != null && held.is(VehicleRegistry.GEAR) && player instanceof ServerPlayer sp0) { repairWithGear(sp0); return InteractionResult.SUCCESS; }
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
