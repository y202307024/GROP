-- 문서 탭 「열기」에서 회의 첨부 파일을 보여 주기 위한 컬럼입니다.
-- Supabase SQL Editor에서 한 번 실행하세요.
alter table public.meetings
  add column if not exists attachments jsonb not null default '[]'::jsonb;

comment on column public.meetings.attachments is
  '회의 중 올린 첨부 [{ id, name, path, size, mime, ts }, ...]';
