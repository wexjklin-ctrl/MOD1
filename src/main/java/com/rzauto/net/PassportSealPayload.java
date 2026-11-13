package com.rzauto.net;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/** Клиент → сервер: паспортный стол, выбрать печать своего подписанного паспорта (pos — блок верстака). */
public record PassportSealPayload(long pos, int seal) implements CustomPacketPayload {
	public static final CustomPacketPayload.Type<PassportSealPayload> TYPE = new CustomPacketPayload.Type<>(Identifier.fromNamespaceAndPath("rz_auto", "passport_seal"));
	public static final StreamCodec<RegistryFriendlyByteBuf, PassportSealPayload> CODEC = StreamCodec.composite(
		ByteBufCodecs.VAR_LONG, PassportSealPayload::pos,
		ByteBufCodecs.VAR_INT, PassportSealPayload::seal,
		PassportSealPayload::new);

	@Override
	public CustomPacketPayload.Type<? extends CustomPacketPayload> type() { return TYPE; }
}
