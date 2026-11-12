package com.rzauto.logic;

/** vehicle_features.js: переключаемое оборудование (тент Jeep YJ, мигалки Ford, пневмоподвеска Maybach GLS). */
public final class Features {
	public enum Kind {
		TENT("Тент", "натянут", "снят", "§aТент натянут.", "§7Тент снят."),
		LIGHTS("Мигалки", "включены", "выключены", "§aМигалки и сирена включены.", "§7Мигалки и сирена выключены."),
		BOUNCE("Подвеска (прыжки)", "включена", "выключена", "§aПодвеска включена.", "§7Подвеска выключена.");
		public final String button, on, off, msgOn, msgOff;
		Kind(String button, String on, String off, String msgOn, String msgOff) {
			this.button = button; this.on = on; this.off = off; this.msgOn = msgOn; this.msgOff = msgOff;
		}
	}

	/** null — у машины оборудования нет. */
	public static Kind kindOf(String bedrockId) {
		if (bedrockId.startsWith("jeep:yj")) return Kind.TENT;
		if (bedrockId.startsWith("ford:")) return Kind.LIGHTS;
		if (bedrockId.startsWith("maybach:gls")) return Kind.BOUNCE;
		return null;
	}
}
