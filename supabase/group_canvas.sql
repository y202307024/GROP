-- 그룹별 공유 캔버스 보드 (선택 실행)
-- whiteboard.sql 실행 후 이 파일을 실행하세요.

alter table public.boards
  add column if not exists group_id uuid references public.groups(id) on delete cascade;

create index if not exists boards_group_id_idx
  on public.boards(group_id)
  where group_id is not null;

drop policy if exists "boards_update_authed" on public.boards;
create policy "boards_update_authed" on public.boards
for update
to authenticated
using (true)
with check (true);
