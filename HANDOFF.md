# HANDOFF: как продолжить работу над модом (читать первым)

Проект: порт Bedrock-аддона RZ Auto (307 машин) на Fabric, Minecraft 26.3, Java 25. Репозиторий: github.com/wexjklin-ctrl/MOD1 (публичный).
Язык общения с владельцем: русский. Владелец не программист, работает из браузера, ПК для сборки нет.

## Как устроена сборка (без ПК)
- Любой push в `main` запускает GitHub Actions (`.github/workflows/build.yml`): самопроверки логики (`tools/SelfTest*.java`),
  `gradle build`, затем (если `rz_smoke=true` в gradle.properties) запуск настоящего сервера и проверка, что все сущности создаются.
- Результат: релиз `latest` в репозитории: `build.log` (весь вывод), `selftest.log`, готовый `.jar`.
  Читать: `https://github.com/wexjklin-ctrl/MOD1/releases/download/latest/build.log`
- Файл `.github/workflows/*` токен менять не может (нет права Workflows). Если надо править workflow, попроси владельца вручную через браузер.
- Справка по API Minecraft/Fabric без исходников: впиши классы в `api_query.txt` (javap -protected) и regex в `api_find.txt`,
  запушь, прочитай секции `=== CLASS` / `=== FIND` в `build.log`. Мод собирается через `compileJava`, `apiDump` идёт следом даже при ошибке компиляции.
- Из песочницы Claude доступны github.com и raw/codeload, но НЕ доступны maven/gradle/mojang: сборка только на GitHub.

## Доступ
- Для push нужен fine-grained токен владельца (Contents + Actions: read/write, только репозиторий MOD1, срок 7 дней).
  Токен НЕ хранить в репозитории и в памяти. Если токена нет, попроси владельца создать новый (Settings -> Developer settings -> Fine-grained tokens)
  и отозвать после работы. Без токена: готовь файлы архивом, владелец грузит через браузер.
- Владелец согласился принять Minecraft EULA в одноразовом CI-тесте (eula.txt пишется в `build.gradle` только для `runServer`).

## Архитектура (решения владельца)
- Мод ставится целиком и на сервер, и на клиентов. Сервер — узкое место, поэтому: физика только у едущих машин, спящие не тикают,
  рендер/звук/камера/HUD только на клиенте. См. PROMPT_FOR_PC_CLAUDE.md «Обновление 4/5» и пакет `com.rzauto.perf`.
- Чистая логика (без Minecraft) — `com.rzauto.logic`, проверяется самопроверками; не переписывать, а вызывать.
- Minecraft-слой: `com.rzauto.entity`, `com.rzauto.item`, `VehicleRegistry`; клиент в `src/client/java`.

## Статус
- [готово] логика, сборка, регистрация 307 типов + ключ-предметы, пустая сущность, заглушка рендера, дымовой тест сервера (307 из 307).
- [готово, проверено только на сервере CI] этап 2: серверная физика в `VehicleEntity.tick` (водитель = 1-й пассажир, клавиши из `ServerPlayer.getLastClientInput()`),
  клиент машину не симулирует (`getControllingPassenger()==null`), временная модель-коробка в `VehicleRenderer`. Дымовой тест: машина падает, едет, тормозит (заезд OK).
  Пока двигатель всегда заведён, мощность 100%, без топлива/передач/замка (подключать `DriveGate`, `Access`, `GearBox`, `Fuel` из `logic/`).
- [известно] CI: при ошибке компиляции jar-заглушка `BUILD_FAILED_placeholder.jar` нужна, чтобы логи всё равно опубликовались.
- [дальше] geo-модели и текстуры, HUD, меню, звук, камера, свет фар, миграция мира (SPEC.md §7).
- Не проверялось в живой игре: клиент, рендер, управление. Это может проверить только владелец (нужен Minecraft 26.3 + Fabric Loader 0.20.1 + Fabric API).
