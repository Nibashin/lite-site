-- アップデート2(プロフィールアイコン・スケジュール・初期位置の保存)
-- すでに setup.sql を実行済みのプロジェクトで、これを SQL Editor に貼って「Run」してください。
-- 合言葉や今までの釣果はそのまま残ります。

-- プロフィール(名前とアイコン) ------------------------------------------------
create table if not exists public.profiles (
  name        text primary key check (char_length(name) between 1 and 20),
  avatar_path text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;
grant select on public.profiles to anon, authenticated;

drop policy if exists "profiles are readable" on public.profiles;
create policy "profiles are readable" on public.profiles
  for select to anon, authenticated using (true);

-- すでに釣果を登録した名前は「登録済み」にしておく
insert into public.profiles (name)
select distinct angler from public.catches
on conflict (name) do nothing;

-- 一度登録された名前なら合言葉なしでOK(身内用なのでゆるめ)
create or replace function public.save_profile(p_pass text, p_name text, p_avatar_path text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := trim(p_name);
  r public.profiles;
begin
  if not exists (select 1 from public.profiles where name = v_name)
     and not public.check_passcode(p_pass) then
    raise exception 'wrong passcode' using errcode = '28000';
  end if;
  insert into public.profiles (name, avatar_path)
  values (v_name, p_avatar_path)
  on conflict (name) do update
    set avatar_path = coalesce(excluded.avatar_path, public.profiles.avatar_path),
        updated_at = now()
  returning * into r;
  return r;
end;
$$;

create or replace function public.add_catch(
  p_pass       text,
  p_angler     text,
  p_fish       text,
  p_size_cm    numeric,
  p_comment    text,
  p_spot       text,
  p_lat        double precision,
  p_lng        double precision,
  p_photo_path text
)
returns public.catches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := trim(p_angler);
  r public.catches;
begin
  if not exists (select 1 from public.profiles where name = v_name)
     and not public.check_passcode(p_pass) then
    raise exception 'wrong passcode' using errcode = '28000';
  end if;
  insert into public.profiles (name) values (v_name) on conflict (name) do nothing;
  insert into public.catches (angler, fish, size_cm, comment, spot, lat, lng, photo_path)
  values (v_name, p_fish, p_size_cm, nullif(trim(p_comment), ''), p_spot, p_lat, p_lng, p_photo_path)
  returning * into r;
  return r;
end;
$$;

create or replace function public.delete_catch(p_pass text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.check_passcode(p_pass)
     and not exists (
       select 1 from public.catches c join public.profiles p on p.name = c.angler where c.id = p_id
     ) then
    raise exception 'wrong passcode' using errcode = '28000';
  end if;
  delete from public.catches where id = p_id;
end;
$$;

grant execute on function public.save_profile(text, text, text) to anon;

-- スケジュールや地図の初期位置など、みんなで編集する設定 ------------------
create table if not exists public.kv (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.kv enable row level security;
grant select, insert, update on public.kv to anon, authenticated;

drop policy if exists "kv readable" on public.kv;
create policy "kv readable" on public.kv for select to anon, authenticated using (true);
drop policy if exists "kv insertable" on public.kv;
create policy "kv insertable" on public.kv for insert to anon, authenticated with check (true);
drop policy if exists "kv updatable" on public.kv;
create policy "kv updatable" on public.kv for update to anon, authenticated using (true) with check (true);

-- リアルタイム反映 ------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.kv;
exception when duplicate_object then null;
end $$;
