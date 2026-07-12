# Components — KeyStack

| Модуль | Назначение |
|--------|-----------|
| src/db/schema.ts | SQLite DDL |
| src/db/index.ts | типизированные репозитории + поиск |
| src/mcp/server.ts | MCP stdio сервер (McpServer + registerTool + zod) |
| src/dashboard/server.ts | локальный дашборд (Fastify) |
| src/dashboard/flowmap.ts | read-модель `.flowmap/` артефактов для `/map/:slug` (spec-live-map.md story 1) |
| src/scan/ | (план) автозаполнение из репо |

## Dependencies
- @modelcontextprotocol/sdk (MCP)
- better-sqlite3 (БД, нативный, prebuild)
- fastify (дашборд)
- zod (схемы инструментов)
- mermaid (dev) — источник vendored browser-бандла (`src/dashboard/vendor/mermaid.min.js`, версия
  зафиксирована `^11.16.0` == та же, что уже используется в architect-portfolio); в рантайме из
  Node-кода НЕ импортируется, нужен только чтобы `npm install` детерминированно давал тот же
  `dist/mermaid.min.js`, который закоммичен в репо
- tsx, typescript (dev)

| src/scan/repo.ts | автозаполнение полей из репо (стек/сервисы/git/тесты) |
| scripts/keystack-seed.ts | FORGE wave1 стори 3: досев проектов из CLAUDE.md + track (idempotent, `npx tsx scripts/keystack-seed.ts [--dry-run]`) |

## tests/ (vitest)
db.test.ts (CRUD/search/JSON/keys_ref), scan.test.ts (детект стека), mcp.test.ts (интеграция через MCP client). Изолированная temp БД через tests/setup.ts. `npm test`.

## scripts/*.sh (vendored, CI-фикс 2026-07-11) — общие инструменты, читают/пишут ту же БД `~/.keystack/keystack.db`
FORGE wave1 story 2/3/5/6 (детали — lib.md). Живут ВНУТРИ этого репо (`scripts/`), чтобы CI (GitHub
Actions runner, нет `~/.claude/`) мог запускать fixture-тесты напрямую; `~/.claude/scripts/` держит
только симлинки на эти файлы (`ln -sf`) для остальных machine-local потребителей:
- `scripts/keystack-scan.sh` — dev-state сканер
- `scripts/keystack-export-table.sh` — БД → таблица «🗂️ Проекты» в CLAUDE.md
- `scripts/keystack-export-track-a.sh` — БД → `~/.claude/track-a-paths.txt` (список Track A путей)
- `scripts/keystack-sync-skills.sh` — sync таблицы skills из `~/.claude/skills/*/SKILL.md`

## Внешние механизмы (живут вне репо, читают/пишут ту же БД `~/.keystack/keystack.db`)
- `~/.claude/hooks/phase0-gate.sh` — PreToolUse(Write|Edit|MultiEdit) хук, warning если Track A проект без `.ai-codex/architecture.md` (fail-open, никогда не блокирует); зарегистрирован в `~/.claude/settings.json`
- `~/Library/LaunchAgents/dev.nzt108.keystack-scan.plist` — ежесуточно 05:30: (симлинк) `keystack-scan.sh --all --fast` + `keystack-export-track-a.sh`
