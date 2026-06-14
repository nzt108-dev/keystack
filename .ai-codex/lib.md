# Lib — KeyStack

## src/db/index.ts — репозитории
| Функция | Описание |
|---------|---------|
| getDb() | соединение + init схемы (idempotent) |
| listProjects/getProject(slug)/createProject/updateProject(slug,patch)/searchProjects(q) | проекты |
| listSkills/getSkill(slug)/upsertSkill | скиллы |
| listPrompts/getPrompt(slug)/upsertPrompt | промпты |

updateProject — частичный апдейт (только переданные поля), бампает last_touched.
upsert* — insert или update по slug.

## src/mcp/server.ts — 11 MCP-инструментов
read: list_projects, get_project, search_projects, list_skills, get_skill, list_prompts, get_prompt
write: create_project, update_project, upsert_skill, upsert_prompt
> stdout = JSON-RPC → логи только в stderr (console.error).

## src/dashboard/server.ts — Fastify
GET / (HTML витрина), /api/projects, /api/skills, /api/prompts. Порт 4319.

## src/scan/repo.ts — автозаполнение
scanRepo(dir) → { language, frameworks, database, services, github_url, tests_status, detected_from }.
Читает package.json/pubspec/requirements/pyproject/Cargo/go.mod, .env.example (сервисы по префиксам), git remote. Pure read.
MCP-инструмент `scan_repo { path }` отдаёт предложение; агент подтверждает → create_project.

## db: формы дашборда
upsertProject, deleteProject, deleteSkill, deletePrompt (+ существующие create/update/upsert).
