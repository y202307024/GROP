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
--   앱의 모든 groups/profiles 조회는 로그인 이후에 일어나므로
--   아래 정책으로 바꿔도 화면이 깨지지 않습니다.
--
-- 실행 후 할 일:
--   이미 유출된 초대코드 13개는 재발급하세요 (맨 아래 참고).
-- ═══════════════════════════════════════════════════════════

-- ── groups: 익명 차단 ───────────────────────────────────────
alter table public.groups enable row level security;

drop policy if exists "groups_select_authed" on public.groups;
create policy "groups_select_authed" on public.groups
for select to authenticated using (true);

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

-- ── profiles: 익명 차단 ─────────────────────────────────────
alter table public.profiles enable row level security;

drop policy if exists "profiles_read_authed" on public.profiles;
create policy "profiles_read_authed" on public.profiles
for select to authenticated using (true);

revoke all on public.profiles from anon;

-- ── 나머지 테이블도 익명 차단 ───────────────────────────────
revoke all on public.group_members         from anon;
revoke all on public.group_profiles        from anon;
revoke all on public.meetings              from anon;
revoke all on public.boards                from anon;
revoke all on public.board_events          from anon;
revoke all on public.board_timelapse_saves from anon;


-- ═══════════════════════════════════════════════════════════
-- 아래는 아직 적용하지 마세요 (코드 수정이 함께 필요합니다)
-- ═══════════════════════════════════════════════════════════
-- boards / board_events 를 그룹 단위로 좁히는 정책입니다.
-- 지금은 로그인만 하면 다른 그룹 캔버스도 전부 보입니다.
--
-- 먼저 04_캔버스_보드.sql 로 boards.group_id 를 만들고,
-- 기존 보드에 group_id 를 채워 넣은 뒤에 적용해야
-- 기존 캔버스가 안 보이게 되는 사고를 피할 수 있습니다.
--
-- drop policy if exists "boards_read_authed" on public.boards;
-- create policy "boards_read_member" on public.boards
-- for select to authenticated
-- using (group_id is null or public.is_group_member(group_id));
--
-- drop policy if exists "events_read_authed" on public.board_events;
-- create policy "events_read_member" on public.board_events
-- for select to authenticated
-- using (exists (
--   select 1 from public.boards b
--   where b.id = board_events.board_id
--     and (b.group_id is null or public.is_group_member(b.group_id))
-- ));


-- ═══════════════════════════════════════════════════════════
-- 초대코드 재발급 (유출분 무효화)
-- ═══════════════════════════════════════════════════════════
-- 실행하면 기존 초대코드가 전부 바뀝니다. 팀원에게 새 코드를 다시 공유하세요.
--
-- update public.groups
-- set invite_code = 'GRP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));
