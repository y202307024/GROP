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
