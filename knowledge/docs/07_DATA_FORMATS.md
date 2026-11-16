# Data formats
- Contraption save: see 03 (schema table).
- World dynamic properties found by regex (INCOMPLETE; keys built via helpers like `physicsControllerSessionPropertyId` are missed): `_generated/dynamic_properties.md`. Known: `rzlite:drive` (DRIVE cfg + fuel store), `rzlite:susp`, `rzlite:snd_on/snd_vol`, `rzlite:track_cfg`, `create_physics:handles_rope_links`, `create_physics:handrail_motion`, `create_physics:mount_*`, `ia_mag`.
- i18n: `i18n/strings.js` exports `S[id] = [ru, en, es]`; code calls `__t(id)`; table in `_generated/strings.md` (680 rows parsed — an earlier note said 688; recount if it matters).
- Recipes/blocks/items: `_generated/*.md`.
