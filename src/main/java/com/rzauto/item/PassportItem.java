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

	private static void say(Player p, String text) {
		if (p instanceof net.minecraft.server.level.ServerPlayer sp) sp.sendSystemMessage(Component.literal(text), true);
	}

	@Override
	public InteractionResult use(Level level, Player player, InteractionHand hand) {
		ItemStack st0 = player.getItemInHand(hand);
		if (!player.isShiftKeyDown()) {
			// ПКМ по своему подписанному паспорту: сменить печать
			if (Passport.signed(st0) && Passport.ownerUuid(st0).equals(player.getUUID().toString())) {
				if (level.isClientSide()) return InteractionResult.SUCCESS;
				int n = Passport.nextSeal(st0);
				say(player, "§aПечать: " + Passport.SEAL_NAMES[n]);
				return InteractionResult.SUCCESS;
			}
			return InteractionResult.PASS;
		}
		if (level.isClientSide()) return InteractionResult.SUCCESS;
		ItemStack st = st0;
		if (Passport.signed(st)) {
			say(player, "§eДокумент уже принадлежит: " + Passport.ownerName(st));
			return InteractionResult.SUCCESS;
		}
		ItemStack one = st.getCount() > 1 ? st.split(1) : st;
		Passport.sign(one, player);
		if (one != st && !player.getInventory().add(one) && level instanceof ServerLevel sl) player.spawnAtLocation(sl, one);
		say(player, "§aДокумент подписан: " + player.getName().getString());
		return InteractionResult.SUCCESS;
	}
}
