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
import {
  canDraw as userCanDraw,
  canRecord as userCanRecord,
  fetchGroupMeta,
  isGroupOwner,
  type GroupMeta,
} from '../utils/groupPermissions';
import {
  MEETING_FILE_TOPIC,
  decodeMeetingSharedFile,
  encodeMeetingSharedFile,
  uploadMeetingAttachment,
  type MeetingSharedFile,
} from '../utils/meetingChat';
import { syncMeetingAttachmentsDoc, toMeetingAttachments } from '../utils/meetingDocs';
import { createMeetingRecordingStream } from '../utils/meetingRecordingCapture';
import { pickMeetingRecorderMimeType } from '../utils/meetingVideo';
import { createRecordingBridge, type RecordingBridge } from '../utils/recordingBridge';
import {
  MEETING_RECORDING_TOPIC,
  decodeRecordingSyncMessage,
  encodeRecordingSyncMessage,
} from '../utils/meetingRecordingSync';
import {
  getMicrophoneFailureMessage,
  isSecureMediaContext,
  localhostAppUrl,
} from '../utils/microphoneAccess';
import { isNoneDevice, loadVoiceSettings, syncMicrophoneSetting, voiceCaptureOptions } from '../utils/voiceSettings';

type RecordingSyncHandle = {
  broadcastStart: () => void;
  broadcastStop: () => void;
};

function formatMeetingElapsed(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  // 시안과 같이 항상 HH:MM:SS 형식으로 맞춥니다.
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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

function RoomTopHeader({ isRecording }: { isRecording: boolean }) {
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

  // 그룹명은 우측 사이드바에서 편집 — 헤더는 로고 + 타이머만 둡니다.
  return (
    <header className="meeting-header">
      <Link to="/main" className="logo">GROP</Link>
      <span className={`meeting-title-time${isRecording ? ' is-recording' : ''}`}>
        {startedAt ? formatMeetingElapsed(elapsed) : '00:00:00'}
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
        // 없음으로 둔 사용자는 마이크를 켜지 않습니다.
        if (!isNoneDevice(settings.micDeviceId)) {
          const capture = voiceCaptureOptions(settings);
          if (capture) {
            await room.localParticipant.setMicrophoneEnabled(true, capture);
          }
        }
        if (settings.speakerDeviceId && !isNoneDevice(settings.speakerDeviceId)) {
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
  canRecord = true,
}: {
  onLeave: () => void;
  onToggleRecord: () => void;
  isRecording: boolean;
  savingRecording: boolean;
  canRecord?: boolean;
}) {
  return (
    <div className="call-controls">
      <button
        type="button"
        className={`call-icon-button${isRecording ? ' is-recording' : ''}`}
        data-tooltip={canRecord ? '녹화' : '녹화 권한 없음'}
        aria-label="녹화 시작/종료"
        disabled={savingRecording || !canRecord}
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
  onGroupNameChange,
  userId,
  canvasBoardRef,
  recordingBridgeRef,
  recordingSyncRef,
  sharedFilesRef,
  sessionMeetingIdRef,
  onLeave,
  onToggleRecord,
  onRemoteStartRecording,
  onRemoteStopRecording,
  isRecording,
  savingRecording,
  canRecord = true,
  canDrawBoard = true,
  canEditGroupName = true,
}: {
  groupId: string;
  groupName: string;
  onGroupNameChange: (name: string) => void;
  userId: string;
  canvasBoardRef: RefObject<CanvasBoardHandle | null>;
  recordingBridgeRef: RefObject<RecordingBridge | null>;
  recordingSyncRef: RefObject<RecordingSyncHandle | null>;
  /** 부모(녹화 저장)와 공유하는 첨부 목록 ref */
  sharedFilesRef: RefObject<MeetingSharedFile[]>;
  /** 이 세션 문서(회의록) id — 파일만 올려도 생기고, 이후 녹화 시 같은 행에 붙입니다 */
  sessionMeetingIdRef: RefObject<string | null>;
  onLeave: () => void;
  onToggleRecord: () => void;
  onRemoteStartRecording: () => void;
  onRemoteStopRecording: () => void;
  isRecording: boolean;
  savingRecording: boolean;
  canRecord?: boolean;
  canDrawBoard?: boolean;
  canEditGroupName?: boolean;
}) {
  const [drawTool, setDrawTool] = useState<MeetingDrawAction>('hand');
  const [activeShape, setActiveShape] = useState<ExcalidrawTool>('rectangle');
  const [strokeColor, setStrokeColor] = useState('#111111');
  const [strokeSize, setStrokeSize] = useState(6);
  const [penOpacity, setPenOpacity] = useState(1);
  const [penDash, setPenDash] = useState<'solid' | 'dashed'>('solid');
  // 연필/마커/붓 — 굵기 슬라이더와 분리해 유지합니다.
  const [penTip, setPenTip] = useState<'pencil' | 'marker' | 'brush'>('pencil');
  const [eraserActive, setEraserActive] = useState(false);
  /** 지우개 → 영역 지우기 (네모 드래그) */
  const [areaEraseActive, setAreaEraseActive] = useState(false);
  const [stickyColor, setStickyColor] = useState('#f7e7a5');
  const [textFontSize, setTextFontSize] = useState(20);
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>('left');
  const [textBold, setTextBold] = useState(false);
  const [textStrike, setTextStrike] = useState(false);
  const [textUnderline, setTextUnderline] = useState(false);
  // 배치된 텍스트를 고르면 하단 서식(밑줄·취소선 등) 메뉴를 띄웁니다.
  const [textSelected, setTextSelected] = useState(false);
  // 도형 테두리·채우기 (서브메뉴 ↔ CanvasBoard)
  const [shapeDash, setShapeDash] = useState<'solid' | 'dashed'>('solid');
  const [shapeStrokeOpacity, setShapeStrokeOpacity] = useState(1);
  const [shapeFillEnabled, setShapeFillEnabled] = useState(false);
  const [shapeFillColor, setShapeFillColor] = useState('#93c5a0');
  const [shapeFillOpacity, setShapeFillOpacity] = useState(0.35);
  // 하단 파일 도구로 올린 첨부 (채팅과 분리) — ref 는 부모와 공유해 녹화 저장에도 씁니다.
  const [sharedFiles, setSharedFiles] = useState<MeetingSharedFile[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  // 사이드바 헤드셋 버튼과 RoomAudioRenderer volume을 맞춥니다.
  const [speakerMuted, setSpeakerMuted] = useState(false);

  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();

  const SHAPE_TOOLS: ExcalidrawTool[] = [
    'rectangle', 'ellipse', 'diamond', 'triangle', 'pentagon', 'hexagon', 'star', 'arrow', 'line', 'elbowArrow', 'curveArrow',
  ];

  // 다른 참가자가 올린 파일을 사이드바 목록에 이어서 붙입니다.
  useEffect(() => {
    sharedFilesRef.current = sharedFiles;
  }, [sharedFiles, sharedFilesRef]);

  /** 올린 파일을 문서 탭(meetings + 서버)에 바로 반영합니다. 녹화 없어도 목록에 생깁니다. */
  const persistChainRef = useRef<Promise<void>>(Promise.resolve());
  const persistSharedFilesToDoc = (files: MeetingSharedFile[]) => {
    if (!groupId || files.length === 0) return;
    // 연속 업로드가 겹치면 회의 행이 두 개 생기지 않도록 한 줄로 직렬화합니다.
    persistChainRef.current = persistChainRef.current
      .catch(() => {})
      .then(async () => {
        const result = await syncMeetingAttachmentsDoc({
          meetingId: sessionMeetingIdRef.current,
          groupId,
          userId,
          files,
        });
        if (result.meetingId) sessionMeetingIdRef.current = result.meetingId;
        if (result.error) {
          console.warn('문서 첨부 저장 실패:', result.error);
          if (/Failed to fetch|NetworkError|서버/i.test(result.error)) {
            alert('첨부 파일을 문서 탭에 저장하지 못했습니다. 백엔드(서버)가 켜져 있는지 확인해 주세요.');
          }
        }
      });
  };

  useEffect(() => {
    const handler = (payload: Uint8Array, _p?: unknown, _k?: unknown, topic?: string) => {
      if (topic && topic !== MEETING_FILE_TOPIC) return;
      const file = decodeMeetingSharedFile(payload);
      if (!file) return;
      appendSharedFileRef.current(file, false);
    };
    room.on(RoomEvent.DataReceived, handler);
    return () => { room.off(RoomEvent.DataReceived, handler); };
  }, [room]);

  const appendSharedFileRef = useRef<(file: MeetingSharedFile, broadcast: boolean) => void>(() => {});

  const appendSharedFile = (file: MeetingSharedFile, broadcast: boolean) => {
    setSharedFiles((prev) => {
      if (prev.some((f) => f.id === file.id || f.path === file.path)) return prev;
      const next = [...prev, file];
      sharedFilesRef.current = next;
      // 문서는 올린 사람만 저장합니다. (다른 참가자가 또 회의 행을 만들지 않게)
      if (broadcast) persistSharedFilesToDoc(next);
      return next;
    });
    if (broadcast) {
      void localParticipant.publishData(encodeMeetingSharedFile(file), {
        reliable: true,
        topic: MEETING_FILE_TOPIC,
      });
    }
  };
  appendSharedFileRef.current = appendSharedFile;

  const handleUploadAttachment = async (file: File) => {
    setUploadingAttachment(true);
    try {
      const saved = await uploadMeetingAttachment(file, groupId);
      appendSharedFile(
        {
          id: crypto.randomUUID(),
          name: saved.name,
          path: saved.path,
          size: saved.size,
          mime: saved.mime,
          ts: Date.now(),
        },
        true,
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : '파일 첨부에 실패했습니다.');
    } finally {
      setUploadingAttachment(false);
    }
  };

  const handlePick = (next: MeetingDrawAction) => {
    // 판서 권한 없으면 화면 이동만 허용
    if (!canDrawBoard && next !== 'hand' && next !== 'pan') {
      alert('방장이 멤버 판서를 허용하지 않았습니다.');
      return;
    }
    setDrawTool(next);
    setEraserActive(false);
    setAreaEraseActive(false);
    if (next === 'stamp') {
      // 메모장: 도구만 고르고, 화면을 한 번 더 클릭해야 붙습니다.
      canvasBoardRef.current?.setStickyPaperColor(stickyColor);
      canvasBoardRef.current?.addStickyNote();
      return;
    }
    canvasBoardRef.current?.cancelStickyPlace();
    if (next === 'pan' || next === 'hand') {
      canvasBoardRef.current?.pickTool('hand');
      return;
    }
    if (next === 'shapes') {
      canvasBoardRef.current?.pickTool(activeShape);
      return;
    }
    if (next === 'file') {
      // 서브메뉴에서 파일 추가 / 목록을 보여 줍니다.
      return;
    }
    canvasBoardRef.current?.pickTool(next as ExcalidrawTool);
  };

  const handleStrokeStyle = (style: {
    color?: string;
    size?: number;
    opacity?: number;
    dash?: 'solid' | 'dashed';
  }) => {
    // 지우개 굵기 조절 시에는 지우개 모드를 유지합니다.
    if (style.color) setStrokeColor(style.color);
    if (typeof style.size === 'number') setStrokeSize(style.size);
    if (typeof style.opacity === 'number') setPenOpacity(style.opacity);
    if (style.dash) setPenDash(style.dash);
    canvasBoardRef.current?.setStrokeStyle(style);
  };

  /** 도형 테두리/채우기 옵션을 로컬 상태와 보드에 같이 반영합니다. */
  const handleShapeStyle = (style: Partial<{
    dash: 'solid' | 'dashed';
    strokeOpacity: number;
    fillEnabled: boolean;
    fillColor: string;
    fillOpacity: number;
  }>) => {
    if (style.dash) setShapeDash(style.dash);
    if (typeof style.strokeOpacity === 'number') setShapeStrokeOpacity(style.strokeOpacity);
    if (typeof style.fillEnabled === 'boolean') setShapeFillEnabled(style.fillEnabled);
    if (typeof style.fillColor === 'string') setShapeFillColor(style.fillColor);
    if (typeof style.fillOpacity === 'number') setShapeFillOpacity(style.fillOpacity);
    canvasBoardRef.current?.setShapeStyle(style);
  };

  const handleStickyColor = (color: string) => {
    setStickyColor(color);
    canvasBoardRef.current?.setStickyPaperColor(color);
  };

  const voice = loadVoiceSettings();
  const speakerOff = speakerMuted || isNoneDevice(voice.speakerDeviceId);

  return (
    <>
      <RoomAudioRenderer volume={speakerOff ? 0 : voice.speakerVolume / 100} />
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
            canDraw={canDrawBoard}
            onToolChange={(tool) => {
              if (!canDrawBoard) return;
              if (SHAPE_TOOLS.includes(tool)) {
                setDrawTool('shapes');
                setActiveShape(tool);
                return;
              }
              if (tool === 'eraser') {
                setDrawTool('pen');
                setEraserActive(true);
                return;
              }
              setEraserActive(false);
              setAreaEraseActive(false);
              setDrawTool(tool);
            }}
            groupId={groupId}
            groupName={groupName}
            onTextAlignChange={setTextAlign}
            onTextDecorChange={(style) => {
              setTextBold(style.bold);
              setTextStrike(style.strike);
              setTextUnderline(style.underline);
            }}
            onTextSelectedChange={setTextSelected}
            onTextFontSizeChange={setTextFontSize}
          />
        </div>
        <MeetingChatPanel
          groupId={groupId}
          groupName={groupName}
          onGroupNameChange={onGroupNameChange}
          canEditGroupName={canEditGroupName}
          speakerMuted={speakerMuted}
          onSpeakerMutedChange={setSpeakerMuted}
        />
      </main>
      <footer className="bottom-bar">
        {!canDrawBoard ? (
          <div style={{ padding: '8px 12px', fontSize: 13, color: '#6b7280' }}>
            판서 권한이 없습니다. 화면 이동만 가능합니다.
          </div>
        ) : null}
        <MeetingDrawingTools
          active={drawTool}
          onPick={handlePick}
          activeShape={activeShape}
          onPickShape={(tool) => {
            setActiveShape(tool);
            setDrawTool('shapes');
            canvasBoardRef.current?.pickTool(tool);
          }}
          strokeColor={strokeColor}
          strokeSize={strokeSize}
          onStrokeStyle={handleStrokeStyle}
          isEraser={eraserActive}
          isAreaErase={areaEraseActive}
          penTip={penTip}
          onPenTipChange={setPenTip}
          penStyle={{ opacity: penOpacity, dash: penDash }}
          onStartEyedropper={() => {
            canvasBoardRef.current?.startEyedropper((hex) => {
              setStrokeColor(hex);
              canvasBoardRef.current?.setStrokeStyle({ color: hex });
            });
          }}
          shapeStyle={{
            dash: shapeDash,
            strokeOpacity: shapeStrokeOpacity,
            fillEnabled: shapeFillEnabled,
            fillColor: shapeFillColor,
            fillOpacity: shapeFillOpacity,
          }}
          onShapeStyle={handleShapeStyle}
          onPickEraser={() => {
            setDrawTool('pen');
            setEraserActive(true);
            setAreaEraseActive(false);
            canvasBoardRef.current?.pickTool('eraser');
            canvasBoardRef.current?.setAreaEraseMode(false);
          }}
          onAreaErase={() => {
            setDrawTool('pen');
            setEraserActive(true);
            setAreaEraseActive(true);
            canvasBoardRef.current?.pickTool('eraser');
            canvasBoardRef.current?.setAreaEraseMode(true);
          }}
          onClearAll={() => {
            setAreaEraseActive(false);
            canvasBoardRef.current?.setAreaEraseMode(false);
            canvasBoardRef.current?.clearBoard();
          }}
          stickyColor={stickyColor}
          onStickyColor={handleStickyColor}
          attachments={sharedFiles}
          onUploadFile={(file) => { void handleUploadAttachment(file); }}
          uploadingAttachment={uploadingAttachment}
          textSelected={textSelected}
          textFontSize={textFontSize}
          onTextFontSize={(size) => {
            setTextFontSize(size);
            canvasBoardRef.current?.setTextFontSize(size);
          }}
          textAlign={textAlign}
          onTextAlign={(align) => {
            setTextAlign(align);
            canvasBoardRef.current?.setTextAlign(align);
          }}
          textBold={textBold}
          textStrike={textStrike}
          textUnderline={textUnderline}
          onTextDecor={(style) => {
            if (typeof style.bold === 'boolean') setTextBold(style.bold);
            if (typeof style.strike === 'boolean') setTextStrike(style.strike);
            if (typeof style.underline === 'boolean') setTextUnderline(style.underline);
            canvasBoardRef.current?.setTextDecor(style);
          }}
        />
        <MeetingCallControls
          onLeave={onLeave}
          onToggleRecord={onToggleRecord}
          isRecording={isRecording}
          savingRecording={savingRecording}
          canRecord={canRecord}
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
  const [, setUserName] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupMeta, setGroupMeta] = useState<GroupMeta | null>(null);
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
  /** 녹화 시작 준비 중(캡처 생성) — 중복 클릭 방지 */
  const startingRecordingRef = useRef(false);
  /** 회의 중 첨부 — RoomContent 와 공유 (파일만 올려도 문서 탭에 반영) */
  const sharedFilesRef = useRef<MeetingSharedFile[]>([]);
  const sessionMeetingIdRef = useRef<string | null>(null);

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

    // stop 직후 dataavailable 가 한 번 더 올 수 있어 잠깐 기다립니다.
    recorder.addEventListener(
      'stop',
      () => {
        window.setTimeout(finish, 200);
      },
      { once: true },
    );
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
    // stop 직후 마지막 청크가 늦게 들어오는 경우를 한 번 더 기다립니다.
    if (recordedChunksRef.current.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (recordedChunksRef.current.length === 0) {
      // 영상 청크는 없지만 첨부가 있으면 문서만이라도 남깁니다.
      const attachments = toMeetingAttachments(sharedFilesRef.current);
      if (attachments.length > 0 || sessionMeetingIdRef.current) {
        if (sessionMeetingIdRef.current) {
          return { ok: true };
        }
        const { data: userData } = await supabase.auth.getUser();
        const result = await syncMeetingAttachmentsDoc({
          meetingId: null,
          groupId: groupIdRef.current ?? '',
          userId: userData.user?.id,
          files: sharedFilesRef.current,
        });
        if (result.meetingId) {
          sessionMeetingIdRef.current = result.meetingId;
          return { ok: true };
        }
      }
      return {
        ok: false,
        error:
          '저장할 화면 녹화가 없습니다. 녹화 시작 후 배너가 뜬 것을 확인한 뒤, 몇 초 기다렸다가 종료해 주세요.',
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

    // 파일은 서버에만 두고, DB에는 재생 URL + 회의 중 첨부를 저장합니다.
    // 이미 파일만으로 만든 문서가 있으면 그 행에 녹화를 이어 붙입니다.
    const videoUrl = `${getApiBase()}/videos/${relativePath}`;
    const attachments = toMeetingAttachments(sharedFilesRef.current);
    const existingId = sessionMeetingIdRef.current;

    if (existingId) {
      const { error: updateError } = await supabase
        .from('meetings')
        .update({
          video_url: videoUrl,
          title: titleStr,
          attachments,
        })
        .eq('id', existingId);

      if (updateError && /attachments/i.test(updateError.message)) {
        const { error: fallbackError } = await supabase
          .from('meetings')
          .update({ video_url: videoUrl, title: titleStr })
          .eq('id', existingId);
        if (fallbackError) return { ok: false, error: fallbackError.message };
      } else if (updateError) {
        return { ok: false, error: updateError.message };
      }

      recordedChunksRef.current = [];
      return { ok: true };
    }

    const { error: insertError } = await supabase.from('meetings').insert({
      group_id: groupIdRef.current,
      title: titleStr,
      date: now.toISOString(),
      video_url: videoUrl,
      created_by: userData.user?.id,
      attachments,
    });

    if (insertError) {
      // attachments 컬럼이 아직 없으면(마이그레이션 전) 첨부 없이라도 회의록은 저장합니다.
      if (/attachments/i.test(insertError.message)) {
        const { error: fallbackError } = await supabase.from('meetings').insert({
          group_id: groupIdRef.current,
          title: titleStr,
          date: now.toISOString(),
          video_url: videoUrl,
          created_by: userData.user?.id,
        });
        if (fallbackError) return { ok: false, error: fallbackError.message };
      } else {
        return { ok: false, error: insertError.message };
      }
    }

    recordedChunksRef.current = [];
    return { ok: true };
  };

  useEffect(() => {
    const init = async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) { navigate('/'); return; }

        // 그룹 프로필(닉네임)을 우선하고, 없으면 기본 프로필을 씁니다.
        let name = userData.user.email || '익명';
        if (id) {
          const { data: groupProfile } = await supabase
            .from('group_profiles')
            .select('nickname')
            .eq('group_id', id)
            .eq('user_id', userData.user.id)
            .maybeSingle();
          if (groupProfile?.nickname?.trim()) {
            name = groupProfile.nickname.trim();
          } else {
            const { data: profile } = await supabase
              .from('profiles')
              .select('nickname')
              .eq('id', userData.user.id)
              .maybeSingle();
            if (profile?.nickname?.trim()) name = profile.nickname.trim();
          }
        } else {
          const { data: profile } = await supabase
            .from('profiles')
            .select('nickname')
            .eq('id', userData.user.id)
            .maybeSingle();
          if (profile?.nickname?.trim()) name = profile.nickname.trim();
        }

        setUserId(userData.user.id);
        setUserName(name);

        if (id) {
          const meta = await fetchGroupMeta(id);
          if (meta) {
            setGroupMeta(meta);
            setGroupName(meta.name);
          } else {
            const { data: group } = await supabase
              .from('groups')
              .select('name')
              .eq('id', id)
              .maybeSingle();
            if (group?.name) setGroupName(group.name);
          }
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

        // 연결 전에 마이크 유무를 맞춰, 없는 기기에서는 권한 오류가 안 나게 합니다.
        await syncMicrophoneSetting();
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
    // mediaRecorderRef 가 남아 있어도 조용히 return 하지 않습니다. (예전엔 버튼이 안 눌린 것처럼 보임)
    if (isRecordingRef.current || startingRecordingRef.current || savingRecording) return;
    startingRecordingRef.current = true;

    const container = recordingAreaRef.current;
    const canvasEl = canvasBoardRef.current?.getCanvasElement();
    if (!container || !canvasEl || !('captureStream' in canvasEl)) {
      startingRecordingRef.current = false;
      if (!opts?.remote) {
        alert('회의 화면 녹화를 시작할 수 없습니다. 캔버스가 준비된 뒤 다시 시도해 주세요.');
      }
      return;
    }

    try {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });

      const capture = await createMeetingRecordingStream(container, canvasEl);
      recordingCaptureCleanupRef.current = capture.cleanup;

      const videoTracks = capture.stream.getVideoTracks().filter((t) => t.readyState !== 'ended');
      if (videoTracks.length === 0) {
        capture.cleanup();
        recordingCaptureCleanupRef.current = null;
        if (!opts?.remote) alert('회의 영상 트랙을 만들 수 없습니다.');
        return;
      }

      // 마이크 권한/LiveKit 대기는 녹화 시작을 막아서, 화면만으로 바로 시작합니다.
      const combined = new MediaStream(videoTracks);
      recordingStreamRef.current = combined;

      const mimeType = pickMeetingRecorderMimeType(true, false);
      recorderMimeRef.current = mimeType || 'video/webm';

      let mediaRecorder: MediaRecorder;
      try {
        mediaRecorder = new MediaRecorder(combined, mimeType ? { mimeType } : undefined);
      } catch {
        mediaRecorder = new MediaRecorder(combined);
        recorderMimeRef.current = mediaRecorder.mimeType || 'video/webm';
      }

      recordedChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      mediaRecorder.onerror = (ev) => {
        console.error('MediaRecorder 오류:', ev);
      };

      mediaRecorder.start(250);
      mediaRecorderRef.current = mediaRecorder;
      isRecordingRef.current = true;
      setIsRecording(true);

      if (!opts?.remote) {
        recordingSyncRef.current?.broadcastStart();
      }
    } catch (err) {
      console.error('회의 화면 녹화 시작 실패:', err);
      recordingCaptureCleanupRef.current?.();
      recordingCaptureCleanupRef.current = null;
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      mediaRecorderRef.current = null;
      isRecordingRef.current = false;
      setIsRecording(false);
      if (!opts?.remote) {
        alert(err instanceof Error ? err.message : '회의 화면 녹화를 시작하지 못했습니다.');
      }
    } finally {
      startingRecordingRef.current = false;
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
    if (!userCanRecord(groupMeta, userId)) {
      alert('방장이 멤버 녹화를 허용하지 않았습니다.');
      return;
    }
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
      // 나가기 직전에 첨부 목록을 한 번 더 저장해 문서 탭에 남깁니다.
      if (sharedFilesRef.current.length > 0 && id) {
        const result = await syncMeetingAttachmentsDoc({
          meetingId: sessionMeetingIdRef.current,
          groupId: id,
          userId,
          files: sharedFilesRef.current,
        });
        if (result.meetingId) sessionMeetingIdRef.current = result.meetingId;
        if (result.error) {
          console.warn('나가기 전 문서 저장 실패:', result.error);
          alert(`첨부 파일을 문서 탭에 완전히 저장하지 못했습니다.\n${result.error}`);
        }
      }
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

  const allowRecord = userCanRecord(groupMeta, userId);
  const allowDraw = userCanDraw(groupMeta, userId);
  const allowEditName = isGroupOwner(groupMeta, userId);

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
          if (isNoneDevice(loadVoiceSettings().micDeviceId)) return;
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
          <RoomTopHeader isRecording={isRecording} />
          <RoomContent
            groupId={id}
            groupName={groupName}
            onGroupNameChange={setGroupName}
            userId={userId}
            canvasBoardRef={canvasBoardRef}
            recordingBridgeRef={recordingBridgeRef}
            recordingSyncRef={recordingSyncRef}
            sharedFilesRef={sharedFilesRef}
            sessionMeetingIdRef={sessionMeetingIdRef}
            onLeave={handleLeave}
            onToggleRecord={toggleRecording}
            onRemoteStartRecording={() => { void startRecording({ remote: true }); }}
            onRemoteStopRecording={() => { void stopRecordingAndSave({ save: false }); }}
            isRecording={isRecording}
            savingRecording={savingRecording}
            canRecord={allowRecord}
            canDrawBoard={allowDraw}
            canEditGroupName={allowEditName}
          />
        </div>
      </LiveKitRoom>
    </div>
  );
}

