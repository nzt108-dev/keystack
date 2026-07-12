# Schema — KeyStack (SQLite)

БД: `~/.keystack/keystack.db` (better-sqlite3, WAL). DDL: `src/db/schema.ts`.
Миграции: `getDb()` делает `ALTER TABLE ADD COLUMN` для tasks/type/blockers и FORGE wave1 полей
(для старых БД) — идемпотентно на каждом старте, потери данных нет (10 существующих проектов
проверены живым смоуком через `dist/mcp/server.js`). Новая таблица `specs` создаётся через
`CREATE TABLE IF NOT EXISTS` в `SCHEMA` — отдельной ALTER-миграции не требует.

Досеяно (story 3, 11.07): 30 проектов (10 старых + 20 новых из таблицы CLAUDE.md), track
проставлен (8×A / 22×B), первый `--all --fast` прогнан (`scripts/keystack-seed.ts`,
`scripts/keystack-sync-skills.sh` — см. `.ai-codex/lib.md`).

## projects
slug (UNIQUE), name, description,
type (mobile|web|saas|bot|cli|api|library|desktop),
stage (idea|mvp|active|paused|shipped),
blockers (JSON[] строк — must-know до запуска),
language, frameworks (JSON[]), database,
services (JSON[] объектов `{provider, account?}` — аккаунт сервиса),
tasks (JSON[] объектов `{text, done, category?}` — category: frontend|backend|design|devops|qa|infra|content),
tests_status (none|partial|green), tests_note, github_url,
next_steps (JSON[] — legacy), keys_ref (путь, НЕ значения), local_path, last_touched, created_at

**FORGE wave1 contract (§2.2)** — dev-state поля, заполняются `keystack-scan.sh` (Волна 1, стори 2+),
read-model для агентов/дашборда:
track ('A'|'B', default 'B'), has_architecture/has_invariants/has_design_md/has_ci (0/1, default 0),
tests_count (int, default 0), tests_green (0/1, default 0), last_audit_date (текст ISO дата, default ''),
open_crit/open_high (int, default 0), health_score (int, default 0, формула §4.2 — считается ТОЛЬКО в scan-скрипте).

## specs (новое, FORGE wave1)
Реестр `.ai-codex/specs/*.md` по проектам — read-model скана, источник правды остаётся файл спеки
(keystack никогда не пишет статус стори обратно в .md).
project_slug (NOT NULL), file (относит. путь, NOT NULL), title (default ''),
stories_total/stories_done (int, default 0), has_block (0/1, default 0),
updated_at (mtime файла спеки, ISO UTC), scanned_at (время последнего скана, ISO UTC).
Уникальность: (project_slug, file). Индекс: project_slug.
«Открытая» спека (v1, не хранится колонкой — вычисляется в MCP-слое, стори 4): stories_done < stories_total ИЛИ stories_total == 0.

## skills
slug (UNIQUE), name, description, what_it_does, location, tags (JSON[]), created_at, updated_at

## prompts
slug (UNIQUE), name, description, category, body, tags (JSON[]), created_at, updated_at

> JSON-колонки хранятся как TEXT, (де)сериализация в `src/db/index.ts`.
> Backward-compat: services как строки нормализуются в `{provider}`; tasks-строки в `{text,done:false}`.
> Down: удалить `~/.keystack/keystack.db*`.
