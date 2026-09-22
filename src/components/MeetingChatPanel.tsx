import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { RoomEvent, type RemoteParticipant } from 'livekit-client';
import {
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useSpeakingParticipants,
} from '@livekit/components-react';
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
  // 마이크 입력으로 말하는 중인 참가자(로컬·원격) — 아바타 초록 테두리용
  const speakingParticipants = useSpeakingParticipants();
  const speakingIds = useMemo(
    () => new Set(speakingParticipants.map((p) => p.identity)),
    [speakingParticipants],
  );
  const [messages, setMessages] = useState<MeetingChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  // 원격 참가자만 로컬에서 안 들리게 한 identity 목록
  const [remoteDeafened, setRemoteDeafened] = useState<Record<string, boolean>>({});
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(groupName);
  const [savingName, setSavingName] = useState(false);
  /** identity(userId) → 프로필 아바타(key 또는 URL) */
  const [avatarByUserId, setAvatarByUserId] = useState<Record<string, string>>({});
  const listRef = useRef<HTMLDivElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editingName) setNameDraft(groupName);
  }, [groupName, editingName]);

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus();
  }, [editingName]);

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
      setMessages((prev) => [...prev, msg].slice(-300));
    };
    room.on(RoomEvent.DataReceived, handler);
    return () => { room.off(RoomEvent.DataReceived, handler); };
  }, [room]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // 부모(Room)가 녹화 저장 시 최신 채팅을 읽어갈 수 있도록 ref에 계속 반영합니다.
  useEffect(() => {
    if (chatLogRef) chatLogRef.current = messages;
  }, [messages, chatLogRef]);

  const publishChat = (msg: MeetingChatMessage) => {
    setMessages((prev) => [...prev, msg].slice(-300));
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

  // 로컬 헤드셋: 전체 스피커 음소거. 원격: 해당 참가자만 로컬에서 안 들리게.
  const toggleHeadset = (identity: string, isLocal: boolean) => {
    if (isLocal) {
      onSpeakerMutedChange?.(!speakerMuted);
      return;
    }
    const nextMuted = !remoteDeafened[identity];
    setRemoteDeafened((prev) => ({ ...prev, [identity]: nextMuted }));
    const remote = room.getParticipantByIdentity(identity);
    if (remote && 'setVolume' in remote && typeof remote.setVolume === 'function') {
      (remote as RemoteParticipant).setVolume(nextMuted ? 0 : 1);
    }
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
              const headsetMuted = isLocal ? speakerMuted : Boolean(remoteDeafened[p.identity]);
              // 발화 중이면 프로필 아바타에 초록 테두리 표시
              const isSpeaking = speakingIds.has(p.identity);
              return (
                <li key={p.identity} className="participant-row">
                  <div className="participant-identity">
                    <div
                      className={`participant-avatar${isSpeaking ? ' is-speaking' : ''}`}
                      title={isSpeaking ? `${name} (말하는 중)` : name}
                    >
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
                      title={headsetMuted ? '헤드셋 켜기' : '헤드셋 끄기'}
                      aria-label={`${name} 헤드셋`}
                      onClick={() => toggleHeadset(p.identity, isLocal)}
                    >
                      <HeadsetIcon muted={headsetMuted} />
                    </button>
                    <button
                      type="button"
                      className={`participant-ctrl${!micOn ? ' is-off' : ''}`}
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
