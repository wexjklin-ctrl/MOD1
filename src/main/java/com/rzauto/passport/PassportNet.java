package com.rzauto.passport;

import com.rzauto.VehicleRegistry;
import com.rzauto.item.Passport;
import com.rzauto.net.*;
import java.util.UUID;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.Container;
import net.minecraft.world.item.ItemStack;

/** Сеть паспортной системы: запрос данных паспорта, правки на паспортном столе, отправка нарушений. */
public final class PassportNet {
	private PassportNet() {}
	private static int ticks;

	public static void register() {
		PayloadTypeRegistry.serverboundPlay().register(PassportRequestPayload.TYPE, PassportRequestPayload.CODEC);
		PayloadTypeRegistry.serverboundPlay().register(DeskEditPayload.TYPE, DeskEditPayload.CODEC);
		PayloadTypeRegistry.serverboundPlay().register(DeskViolationPayload.TYPE, DeskViolationPayload.CODEC);
		PayloadTypeRegistry.clientboundPlay().register(PassportInfoPayload.TYPE, PassportInfoPayload.CODEC);
		ServerPlayNetworking.registerGlobalReceiver(PassportRequestPayload.TYPE, (pl, ctx) -> request(ctx.player(), pl));
		ServerPlayNetworking.registerGlobalReceiver(DeskEditPayload.TYPE, (pl, ctx) -> edit(ctx.player(), pl));
		ServerPlayNetworking.registerGlobalReceiver(DeskViolationPayload.TYPE, (pl, ctx) -> violation(ctx.server(), ctx.player(), pl));
		ServerLifecycleEvents.SERVER_STARTED.register(s -> PassportStore.load());
		ServerLifecycleEvents.SERVER_STOPPING.register(s -> PassportStore.save());
		ServerTickEvents.END_SERVER_TICK.register(s -> {
			ticks++;
			if (ticks % 200 == 0) for (ServerPlayer p : s.getPlayerList().getPlayers()) PassportStore.rememberName(p.getUUID(), p.getName().getString());
			if (ticks % 6000 == 0) PassportStore.saveIfDirty();
		});
	}

	private static void say(ServerPlayer p, String text) { p.sendSystemMessage(Component.literal(text), true); }

	private static boolean nearDesk(ServerPlayer p, long posL) {
		BlockPos pos = BlockPos.of(posL);
		return p.distanceToSqr(pos.getX() + 0.5, pos.getY() + 0.5, pos.getZ() + 0.5) <= 64 && p.level().getBlockState(pos).is(VehicleRegistry.PASSPORT_DESK);
	}

	private static boolean own(ItemStack st, ServerPlayer p) {
		return Passport.signed(st) && Passport.ownerUuid(st).equals(p.getUUID().toString());
	}

	private static void request(ServerPlayer p, PassportRequestPayload pl) {
		UUID id;
		try { id = UUID.fromString(pl.uuid()); } catch (IllegalArgumentException e) { return; }
		ServerPlayNetworking.send(p, new PassportInfoPayload(pl.uuid(), PassportStore.encodeViolations(id), PassportStore.encodeCars(id)));
	}

	private static void edit(ServerPlayer p, DeskEditPayload pl) {
		if (!nearDesk(p, pl.pos())) return;
		String country = Passport.clean(pl.country(), 32);
		if (country.isEmpty()) country = Passport.DEFAULT_COUNTRY;
		Container inv = p.getInventory();
		int n = 0;
		for (int i = 0; i < inv.getContainerSize(); i++) {
			ItemStack st = inv.getItem(i);
			if (!own(st, p)) continue;
			Passport.setCountry(st, country);
			Passport.setSeal(st, pl.seal());
			n++;
		}
		if (n == 0) { say(p, "§cНужен ваш подписанный паспорт в инвентаре."); return; }
		inv.setChanged();
		PassportStore.rememberName(p.getUUID(), p.getName().getString());
		say(p, "§aПаспорт обновлён: " + country);
	}

	private static void violation(MinecraftServer server, ServerPlayer p, DeskViolationPayload pl) {
		if (!nearDesk(p, pl.pos())) return;
		Container inv = p.getInventory();
		ItemStack mine = ItemStack.EMPTY;
		for (int i = 0; i < inv.getContainerSize() && mine.isEmpty(); i++) if (own(inv.getItem(i), p)) mine = inv.getItem(i);
		if (mine.isEmpty()) { say(p, "§cНужен ваш подписанный паспорт в инвентаре."); return; }
		String name = Passport.clean(pl.target(), 32), text = Passport.clean(pl.text(), 80);
		if (name.isEmpty() || text.isEmpty()) { say(p, "§cУкажите игрока и текст нарушения."); return; }
		UUID tu = null;
		ServerPlayer online = null;
		for (ServerPlayer o : server.getPlayerList().getPlayers()) {
			if (o.getName().getString().equalsIgnoreCase(name)) { online = o; tu = o.getUUID(); break; }
		}
		if (tu == null) tu = PassportStore.byName(name);
		if (tu == null) { say(p, "§cИгрок не найден: " + name); return; }
		PassportStore.addViolation(tu, new PassportStore.Violation(text, Passport.today(), Passport.country(mine), Passport.sealIndex(mine), p.getName().getString()));
		if (online != null) online.sendSystemMessage(Component.literal("§cВам выписано нарушение: " + text), false);
		say(p, "§aНарушение отправлено: " + name);
	}
}
