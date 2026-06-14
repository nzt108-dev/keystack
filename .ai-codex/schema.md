# Schema — KeyStack (SQLite)

БД: `~/.keystack/keystack.db` (better-sqlite3, WAL). DDL: `src/db/schema.ts`.
Миграции: `getDb()` делает `ALTER TABLE ADD COLUMN` для tasks/type/blockers (для старых БД).

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

## skills
slug (UNIQUE), name, description, what_it_does, location, tags (JSON[]), created_at, updated_at

## prompts
slug (UNIQUE), name, description, category, body, tags (JSON[]), created_at, updated_at

> JSON-колонки хранятся как TEXT, (де)сериализация в `src/db/index.ts`.
> Backward-compat: services как строки нормализуются в `{provider}`; tasks-строки в `{text,done:false}`.
> Down: удалить `~/.keystack/keystack.db*`.
