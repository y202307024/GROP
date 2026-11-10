-- 그룹 공지
-- notices : 제목, 내용, 작성자, 고정 여부
--
-- 멤버는 읽고, 그룹을 만든 사람과 가장 먼저 가입한 리더만 등록·수정·삭제합니다.
-- 고정 공지는 그룹당 하나라서, 새로 고정하면 이전 고정은 풀립니다.
-- 이미 있으면 없는 칸만 보태고 그대로 둡니다.

create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null,
  content text not null default '',
  author_id uuid not null references auth.users(id) on delete cascade,
  is_pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notices
  add column if not exists content text not null default '';
alter table public.notices
  add column if not exists is_pinned boolean not null default false;
alter table public.notices
  add column if not exists updated_at timestamptz not null default now();

create index if not exists notices_group_created_idx
  on public.notices (group_id, created_at desc);

-- 화면의 리더(가입이 가장 빠른 멤버)와 그룹을 만든 사람
create or replace function public.is_group_leader(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.groups g
      where g.id = p_group_id and g.created_by = auth.uid()
    )
    or exists (
      select 1 from public.group_members gm
      where gm.group_id = p_group_id
        and gm.user_id = auth.uid()
        and not exists (
          select 1 from public.group_members earlier
          where earlier.group_id = gm.group_id
            and (earlier.joined_at, earlier.user_id) < (gm.joined_at, gm.user_id)
        )
    );
$$;

revoke all on function public.is_group_leader(uuid) from public;
grant execute on function public.is_group_leader(uuid) to authenticated;

-- 새로 고정한 공지만 남기고, 수정 시각을 갱신합니다.
create or replace function public.notices_keep_one_pin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  if new.is_pinned then
    update public.notices
    set is_pinned = false
    where group_id = new.group_id
      and id <> new.id
      and is_pinned;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notices_keep_one_pin on public.notices;
create trigger trg_notices_keep_one_pin
before insert or update on public.notices
for each row execute function public.notices_keep_one_pin();

grant select, insert, update, delete on public.notices to authenticated;

alter table public.notices enable row level security;

drop policy if exists "notices_select_member" on public.notices;
create policy "notices_select_member" on public.notices
for select to authenticated
using (public.is_group_member(group_id));

drop policy if exists "notices_insert_leader" on public.notices;
create policy "notices_insert_leader" on public.notices
for insert to authenticated
with check (
  author_id = auth.uid()
  and public.is_group_leader(group_id)
);

drop policy if exists "notices_update_leader" on public.notices;
create policy "notices_update_leader" on public.notices
for update to authenticated
using (public.is_group_leader(group_id))
with check (public.is_group_leader(group_id));

drop policy if exists "notices_delete_leader" on public.notices;
create policy "notices_delete_leader" on public.notices
for delete to authenticated
using (public.is_group_leader(group_id));

comment on table public.notices is '그룹 공지. 리더와 그룹을 만든 사람만 등록합니다.';
