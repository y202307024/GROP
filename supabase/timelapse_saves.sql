-- 보드별 타임랩스 저장 카테고리
-- Supabase SQL Editor에서 실행하세요.

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
