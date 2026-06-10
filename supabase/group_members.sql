-- groups / group_members RLS + 멤버 확인 함수
-- Supabase SQL Editor에서 전체를 한 번 실행하세요.

grant usage on schema public to authenticated;

grant select, insert on public.group_members to authenticated;
grant select on public.groups to authenticated;

alter table public.group_members enable row level security;

-- 기존 정책 전부 제거 (이름이 달라도 삭제)
do $$
declare pol record;
begin
  for pol in
    select policyname
    from pg_policies
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

-- RLS와 무관하게 멤버 여부 확인 (캔버스 입장용)
create or replace function public.is_group_member(p_group_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = auth.uid()
  );
$$;

revoke all on function public.is_group_member(uuid) from public;
grant execute on function public.is_group_member(uuid) to authenticated;

-- 그룹 만든 사람이 멤버 테이블에 없을 때 자동 등록
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

  if exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = uid
  ) then
    return true;
  end if;

  if exists (
    select 1 from public.groups
    where id = p_group_id and created_by = uid
  ) then
    insert into public.group_members (group_id, user_id)
    select p_group_id, uid
    where not exists (
      select 1 from public.group_members
      where group_id = p_group_id and user_id = uid
    );
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.ensure_group_creator_member(uuid) from public;
grant execute on function public.ensure_group_creator_member(uuid) to authenticated;

-- 같은 그룹·같은 유저 중복 행 제거 (목록에 여러 번 뜨는 문제)
delete from public.group_members a
using public.group_members b
where a.ctid < b.ctid
  and a.group_id = b.group_id
  and a.user_id = b.user_id;

create unique index if not exists group_members_group_user_uidx
  on public.group_members (group_id, user_id);
