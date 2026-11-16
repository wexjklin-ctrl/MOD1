# 09b — Реестр мёртвого/осиротевшего кода (статический вывод)

Метод: `knowledge/tools/reach.py` (граф статических импортов от `main.js`) + grep по именам экспортов. **Динамических импортов и вызовов по строковым именам инструмент не видит**, так что «мёртвое» = «не найдено вызовов». В игре не проверено. Для переписывания всё ниже можно не переносить.

| Что | Где | Почему считается мёртвым | Документ |
|---|---|---|---|
| Планировщик разлома / fallen-physics (рубка деревьев другого мода) | physics.js / main.js | `prepare/executePhysicsBreak/register` не вызываются | 03b §7 |
| `core/cbcMount.js`, `core/cbcLooks.js` | core/ | недостижимы от main.js, импорты на несуществующие `lib/*`, `structures.js` | 05g |
| `config.js` (3045 симв., минифицирован) | scripts/ | импортируется только мёртвым `core/cbcMount.js`; это конфиг ДРУГОГО проекта: сущности `phys:*`, «плоты» `phys:plots`, `SUBSTEPS:2`, `GRAVITY:-9.81`, захват гравитационной перчаткой, тексты ошибок (`TEXT`), `format`, `__stretchK` | здесь |
| `cbc/types.js` | cbc/ | 2 строки: комментарий и `export {}` | здесь |
| Поручень: `blocks/handrail_cargo.js` (кроме `configureHandrailCargo`/`ensureCargoVisual`, которые тоже не получают `entry`) + ветки `handrailEntry` в main.js | blocks/, main.js | в BP нет блока/сущности `handrail*`; `captureCargo/settleCargo/…` не вызываются | 03f §4b |
| `blocks/wheel_marks.js` (`emitWheelMarks`) | blocks/ | недостижим, экспорт нигде не вызывается. Частица `create_physics:rode_mark` и текстура `rode_mark.png` в RP лежат. Логика: каждые 2 тика, шаг следа 0.3, до 4 частиц, ширина 0.5 (0.7 при радиусе>1), угол по оси качения | здесь |
| `contraptions/ContraptionSailRenderer.js` | contraptions/ | недостижим; сущность `create_physics:contraption_sail_batch` в BP есть, но создавать её некому. Идея: до 20 парусов одной ориентации в одной сущности (`b{slot}_data = (style+1)*262144 + x + 64y + 4096z`, размах ≤64 клеток), общее твёрдое движение проверяется кватернионами (допуск 1−|dot|≤1e-7, сдвиг ≤0.0002), несовместимые разбиваются по `contraptionSailPartition` | здесь |
| Роторы пропеллера (`legacyPropellerGroups`, `propellerGroups()` → `[]`), `bearingPushDirection` | blocks/propeller_bearing.js, airplane_math.js | с шага 138 подшипник стал «Башней» | 03d |
| `showAirplaneThrottle` | blocks/airplane_throttle.js | не вызывается; жив только `registerAirplaneThrottle` и `setAirplaneVisualAngles` | 03d §6 |
| `registerBlockStrength`, `breakProgressPerTick`, `canHarvest`, `isEffective`, `toolOf` | blocks/rz_block_strength.js | экспорты не используются; жив только `getBlockStrength` | 04g §4 |
| `CORE_ID` как «phys:core» из glue_filter.js | — | НЕ мёртвый: это и есть `RZ_CORE_ID` | 03f §3 |

## Ловушки при чтении
- Имена `create_physics:*` и `phys:*` — разные поколения проекта; `phys:` встречается в мёртвом коде и в ядре машины (`phys:core`, `phys:seat_passenger*`, звуки `phys.eng.*`), поэтому не путать с «другим проектом» по префиксу: проверять достижимость.
- `create:*` (vault, fluid_tank, deployer, wrench) — блоки ДРУГОГО пака (оригинальный Create для Bedrock); этот аддон только переносит их состояние (03e).
