-- ═══════════════════════════════════════════════════════════
-- 회의 영상 R2 상태
-- ═══════════════════════════════════════════════════════════
-- 새 녹화 원본은 Cloudflare R2에 두고, meetings 에는 객체 키와 상태만 저장합니다.
-- video_url(/videos/...) 은 예전 디스크 영상용으로 그대로 둡니다.
--
-- video_key         : R2 객체 키 (meeting-videos/{groupId}/{날짜}/{시각}.webm)
-- video_status      : pending_upload | uploaded | backed_up | failed
-- video_size_bytes  : 원본 바이트. 나중에 팀별 저장 용량을 계산할 때 씁니다.
--
-- RLS 는 행 단위라서 칸을 추가해도 기존 정책(같은 그룹 멤버만 읽기·쓰기)이
-- 새 칸까지 같이 허용합니다. 정책을 바꾸지 않습니다.
--
-- Supabase Dashboard → SQL Editor 에 붙여넣고 Run 하세요.
-- ═══════════════════════════════════════════════════════════

alter table public.meetings
  add column if not exists video_key text;

alter table public.meetings
  add column if not exists video_status text;

alter table public.meetings
  add column if not exists video_size_bytes bigint;

-- 예전 행은 상태가 비어 있어도 됩니다. 새 값만 네 가지로 제한합니다.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'meetings_video_status_check'
      and conrelid = 'public.meetings'::regclass
  ) then
    alter table public.meetings
      add constraint meetings_video_status_check
      check (
        video_status is null
        or video_status in ('pending_upload', 'uploaded', 'backed_up', 'failed')
      );
  end if;
end $$;

comment on column public.meetings.video_key is
  'Cloudflare R2 객체 키. meeting-videos/ 로 시작합니다.';
comment on column public.meetings.video_status is
  '영상 상태: pending_upload | uploaded | backed_up | failed';
comment on column public.meetings.video_size_bytes is
  '원본 영상 바이트. 팀별 저장 용량 계산에 사용';
