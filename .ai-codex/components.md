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
