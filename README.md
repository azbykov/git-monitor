# Git Monitor

Вход через GitHub: каждый пользователь видит свои PR, статусы и статистику.

Единое место для всех моих открытых PR в организации: сразу видно,
где упали чекеры, где конфликты, а где ревьюеры оставили замечания и ждут ответа.

## Что показывает

- **Упали чекеры** — названия упавших CI-проверок со ссылкой на лог.
- **Конфликты** — PR, которые не вливаются в базовую ветку.
- **Замечания** — неразрешённые треды ревью, где последнее слово не за мной, и `changes requested`.
  Треды, где я уже ответил, считаются «ждут ревьюера».
- **Долго без ревью** — PR никто не смотрел дольше `REVIEW_SLA_HOURS` рабочих часов
  (по умолчанию 48, выходные не считаются), или я ответил на замечания, а ревьюер молчит.

Страница **/analytics** — мои PR за 90 дней: открытые по репозиториям и статусам,
открыто/смержено по неделям, время до первого ревью по репозиториям,
время до мержа по размеру PR, таблица ревьюеров.

PR разложены по секциям: «Требуют моих действий» → «Ждут других» → «Готовы к мержу» → «Черновики».
Страница обновляется раз в 2 минуты (пока вкладка открыта).

Страница **/feedback** — «что мне пишут на ревью»: замечания других людей к моим PR
за полгода (синхронизация по кнопке) хранятся в Postgres — кто и где чаще пишет, лента последних.
AI-разбор по темам (OpenAI Agents SDK) пока скрыт, включается `AI_ANALYSIS_ENABLED=true`.

## Авторизация

- [Auth.js v5](https://authjs.dev) с провайдером GitHub (`src/auth.ts`), scope `read:user repo read:org`.
- Сессия — JWT в зашифрованной cookie (`AUTH_SECRET`), базы пользователей нет. GitHub-токен сохраняется в JWT
  в колбэке `jwt` и **не** попадает в `session` — тот уходит в браузер через `/api/auth/session`.
- Серверный код достаёт токен через `src/lib/session.ts` (`getToken` + `decode`).
- `src/proxy.ts` — `auth()` из Auth.js: без сессии отправляет на `/login`; страницы и экшены дополнительно
  проверяют сессию через `requireSession()`.
- Кэш запросов к GitHub (`use cache: remote`) — на пользователя: в ключ попадает зашифрованная cookie, не токен.

## Как устроено

- `src/lib/github.ts` — один GraphQL-запрос: `is:pr is:open author:@me org:<ORG>`
  со статусами чекеров, review threads и последними ревью.
- `src/lib/org.ts` — список организаций и выбранная организация (cookie).
- `src/lib/attention.ts` — правила: какие проблемы у PR и в какую секцию он попадает.
- `src/lib/history.ts` + `src/lib/analytics.ts` — история PR и расчёт метрик (чистые функции).
- `src/lib/comments.ts` — сбор замечаний из GitHub и upsert в `review_comments`.
- `src/lib/feedback.ts` — агент со structured output (zod), подсчёт тем, запись в `feedback_analyses`.
- `db/schema.sql` — схема БД, применяется `pnpm db:migrate`.
- `src/components/charts.tsx` — простые графики на HTML/CSS без библиотек.
- `src/app/page.tsx` — серверный рендер, фильтры через `?filter=checks|conflicts|comments`.
- `src/proxy.ts` — без cookie сессии отправляет на `/login`.

## Запуск

```bash
cp .env.example .env.local   # заполнить переменные
createdb git_monitor         # локальный Postgres
pnpm db:migrate
pnpm dev
```

## Деплой на Vercel

1. Создать отдельное GitHub OAuth App с callback `https://<домен>/api/auth/callback/github`.
2. Импортировать репозиторий в Vercel, в Storage подключить Neon Postgres (появится `DATABASE_URL`)
   и применить схему: `DATABASE_URL=... pnpm db:migrate`.
3. Задать `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `AUTH_SECRET`.
