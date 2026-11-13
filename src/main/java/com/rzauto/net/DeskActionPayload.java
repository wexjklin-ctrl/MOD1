package com.rzauto.net;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/** Клиент → сервер: паспортный стол. action 0 = запросить онлайн-игроков и нарушения target, 1 = удалить нарушение (index в списке «новые первыми», text для сверки). */
public record DeskActionPayload(long pos, int action, String target, int index, String text) implements CustomPacketPayload {
	public static final CustomPacketPayload.Type<DeskActionPayload> TYPE = new CustomPacketPayload.Type<>(Identifier.fromNamespaceAndPath("rz_auto", "desk_action"));
	public static final StreamCodec<RegistryFriendlyByteBuf, DeskActionPayload> CODEC = StreamCodec.composite(
		ByteBufCodecs.VAR_LONG, DeskActionPayload::pos,
		ByteBufCodecs.VAR_INT, DeskActionPayload::action,
		ByteBufCodecs.STRING_UTF8, DeskActionPayload::target,
		ByteBufCodecs.VAR_INT, DeskActionPayload::index,
		ByteBufCodecs.STRING_UTF8, DeskActionPayload::text,
		DeskActionPayload::new);

	@Override
	public CustomPacketPayload.Type<? extends CustomPacketPayload> type() { return TYPE; }
}
