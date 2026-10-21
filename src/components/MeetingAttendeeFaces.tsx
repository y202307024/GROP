import { supabase } from '../services/supabaseClient';
import { getAvatarSrc } from '../utils/avatarOptions';

const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AttendeeSource = {
  attendees?: unknown;
  chat_log?: unknown;
  created_by?: string | null;
};

/**
 * 그 회의에 들어온 사람 user id.
 * 저장된 값이 닉네임이면 nicknameToId로 찾고, 기록이 없으면 녹화를 저장한 사람만 씁니다.
 */
export function attendeeUserIds(
  meeting: AttendeeSource,
  nicknameToId?: Map<string, string>,
): string[] {
  const ids: string[] = [];
  const add = (value: unknown) => {
    if (typeof value !== 'string') return;
    const id = value.trim();
    if (!USER_ID_RE.test(id) || ids.includes(id)) return;
    ids.push(id);
  };

  if (Array.isArray(meeting.attendees)) {
    for (const item of meeting.attendees) {
      if (typeof item !== 'string') continue;
      const value = item.trim();
      if (USER_ID_RE.test(value)) add(value);
      else {
        const id = nicknameToId?.get(value);
        if (id) add(id);
      }
    }
  }
  if (Array.isArray(meeting.chat_log)) {
    for (const msg of meeting.chat_log) {
      add((msg as { from?: unknown }).from);
    }
  }
  if (ids.length === 0) add(meeting.created_by);
  return ids;
}

export type GroupFaceIndex = {
  avatarByUserId: Record<string, string>;
  nicknameToIdByGroup: Map<string, Map<string, string>>;
};

/** 그룹 멤버의 프로필 아이콘과 닉네임→user id. 회의 목록 참석자 칸에서 같이 씁니다. */
export async function loadGroupFaceIndex(groupIds: string[]): Promise<GroupFaceIndex> {
  const avatarByUserId: Record<string, string> = {};
  const nicknameToIdByGroup = new Map<string, Map<string, string>>();
  await Promise.all(groupIds.map(async (groupId) => {
    const { data } = await supabase.rpc('get_group_members_with_profiles', { p_group_id: groupId });
    const nicknames = new Map<string, string>();
    for (const row of (data as { user_id?: string; nickname?: string; avatar?: string }[]) || []) {
      if (!row.user_id) continue;
      if (row.avatar) avatarByUserId[row.user_id] = row.avatar;
      const nick = row.nickname?.trim();
      if (nick) nicknames.set(nick, row.user_id);
    }
    nicknameToIdByGroup.set(groupId, nicknames);
  }));
  return { avatarByUserId, nicknameToIdByGroup };
}

/**
 * 회의 목록의 참석자 칸.
 * 그 회의에 들어온 사람의 프로필 아이콘을 최대 3개까지 겹쳐 보여 줍니다.
 * 4명부터는 넘친 인원을 +숫자로 표시합니다.
 */
export default function MeetingAttendeeFaces({
  ids,
  avatarByUserId,
}: {
  ids: string[];
  avatarByUserId: Record<string, string>;
}) {
  if (ids.length === 0) return <span className="attendees">—</span>;

  const shown = ids.slice(0, 3);
  const extra = ids.length - shown.length;
  return (
    <span className="attendees" aria-label={`참석자 ${ids.length}명`}>
      {shown.map((id) => (
        <img key={id} src={getAvatarSrc(avatarByUserId[id])} alt="" />
      ))}
      {extra > 0 ? <span className="attendees-more">+{extra}</span> : null}
    </span>
  );
}
