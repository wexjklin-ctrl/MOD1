# HANDOFF: клиентская миникарта «Diorama» для Minecraft Bedrock (LeviMC / LeviLamina)

> Этот файл ведётся для передачи работы другому Claude. Обновлять ПОЧАЩЕ. Последнее обновление: 2026-11-24.
> Язык общения с владельцем: русский. Владелец пишет капсом и с опечатками, это нормально.
> НЕ сохранять GitHub-токен в файлах репозитория. Токен выдаёт владелец в чате, в конце его надо удалить.

## 1. Цель
Сделать **нативный клиентский мод** (не аддон!) для лаунчера **LeviMC** (LeviLamina client), который повторяет Java-мод **Diorama**
(https://github.com/SunkenInTime/minecraft-orthogonal-map, лицензия MIT, автор Dara Adedeji, копирайт сохранять).
Сервер владельца НЕ модифицируется и не поддерживает моды: мод ставит себе каждый игрок лично (как MelonRind, `"platform": "client"`).

## 2. Требования владельца (дословный смысл)
- Визуал «1 в 1» как у Diorama (угловая вокселная карта, рамка, фон, туман неизвестных областей).
- Работает ТОЛЬКО в верхнем мире (Overworld). Нижний мир и Энд не нужны.
- Радар (метки игроков и мобов) НЕ НУЖЕН.
- Желательно: открывающаяся большая глобальная карта (fullscreen, перетаскивание, зум).
- Писать этот md-файл почаще: у владельца бесплатные квоты Claude, работу, возможно, придётся передать другому Claude.
- Работаем в репозитории `wexjklin-ctrl/MOD1`, ветка `claude-work`, папка `levimc-mod/`. Оригинал Diorama владелец положил в релиз репозитория (diorama-0.10.1+26.3.jar + исходники).
  В корне репозитория лежит НЕСВЯЗАННЫЙ Java/Fabric-проект (rz_auto); не трогать, не удалять без команды владельца.

## 3. Что уже выяснено
### Эталон: MelonRind (клиентский мод LeviLamina, пример от владельца)
- manifest.json: `{"name","entry":"MelonRind.dll","version","type":"native","platform":"client"}`.
- DLL экспортирует `ll_mod_load`, использует `ll::mod::Mod/NativeMod`, `ll::memory::hookEx` / `unhook`, `ClientStartJoinLevelEvent`.
- Хукает `HudHeartRenderer::render` и `HudHungerRenderer::render` (сигнатура `render(MinecraftUIRenderContext&, IClientInstance&, UIControl&, int)`).
- Требует LeviLamina client 26.51.6 и Minecraft 1.26.51.1. Ресурспак внутри мода (resource_packs/...).
- Исходники MelonRind приватные (git clone просит логин).

### LeviLamina (https://github.com/LiteLDev/LeviLamina)
- Есть клиентские заголовки: `src-client/mc/client/...`. Нужные: `renderer/screen/MinecraftUIRenderContext.h`
  (fillRectangle, drawRectangle, drawImage, drawNineslice, getTexture, setClippingRectangle, enableScissorTest, stencil),
  `gui/screens/controllers/HudScreenController.h`, `gui/controls/renderers/Hud*Renderer.h`, `game/ClientInstance.h`, `player/LocalPlayer.h`,
  `renderer/block/tessellation_pipeline/world_view/BlockSource.h`, `ll/api/event/client/ClientStartJoinLevelEvent.h`.
- Сборка: xmake >= 3, toolchain clang-cl (Windows), зависимость `bedrockdata v26.60.5-client.17` (master на 2026-11-22).
- ВЕРСИЮ Minecraft/LeviLamina у владельца ещё НЕ знаем (спрашивал; ждём ответ). Хуки привязаны к версии игры.

### Diorama (эталон визуала)
- Java, 351 файл, ~96k строк. Ключевое: `MinimapHud`, `Projection`, `MapScreen` (fullscreen), `bake/TileBaker`, `bake/VoxelReader`, `bake/BlockLooks`,
  `bake/GpuMesher`, `render/MapLevel`, `render/MapViewport`, `data/TileStore`, `data/ChunkSnapshot`, ресурсы: шейдеры GLSL
  (bake/tile/fog/tile_night), рамки миникарты (`textures/gui/minimap_frame/*.png`: classic/minecraft x round/square), иконки вейпоинтов.
- Шейдеры GLSL НЕ переносятся в Bedrock напрямую (другой рендер). Нужен CPU-растеризатор в текстуру, затем вывод через UI render context.
- Хранение карты: тайлы на диск по миру/измерению (в Diorama `.minecraft/diorama/`).

## 4. План (этапы)
1. [x] Скелет мода: СОБИРАЕТСЯ в Actions (первая сборка успешна, ~10 мин из-за скачивания зависимостей; в игре ещё НЕ проверено) (manifest.json, xmake.lua, src/mod/DioramaMod.*, NOTICE.md, workflow `.github/workflows/levimc-build.yml`). config.json пока нет.
2. [ ] Хук/рисование на HUD: нарисовать квадрат на экране (проверка пайплайна рендера).
3. [ ] Чтение позиции игрока и блоков вокруг (BlockSource), только Overworld.
4. [ ] Верхняя миникарта: цвета блоков, высота, поворот/север, рамка из PNG Diorama, размер/угол/прозрачность в конфиге.
5. [ ] Угловой «диорама» вид (CPU, изометрия, стены обрывов, тени).
6. [ ] Хранение карты на диск + туман неисследованного.
7. [ ] Fullscreen-карта: клавиша открытия, перетаскивание, зум.
8. [ ] Вейпоинты (опционально, после основного).
НЕ делаем: радар, Нижний мир/Энд, веб-карта, Xaero-совместимость, приваты.

## 5. Ограничения и риски
- Среда Claude: Linux, нет MSVC/игры; собрать и запустить мод здесь нельзя. Сборка идёт в GitHub Actions, тестирует владелец и присылает логи.
- Хуки/символы зависят от версии Minecraft. После обновления игры мод надо пересобирать.
- Репозиторий MOD1 ПУБЛИЧНЫЙ: всё в нём видно всем.

## 6. Лог работы
- 2026-11-24: изучены MelonRind (DLL), Diorama (jar + исходники), LeviLamina (клиентские заголовки). Создана ветка `claude-work`. Создан этот файл.
  Следующий шаг: узнать версии Minecraft/LeviLamina у владельца, затем этап 1 (скелет + Actions).

- 2026-11-24 (позже): за основу взят официальный шаблон https://github.com/LiteLDev/levilamina-mod-template (xmake.lua, manifest с `${modPlatform}`,
  клиентская сборка через `--target_type=client`). Имя цели: `diorama-bedrock`, namespace `diorama_bedrock`, класс `DioramaMod`.
  Workflow `levimc-build.yml` собирает только client, триггер: push в `claude-work` по путям `levimc-mod/**` и ручной запуск. Артефакт: `levimc-mod/bin/`.
  ВАЖНО: в репозитории уже есть старый workflow `build` (Gradle, от Java-проекта rz_auto), он запускается на каждый push и нам не нужен; выключать только по команде владельца.
  Сборку на лету проверять через API: `GET /repos/wexjklin-ctrl/MOD1/actions/runs?branch=claude-work`. Одной командой bash нельзя ждать больше ~300 с.

- 2026-11-24: первая сборка `levimc-build` прошла успешно (run 45378230882). Артефакт `diorama-bedrock-<sha>-client-windows-x64` содержит `bin/`.
  Следующий шаг: владелец скачивает артефакт, кладёт в LeviMC, запускает игру и присылает лог (должны быть строки "Diorama (Bedrock) loaded/enabled").
  Если загрузился, делаем этап 2 (HUD-хук). Если нет: смотреть версию LeviLamina (закрепить в xmake.lua `add_requires("levilamina <версия>")`).

- 2026-11-24: workflow `levimc-build` теперь игнорирует изменения только в `.md` (paths `!levimc-mod/**/*.md`). Коммиты с одними заметками всё равно подписывать `[skip ci]`
  (иначе стартует и старый Gradle-workflow `build`). Токен владельца НЕ имеет права Actions:write, отменять запуски через API нельзя (403); читать запуски/логи можно.

- 2026-11-24: workflow теперь публикует zip в Releases: тег `diorama-bedrock-latest` (prerelease, пересоздаётся при каждой сборке),
  файл `diorama-bedrock-client-windows-x64.zip` = папка `diorama-bedrock/` (dll, pdb, manifest.json), как у MelonRind. Проверено: релиз создан, zip корректный.
  Ссылка: https://github.com/wexjklin-ctrl/MOD1/releases/tag/diorama-bedrock-latest  (старые релизы «Последняя версия» относятся к Java-проекту rz_auto, не к нам).
  Ждём от владельца: лог загрузки в игре + версии Minecraft/LeviLamina.

## 7. Открытые вопросы к владельцу
- Версия Minecraft и LeviLamina в LeviMC (по умолчанию предполагаем 1.26.51.1 / 26.51.6, как у MelonRind).
