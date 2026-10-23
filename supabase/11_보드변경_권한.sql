-- ═══════════════════════════════════════════════════════════
-- 11. 보드 변경 권한 (그룹 기본 + 멤버별)
-- Supabase SQL Editor에서 Run 하세요.
-- ═══════════════════════════════════════════════════════════

alter table public.group_settings
  add column if not exists members_can_change_board boolean not null default true;

alter table public.group_member_permissions
  add column if not exists can_change_board boolean not null default true;

comment on column public.group_settings.members_can_change_board is
  '멤버가 보드 선택·생성·이름변경 가능한지 (기본)';
comment on column public.group_member_permissions.can_change_board is
  '멤버별 보드 변경 허용';
