-- ═══════════════════════════════════════════════════════════
-- 03. 프로필 (기본 / 그룹별) + 아바타 이미지 저장소
-- ═══════════════════════════════════════════════════════════
-- profiles       : 앱 전체에서 쓰는 기본 프로필
-- group_profiles : 그룹마다 다르게 쓰고 싶을 때 (없으면 기본 프로필로 대체)
-- avatars 버킷    : 업로드한 프로필 사진
--
-- 적용 상태(2026-09-02 확인):
--   profiles        ✅ 존재 (avatar_url 은 파일 없이 수동 추가돼 있었음)
--   group_profiles  ✅ 존재 (파일 없이 수동 생성돼 있었음)
--   avatars 버킷     ✅ 존재
-- ═══════════════════════════════════════════════════════════

-- ── 기본 프로필 ─────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text,
  avatar text,
  created_at timestamptz not null default now()
);

-- 업로드 사진 URL (이모지 아바타 대신 쓸 때)
alter table public.profiles
  add column if not exists avatar_url text;

alter table public.profiles enable row level security;
grant select, insert, update on public.profiles to authenticated;

-- 같은 그룹 사람만 프로필을 봅니다. group_members RLS 를 피하려고 definer 로 확인합니다.
create or replace function public.shares_group_with(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = auth.uid()
      and theirs.user_id = p_user_id
  );
$$;

revoke all on function public.shares_group_with(uuid) from public;
grant execute on function public.shares_group_with(uuid) to authenticated;

drop policy if exists "profiles_read_authed" on public.profiles;
drop policy if exists "profiles_read_visible" on public.profiles;
create policy "profiles_read_visible" on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or public.shares_group_with(id)
);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
for insert to authenticated with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
for update to authenticated
using (auth.uid() = id) with check (auth.uid() = id);

-- ── 그룹별 프로필 ───────────────────────────────────────────
create table if not exists public.group_profiles (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text,
  avatar text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 앱이 onConflict: 'group_id,user_id' 로 upsert 하므로 유일 인덱스가 필요합니다
create unique index if not exists group_profiles_group_user_uidx
  on public.group_profiles (group_id, user_id);

alter table public.group_profiles enable row level security;
grant select, insert, update on public.group_profiles to authenticated;

-- 같은 그룹 멤버끼리는 서로의 프로필을 볼 수 있어야 합니다
drop policy if exists "group_profiles_read_member" on public.group_profiles;
create policy "group_profiles_read_member" on public.group_profiles
for select to authenticated
using (public.is_group_member(group_id));

drop policy if exists "group_profiles_write_own" on public.group_profiles;
create policy "group_profiles_write_own" on public.group_profiles
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "group_profiles_update_own" on public.group_profiles;
create policy "group_profiles_update_own" on public.group_profiles
for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── 아바타 이미지 저장소 ────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "avatars_read_public" on storage.objects;
create policy "avatars_read_public" on storage.objects
for select using (bucket_id = 'avatars');

-- 업로드 경로가 {userId}/... 라서 본인 폴더에만 쓰도록 제한합니다
drop policy if exists "avatars_write_own_folder" on storage.objects;
create policy "avatars_write_own_folder" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "avatars_update_own_folder" on storage.objects;
create policy "avatars_update_own_folder" on storage.objects
for update to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

comment on table public.profiles is '기본 프로필 — 그룹별 설정이 없을 때 사용';
comment on table public.group_profiles is '그룹별 프로필 — (group_id, user_id) 유일';
