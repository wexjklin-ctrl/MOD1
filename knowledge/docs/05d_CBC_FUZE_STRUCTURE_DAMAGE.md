# 05d. CBC: фугасы (fuze.js), цепная детонация, урон по конструкциям (main.js L19105–19286)

Статус: READ построчно cbc/fuze.js (387 строк) и main.js L19105–19286 (взрывы и хук конструкций, гниение). В игре НЕ проверено. Автор fuze.js сам пишет: API «в игре НЕ проверено».

## 1. Взрыватель фугаса (cbc:he_shell, блок)
- Состояние блока `cbc:fuze` 0..5 (FUZE.max=5, должно совпадать с BP/blocks/he_shell.json). ПКМ по поставленному `cbc:he_shell` (без Shift) циклически меняет 0→…→5→0, actionbar с пояснением (`fuzeHint`: ≤3 с — «пробивает N с», иначе «пробивает 3 блока и лежит ещё N−3 с»), звук `random.click`.
- Блочное состояние в предмет само не переходит: при поломке блока игроком через 1 тик подменяется свежий дроп (ищет `minecraft:item` в радиусе 2.5, тип he_shell без lore) на ItemStack с lore «Взрыватель: N с» (регэксп RU/EN/PT). `fuzeFromItem` читает значение обратно (используется при заряжании).

## 2. Цепная детонация
Взрывоопасные блоки: `cbc:he_shell` → IMPACT.he_shell, `cbc:powder_charge` → IMPACT.powder_charge. Любой взрыв (свой снаряд с `chain` в IMPACT через `chainHook`; ванильные TNT/крипер/кровать/… через `world.beforeEvents.explosion` (запасной — afterEvents)) вызывает `chainDetonate(dim, c, radius)`: радиус не больше `CHAIN.vanillaMax`=12; для ванильных = самый дальний разрушенный блок +0.5, не меньше `vanillaMin`=3.5. Найденные блоки планируются с задержкой `baseDelay 2 + round(d·0.5) + rand(0..2)` тиков; `detonate` ставит воздух (чтобы не сработал дважды), вызывает `applyImpact` (он снова запускает цепь), звук `cbc.shell_explosion` и эффекты. Взрыватель при цепной детонации не учитывается.
Два режима поиска:
1. Скан куба радиусом R порциями (`runJob`, 200 ячеек за порцию), не более `maxActiveScans`=8 одновременно.
2. «Экономия» (сборка 87, включает админ `setFugasKnown`): реестр поставленных фугасов в world dynamic property `cbc:fugas` (JSON `{k,o,p:["o:x,y,z"]}`, сохраняется через 100 тиков после изменения, максимум `REG_MAX`=1500, при переполнении или для нестандартного измерения `overflow` и возврат к скану). Реестр пополняется на `playerPlaceBlock`, чистится на `playerBreakBlock`/`blockExplode`/детонации; блоки, поставленные командами, структурами или поршнями, в реестре не числятся и в этом режиме цепью не взрываются.

## 3. Урон по физическим конструкциям (машинам)
Хук `setStructureHook({ray, blast})` в main.js L19183:
- `ray(dim, from, dir, maxDist, skipOwner)`: для каждой сессии того же измерения (кроме конструкции стрелка) `session.assembly.raycast(from, dir, maxDist)`; блок с itemTypeId `minecraft:air` пропускается; выбирается ближайшее попадание → `{distance, point}`.
- `blast(dim, at, power)` = `rzExplodeSessions(dim, at, max(power, 1.6), {dropChance:0.3})` (автопушка с силой ~1 всё же бьёт по лёгким блокам).
**`rzExplodeSessions(dim, at, power, opts)`** (L19131): радиус `R = 2·power` (в локальных координатах тела, т.е. блоков). Для каждой сессии: точка взрыва в локальных координатах (`worldPointToLocal`), все блоки в R. Для каждого блока: защита = Σ по блокам на пути (шаг 0.3) от центра до цели `(resistance_other + 0.3)·0.3`; остаток `left = power·(0.7 + rand·0.6) − 0.75·d − shield`; блок ломается, если `left > (resistance + 0.3)·0.3` и твёрдость ≥0. Берутся ближайшие `RZ_BLAST_MAX_BLOCKS`=24 блока. Ломает та же `removePhysicsSnapshotBlock` (см. 03b §4; дроп с шансом `dropChance`; владелец ищется заново, т.к. машина могла разделиться). После — `wakeUp` всех тел измерения.
**Сопротивление блока** `rzBlockBlastResistance` (кэш): `minecraft:*` — из `getBlockStrength(id)`; иначе по имени: wheel_mount_netherite 20, wheel_mount_iron 6; `cbc:*` стали 9, чугуна 7, бронзы 5, иначе 1 (боеприпасы хрупкие); /glass|lamp|light|handrail|rope|hook|wool|carpet|sail|leaves/ → 0.6; /steel|iron|brass|copper|girder|casing|bars|engine|gearbox|shaft|controller/ → 4; прочее 2.
**Ванильные взрывы** (L19200–19237): `beforeEvents.explosion` запоминает центр (источник+0.5 по Y или центр разрушенных блоков), тип источника и радиус; `afterEvents.explosion` (в пределах 1 тика) берёт силу из `RZ_BLAST_POWER` (tnt 4, tnt_minecart 4, creeper 3, ender_crystal 6, wither 7, wither_skull/fireball/small_fireball/dragon_fireball 1, wind_charge 0), иначе из радиуса `clamp(radius/1.3, 1..8)`, иначе 4; мобы-источники при `mobGriefing=false` не ломают; ТНТ дропает все блоки, остальные с шансом 1/power.

## 4. Гниение: что делают `smoke` и `finish` (закрывает пробел в 03b §6)
- `rzRotSmoke(session, stage)`: до 160 визуальных сущностей `create_physics:physics_block` сессии получают в руку блок стадии: 1 `deepslate`, 2 `blackstone`, 3 `coal_block` (`replaceitem … slot.weapon.mainhand`). Дыма нет.
- `rzRotFinish(session)`: выбрасывает содержимое хранилищ в точке тела, звук `random.fizz`, снимает сущности (колёса, ручки, пропеллеры, горелки, кресла, коллизии, хранилища), удаляет сессию и сохранение, `assembly.remove()`. Блоки НЕ выпадают.

## 5. Не прочитано
cbc/effects.js, world.js (казённик, заряжание в мире), twin.js/twin_scan.js (бронзовая спаренная автопушка), recoil.js, admin.js, cmMount.js, core/cbcMount.js (625 строк), core/cbcLooks.js, `AssemblyBody.raycast` (physics.js), `getBlockStrength` (rz_block_strength.js?).
