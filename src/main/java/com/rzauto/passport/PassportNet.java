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
import net.minecraft.server.permissions.Permissions;
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
		PayloadTypeRegistry.serverboundPlay().register(DeskActionPayload.TYPE, DeskActionPayload.CODEC);
		PayloadTypeRegistry.clientboundPlay().register(PassportInfoPayload.TYPE, PassportInfoPayload.CODEC);
		PayloadTypeRegistry.clientboundPlay().register(DeskDataPayload.TYPE, DeskDataPayload.CODEC);
		ServerPlayNetworking.registerGlobalReceiver(DeskActionPayload.TYPE, (pl, ctx) -> action(ctx.server(), ctx.player(), pl));
		ServerPlayNetworking.registerGlobalReceiver(PassportRequestPayload.TYPE, (pl, ctx) -> request(ctx.player(), pl));
		ServerPlayNetworking.registerGlobalReceiver(DeskEditPayload.TYPE, (pl, ctx) -> edit(ctx.server(), ctx.player(), pl));
		ServerPlayNetworking.registerGlobalReceiver(DeskViolationPayload.TYPE, (pl, ctx) -> violation(ctx.server(), ctx.player(), pl));
		ServerLifecycleEvents.SERVER_STARTED.register(s -> PassportStore.load());
		ServerLifecycleEvents.SERVER_STOPPING.register(s -> PassportStore.save());
		ServerTickEvents.END_SERVER_TICK.register(s -> {
			ticks++;
			if (ticks % 200 == 0) for (ServerPlayer p : s.getPlayerList().getPlayers()) { PassportStore.rememberName(p.getUUID(), p.getName().getString()); migrate(p); }
			if (ticks % 6000 == 0) PassportStore.saveIfDirty();
		});
	}

	private static void say(ServerPlayer p, String text) { p.sendSystemMessage(Component.literal(text), true); }

	/** Админ сервера: выдавать и отменять нарушения, вписывать страну и герб в паспортном столе могут только они. */
	static boolean isAdmin(ServerPlayer p) { return p.permissions().hasPermission(Permissions.COMMANDS_ADMIN); }

	private static boolean nearDesk(ServerPlayer p, long posL) {
		BlockPos pos = BlockPos.of(posL);
		return p.distanceToSqr(pos.getX() + 0.5, pos.getY() + 0.5, pos.getZ() + 0.5) <= 64 && p.level().getBlockState(pos).is(VehicleRegistry.PASSPORT_DESK);
	}

	private static boolean own(ItemStack st, ServerPlayer p) {
		return Passport.signed(st) && Passport.ownerUuid(st).equals(p.getUUID().toString());
	}

	/** Паспорт старой версии (страна и герб в NBT, профиля нет): создать профиль из него. */
	private static void migrate(ServerPlayer p) {
		UUID id = p.getUUID();
		if (PassportStore.profile(id) != null) return;
		Container inv = p.getInventory();
		for (int i = 0; i < inv.getContainerSize(); i++) {
			ItemStack st = inv.getItem(i);
			if (!own(st, p)) continue;
			String d = Passport.date(st);
			PassportStore.createLegacyProfile(id, p.getName().getString(), d.isEmpty() ? Passport.today() : d, Passport.legacyCountry(st), Passport.legacySeal(st));
			return;
		}
	}

	private static void request(ServerPlayer p, PassportRequestPayload pl) {
		UUID id;
		try { id = UUID.fromString(pl.uuid()); } catch (IllegalArgumentException e) { return; }
		ServerPlayNetworking.send(p, new PassportInfoPayload(pl.uuid(), PassportStore.encodeViolations(id), PassportStore.encodeCars(id), PassportStore.encodeProfile(id)));
	}

	private static UUID resolve(MinecraftServer server, String name) {
		for (ServerPlayer o : server.getPlayerList().getPlayers()) if (o.getName().getString().equalsIgnoreCase(name)) return o.getUUID();
		return PassportStore.byName(name);
	}

	/** Админ вписывает страну и герб в профиль игрока (все его паспорта показывают эти данные). */
	private static void edit(MinecraftServer server, ServerPlayer p, DeskEditPayload pl) {
		if (!nearDesk(p, pl.pos())) return;
		if (!isAdmin(p)) { say(p, "§cЭто может только администратор сервера."); return; }
		String name = Passport.clean(pl.target(), 32);
		UUID tu = name.isEmpty() ? null : resolve(server, name);
		if (tu == null || PassportStore.profile(tu) == null) { say(p, "§cУ игрока нет паспорта: " + name); return; }
		String country = Passport.clean(pl.country(), 32);
		int seal = Math.max(-1, Math.min(Passport.SEALS.length - 1, pl.seal()));
		if (country.isEmpty()) { say(p, "§cУкажите название страны."); return; }
		if (seal < 0) { say(p, "§cВыберите герб."); return; }
		PassportStore.setCountrySeal(tu, country, seal);
		for (ServerPlayer o : server.getPlayerList().getPlayers()) if (o.getUUID().equals(tu)) o.sendSystemMessage(Component.literal("§aВам вписана страна в паспорт: " + country), false);
		say(p, "§aПаспорт " + name + " обновлён: " + country);
		sendDesk(server, p, name);
	}

	/** Админ выдаёт нарушение; печать выбирается независимо от герба в паспорте, seed задаёт «ручной» наклон и смещение печати. */
	private static void violation(MinecraftServer server, ServerPlayer p, DeskViolationPayload pl) {
		if (!nearDesk(p, pl.pos())) return;
		if (!isAdmin(p)) { say(p, "§cЭто может только администратор сервера."); return; }
		String name = Passport.clean(pl.target(), 32), text = Passport.clean(pl.text(), 80);
		if (name.isEmpty() || text.isEmpty()) { say(p, "§cУкажите игрока и текст нарушения."); return; }
		UUID tu = resolve(server, name);
		if (tu == null) { say(p, "§cИгрок не найден: " + name); return; }
		int seal = Math.floorMod(pl.seal(), Passport.SEALS.length);
		PassportStore.Profile prof = PassportStore.profile(p.getUUID());
		String country = prof != null && !prof.country().isEmpty() ? prof.country() : Passport.SEAL_NAMES[seal];
		int seed = java.util.concurrent.ThreadLocalRandom.current().nextInt() | 1;
		PassportStore.addViolation(tu, new PassportStore.Violation(text, Passport.today(), country, seal, p.getName().getString(), seed));
		for (ServerPlayer o : server.getPlayerList().getPlayers()) if (o.getUUID().equals(tu)) o.sendSystemMessage(Component.literal("§cВам выписано нарушение: " + text), false);
		say(p, "§aНарушение отправлено: " + name);
		sendDesk(server, p, name);
	}

	private static void sendDesk(MinecraftServer server, ServerPlayer p, String target) {
		StringBuilder on = new StringBuilder();
		for (ServerPlayer o : server.getPlayerList().getPlayers()) {
			if (on.length() > 0) on.append('\u0002');
			on.append(PassportStore.clean(o.getName().getString()));
		}
		String viol = "", prof = "";
		if (!target.isEmpty()) {
			UUID tu = resolve(server, target);
			if (tu != null) { viol = PassportStore.encodeViolations(tu); prof = PassportStore.encodeProfile(tu); }
		}
		ServerPlayNetworking.send(p, new DeskDataPayload(on.toString(), target, viol, prof, isAdmin(p)));
	}

	/** Действия паспортного стола: 0 = данные для списков (и флаг админа), 1 = удалить нарушение (только админ, любое). */
	private static void action(MinecraftServer server, ServerPlayer p, DeskActionPayload pl) {
		if (!nearDesk(p, pl.pos())) return;
		String target = Passport.clean(pl.target(), 32);
		if (pl.action() == 1) {
			if (!isAdmin(p)) { say(p, "§cЭто может только администратор сервера."); sendDesk(server, p, target); return; }
			UUID tu = target.isEmpty() ? null : resolve(server, target);
			if (tu == null) { say(p, "§cИгрок не найден: " + target); return; }
			PassportStore.Violation v = PassportStore.violationAt(tu, pl.index());
			if (v == null || !PassportStore.clean(v.text()).equals(pl.text())) say(p, "§cСписок изменился, откройте его заново.");
			else if (PassportStore.removeViolationAt(tu, pl.index())) say(p, "§aНарушение удалено.");
		}
		sendDesk(server, p, target);
	}
}
