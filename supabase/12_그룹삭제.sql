-- ═══════════════════════════════════════════════════════════
-- 12. 그룹 삭제 (방장만)
-- 관련 멤버·보드·회의·설정 등은 ON DELETE CASCADE 로 함께 정리됩니다.
-- Supabase SQL Editor에서 Run 하세요.
-- ═══════════════════════════════════════════════════════════

grant delete on public.groups to authenticated;

drop policy if exists "groups_delete_creator" on public.groups;
create policy "groups_delete_creator" on public.groups
for delete to authenticated
using (created_by = auth.uid());

comment on policy "groups_delete_creator" on public.groups is
  '방장(created_by)만 그룹을 삭제할 수 있습니다.';
