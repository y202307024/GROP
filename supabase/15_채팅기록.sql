-- 회의 중 채팅
-- chat_log : [{ "id", "from", "name", "text", "ts" }, ...]
--            참석만 하고 말은 안 한 사람은 text 가 빈 자리표시로 같이 들어갑니다.
--
-- 이 칸이 있어야 회의방을 나갔다가 다시 들어와도 이전 채팅이 남습니다.
-- 이미 있으면 그대로 둡니다.

alter table public.meetings
  add column if not exists chat_log jsonb not null default '[]'::jsonb;

comment on column public.meetings.chat_log is
  '회의 중 채팅 [{id, from, name, text, ts}]. 빈 text 는 참석자 자리표시입니다.';
