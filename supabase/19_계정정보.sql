-- 계정 설정에 입력하는 이름, 연락처, 소속
-- profiles.full_name / phone / affiliation
--
-- 이 칸이 있어야 설정 화면에서 저장한 값이 새로고침 후에도 남습니다.
-- 이미 있으면 그대로 둡니다.

alter table public.profiles
  add column if not exists full_name text not null default '';

alter table public.profiles
  add column if not exists phone text not null default '';

alter table public.profiles
  add column if not exists affiliation text not null default '';
