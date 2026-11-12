package com.rzauto.net;

import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/** Клиент → сервер: действие над машиной (посадка по F, кнопки меню). См. VehicleEntity.ACT_*. */
public record VehicleActionPayload(int entityId, int action) implements CustomPacketPayload {
	public static final CustomPacketPayload.Type<VehicleActionPayload> TYPE = new CustomPacketPayload.Type<>(Identifier.fromNamespaceAndPath("rz_auto", "vehicle_action"));
	public static final StreamCodec<RegistryFriendlyByteBuf, VehicleActionPayload> CODEC = StreamCodec.composite(
		ByteBufCodecs.VAR_INT, VehicleActionPayload::entityId,
		ByteBufCodecs.VAR_INT, VehicleActionPayload::action,
		VehicleActionPayload::new);

	@Override
	public CustomPacketPayload.Type<? extends CustomPacketPayload> type() { return TYPE; }
}
