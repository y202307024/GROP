import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { RoomEvent, type RemoteParticipant } from 'livekit-client';
import { useLocalParticipant, useParticipants, useRoomContext } from '@livekit/components-react';
import styles from './MeetingChatPanel.module.css';
import { supabase } from '../services/supabaseClient';
import {
  DISPLAY_CHAT_LIMIT,
  MEETING_CHAT_TOPIC,
  chatDayKey,
  decodeMeetingChatMessage,
  encodeMeetingChatMessage,
  formatChatDay,
  formatChatTime,
  mergeChatMessages,
  type MeetingChatMessage,
} from '../utils/meetingChat';
import { appendMeetingChat, loadGroupChatHistory } from '../utils/liveMeeting';
import { getAvatarSrc } from '../utils/avatarOptions';

type Props = {
  groupId?: string;
  /** 사이드바 상단에 표시·편집하는 그룹 이름 */
  groupName?: string;
  /** 이름 저장 후 부모(헤더 등) 상태를 맞출 때 사용 */
  onGroupNameChange?: (name: string) => void;
  /** 로컬 헤드셋(스피커) 음소거 — RoomAudioRenderer volume과 연동 */
  speakerMuted?: boolean;
  onSpeakerMutedChange?: (muted: boolean) => void;
  /** 부모(Room)가 채팅 기록을 녹화 저장에 쓸 수 있게 최신 메시지를 미러링합니다. */
  chatLogRef?: RefObject<MeetingChatMessage[]>;
  /** 이번 접속의 회의 행. 채팅은 이 행에만 저장하고, 예전 회의 글은 화면 기록으로만 둡니다. */
  sessionMeetingIdRef?: RefObject<string | null>;
  /** 나가기 직전에 아직 안 올라간 채팅을 회의 행에 남기라고 부모가 호출합니다. */
  chatFlushRef?: RefObject<(() => Promise<void>) | null>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 헤드셋(스피커) 꺼짐 여부를 다른 참가자에게 알리는 데이터 채널 topic */
const MEETING_HEADSET_TOPIC = 'meeting-headset';
/** 늦게 들어온 참가자가 이전 채팅을 요청·수신하는 데이터 채널 topic */
const MEETING_CHAT_HISTORY_TOPIC = 'meeting-chat-history';
/** LiveKit reliable 메시지 한 개 크기 제한(약 15KB)보다 작게 나눠 보냅니다. */
const HISTORY_CHUNK_BYTES = 12_000;

type ChatHistoryPacket =
  | { type: 'request' }
  | { type: 'history'; messages: MeetingChatMessage[] };

/** 채팅 기록을 크기 제한에 맞는 묶음들로 나눕니다. */
function chunkChatHistory(messages: MeetingChatMessage[]) {
  const encoder = new TextEncoder();
  const chunks: MeetingChatMessage[][] = [];
  let current: MeetingChatMessage[] = [];
  let size = 0;
  for (const msg of messages) {
    const bytes = encoder.encode(JSON.stringify(msg)).length + 1;
    if (current.length > 0 && size + bytes > HISTORY_CHUNK_BYTES) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(msg);
    size += bytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function participantInitial(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return trimmed[0] ?? '?';
}

/** 메시지·LiveKit 참가자에서 사람이 읽을 이름을 고릅니다. UUID는 숨깁니다. */
function readableName(raw?: string | null) {
  const name = raw?.trim();
  if (!name || UUID_RE.test(name)) return '';
  return name;
}

function senderLabel(
  msg: MeetingChatMessage,
  localId: string,
  participants: { identity: string; name?: string }[],
) {
  if (msg.from === localId) return '나';
  const live = participants.find((p) => p.identity === msg.from);
  return readableName(msg.name) || readableName(live?.name) || '참여자';
}

function HeadsetIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 14v-2a9 9 0 0 1 18 0v2" />
      <path d="M21 16a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2h3z" />
      <path d="M3 16a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2H3z" />
      {muted ? <path d="M2 2l20 20" /> : null}
    </svg>
  );
}

function MicIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {muted ? (
        <>
          <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
          <path d="M15 9.34V6a3 3 0 0 0-5.68-1.33" />
          <path d="M19 10v1a7 7 0 0 1-1.2 3.8" />
          <path d="M5 10v1a7 7 0 0 0 11 5.2" />
          <path d="M12 18v3M2 2l20 20" />
        </>
      ) : (
        <>
          <path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z" />
          <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
          <path d="M12 18v3" />
        </>
      )}
    </svg>
  );
}

/**
 * 회의방 오른쪽 사이드바
 * 상단: 그룹명(편집) + 참가자(아바타·헤드셋·마이크)
 * 하단: 고정 높이 채팅(스크롤) + 텍스트 입력
 * 채팅은 이 그룹의 이전 회의 기록과 함께 보여 주고, 이번 회의 메시지는 meetings.chat_log에 남깁니다.
 * 파일 첨부는 하단 툴바 파일 도구로 통일했습니다.
 */
export default function MeetingChatPanel({
  groupId: _groupId,
  groupName = '',
  onGroupNameChange,
  speakerMuted = false,
  onSpeakerMutedChange,
  chatLogRef,
  sessionMeetingIdRef,
  chatFlushRef,
}: Props) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  /** 이미 회의 행에 저장된 채팅. 이번 회의와 예전 회의가 함께 들어 있습니다. */
  const [archive, setArchive] = useState<MeetingChatMessage[]>([]);
  /** 이번 접속에서 주고받은 채팅. 저장 전에도 화면에 바로 붙입니다. */
  const [live, setLive] = useState<MeetingChatMessage[]>([]);
  /** 저장된 메시지 id → 그 메시지가 속한 회의 행. 요약에는 이번 회의만 넘기기 위해 state로 둡니다. */
  const [meetingOf, setMeetingOf] = useState<Map<string, string>>(() => new Map());
  /** 이번 회의 행 id. LiveMeetingPresence가 ref에 넣은 값은 아래 effect가 따라갑니다. */
  const [meetingId, setMeetingId] = useState<string | null>(null);
  /** 녹화·요약·늦게 들어온 사람에게 넘길 이번 회의 채팅만 담습니다. */
  const sessionMessagesRef = useRef<MeetingChatMessage[]>([]);
  /** 채팅 저장이 겹치면 앞선 저장이 끝난 뒤에 이어서 씁니다. */
  const persistChainRef = useRef(Promise.resolve());
  const [draft, setDraft] = useState('');
  /** identity → 그 참가자가 헤드셋을 껐는지 (데이터 채널로 받은 값) */
  const [remoteHeadsetOff, setRemoteHeadsetOff] = useState<Record<string, boolean>>({});
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(groupName);
  const [seenName, setSeenName] = useState({ groupName, editingName: false });
  // 이름을 고치는 중이 아니면 화면 이름을 입력칸에 맞춥니다.
  if (groupName !== seenName.groupName || editingName !== seenName.editingName) {
    setSeenName({ groupName, editingName });
    if (!editingName) setNameDraft(groupName);
  }
  const [savingName, setSavingName] = useState(false);
  /** identity(userId) → 프로필 아바타(key 또는 URL) */
  const [avatarByUserId, setAvatarByUserId] = useState<Record<string, string>>({});
  const listRef = useRef<HTMLDivElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus();
  }, [editingName]);

  // 날짜 줄의 "오늘"은 렌더마다 Date.now()를 부르지 않고, 분이 바뀌거나 탭으로 돌아올 때 갱신합니다.
  const [todayKey, setTodayKey] = useState(() => chatDayKey(Date.now()));
  useEffect(() => {
    const refresh = () => {
      const next = chatDayKey(Date.now());
      setTodayKey((prev) => (prev === next ? prev : next));
    };
    const id = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  // 헤드셋은 내 스피커만 끄는 로컬 상태라 다른 사람에게 자동으로 전달되지 않습니다.
  // 채팅과 같은 데이터 채널로 내 상태를 보내, 다른 참가자 화면의 헤드셋 아이콘이 따라 바뀌게 합니다.
  useEffect(() => {
    const publish = () => {
      if (room.state !== 'connected') return;
      const payload = new TextEncoder().encode(JSON.stringify({ off: speakerMuted }));
      room.localParticipant
        .publishData(payload, { reliable: true, topic: MEETING_HEADSET_TOPIC })
        .catch((err) => console.warn('헤드셋 상태 공유 실패:', err));
    };
    publish();
    // 데이터 메시지는 저장되지 않으므로, 연결·재연결 때와 새 참가자가 들어올 때마다 다시 보냅니다.
    room.on(RoomEvent.Connected, publish);
    room.on(RoomEvent.ParticipantConnected, publish);
    return () => {
      room.off(RoomEvent.Connected, publish);
      room.off(RoomEvent.ParticipantConnected, publish);
    };
  }, [room, speakerMuted]);

  // 다른 참가자가 보낸 헤드셋 상태를 받아 둡니다. 나간 참가자 값은 지웁니다.
  useEffect(() => {
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== MEETING_HEADSET_TOPIC || !participant?.identity) return;
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload)) as { off?: unknown };
        setRemoteHeadsetOff((prev) => ({ ...prev, [participant.identity]: msg.off === true }));
      } catch {
        // 형식이 다른 메시지는 무시합니다.
      }
    };
    const onLeft = (participant: RemoteParticipant) => {
      setRemoteHeadsetOff((prev) => {
        const next = { ...prev };
        delete next[participant.identity];
        return next;
      });
    };
    room.on(RoomEvent.DataReceived, onData);
    room.on(RoomEvent.ParticipantDisconnected, onLeft);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
      room.off(RoomEvent.ParticipantDisconnected, onLeft);
    };
  }, [room]);

  // 참가자 프로필 사진 — 그룹 프로필 우선, 없으면 기본 프로필
  const participantIdsKey = participants
    .map((p) => p.identity)
    .filter((id) => UUID_RE.test(id))
    .sort()
    .join(',');
  const [seenParticipantIds, setSeenParticipantIds] = useState(participantIdsKey);
  // 참가자가 없으면 아바타 목록을 비웁니다.
  if (participantIdsKey !== seenParticipantIds) {
    setSeenParticipantIds(participantIdsKey);
    if (!participantIdsKey) setAvatarByUserId({});
  }

  useEffect(() => {
    const ids = participantIdsKey ? participantIdsKey.split(',') : [];
    if (ids.length === 0) return;

    let cancelled = false;
    const load = async () => {
      const map: Record<string, string> = {};

      if (_groupId) {
        const { data: groupRows } = await supabase
          .from('group_profiles')
          .select('user_id, avatar, avatar_url')
          .eq('group_id', _groupId)
          .in('user_id', ids);
        for (const row of groupRows ?? []) {
          if (!row?.user_id) continue;
          const value = (row.avatar_url || row.avatar || '').trim();
          if (value) map[row.user_id] = value;
        }
      }

      const missing = ids.filter((id) => !map[id]);
      if (missing.length > 0) {
        const { data: profileRows } = await supabase
          .from('profiles')
          .select('id, avatar, avatar_url')
          .in('id', missing);
        for (const row of profileRows ?? []) {
          if (!row?.id) continue;
          const value = (row.avatar_url || row.avatar || '').trim();
          if (value) map[row.id] = value;
        }
      }

      if (!cancelled) setAvatarByUserId(map);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [participantIdsKey, _groupId]);

  // 저장된 이전 채팅 + 이번 접속 채팅. 같은 글은 id로 한 번만 보여 줍니다.
  const shown = useMemo(
    () => mergeChatMessages(archive, live, DISPLAY_CHAT_LIMIT),
    [archive, live],
  );
  // 예전 회의 글은 화면 기록입니다. 이번 회의 행에 속한 글과 방금 주고받은 글만 저장·요약에 넘깁니다.
  const sessionLog = useMemo(() => {
    if (!meetingId) return live;
    const mine = archive.filter((m) => meetingOf.get(m.id) === meetingId);
    return mergeChatMessages(mine, live, DISPLAY_CHAT_LIMIT);
  }, [archive, live, meetingId, meetingOf]);
  // ref는 이벤트(저장·기록 공유)에서만 읽습니다. 렌더 중에 쓰면 그 렌더의 채팅이 반영되기 전에 읽힐 수 있습니다.
  useEffect(() => {
    sessionMessagesRef.current = sessionLog;
    if (chatLogRef) chatLogRef.current = sessionLog;
  }, [sessionLog, chatLogRef]);

  useEffect(() => {
    const read = () => {
      const next = sessionMeetingIdRef?.current ?? null;
      setMeetingId((prev) => (prev === next ? prev : next));
    };
    read();
    const timer = window.setInterval(read, 500);
    return () => window.clearInterval(timer);
  }, [sessionMeetingIdRef]);

  // 그룹에 남아 있는 채팅을 불러옵니다. 회의 행이 정해진 뒤 한 번 더 읽어, 방금 저장된 글도 붙입니다.
  useEffect(() => {
    if (!_groupId) return;
    let cancelled = false;
    void loadGroupChatHistory(_groupId).then((rows) => {
      if (cancelled) return;
      const map = new Map<string, string>();
      const all: MeetingChatMessage[] = [];
      for (const row of rows) {
        for (const msg of row.messages) {
          map.set(msg.id, row.meetingId);
          all.push(msg);
        }
      }
      setMeetingOf(map);
      const next = mergeChatMessages([], all, DISPLAY_CHAT_LIMIT);
      // 같은 목록이면 참조를 유지해, 회의 id가 잡힐 때마다 채팅이 맨 아래로 다시 스크롤되지 않게 합니다.
      setArchive((prev) => (
        prev.length === next.length && prev.every((m, i) => m.id === next[i]?.id) ? prev : next
      ));
    });
    return () => {
      cancelled = true;
    };
  }, [_groupId, meetingId]);

  useEffect(() => {
    const handler = (payload: Uint8Array, _participant?: unknown, _kind?: unknown, topic?: string) => {
      if (topic && topic !== MEETING_CHAT_TOPIC) return;
      const msg = decodeMeetingChatMessage(payload);
      // 파일만 있는 옛 메시지는 채팅에 표시하지 않습니다.
      if (!msg || (!msg.text.trim() && msg.file)) return;
      setLive((prev) => mergeChatMessages(prev, [msg]));
    };
    room.on(RoomEvent.DataReceived, handler);
    return () => { room.off(RoomEvent.DataReceived, handler); };
  }, [room]);

  // 아직 저장 전에 들어온 사람은 방 안의 이번 회의 채팅을 데이터 채널로 받습니다.
  // 방을 비웠다 다시 들어오는 기록은 위의 회의 행(chat_log)에서 불러옵니다.

  useEffect(() => {
    const send = (packet: ChatHistoryPacket, to?: string) => {
      const payload = new TextEncoder().encode(JSON.stringify(packet));
      return room.localParticipant
        .publishData(payload, {
          reliable: true,
          topic: MEETING_CHAT_HISTORY_TOPIC,
          destinationIdentities: to ? [to] : undefined,
        })
        .catch((err) => console.warn('채팅 기록 공유 실패:', err));
    };

    const requestHistory = () => {
      if (room.state !== 'connected') return;
      void send({ type: 'request' });
    };

    // 요청한 사람을 뺀 참가자 중 가장 먼저 들어온 사람만 응답해 중복 전송을 막습니다.
    // (입장 시각이 같으면 identity 순으로 정해 모든 참가자가 같은 결론을 내립니다.)
    const isResponder = (requester: string) => {
      const candidates = [room.localParticipant, ...room.remoteParticipants.values()]
        .filter((p) => p.identity && p.identity !== requester)
        .sort((a, b) => {
          const ta = a.joinedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
          const tb = b.joinedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
          return ta - tb || a.identity.localeCompare(b.identity);
        });
      return candidates[0]?.identity === room.localParticipant.identity;
    };

    const onData = async (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== MEETING_CHAT_HISTORY_TOPIC || !participant?.identity) return;
      let packet: ChatHistoryPacket;
      try {
        packet = JSON.parse(new TextDecoder().decode(payload)) as ChatHistoryPacket;
      } catch {
        return;
      }
      if (packet.type === 'request') {
        if (!isResponder(participant.identity)) return;
        for (const chunk of chunkChatHistory(sessionMessagesRef.current)) {
          await send({ type: 'history', messages: chunk }, participant.identity);
        }
      } else if (packet.type === 'history' && Array.isArray(packet.messages)) {
        setLive((prev) => mergeChatMessages(prev, packet.messages));
      }
    };

    requestHistory();
    room.on(RoomEvent.Connected, requestHistory);
    room.on(RoomEvent.Reconnected, requestHistory);
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.Connected, requestHistory);
      room.off(RoomEvent.Reconnected, requestHistory);
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [shown]);

  // 이번 회의 채팅을 회의 행에 남깁니다. 회의 id가 생기기 전에 보낸 글도 id가 잡히면 이어서 저장합니다.
  const flushChat = useCallback(async () => {
    const job = persistChainRef.current.catch(() => {}).then(() => {
      // 실행 시점의 회의 행에 남깁니다. 저장이 밀리면 그 사이에 정해진 id를 씁니다.
      const id = sessionMeetingIdRef?.current;
      const batch = sessionMessagesRef.current.filter((m) => m.text.trim());
      if (!id || batch.length === 0) return;
      return appendMeetingChat(id, batch);
    });
    persistChainRef.current = job.then(() => {});
    await job;
  }, [sessionMeetingIdRef]);

  useEffect(() => {
    if (!meetingId || live.length === 0) return;
    const timer = window.setTimeout(() => { void flushChat(); }, 400);
    return () => window.clearTimeout(timer);
  }, [live, meetingId, flushChat]);

  useEffect(() => {
    if (!chatFlushRef) return;
    chatFlushRef.current = flushChat;
    return () => {
      chatFlushRef.current = null;
    };
  }, [chatFlushRef, flushChat]);

  // 새로고침·탭 종료로 나가기 버튼을 못 눌러도, 마지막 채팅이 회의 행에 남게 합니다.
  useEffect(() => {
    const onHide = () => { void flushChat(); };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [flushChat]);

  const publishChat = (msg: MeetingChatMessage) => {
    setLive((prev) => mergeChatMessages(prev, [msg]));
    void localParticipant.publishData(encodeMeetingChatMessage(msg), {
      reliable: true,
      topic: MEETING_CHAT_TOPIC,
    }).catch((err) => console.warn('채팅 전송 실패:', err));
  };

  const sendMessage = () => {
    const text = draft.trim();
    if (!text) return;
    publishChat({
      id: crypto.randomUUID(),
      from: localParticipant.identity,
      name: localParticipant.name?.trim() || '익명',
      text,
      ts: Date.now(),
    });
    setDraft('');
  };

  const saveGroupName = async () => {
    const next = nameDraft.trim();
    if (!_groupId || !next || next === groupName) {
      setEditingName(false);
      setNameDraft(groupName);
      return;
    }
    setSavingName(true);
    try {
      const { error } = await supabase.from('groups').update({ name: next }).eq('id', _groupId);
      if (error) throw error;
      onGroupNameChange?.(next);
      setEditingName(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : '그룹 이름 변경에 실패했습니다.');
      setNameDraft(groupName);
    } finally {
      setSavingName(false);
    }
  };

  const toggleLocalMic = async () => {
    try {
      await localParticipant.setMicrophoneEnabled(!localParticipant.isMicrophoneEnabled);
    } catch (err) {
      console.error('마이크 전환 실패:', err);
      alert('마이크를 전환하지 못했습니다.');
    }
  };

  // 내 헤드셋만 켜고 끕니다. 다른 참가자 헤드셋은 그 사람 상태를 보여주기만 합니다.
  const toggleLocalHeadset = () => {
    onSpeakerMutedChange?.(!speakerMuted);
  };

  // 오늘 채팅만 있으면 날짜 줄은 생략합니다. 예전 날짜가 섞여 있을 때만 구분합니다.
  const hasOlderChat = shown.some((item) => chatDayKey(item.ts) !== todayKey);

  return (
    <aside className={styles.chatPanel}>
      <div className={styles.sideStack}>
        <section className={styles.participantCard}>
          <div className={styles.groupNameRow}>
            {editingName ? (
              <input
                ref={nameInputRef}
                className={styles.groupNameInput}
                value={nameDraft}
                disabled={savingName}
                aria-label="그룹 이름"
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => { void saveGroupName(); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void saveGroupName();
                  }
                  if (e.key === 'Escape') {
                    setEditingName(false);
                    setNameDraft(groupName);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className={styles.groupNameButton}
                title="이름 변경"
                onClick={() => setEditingName(true)}
              >
                <span className={styles.groupNameText}>{groupName || '그룹'}</span>
                <svg className={styles.groupNameEdit} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
            )}
          </div>

          <ul className={styles.participantList}>
            {participants.map((p) => {
              const isLocal = p.isLocal;
              const name = readableName(p.name) || (isLocal ? '나' : '참여자');
              const micOn = p.isMicrophoneEnabled;
              const headsetMuted = isLocal ? speakerMuted : Boolean(remoteHeadsetOff[p.identity]);
              return (
                <li key={p.identity} className={styles.participantRow}>
                  <div className={styles.participantIdentity}>
                    {/* 말하는 중이면 아바타 테두리를 초록으로 (isSpeaking은 LiveKit이 제공) */}
                    <div className={`${styles.participantAvatar}${p.isSpeaking ? ` ${styles.isSpeaking}` : ''}`} title={name}>
                      {avatarByUserId[p.identity] ? (
                        <img src={getAvatarSrc(avatarByUserId[p.identity])} alt="" />
                      ) : (
                        participantInitial(name)
                      )}
                    </div>
                    <span className={styles.participantName}>{name}</span>
                  </div>
                  <div className={styles.participantControls}>
                    <button
                      type="button"
                      className={`${styles.participantCtrl}${headsetMuted ? ` ${styles.isOff}` : ''}`}
                      title={headsetMuted ? '헤드셋 켜기' : '헤드셋 끄기'}
                      aria-label={`${name} 헤드셋`}
                      disabled={!isLocal}
                      onClick={() => { if (isLocal) toggleLocalHeadset(); }}
                    >
                      <HeadsetIcon muted={headsetMuted} />
                    </button>
                    <button
                      type="button"
                      className={`${styles.participantCtrl}${!micOn ? ` ${styles.isOff}` : ''}`}
                      title={isLocal ? (micOn ? '마이크 끄기' : '마이크 켜기') : (micOn ? '말하는 중' : '마이크 꺼짐')}
                      aria-label={`${name} 마이크`}
                      disabled={!isLocal}
                      onClick={() => { if (isLocal) void toggleLocalMic(); }}
                    >
                      <MicIcon muted={!micOn} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className={styles.chatCard}>
          <h2 className={styles.chatSectionTitle}>채팅</h2>

          <div className={styles.chatMessages} ref={listRef}>
            {shown.length === 0 ? (
              <div className={styles.chatMessage}>아직 채팅이 없어요.</div>
            ) : (
              shown.map((m, index) => {
                const own = m.from === localParticipant.identity;
                const sender = senderLabel(m, localParticipant.identity, participants);
                const day = chatDayKey(m.ts);
                const prev = index > 0 ? shown[index - 1] : null;
                const showDay = hasOlderChat && (!prev || chatDayKey(prev.ts) !== day);
                return (
                  <Fragment key={m.id}>
                    {showDay ? <div className={styles.chatDay}>{formatChatDay(m.ts)}</div> : null}
                    <div className={`${styles.chatRow}${own ? ` ${styles.isOwn}` : ''}`}>
                      <span className={styles.chatSender}>{sender} · {formatChatTime(m.ts)}</span>
                      <div className={`${styles.chatMessage}${own ? ` ${styles.ownMessage}` : ''}`}>
                        {m.text}
                      </div>
                    </div>
                  </Fragment>
                );
              })
            )}
          </div>

          <form
            className={styles.chatInputArea}
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
          >
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="메시지 입력..."
              autoComplete="off"
            />
            <button type="submit">전송</button>
          </form>
        </section>
      </div>
    </aside>
  );
}
