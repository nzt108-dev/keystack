# Spec: Флит-телеметрия — «приборная панель» всех прод-проектов

> Файл: `keystack/.ai-codex/specs/spec-fleet-telemetry.md` (лежит в keystack, т.к. панель — флитовая, не проектная; Волна 2 сведёт её в дашборд keystack).
> Источник: решение владельца 11.07 — «как в машине: лампочка мигнула → сразу видно, что отвалилось». Инциденты-обоснования: 6 дней молчания дайджестов BriefTube; Flow-синк тихо копил очередь после ротации ключа; no-op админ-кнопки Faithly в проде.
> Автор: Fable 5, 2026-07-11. Исполнение: Sonnet-агенты + ~30 мин владельца на регистрации.

---

## Что делает (поведение)

Три слоя лампочек, все алерты — в ОДИН приватный TG-канал «🚨 Борт»:

1. **Ошибки кода (Check Engine) — Sentry** (free 5k событий/мес): каждое необработанное исключение на проде → событие со стеком, релизом, юзер-контекстом (без PII). Проекты и SDK:
   - Next.js/Vercel: crewup, iwanttoeatair, darshan, astro-psiholog, architect-portfolio (`@sentry/nextjs`, обязательно source maps через Vercel-интеграцию)
   - FastAPI/VPS: botseller, brieftube, fast-lending (`sentry-sdk[fastapi]`)
   - Flutter: flow (`sentry_flutter`); **faithly — НЕ Sentry, а Crashlytics** (Firebase уже стоит)
2. **Живость (фара) — UptimeRobot** (free, 50 мониторов, 5 мин): публичные URL всех прод-сайтов + healthcheck-эндпоинты API (`/health` — где нет, добавить: отвечает 200 + проверка коннекта к БД). Telegram-интеграция встроенная.
3. **Тихая смерть (пульс) — healthchecks.io** (free 20 чеков): dead-man switch для всего периодического. Каждый cron/scheduler в КОНЦЕ успешного прогона дёргает свой ping-URL; нет пульса в grace-период → алерт. Чеки:
   - brieftube: digest_send (daily), ингест-цикл (hourly)
   - botseller: process_pending_invoices, Celery beat
   - crewup: оба Vercel-крона + будущий stripe-reconcile
   - darshan: wisdom-cron
   - Mac-локальное: keystack ночной скан (Волна 1), Obsidian inbox-router LaunchAgent
   - fast-lending: обзвон-джобы

## Кто использует

Владелец — читает канал «Борт» (или дальше keystack-дашборд), больше ничего делать не должен. Агенты — при старте сессии по проекту можно спросить Sentry API «что горит» (Волна 2).

## Порядок (ранбук)

1. **Владелец, ~30 мин, один раз**: создать TG-канал «Борт»; зарегистрировать Sentry (одна org, project на приложение), UptimeRobot, healthchecks.io; все DSN/API-ключи → `secret.sh set fleet ...`.
2. Sonnet-волна А (по проекту на стори): вшить SDK + `/health` эндпоинты. Правила: `tracesSampleRate ≤ 0.1` (не жечь квоту), `send_default_pii=false` + scrub (инвариант «в логах нет PII»), environment=production only (dev не шумит), release из git sha.
3. Sonnet-волна Б: пульсы в кроны (одна строка `curl -fsS -m 10 --retry 3 $PING_URL` в конец каждой джобы; URL из env, отсутствует → тихо пропустить, не падать).
4. Роутинг: Sentry/UptimeRobot/healthchecks → TG-канал (у всех есть готовые интеграции/вебхуки).
5. Смоук каждой лампочки: искусственная ошибка → пришла в канал; остановить cron → пришёл алерт пульса; уронить /health → алерт uptime. **Лампочка, которую не проверили, что она горит — не лампочка** (урок no-op кнопок).

## Edge cases

- [ ] Квота Sentry забита одним циклом ошибок → rate-limit на клиенте (sample + dedup), алерт о throttling.
- [ ] Ping-URL недоступен (healthchecks лёг) → cron НЕ падает (`|| true`), пульс не критичный путь.
- [ ] Секреты: DSN — публичные по природе (клиентские), но API-ключи только через secret.sh; ничего в git.
- [ ] Flutter web-вариантов нет; мобильные краши Flow — sentry_flutter, симуляция краша перед TestFlight.
- [ ] VPS-боты (long-polling): /health невозможен → пульс-чек «бот жив» (периодический self-ping джобой изнутри).
- [ ] Vercel preview-деплои не должны слать в prod-Sentry (environment guard).

## Scope boundary

- НЕ свой мониторинг-сервис, не Grafana/Prometheus (overkill для флита такого размера).
- Метрики продукта (funnel, retention) — не сюда, это /funnel и аналитика.
- Интеграция статусов в keystack-дашборд — Волна 2 (после spec-forge-wave1).
- APM/трейсинг производительности — выключен в v1 (sample 0.1 хватит).

## DoD

- [ ] Канал «Борт» получает события всех трёх типов (смоук по каждому проекту зафиксирован списком)
- [ ] 8 прод-проектов покрыты слоем 1; все публичные URL — слоем 2; все кроны — слоем 3
- [ ] PII-scrub проверен (тестовое событие не содержит email/имён)
- [ ] Ключи в secret.sh (`fleet`), имена задокументированы в keystack `.ai-codex/env.md`
- [ ] В каждый проектный `.ai-codex/architecture.md` добавлена строка «Телеметрия: Sentry <project> / пульсы <чеки>»

## Clarify-гейт

- **BLOCK**: регистрации сервисов + TG-канал — только владелец (шаг 1). До этого исполнение не начинать.
- MINOR: (1) Sentry free (не self-hosted GlitchTip — меньше возни, объёмы малы); (2) один общий канал, не по-проектно (флит мал, шум лечится настройкой); (3) faithly через Crashlytics, не плодить второй SDK.

## Стори

| # | Стори | Сложность | Статус |
|---|-------|-----------|--------|
| 0 | Владелец: регистрации + канал + ключи в secret.sh | S (руками) | ⬜ |
| 1 | Next.js-пятёрка: Sentry SDK + /health + смоук | M | ⬜ |
| 2 | FastAPI-тройка: Sentry SDK + /health + смоук | M | ⬜ |
| 3 | Пульсы во все кроны + UptimeRobot-мониторы + роутинг в TG | M | ⬜ |
| 4 | Flow (sentry_flutter) + Faithly (Crashlytics-алерты в канал) | M | ⬜ |
