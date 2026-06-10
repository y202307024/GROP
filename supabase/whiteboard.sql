-- 실시간 협업 화이트보드 (옵션A + 패턴1) 최소 스키마
-- - boards: 보드 목록
-- - board_events: 이벤트 로그 (replay 가능)
-- - board_id 별 seq 발급 (정렬/재생용)
--
-- 사용 방법:
-- 1) Supabase SQL Editor에서 이 파일을 실행
-- 2) Table editor에서 Realtime 활성화(또는 아래 publication SQL 사용)
-- 3) 필요하면 RLS 정책 활성화/조정

create extension if not exists pgcrypto;

-- 보드
create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  title text not null default '새 보드',
  created_at timestamptz not null default now()
);

-- 보드별 seq 카운터(서버에서 순번 발급)
create table if not exists public.board_seq (
  board_id uuid primary key references public.boards(id) on delete cascade,
  next_seq bigint not null default 1
);

-- board_seq는 순번 발급용 내부 테이블이라 RLS를 끄는 게 제일 단순/안전합니다.
-- (트리거에서 insert/update가 발생하는데, RLS가 켜져 있으면 authenticated가 막힙니다.)
alter table public.board_seq disable row level security;

-- 이벤트 로그
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
create index if not exists board_events_board_ts_idx on public.board_events(board_id, ts);

-- 보드 생성 시 카운터 생성
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

-- 이벤트 insert 시 seq 자동 발급
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

-- --- Realtime 설정(환경에 따라 UI에서 켜도 됩니다) ---
-- Realtime(Postgres Changes)를 쓰려면 publication에 테이블이 포함되어야 합니다.
-- Supabase 기본 publication: supabase_realtime
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.board_events;
  end if;
exception when others then
  -- 권한/환경 차이로 실패할 수 있어 무시합니다.
end $$;

-- --- RLS (데모용: 로그인한 유저면 읽기/쓰기 허용) ---
alter table public.boards enable row level security;
alter table public.board_events enable row level security;

drop policy if exists "boards_read_authed" on public.boards;
create policy "boards_read_authed" on public.boards
for select
to authenticated
using (true);

drop policy if exists "boards_insert_authed" on public.boards;
create policy "boards_insert_authed" on public.boards
for insert
to authenticated
with check (true);

drop policy if exists "events_read_authed" on public.board_events;
create policy "events_read_authed" on public.board_events
for select
to authenticated
using (true);

drop policy if exists "events_insert_authed" on public.board_events;
create policy "events_insert_authed" on public.board_events
for insert
to authenticated
with check (true);

