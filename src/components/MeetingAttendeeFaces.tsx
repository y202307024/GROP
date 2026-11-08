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
      if (typeof item === 'string') {
        const value = item.trim();
        if (USER_ID_RE.test(value)) add(value);
        else {
          const id = nicknameToId?.get(value);
          if (id) add(id);
        }
        continue;
      }
      // 진행 중 저장분이 { user_id } 형태여도 같은 사람만 고릅니다.
      if (item && typeof item === 'object') add((item as { user_id?: unknown }).user_id);
    }
  }
  if (Array.isArray(meeting.chat_log)) {
    for (const msg of meeting.chat_log) {
      const from = (msg as { from?: unknown; name?: unknown }).from;
      add(from);
      if (typeof from === 'string' && !USER_ID_RE.test(from.trim())) {
        const id = nicknameToId?.get(from.trim());
        if (id) add(id);
      }
      const name = (msg as { name?: unknown }).name;
      if (typeof name === 'string') {
        const id = nicknameToId?.get(name.trim());
        if (id) add(id);
      }
    }
  }
  if (ids.length === 0) add(meeting.created_by);
  return ids;
}

function asList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [raw];
  } catch {
    return [raw];
  }
}

/**
 * 그 회의에 들어온 사람 수.
 * 아이콘으로 그릴 수 없는 닉네임도 한 명으로 셉니다. 같은 사람은 한 번만 셉니다.
 */
export function meetingAttendeeCount(
  meeting: AttendeeSource,
  nicknameToId?: Map<string, string>,
): number {
  const people = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== 'string') return;
    const text = value.trim();
    if (!text || text === '익명' || text === '참여자' || text === '나') return;
    if (USER_ID_RE.test(text)) {
      people.add(text.toLowerCase());
      return;
    }
    const mapped = nicknameToId?.get(text);
    people.add(mapped ? mapped.toLowerCase() : `name:${text}`);
  };

  for (const item of asList(meeting.attendees)) {
    if (typeof item === 'string') {
      add(item);
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const row = item as { user_id?: unknown; nickname?: unknown; name?: unknown };
    const before = people.size;
    add(row.user_id);
    // id가 있으면 같은 사람의 닉네임은 다시 세지 않습니다.
    if (people.size === before) {
      add(row.nickname);
      add(row.name);
    }
  }
  for (const msg of asList(meeting.chat_log)) {
    if (!msg || typeof msg !== 'object') continue;
    const row = msg as { from?: unknown; name?: unknown };
    const before = people.size;
    add(row.from);
    if (people.size === before) add(row.name);
  }
  if (people.size === 0) add(meeting.created_by);
  return people.size;
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
      // 이모지나 빈 값은 나중에 기본 얼굴로 바꾸므로, 프리셋·사진 주소만 기억합니다.
      if (row.avatar && row.avatar !== '🐱') avatarByUserId[row.user_id] = row.avatar;
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
