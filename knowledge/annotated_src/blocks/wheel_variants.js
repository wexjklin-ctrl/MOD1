/* CLAUDE-MAP-BEGIN
 FILE: blocks/wheel_variants.js  (1 KB, 14 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (auto, from first comment) RZ Lite: колёса и катки RZ (trackwork:
 IMPORTS: -
 IMPORTED BY: main.js
 EXPORTS: isWheelItem, wheelItemVariant, normalizeWheelVariant, wheelVariantItem, wheelVariantRadius, registerWheelPlacement
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): registerWheelPlacement@9(5L); isWheelItem@4(1L); wheelItemVariant@5(1L); normalizeWheelVariant@6(1L); wheelVariantItem@7(1L); wheelVariantRadius@8(1L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// RZ Lite: колёса и катки RZ (trackwork:*) как варианты колеса на wheel_mount. Порядок = номер варианта (wheel_variant).
const items = ["trackwork:small_simple_wheel", "trackwork:large_simple_wheel", "trackwork:huge_simple_wheel", "trackwork:large_simple_wheel_part", "trackwork:track_wheel", "trackwork:track_cog_small", "trackwork:track_cog_medium", "trackwork:track_cog_large"];
const radii = [0.625, 0.938, 1.876, 0.938, 0.569, 0.6875, 0.90625, 1.09375]; // радиус шины, блоки (шаги 0-3: RZ lib/vehicle/wheelTypes.js; 4-7: низ ленты в геометрии trk_s*, катки и звёздочки. Радиус задаёт высоту посадки)
export function isWheelItem(typeId) { return items.includes(typeId); }
export function wheelItemVariant(typeId) { return Math.max(0, items.indexOf(typeId)); }
export function normalizeWheelVariant(variant) { return Number.isInteger(variant) && variant >= 0 && variant < items.length ? variant : 0; }
export function wheelVariantItem(variant) { return items[normalizeWheelVariant(variant)]; }
export function wheelVariantRadius(variant) { return radii[normalizeWheelVariant(variant)]; }
export function registerWheelPlacement(registry) {
  registry.registerCustomComponent("create_physics:wheel_mount_only", {
    beforeOnPlayerPlace(event) { event.cancel = true; }
  });
}
