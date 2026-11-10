-- 그룹 메모
-- groups.memo : 그룹 상세 배너에 보이는 한 줄 메모
--
-- 이 칸이 있어야 그룹 편집에서 저장한 메모가 새로고침 후에도 남습니다.
-- 이미 있으면 그대로 둡니다.

alter table public.groups
  add column if not exists memo text not null default '';
