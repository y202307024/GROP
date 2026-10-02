import { useEffect, useRef, useState, type RefObject } from 'react';
import { RoomEvent, Track, type RemoteParticipant } from 'livekit-client';
import { useLocalParticipant, useParticipants, useRoomContext } from '@livekit/components-react';
import { supabase } from '../services/supabaseClient';
import {
  MEETING_CHAT_TOPIC,
  decodeMeetingChatMessage,
  encodeMeetingChatMessage,
  formatChatTime,
  type MeetingChatMessage,
} from '../utils/meetingChat';
import { getAvatarSrc } from '../utils/avatarOptions';

type Props = {
  groupId?: string;
  /** 사이드바 상단에 표시·편집하는 그룹 이름 */
  groupName?: string;
  /** 이름 저장 후 부모(헤더 등) 상태를 맞출 때 사용 */
  onGroupNameChange?: (name: string) => void;
  /** false면 그룹 이름 인라인 편집 비활성 (방장만 true) */
  canEditGroupName?: boolean;
  /** 로컬 헤드셋(스피커) 음소거 — RoomAudioRenderer volume과 연동 */
  speakerMuted?: boolean;
  onSpeakerMutedChange?: (muted: boolean) => void;
  /**
   * 최신 채팅 목록을 부모(Room)와 공유하는 ref.
   * 녹화 저장 시 meetings.chat_log 로 함께 저장해, 마이크 없는 회의도
   * 채팅 기록으로 AI 요약을 만들 수 있게 합니다.
   */
  chatLogRef?: RefObject<MeetingChatMessage[]>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 헤드셋(스피커) 꺼짐 여부를 다른 참가자에게 알리는 데이터 채널 topic */
const MEETING_HEADSET_TOPIC = 'meeting-headset';
/** 늦게 들어온 참가자가 이전 채팅을 요청·수신하는 데이터 채널 topic */
const MEETING_CHAT_HISTORY_TOPIC = 'meeting-chat-history';
const MAX_CHAT_MESSAGES = 300;
/** LiveKit reliable 메시지 한 개 크기 제한(약 15KB)보다 작게 나눠 보냅니다. */
const HISTORY_CHUNK_BYTES = 12_000;

type ChatHistoryPacket =
  | { type: 'request' }
  | { type: 'history'; messages: MeetingChatMessage[] };

/** 받은 기록을 기존 목록에 합칩니다. 같은 id는 한 번만 넣고 시간순으로 정렬합니다. */
function mergeChatMessages(prev: MeetingChatMessage[], incoming: unknown[]) {
  const seen = new Set(prev.map((m) => m.id));
  const added = incoming.filter((m): m is MeetingChatMessage => {
    if (!m || typeof m !== 'object') return false;
    const msg = m as Partial<MeetingChatMessage>;
    return typeof msg.id === 'string'
      && typeof msg.text === 'string'
      && msg.text.trim() !== ''
      && typeof msg.ts === 'number'
      && !seen.has(msg.id);
  });
  if (added.length === 0) return prev;
  return [...prev, ...added].sort((a, b) => a.ts - b.ts).slice(-MAX_CHAT_MESSAGES);
}

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
 * 파일 첨부는 하단 툴바 파일 도구로 통일했습니다.
 */
export default function MeetingChatPanel({
  groupId: _groupId,
  groupName = '',
  onGroupNameChange,
  canEditGroupName = true,
  speakerMuted = false,
  onSpeakerMutedChange,
  chatLogRef,
}: Props) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  const [messages, setMessages] = useState<MeetingChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  /** identity → 그 참가자가 헤드셋을 껐는지 (데이터 채널로 받은 값) */
  const [remoteHeadsetOff, setRemoteHeadsetOff] = useState<Record<string, boolean>>({});
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(groupName);
  const [savingName, setSavingName] = useState(false);
  /** identity(userId) → 프로필 아바타(key 또는 URL) */
  const [avatarByUserId, setAvatarByUserId] = useState<Record<string, string>>({});
  /** 지금 말하고 있는 참가자 — 캐릭터 아바타 초록 테두리 */
  const [speakingIds, setSpeakingIds] = useState<Set<string>>(() => new Set());
  const listRef = useRef<HTMLDivElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editingName) setNameDraft(groupName);
  }, [groupName, editingName]);

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus();
  }, [editingName]);

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

  // 내 목소리는 Web Audio로 바로 재고, 상대는 LiveKit 레벨을 짧게 읽습니다.
  useEffect(() => {
    const SPEAK_ON = 0.02;
    const SPEAK_OFF = 0.01;
    let prevKey = '';
    const wasSpeaking = new Set<string>();
    let localRms = 0;
    let cleanupAnalyser: (() => void) | undefined;

    const hookLocalMic = () => {
      cleanupAnalyser?.();
      cleanupAnalyser = undefined;
      localRms = 0;
      if (!room.localParticipant.isMicrophoneEnabled) return;
      const media = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack;
      if (!media || media.readyState === 'ended') return;

      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(new MediaStream([media]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.08;
      source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const read = () => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i += 1) {
          const v = (samples[i] - 128) / 128;
          sum += v * v;
        }
        localRms = Math.sqrt(sum / samples.length);
      };
      const readTimer = window.setInterval(read, 32);
      if (ctx.state === 'suspended') void ctx.resume();
      cleanupAnalyser = () => {
        window.clearInterval(readTimer);
        source.disconnect();
        void ctx.close();
      };
    };

    hookLocalMic();
    room.on(RoomEvent.LocalTrackPublished, hookLocalMic);
    room.on(RoomEvent.LocalTrackUnpublished, hookLocalMic);
    room.on(RoomEvent.TrackMuted, hookLocalMic);
    room.on(RoomEvent.TrackUnmuted, hookLocalMic);

    const collect = () => {
      const next = new Set<string>();
      const list = [room.localParticipant, ...room.remoteParticipants.values()];
      for (const p of list) {
        if (!p?.identity || p.isMicrophoneEnabled === false) continue;
        const livekitLevel = Number(p.audioLevel) || 0;
        const level = p.isLocal ? Math.max(livekitLevel, localRms) : livekitLevel;
        const keep = wasSpeaking.has(p.identity) && level > SPEAK_OFF;
        if (level >= SPEAK_ON || keep) next.add(p.identity);
      }
      const key = [...next].sort().join(',');
      if (key === prevKey) return;
      prevKey = key;
      wasSpeaking.clear();
      next.forEach((id) => wasSpeaking.add(id));
      setSpeakingIds(new Set(next));
    };

    collect();
    const timer = window.setInterval(collect, 32);
    return () => {
      window.clearInterval(timer);
      cleanupAnalyser?.();
      room.off(RoomEvent.LocalTrackPublished, hookLocalMic);
      room.off(RoomEvent.LocalTrackUnpublished, hookLocalMic);
      room.off(RoomEvent.TrackMuted, hookLocalMic);
      room.off(RoomEvent.TrackUnmuted, hookLocalMic);
    };
  }, [room]);

  // 참가자 프로필 사진 — 그룹 프로필 우선, 없으면 기본 프로필
  const participantIdsKey = participants
    .map((p) => p.identity)
    .filter((id) => UUID_RE.test(id))
    .sort()
    .join(',');

  useEffect(() => {
    const ids = participantIdsKey ? participantIdsKey.split(',') : [];
    if (ids.length === 0) {
      setAvatarByUserId({});
      return;
    }

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

  useEffect(() => {
    const handler = (payload: Uint8Array, _participant?: unknown, _kind?: unknown, topic?: string) => {
      if (topic && topic !== MEETING_CHAT_TOPIC) return;
      const msg = decodeMeetingChatMessage(payload);
      // 파일만 있는 옛 메시지는 채팅에 표시하지 않습니다.
      if (!msg || (!msg.text.trim() && msg.file)) return;
      setMessages((prev) => mergeChatMessages(prev, [msg]));
    };
    room.on(RoomEvent.DataReceived, handler);
    return () => { room.off(RoomEvent.DataReceived, handler); };
  }, [room]);

  // 채팅은 서버에 저장되지 않아서, 늦게 들어온 사람은 이전 메시지를 받지 못합니다.
  // 그래서 입장(재연결) 때 기록을 요청하고, 방에 가장 오래 있던 참가자 한 명이 그 사람에게만 보내 줍니다.
  const messagesRef = useRef<MeetingChatMessage[]>([]);
  messagesRef.current = messages;

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
        for (const chunk of chunkChatHistory(messagesRef.current)) {
          await send({ type: 'history', messages: chunk }, participant.identity);
        }
      } else if (packet.type === 'history' && Array.isArray(packet.messages)) {
        setMessages((prev) => mergeChatMessages(prev, packet.messages));
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
  }, [messages]);

  // 부모(Room)가 녹화 저장 시 최신 채팅을 읽어갈 수 있도록 ref에 계속 반영합니다.
  useEffect(() => {
    if (chatLogRef) chatLogRef.current = messages;
  }, [messages, chatLogRef]);

  const publishChat = (msg: MeetingChatMessage) => {
    setMessages((prev) => mergeChatMessages(prev, [msg]));
    void localParticipant.publishData(encodeMeetingChatMessage(msg), {
      reliable: true,
      topic: MEETING_CHAT_TOPIC,
    });
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

  return (
    <aside className="chat-panel">
      <div className="side-stack">
        <section className="participant-card">
          <div className="group-name-row">
            {editingName ? (
              <input
                ref={nameInputRef}
                className="group-name-input"
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
            ) : canEditGroupName ? (
              <button
                type="button"
                className="group-name-button"
                title="이름 변경"
                onClick={() => setEditingName(true)}
              >
                <span className="group-name-text">{groupName || '그룹'}</span>
                <svg className="group-name-edit" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
            ) : (
              <span className="group-name-text">{groupName || '그룹'}</span>
            )}
          </div>

          <ul className="participant-list">
            {participants.map((p) => {
              const isLocal = p.isLocal;
              const name = readableName(p.name) || (isLocal ? '나' : '참여자');
              const micOn = p.isMicrophoneEnabled;
              const speaking = micOn && speakingIds.has(p.identity);
              // 원격 참가자는 그 사람이 데이터 채널로 보낸 값으로 헤드셋 상태를 표시합니다.
              const headsetMuted = isLocal ? speakerMuted : Boolean(remoteHeadsetOff[p.identity]);
              return (
                <li key={p.identity} className="participant-row">
                  <div className="participant-identity">
                    <div className={`participant-avatar${speaking ? ' is-speaking' : ''}`} title={name}>
                      {avatarByUserId[p.identity] ? (
                        <img src={getAvatarSrc(avatarByUserId[p.identity])} alt="" />
                      ) : (
                        participantInitial(name)
                      )}
                    </div>
                    <span className="participant-name">{name}</span>
                  </div>
                  <div className="participant-controls">
                    <button
                      type="button"
                      className={`participant-ctrl${headsetMuted ? ' is-off' : ''}`}
                      title={isLocal ? (headsetMuted ? '헤드셋 켜기' : '헤드셋 끄기') : (headsetMuted ? '헤드셋 꺼짐' : '헤드셋 켜짐')}
                      aria-label={`${name} 헤드셋`}
                      disabled={!isLocal}
                      onClick={() => { if (isLocal) toggleLocalHeadset(); }}
                    >
                      <HeadsetIcon muted={headsetMuted} />
                    </button>
                    <button
                      type="button"
                      className={`participant-ctrl${!micOn ? ' is-off' : ''}`}
                      title={isLocal ? (micOn ? '마이크 끄기' : '마이크 켜기') : (speaking ? '말하는 중' : (micOn ? '마이크 켜짐' : '마이크 꺼짐'))}
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

        <section className="chat-card">
          <h2 className="chat-section-title">채팅</h2>

          <div className="chat-messages" ref={listRef}>
            {messages.length === 0 ? (
              <div className="chat-message">아직 채팅이 없어요.</div>
            ) : (
              messages.map((m) => {
                const own = m.from === localParticipant.identity;
                const sender = senderLabel(m, localParticipant.identity, participants);
                return (
                  <div key={m.id} className={`chat-row${own ? ' is-own' : ''}`}>
                    <span className="chat-sender">{sender} · {formatChatTime(m.ts)}</span>
                    <div className={`chat-message${own ? ' own-message' : ''}`}>
                      {m.text}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <form
            className="chat-input-area"
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
