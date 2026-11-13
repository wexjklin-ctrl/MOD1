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
	/** Ник владельца паспорта из руки игрока: стол открывается сразу на его данных (клиентская сторона). */
	public static String PREFILL = "";

	public PassportDeskBlock(BlockBehaviour.Properties p) { super(p); }

	@Override
	protected InteractionResult useWithoutItem(BlockState state, Level level, BlockPos pos, Player player, BlockHitResult hit) {
		if (level.isClientSide() && CLIENT_OPEN != null) {
			PREFILL = "";
			for (net.minecraft.world.InteractionHand h : net.minecraft.world.InteractionHand.values()) {
				net.minecraft.world.item.ItemStack st = player.getItemInHand(h);
				if (com.rzauto.item.Passport.isDoc(st) && com.rzauto.item.Passport.signed(st)) { PREFILL = com.rzauto.item.Passport.ownerName(st); break; }
			}
			CLIENT_OPEN.accept(pos);
		}
		return InteractionResult.SUCCESS;
	}
}
