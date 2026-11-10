import { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { getApiBase } from './apiBase';
import { addGroupMember } from './joinGroup';
import { mergeChatMessages, realChatMessages, type MeetingChatMessage } from './meetingChat';
import { localDayKey } from './meetingDocs';

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
  /** 서버가 센 방 인원. 참가자 id를 못 읽어도 진행중 인원으로 씁니다. */
  numParticipants?: number;
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
      numParticipants: Number(room.numParticipants) > 0 ? Number(room.numParticipants) : undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * 목록이 열려 있는 동안 방 인원을 다시 읽습니다.
 * ready 전에는 방이 비어 있어 진행중 회의가 완료로 보였다가 바뀌므로, 첫 응답 뒤에만 상태를 그립니다.
 */
export function useLiveRooms() {
  const [rooms, setRooms] = useState<LiveRoomSnapshot[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const next = await fetchLiveRooms();
      if (stop) return;
      setRooms(next);
      setReady(true);
    };
    void tick();
    const id = window.setInterval(tick, 4000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, []);

  return { rooms, ready };
}

export function liveIdentitiesFor(rooms: LiveRoomSnapshot[], meetingId: string) {
  return rooms.find((room) => room.meetingId === meetingId)?.identities.filter(isUserId) ?? [];
}

/** 지금 그 방에 붙어 있는 사람 수. id 목록이 비어도 서버가 센 인원을 씁니다. */
export function liveHeadcount(room: LiveRoomSnapshot) {
  const ids = new Set(room.identities.map((id) => id.trim()).filter(Boolean));
  return Math.max(ids.size, room.numParticipants ?? 0);
}

/**
 * 이 회의 행이 지금 사람이 있는 방인지.
 * 방 이름은 그룹 id입니다. 녹화가 새 행을 만들어도, 사람이 있는 그 회의만 진행중입니다.
 */
export function liveRoomForMeeting(
  rooms: LiveRoomSnapshot[],
  meeting: { id: string; group_id: string },
  meetingsNewestFirst: { id: string; group_id: string }[],
): LiveRoomSnapshot | null {
  const byId = rooms.find((room) => room.meetingId === meeting.id);
  if (byId) return byId;
  const byGroup = rooms.find((room) => room.name === meeting.group_id);
  if (!byGroup || (byGroup.meetingId && byGroup.meetingId !== meeting.id)) return null;
  // 방에 회의 id가 없으면, 그 그룹에서 가장 최근 행만 진행중으로 봅니다.
  const newest = meetingsNewestFirst.find((row) => row.group_id === meeting.group_id);
  return newest?.id === meeting.id ? byGroup : null;
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

/** 회의 한 건의 chat_log에 남겨 두는 메시지 상한. 화면에는 여러 회의를 모아 보여 줍니다. */
const MAX_STORED_CHAT_MESSAGES = 500;
/** 채팅창에 불러올 최근 회의 수. 이보다 오래된 행은 회의 상세의 채팅 기록에서 봅니다. */
const CHAT_HISTORY_MEETINGS = 40;

export type GroupChatHistoryRow = {
  meetingId: string;
  messages: MeetingChatMessage[];
};

/**
 * 이 그룹에서 이미 저장된 채팅을 최근 회의부터 가져옵니다.
 * 방을 나갔다가 다시 들어와도 이전 대화가 채팅창에 남게 하려는 목록입니다.
 */
export async function loadGroupChatHistory(groupId: string): Promise<GroupChatHistoryRow[]> {
  if (!groupId) return [];
  const { data, error } = await supabase
    .from('meetings')
    .select('id, chat_log')
    .eq('group_id', groupId)
    .order('date', { ascending: false })
    .limit(CHAT_HISTORY_MEETINGS);
  if (error) {
    if (!/chat_log/i.test(error.message)) console.warn('이전 채팅 조회 실패:', error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    meetingId: String(row.id),
    messages: realChatMessages(row.chat_log),
  }));
}

/**
 * 같은 그룹·같은 날 회의의 채팅을 한 목록으로 모읍니다.
 * 녹화본과 채팅이 다른 회의 행에 있어도, 요약 화면의 채팅 기록에서 함께 보이게 합니다.
 */
export async function collectSameDayChat(groupId: string, dateIso: string): Promise<MeetingChatMessage[]> {
  if (!groupId || !dateIso) return [];
  const day = localDayKey(dateIso);
  const anchor = new Date(dateIso);
  if (Number.isNaN(anchor.getTime())) return [];
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const { data, error } = await supabase
    .from('meetings')
    .select('date, chat_log')
    .eq('group_id', groupId)
    .gte('date', start.toISOString())
    .lt('date', end.toISOString());
  if (error) {
    if (!/chat_log/i.test(error.message)) console.warn('채팅 기록 조회 실패:', error.message);
    return [];
  }

  const all: MeetingChatMessage[] = [];
  for (const row of data ?? []) {
    if (!row.date || localDayKey(row.date) !== day) continue;
    all.push(...realChatMessages(row.chat_log));
  }
  return mergeChatMessages([], all);
}

/**
 * 이번 회의 메시지를 chat_log에 합칩니다.
 * 이미 있는 참석자 자리표시나 다른 사람이 쓴 메시지는 지우지 않습니다.
 * 컬럼이 아직 없으면 조용히 넘어갑니다. (supabase/15_채팅기록.sql)
 */
export async function appendMeetingChat(meetingId: string, incoming: MeetingChatMessage[]) {
  const fresh = incoming.filter((m): m is MeetingChatMessage => (
    !!m
    && typeof m.id === 'string'
    && typeof m.text === 'string'
    && m.text.trim() !== ''
    && typeof m.ts === 'number'
  ));
  if (!meetingId || fresh.length === 0) return;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const read = await supabase.from('meetings').select('chat_log').eq('id', meetingId).maybeSingle();
    if (read.error) {
      if (/chat_log/i.test(read.error.message)) return;
      console.warn('채팅 기록 조회 실패:', read.error.message);
      return;
    }

    const prev = Array.isArray(read.data?.chat_log) ? read.data.chat_log : [];
    const byId = new Map<string, unknown>();
    for (const item of prev) {
      if (!item || typeof item !== 'object') continue;
      const id = (item as { id?: unknown }).id;
      if (typeof id === 'string') byId.set(id, item);
    }

    let changed = false;
    for (const msg of fresh) {
      if (!byId.has(msg.id)) changed = true;
      // 화면·요약이 읽는 필드만 저장합니다. 파일 첨부는 문서 목록이 따로 맡습니다.
      byId.set(msg.id, {
        id: msg.id,
        from: msg.from,
        name: msg.name,
        text: msg.text,
        ts: msg.ts,
      });
    }
    if (!changed) return;

    const merged = [...byId.values()]
      .sort((a, b) => {
        const ta = typeof (a as { ts?: unknown }).ts === 'number' ? (a as { ts: number }).ts : 0;
        const tb = typeof (b as { ts?: unknown }).ts === 'number' ? (b as { ts: number }).ts : 0;
        return ta - tb;
      })
      .slice(-MAX_STORED_CHAT_MESSAGES);

    const wrote = await supabase.from('meetings').update({ chat_log: merged }).eq('id', meetingId);
    if (wrote.error) {
      if (/chat_log/i.test(wrote.error.message)) return;
      console.warn('채팅 기록 저장 실패:', wrote.error.message);
      return;
    }

    // 다른 참가자가 같은 칸을 덮어썼으면, 빠진 메시지만 다시 합칩니다.
    const check = await supabase.from('meetings').select('chat_log').eq('id', meetingId).maybeSingle();
    if (check.error || !Array.isArray(check.data?.chat_log)) return;
    const saved = new Set(
      check.data.chat_log
        .map((item) => (item && typeof item === 'object' ? (item as { id?: unknown }).id : null))
        .filter((id): id is string => typeof id === 'string'),
    );
    if (fresh.every((m) => saved.has(m.id))) return;
  }
}
