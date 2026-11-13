package com.rzauto.net;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/** Клиент → сервер: запросить нарушения и машины владельца паспорта. */
public record PassportRequestPayload(String uuid) implements CustomPacketPayload {
	public static final CustomPacketPayload.Type<PassportRequestPayload> TYPE = new CustomPacketPayload.Type<>(Identifier.fromNamespaceAndPath("rz_auto", "passport_request"));
	public static final StreamCodec<RegistryFriendlyByteBuf, PassportRequestPayload> CODEC = StreamCodec.composite(
		ByteBufCodecs.STRING_UTF8, PassportRequestPayload::uuid,
		PassportRequestPayload::new);

	@Override
	public CustomPacketPayload.Type<? extends CustomPacketPayload> type() { return TYPE; }
}
