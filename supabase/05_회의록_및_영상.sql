-- ═══════════════════════════════════════════════════════════
-- 05. 회의록 & 녹화 영상
-- ═══════════════════════════════════════════════════════════
-- meetings              : 회의 1건 (제목·날짜·녹화파일·AI요약·타임라인)
-- meeting-videos 버킷    : 녹화된 webm 파일
--
-- 적용 상태(2026-09-02 확인):
--   meetings 테이블        ✅ 존재 (파일 없이 수동 생성돼 있었음)
--   meetings.chapters     ❌ 없음 ← 영상 타임라인 저장에 필요
--   meeting-videos 버킷    ❌ 없음 ← 이것 때문에 녹화 업로드가 실패해서
--                              meetings 가 0행입니다
-- ═══════════════════════════════════════════════════════════

-- ── 회의록 테이블 ───────────────────────────────────────────
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null,
  date timestamptz not null default now(),
  summary text,
  video_url text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists meetings_group_date_idx
  on public.meetings(group_id, date desc);

-- 영상 챕터(유튜브식 타임라인)
--   [{ "time": 0, "title": "회의 시작", "summary": "참석자 확인" }, ...]
--   time 은 영상 시작부터의 초 단위 정수입니다.
alter table public.meetings
  add column if not exists chapters jsonb;

-- ── 권한 / RLS ──────────────────────────────────────────────
grant select, insert, update, delete on public.meetings to authenticated;

alter table public.meetings enable row level security;

-- 같은 그룹 멤버만 회의록을 보고 쓸 수 있습니다
drop policy if exists "meetings_read_member" on public.meetings;
create policy "meetings_read_member" on public.meetings
for select to authenticated
using (public.is_group_member(group_id));

drop policy if exists "meetings_insert_member" on public.meetings;
create policy "meetings_insert_member" on public.meetings
for insert to authenticated
with check (public.is_group_member(group_id));

drop policy if exists "meetings_update_member" on public.meetings;
create policy "meetings_update_member" on public.meetings
for update to authenticated
using (public.is_group_member(group_id))
with check (public.is_group_member(group_id));

-- ── 녹화 영상 저장소 ────────────────────────────────────────
-- 비공개 버킷입니다. 재생은 앱이 signed URL 을 발급해서 씁니다.
insert into storage.buckets (id, name, public)
values ('meeting-videos', 'meeting-videos', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists "meeting_videos_read_authed" on storage.objects;
create policy "meeting_videos_read_authed" on storage.objects
for select to authenticated
using (bucket_id = 'meeting-videos');

drop policy if exists "meeting_videos_insert_authed" on storage.objects;
create policy "meeting_videos_insert_authed" on storage.objects
for insert to authenticated
with check (bucket_id = 'meeting-videos');

comment on table public.meetings is '회의록 — 녹화·AI요약·타임라인 저장';
comment on column public.meetings.chapters is
  '영상 챕터 배열 [{time(초), title, summary}] — AI 요약이 생성';
