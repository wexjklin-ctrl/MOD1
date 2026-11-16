/* CLAUDE-MAP-BEGIN
 FILE: blocks/hot_air_envelope.js  (0 KB, 9 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (no author comment; infer from name/exports — see docs/_generated/exports.md)
 IMPORTS: blocks/symmetric_sails.js
 IMPORTED BY: blocks/vehicle_systems.js, main.js
 EXPORTS: HOT_AIR_ENVELOPE_IDS, isHotAirEnvelope
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): isHotAirEnvelope@6(3L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
import { SAIL_COLORS } from "./symmetric_sails.js";

export const HOT_AIR_ENVELOPE_IDS = new Set(SAIL_COLORS.map(color =>
  color === "white" ? "create_physics:hot_air_envelope" : `create_physics:hot_air_envelope_${color}`));

export function isHotAirEnvelope(typeId) {
  return HOT_AIR_ENVELOPE_IDS.has(typeId);
}
