# KeyStack — Current Status

**Версия:** 0.3.0
**Статус:** MVP готов, публичный репо
**Репо:** https://github.com/nzt108-dev/keystack
**Обновлено:** 2026-06-14 (908c6ee)

## Что работает
- MCP-сервер (stdio): 12 инструментов read+write+scan — подключён к Claude Code (✔)
- Дашборд (localhost:4319): витрина + CRUD-формы + detail-view по клику
- Автозаполнение стека из репо; модель с type/blockers/tasks(категории)/services(аккаунты)
- Тесты: 24 (vitest), CI на GitHub Actions

## Блокеры
- нет

## Дальше
- Демо-ролик под контент; опц. публикация в npm (npx keystack); Phase 2 — облачная синхра (отложено, ADR-001 local-first)
