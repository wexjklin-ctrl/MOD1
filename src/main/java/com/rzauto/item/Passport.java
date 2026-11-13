package com.rzauto.item;

import com.rzauto.VehicleRegistry;
import net.minecraft.core.component.DataComponents;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.CustomData;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;

/** Данные паспорта (предмет rz_auto:driver_license): владелец, ник и дата подписи лежат в компоненте CUSTOM_DATA предмета. */
public final class Passport {
	private Passport() { }

	public static boolean isDoc(ItemStack s) { return VehicleRegistry.LICENSE != null && !s.isEmpty() && s.is(VehicleRegistry.LICENSE); }

	private static CompoundTag tag(ItemStack s) {
		CustomData d = s.get(DataComponents.CUSTOM_DATA);
		return d == null ? new CompoundTag() : d.copyTag();
	}

	/** UUID владельца документа строкой или пустая строка, если документ не подписан (или это не документ). */
	public static String ownerUuid(ItemStack s) { return isDoc(s) ? tag(s).getStringOr("rz_owner", "") : ""; }
	public static String ownerName(ItemStack s) { return isDoc(s) ? tag(s).getStringOr("rz_name", "") : ""; }
	public static String date(ItemStack s) { return isDoc(s) ? tag(s).getStringOr("rz_date", "") : ""; }
	/** Доступные печати (путь внутри textures/gui без .png). Выбор хранится в паспорте. */
	public static final String[] SEALS = { "seals/rz_eagle", "seal_red", "seals/sakura", "seal" };
	public static final String[] SEAL_NAMES = { "Орёл RZ", "Красная печать", "Сакура", "Синяя печать" };
	public static int sealIndex(ItemStack s) { return isDoc(s) ? Math.floorMod(tag(s).getIntOr("rz_seal", 0), SEALS.length) : 0; }
	public static String seal(ItemStack s) { return SEALS[sealIndex(s)]; }
	/** Следующая печать по кругу (только сервер). */
	public static int nextSeal(ItemStack s) {
		CompoundTag t = tag(s);
		int n = (sealIndex(s) + 1) % SEALS.length;
		t.putInt("rz_seal", n);
		s.set(DataComponents.CUSTOM_DATA, CustomData.of(t));
		return n;
	}
	public static boolean signed(ItemStack s) { return !ownerUuid(s).isEmpty(); }

	/** Присвоить документ игроку (только сервер). */
	public static void sign(ItemStack s, Player p) {
		CompoundTag t = tag(s);
		t.putString("rz_owner", p.getUUID().toString());
		t.putString("rz_name", p.getName().getString());
		t.putString("rz_date", LocalDate.now().format(DateTimeFormatter.ofPattern("dd.MM.yyyy")));
		s.set(DataComponents.CUSTOM_DATA, CustomData.of(t));
	}
}
