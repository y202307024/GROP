-- 그룹에서 마지막으로 연 보드
-- last_used_at : 그 보드를 회의·캔버스에서 연 시각
--
-- 이 칸이 있어야 '기존 보드 불러오기'가 만든 순서가 아니라
-- 마지막으로 쓰던 그룹 보드를 다시 엽니다.
-- boards.group_id 는 아직 없는 데이터베이스가 있어, 그 인덱스는 칸이 있을 때만 만듭니다.
-- 이미 있으면 그대로 둡니다.

alter table public.boards
  add column if not exists last_used_at timestamptz;

create index if not exists boards_last_used_idx
  on public.boards (last_used_at desc);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'boards'
      and column_name = 'group_id'
  ) then
    execute $idx$
      create index if not exists boards_group_last_used_idx
      on public.boards (group_id, last_used_at desc)
      where group_id is not null
    $idx$;
  end if;
end $$;

comment on column public.boards.last_used_at is
  '이 그룹 보드를 마지막으로 연 시각. 기존 보드 불러오기가 이 값을 봅니다.';
