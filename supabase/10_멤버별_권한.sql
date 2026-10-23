-- ═══════════════════════════════════════════════════════════
-- 10. 멤버별 권한 (녹화 / 판서)
-- 그룹 기본 권한(group_settings)은 그대로 두고,
-- 방장이 멤버 한 명씩 추가로 켜고 끌 수 있습니다.
--
-- 실제 허용 = 그룹 허용 AND 멤버 허용 (방장은 항상 허용)
-- Supabase SQL Editor에서 Run 하세요.
-- ═══════════════════════════════════════════════════════════

create table if not exists public.group_member_permissions (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  can_record boolean not null default true,
  can_draw boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists group_member_permissions_user_idx
  on public.group_member_permissions (user_id);

alter table public.group_member_permissions enable row level security;
grant select, insert, update on public.group_member_permissions to authenticated;

-- 멤버: 같은 그룹이면 조회 가능 (본인 권한 확인용)
drop policy if exists "gmp_select_member" on public.group_member_permissions;
create policy "gmp_select_member" on public.group_member_permissions
for select to authenticated
using (public.is_group_member(group_id));

-- 방장만 멤버별 권한 쓰기
drop policy if exists "gmp_insert_owner" on public.group_member_permissions;
create policy "gmp_insert_owner" on public.group_member_permissions
for insert to authenticated
with check (public.is_group_owner(group_id));

drop policy if exists "gmp_update_owner" on public.group_member_permissions;
create policy "gmp_update_owner" on public.group_member_permissions
for update to authenticated
using (public.is_group_owner(group_id))
with check (public.is_group_owner(group_id));

-- 멤버가 그룹에서 나가면 권한 행도 정리
create or replace function public.cleanup_member_permissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.group_member_permissions
  where group_id = old.group_id and user_id = old.user_id;
  return old;
end;
$$;

drop trigger if exists trg_cleanup_member_permissions on public.group_members;
create trigger trg_cleanup_member_permissions
after delete on public.group_members
for each row execute function public.cleanup_member_permissions();

comment on table public.group_member_permissions is
  '멤버별 권한 — 그룹 기본(group_settings)과 AND로 적용';
