package com.rzauto.net;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/** Сервер → клиент: нарушения, машины и профиль (ник, дата регистрации, страна, герб; PassportStore.encodeProfile) владельца паспорта. */
public record PassportInfoPayload(String uuid, String violations, String cars, String profile) implements CustomPacketPayload {
	public static final CustomPacketPayload.Type<PassportInfoPayload> TYPE = new CustomPacketPayload.Type<>(Identifier.fromNamespaceAndPath("rz_auto", "passport_info"));
	public static final StreamCodec<RegistryFriendlyByteBuf, PassportInfoPayload> CODEC = StreamCodec.composite(
		ByteBufCodecs.STRING_UTF8, PassportInfoPayload::uuid,
		ByteBufCodecs.STRING_UTF8, PassportInfoPayload::violations,
		ByteBufCodecs.STRING_UTF8, PassportInfoPayload::cars,
		ByteBufCodecs.STRING_UTF8, PassportInfoPayload::profile,
		PassportInfoPayload::new);

	@Override
	public CustomPacketPayload.Type<? extends CustomPacketPayload> type() { return TYPE; }
}
