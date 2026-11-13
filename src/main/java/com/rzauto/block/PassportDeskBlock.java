package com.rzauto.block;

import net.minecraft.core.BlockPos;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;

/** Паспортный стол: ПКМ открывает на клиенте экран настройки паспорта (страна, герб) и отправки нарушений. */
public class PassportDeskBlock extends Block {
	public static java.util.function.Consumer<BlockPos> CLIENT_OPEN;

	public PassportDeskBlock(BlockBehaviour.Properties p) { super(p); }

	@Override
	protected InteractionResult useWithoutItem(BlockState state, Level level, BlockPos pos, Player player, BlockHitResult hit) {
		if (level.isClientSide() && CLIENT_OPEN != null) CLIENT_OPEN.accept(pos);
		return InteractionResult.SUCCESS;
	}
}
