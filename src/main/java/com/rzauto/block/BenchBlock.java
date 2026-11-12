package com.rzauto.block;

import net.minecraft.core.BlockPos;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;

/** Верстак: ПКМ открывает на клиенте экран крафта машин (рецепты из оригинального аддона). */
public class BenchBlock extends Block {
	/** Ставится клиентом: открыть экран верстака. */
	public static java.util.function.Consumer<BlockPos> CLIENT_OPEN;

	public BenchBlock(BlockBehaviour.Properties p) { super(p); }

	@Override
	protected InteractionResult useWithoutItem(BlockState state, Level level, BlockPos pos, Player player, BlockHitResult hit) {
		if (level.isClientSide() && CLIENT_OPEN != null) CLIENT_OPEN.accept(pos);
		return InteractionResult.SUCCESS;
	}
}
