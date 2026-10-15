-- 筋トレ記録(workout/)用の Supabase セットアップ
-- Supabase ダッシュボード → SQL Editor にまるごと貼り付けて「Run」してください。
--
-- 仕組み:合言葉(アプリの設定画面で入れる文字列)ごとに記録を分けて保存します。
-- テーブルには直接アクセスできず、合言葉つきの関数経由でだけ読み書きできます。
-- 合言葉は好きな文字列でOK。同じ合言葉を入れた端末どうしで記録が共有されます。

create table if not exists public.workout_sets (
  id          uuid primary key,
  owner       text not null,                -- 合言葉のハッシュ
  done_at     timestamptz not null,
  exercise    text not null check (char_length(exercise) between 1 and 30),
  weight_kg   numeric(6,2) not null default 0 check (weight_kg >= 0 and weight_kg < 1000),
  reps        integer not null check (reps >= 0 and reps < 1000),
  note        text check (note is null or char_length(note) <= 200),
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);
create index if not exists workout_sets_owner_idx on public.workout_sets (owner, done_at);

alter table public.workout_sets enable row level security;
revoke all on public.workout_sets from anon, authenticated;

-- 合言葉 → owner キー
create or replace function public.wk_owner(p_pass text)
returns text
language sql
immutable
as $$
  select md5('workout:' || coalesce(p_pass, ''));
$$;

-- 読み込み
create or replace function public.wk_pull(p_pass text)
returns setof public.workout_sets
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_pass is null or char_length(p_pass) < 4 then
    raise exception 'bad passcode' using errcode = '28000';
  end if;
  return query
    select * from public.workout_sets
    where owner = public.wk_owner(p_pass)
    order by done_at;
end;
$$;

-- 追加・更新・削除(まとめて)
-- p_rows: [{id, done_at, exercise, weight_kg, reps, note, updated_at, deleted}, ...]
create or replace function public.wk_upsert(p_pass text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  o text;
  n integer;
begin
  if p_pass is null or char_length(p_pass) < 4 then
    raise exception 'bad passcode' using errcode = '28000';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'bad rows';
  end if;
  o := public.wk_owner(p_pass);

  insert into public.workout_sets (id, owner, done_at, exercise, weight_kg, reps, note, updated_at, deleted)
  select
    (r->>'id')::uuid, o, (r->>'done_at')::timestamptz,
    left(trim(r->>'exercise'), 30),
    coalesce((r->>'weight_kg')::numeric, 0),
    coalesce((r->>'reps')::integer, 0),
    nullif(left(r->>'note', 200), ''),
    coalesce((r->>'updated_at')::timestamptz, now()),
    coalesce((r->>'deleted')::boolean, false)
  from jsonb_array_elements(p_rows) as r
  on conflict (id) do update set
    done_at    = excluded.done_at,
    exercise   = excluded.exercise,
    weight_kg  = excluded.weight_kg,
    reps       = excluded.reps,
    note       = excluded.note,
    updated_at = excluded.updated_at,
    deleted    = excluded.deleted
  where public.workout_sets.owner = excluded.owner
    and public.workout_sets.updated_at <= excluded.updated_at;

  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.wk_pull(text) to anon, authenticated;
grant execute on function public.wk_upsert(text, jsonb) to anon, authenticated;
