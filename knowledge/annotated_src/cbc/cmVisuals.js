/* CLAUDE-MAP-BEGIN
 FILE: cbc/cmVisuals.js  (0 KB, 12 lines)  [auto-generated header; code below is UNCHANGED]
 ROLE: (auto, from first comment) Визуалы деталей пушек (cbc:
 IMPORTS: -
 IMPORTED BY: main.js
 EXPORTS: cbcVisualEntityId, cbcVisualProperties
 KEY FUNCTIONS (by size; line numbers are ORIGINAL, add header length to find in this file): cbcVisualProperties@7(5L); cbcVisualEntityId@4(3L)
 NOTE: comments may contain mojibake (double-encoded UTF-8); see docs/09_GOTCHAS.md. __t(N) -> docs/_generated/strings.md.
 CLAUDE-MAP-END */
// Визуалы деталей пушек (cbc:*) на конструкциях CreateMovement: сущность create_physics:cbc_<имя> на каждый блок.
// Сущности и модели сгенерированы tools/gen_visuals.py из блоков RZ (текстуры граней склеены в атлас).
const FACING_INDEX = { up: 0, down: 1, north: 2, south: 3, east: 4, west: 5 };
export function cbcVisualEntityId(typeId) {
  return typeof typeId === "string" && typeId.startsWith("cbc:") ? `create_physics:cbc_${typeId.slice(4)}` : undefined;
}
export function cbcVisualProperties(snapshot) {
  let f;
  try { f = snapshot.permutation.getState("minecraft:facing_direction"); } catch { /* нет состояния */ }
  return { "create_physics:cbc_facing": FACING_INDEX[f] ?? 0 };
}
