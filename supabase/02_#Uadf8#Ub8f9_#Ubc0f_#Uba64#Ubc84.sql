-- ═══════════════════════════════════════════════════════════
-- 02. 그룹 & 멤버
-- ═══════════════════════════════════════════════════════════
-- groups        : 사용자가 만든 팀. 초대코드로 참여합니다.
-- group_members : 누가 어느 그룹에 속하는지
-- 멤버 확인 함수 2종 (RLS를 우회해 안전하게 확인)
--
-- 적용 상태(2026-09-02 확인):
--   groups 테이블      ✅ 존재 (지금까지 파일 없이 수동 생성돼 있었음)
--   group_members      ✅ 존재
--   함수 2종            ✅ 존재
-- ═══════════════════════════════════════════════════════════

-- ── 테이블 ──────────────────────────────────────────────────
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now()
);

-- 같은 사람이 같은 그룹에 중복으로 들어간 행 제거 (목록에 여러 번 뜨던 문제)
delete from public.group_members a
using public.group_members b
where a.ctid < b.ctid
  and a.group_id = b.group_id
  and a.user_id = b.user_id;

create unique index if not exists group_members_group_user_uidx
  on public.group_members (group_id, user_id);

-- ── 권한 ────────────────────────────────────────────────────
grant usage on schema public to authenticated;
grant select, insert, update on public.groups to authenticated;
grant select, insert, delete on public.group_members to authenticated;

-- ── RLS ─────────────────────────────────────────────────────
alter table public.group_members enable row level security;

-- 이름이 달라도 남아있는 정책을 전부 정리한 뒤 새로 만듭니다
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'group_members'
  loop
    execute format('drop policy if exists %I on public.group_members', pol.policyname);
  end loop;
end $$;

create policy "group_members_select_own" on public.group_members
for select to authenticated
using (user_id = auth.uid());

create policy "group_members_insert_self" on public.group_members
for insert to authenticated
with check (user_id = auth.uid());

-- ── 멤버 확인 함수 ──────────────────────────────────────────
-- RLS 때문에 클라이언트에서 직접 조회하기 어려워 함수로 감쌉니다.
create or replace function public.is_group_member(p_group_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = auth.uid()
  );
$$;

revoke all on function public.is_group_member(uuid) from public;
grant execute on function public.is_group_member(uuid) to authenticated;

-- 그룹을 만든 사람이 멤버 테이블에 빠져 있을 때 자동 등록
create or replace function public.ensure_group_creator_member(p_group_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return false;
  end if;

  if exists (select 1 from public.group_members
             where group_id = p_group_id and user_id = uid) then
    return true;
  end if;

  if exists (select 1 from public.groups
             where id = p_group_id and created_by = uid) then
    insert into public.group_members (group_id, user_id)
    values (p_group_id, uid)
    on conflict do nothing;
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.ensure_group_creator_member(uuid) from public;
grant execute on function public.ensure_group_creator_member(uuid) to authenticated;

-- ── 멤버 목록 조회 (프로필 조인) ────────────────────────────
-- MemberList 화면이 사용합니다.
create or replace function public.get_group_members_with_profiles(p_group_id uuid)
returns table (
  id uuid,
  user_id uuid,
  joined_at timestamptz,
  nickname text,
  avatar text
)
language sql
security definer
set search_path = public
stable
as $$
  select gm.id, gm.user_id, gm.joined_at,
         coalesce(p.nickname, '') as nickname,
         coalesce(p.avatar, '🐱') as avatar
  from public.group_members gm
  left join public.profiles p on p.id = gm.user_id
  where gm.group_id = p_group_id
    and public.is_group_member(p_group_id)   -- 멤버가 아니면 아무것도 안 보임
  order by gm.joined_at asc;
$$;

revoke all on function public.get_group_members_with_profiles(uuid) from public;
grant execute on function public.get_group_members_with_profiles(uuid) to authenticated;

-- ── 설명 ────────────────────────────────────────────────────
comment on table public.groups is '그룹 — 사용자가 만든 팀. invite_code 로 참여';
comment on table public.group_members is '그룹 구성원 — (group_id, user_id) 유일';
