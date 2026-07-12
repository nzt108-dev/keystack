# Routes — KeyStack dashboard (Fastify, localhost:4319)

## Read
| GET | Назначение |
|-----|-----------|
| `/` | HTML-витрина (проекты/скиллы/промпты) + формы |
| `/api/projects` `/api/skills` `/api/prompts` | JSON списки |
| `/map/:slug` | Живая карта проекта (spec-live-map.md story 1): рендер `flowmap.mmd` через vendored Mermaid + сводка вердиктов (CRIT/WARN) + список issues. Читает `<local_path>/.flowmap/` живьём при каждом запросе (не из БД-полей has_flowmap/map_*, те — только для бейджа карточки). Неизвестный slug → 404 с текстом «не найден». Нет `.flowmap/` → плашка «прогони /sync» (200, не ошибка). `flowmap.mmd` битый/пустой/отсутствует → плашка `.map-error` (200). Артефакты старше 7 дней (`FLOWMAP_STALE_DAYS`) → бейдж «устарела». |
| `/vendor/mermaid.min.js` | Vendored Mermaid browser bundle (npm `mermaid` package dist, НЕ CDN — дашборд работает офлайн). Читается из `src/dashboard/vendor/` (dev) / `dist/dashboard/vendor/` (prod, копируется билд-скриптом), кэшируется в памяти после первого запроса. |

## Write (формы дашборда)
| POST | Назначение |
|------|-----------|
| `/api/projects/save` | upsert проекта (create если slug новый) |
| `/api/projects/delete` | удалить `{slug}` |
| `/api/skills/save` `/api/skills/delete` | upsert/delete скилла |
| `/api/prompts/save` `/api/prompts/delete` | upsert/delete промпта |

UI: модалка с формой (project/skill/prompt), auto-slug из name, массивы (frameworks/services/tags) — comma-separated, next_steps — по строкам. Edit/Delete на каждой карточке.
Story 1 (live map): карточка проекта с `has_flowmap=1` показывает ссылку «🗺 карта» → `/map/:slug`, плюс бейдж `N CRIT` рядом с ней, если `map_crit>0`. Проекты без `has_flowmap` — без ссылки (нечего показывать, ссылка появляется только когда есть что открыть).
