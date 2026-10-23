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

/** unique index 없어도 동작 (plain insert). 중복이면 성공으로 처리 */
export async function addGroupMember(
  groupId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
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

  const { data: existing } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('group_id', group.id)
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) return { ok: true, group, alreadyMember: true };

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
