package com.rzauto.client.mixin;

import com.rzauto.entity.VehicleEntity;
import net.minecraft.client.Camera;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.util.Mth;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Камера от третьего лица в машине, как в GTA: едет сзади по курсу машины с плавным запаздыванием и не проходит сквозь блоки. */
@Mixin(Camera.class)
public abstract class CameraMixin {
	@org.spongepowered.asm.mixin.Shadow protected abstract void setPosition(Vec3 v);
	@org.spongepowered.asm.mixin.Shadow protected abstract void setRotation(float yaw, float pitch);

	private static float rzYaw, rzDist = 6f;
	private static long rzNs;
	private static int rzId = -1;

	/** Есть ли вокруг точки (радиус 0.3) сплошной блок (листва не считается: машины проезжают сквозь неё). */
	private static boolean rz$blocked(net.minecraft.world.level.Level lv, Vec3 p) {
		double r = 0.3;
		for (int i = 0; i < 8; i++) {
			var bp = new net.minecraft.core.BlockPos(Mth.floor(p.x + ((i & 1) * 2 - 1) * r), Mth.floor(p.y + (((i >> 1) & 1) * 2 - 1) * r), Mth.floor(p.z + (((i >> 2) & 1) * 2 - 1) * r));
			var st = lv.getBlockState(bp);
			if (st.canOcclude() && !st.is(net.minecraft.tags.BlockTags.LEAVES)) return true;
		}
		return false;
	}

	@Inject(method = "update", at = @At("TAIL"))
	private void rz$chase(DeltaTracker dt, CallbackInfo ci) {
		Camera self = (Camera) (Object) this;
		Minecraft mc = Minecraft.getInstance();
		if (mc.level == null || mc.player == null || mc.options.getCameraType().isFirstPerson()) { rzId = -1; return; }
		if (!(mc.player.getVehicle() instanceof VehicleEntity ve) || !self.isDetached() || !com.rzauto.client.CamModeAccess.gta()) { rzId = -1; return; }
		float pt = self.getCameraEntityPartialTicks(dt);
		long now = System.nanoTime();
		float step = rzNs == 0 ? 0.016f : Mth.clamp((now - rzNs) / 1.0e9f, 0.001f, 0.1f);
		rzNs = now;
		float carYaw = ve.getYRot(pt);
		if (rzId != ve.getId()) { rzId = ve.getId(); rzYaw = carYaw; }
		rzYaw += Mth.wrapDegrees(carYaw - rzYaw) * (1f - (float) Math.exp(-step / 0.25f));
		var box = ve.getBoundingBox();
		double len = Math.max(box.getXsize(), box.getZsize());
		float want = (float) Mth.clamp(len * 1.15 + 2.2, 5.0, 9.5) * com.rzauto.client.CamModeAccess.dist();
		rzDist += (want - rzDist) * (1f - (float) Math.exp(-step / 0.3f));
		Vec3 base = ve.getPosition(pt).add(0, ve.getBbHeight() * 0.75, 0);
		double yr = Math.toRadians(rzYaw);
		Vec3 back = new Vec3(Math.sin(yr), 0, -Math.cos(yr));
		float pitch = 11f;
		Vec3 dir = back.scale(Math.cos(Math.toRadians(pitch))).add(0, Math.sin(Math.toRadians(pitch)), 0).normalize();
		// защита от «иксрея»: 8 лучей от машины к желаемой точке с запасом 0.35 по краям и отступом 0.4 от стены
		double dist = rzDist;
		for (int i = 0; i < 8; i++) {
			double ox = ((i & 1) * 2 - 1) * 0.35, oy = (((i >> 1) & 1) * 2 - 1) * 0.35, oz = (((i >> 2) & 1) * 2 - 1) * 0.35;
			Vec3 from = base.add(ox, oy, oz), to = base.add(dir.scale(rzDist)).add(ox, oy, oz);
			var hit = mc.level.clip(new ClipContext(from, to, ClipContext.Block.VISUAL, ClipContext.Fluid.NONE, mc.player));
			if (hit.getType() != HitResult.Type.MISS) dist = Math.min(dist, hit.getLocation().distanceTo(from) - 0.4);
		}
		dist = Math.max(0.6, dist);
		// финальная проверка: сама камера и точки вокруг неё не внутри сплошных блоков (тоннели, углы); если внутри, подтягиваем к машине
		Vec3 pos = base.add(dir.scale(dist));
		for (int k = 0; k < 24 && dist > 0.6 && rz$blocked(mc.level, pos); k++) {
			dist = Math.max(0.6, dist - 0.3);
			pos = base.add(dir.scale(dist));
		}
		setPosition(pos);
		setRotation(rzYaw, pitch);
	}
}
