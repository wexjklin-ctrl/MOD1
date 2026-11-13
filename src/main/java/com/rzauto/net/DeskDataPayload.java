package com.rzauto.net;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/** Сервер → клиент: ники игроков онлайн (через \u0002), ник выбранного игрока и его нарушения (PassportStore.encodeViolations). */
public record DeskDataPayload(String online, String target, String violations) implements CustomPacketPayload {
	public static final CustomPacketPayload.Type<DeskDataPayload> TYPE = new CustomPacketPayload.Type<>(Identifier.fromNamespaceAndPath("rz_auto", "desk_data"));
	public static final StreamCodec<RegistryFriendlyByteBuf, DeskDataPayload> CODEC = StreamCodec.composite(
		ByteBufCodecs.STRING_UTF8, DeskDataPayload::online,
		ByteBufCodecs.STRING_UTF8, DeskDataPayload::target,
		ByteBufCodecs.STRING_UTF8, DeskDataPayload::violations,
		DeskDataPayload::new);

	@Override
	public CustomPacketPayload.Type<? extends CustomPacketPayload> type() { return TYPE; }
}
