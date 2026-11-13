package com.rzauto.net;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/** Клиент → сервер: паспортный стол (только админ), вписать страну и герб в профиль игрока target. */
public record DeskEditPayload(long pos, String target, String country, int seal) implements CustomPacketPayload {
	public static final CustomPacketPayload.Type<DeskEditPayload> TYPE = new CustomPacketPayload.Type<>(Identifier.fromNamespaceAndPath("rz_auto", "desk_edit"));
	public static final StreamCodec<RegistryFriendlyByteBuf, DeskEditPayload> CODEC = StreamCodec.composite(
		ByteBufCodecs.VAR_LONG, DeskEditPayload::pos,
		ByteBufCodecs.STRING_UTF8, DeskEditPayload::target,
		ByteBufCodecs.STRING_UTF8, DeskEditPayload::country,
		ByteBufCodecs.VAR_INT, DeskEditPayload::seal,
		DeskEditPayload::new);

	@Override
	public CustomPacketPayload.Type<? extends CustomPacketPayload> type() { return TYPE; }
}
