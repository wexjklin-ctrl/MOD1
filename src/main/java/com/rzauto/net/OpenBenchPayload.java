package com.rzauto.net;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/** Сервер → клиент: открыть меню крафта машин (команда /avtoRZ, только для администрации). */
public record OpenBenchPayload() implements CustomPacketPayload {
	public static final CustomPacketPayload.Type<OpenBenchPayload> TYPE = new CustomPacketPayload.Type<>(Identifier.fromNamespaceAndPath("rz_auto", "open_bench"));
	public static final StreamCodec<RegistryFriendlyByteBuf, OpenBenchPayload> CODEC = StreamCodec.unit(new OpenBenchPayload());

	@Override
	public CustomPacketPayload.Type<? extends CustomPacketPayload> type() { return TYPE; }
}
