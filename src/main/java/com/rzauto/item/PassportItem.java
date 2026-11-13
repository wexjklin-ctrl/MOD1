package com.rzauto.item;

import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;

/** Паспорт: после крафта пустой; с приседанием + ПКМ записывается ник игрока и документ присваивается ему. */
public class PassportItem extends Item {
	public PassportItem(Properties props) { super(props); }

	@Override
	public InteractionResult use(Level level, Player player, InteractionHand hand) {
		if (!player.isShiftKeyDown()) return InteractionResult.PASS;
		if (level.isClientSide()) return InteractionResult.SUCCESS;
		ItemStack st = player.getItemInHand(hand);
		if (Passport.signed(st)) {
			player.sendSystemMessage(Component.literal("§eДокумент уже принадлежит: " + Passport.ownerName(st)), true);
			return InteractionResult.SUCCESS;
		}
		ItemStack one = st.getCount() > 1 ? st.split(1) : st;
		Passport.sign(one, player);
		if (one != st && !player.getInventory().add(one) && level instanceof ServerLevel sl) player.spawnAtLocation(sl, one);
		player.sendSystemMessage(Component.literal("§aДокумент подписан: " + player.getName().getString()), true);
		return InteractionResult.SUCCESS;
	}
}
