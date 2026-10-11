-- 館山 夜釣り遠征 釣果ボード用の Supabase セットアップ
-- Supabase ダッシュボード → SQL Editor にまるごと貼り付けて「Run」してください。
--
-- ★ 下の 'tateyama' を、友達だけに教える合言葉に変えてから実行してください。
-- これを実行したあと、続けて update-2.sql も実行してください。

-- 釣果テーブル -------------------------------------------------------------
create table if not exists public.catches (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  angler      text not null check (char_length(angler) between 1 and 20),
  fish        text not null check (char_length(fish) between 1 and 20),
  size_cm     numeric(5,1) check (size_cm is null or (size_cm > 0 and size_cm < 300)),
  comment     text check (comment is null or char_length(comment) <= 200),
  spot        text not null check (spot in ('funakata', 'okinoshima', 'sakata')),
  lat         double precision not null,
  lng         double precision not null,
  photo_path  text
);

alter table public.catches enable row level security;
grant select on public.catches to anon, authenticated;

-- 見るのは誰でもOK。書き込み・削除は下の関数(合言葉チェック付き)経由のみ。
drop policy if exists "catches are readable" on public.catches;
create policy "catches are readable" on public.catches
  for select to anon, authenticated using (true);

-- 合言葉チェック ------------------------------------------------------------
create or replace function public.check_passcode(p_pass text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(p_pass = 'tateyama', false);  -- ★合言葉
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
  r public.catches;
begin
  if not public.check_passcode(p_pass) then
    raise exception 'wrong passcode' using errcode = '28000';
  end if;
  insert into public.catches (angler, fish, size_cm, comment, spot, lat, lng, photo_path)
  values (trim(p_angler), p_fish, p_size_cm, nullif(trim(p_comment), ''), p_spot, p_lat, p_lng, p_photo_path)
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
  if not public.check_passcode(p_pass) then
    raise exception 'wrong passcode' using errcode = '28000';
  end if;
  delete from public.catches where id = p_id;
end;
$$;

grant execute on function public.check_passcode(text) to anon;
grant execute on function public.add_catch(text, text, text, numeric, text, text, double precision, double precision, text) to anon;
grant execute on function public.delete_catch(text, uuid) to anon;

-- 新しい釣果を全員の画面にすぐ反映する(リアルタイム) ---------------------
do $$
begin
  alter publication supabase_realtime add table public.catches;
exception when duplicate_object then null;
end $$;

-- 写真置き場 -----------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catch-photos', 'catch-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "anyone can upload catch photos" on storage.objects;
create policy "anyone can upload catch photos" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'catch-photos');
