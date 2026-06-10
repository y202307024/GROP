-- 캔버스 "board_seq row-level security" 오류 수정
-- Supabase SQL Editor에서 전체 실행

-- 1) board_seq는 내부 순번용 — RLS 끄기
alter table public.board_seq disable row level security;

-- 2) 트리거는 definer 권한으로 실행 (RLS가 켜져 있어도 seq 발급 가능)
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

-- 3) board_events / boards 쓰기 권한 (없을 때만 추가)
grant select, insert on public.board_events to authenticated;
grant select, insert, update on public.boards to authenticated;

alter table public.board_events enable row level security;
alter table public.boards enable row level security;

drop policy if exists "events_insert_authed" on public.board_events;
create policy "events_insert_authed" on public.board_events
for insert to authenticated with check (true);

drop policy if exists "events_read_authed" on public.board_events;
create policy "events_read_authed" on public.board_events
for select to authenticated using (true);

drop policy if exists "boards_insert_authed" on public.boards;
create policy "boards_insert_authed" on public.boards
for insert to authenticated with check (true);

drop policy if exists "boards_read_authed" on public.boards;
create policy "boards_read_authed" on public.boards
for select to authenticated using (true);
