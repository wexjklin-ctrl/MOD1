package com.rzauto.client;

import com.rzauto.net.PassportInfoPayload;
import java.util.*;

/** Данные паспорта, пришедшие с сервера (профиль, нарушения и машины владельца), и данные паспортного стола. */
final class PassportClient {
	private PassportClient() {}
	static String uuid = "";
	/** text, date, country, seal, issuer, seed */
	static List<String[]> violations = new ArrayList<>();
	/** name, x, y, z */
	static List<String[]> cars = new ArrayList<>();
	/** Профиль владельца паспорта uuid: ник, дата регистрации, страна, герб (-1 = не присвоен); пусто = профиля нет / ещё не пришёл. */
	static String[] profile = new String[0];

	/** Паспортный стол: ники онлайн, выбранный игрок, его нарушения и профиль, флаг админа; deskVer растёт при каждом ответе. */
	static List<String> deskOnline = new ArrayList<>();
	static String deskTarget = "";
	static List<String[]> deskViol = new ArrayList<>();
	static String[] deskProfile = new String[0];
	static boolean deskAdmin;
	static int deskVer;

	static void receiveDesk(com.rzauto.net.DeskDataPayload p) {
		deskOnline = p.online().isEmpty() ? new ArrayList<>() : new ArrayList<>(Arrays.asList(p.online().split("\u0002", -1)));
		deskTarget = p.target();
		deskViol = parse(p.violations());
		deskProfile = fields(p.profile());
		deskAdmin = p.admin();
		deskVer++;
	}

	private static String[] fields(String s) { return s.isEmpty() ? new String[0] : s.split("\u0001", -1); }

	private static List<String[]> parse(String s) {
		List<String[]> out = new ArrayList<>();
		if (s.isEmpty()) return out;
		for (String rec : s.split("\u0002", -1)) out.add(rec.split("\u0001", -1));
		return out;
	}

	static void receive(PassportInfoPayload p) {
		uuid = p.uuid();
		violations = parse(p.violations());
		cars = parse(p.cars());
		profile = fields(p.profile());
	}

	/** Страна из профиля (пусто = не присвоена). */
	static String country(String[] prof) { return prof.length > 2 ? prof[2] : ""; }
	/** Герб из профиля (-1 = не присвоен). */
	static int seal(String[] prof) {
		if (prof.length < 4) return -1;
		try { return Integer.parseInt(prof[3]); } catch (NumberFormatException e) { return -1; }
	}
	static String date(String[] prof) { return prof.length > 1 ? prof[1] : ""; }
	static String name(String[] prof) { return prof.length > 0 ? prof[0] : ""; }
	/** seed печати нарушения (6-е поле; у старых записей нет: берём хеш текста). */
	static int seed(String[] row) {
		if (row.length > 5) { try { int v = Integer.parseInt(row[5]); if (v != 0) return v; } catch (NumberFormatException ignored) { } }
		return row.length > 0 ? row[0].hashCode() | 1 : 1;
	}
	static int sealOf(String[] row) {
		if (row.length < 4) return 0;
		try { return Integer.parseInt(row[3]); } catch (NumberFormatException e) { return 0; }
	}
}
