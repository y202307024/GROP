import { useEffect, useRef, useState } from 'react';
import { RoomEvent } from 'livekit-client';
import { useLocalParticipant, useParticipants, useRoomContext } from '@livekit/components-react';
import { getApiBase } from '../utils/apiBase';
import {
  MEETING_CHAT_TOPIC,
  MAX_CHAT_FILE_BYTES,
  decodeMeetingChatMessage,
  displayFileName,
  encodeMeetingChatMessage,
  formatChatFileSize,
  formatChatTime,
  chatFileUrl,
  type MeetingChatFile,
  type MeetingChatMessage,
} from '../utils/meetingChat';

type Props = {
  groupId?: string;
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

/**
 * 회의방 오른쪽 채팅 패널
 * grop/meeting.html 의 .chat-panel 마크업을 그대로 씁니다.
 * LiveKit 데이터 채널로 메시지를 주고받습니다.
 */
export default function MeetingChatPanel({ groupId }: Props) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  const [messages, setMessages] = useState<MeetingChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [uploading, setUploading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handler = (payload: Uint8Array, _participant?: unknown, _kind?: unknown, topic?: string) => {
      if (topic && topic !== MEETING_CHAT_TOPIC) return;
      const msg = decodeMeetingChatMessage(payload);
      if (!msg) return;
      setMessages((prev) => [...prev, msg].slice(-300));
    };
    room.on(RoomEvent.DataReceived, handler);
    return () => { room.off(RoomEvent.DataReceived, handler); };
  }, [room]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const publishChat = (msg: MeetingChatMessage) => {
    setMessages((prev) => [...prev, msg].slice(-300));
    void localParticipant.publishData(encodeMeetingChatMessage(msg), {
      reliable: true,
      topic: MEETING_CHAT_TOPIC,
    });
  };

  const sendMessage = () => {
    const text = draft.trim();
    if (!text || uploading) return;
    publishChat({
      id: crypto.randomUUID(),
      from: localParticipant.identity,
      name: localParticipant.name?.trim() || '익명',
      text,
      ts: Date.now(),
    });
    setDraft('');
  };

  // 선택한 파일을 서버에 올린 뒤, 경로만 채팅으로 공유합니다.
  const sendFile = async (file: File) => {
    if (file.size > MAX_CHAT_FILE_BYTES) {
      alert('파일은 20MB 이하만 첨부할 수 있어요.');
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('groupId', groupId || 'unknown');
      const uploadToken = import.meta.env.VITE_MEETING_UPLOAD_TOKEN as string | undefined;
      const res = await fetch(`${getApiBase()}/api/chat-files/upload`, {
        method: 'POST',
        headers: uploadToken ? { 'x-upload-token': uploadToken } : undefined,
        body,
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error((errBody as { error?: string }).error || `업로드 실패 (${res.status})`);
      }
      const saved = (await res.json()) as MeetingChatFile;
      publishChat({
        id: crypto.randomUUID(),
        from: localParticipant.identity,
        name: localParticipant.name?.trim() || '익명',
        text: draft.trim(),
        ts: Date.now(),
        file: saved,
      });
      setDraft('');
    } catch (err) {
      alert(err instanceof Error ? err.message : '파일 첨부에 실패했습니다.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const visibleParticipants = participants.slice(0, 6);

  return (
    <aside className={`chat-panel${collapsed ? ' is-collapsed' : ''}`}>
      <button
        type="button"
        className="chat-collapse-tab"
        aria-label="채팅 접기/펼치기"
        onClick={() => setCollapsed((v) => !v)}
      >
        {collapsed ? '«' : '»'}
      </button>

      <div className="chat-title">
        <div className="chat-participants">
          {visibleParticipants.map((p) => {
            const name = readableName(p.name) || (p.isLocal ? '나' : '참여자');
            return (
              <div key={p.identity} className="participant-avatar" title={name}>
                {participantInitial(name)}
              </div>
            );
          })}
        </div>
        <span className="chat-participant-count">{participants.length}명</span>
      </div>

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
                  {m.file ? (
                    <div>
                      {m.file.mime.startsWith('image/') ? (
                        <a href={chatFileUrl(m.file.path)} target="_blank" rel="noreferrer">
                          <img
                            src={chatFileUrl(m.file.path)}
                            alt={displayFileName(m.file.name)}
                            style={{ maxWidth: '100%', maxHeight: 140, borderRadius: 6, display: 'block', marginTop: 6 }}
                          />
                        </a>
                      ) : null}
                      <a
                        href={chatFileUrl(m.file.path)}
                        target="_blank"
                        rel="noreferrer"
                        download={displayFileName(m.file.name)}
                      >
                        첨부 {displayFileName(m.file.name)} ({formatChatFileSize(m.file.size)})
                      </a>
                    </div>
                  ) : null}
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
          ref={fileInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void sendFile(file);
          }}
        />
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={uploading ? '파일 올리는 중...' : '메시지 입력...'}
          disabled={uploading}
          autoComplete="off"
        />
        <button
          type="button"
          title="파일 첨부"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          첨부
        </button>
        <button type="submit" disabled={uploading}>전송</button>
      </form>
    </aside>
  );
}
