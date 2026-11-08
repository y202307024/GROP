import { supabase } from '../services/supabaseClient';
import { fetchDisplayNickname, notifyGroupMembers } from './notifications';

type JoinResult =
  | { ok: true; group: { id: string; name: string }; alreadyMember: boolean }
  | { ok: false; error: string };

export function isDuplicateMemberError(message: string): boolean {
  return (
    message.includes('duplicate')
    || message.includes('unique')
    || message.includes('group_members_group_user_uidx')
  );
}

/**
 * 같은 사람이 group_members에 여러 줄이면 먼저 나온 한 줄만 남깁니다.
 * 조회는 가입 시각 순이라, 남는 줄이 그 사람의 처음 가입입니다.
 */
export function uniqueMembersByUserId<T extends { user_id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const row of rows) {
    if (!row.user_id || seen.has(row.user_id)) continue;
    seen.add(row.user_id);
    unique.push(row);
  }
  return unique;
}

/**
 * 그룹 멤버를 한 줄만 넣습니다.
 * 회의 입장·녹화 저장에서도 이 함수를 부르므로, 이미 있으면 다시 insert 하지 않습니다.
 * unique index 가 없는 배포에서는 insert 가 그대로 통과해 같은 사람이 두 줄이 됩니다.
 */
export async function addGroupMember(
  groupId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: existing, error: lookupError } = await supabase
    .from('group_members')
    .select('user_id')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .limit(1);
  if (lookupError) return { ok: false, error: lookupError.message };
  if (existing && existing.length > 0) return { ok: true };

  const { error } = await supabase
    .from('group_members')
    .insert({ group_id: groupId, user_id: userId });

  if (!error) return { ok: true };
  if (isDuplicateMemberError(error.message)) return { ok: true };
  return { ok: false, error: error.message };
}

export async function joinGroupByInviteCode(inviteCode: string, userId: string): Promise<JoinResult> {
  const code = inviteCode.trim().toUpperCase();
  if (!code) return { ok: false, error: '초대코드를 입력해주세요.' };

  const { data: group, error: findError } = await supabase
    .from('groups')
    .select('id, name')
    .eq('invite_code', code)
    .maybeSingle();

  if (findError) return { ok: false, error: findError.message };
  if (!group) return { ok: false, error: '그룹을 찾을 수 없어요. 초대코드를 확인해 주세요.' };

  // 이미 두 줄 이상이면 maybeSingle 이 실패해서 또 한 줄을 넣게 되므로, 한 줄만 확인합니다.
  const { data: existing, error: existingError } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('group_id', group.id)
    .eq('user_id', userId)
    .limit(1);
  if (existingError) return { ok: false, error: existingError.message };
  if (existing && existing.length > 0) return { ok: true, group, alreadyMember: true };

  const joinResult = await addGroupMember(group.id, userId);
  if (!joinResult.ok) {
    return { ok: false, error: joinResult.error };
  }

  // DB 트리거가 기본 경로이고, SQL이 아직이면 여기서도 한 번 넣습니다.
  const nickname = await fetchDisplayNickname(userId, group.id);
  await notifyGroupMembers({
    groupId: group.id,
    type: 'group_join',
    title: `${nickname} 님이 ${group.name}에 참여했어요`,
    link: `/group/${group.id}`,
  });

  return { ok: true, group, alreadyMember: false };
}

export function buildInviteLink(inviteCode: string) {
  return `${window.location.origin}/join/${encodeURIComponent(inviteCode.trim().toUpperCase())}`;
}
