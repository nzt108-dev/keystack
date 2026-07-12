# Components — KeyStack

| Модуль | Назначение |
|--------|-----------|
| src/db/schema.ts | SQLite DDL |
| src/db/index.ts | типизированные репозитории + поиск |
| src/mcp/server.ts | MCP stdio сервер (McpServer + registerTool + zod) |
| src/dashboard/server.ts | локальный дашборд (Fastify) |
| src/scan/ | (план) автозаполнение из репо |

## Dependencies
- @modelcontextprotocol/sdk (MCP)
- better-sqlite3 (БД, нативный, prebuild)
- fastify (дашборд)
- zod (схемы инструментов)
- tsx, typescript (dev)

| src/scan/repo.ts | автозаполнение полей из репо (стек/сервисы/git/тесты) |
| scripts/keystack-seed.ts | FORGE wave1 стори 3: досев проектов из CLAUDE.md + track (idempotent, `npx tsx scripts/keystack-seed.ts [--dry-run]`) |

## tests/ (vitest)
db.test.ts (CRUD/search/JSON/keys_ref), scan.test.ts (детект стека), mcp.test.ts (интеграция через MCP client). Изолированная temp БД через tests/setup.ts. `npm test`.

## Внешние механизмы (живут вне репо, читают/пишут ту же БД `~/.keystack/keystack.db`)
FORGE wave1 story 6 (детали — lib.md):
- `~/.claude/scripts/keystack-export-track-a.sh` — БД → `~/.claude/track-a-paths.txt` (список Track A путей)
- `~/.claude/hooks/phase0-gate.sh` — PreToolUse(Write|Edit|MultiEdit) хук, warning если Track A проект без `.ai-codex/architecture.md` (fail-open, никогда не блокирует); зарегистрирован в `~/.claude/settings.json`
- `~/Library/LaunchAgents/dev.nzt108.keystack-scan.plist` — ежесуточно 05:30: `keystack-scan.sh --all --fast` + `keystack-export-track-a.sh`
