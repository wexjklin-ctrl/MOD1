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
1. [ ] Скелет мода: manifest.json, xmake.lua, ModEntry (ll_mod_load), лог, config.json, GitHub Actions (windows-latest, xmake) с артефактом .zip.
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

## 7. Открытые вопросы к владельцу
- Версия Minecraft и LeviLamina в LeviMC (по умолчанию предполагаем 1.26.51.1 / 26.51.6, как у MelonRind).
