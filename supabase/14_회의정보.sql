-- 회의 정보 카드용 컬럼
-- ai_headline : AI가 쓴 회의 날짜 한 줄
-- topic_line  : AI가 쓴 회의 주제 한 줄
-- started_at  : 회의방을 연 시각
-- ended_at    : 회의방을 닫은 시각
-- attendees   : 그 회의에 들어온 사람 이름 ["민수", "지연"]
--
-- 컬럼이 없어도 앱은 요약·녹화를 저장합니다.
-- 이 파일을 적용해야 날짜·주제 한 줄, 진행 시간, 참석자가 새로고침 뒤에도 남습니다.

alter table public.meetings
  add column if not exists ai_headline text;

alter table public.meetings
  add column if not exists topic_line text;

alter table public.meetings
  add column if not exists started_at timestamptz;

alter table public.meetings
  add column if not exists ended_at timestamptz;

alter table public.meetings
  add column if not exists attendees jsonb not null default '[]'::jsonb;

-- 녹화 길이(초). 회의 시간 칸은 이 값을 씁니다.
alter table public.meetings
  add column if not exists recording_seconds integer;
