package com.rzauto.net;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/**
 * Сервер → клиент (паспортный стол): ники игроков онлайн (через \u0002), ник выбранного игрока, его нарушения (PassportStore.encodeViolations),
 * его профиль (PassportStore.encodeProfile, пусто = нет паспорта) и admin = игрок может выдавать/удалять нарушения и вписывать гербы.
 */
public record DeskDataPayload(String online, String target, String violations, String profile, boolean admin) implements CustomPacketPayload {
	public static final CustomPacketPayload.Type<DeskDataPayload> TYPE = new CustomPacketPayload.Type<>(Identifier.fromNamespaceAndPath("rz_auto", "desk_data"));
	public static final StreamCodec<RegistryFriendlyByteBuf, DeskDataPayload> CODEC = StreamCodec.composite(
		ByteBufCodecs.STRING_UTF8, DeskDataPayload::online,
		ByteBufCodecs.STRING_UTF8, DeskDataPayload::target,
		ByteBufCodecs.STRING_UTF8, DeskDataPayload::violations,
		ByteBufCodecs.STRING_UTF8, DeskDataPayload::profile,
		ByteBufCodecs.BOOL, DeskDataPayload::admin,
		DeskDataPayload::new);

	@Override
	public CustomPacketPayload.Type<? extends CustomPacketPayload> type() { return TYPE; }
}
