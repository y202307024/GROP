-- ═══════════════════════════════════════════════════════════
-- 전체적용 — 01~07을 한 번에 실행합니다
-- ═══════════════════════════════════════════════════════════
-- SQL Editor에 이 파일 전체를 붙여넣고 Run 하세요.
-- 여러 번 실행해도 대체로 안전합니다(이미 있으면 건너뜁니다).
-- 07이 포함되어 있어서 익명(anon) 조회가 막힙니다.
-- 수정할 때는 이 파일이 아니라 01~07을 고치세요.
-- ═══════════════════════════════════════════════════════════

-- ┌──────────────────────────────────────────────────────────
-- │ 01_기본설정_스키마.sql
-- └──────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════
-- 01. 기본 설정 — 확장 기능
-- ═══════════════════════════════════════════════════════════
-- 가장 먼저 실행하세요. 다른 스크립트가 gen_random_uuid() 를 씁니다.
-- 여러 번 실행해도 안전합니다.
--
-- 적용 상태(2026-09-02 확인): ✅ 이미 적용됨
-- ═══════════════════════════════════════════════════════════

create extension if not exists pgcrypto;


-- ┌──────────────────────────────────────────────────────────
-- │ 02_그룹_및_멤버.sql
-- └──────────────────────────────────────────────────────────

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


-- ┌──────────────────────────────────────────────────────────
-- │ 03_프로필.sql
-- └──────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════
-- 03. 프로필 (기본 / 그룹별) + 아바타 이미지 저장소
-- ═══════════════════════════════════════════════════════════
-- profiles       : 앱 전체에서 쓰는 기본 프로필
-- group_profiles : 그룹마다 다르게 쓰고 싶을 때 (없으면 기본 프로필로 대체)
-- avatars 버킷    : 업로드한 프로필 사진
--
-- 적용 상태(2026-09-02 확인):
--   profiles        ✅ 존재 (avatar_url 은 파일 없이 수동 추가돼 있었음)
--   group_profiles  ✅ 존재 (파일 없이 수동 생성돼 있었음)
--   avatars 버킷     ✅ 존재
-- ═══════════════════════════════════════════════════════════

-- ── 기본 프로필 ─────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text,
  avatar text,
  created_at timestamptz not null default now()
);

-- 업로드 사진 URL (이모지 아바타 대신 쓸 때)
alter table public.profiles
  add column if not exists avatar_url text;

alter table public.profiles enable row level security;
grant select, insert, update on public.profiles to authenticated;

drop policy if exists "profiles_read_authed" on public.profiles;
create policy "profiles_read_authed" on public.profiles
for select to authenticated using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
for insert to authenticated with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
for update to authenticated
using (auth.uid() = id) with check (auth.uid() = id);

-- ── 그룹별 프로필 ───────────────────────────────────────────
create table if not exists public.group_profiles (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text,
  avatar text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 앱이 onConflict: 'group_id,user_id' 로 upsert 하므로 유일 인덱스가 필요합니다
create unique index if not exists group_profiles_group_user_uidx
  on public.group_profiles (group_id, user_id);

alter table public.group_profiles enable row level security;
grant select, insert, update on public.group_profiles to authenticated;

-- 같은 그룹 멤버끼리는 서로의 프로필을 볼 수 있어야 합니다
drop policy if exists "group_profiles_read_member" on public.group_profiles;
create policy "group_profiles_read_member" on public.group_profiles
for select to authenticated
using (public.is_group_member(group_id));

drop policy if exists "group_profiles_write_own" on public.group_profiles;
create policy "group_profiles_write_own" on public.group_profiles
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "group_profiles_update_own" on public.group_profiles;
create policy "group_profiles_update_own" on public.group_profiles
for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── 아바타 이미지 저장소 ────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "avatars_read_public" on storage.objects;
create policy "avatars_read_public" on storage.objects
for select using (bucket_id = 'avatars');

-- 업로드 경로가 {userId}/... 라서 본인 폴더에만 쓰도록 제한합니다
drop policy if exists "avatars_write_own_folder" on storage.objects;
create policy "avatars_write_own_folder" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "avatars_update_own_folder" on storage.objects;
create policy "avatars_update_own_folder" on storage.objects
for update to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

comment on table public.profiles is '기본 프로필 — 그룹별 설정이 없을 때 사용';
comment on table public.group_profiles is '그룹별 프로필 — (group_id, user_id) 유일';


-- ┌──────────────────────────────────────────────────────────
-- │ 04_캔버스_보드.sql
-- └──────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════
-- 04. 캔버스 (보드 · 그리기 이벤트 · 실시간)
-- ═══════════════════════════════════════════════════════════
-- boards       : 화이트보드 한 장
-- board_events : 그리기 동작 로그 (타임랩스 재생의 원본)
-- board_seq    : 보드별 순번 발급용 내부 테이블
--
-- 적용 상태(2026-09-02 확인):
--   boards / board_events / board_seq  ✅ 존재
--   boards.group_id                    ❌ 없음 ← 이게 없어서 그룹별 캔버스가
--                                          제목 접두어 꼼수로 우회되고 있습니다
-- ═══════════════════════════════════════════════════════════

-- ── 테이블 ──────────────────────────────────────────────────
create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  title text not null default '새 보드',
  created_at timestamptz not null default now()
);

-- 그룹별 캔버스 분리용. 이 컬럼이 있어야 CanvasBoard 가 정상 경로로 동작합니다.
alter table public.boards
  add column if not exists group_id uuid references public.groups(id) on delete cascade;

create index if not exists boards_group_id_idx
  on public.boards(group_id) where group_id is not null;

create table if not exists public.board_seq (
  board_id uuid primary key references public.boards(id) on delete cascade,
  next_seq bigint not null default 1
);

-- 순번 발급용 내부 테이블이라 RLS 를 끕니다.
-- (켜두면 트리거의 insert/update 가 authenticated 에게 막힙니다)
alter table public.board_seq disable row level security;

create table if not exists public.board_events (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  seq bigint not null,
  ts timestamptz not null default now(),
  actor_id text not null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists board_events_board_seq_idx on public.board_events(board_id, seq);
create index if not exists board_events_board_ts_idx  on public.board_events(board_id, ts);

-- ── 순번 자동 발급 트리거 ───────────────────────────────────
create or replace function public.init_board_seq()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.board_seq(board_id, next_seq)
  values (new.id, 1)
  on conflict (board_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_init_board_seq on public.boards;
create trigger trg_init_board_seq
after insert on public.boards
for each row execute function public.init_board_seq();

create or replace function public.assign_board_event_seq()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq bigint;
begin
  update public.board_seq
  set next_seq = next_seq + 1
  where board_id = new.board_id
  returning next_seq - 1 into v_seq;

  if v_seq is null then
    insert into public.board_seq(board_id, next_seq)
    values (new.board_id, 2)
    returning 1 into v_seq;
  end if;

  new.seq := v_seq;
  return new;
end;
$$;

drop trigger if exists trg_assign_board_event_seq on public.board_events;
create trigger trg_assign_board_event_seq
before insert on public.board_events
for each row execute function public.assign_board_event_seq();

-- ── 권한 / RLS ──────────────────────────────────────────────
grant select, insert, update on public.boards to authenticated;
grant select, insert on public.board_events to authenticated;

alter table public.boards enable row level security;
alter table public.board_events enable row level security;

-- ⚠️ 현재는 로그인만 하면 모든 보드를 보고 쓸 수 있는 상태입니다.
--    그룹 단위로 좁히는 작업은 07_보안_RLS정리.sql 에 있습니다.
drop policy if exists "boards_read_authed" on public.boards;
create policy "boards_read_authed" on public.boards
for select to authenticated using (true);

drop policy if exists "boards_insert_authed" on public.boards;
create policy "boards_insert_authed" on public.boards
for insert to authenticated with check (true);

drop policy if exists "boards_update_authed" on public.boards;
create policy "boards_update_authed" on public.boards
for update to authenticated using (true) with check (true);

drop policy if exists "events_read_authed" on public.board_events;
create policy "events_read_authed" on public.board_events
for select to authenticated using (true);

drop policy if exists "events_insert_authed" on public.board_events;
create policy "events_insert_authed" on public.board_events
for insert to authenticated with check (true);

-- ── 실시간 동기화 ───────────────────────────────────────────
-- board_events 를 Realtime publication 에 추가합니다.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.board_events;
  end if;
exception when others then
  null;  -- 이미 추가돼 있거나 권한이 없으면 무시
end $$;

comment on table public.boards is '캔버스 보드 — group_id 로 그룹에 소속';
comment on table public.board_events is '그리기 이벤트 로그 — 타임랩스 재생 원본';
comment on table public.board_seq is '보드별 순번 발급용 내부 테이블 (RLS 없음)';


-- ┌──────────────────────────────────────────────────────────
-- │ 05_회의록_및_영상.sql
-- └──────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════
-- 05. 회의록 & 녹화 영상
-- ═══════════════════════════════════════════════════════════
-- meetings              : 회의 1건 (제목·날짜·녹화파일·AI요약·타임라인)
-- meeting-videos 버킷    : 녹화된 webm 파일
--
-- 적용 상태(2026-09-02 확인):
--   meetings 테이블        ✅ 존재 (파일 없이 수동 생성돼 있었음)
--   meetings.chapters     ❌ 없음 ← 영상 타임라인 저장에 필요
--   meeting-videos 버킷    ❌ 없음 ← 이것 때문에 녹화 업로드가 실패해서
--                              meetings 가 0행입니다
-- ═══════════════════════════════════════════════════════════

-- ── 회의록 테이블 ───────────────────────────────────────────
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null,
  date timestamptz not null default now(),
  summary text,
  video_url text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists meetings_group_date_idx
  on public.meetings(group_id, date desc);

-- 영상 챕터(유튜브식 타임라인)
--   [{ "time": 0, "title": "회의 시작", "summary": "참석자 확인" }, ...]
--   time 은 영상 시작부터의 초 단위 정수입니다.
alter table public.meetings
  add column if not exists chapters jsonb;

-- ── 권한 / RLS ──────────────────────────────────────────────
grant select, insert, update, delete on public.meetings to authenticated;

alter table public.meetings enable row level security;

-- 같은 그룹 멤버만 회의록을 보고 쓸 수 있습니다
drop policy if exists "meetings_read_member" on public.meetings;
create policy "meetings_read_member" on public.meetings
for select to authenticated
using (public.is_group_member(group_id));

drop policy if exists "meetings_insert_member" on public.meetings;
create policy "meetings_insert_member" on public.meetings
for insert to authenticated
with check (public.is_group_member(group_id));

drop policy if exists "meetings_update_member" on public.meetings;
create policy "meetings_update_member" on public.meetings
for update to authenticated
using (public.is_group_member(group_id))
with check (public.is_group_member(group_id));

-- ── 녹화 영상 저장소 ────────────────────────────────────────
-- 비공개 버킷입니다. 재생은 앱이 signed URL 을 발급해서 씁니다.
insert into storage.buckets (id, name, public)
values ('meeting-videos', 'meeting-videos', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists "meeting_videos_read_authed" on storage.objects;
create policy "meeting_videos_read_authed" on storage.objects
for select to authenticated
using (bucket_id = 'meeting-videos');

drop policy if exists "meeting_videos_insert_authed" on storage.objects;
create policy "meeting_videos_insert_authed" on storage.objects
for insert to authenticated
with check (bucket_id = 'meeting-videos');

comment on table public.meetings is '회의록 — 녹화·AI요약·타임라인 저장';
comment on column public.meetings.chapters is
  '영상 챕터 배열 [{time(초), title, summary}] — AI 요약이 생성';


-- ┌──────────────────────────────────────────────────────────
-- │ 06_타임랩스.sql
-- └──────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════
-- 06. 타임랩스 저장
-- ═══════════════════════════════════════════════════════════
-- board_timelapse_saves : "이 시점까지의 그리기 기록"에 이름을 붙여 저장
--                         (board_events 를 seq 범위로 잘라 재생합니다)
--
-- 적용 상태(2026-09-02 확인): ❌ 테이블 없음
--   → 타임랩스 화면(/timelapse)에 들어가면 오류 안내가 뜹니다.
--      이 스크립트를 실행하면 정상 동작합니다.
-- ═══════════════════════════════════════════════════════════

create table if not exists public.board_timelapse_saves (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  title text not null,
  max_seq bigint not null,
  event_count int not null default 0,
  start_ts timestamptz,
  end_ts timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists board_timelapse_saves_board_idx
  on public.board_timelapse_saves(board_id, created_at desc);

grant select, insert, delete on public.board_timelapse_saves to authenticated;

alter table public.board_timelapse_saves enable row level security;

drop policy if exists "timelapse_saves_read_authed" on public.board_timelapse_saves;
create policy "timelapse_saves_read_authed" on public.board_timelapse_saves
for select to authenticated using (true);

drop policy if exists "timelapse_saves_insert_authed" on public.board_timelapse_saves;
create policy "timelapse_saves_insert_authed" on public.board_timelapse_saves
for insert to authenticated with check (true);

drop policy if exists "timelapse_saves_delete_authed" on public.board_timelapse_saves;
create policy "timelapse_saves_delete_authed" on public.board_timelapse_saves
for delete to authenticated using (true);

comment on table public.board_timelapse_saves is
  '타임랩스 저장본 — 보드의 특정 seq 까지를 이름 붙여 보관';


-- ┌──────────────────────────────────────────────────────────
-- │ 07_보안_RLS정리.sql
-- └──────────────────────────────────────────────────────────

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


