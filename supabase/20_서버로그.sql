-- 서버 요청 로그
-- server_logs : 이 앱 서버가 끝난 요청마다 한 줄씩 남깁니다.
-- profiles.is_admin : 이 표를 볼 수 있는 관리자
--
-- 쓰기는 서버의 서비스 롤 키만 합니다. 브라우저 키로는 넣을 수 없습니다.
-- 보기는 is_admin 이 true 인 로그인 사용자만 됩니다.
--
-- 적용 후, 관리자가 한 명도 없으면 가장 먼저 만든 프로필을 관리자로 둡니다.
-- 다른 사람을 관리자로 만들려면:
--   update public.profiles set is_admin = true where id = '사용자 uuid';

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

create table if not exists public.server_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  method text not null,
  path text not null,
  status integer not null,
  duration_ms integer not null,
  remote_addr text,
  -- internal = 서버와 같은 컴퓨터, external = 그 밖
  origin text not null,
  user_id uuid
);

create index if not exists server_logs_created_at_idx
  on public.server_logs (created_at desc);

alter table public.server_logs enable row level security;

revoke all on public.server_logs from anon, authenticated;
grant select on public.server_logs to authenticated;
grant insert on public.server_logs to service_role;

drop policy if exists "server_logs_admin_read" on public.server_logs;
create policy "server_logs_admin_read" on public.server_logs
for select to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_admin
  )
);

update public.profiles
set is_admin = true
where id = (
  select id from public.profiles order by created_at asc limit 1
)
and not exists (
  select 1 from public.profiles where is_admin
);
