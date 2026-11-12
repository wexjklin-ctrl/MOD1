package com.rzauto.mixin;

import com.rzauto.entity.VehicleEntity;
import net.minecraft.world.entity.player.Player;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Когда в машине включены передачи, Shift (передача ниже) не должен высаживать игрока. Выйти можно клавишей F. */
@Mixin(Player.class)
public abstract class PlayerMixin {
	@Inject(method = "wantsToStopRiding", at = @At("HEAD"), cancellable = true)
	private void rz$noShiftDismount(CallbackInfoReturnable<Boolean> cir) {
		Player self = (Player) (Object) this;
		if (self.getVehicle() instanceof VehicleEntity ve && ve.gearsOn()) cir.setReturnValue(false);
	}
}
