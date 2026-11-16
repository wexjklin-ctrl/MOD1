# 05h — Iron's Arms 'n Artifice (irons/main.js): огнестрельное оружие игрока

Статус: **READ построчно** весь `irons/main.js` (605 стр.; подключён `main.js:3`). Поведение в игре **не проверено**. Пути от `Trackwork_RZ_BP/scripts/`. Комментарии автора по-английски.

Самостоятельный модуль без связи с CBC/физикой. Пространство имён `irons_artifice`. Анимации оружия — attachable'ы в RP; поза руки — анимация кости игрока через `player.playAnimation`.

## 1. Данные (L6–317, таблица `GUNS`, «извлечена из байткода Java-мода»)
6 базовых: поля `mag, reload (тиков), auto, dmg, spread (°), blowback, delay, recoil [сила, разброс], speed, pellets, flash[], shot, echo[звук, pitch], equip, cues[[сек анимации, звук, громкость]], firecues, animLen`.

| id | mag | reload | auto | dmg (исх.→RZ) | spread | pellets | speed | delay |
|---|---|---|---|---|---|---|---|---|
| flintlock | 1 | 40 | нет | 20→**40** | 3.0 | 1 | 0.75 | 1 |
| musket | 1 | 60 | нет | 18→**40** | 0.5 | 1 | 1.5 | 1 |
| blackpowder_revolver | 6 | 40 | нет | 10→**20** | 1.0 | 1 | 1.0 | 10 |
| six_shooter | 6 | 20 | нет | 8→**10** | 2.5 | 1 | 1.0 | 3 |
| blunderbuss | 2 | 30 | нет | 22→**60** | 7.0 | 8 | 1.0 | 1 |
| clockwork_rifle | 10 | 30 | **да** | 7→**10** | 2.0 | 1 | 1.0 | 4 |

`RZ_DMG` (L319) перезаписывает урон (комментарий: у мобов на 20 HP 1–2 выстрела, на 40 HP 1–4).
Варианты (L322–331): `clockwork_rifle_grey` (mag 27), `_purple` (mag 60), `musket_gold`, `blunderbuss_gold`, `blackpowder_revolver_gold` (иконка патронов `glyph 0xE720`), `six_shooter_pink` (стреляет сердцами `heart_projectile`, glyph `0xE710`), `six_shooter_dual_pink` (mag 12, reload 40, `dual:true`, `animLen 2.0`; две руки по очереди). Итого 13 стволов. Кулдаун: `g.cd = auto ? max(2, delay) : max(delay, ceil(FIRE_ANIM[id]·20))` — равен длине анимации выстрела, **должен совпадать с RP-контроллерами**; для двойного левая рука `DUAL_LEFT_CD=13` (RP-контроллер различает руки по длине кулдауна).

## 2. Боезапас
- Патрон в магазине хранится на стеке: dynamic property предмета `ia_mag`, lore `§7<имя>` + `§6Ammo: n/mag`. Расходник — россыпь предметов `irons_artifice:bullet` в инвентаре.
- Перезарядка `startReload` (Shift/ присесть, либо клик с пустым магазином на маунте): `player.startItemCooldown("ia_<id>", reload)` блокирует использование, RP-контроллер играет анимацию по этому кулдауну; звуки `cues` масштабируются `ticks/20/animLen`; патроны берутся из инвентаря в конце (`takeBullets`), заполнение слотов HUD идёт шагами (≤12). Токен `s.token` отменяет перезарядку при смене слота/предмета (`cancelReload`).
- HUD патронов: строка глифов в action bar (`font/glyph_E7.png`, U+E700.. кадры 0..5 «латунь→серый», 5 кадров анимации исчезновения), позиционируется `ui/hud_screen.json` в правый угол. Для `mag>12` вместо глифов `глиф n/mag`. Обновление `renderHud` раз в 2 тика (и при смене строки/раз в 20 тиков).

## 3. Стрельба
`onUse` (afterEvents.itemUse, один раз на тик): Shift → перезарядка, иначе `tryFire`. `tryFire`: блок при перезарядке/кулдауне `nextFire`; пустой магазин → щелчок (на маунте — автоперезарядка, т.к. Shift высадит); `setMag(mag−1)`; `startItemCooldown`; для dual чередуются руки; точка дула = глаз + взгляд·0.9 + вправо·(0.18 или ±0.28) − 0.16 вверх; `spread = g.spread · (присед 0.6) · (в воздухе 1.8)`; `pellets` снарядов, каждый с `dmg/pellets`.
Снаряд — сущность (`irons_artifice:bullet_projectile` латунный патрон, `shot_projectile` серая картечь, `heart_projectile`), `projectile.shoot(dir·2.5·speed)` (BULLET_SPEED=2.5 бл/тик), владелец = игрок, живёт 80 тиков (запись `BUL`).
Попадание: `projectileHitEntity` → урон считается скриптом: картечь одного выстрела суммируется по цели (`SHOTS`, сброс через 1 тик) и применяется `applyDamage(cause:'projectile')` + `applyKnockback(0.3, 0.1)`; из-за ванильного кулдауна урона (≈10 тиков) недостающая часть доводится вручную через `health.setCurrentValue`/`kill` (кроме игроков). `projectileHitBlock`: частицы/рикошет (15%). Отдача: `recoil()` — подъём взгляда за 2 шага (`k = recoil[0]·0.055`, случайный yaw) + `blowback` отбрасывание.
Звуки: `irons_artifice.<событие>`, эхо через 3 тика.

## 4. Рука и ввод
`syncHand` (смена слота/предмета): звук экипировки, сброс перезарядки, HUD, поза руки `updatePose` (`animation.irons_artifice.hold/hold2/hold3 (+_reload)`: 2 = длинные стволы musket/blunderbuss/clockwork, 3 = обе руки (dual); не при плавании). Режим событий `EVENT_MODE` (есть `playerHotbarSelectedSlotChange`, `playerInventoryItemChange`, `playerButtonInput`): холостой опрос игроков без оружия раз в 40 тиков; иначе раз в 4 тика и Sneak ловится по фронту. Цикл `runInterval(…,1)` работает всегда (но для игроков без оружия пропускает работу).
Отладка: `/scriptevent irons:kit` — выдать все стволы и 64 патрона.

## 5. Подводные камни
- `FIRE_ANIM`, `DUAL_LEFT_CD`, `animLen`, `cues` и глифы связаны с RP (attachables, render controllers, `font/glyph_E7.png`): менять только вместе.
- Постоянный `runInterval(…,1)` (не по правилу «таймер только пока нужен»).
- Не интегрирован с CBC и физикой: урон по конструкциям не наносит.

*Изменений в прошлых документах нет.*
