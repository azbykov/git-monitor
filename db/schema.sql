-- Замечания, оставленные другими людьми на мои PR
create table if not exists review_comments (
  id          text primary key,          -- GitHub node id: повторная синхронизация не создаёт дублей
  kind        text not null,             -- 'thread' (комментарий к строке кода) | 'review' (общий текст ревью)
  repo        text not null,
  pr_number   int  not null,
  pr_title    text not null,
  pr_url      text not null,
  author      text not null,
  path        text,                      -- файл, для kind = 'thread'
  diff_hunk   text,                      -- кусок diff, к которому оставлен комментарий
  body        text not null,
  url         text not null,
  created_at  timestamptz not null,
  synced_at   timestamptz not null default now()
);
create index if not exists review_comments_created_at on review_comments (created_at desc);

-- Результаты LLM-анализа: каждый запуск — отдельная запись, чтобы видеть динамику
create table if not exists feedback_analyses (
  id             serial primary key,
  created_at     timestamptz not null default now(),
  model          text not null,
  comments_count int  not null,
  period_from    timestamptz not null,
  period_to      timestamptz not null,
  result         jsonb not null
);

-- Анализ делается отдельно для каждой организации; '' — по всем
alter table feedback_analyses add column if not exists org text not null default '';

-- Многопользовательский режим: чьи это данные (логин GitHub автора PR)
alter table review_comments add column if not exists user_login text not null default '';
create index if not exists review_comments_user on review_comments (user_login, created_at desc);
alter table feedback_analyses add column if not exists user_login text not null default '';
