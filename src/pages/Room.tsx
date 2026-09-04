import { useState, useEffect, useRef, type RefObject } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { RoomEvent, type Participant } from 'livekit-client';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
} from '@livekit/components-react';
import '@livekit/components-styles';
import CanvasBoard, { type CanvasBoardHandle } from '../CanvasBoard';
import { supabase } from '../services/supabaseClient';
import { getApiBase } from '../utils/apiBase';
import { createMeetingRecordingStream } from '../utils/meetingRecordingCapture';
import { pickMeetingRecorderMimeType } from '../utils/meetingVideo';
import { createRecordingBridge, type RecordingBridge } from '../utils/recordingBridge';
import {
  MEETING_RECORDING_TOPIC,
  decodeRecordingSyncMessage,
  encodeRecordingSyncMessage,
} from '../utils/meetingRecordingSync';

type RecordingSyncHandle = {
  broadcastStart: () => void;
  broadcastStop: () => void;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getParticipantDisplayName(p: Participant) {
  const name = p.name?.trim();
  if (name) return name;
  if (UUID_RE.test(p.identity)) return '참여자';
  return p.identity;
}

function formatMeetingElapsed(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function RoomTopHeader({ groupName }: { groupName: string }) {
  const room = useRoomContext();
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const markStart = () => setStartedAt((prev) => prev ?? Date.now());
    if (room.state === 'connected') markStart();
    room.on(RoomEvent.Connected, markStart);
    return () => { room.off(RoomEvent.Connected, markStart); };
  }, [room]);

  useEffect(() => {
    if (!startedAt) return;
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  return (
    <div style={{
      padding: '0 16px', background: '#1a1b1e', color: 'white', display: 'flex', alignItems: 'center', gap: 8,
      height: 48, borderBottom: '1px solid #2f3136', flexShrink: 0,
    }}>
      <span style={{ color: '#949ba4', fontSize: 20 }}>🔊</span>
      <span style={{ fontWeight: 600, fontSize: 15 }}>회의 채널</span>
      {groupName ? <span style={{ fontSize: 13, color: '#949ba4' }}>· {groupName}</span> : null}
      <span style={{ fontSize: 11, color: '#57f287', background: '#1a3a2a', padding: '2px 8px', borderRadius: 10, marginLeft: 4 }}>
        ● 진행 중
      </span>
      {startedAt ? (
        <span style={{ fontSize: 12, color: '#dbdee1', marginLeft: 4, fontVariantNumeric: 'tabular-nums' }}>
          ⏱ {formatMeetingElapsed(elapsed)}
        </span>
      ) : null}
    </div>
  );
}

function MeetingParticipantsBar() {
  const participants = useParticipants();

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, overflowX: 'auto',
      paddingBottom: 2,
    }}>
      <span style={{ fontSize: 11, color: '#949ba4', flexShrink: 0, fontWeight: 600 }}>
        참여자 {participants.length}
      </span>
      {participants.map((p) => (
        <div
          key={p.identity}
          title={p.isSpeaking ? '말하는 중' : '대기 중'}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
            padding: '3px 10px 3px 6px', background: '#313338', borderRadius: 16,
            border: p.isSpeaking ? '1px solid #57f287' : '1px solid #1e1f22',
          }}
        >
          <span style={{
            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: p.isSpeaking ? '#57f287' : '#949ba4',
          }} />
          <span style={{ fontSize: 11, color: '#dbdee1', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {getParticipantDisplayName(p)}
          </span>
        </div>
      ))}
    </div>
  );
}

function MeetingAudioSetup() {
  const room = useRoomContext();

  useEffect(() => {
    const enableMic = async () => {
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch (err) {
        console.error('마이크 활성화 실패:', err);
      }
    };
    void enableMic();
  }, [room]);

  return (
    <StartAudio
      label="🔊 상대방 소리 켜기"
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 20,
        padding: '8px 12px',
        borderRadius: 8,
        border: 'none',
        background: '#5865f2',
        color: '#fff',
        fontSize: 12,
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
      }}
    />
  );
}

function RecordingDataSync({
  userId,
  syncRef,
  onRemoteStart,
  onRemoteStop,
}: {
  userId: string;
  syncRef: RefObject<RecordingSyncHandle | null>;
  onRemoteStart: () => void;
  onRemoteStop: () => void;
}) {
  const room = useRoomContext();
  const onRemoteStartRef = useRef(onRemoteStart);
  const onRemoteStopRef = useRef(onRemoteStop);
  onRemoteStartRef.current = onRemoteStart;
  onRemoteStopRef.current = onRemoteStop;

  useEffect(() => {
    const handler = (payload: Uint8Array, _participant?: unknown, _kind?: unknown, topic?: string) => {
      if (topic && topic !== MEETING_RECORDING_TOPIC) return;
      const msg = decodeRecordingSyncMessage(payload);
      if (!msg || msg.from === userId) return;
      if (msg.type === 'recording:start') onRemoteStartRef.current();
      else if (msg.type === 'recording:stop') onRemoteStopRef.current();
    };
    room.on(RoomEvent.DataReceived, handler);
    return () => { room.off(RoomEvent.DataReceived, handler); };
  }, [room, userId]);

  useEffect(() => {
    syncRef.current = {
      broadcastStart: () => {
        void room.localParticipant.publishData(
          encodeRecordingSyncMessage({ type: 'recording:start', from: userId }),
          { reliable: true, topic: MEETING_RECORDING_TOPIC },
        );
      },
      broadcastStop: () => {
        void room.localParticipant.publishData(
          encodeRecordingSyncMessage({ type: 'recording:stop', from: userId }),
          { reliable: true, topic: MEETING_RECORDING_TOPIC },
        );
      },
    };
    return () => { syncRef.current = null; };
  }, [room, userId, syncRef]);

  return null;
}

function RoomRecordingBridge({ bridgeRef }: { bridgeRef: RefObject<RecordingBridge | null> }) {
  const room = useRoomContext();

  useEffect(() => {
    const bridge = createRecordingBridge(room);
    bridgeRef.current = bridge;
    return () => {
      bridge.cleanupAudioMixer();
      bridgeRef.current = null;
    };
  }, [room, bridgeRef]);

  return null;
}

function MeetingControls({
  onLeave,
  onToggleRecord,
  isRecording,
  savingRecording,
  avatar,
  userName,
}: {
  onLeave: () => void;
  onToggleRecord: () => void;
  isRecording: boolean;
  savingRecording: boolean;
  avatar: string;
  userName: string;
}) {
  const { localParticipant } = useLocalParticipant();
  const micOn = localParticipant.isMicrophoneEnabled;

  const toggleMic = async () => {
    const next = !micOn;
    try {
      await localParticipant.setMicrophoneEnabled(next);
    } catch (err) {
      console.error('마이크 전환 실패:', err);
      alert('마이크를 사용할 수 없습니다.\n브라우저 주소창 옆 🔒에서 마이크 권한을 허용해 주세요.');
    }
  };

  return (
    <>
      {(isRecording || savingRecording) && (
        <div style={{ textAlign: 'center', padding: '6px', background: '#3a1a1a', color: '#ed4245', fontSize: 12, flexShrink: 0 }}>
          {savingRecording ? '💾 회의록 저장 중...' : '🔴 회의 화면 녹화 중...'}
        </div>
      )}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 16px', background: '#232428', borderTop: '1px solid #1a1b1e', height: 52, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#5865f2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
            {avatar}
          </div>
          <div>
            <div style={{ color: 'white', fontSize: 12, fontWeight: 600 }}>{userName}</div>
            <div style={{ color: '#57f287', fontSize: 10 }}>● 연결됨</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button type="button" onClick={toggleMic} title={micOn ? '마이크 끄기' : '마이크 켜기'} style={{
            width: 36, height: 36, borderRadius: 8, border: 'none', cursor: 'pointer',
            background: micOn ? '#35373c' : '#ed4245', color: 'white', fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {micOn ? '🎙️' : '🔇'}
          </button>
          <button
            type="button"
            onClick={onToggleRecord}
            disabled={savingRecording}
            title={isRecording ? '녹화 종료 및 회의록 저장' : '회의 화면 녹화 시작'}
            style={{
              width: 36, height: 36, borderRadius: 8, border: 'none', cursor: savingRecording ? 'wait' : 'pointer',
              background: isRecording ? '#ed4245' : '#35373c', color: 'white', fontSize: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: savingRecording ? 0.6 : 1,
            }}
          >
            {isRecording ? '⏹️' : '🔴'}
          </button>
          <button type="button" onClick={onLeave} title="나가기" style={{
            width: 36, height: 36, borderRadius: 8, border: 'none', cursor: 'pointer',
            background: '#ed4245', color: 'white', fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            📞
          </button>
        </div>

        <div style={{ width: 80 }} />
      </div>
    </>
  );
}

function RoomContent({
  groupId,
  groupName,
  userId,
  canvasBoardRef,
  recordingBridgeRef,
  recordingSyncRef,
  onLeave,
  onToggleRecord,
  onRemoteStartRecording,
  onRemoteStopRecording,
  isRecording,
  savingRecording,
  avatar,
  userName,
}: {
  groupId: string;
  groupName: string;
  userId: string;
  canvasBoardRef: RefObject<CanvasBoardHandle | null>;
  recordingBridgeRef: RefObject<RecordingBridge | null>;
  recordingSyncRef: RefObject<RecordingSyncHandle | null>;
  onLeave: () => void;
  onToggleRecord: () => void;
  onRemoteStartRecording: () => void;
  onRemoteStopRecording: () => void;
  isRecording: boolean;
  savingRecording: boolean;
  avatar: string;
  userName: string;
}) {
  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden', position: 'relative', minWidth: 0 }}>
      <RoomAudioRenderer />
      <MeetingAudioSetup />
      <RecordingDataSync
        userId={userId}
        syncRef={recordingSyncRef}
        onRemoteStart={onRemoteStartRecording}
        onRemoteStop={onRemoteStopRecording}
      />
      <RoomRecordingBridge bridgeRef={recordingBridgeRef} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <CanvasBoard
            ref={canvasBoardRef}
            embedded
            meetingMode
            meetingHeaderExtra={<MeetingParticipantsBar />}
            groupId={groupId}
            groupName={groupName}
          />
        </div>
        <MeetingControls
          onLeave={onLeave}
          onToggleRecord={onToggleRecord}
          isRecording={isRecording}
          savingRecording={savingRecording}
          avatar={avatar}
          userName={userName}
        />
      </div>
    </div>
  );
}

export default function Room() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [userId, setUserId] = useState('');
  const [userName, setUserName] = useState('');
  const [avatar, setAvatar] = useState('🐱');
  const [groupName, setGroupName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingRecording, setSavingRecording] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  const canvasBoardRef = useRef<CanvasBoardHandle | null>(null);
  const recordingAreaRef = useRef<HTMLDivElement | null>(null);
  const recordingBridgeRef = useRef<RecordingBridge | null>(null);
  const recordingSyncRef = useRef<RecordingSyncHandle | null>(null);
  const recordingCaptureCleanupRef = useRef<(() => void) | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recorderMimeRef = useRef('video/webm');
  const groupIdRef = useRef(id);
  const isRecordingRef = useRef(false);

  const stopMediaRecorder = () => new Promise<void>((resolve) => {
    recordingCaptureCleanupRef.current?.();
    recordingCaptureCleanupRef.current = null;
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      recordingBridgeRef.current?.cleanupAudioMixer();
      resolve();
      return;
    }
    recorder.addEventListener('stop', () => resolve(), { once: true });
    recorder.stop();
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    recordingBridgeRef.current?.cleanupAudioMixer();
  });

  // 영상 파일은 Supabase가 아니라 내 서버 컴퓨터 디스크에 저장합니다.
  // Supabase 에는 그 파일을 다시 찾아올 상대 경로(video_url)만 저장합니다.
  const persistMeetingRecording = async (): Promise<{ ok: boolean; error?: string }> => {
    if (recordedChunksRef.current.length === 0) {
      return { ok: false, error: '저장할 녹음이 없습니다.' };
    }

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const titleStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 회의`;

    const { data: userData } = await supabase.auth.getUser();
    const blob = new Blob(recordedChunksRef.current, { type: recorderMimeRef.current });

    const formData = new FormData();
    formData.append('video', blob, 'recording.webm');
    formData.append('groupId', groupIdRef.current ?? '');
    formData.append('dateStr', dateStr);

    let relativePath: string;
    try {
      const uploadToken = import.meta.env.VITE_MEETING_UPLOAD_TOKEN as string | undefined;
      const uploadRes = await fetch(`${getApiBase()}/api/meetings/upload`, {
        method: 'POST',
        headers: uploadToken ? { 'x-upload-token': uploadToken } : undefined,
        body: formData,
      });
      if (!uploadRes.ok) {
        const errBody = await uploadRes.json().catch(() => ({}));
        throw new Error((errBody as { error?: string }).error || `녹화본 업로드 실패 (${uploadRes.status})`);
      }
      relativePath = ((await uploadRes.json()) as { path: string }).path;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '알 수 없는 오류';
      return {
        ok: false,
        error: `녹화본을 서버 컴퓨터로 전송하지 못했습니다: ${msg}\n\n서버 컴퓨터(백엔드)가 켜져 있고 접속 가능한 상태인지 확인해 주세요.`,
      };
    }

    const { error: insertError } = await supabase.from('meetings').insert({
      group_id: groupIdRef.current,
      title: titleStr,
      date: now.toISOString(),
      video_url: relativePath,
      created_by: userData.user?.id,
    });

    if (insertError) {
      return { ok: false, error: insertError.message };
    }

    recordedChunksRef.current = [];
    return { ok: true };
  };

  useEffect(() => {
    const init = async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) { navigate('/'); return; }

        const { data: profile } = await supabase
          .from('profiles').select('nickname, avatar')
          .eq('id', userData.user.id).maybeSingle();

        const name = profile?.nickname || userData.user.email || '익명';
        setUserId(userData.user.id);
        setUserName(name);
        setAvatar(profile?.avatar || '🐱');

        if (id) {
          const { data: group } = await supabase
            .from('groups')
            .select('name')
            .eq('id', id)
            .maybeSingle();
          if (group?.name) setGroupName(group.name);
        }

        const res = await fetch(`${getApiBase()}/api/livekit-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomName: id, userName: name, userId: userData.user.id }),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error((errBody as { error?: string }).error || `토큰 서버 오류 (${res.status})`);
        }

        const data = await res.json();
        if (!data.token) {
          throw new Error('LiveKit 토큰을 받지 못했습니다. .env의 LIVEKIT 키를 확인해 주세요.');
        }

        setToken(data.token);
        setLoading(false);
      } catch (err) {
        console.error('회의방 연결 실패:', err);
        const msg = err instanceof Error ? err.message : '알 수 없는 오류';
        alert(
          `회의방에 연결할 수 없습니다.\n\n${msg}\n\n` +
          '회의방·녹화·음성은 본인 PC에서 백엔드가 켜져 있어야 합니다.\n' +
          '(localhost:3001은 다른 사람 컴퓨터가 아니라, 지금 쓰는 PC를 가리킵니다.)\n\n' +
          '1) 프로젝트 루트에 .env 파일 설정\n' +
          '2) 터미널: npm start  (또는 npm run server + npm run dev)\n' +
          '3) http://localhost:3001/health 가 열리는지 확인',
        );
        setLoading(false);
        navigate(id ? `/group/${id}` : '/main');
      }
    };
    void init();

    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, [id, navigate]);

  const stopRecordingLocal = async (discardChunks: boolean) => {
    await stopMediaRecorder();
    await new Promise((resolve) => setTimeout(resolve, 300));
    mediaRecorderRef.current = null;
    isRecordingRef.current = false;
    setIsRecording(false);
    if (discardChunks) recordedChunksRef.current = [];
  };

  const startRecording = async (opts?: { remote?: boolean }) => {
    if (isRecording || savingRecording) return;

    const container = recordingAreaRef.current;
    const canvasEl = canvasBoardRef.current?.getCanvasElement();
    if (!container || !canvasEl || !('captureStream' in canvasEl)) {
      if (!opts?.remote) {
        alert('회의 화면 녹화를 시작할 수 없습니다. 잠시 후 다시 시도해 주세요.');
      }
      return;
    }

    try {
      isRecordingRef.current = true;
      setIsRecording(true);
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });

      const capture = await createMeetingRecordingStream(container, canvasEl);
      recordingCaptureCleanupRef.current = capture.cleanup;

      const videoTracks = capture.stream.getVideoTracks();
      if (videoTracks.length === 0) {
        capture.cleanup();
        recordingCaptureCleanupRef.current = null;
        if (!opts?.remote) alert('회의 영상 트랙을 만들 수 없습니다.');
        return;
      }

      let audioTracks: MediaStreamTrack[] = [];
      if (recordingBridgeRef.current) {
        const mixedAudio = await recordingBridgeRef.current.getMixedAudioStream();
        audioTracks = mixedAudio.getAudioTracks();
      }
      if (audioTracks.length === 0) {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioTracks = micStream.getAudioTracks();
      }

      const combined = new MediaStream([
        ...videoTracks,
        ...audioTracks,
      ]);
      recordingStreamRef.current = combined;

      const mimeType = pickMeetingRecorderMimeType(true);
      recorderMimeRef.current = mimeType;
      const mediaRecorder = new MediaRecorder(combined, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };

      mediaRecorder.start(1000);
      if (!opts?.remote) {
        recordingSyncRef.current?.broadcastStart();
      }
    } catch (err) {
      console.error('회의 화면 녹화 시작 실패:', err);
      recordingCaptureCleanupRef.current?.();
      recordingCaptureCleanupRef.current = null;
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      isRecordingRef.current = false;
      setIsRecording(false);
      if (!opts?.remote) {
        alert('마이크 권한이 필요합니다. 브라우저에서 마이크를 허용해 주세요.');
      }
    }
  };

  const stopRecordingAndSave = async (opts?: { save?: boolean }) => {
    const shouldSave = opts?.save !== false;
    if (savingRecording) return;
    const recorderActive = mediaRecorderRef.current?.state === 'recording';
    if (!isRecording && !recorderActive && recordedChunksRef.current.length === 0) return;

    if (!shouldSave) {
      try {
        await stopRecordingLocal(true);
      } catch (err) {
        console.error('원격 녹화 종료 실패:', err);
        setIsRecording(false);
      }
      return;
    }

    setSavingRecording(true);
    try {
      await stopRecordingLocal(false);

      const result = await persistMeetingRecording();
      if (result.ok) {
        canvasBoardRef.current?.clearBoard();
        alert('녹화를 종료하고 회의록에 저장했습니다.\n캔버스가 초기화되었습니다.');
      } else {
        alert(`회의록 저장 실패: ${result.error}`);
      }
    } catch (err) {
      console.error('녹음 종료/저장 실패:', err);
      alert('녹음 종료 중 오류가 발생했습니다.');
      setIsRecording(false);
    } finally {
      setSavingRecording(false);
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      recordingSyncRef.current?.broadcastStop();
      void stopRecordingAndSave({ save: true });
      return;
    }
    void startRecording();
  };

  const handleLeave = async () => {
    setSaving(true);

    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        await stopRecordingLocal(true);
      }
    } catch (err) {
      console.error('오류:', err);
    }

    setSaving(false);
    navigate(`/group/${id}`);
  };

  if (loading) {
    return (
      <div style={{ height: '100vh', background: '#1e1f22', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 18 }}>
        🎙️ 연결 중...
      </div>
    );
  }

  if (saving) {
    return (
      <div style={{ height: '100vh', background: '#1e1f22', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white', gap: 16 }}>
        <div style={{ fontSize: 40 }}>💾</div>
        <div style={{ fontSize: 18 }}>회의록 저장 중...</div>
        <div style={{ fontSize: 13, color: '#949ba4' }}>잠시만 기다려주세요</div>
      </div>
    );
  }

  if (!id) {
    navigate('/main');
    return null;
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#1e1f22', fontFamily: 'sans-serif' }}>
      <LiveKitRoom
        token={token}
        serverUrl={import.meta.env.VITE_LIVEKIT_URL}
        connect={true}
        audio={true}
        video={false}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
        onMediaDeviceFailure={(failure) => {
          console.error('미디어 장치 오류:', failure);
          alert('마이크를 사용할 수 없습니다. 다른 프로그램이 마이크를 쓰고 있지 않은지 확인해 주세요.');
        }}
        onError={(err) => {
          console.error('LiveKit 오류:', err);
        }}
      >
        <div
          ref={recordingAreaRef}
          style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}
        >
          <RoomTopHeader groupName={groupName} />
          <RoomContent
            groupId={id}
            groupName={groupName}
            userId={userId}
            canvasBoardRef={canvasBoardRef}
            recordingBridgeRef={recordingBridgeRef}
            recordingSyncRef={recordingSyncRef}
            onLeave={handleLeave}
            onToggleRecord={toggleRecording}
            onRemoteStartRecording={() => { void startRecording({ remote: true }); }}
            onRemoteStopRecording={() => { void stopRecordingAndSave({ save: false }); }}
            isRecording={isRecording}
            savingRecording={savingRecording}
            avatar={avatar}
            userName={userName}
          />
        </div>
      </LiveKitRoom>
    </div>
  );
}