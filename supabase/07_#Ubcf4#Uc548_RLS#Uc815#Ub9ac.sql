-- ═══════════════════════════════════════════════════════════
-- 07. 보안 — 익명 접근 차단
-- ═══════════════════════════════════════════════════════════
-- ⚠️ 이 파일만 "동작을 바꾸는" 스크립트입니다. 나머지는 추가만 합니다.
--
-- 문제(2026-09-02 확인):
--   로그인하지 않은 상태에서 anon 키만으로
--     groups   13행 전량 조회 가능 (invite_code 포함)
--     profiles  4행 조회 가능 (닉네임 노출)
--   anon 키는 프론트엔드 번들에 들어가므로 누구나 얻을 수 있습니다.
--   초대코드를 알면 그룹 참여가 되므로 실제 침입 경로입니다.
--
--   원인: groups 에 RLS 를 켜는 구문이 어디에도 없었습니다.
--
-- 안전성:
--   그룹·프로필은 멤버만 봅니다. 초대코드 가입은 find_group_by_invite 로 id·이름만 받습니다.
--   group_id 가 비어 있는 보드는 그대로 두어, 예전 개인 캔버스가 숨지 않습니다.
--
-- 실행 후 할 일:
--   이미 유출된 초대코드 13개는 재발급하세요 (맨 아래 참고).
-- ═══════════════════════════════════════════════════════════

-- ── groups: 멤버(또는 만든 사람)만 조회 ─────────────────────
alter table public.groups enable row level security;

-- 초대코드로 가입할 때는 그룹 전체를 열지 않고, 맞는 코드의 id·이름만 돌려줍니다.
create or replace function public.find_group_by_invite(p_code text)
returns table (id uuid, name text)
language sql
security definer
set search_path = public
stable
as $$
  select g.id, g.name
  from public.groups g
  where g.invite_code = upper(trim(p_code))
  limit 1;
$$;

revoke all on function public.find_group_by_invite(text) from public;
grant execute on function public.find_group_by_invite(text) to authenticated;

drop policy if exists "groups_select_authed" on public.groups;
drop policy if exists "groups_select_member" on public.groups;
create policy "groups_select_member" on public.groups
for select to authenticated
using (
  created_by = auth.uid()
  or public.is_group_member(id)
);

drop policy if exists "groups_insert_own" on public.groups;
create policy "groups_insert_own" on public.groups
for insert to authenticated
with check (created_by = auth.uid());

-- 그룹 이름 변경은 만든 사람만 (지금은 아무나 바꿀 수 있습니다)
drop policy if exists "groups_update_creator" on public.groups;
create policy "groups_update_creator" on public.groups
for update to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

revoke all on public.groups from anon;

-- ── profiles: 본인, 또는 같은 그룹 멤버만 조회 ──────────────
-- group_members 는 본인 줄만 보이므로, 같은 그룹 여부는 definer 함수로 확인합니다.
create or replace function public.shares_group_with(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = auth.uid()
      and theirs.user_id = p_user_id
  );
$$;

revoke all on function public.shares_group_with(uuid) from public;
grant execute on function public.shares_group_with(uuid) to authenticated;

alter table public.profiles enable row level security;

drop policy if exists "profiles_read_authed" on public.profiles;
drop policy if exists "profiles_read_visible" on public.profiles;
create policy "profiles_read_visible" on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or public.shares_group_with(id)
);

revoke all on public.profiles from anon;

-- ── 나머지 테이블도 익명 차단 ───────────────────────────────
revoke all on public.group_members         from anon;
revoke all on public.group_profiles        from anon;
revoke all on public.meetings              from anon;
revoke all on public.boards                from anon;
revoke all on public.board_events          from anon;
revoke all on public.board_timelapse_saves from anon;


-- ═══════════════════════════════════════════════════════════
-- 보드: group_id 가 있는 캔버스만 그 그룹 멤버로 제한합니다.
-- group_id 가 비어 있는 예전·개인 보드는 그대로 두어 화면에서 사라지지 않게 합니다.
-- ═══════════════════════════════════════════════════════════
alter table public.boards
  add column if not exists group_id uuid references public.groups(id) on delete cascade;

drop policy if exists "boards_read_authed" on public.boards;
drop policy if exists "boards_read_member" on public.boards;
create policy "boards_read_member" on public.boards
for select to authenticated
using (group_id is null or public.is_group_member(group_id));

drop policy if exists "boards_insert_authed" on public.boards;
drop policy if exists "boards_insert_member" on public.boards;
create policy "boards_insert_member" on public.boards
for insert to authenticated
with check (group_id is null or public.is_group_member(group_id));

drop policy if exists "boards_update_authed" on public.boards;
drop policy if exists "boards_update_member" on public.boards;
create policy "boards_update_member" on public.boards
for update to authenticated
using (group_id is null or public.is_group_member(group_id))
with check (group_id is null or public.is_group_member(group_id));

drop policy if exists "events_read_authed" on public.board_events;
drop policy if exists "events_read_member" on public.board_events;
create policy "events_read_member" on public.board_events
for select to authenticated
using (exists (
  select 1 from public.boards b
  where b.id = board_events.board_id
    and (b.group_id is null or public.is_group_member(b.group_id))
));

drop policy if exists "events_insert_authed" on public.board_events;
drop policy if exists "events_insert_member" on public.board_events;
create policy "events_insert_member" on public.board_events
for insert to authenticated
with check (exists (
  select 1 from public.boards b
  where b.id = board_events.board_id
    and (b.group_id is null or public.is_group_member(b.group_id))
));


-- ═══════════════════════════════════════════════════════════
-- 초대코드 재발급 (유출분 무효화)
-- ═══════════════════════════════════════════════════════════
-- 실행하면 기존 초대코드가 전부 바뀝니다. 팀원에게 새 코드를 다시 공유하세요.
--
-- update public.groups
-- set invite_code = 'GRP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));
