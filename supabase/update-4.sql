-- アップデート4:釣果へのリアクション(スタンプ)とコメント
-- SQL Editor に貼って「Run」してください。今までのデータはそのまま残ります。

-- リアクション:1人1種類につき1回(もう一度押すと取り消し)
create table if not exists public.reactions (
  catch_id   uuid not null references public.catches(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 20),
  kind       text not null check (kind in ('nice', 'big', 'envy', 'gg')),
  created_at timestamptz not null default now(),
  primary key (catch_id, name, kind)
);

create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  catch_id   uuid not null references public.catches(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 20),
  body       text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);
create index if not exists comments_catch_id_idx on public.comments (catch_id, created_at);

alter table public.reactions enable row level security;
alter table public.comments enable row level security;
grant select on public.reactions, public.comments to anon, authenticated;

drop policy if exists "reactions are readable" on public.reactions;
create policy "reactions are readable" on public.reactions for select to anon, authenticated using (true);
drop policy if exists "comments are readable" on public.comments;
create policy "comments are readable" on public.comments for select to anon, authenticated using (true);

-- 書き込みは登録済みの名前だけ(身内用なのでゆるめ)
create or replace function public.toggle_reaction(p_name text, p_catch_id uuid, p_kind text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := trim(p_name);
begin
  if not exists (select 1 from public.profiles where name = v_name) then
    raise exception 'unknown name' using errcode = '28000';
  end if;
  delete from public.reactions where catch_id = p_catch_id and name = v_name and kind = p_kind;
  if found then
    return false;
  end if;
  insert into public.reactions (catch_id, name, kind) values (p_catch_id, v_name, p_kind);
  return true;
end;
$$;

create or replace function public.add_comment(p_name text, p_catch_id uuid, p_body text)
returns public.comments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := trim(p_name);
  r public.comments;
begin
  if not exists (select 1 from public.profiles where name = v_name) then
    raise exception 'unknown name' using errcode = '28000';
  end if;
  insert into public.comments (catch_id, name, body) values (p_catch_id, v_name, trim(p_body))
  returning * into r;
  return r;
end;
$$;

create or replace function public.delete_comment(p_name text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.comments where id = p_id and name = trim(p_name);
end;
$$;

grant execute on function public.toggle_reaction(text, uuid, text) to anon;
grant execute on function public.add_comment(text, uuid, text) to anon;
grant execute on function public.delete_comment(text, uuid) to anon;

do $$
begin
  alter publication supabase_realtime add table public.reactions;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.comments;
exception when duplicate_object then null;
end $$;
