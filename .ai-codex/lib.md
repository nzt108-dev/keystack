# Lib — KeyStack

## src/db/index.ts — репозитории
| Функция | Описание |
|---------|---------|
| getDb() | соединение + init схемы (idempotent) + миграция старых БД (ALTER TABLE ADD COLUMN) |
| listProjects/getProject(slug)/createProject/updateProject(slug,patch)/searchProjects(q) | проекты |
| listSkills/getSkill(slug)/upsertSkill | скиллы |
| listPrompts/getPrompt(slug)/upsertPrompt | промпты |
| upsertSpec(input)/listSpecsByProject(slug)/deleteSpecsNotIn(slug, files[]) | реестр спек (FORGE wave1) |
| countOpenSpecsByProject() | `{slug: openCount}` для ВСЕХ проектов, один `GROUP BY` (не N+1) — используется в `list_projects` и в дашборде |

updateProject — частичный апдейт (только переданные поля), бампает last_touched; поддерживает
FORGE wave1 поля (track/has_*/tests_*/last_audit_date/open_crit/open_high/health_score).
upsert* — insert или update по slug.
upsertSpec — insert или update по (project_slug, file) через `ON CONFLICT DO UPDATE`.
deleteSpecsNotIn(slug, files) — чистка исчезнувших спек-файлов при рескане; files=[] удаляет все
спеки проекта (не трогает другие проекты).

## src/mcp/server.ts — 11 MCP-инструментов
read: list_projects, get_project, search_projects, list_skills, get_skill, list_prompts, get_prompt
write: create_project, update_project, upsert_skill, upsert_prompt
> stdout = JSON-RPC → логи только в stderr (console.error).

### FORGE wave1 §5 (story 4) — specs/open_specs в get/list_projects
`get_project(slug)` дополнительно отдаёт `specs: [{file, title, stories_total, stories_done,
has_block}]` (весь `.ai-codex/specs/*.md` проекта, из `listSpecsByProject`) и агрегат `open_specs`
(число открытых спек среди них). `list_projects` отдаёт только агрегат `open_specs` на проект (без
полного списка спек — не N+1: один `countOpenSpecsByProject()` GROUP BY на весь список, смёрженный
в память с `listProjects()`). Проект без специй/спек → `open_specs: 0` (не отсутствует в ответе).

Критерий «открытости» (`isSpecOpen` в server.ts): `stories_total === 0 || stories_done <
stories_total` — тот же предикат, что и в SQL-агрегате `countOpenSpecsByProject`, продублирован
намеренно (JS-фильтр по уже загруженному массиву в get_project vs SQL-агрегат по всей таблице в
list_projects — разные языки одного простого условия, не архитектурное дублирование логики).

Существующие поля get_project/list_projects (включая track/health_score/has_*/tests_* из story 1)
только ДОПОЛНЯЮТСЯ, не переименовываются/не удаляются — обратная совместимость для прод-подключения
(dist пересобирается, но контракт ответа не ломается).

## src/dashboard/server.ts — Fastify
GET / (HTML витрина), /api/projects, /api/skills, /api/prompts. Порт 4319.
Карточка проекта (story 4): здоровье-светофор (`healthColor` — <50 красный/50–79 жёлтый/≥80
зелёный, тот же порог, что и владелец описал в спеке) + счётчик `open_specs` (только если >0,
рядом с `tests`-индикатором в `.meta`). `withOpenSpecs()` — тот же `countOpenSpecsByProject()`
GROUP BY, смёрженный в проекты перед рендером (и `/`, и `/api/projects`).

## src/scan/repo.ts — автозаполнение
scanRepo(dir) → { language, frameworks, database, services, github_url, tests_status, detected_from }.
Читает package.json/pubspec/requirements/pyproject/Cargo/go.mod, .env.example (сервисы по префиксам), git remote. Pure read.
MCP-инструмент `scan_repo { path }` отдаёт предложение; агент подтверждает → create_project.

## db: формы дашборда
upsertProject, deleteProject, deleteSkill, deletePrompt (+ существующие create/update/upsert).

## db: расширения (v0.2–0.3)
upsertProject (create-or-update), deleteProject/deleteSkill/deletePrompt.
normServices(input) — строки|объекты → `ServiceRef[]` (backward-compat).
normTasks(input) — строки|объекты → `Task[]` (с category).
Типы: `ServiceRef {provider, account?}`, `Task {text, done, category?}`.

## dashboard: detail-view (v0.3)
Клик по карточке → модалка с полным контекстом (detailProject/detailSkill/detailPrompt в inline JS).
Промпт-detail показывает body + copy. Карточки: data-kind/data-slug, click-listener открывает openDetail.

## ~/.claude/scripts/keystack-scan.sh — dev-state сканер (FORGE wave1 §2.4, story 2)
Живёт ВНЕ этого репо (общий инструмент для всех проектов, вызывается /sync, LaunchAgent, вручную).
Детерминированный bash + sqlite3 CLI, БЕЗ LLM, пишет напрямую в `$KEYSTACK_HOME/keystack.db` (тот же
файл, что и `src/db/index.ts`, включая `KEYSTACK_HOME` контракт).

Usage: `keystack-scan.sh <local_path> [--fast]` (один проект, найден по `local_path`) | `--all [--fast]`.
`--fast` пропускает прогон тестов (`tests_green` остаётся 0). `KEYSTACK_SCAN_TIMEOUT` (default 120) —
тестовый seam для таймаута прогона тестов (perl fork/alarm/kill fallback — `timeout`/`gtimeout`
не гарантированы на macOS; проверено, что этот Mac их не имеет).

Заполняет по каждому проекту: `has_architecture`/`has_invariants` (файл >2KB, без `<!-- TEMPLATE -->`),
`has_design_md` (только если `frameworks` содержит Next.js/React/Vue/Svelte/Flutter), `has_ci`
(`.github/workflows/*.yml`), `tests_count` (grep по `tests/ test/ __tests__/ app/test/ backend/tests/
src/__tests__/`, паттерн по стеку — определяется по файлам-маркерам pubspec.yaml/requirements.txt/
pyproject.toml, не по колонке `language`), `tests_green` (прогон одной стандартной команды на
стек — `.venv/bin/pytest -q` → `uv run pytest -q` → `npm test` → `flutter test`), `health_score`
(§4.2: Track A — `20·arch+15·inv+15·ci+min(20,tests_count)·tgreen+15·audit_fresh+15·clean`; Track B —
`50·inv+min(50,5·tests_count)·tgreen`, обе части формулы целочисленные, без округления).

**Парсер спек** (`.ai-codex/specs/*.md`, не `specs/done/`): title = первая строка `# Spec: …`;
`stories_total`/`stories_done` — ⬜/✅ ТОЛЬКО внутри строк-таблицы блока `## Стори…` до следующего
`## ` (DoD-чекбоксы вне блока не считаются); `has_block` — строка с `**BLOCK**` ТОЛЬКО внутри блока
`## …Clarify-гейт…` (иначе спека, описывающая собственный механизм детекта в прозе, ложно
считается заблокированной — найдено на spec-forge-wave1.md), «нет» сразу после разделителя `:`/`—`/`-`
на той же строке → не заблокирована. Неисполненный шаблон (`[feature-slug]`/`[название фичи]` в
первых 10 строках, а не где угодно в файле — иначе спека, документирующая шаблон в Edge cases,
ложно пропускается) → SKIP, в `specs` не попадает. Исчезнувшие файлы — `deleteSpecsNotIn`.

Ошибка одного проекта (`local_path` не существует на диске) не роняет `--all` — попадает в итоговый
`── summary: N ok, M error(s) ──`. Тесты: `tests/scan.fixture.test.ts` (temp-дерево, child_process
на реальный установленный скрипт).

## scripts/keystack-seed.ts (FORGE wave1, story 3) — досев из CLAUDE.md
Живёт ВНУТРИ этого репо (`scripts/`, не `~/.claude/scripts/`) — переиспользует `src/db/index.ts`
(createProject/updateProject/getProject) и `src/scan/repo.ts` (scanRepo) напрямую, без дублирования
их логики в bash/sqlite3. Запуск: `npx tsx scripts/keystack-seed.ts [--dry-run]`.

Ряды — ручная транскрипция таблицы «## 🗂️ Проекты» из `~/.claude/CLAUDE.md` (константа `ROWS` в
файле; парсить markdown-таблицу на каждый запуск не стоит фрагильности ради одноразового досева —
story 5 делает обратное направление, CLAUDE.md генерируется ИЗ этой БД, так что ручная
транскрипция здесь — bootstrap, не рецидивирующий путь синхронизации).

Идемпотентно: upsert по slug, alias-мэппинг для переименованных проектов (`ALIASES`: `crewup` →
`spotbench` — ex-CrewUp/getspotbench.com ребренд, проект уже существовал в БД под старым слагом,
дубль не создаётся). Существующим строкам НЕ перезатирает непустые content-поля (local_path,
description, language, frameworks, database, services, github_url) — только дополняет пустые;
`track` — единственное поле, которое всегда (пере)записывается для каждого ряда (это новое
dev-state поле контракта, не пользовательский контент). `language`/`frameworks`/`database`/
`services`/`github_url` для новых и неполных строк заполняются ТОЛЬКО через `scanRepo()`
(package.json/pubspec.yaml/requirements.txt/git remote/.env.example) — никогда не берутся из
прозы колонки «Стек» CLAUDE.md (не источник правды для этих полей). Известное ограничение
`scanRepo`: смотрит только в корень `local_path`, не в подпапки — для монорепо, где реальный код
лежит глубже (Faithly → `app/`, brieftube/youtube-parser → `backend/`), language/frameworks
остаются пустыми (не баг story 3, вне её скоупа чинить `scanRepo`).

Track A (константа `TRACK_A`, контракт §2.5): botseller, crewup(→spotbench), faithly,
iwanttoeatair, brieftube, darshan, astro-psiholog, architect-portfolio — ровно 8. Всё остальное
— B (default). Первый прогон 11.07: 30 строк (10 существовавших + 20 новых), 0 расхождений при
повторном запуске (idempotency verified).

## ~/.claude/scripts/keystack-sync-skills.sh (FORGE wave1, story 3) — sync таблицы skills
Живёт ВНЕ репо (как keystack-scan.sh) — общий инструмент. Детерминированный bash+sqlite3+perl,
БЕЗ LLM. Источник — ТОЛЬКО `~/.claude/skills/*/SKILL.md` (глобальные скиллы); скиллы плагинов и
проектных `.claude/skills/` — другой неймспейс, не трогается (различается по колонке `location`:
только строки с `location == '~/.claude/skills'` (буквальная строка с тильдой, НЕ раскрытый
абсолютный путь — так исторически было записано единственной уже существовавшей строкой
motion-landing, и это сохраняется намеренно ради консистентности) участвуют в апсерте/удалении
фантомов; `location = 'Claude Code builtin'` и прочие — не трогаются никогда).

Парсер frontmatter (perl, UTF-8-safe): понимает и однострочный `description: текст`, и YAML
block-scalar `description: |` + отступ (как у motion-landing/watch). Печатает NAME на строке 1,
DESCRIPTION (схлопнутое в одну строку) на строке 2 — читается двумя `read -r` подряд из
here-string. **Gotcha**: NUL/`\x01`-разделённая однострочная кодировка была первой попыткой и
провалилась — bash 3.2 `read` не разбивает по управляющему символу в IFS надёжно (проверено
эмпирически); два `read -r` на две строки — рабочий обходной путь.

Идемпотентно: upsert по slug (=имя папки), фантомы (строка в БД с `location` из этого неймспейса,
но без соответствующей папки на диске) — удаляются. Первый прогон 11.07 нашёл 9 фантомов
(frontend-design, ui-ux-pro-max, mcp-builder, full-audit, global-audit, deep-research, sync,
screen, playwright) — ранее вручную занесённые в БД строки с `location='~/.claude/skills'`, но
реально это плагинные/builtin-скиллы без файла на диске в этой папке; удалены. Итог: 3 скилла
(motion-landing, sec-check, watch).

## ~/.claude/scripts/keystack-export-table.sh (FORGE wave1, story 5) — генерация таблицы CLAUDE.md
Живёт ВНЕ репо (как keystack-scan.sh/keystack-sync-skills.sh) — общий инструмент, детерминированный
bash+sqlite3+perl, БЕЗ LLM. Обратное направление к `scripts/keystack-seed.ts`: та читала CLAUDE.md
→ БД (одноразовый bootstrap, story 3); эта читает БД → пишет секцию «## 🗂️ Проекты» в CLAUDE.md
(рецидивирующий путь, вызывается из `/sync`).

Usage: `keystack-export-table.sh [--dry-run]`. Без `--dry-run` — сплайсит сгенерированную таблицу
СТРОГО между маркерами `<!-- keystack:begin -->`/`<!-- keystack:end -->` в `~/.claude/CLAUDE.md`
(env `CLAUDE_MD` — тестовый seam); всё остальное содержимое файла (включая заголовок «## 🗂️
Проекты» и строку про канонический слаг сразу после таблицы) — вне маркеров, не трогается. Маркеры
отсутствуют/файла нет → CLAUDE.md не трогается вообще, таблица пишется в `~/.claude/projects-
table.generated.md` (env `GENERATED_FALLBACK` — тестовый seam) + warning на stderr; exit 0 — это
штатный, а не аварийный исход. `--dry-run` — таблица в stdout, ничего на диск.

Колонки: `Slug`=slug, `Папка`=`basename(local_path)`, `Суть`=description, `Стек`=frameworks (JSON[])
+ language (`/`-разделённый) + database, дедуп case-insensitive, через запятую. Специально НЕ
включает `services` (хостинг/3rd-party API вроде Vercel/Stripe/CF Pages/Twilio/Claude API) —
другая колонка БД с другой семантикой, вне скоупа этой колонки (контракт story 5). Спецпримечания
уровня "Папка" (VPS-путь у botseller, второй фронтенд-репо у brieftube в соседней папке
yt-saas-frontend, "центральный inbox" у flow) при первом прогоне 11.07 перенесены в `description`
соответствующих проектов в БД (а не выдуманы заново в скрипте) — БД остаётся источником правды.
Порядок строк — алфавитный по slug (детерминированный дефолт; ручной порядок из старой таблицы
CLAUDE.md не сохраняется, генерация намеренно заменяет собой ручную правку).

Тесты: `tests/export-table.fixture.test.ts` (сплайс между маркерами не трогает остальной файл,
идемпотентность, оба edge-случая missing-markers, `--dry-run`, композиция колонки «Стек», Папка
из basename).

## ~/.claude/scripts/ci-babysitter.sh (FORGE wave1, story 5) — список репо из БД, не хардкод
Живёт ВНЕ репо. Раньше — хардкоженная bash-строка `REPOS="..."` (10 репо, руками поддерживалась).
Теперь: `SELECT local_path FROM projects WHERE has_ci=1 AND local_path <> ''` из `$KEYSTACK_HOME/
keystack.db`, для каждого — `git -C <local_path> remote get-url origin` (не колонка `github_url`
из БД: реальный git remote — источник правды для владельца репо, включает варианты `https://
github.com/…`, `git@github.com:…`, `ssh://git@ssh.github.com:443/…`), извлекается `owner/repo` из
хвоста URL. Отфильтровано по `owner == nzt108-dev` — сохраняет прежний неявный скоуп (репо, которые
владелец реально может чинить/пушить/открывать PR в), исключая проекты с `has_ci=1`, но чужим
upstream-репо (keywordista → bootuz, open-design → nexu-io — сторонние инструменты в ~/Projects,
не собственные репо). БД без keystack — скрипт логирует и выходит 0 (не падает ночной cron).

Итог первого прогона 11.07: было 10 (включая `flow`, у которого на самом деле нет `.github/
workflows/` — ложно попадал в список руками), стало 12 под nzt108-dev (flow корректно выпал,
+cover-ai/+darshan-landing/+fast-lending/+keystack — реальные CI, которые раньше никто не
babysit'ил). Остальная логика скрипта (gh api на дефолтную ветку, диагноз/фикс через `claude -p`,
никогда не пушит в main) — не менялась.

## ~/.claude/scripts/keystack-export-track-a.sh (FORGE wave1, story 6) — track-a-paths.txt из БД
Живёт ВНЕ репо (как keystack-scan.sh/export-table.sh) — общий инструмент, детерминированный
bash+sqlite3, БЕЗ LLM. `SELECT local_path FROM projects WHERE track='A' AND local_path != ''` →
`~/.claude/track-a-paths.txt` (один путь на строку, env `TRACK_A_FILE` — тестовый seam). Единственное
назначение — дать быстрому PreToolUse-хуку (`phase0-gate.sh`, ниже) список Track A путей БЕЗ
обращения к sqlite3 на каждый Edit. Первый прогон 11.07: 8 путей (architect-portfolio,
astro-psiholog-web, botseller_saas, youtube-parser, darshan, Faithly, IWANTTOEATAIR, Crewup).

## ~/.claude/hooks/phase0-gate.sh (FORGE wave1, story 6) — PreToolUse гейт Фазы 0
Живёт ВНЕ репо (`~/.claude/hooks/`), зарегистрирован в `~/.claude/settings.json` →
`hooks.PreToolUse[].matcher == "Write|Edit|MultiEdit"` (второй hook в существующем массиве, рядом
с edit-count хуком). Fail-open warning-механизм (контракт §6): читает `tool_input.file_path` из
`$CLAUDE_TOOL_INPUT` (тот же паттерн, что и `ci-check.sh`) или из stdin-JSON, проверяет попадание
в один из путей `~/.claude/track-a-paths.txt` и наличие заполненного `<project>/.ai-codex/
architecture.md` (тот же >2KB + без `<!-- TEMPLATE -->` критерий, что и `check_doc_flag()` в
keystack-scan.sh). Совпадение (Track A путь БЕЗ architecture.md) → строка `🚦 Track A проект без
Фазы 0 — задумайся об architecture.md` в stderr; ВСЕГДА `exit 0` (никогда не блокирует — только
предупреждает). Молчит (exit 0, ничего не печатает) во всех остальных случаях: файл вне Track A,
`track-a-paths.txt` отсутствует, architecture.md уже заполнен. Никакого sqlite3/LLM/сети внутри —
только чтение текстового файла + `stat`/`grep` на architecture.md, замер: <20мс тёплый прогон
(бюджет спеки — <50мс).

## ~/Library/LaunchAgents/dev.nzt108.keystack-scan.plist (FORGE wave1, story 6) — ночной скан
Ежесуточно в 05:30 локального: `keystack-scan.sh --all --fast && keystack-export-track-a.sh` (второй
шаг держит `track-a-paths.txt` свежим при появлении/переносе Track A проектов, без ручного
перезапуска). Логи — `~/.keystack/logs/keystack-scan-{stdout,stderr}.log`. Установка идемпотентна
(`launchctl unload; launchctl load` — не дублирует job при повторной установке).
