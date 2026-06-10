-- 회의 녹화 저장소 (meeting-videos 버킷)
-- Supabase Dashboard → Storage 에서 meeting-videos 버킷을 먼저 만든 뒤 실행하세요.

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
