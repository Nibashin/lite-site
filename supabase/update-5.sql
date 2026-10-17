-- アップデート5:釣った魚の料理を記録する
-- SQL Editor に貼って「Run」してください。今までのデータはそのまま残ります。

create table if not exists public.dishes (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  cook        text not null check (char_length(cook) between 1 and 20),
  title       text not null check (char_length(title) between 1 and 40),
  catch_id    uuid references public.catches(id) on delete set null,
  memo        text check (memo is null or char_length(memo) <= 300),
  photo_path  text
);
create index if not exists dishes_catch_id_idx on public.dishes (catch_id);

alter table public.dishes enable row level security;
grant select on public.dishes to anon, authenticated;
drop policy if exists "dishes are readable" on public.dishes;
create policy "dishes are readable" on public.dishes for select to anon, authenticated using (true);

-- 記録できるのは登録済みの名前だけ。消せるのは作った本人だけ
create or replace function public.add_dish(p_name text, p_title text, p_catch_id uuid, p_memo text, p_photo_path text)
returns public.dishes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := trim(p_name);
  r public.dishes;
begin
  if not exists (select 1 from public.profiles where name = v_name) then
    raise exception 'unknown name' using errcode = '28000';
  end if;
  insert into public.dishes (cook, title, catch_id, memo, photo_path)
  values (v_name, trim(p_title), p_catch_id, nullif(trim(p_memo), ''), p_photo_path)
  returning * into r;
  return r;
end;
$$;

create or replace function public.delete_dish(p_name text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.dishes where id = p_id and cook = trim(p_name);
end;
$$;

grant execute on function public.add_dish(text, text, uuid, text, text) to anon;
grant execute on function public.delete_dish(text, uuid) to anon;

do $$
begin
  alter publication supabase_realtime add table public.dishes;
exception when duplicate_object then null;
end $$;
