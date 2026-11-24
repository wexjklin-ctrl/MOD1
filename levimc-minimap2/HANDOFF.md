# Миникарта 2 (LeviMC / Bedrock) — HANDOFF

Проект стартовал в сессии 20 как копия levimc-mod (Diorama Bedrock) с новым именем: target `minimap2`, данные `%APPDATA%\minimap2\`, релиз `minimap-2-latest` («Миникарта 2»), workflow `.github/workflows/minimap2-build.yml`, лог ошибок сборки: ветка `build-logs2` (`git fetch origin build-logs2 && git show origin/build-logs2:errors.txt`).
ВАЖНО для владельца: старый мод diorama-bedrock из папки модов УДАЛИТЬ — оба хукают HudCursorRenderer и будут рисовать друг поверх друга.

## Цель владельца
Перенести отображение и весь функционал Java-мода Diorama (SunkenInTime/minecraft-orthogonal-map, MIT, сохранить копирайт) на Bedrock «1 в 1». Только Overworld сначала. Без радара. Квоты бесплатные — коммитить часто, писать этот файл.

## Исходники Java (читать!)
`git clone https://github.com/SunkenInTime/minecraft-orthogonal-map` (353 .java). Ключевые файлы:
- `bake/TileBaker.java` (CPU-эталон картинки: SAMPLES, shade, свет, тени, AO, контуры, вода) — ПОРТИРОВАТЬ буквально на C++, это путь к «1 в 1» без GPU. Шейдеры (`assets/diorama/shaders`) ссылаются на его методы («as TileBaker.shade»).
- `bake/GpuMesher.java`, `bake/VoxelReader.java` — сбор граней/вокселей (нужны для AO/теней).
- `render/MapLevel.java`, `render/MapViewport.java` — тайлы 128x128, LOD до 11, очереди, дебаунс.
- `data/TileStore.java` — формат хранения на диске.
- `MapScreen.java`, `MinimapHud` — интерфейс/кнопки/режимы.
- Цвета: `diorama/vanilla_looks.dat` (gzip, DVLT, 1394 look'а + таблица имён 1286 `minecraft:*`), читает `BlockLooks` (+ `BiomeTints`). Формат записи уточнить по BlockLooks.java.
- Ресурсы MIT: рамки `assets/diorama/textures/gui/minimap_frame/*.png`, иконки `waypoint_icons/*.png`.

## Что есть в коде сейчас (унаследовано)
Minimap.cpp: хук HudCursorRenderer, bake в фоновом потоке в RGBA, загрузка как текстура (TextureGroup::uploadTexture/updateTextureInPlace, двойная буфер), миникарта, большая карта (M), F7 квадрат/круг, туман, сохранение DBM4 на диск, цвета по правилам имён. Подробный журнал сессий 1-19: `../levimc-mod/HANDOFF.md`.

## План порта (по порядку)
1. Разобрать DVLT/BlockLooks -> таблица Java-имя -> цвет граней; сопоставить с Bedrock-именами (brick_block=bricks, stonebrick=stone_bricks, ...); заменить rules[].
2. Порт TileBaker (shade/свет/тени/AO/контуры/вода/прозрачность растений) на C++, тайлы 128x128 блоков, 4 px/блок, суперсэмплинг 2x2, текстура на тайл + кэш на диске; экранный показ тайлов как в tile.fsh (mip/площадная фильтрация -> делать CPU-mip).
3. Рамки из PNG (ресурс-пак мода или встроенные массивы), режимы F7: круг/квадрат ± вращение по взгляду.
4. Туман неизвестного по fog.fsh (послойный, объёмный), ночной режим tile_night.
5. Большая карта: кнопки справа (+, -, C, значок игрока), вкладки Поверхность/Пещеры, тултип, мышь/колесо (нужен Screen, а не HUD).
6. Вейпоинты (опционально).
7. Эксперимент GPU: хук IDXGISwapChain::Present/ID3D12CommandQueue (так делает Arke, исходники Arke закрыты), HLSL через D3DCompile.

## Журнал
- Сессия 20: создан проект, workflow, релиз «Миникарта 2». Кода карты ещё не менял. Следующий шаг: пункт 1 плана.
