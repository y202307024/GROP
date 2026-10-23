-- ═══════════════════════════════════════════════════════════
-- 09. 그룹 권한 · 공지 · 예약 · 그룹 프사 · 멤버 강퇴
-- Supabase SQL Editor에서 Run 하세요.
-- ═══════════════════════════════════════════════════════════

-- ── 그룹 프사 ───────────────────────────────────────────────
alter table public.groups
  add column if not exists avatar_url text;

-- ── 방장 판별 RPC ───────────────────────────────────────────
create or replace function public.is_group_owner(p_group_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.groups g
    where g.id = p_group_id and g.created_by = auth.uid()
  );
$$;

revoke all on function public.is_group_owner(uuid) from public;
grant execute on function public.is_group_owner(uuid) to authenticated;

-- ── 그룹 권한 설정 (1그룹 1행) ───────────────────────────────
create table if not exists public.group_settings (
  group_id uuid primary key references public.groups(id) on delete cascade,
  members_can_record boolean not null default true,
  members_can_draw boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.group_settings enable row level security;
grant select, insert, update on public.group_settings to authenticated;

-- 기존 그룹에 기본 설정 행 생성
insert into public.group_settings (group_id)
select id from public.groups
on conflict (group_id) do nothing;

drop policy if exists "group_settings_select_member" on public.group_settings;
create policy "group_settings_select_member" on public.group_settings
for select to authenticated
using (public.is_group_member(group_id));

drop policy if exists "group_settings_insert_owner" on public.group_settings;
create policy "group_settings_insert_owner" on public.group_settings
for insert to authenticated
with check (public.is_group_owner(group_id));

drop policy if exists "group_settings_update_owner" on public.group_settings;
create policy "group_settings_update_owner" on public.group_settings
for update to authenticated
using (public.is_group_owner(group_id))
with check (public.is_group_owner(group_id));

-- 그룹 생성 시 settings 자동 생성
create or replace function public.ensure_group_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.group_settings (group_id)
  values (new.id)
  on conflict (group_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_ensure_group_settings on public.groups;
create trigger trg_ensure_group_settings
after insert on public.groups
for each row execute function public.ensure_group_settings();

-- ── 공지사항 ────────────────────────────────────────────────
create table if not exists public.group_announcements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null default '',
  body text not null default '',
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create index if not exists group_announcements_group_updated_idx
  on public.group_announcements (group_id, updated_at desc);

alter table public.group_announcements enable row level security;
grant select, insert, update, delete on public.group_announcements to authenticated;

-- 멤버: 게시된 공지 읽기 / 방장: 전부 읽기
drop policy if exists "announcements_select_member" on public.group_announcements;
create policy "announcements_select_member" on public.group_announcements
for select to authenticated
using (
  public.is_group_member(group_id)
  and (
    published_at is not null
    or public.is_group_owner(group_id)
  )
);

drop policy if exists "announcements_insert_owner" on public.group_announcements;
create policy "announcements_insert_owner" on public.group_announcements
for insert to authenticated
with check (public.is_group_owner(group_id) and created_by = auth.uid());

drop policy if exists "announcements_update_owner" on public.group_announcements;
create policy "announcements_update_owner" on public.group_announcements
for update to authenticated
using (public.is_group_owner(group_id))
with check (public.is_group_owner(group_id));

drop policy if exists "announcements_delete_owner" on public.group_announcements;
create policy "announcements_delete_owner" on public.group_announcements
for delete to authenticated
using (public.is_group_owner(group_id));

-- ── 멤버 강퇴 / 탈퇴 DELETE 정책 ────────────────────────────
drop policy if exists "group_members_delete_self_or_owner" on public.group_members;
create policy "group_members_delete_self_or_owner" on public.group_members
for delete to authenticated
using (
  user_id = auth.uid()
  or public.is_group_owner(group_id)
);

-- ── 멤버 목록에 is_owner 표시 ───────────────────────────────
-- 반환 컬럼이 늘어나므로 REPLACE 전에 DROP 필요합니다.
drop function if exists public.get_group_members_with_profiles(uuid);

create or replace function public.get_group_members_with_profiles(p_group_id uuid)
returns table (
  id uuid,
  user_id uuid,
  joined_at timestamptz,
  nickname text,
  avatar text,
  is_owner boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select gm.id, gm.user_id, gm.joined_at,
         coalesce(p.nickname, '') as nickname,
         coalesce(p.avatar, '🐱') as avatar,
         (g.created_by = gm.user_id) as is_owner
  from public.group_members gm
  left join public.profiles p on p.id = gm.user_id
  left join public.groups g on g.id = gm.group_id
  where gm.group_id = p_group_id
    and public.is_group_member(p_group_id)
  order by (g.created_by = gm.user_id) desc, gm.joined_at asc;
$$;

revoke all on function public.get_group_members_with_profiles(uuid) from public;
grant execute on function public.get_group_members_with_profiles(uuid) to authenticated;

comment on table public.group_settings is '그룹 권한 — 멤버 녹화/판서 허용 여부';
comment on table public.group_announcements is '그룹 공지 — 방장만 작성·게시';
comment on column public.groups.avatar_url is '그룹 대표 이미지 URL';
