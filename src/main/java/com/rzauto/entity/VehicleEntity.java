package com.rzauto.entity;

import java.util.UUID;
import net.minecraft.network.syncher.SynchedEntityData;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.storage.ValueInput;
import net.minecraft.world.level.storage.ValueOutput;
import net.minecraft.world.phys.Vec3;

/**
 * Машина. Этап 1: пустая сущность (стоит, на неё можно сесть).
 * Физика (com.rzauto.logic.Physics) и сеть (com.rzauto.perf.NetSync) подключаются на этапе 2.
 * Пока машина не тикает сама: спящая машина не нагружает сервер.
 */
public class VehicleEntity extends Entity {
	/** Владелец (тот, кто поставил машину). null, пока не задан. */
	private UUID owner;

	public VehicleEntity(EntityType<?> type, Level level) {
		super(type, level);
	}

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
			player.startRiding(this);
		}
		return InteractionResult.SUCCESS;
	}
}
