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
	/** Установить печать по индексу (только сервер). */
	public static void setSeal(ItemStack s, int idx) {
		CompoundTag t = tag(s);
		t.putInt("rz_seal", Math.floorMod(idx, SEALS.length));
		s.set(DataComponents.CUSTOM_DATA, CustomData.of(t));
	}
	public static final String DEFAULT_COUNTRY = "RZ Федеративное объединение";
	/** Название страны из паспортного стола (по умолчанию RZ Федеративное объединение). */
	public static String country(ItemStack s) {
		String c = isDoc(s) ? tag(s).getStringOr("rz_country", "") : "";
		return c.isEmpty() ? DEFAULT_COUNTRY : c;
	}
	public static void setCountry(ItemStack s, String c) {
		CompoundTag t = tag(s);
		t.putString("rz_country", c);
		s.set(DataComponents.CUSTOM_DATA, CustomData.of(t));
	}
	public static String sealPath(int idx) { return SEALS[Math.floorMod(idx, SEALS.length)]; }
	/** Убрать управляющие символы и §, обрезать пробелы и длину. */
	public static String clean(String s, int max) {
		if (s == null) return "";
		StringBuilder sb = new StringBuilder();
		for (char ch : s.toCharArray()) if (ch >= 32 && ch != 127 && ch != '\u00a7') sb.append(ch);
		String r = sb.toString().trim();
		return r.length() > max ? r.substring(0, max).trim() : r;
	}
	public static String today() { return LocalDate.now().format(DateTimeFormatter.ofPattern("dd.MM.yyyy")); }
	public static boolean signed(ItemStack s) { return !ownerUuid(s).isEmpty(); }

	/** Присвоить документ игроку (только сервер). */
	public static void sign(ItemStack s, Player p) {
		CompoundTag t = tag(s);
		t.putString("rz_owner", p.getUUID().toString());
		t.putString("rz_name", p.getName().getString());
		t.putString("rz_date", today());
		s.set(DataComponents.CUSTOM_DATA, CustomData.of(t));
		com.rzauto.passport.PassportStore.rememberName(p.getUUID(), p.getName().getString());
	}
}
