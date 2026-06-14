# Routes — KeyStack dashboard (Fastify, localhost:4319)

## Read
| GET | Назначение |
|-----|-----------|
| `/` | HTML-витрина (проекты/скиллы/промпты) + формы |
| `/api/projects` `/api/skills` `/api/prompts` | JSON списки |

## Write (формы дашборда)
| POST | Назначение |
|------|-----------|
| `/api/projects/save` | upsert проекта (create если slug новый) |
| `/api/projects/delete` | удалить `{slug}` |
| `/api/skills/save` `/api/skills/delete` | upsert/delete скилла |
| `/api/prompts/save` `/api/prompts/delete` | upsert/delete промпта |

UI: модалка с формой (project/skill/prompt), auto-slug из name, массивы (frameworks/services/tags) — comma-separated, next_steps — по строкам. Edit/Delete на каждой карточке.
