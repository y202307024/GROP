-- ═══════════════════════════════════════════════════════════
-- 13. 알림
-- ═══════════════════════════════════════════════════════════
-- notifications : 멤버별 알림 한 줄
-- notify_group_members() : 같은 그룹 멤버에게 한꺼번에 넣기
-- trg_notify_group_join : 그룹 참여는 DB에서 바로 알림 (클라이언트 RPC에 의존하지 않음)
--
-- Supabase SQL Editor에서 이 파일을 실행하세요.
-- Realtime 이 켜져 있어야 새 알림이 바로 빨간 점으로 뜹니다.
-- ═══════════════════════════════════════════════════════════

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid references public.groups(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  type text not null,
  title text not null,
  body text,
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id)
  where read = false;

-- 필터 구독(user_id)이 INSERT에서도 동작하도록 행 전체를 복제합니다.
alter table public.notifications replica identity full;

grant select, insert, update, delete on public.notifications to authenticated;

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
for select to authenticated
using (user_id = auth.uid());

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own" on public.notifications
for delete to authenticated
using (user_id = auth.uid());

-- 같은 그룹 사람에게만 알림 행을 넣을 수 있습니다. (RPC 실패 시 클라이언트 폴백용)
drop policy if exists "notifications_insert_group_member" on public.notifications;
create policy "notifications_insert_group_member" on public.notifications
for insert to authenticated
with check (
  actor_id = auth.uid()
  and group_id is not null
  and public.is_group_member(group_id)
  and (
    user_id = auth.uid()
    or exists (
      select 1 from public.group_members gm
      where gm.group_id = notifications.group_id and gm.user_id = notifications.user_id
    )
    or exists (
      select 1 from public.groups g
      where g.id = notifications.group_id and g.created_by = notifications.user_id
    )
  )
);

-- 멤버 + 방장(created_by)에게 알림을 넣습니다. 본인은 기본으로 빼습니다.
create or replace function public.notify_group_members(
  p_group_id uuid,
  p_type text,
  p_title text,
  p_body text default null,
  p_link text default null,
  p_exclude_self boolean default true
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  n integer := 0;
begin
  if uid is null or p_group_id is null or p_title is null or length(trim(p_title)) = 0 then
    return 0;
  end if;

  -- 방장은 group_members에 빠져 있어도 created_by 로 알림을 받아야 합니다.
  if not public.is_group_member(p_group_id)
     and not exists (
       select 1 from public.groups g
       where g.id = p_group_id and g.created_by = uid
     ) then
    return 0;
  end if;

  insert into public.notifications (user_id, group_id, actor_id, type, title, body, link)
  select distinct t.user_id, p_group_id, uid, p_type, p_title, p_body, p_link
  from (
    select gm.user_id
    from public.group_members gm
    where gm.group_id = p_group_id
    union
    select g.created_by
    from public.groups g
    where g.id = p_group_id and g.created_by is not null
  ) t
  where t.user_id is not null
    and (not p_exclude_self or t.user_id <> uid)
    -- 같은 제목만 막습니다. (파일 A 다음에 파일 B 알림이 2분 안에 무시되지 않게)
    and not exists (
      select 1
      from public.notifications n0
      where n0.user_id = t.user_id
        and n0.group_id = p_group_id
        and n0.actor_id = uid
        and n0.type = p_type
        and n0.title = p_title
        and n0.created_at > now() - interval '2 minutes'
    );

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.notify_group_members(uuid, text, text, text, text, boolean) from public;
grant execute on function public.notify_group_members(uuid, text, text, text, text, boolean) to authenticated;

-- 그룹 참여는 초대한 사람의 브라우저가 꺼져 있어도 DB에서 바로 알립니다.
create or replace function public.notify_on_group_join()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  nick text;
  gname text;
begin
  select coalesce(
    (
      select nullif(trim(gp.nickname), '')
      from public.group_profiles gp
      where gp.group_id = new.group_id and gp.user_id = new.user_id
      limit 1
    ),
    (
      select nullif(trim(p.nickname), '')
      from public.profiles p
      where p.id = new.user_id
      limit 1
    ),
    '멤버'
  )
  into nick;

  select coalesce(nullif(trim(name), ''), '그룹')
  into gname
  from public.groups
  where id = new.group_id;

  -- auth.uid() 대신 NEW.user_id 를 써서, 세션이 없는 경로로 insert 돼도 알림이 갑니다.
  insert into public.notifications (user_id, group_id, actor_id, type, title, body, link)
  select distinct t.user_id,
         new.group_id,
         new.user_id,
         'group_join',
         nick || ' 님이 ' || coalesce(gname, '그룹') || '에 참여했어요',
         null,
         '/group/' || new.group_id::text
  from (
    select gm.user_id
    from public.group_members gm
    where gm.group_id = new.group_id
      and gm.user_id <> new.user_id
    union
    select g.created_by
    from public.groups g
    where g.id = new.group_id
      and g.created_by is not null
      and g.created_by <> new.user_id
  ) t
  where t.user_id is not null
    and not exists (
      select 1
      from public.notifications n0
      where n0.user_id = t.user_id
        and n0.group_id = new.group_id
        and n0.actor_id = new.user_id
        and n0.type = 'group_join'
        and n0.created_at > now() - interval '2 minutes'
    );

  return new;
end;
$$;

drop trigger if exists trg_notify_group_join on public.group_members;
create trigger trg_notify_group_join
after insert on public.group_members
for each row execute function public.notify_on_group_join();

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception
  when duplicate_object then null;
end $$;

comment on table public.notifications is '그룹 문서·참여·AI요약·회의 녹화 알림';
comment on function public.notify_on_group_join() is 'group_members insert 시 기존 멤버·방장에게 참여 알림';
