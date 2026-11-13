package com.rzauto.net;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/** Клиент → сервер: паспортный стол, отправить нарушение игроку с печатью страны. */
public record DeskViolationPayload(long pos, String target, String text) implements CustomPacketPayload {
	public static final CustomPacketPayload.Type<DeskViolationPayload> TYPE = new CustomPacketPayload.Type<>(Identifier.fromNamespaceAndPath("rz_auto", "desk_violation"));
	public static final StreamCodec<RegistryFriendlyByteBuf, DeskViolationPayload> CODEC = StreamCodec.composite(
		ByteBufCodecs.VAR_LONG, DeskViolationPayload::pos,
		ByteBufCodecs.STRING_UTF8, DeskViolationPayload::target,
		ByteBufCodecs.STRING_UTF8, DeskViolationPayload::text,
		DeskViolationPayload::new);

	@Override
	public CustomPacketPayload.Type<? extends CustomPacketPayload> type() { return TYPE; }
}
