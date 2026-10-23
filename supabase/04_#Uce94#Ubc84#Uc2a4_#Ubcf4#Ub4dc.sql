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
