import { useState, useEffect, useRef, type RefObject } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { RoomEvent } from 'livekit-client';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  useLocalParticipant,
  useRoomContext,
} from '@livekit/components-react';
import '@livekit/components-styles';
import CanvasBoard, { type CanvasBoardHandle } from '../CanvasBoard';
import MeetingChatPanel from '../components/MeetingChatPanel';
import MeetingDrawingTools, { type MeetingDrawAction } from '../components/MeetingDrawingTools';
import type { ExcalidrawTool } from '../components/ExcalidrawToolbar';
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
import {
  getMicrophoneExceptionMessage,
  getMicrophoneFailureMessage,
  isSecureMediaContext,
  localhostAppUrl,
} from '../utils/microphoneAccess';
import { loadVoiceSettings, voiceCaptureOptions } from '../utils/voiceSettings';

type RecordingSyncHandle = {
  broadcastStart: () => void;
  broadcastStop: () => void;
};

function formatMeetingElapsed(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function MicInsecureBanner() {
  if (isSecureMediaContext()) return null;
  return (
    <div className="meeting-recording-banner">
      지금 주소(<strong>{window.location.host}</strong>)는 HTTP라서 마이크가 차단됩니다.{' '}
      <a href={`https://${window.location.host}${window.location.pathname}${window.location.search}`}>
        https로 다시 열기
      </a>
      {' '}또는{' '}
      <a href={localhostAppUrl()}>localhost로 접속</a>
      하세요. 처음 HTTPS는 인증서 경고가 뜨면 고급 → 계속을 누르면 됩니다.
    </div>
  );
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
    <header className="meeting-header">
      <Link to="/main" className="logo">GROP</Link>
      <span className="meeting-title">{groupName || '회의'}</span>
      <span className="meeting-title-time">
        · {startedAt ? formatMeetingElapsed(elapsed) : '0:00'}
      </span>
    </header>
  );
}

function MeetingAudioSetup() {
  const room = useRoomContext();

  useEffect(() => {
    if (!isSecureMediaContext()) return;
    const enableMic = async () => {
      const settings = loadVoiceSettings();
      try {
        await room.localParticipant.setMicrophoneEnabled(true, voiceCaptureOptions(settings));
        if (settings.speakerDeviceId) {
          await room.switchActiveDevice('audiooutput', settings.speakerDeviceId);
        }
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
        background: 'var(--color-primary-soft)',
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

function MeetingCallControls({
  onLeave,
  onToggleRecord,
  isRecording,
  savingRecording,
}: {
  onLeave: () => void;
  onToggleRecord: () => void;
  isRecording: boolean;
  savingRecording: boolean;
}) {
  const { localParticipant } = useLocalParticipant();
  const micOn = localParticipant.isMicrophoneEnabled;

  const toggleMic = async () => {
    const next = !micOn;
    try {
      await localParticipant.setMicrophoneEnabled(next);
    } catch (err) {
      console.error('마이크 전환 실패:', err);
      alert(getMicrophoneExceptionMessage(err));
    }
  };

  return (
    <div className="call-controls">
      <button
        type="button"
        className={`call-icon-button${micOn ? ' active' : ''}`}
        data-tooltip="마이크"
        aria-label="마이크 켜기/끄기"
        onClick={() => { void toggleMic(); }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {micOn ? (
            <>
              <path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z" />
              <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
              <path d="M12 18v3" />
            </>
          ) : (
            <>
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
              <path d="M15 9.34V6a3 3 0 0 0-5.68-1.33" />
              <path d="M19 10v1a7 7 0 0 1-1.2 3.8" />
              <path d="M5 10v1a7 7 0 0 0 11 5.2" />
              <path d="M12 18v3M2 2l20 20" />
            </>
          )}
        </svg>
      </button>
      <button
        type="button"
        className={`call-icon-button${isRecording ? ' is-recording' : ''}`}
        data-tooltip="녹화"
        aria-label="녹화 시작/종료"
        disabled={savingRecording}
        onClick={onToggleRecord}
      >
        <svg viewBox="0 0 24 24" fill={isRecording ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="7" />
        </svg>
      </button>
      <button type="button" className="leave-button" onClick={onLeave}>
        나가기
      </button>
    </div>
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
}) {
  const [drawTool, setDrawTool] = useState<MeetingDrawAction>('hand');

  const handlePick = (next: MeetingDrawAction) => {
    setDrawTool(next);
    if (next === 'stamp') {
      canvasBoardRef.current?.toggleLibrary();
      return;
    }
    canvasBoardRef.current?.pickTool(next as ExcalidrawTool);
  };

  return (
    <>
      <RoomAudioRenderer volume={loadVoiceSettings().speakerVolume / 100} />
      <MeetingAudioSetup />
      <RecordingDataSync
        userId={userId}
        syncRef={recordingSyncRef}
        onRemoteStart={onRemoteStartRecording}
        onRemoteStop={onRemoteStopRecording}
      />
      <RoomRecordingBridge bridgeRef={recordingBridgeRef} />
      {(isRecording || savingRecording) ? (
        <div className="meeting-recording-banner">
          {savingRecording ? '회의록 저장 중...' : '회의 화면 녹화 중...'}
        </div>
      ) : null}
      <main className="meeting-main">
        <div className="whiteboard">
          <CanvasBoard
            ref={canvasBoardRef}
            embedded
            meetingMode
            gropShell
            onToolChange={(tool) => setDrawTool(tool)}
            groupId={groupId}
            groupName={groupName}
          />
        </div>
        <MeetingChatPanel groupId={groupId} />
      </main>
      <footer className="bottom-bar">
        <MeetingDrawingTools active={drawTool} onPick={handlePick} />
        <MeetingCallControls
          onLeave={onLeave}
          onToggleRecord={onToggleRecord}
          isRecording={isRecording}
          savingRecording={savingRecording}
        />
      </footer>
    </>
  );
}

export default function Room() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [userId, setUserId] = useState('');
  const [userName, setUserName] = useState('');
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

  // 스트림을 먼저 끄면 MediaRecorder가 마지막 청크를 못 남기고 끝납니다.
  // stop 이벤트가 난 뒤에 트랙/캡처를 정리합니다.
  const stopMediaRecorder = () => new Promise<void>((resolve) => {
    const finish = () => {
      recordingCaptureCleanupRef.current?.();
      recordingCaptureCleanupRef.current = null;
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      recordingBridgeRef.current?.cleanupAudioMixer();
      resolve();
    };

    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      finish();
      return;
    }

    recorder.addEventListener('stop', () => finish(), { once: true });
    try {
      if (recorder.state === 'recording') recorder.requestData();
    } catch {
      // requestData를 지원하지 않는 브라우저는 stop만으로 마지막 청크를 받습니다.
    }
    recorder.stop();
  });

  // 영상 파일은 서버 컴퓨터 디스크에만 둡니다.
  // meetings.video_url 에는 재생 URL만 저장합니다.
  const persistMeetingRecording = async (): Promise<{ ok: boolean; error?: string }> => {
    if (recordedChunksRef.current.length === 0) {
      return {
        ok: false,
        error: '저장할 녹음이 없습니다. 녹화 시작 후 몇 초 기다렸다가 종료해 주세요.',
      };
    }

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const titleStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 회의`;

    const { data: userData } = await supabase.auth.getUser();
    const blob = new Blob(recordedChunksRef.current, { type: recorderMimeRef.current });

    const formData = new FormData();
    // 파일보다 먼저 보내야 서버가 groupId/날짜 폴더를 알 수 있습니다.
    formData.append('groupId', groupIdRef.current ?? '');
    formData.append('dateStr', dateStr);
    formData.append('video', blob, 'recording.webm');

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

    // 파일은 서버에만 두고, DB에는 재생 URL만 저장합니다.
    const videoUrl = `${getApiBase()}/videos/${relativePath}`;

    const { error: insertError } = await supabase.from('meetings').insert({
      group_id: groupIdRef.current,
      title: titleStr,
      date: now.toISOString(),
      video_url: videoUrl,
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
          .from('profiles').select('nickname')
          .eq('id', userData.user.id).maybeSingle();

        const name = profile?.nickname || userData.user.email || '익명';
        setUserId(userData.user.id);
        setUserName(name);

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
        isRecordingRef.current = false;
        setIsRecording(false);
        if (!opts?.remote) alert('회의 영상 트랙을 만들 수 없습니다.');
        return;
      }

      let audioTracks: MediaStreamTrack[] = [];
      if (recordingBridgeRef.current) {
        const mixedAudio = await recordingBridgeRef.current.getMixedAudioStream();
        // 믹서 destination 은 마이크가 없어도 빈 트랙이 생깁니다. 실제 연결이 있을 때만 씁니다.
        if (recordingBridgeRef.current.hasAudio()) {
          audioTracks = mixedAudio.getAudioTracks();
        }
      }
      if (audioTracks.length === 0) {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
          audioTracks = micStream.getAudioTracks();
        } catch (micErr) {
          console.error('브라우저 마이크 요청 실패:', micErr);
          recordingCaptureCleanupRef.current?.();
          recordingCaptureCleanupRef.current = null;
          isRecordingRef.current = false;
          setIsRecording(false);
          if (!opts?.remote) {
            alert(getMicrophoneExceptionMessage(micErr));
          }
          return;
        }
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
        alert(getMicrophoneExceptionMessage(err));
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
      // 시작 직후 종료하면 MediaRecorder가 아직 없을 수 있어 잠깐 기다립니다.
      for (let i = 0; i < 25 && !mediaRecorderRef.current; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

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
      <div className="meeting-loading">연결 중...</div>
    );
  }

  if (saving) {
    return (
      <div className="meeting-loading">회의록 저장 중...</div>
    );
  }

  if (!id) {
    navigate('/main');
    return null;
  }

  return (
    <div className="meeting-page stage">
      <LiveKitRoom
        token={token}
        serverUrl={import.meta.env.VITE_LIVEKIT_URL}
        connect={true}
        audio={isSecureMediaContext() ? voiceCaptureOptions(loadVoiceSettings()) : false}
        video={false}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
        onMediaDeviceFailure={(failure) => {
          console.error('미디어 장치 오류:', failure);
          alert(getMicrophoneFailureMessage(failure != null ? String(failure) : null));
        }}
        onError={(err) => {
          console.error('LiveKit 오류:', err);
        }}
      >
        <div
          ref={recordingAreaRef}
          style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}
        >
          <MicInsecureBanner />
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
          />
        </div>
      </LiveKitRoom>
    </div>
  );
}

