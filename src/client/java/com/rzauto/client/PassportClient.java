package com.rzauto.client;

import com.rzauto.net.PassportInfoPayload;
import java.util.*;

/** Данные паспорта, пришедшие с сервера (нарушения и машины владельца). */
final class PassportClient {
	private PassportClient() {}
	static String uuid = "";
	/** text, date, country, seal, issuer */
	static List<String[]> violations = new ArrayList<>();
	/** name, x, y, z */
	static List<String[]> cars = new ArrayList<>();

	/** Паспортный стол: ники онлайн, выбранный игрок и его нарушения (text, date, country, seal, issuer), deskVer растёт при каждом ответе. */
	static List<String> deskOnline = new ArrayList<>();
	static String deskTarget = "";
	static List<String[]> deskViol = new ArrayList<>();
	static int deskVer;

	static void receiveDesk(com.rzauto.net.DeskDataPayload p) {
		deskOnline = p.online().isEmpty() ? new ArrayList<>() : new ArrayList<>(Arrays.asList(p.online().split("\u0002", -1)));
		deskTarget = p.target();
		deskViol = parse(p.violations());
		deskVer++;
	}

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
	}
}
