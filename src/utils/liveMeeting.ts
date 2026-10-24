import { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { getApiBase } from './apiBase';
import { addGroupMember } from './joinGroup';
import type { MeetingChatMessage } from './meetingChat';

const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 새로고침 후에도 같은 회의 행을 쓰도록 이 탭에 남겨 둡니다. 나가면 지웁니다. */
function sessionMeetingKey(groupId: string) {
  return `grop-session-meeting:${groupId}`;
}

export function isUserId(value: string) {
  return USER_ID_RE.test(value);
}

export function readSessionMeetingId(groupId: string | undefined) {
  if (!groupId) return null;
  try {
    const id = sessionStorage.getItem(sessionMeetingKey(groupId));
    return id && isUserId(id) ? id : null;
  } catch {
    return null;
  }
}

export function rememberSessionMeetingId(groupId: string | undefined, meetingId: string) {
  if (!groupId || !isUserId(meetingId)) return;
  try {
    sessionStorage.setItem(sessionMeetingKey(groupId), meetingId);
  } catch {
    // 저장이 막혀도 이번 접속의 회의 행은 메모리에 남아 있습니다.
  }
}

export function forgetSessionMeetingId(groupId: string | undefined) {
  if (!groupId) return;
  try {
    sessionStorage.removeItem(sessionMeetingKey(groupId));
  } catch {
    // 없어도 다음 입장은 방 정보로 회의 행을 찾습니다.
  }
}

export type LiveRoomSnapshot = {
  name: string;
  meetingId: string | null;
  identities: string[];
};

/** 지금 사람이 있는 LiveKit 방. meetingId 가 목록에서 진행중으로 보일 행입니다. */
export async function fetchLiveRooms(): Promise<LiveRoomSnapshot[]> {
  try {
    const res = await fetch(`${getApiBase()}/api/live-rooms`);
    if (!res.ok) return [];
    const data = (await res.json()) as { rooms?: LiveRoomSnapshot[] };
    if (!Array.isArray(data.rooms)) return [];
    return data.rooms.map((room) => ({
      name: String(room.name || ''),
      meetingId: typeof room.meetingId === 'string' && isUserId(room.meetingId) ? room.meetingId : null,
      identities: Array.isArray(room.identities) ? room.identities.filter((id) => typeof id === 'string') : [],
    }));
  } catch {
    return [];
  }
}

/** 목록이 열려 있는 동안 방 인원을 다시 읽어 진행중/완료를 맞춥니다. */
export function useLiveRooms() {
  const [rooms, setRooms] = useState<LiveRoomSnapshot[]>([]);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const next = await fetchLiveRooms();
      if (!stop) setRooms(next);
    };
    void tick();
    const id = window.setInterval(tick, 4000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, []);

  return rooms;
}

export function liveIdentitiesFor(rooms: LiveRoomSnapshot[], meetingId: string) {
  return rooms.find((room) => room.meetingId === meetingId)?.identities.filter(isUserId) ?? [];
}

/** 지금 그 회의 방에 붙어 있는 사람 수. 끝난 회의의 누적 참석자와는 따로 셉니다. */
export function liveParticipantCount(rooms: LiveRoomSnapshot[], meetingId: string) {
  const identities = rooms.find((room) => room.meetingId === meetingId)?.identities ?? [];
  return new Set(identities.map((id) => id.trim()).filter(Boolean)).size;
}

/**
 * 채팅에 말이 없는 참석자도 목록 아이콘에 남도록, from 만 있는 기록을 붙입니다.
 * 본문이 비어 있어 채팅 화면과 AI 요약 재료에서는 빠집니다.
 */
export function withAttendeePresence(chat: MeetingChatMessage[], ids: string[]): MeetingChatMessage[] {
  const next = [...chat];
  const have = new Set(next.map((msg) => msg.from));
  for (const id of ids) {
    if (!isUserId(id) || have.has(id)) continue;
    next.push({ id: `presence-${id}`, from: id, name: '', text: '', ts: 0 });
    have.add(id);
  }
  return next;
}

/** AI 요약에는 실제 대화만 넘깁니다. */
export function chatLogForSummary(raw: unknown) {
  if (!Array.isArray(raw)) return raw ?? null;
  return raw.filter((msg) => {
    const text = typeof (msg as { text?: unknown })?.text === 'string' ? (msg as { text: string }).text.trim() : '';
    return text.length > 0;
  });
}

async function claimMeeting(roomName: string, meetingId: string): Promise<string | null> {
  try {
    const res = await fetch(`${getApiBase()}/api/live-room-meeting`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomName, meetingId }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { meetingId?: string };
    return typeof data.meetingId === 'string' && isUserId(data.meetingId) ? data.meetingId : null;
  } catch {
    return null;
  }
}

async function meetingIdInRoom(roomName: string): Promise<string | null> {
  const rooms = await fetchLiveRooms();
  return rooms.find((room) => room.name === roomName)?.meetingId ?? null;
}

function meetingTitle(now: Date) {
  return `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 회의`;
}

async function insertLiveMeeting(groupId: string, userId: string, attendeeIds: string[]) {
  await addGroupMember(groupId, userId);
  const now = new Date();
  const ids = attendeeIds.filter(isUserId);
  const base = {
    group_id: groupId,
    title: meetingTitle(now),
    date: now.toISOString(),
    created_by: userId,
  };
  const first = await supabase
    .from('meetings')
    .insert({ ...base, attendees: ids })
    .select('id')
    .maybeSingle();
  if (!first.error && first.data?.id) return first.data.id as string;
  if (first.error && !/attendees/i.test(first.error.message)) {
    console.warn('진행중 회의 행 생성 실패:', first.error.message);
    return null;
  }
  const second = await supabase.from('meetings').insert(base).select('id').maybeSingle();
  if (second.error || !second.data?.id) {
    console.warn('진행중 회의 행 생성 실패:', second.error?.message || first.error?.message);
    return null;
  }
  return second.data.id as string;
}

const ensuring = new Map<string, Promise<string | null>>();

/**
 * 이 방에 사람이 있는 동안 목록에 올라갈 회의 행을 하나 정합니다.
 * 먼저 들어온 쪽이 만들고, 나머지는 그 행을 따라갑니다.
 */
export function ensureLiveMeeting(opts: {
  groupId: string;
  userId: string;
  attendeeIds: string[];
  preferredId?: string | null;
  isLeader: boolean;
}): Promise<string | null> {
  const running = ensuring.get(opts.groupId);
  if (running) return running;
  const job = ensureLiveMeetingBody(opts).finally(() => {
    ensuring.delete(opts.groupId);
  });
  ensuring.set(opts.groupId, job);
  return job;
}

async function ensureLiveMeetingBody(opts: {
  groupId: string;
  userId: string;
  attendeeIds: string[];
  preferredId?: string | null;
  isLeader: boolean;
}): Promise<string | null> {
  const { groupId, userId, preferredId, isLeader } = opts;
  const attendeeIds = opts.attendeeIds.filter(isUserId);

  if (preferredId && isUserId(preferredId)) {
    // 새로고침 직후에는 방이 아직 목록에 없을 수 있어 같은 회의 행을 몇 번 더 붙입니다.
    for (let i = 0; i < 4; i += 1) {
      const claimed = await claimMeeting(groupId, preferredId);
      if (claimed) return claimed;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  const existing = await meetingIdInRoom(groupId);
  if (existing) return existing;

  // 두 사람이 동시에 들어오면 방금 연결된 상대가 목록에 잡힌 뒤에 한 명만 행을 만듭니다.
  if (!isLeader) {
    for (let i = 0; i < 8; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const found = await meetingIdInRoom(groupId);
      if (found) return found;
    }
  } else {
    await new Promise((resolve) => setTimeout(resolve, 700));
    const found = await meetingIdInRoom(groupId);
    if (found) return found;
  }

  const created = await insertLiveMeeting(groupId, userId, attendeeIds);
  if (!created) return null;
  const claimed = await claimMeeting(groupId, created);
  if (claimed && claimed !== created) {
    // 다른 사람이 먼저 행을 만들었습니다. 내가 만든 빈 행은 지울 수 있으면 지웁니다.
    await supabase.from('meetings').delete().eq('id', created);
    return claimed;
  }
  return claimed || created;
}

/** 지금까지 들어온 사람 id를 회의 행에 더합니다. 나중에 저장하는 사람이 앞사람을 지우지 않습니다. */
export async function mergeMeetingAttendees(meetingId: string, ids: string[]) {
  const incoming = ids.filter(isUserId);
  if (!meetingId || incoming.length === 0) return;

  const read = await supabase.from('meetings').select('attendees, chat_log').eq('id', meetingId).maybeSingle();
  let attendees: unknown = read.data?.attendees;
  let chatRaw: unknown = read.data?.chat_log;
  let attendeesMissing = false;
  if (read.error) {
    if (!/attendees|chat_log/i.test(read.error.message)) {
      console.warn('참석자 조회 실패:', read.error.message);
      return;
    }
    // attendees 칸이 없어도 채팅 기록의 from 으로 아이콘을 찾을 수 있게 남깁니다.
    attendeesMissing = /attendees/i.test(read.error.message);
    const chatOnly = await supabase.from('meetings').select('chat_log').eq('id', meetingId).maybeSingle();
    attendees = null;
    chatRaw = chatOnly.data?.chat_log;
  }

  const prev = Array.isArray(attendees)
    ? attendees.filter((id): id is string => typeof id === 'string' && isUserId(id))
    : [];
  const merged = [...prev];
  for (const id of incoming) {
    if (!merged.includes(id)) merged.push(id);
  }

  if (!attendeesMissing && merged.length > 0) {
    const { error } = await supabase.from('meetings').update({ attendees: merged }).eq('id', meetingId);
    if (error && !/attendees/i.test(error.message)) {
      console.warn('참석자 저장 실패:', error.message);
    }
  }

  const chat = Array.isArray(chatRaw) ? chatRaw as MeetingChatMessage[] : [];
  const withPresence = withAttendeePresence(chat, merged.length > 0 ? merged : incoming);
  if (withPresence.length === chat.length) return;
  const { error } = await supabase.from('meetings').update({ chat_log: withPresence }).eq('id', meetingId);
  if (error && !/chat_log/i.test(error.message)) {
    console.warn('참석자 채팅 기록 저장 실패:', error.message);
  }
}
