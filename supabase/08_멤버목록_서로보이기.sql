-- ═══════════════════════════════════════════════════════════
-- 08. 같은 그룹 멤버끼리 목록이 서로 보이게
-- ═══════════════════════════════════════════════════════════
-- 증상: 초대코드로 참여해도 멤버 창에 내 이름만 보임
-- 원인: group_members SELECT 정책이 "내 행만" 허용해서,
--       목록 RPC가 없거나 구버전이면 서로가 안 보임
--
-- Supabase Dashboard → SQL Editor 에 붙여넣고 Run 하세요.
-- ═══════════════════════════════════════════════════════════

-- 멤버 확인 (security definer — RLS 우회해서 정확히 판별)
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

-- 내 행 + 내가 속한 그룹의 다른 멤버 행도 조회 가능
drop policy if exists "group_members_select_own" on public.group_members;
drop policy if exists "group_members_select_member" on public.group_members;

create policy "group_members_select_member" on public.group_members
for select to authenticated
using (
  user_id = auth.uid()
  or public.is_group_member(group_id)
);

-- 멤버 목록 RPC 재설치 (프로필 닉네임 포함)
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
    and public.is_group_member(p_group_id)
  order by gm.joined_at asc;
$$;

revoke all on function public.get_group_members_with_profiles(uuid) from public;
grant execute on function public.get_group_members_with_profiles(uuid) to authenticated;
