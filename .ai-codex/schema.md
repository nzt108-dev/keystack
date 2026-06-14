# Schema — KeyStack (SQLite)

БД: `~/.keystack/keystack.db` (better-sqlite3, WAL). DDL: `src/db/schema.ts`.

## projects
slug (UNIQUE), name, description, stage (idea|mvp|active|paused|shipped),
language, frameworks (JSON[]), database, services (JSON[]),
tests_status (none|partial|green), tests_note, github_url,
next_steps (JSON[]), keys_ref (путь, НЕ значения), local_path, last_touched, created_at

## skills
slug (UNIQUE), name, description, what_it_does, location, tags (JSON[]), created_at, updated_at

## prompts
slug (UNIQUE), name, description, category, body, tags (JSON[]), created_at, updated_at

> JSON-массивы хранятся как TEXT, (де)сериализация в `src/db/index.ts`.
> Down: удалить `~/.keystack/keystack.db*`.
