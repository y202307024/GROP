import { supabase } from '../services/supabaseClient';

export type NoticeType =
  | 'document_update'
  | 'group_join'
  | 'group_leave'
  | 'ai_summary'
  | 'meeting_start'
  | 'meeting_end';

export type AppNotification = {
  id: string;
  user_id: string;
  group_id: string | null;
  actor_id: string | null;
  type: NoticeType | string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
};

const lastNotifyAt = new Map<string, number>();

/** 그룹 프로필 닉네임을 우선하고, 없으면 기본 프로필을 씁니다. */
export async function fetchDisplayNickname(userId: string, groupId?: string | null) {
  if (groupId) {
    const { data: groupProfile } = await supabase
      .from('group_profiles')
      .select('nickname')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .maybeSingle();
    if (groupProfile?.nickname?.trim()) return groupProfile.nickname.trim();
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('nickname')
    .eq('id', userId)
    .maybeSingle();
  return profile?.nickname?.trim() || '멤버';
}

export async function fetchMyNotifications(limit = 40): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, user_id, group_id, actor_id, type, title, body, link, read, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('알림 목록을 불러오지 못했습니다:', error.message);
    return [];
  }
  return (data ?? []) as AppNotification[];
}

export async function markNotificationRead(id: string) {
  const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id);
  if (error) console.warn('알림 읽음 처리 실패:', error.message);
}

export async function markAllNotificationsRead() {
  const { data: session } = await supabase.auth.getUser();
  const uid = session.user?.id;
  if (!uid) return;
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', uid)
    .eq('read', false);
  if (error) console.warn('알림 모두 읽음 처리 실패:', error.message);
}

type NotifyArgs = {
  groupId: string;
  type: NoticeType;
  title: string;
  body?: string;
  link?: string;
  excludeSelf?: boolean;
  /** 같은 그룹·같은 종류의 알림이 너무 자주 쌓이지 않게 합니다. */
  debounceMs?: number;
};

/** 2분 안에 같은 제목 알림을 이미 받은 사람은 대상에서 뺍니다. */
async function dropRecentNoticeTargets(
  args: NotifyArgs,
  actorId: string,
  targets: Set<string>,
) {
  const { data: recent } = await supabase
    .from('notifications')
    .select('user_id')
    .eq('group_id', args.groupId)
    .eq('type', args.type)
    .eq('actor_id', actorId)
    .eq('title', args.title.trim())
    .gte('created_at', new Date(Date.now() - 120_000).toISOString());
  for (const row of recent ?? []) {
    if (row.user_id) targets.delete(row.user_id);
  }
}

/** RPC가 없거나 0건인 경우, 멤버·방장에게 직접 insert 합니다. */
async function notifyGroupMembersFallback(args: NotifyArgs) {
  const { data: session } = await supabase.auth.getUser();
  const uid = session.user?.id;
  if (!uid) return;

  const [{ data: members }, { data: group }] = await Promise.all([
    supabase.from('group_members').select('user_id').eq('group_id', args.groupId),
    supabase.from('groups').select('created_by').eq('id', args.groupId).maybeSingle(),
  ]);

  const targets = new Set<string>();
  for (const row of members ?? []) {
    if (row.user_id) targets.add(row.user_id);
  }
  if (group?.created_by) targets.add(group.created_by);
  // excludeSelf: false 이면 올린 본인도 종에서 확인할 수 있게 남깁니다.
  if (args.excludeSelf !== false) targets.delete(uid);
  if (targets.size === 0) targets.add(uid);
  await dropRecentNoticeTargets(args, uid, targets);
  if (targets.size === 0) return;

  const rows = [...targets].map((user_id) => ({
    user_id,
    group_id: args.groupId,
    actor_id: uid,
    type: args.type,
    title: args.title.trim(),
    body: args.body ?? null,
    link: args.link ?? null,
  }));

  const { error } = await supabase.from('notifications').insert(rows);
  if (error) console.warn('그룹 알림 직접 저장 실패:', error.message);
}

/** 구버전 RPC가 다른 멤버만 넣은 경우, 본인 행을 한 줄 보강합니다. */
async function ensureSelfNotice(args: NotifyArgs) {
  const { data: session } = await supabase.auth.getUser();
  const uid = session.user?.id;
  if (!uid) return;

  const { data: existing } = await supabase
    .from('notifications')
    .select('id')
    .eq('user_id', uid)
    .eq('group_id', args.groupId)
    .eq('type', args.type)
    .eq('title', args.title.trim())
    .gte('created_at', new Date(Date.now() - 30_000).toISOString())
    .limit(1);
  if (existing && existing.length > 0) return;

  const { error } = await supabase.from('notifications').insert({
    user_id: uid,
    group_id: args.groupId,
    actor_id: uid,
    type: args.type,
    title: args.title.trim(),
    body: args.body ?? null,
    link: args.link ?? null,
  });
  if (error) console.warn('본인 알림 저장 실패:', error.message);
}

export function documentUploadNotice(fileNames: string[]) {
  const names = fileNames.map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) return null;
  if (names.length === 1) {
    return { title: `${names[0]} 파일이 업로드됐어요`, body: undefined as string | undefined };
  }
  return {
    title: `${names[0]} 외 ${names.length - 1}개 파일이 업로드됐어요`,
    body: names.join(', '),
  };
}

/** 문서 탭에 파일이 올라오면 파일명을 넣어 알립니다. */
export async function notifyDocumentUpload(groupId: string, fileNames: string[]) {
  const notice = documentUploadNotice(fileNames);
  if (!groupId || !notice) return;
  await notifyGroupMembers({
    groupId,
    type: 'document_update',
    title: notice.title,
    body: notice.body,
    link: '/documents',
    excludeSelf: false,
  });
}

/** 같은 그룹 멤버에게 알림을 넣습니다. SQL(13_알림.sql)이 필요합니다. */
export async function notifyGroupMembers(args: NotifyArgs) {
  if (!args.groupId || !args.title.trim()) return;
  const debounceKey = `${args.type}:${args.groupId}:${args.title}`;
  const wait = args.debounceMs ?? 0;
  if (wait > 0) {
    const prev = lastNotifyAt.get(debounceKey) ?? 0;
    if (Date.now() - prev < wait) return;
    lastNotifyAt.set(debounceKey, Date.now());
  }

  const { data, error } = await supabase.rpc('notify_group_members', {
    p_group_id: args.groupId,
    p_type: args.type,
    p_title: args.title.trim(),
    p_body: args.body ?? null,
    p_link: args.link ?? null,
    p_exclude_self: args.excludeSelf !== false,
  });
  // 구버전 SQL은 본인을 빼서 혼자 테스트하면 0건이 됩니다. 그때는 직접 insert 합니다.
  const inserted = typeof data === 'number' ? data : 0;
  if (error || inserted === 0) {
    if (error) console.warn('그룹 알림 저장 실패:', error.message);
    await notifyGroupMembersFallback(args);
    return;
  }

  if (args.excludeSelf === false) {
    await ensureSelfNotice(args);
  }
}

export function formatNoticeTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '어제';
  if (days < 7) return `${days}일 전`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
