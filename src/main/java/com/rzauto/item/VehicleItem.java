package com.rzauto.item;

import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.context.UseOnContext;
import com.rzauto.entity.VehicleEntity;

/** Предмет-ключ: ПКМ по земле ставит машину, владелец = игрок. */
public class VehicleItem extends Item {
	private final EntityType<? extends VehicleEntity> type;

	public VehicleItem(Properties props, EntityType<? extends VehicleEntity> type) {
		super(props);
		this.type = type;
	}

	@Override
	public InteractionResult useOn(UseOnContext ctx) {
		if (!(ctx.getLevel() instanceof ServerLevel level)) return InteractionResult.SUCCESS;
		Player player = ctx.getPlayer();
		BlockPos pos = ctx.getClickedPos().relative(ctx.getClickedFace());
		VehicleEntity e = type.spawn(level, ctx.getItemInHand(), player, pos, EntitySpawnReason.SPAWN_ITEM_USE, true, false);
		if (e == null) return InteractionResult.FAIL;
		if (player != null) e.setOwner(player.getUUID());
		ctx.getItemInHand().shrink(1);
		return InteractionResult.SUCCESS;
	}
}
