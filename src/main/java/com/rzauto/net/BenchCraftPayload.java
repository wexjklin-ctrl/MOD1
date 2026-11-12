package com.rzauto.net;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/** Клиент → сервер: создать предмет по рецепту верстака (pos — блок верстака, recipe — id рецепта). */
public record BenchCraftPayload(long pos, String recipe) implements CustomPacketPayload {
	public static final CustomPacketPayload.Type<BenchCraftPayload> TYPE = new CustomPacketPayload.Type<>(Identifier.fromNamespaceAndPath("rz_auto", "bench_craft"));
	public static final StreamCodec<RegistryFriendlyByteBuf, BenchCraftPayload> CODEC = StreamCodec.composite(
		ByteBufCodecs.VAR_LONG, BenchCraftPayload::pos,
		ByteBufCodecs.STRING_UTF8, BenchCraftPayload::recipe,
		BenchCraftPayload::new);

	@Override
	public CustomPacketPayload.Type<? extends CustomPacketPayload> type() { return TYPE; }
}
