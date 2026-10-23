import { useState, useEffect, useRef, type RefObject } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { RoomEvent } from 'livekit-client';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
} from '@livekit/components-react';
import '@livekit/components-styles';
import shell from '../styles/meetingShell.module.css';
import styles from './Room.module.css';
import CanvasBoard, { type CanvasBoardHandle } from '../CanvasBoard';
import MeetingChatPanel from '../components/MeetingChatPanel';
import MeetingDrawingTools, { type MeetingDrawAction } from '../components/MeetingDrawingTools';
import type { ExcalidrawTool } from '../components/ExcalidrawToolbar';
import { supabase } from '../services/supabaseClient';
import { getApiBase } from '../utils/apiBase';
import {
  MEETING_FILE_TOPIC,
  decodeMeetingSharedFile,
  encodeMeetingSharedFile,
  uploadMeetingAttachment,
  type MeetingSharedFile,
} from '../utils/meetingChat';
import { syncMeetingAttachmentsDoc, toMeetingAttachments } from '../utils/meetingDocs';
import { notifyGroupMembers, notifyDocumentUpload } from '../utils/notifications';
import { rememberLastMeeting } from '../utils/lastMeeting';
import { createMeetingRecordingStream } from '../utils/meetingRecordingCapture';
import { pickMeetingRecorderMimeType } from '../utils/meetingVideo';
import {
  appendRecordingChunk,
  clearActiveRecording,
  countRecordingChunks,
  createLocalRecording,
  deleteLocalRecording,
  downloadBlobFile,
  flushRecordingWrites,
  getLocalRecording,
  newRecordingId,
  noteActiveRecording,
  patchLocalRecording,
  syncChunksFromMemory,
} from '../utils/meetingRecordingStore';
import { recordingTitleFromDate, uploadBlobAndInsert, uploadStoredRecording } from '../utils/meetingRecordingUpload';
import { createRecordingBridge, type RecordingBridge } from '../utils/recordingBridge';
import {
  MEETING_RECORDING_TOPIC,
  decodeRecordingSyncMessage,
  encodeRecordingSyncMessage,
} from '../utils/meetingRecordingSync';
import {
  ensureLiveMeeting,
  forgetSessionMeetingId,
  isUserId,
  mergeMeetingAttendees,
  readSessionMeetingId,
  rememberSessionMeetingId,
  withAttendeePresence,
} from '../utils/liveMeeting';
import {
  getMicrophoneFailureMessage,
  isSecureMediaContext,
  localhostAppUrl,
} from '../utils/microphoneAccess';
import { isNoneDevice, loadVoiceSettings, subscribeVoiceSettings, syncMicrophoneSetting, voiceCaptureOptions } from '../utils/voiceSettings';

type RecordingSyncHandle = {
  broadcastStart: () => void;
  /** 다른 참가자 녹화를 끊습니다. 방을 나가기 전에 await 해야 전달됩니다. */
  broadcastStop: () => Promise<void> | void;
};

/** PostgREST/Postgres가 "없는 컬럼"이라고 할 때만 그 컬럼 이름을 돌려줍니다. */
function missingMeetingsColumn(message: string): string | null {
  const postgrest = message.match(/Could not find the '([^']+)' column/);
  if (postgrest?.[1]) return postgrest[1];
  const pg = message.match(/column "([^"]+)" of relation "meetings" does not exist/);
  if (pg?.[1]) return pg[1];
  return null;
}

/** 새로고침 후에도 이 방이 녹화 중이었는지 기억합니다. 나가기 버튼을 누르면 지웁니다. */
function recordingFlagKey(groupId: string) {
  return `grop-recording:${groupId}`;
}

function rememberRecording(groupId: string | undefined, active: boolean) {
  if (!groupId) return;
  try {
    if (active) sessionStorage.setItem(recordingFlagKey(groupId), '1');
    else sessionStorage.removeItem(recordingFlagKey(groupId));
  } catch {
    // 사생활 모드처럼 저장이 막혀도 녹화 자체는 계속합니다.
  }
}

function wasRecording(groupId: string | undefined) {
  if (!groupId) return false;
  try {
    return sessionStorage.getItem(recordingFlagKey(groupId)) === '1';
  } catch {
    return false;
  }
}

/** 이 탭이 새로고침돼도 회의를 연 시각을 유지합니다. 나가면 지웁니다. */
function roomOpenedKey(groupId: string) {
  return `grop-room-opened:${groupId}`;
}

function rememberRoomOpened(groupId: string | undefined, ms: number) {
  if (!groupId || !Number.isFinite(ms)) return;
  try {
    sessionStorage.setItem(roomOpenedKey(groupId), String(ms));
  } catch {
    // 저장이 막혀도 이번 접속의 타이머는 그대로 갑니다.
  }
}

function readRoomOpened(groupId: string | undefined): number | null {
  if (!groupId) return null;
  try {
    const ms = Number(sessionStorage.getItem(roomOpenedKey(groupId)));
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  } catch {
    return null;
  }
}

function forgetRoomOpened(groupId: string | undefined) {
  if (!groupId) return;
  try {
    sessionStorage.removeItem(roomOpenedKey(groupId));
  } catch {
    // 없어도 다음 회의 타이머를 막지 않습니다.
  }
}

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
    <div className={styles.meetingRecordingBanner}>
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

const MEETING_CLOCK_TOPIC = 'meeting-clock';

type MeetingClockMessage =
  | { type: 'clock:query'; from: string }
  | { type: 'clock:start'; from: string; startedAt: number };

function decodeMeetingClock(payload: Uint8Array): MeetingClockMessage | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payload)) as MeetingClockMessage;
    if (parsed.type !== 'clock:query' && parsed.type !== 'clock:start') return null;
    if (typeof parsed.from !== 'string') return null;
    if (parsed.type === 'clock:start' && !Number.isFinite(parsed.startedAt)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function RoomTopHeader({
  isRecording,
  openedAtRef,
  groupId,
}: {
  isRecording: boolean;
  /** 회의방을 연 시각. 나갈 때 meetings.started_at 으로 남깁니다. */
  openedAtRef: RefObject<number | null>;
  groupId?: string;
}) {
  const room = useRoomContext();
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    // 늦게 들어온 사람도 먼저 있던 사람의 시작 시각을 써야 진행 시간이 같아집니다.
    const adopt = (ms: number) => {
      if (!Number.isFinite(ms) || ms <= 0) return;
      const now = Date.now();
      if (ms > now + 10_000) return;
      const value = Math.min(ms, now);
      setStartedAt((prev) => (prev == null || value < prev ? value : prev));
      if (openedAtRef.current == null || value < openedAtRef.current) {
        openedAtRef.current = value;
        rememberRoomOpened(groupId, value);
      }
    };

    const publish = (msg: MeetingClockMessage, to?: string) => (
      room.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify(msg)),
        {
          reliable: true,
          topic: MEETING_CLOCK_TOPIC,
          destinationIdentities: to ? [to] : undefined,
        },
      )
    );

    const markStart = () => {
      const stored = readRoomOpened(groupId);
      if (stored != null) adopt(stored);
      adopt(Date.now());
      const from = room.localParticipant.identity;
      if (!from) return;
      void publish({ type: 'clock:query', from }).catch((err) => {
        console.warn('회의 진행 시간 요청 실패:', err);
      });
    };

    const onData = (payload: Uint8Array, _participant?: unknown, _kind?: unknown, topic?: string) => {
      if (topic !== MEETING_CLOCK_TOPIC) return;
      const msg = decodeMeetingClock(payload);
      const me = room.localParticipant.identity;
      if (!msg || !me || msg.from === me) return;
      if (msg.type === 'clock:start') {
        adopt(msg.startedAt);
        return;
      }
      const known = openedAtRef.current;
      if (known == null) return;
      void publish({ type: 'clock:start', from: me, startedAt: known }, msg.from).catch((err) => {
        console.warn('회의 진행 시간 전달 실패:', err);
      });
    };

    if (room.state === 'connected') markStart();
    room.on(RoomEvent.Connected, markStart);
    room.on(RoomEvent.Reconnected, markStart);
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.Connected, markStart);
      room.off(RoomEvent.Reconnected, markStart);
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room, openedAtRef, groupId]);

  useEffect(() => {
    if (!startedAt) return;
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  // 그룹명은 우측 사이드바에서 편집 — 헤더는 로고 + 타이머만 둡니다.
  return (
    <header className={`${shell.meetingHeader} ${styles.roomHeader}`}>
      <Link to="/main" className={styles.roomLogo}>GROP</Link>
      <span className={`${styles.meetingTitleTime}${isRecording ? ` ${styles.isRecording}` : ''}`}>
        {startedAt ? formatMeetingElapsed(elapsed) : '00:00:00'}
      </span>
    </header>
  );
}

/**
 * 회의방에 있는 사람 user id를 부모 ref에 모읍니다.
 * 녹화 저장·나가기는 LiveKit 바깥에서 돌아서, 그 시점의 참가자 목록을 직접 못 읽습니다.
 */
/** 지금 방에 있는 사람 수. 로컬 참가자도 포함하므로 1이면 혼자 남은 것입니다. */
function ParticipantCountTracker({ countRef }: { countRef: RefObject<number> }) {
  const participants = useParticipants();
  countRef.current = participants.length;
  return null;
}

/**
 * 방에 사람이 있는 동안 회의 목록에 진행중으로 보일 행을 만들고,
 * 들어온 사람 id를 그 행에 계속 더합니다.
 */
function LiveMeetingPresence({
  groupId,
  userId,
  sessionMeetingIdRef,
  attendeeIdsRef,
}: {
  groupId: string;
  userId: string;
  sessionMeetingIdRef: RefObject<string | null>;
  attendeeIdsRef: RefObject<string[]>;
}) {
  const room = useRoomContext();
  const participants = useParticipants();
  const identitiesKey = participants.map((person) => person.identity).sort().join('\n');

  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;

    const sync = async () => {
      if (room.state !== 'connected') return;
      const identities = participants
        .map((person) => (person.identity || '').trim())
        .filter(isUserId);
      const ordered = participants.map((person) => person.identity).filter(Boolean).sort();
      const me = room.localParticipant.identity;
      if (!me || ordered.length === 0) return;
      const meetingId = await ensureLiveMeeting({
        groupId,
        userId,
        attendeeIds: identities,
        preferredId: sessionMeetingIdRef.current || readSessionMeetingId(groupId),
        isLeader: ordered[0] === me,
      });
      if (cancelled || !meetingId) return;
      sessionMeetingIdRef.current = meetingId;
      rememberSessionMeetingId(groupId, meetingId);
      const known = new Set([...(attendeeIdsRef.current ?? []), ...identities]);
      if (isUserId(userId)) known.add(userId);
      attendeeIdsRef.current = [...known];
      await mergeMeetingAttendees(meetingId, [...known]);
    };

    void sync();
    const timer = window.setInterval(() => { void sync(); }, 8000);
    room.on(RoomEvent.Connected, sync);
    room.on(RoomEvent.Reconnected, sync);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      room.off(RoomEvent.Connected, sync);
      room.off(RoomEvent.Reconnected, sync);
    };
  }, [room, groupId, userId, identitiesKey, participants, sessionMeetingIdRef, attendeeIdsRef]);

  return null;
}

function MeetingAttendeesTracker({ attendeeIdsRef }: { attendeeIdsRef: RefObject<string[]> }) {
  const participants = useParticipants();

  useEffect(() => {
    // 나간 사람도 그 회의 참석자로 남기려고, 지금까지 들어온 id를 지우지 않고 더합니다.
    const ids = participants
      .map((p) => (p.identity || '').trim())
      .filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    const merged = new Set([...(attendeeIdsRef.current ?? []), ...ids]);
    if (merged.size > 0) attendeeIdsRef.current = [...merged];
  }, [participants, attendeeIdsRef]);

  return null;
}

function MeetingAudioSetup() {
  const room = useRoomContext();

  useEffect(() => {
    if (!isSecureMediaContext()) return;

    const applyVoice = async () => {
      const settings = loadVoiceSettings();
      try {
        if (isNoneDevice(settings.micDeviceId)) {
          await room.localParticipant.setMicrophoneEnabled(false);
        } else {
          const capture = voiceCaptureOptions(settings);
          if (capture) {
            if (settings.micDeviceId) {
              try {
                await room.switchActiveDevice('audioinput', settings.micDeviceId);
              } catch {
                // 장치 id가 바뀌었으면 기본 마이크로 켭니다.
              }
            }
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

    void applyVoice();
    // 설정 패널에서 마이크를 바꿔도 회의/녹화에 바로 반영합니다.
    return subscribeVoiceSettings(() => {
      void applyVoice();
    });
  }, [room]);

  // 브라우저 자동재생 정책 때문에 사용자 조작 전에는 상대방 소리가 막힐 수 있습니다.
  // "상대방 소리 켜기" 버튼을 띄우는 대신, 회의방 어디든 처음 클릭/키 입력할 때 조용히 오디오를 켭니다.
  // (보드·채팅 등이 stopPropagation 해도 받도록 capture 단계에서 듣습니다.)
  useEffect(() => {
    const unlockAudio = () => {
      if (room.canPlaybackAudio) return;
      room.startAudio().catch((err) => console.warn('상대방 오디오 재생 시작 실패:', err));
    };
    document.addEventListener('pointerdown', unlockAudio, true);
    document.addEventListener('keydown', unlockAudio, true);
    return () => {
      document.removeEventListener('pointerdown', unlockAudio, true);
      document.removeEventListener('keydown', unlockAudio, true);
    };
  }, [room]);

  return null;
}

function RecordingDataSync({
  userId,
  syncRef,
  isRecordingRef,
  onRemoteStart,
  onRemoteStop,
  onResume,
}: {
  userId: string;
  syncRef: RefObject<RecordingSyncHandle | null>;
  /** 지금 이 클라이언트가 녹화 중인지. 늦게 들어온 사람에게 상태를 알려 줄 때 씁니다. */
  isRecordingRef: RefObject<boolean>;
  onRemoteStart: () => void;
  onRemoteStop: () => void;
  /** 새로고침 전에 녹화 중이었으면 다시 시작합니다. */
  onResume?: () => void;
}) {
  const room = useRoomContext();
  const onRemoteStartRef = useRef(onRemoteStart);
  const onRemoteStopRef = useRef(onRemoteStop);
  const onResumeRef = useRef(onResume);
  onRemoteStartRef.current = onRemoteStart;
  onRemoteStopRef.current = onRemoteStop;
  onResumeRef.current = onResume;

  useEffect(() => {
    const publish = (type: 'recording:start' | 'recording:query', to?: string) => (
      room.localParticipant.publishData(
        encodeRecordingSyncMessage({ type, from: userId }),
        {
          reliable: true,
          topic: MEETING_RECORDING_TOPIC,
          destinationIdentities: to ? [to] : undefined,
        },
      )
    );

    const handler = (payload: Uint8Array, _participant?: unknown, _kind?: unknown, topic?: string) => {
      if (topic && topic !== MEETING_RECORDING_TOPIC) return;
      const msg = decodeRecordingSyncMessage(payload);
      if (!msg || msg.from === userId) return;
      if (msg.type === 'recording:start') onRemoteStartRef.current();
      else if (msg.type === 'recording:stop') onRemoteStopRef.current();
      else if (msg.type === 'recording:query' && isRecordingRef.current) {
        // 시작 신호는 저장되지 않습니다. 새로 들어온 사람이 물으면 지금 녹화 중일 때만 다시 알려 줍니다.
        void publish('recording:start', msg.from).catch((err) => {
          console.warn('녹화 상태 전달 실패:', err);
        });
      }
    };
    room.on(RoomEvent.DataReceived, handler);

    // 입장·재연결 때 이미 녹화 중인지 방에 물어 봅니다.
    const ask = () => {
      if (room.state !== 'connected') return;
      // 새로고침으로 녹화기가 사라져도, 이 탭이 녹화 중이었으면 다시 켭니다.
      onResumeRef.current?.();
      if (isRecordingRef.current) return;
      void publish('recording:query').catch((err) => {
        console.warn('녹화 상태 요청 실패:', err);
      });
    };
    ask();
    room.on(RoomEvent.Connected, ask);
    room.on(RoomEvent.Reconnected, ask);

    return () => {
      room.off(RoomEvent.DataReceived, handler);
      room.off(RoomEvent.Connected, ask);
      room.off(RoomEvent.Reconnected, ask);
    };
  }, [room, userId, isRecordingRef]);

  useEffect(() => {
    syncRef.current = {
      broadcastStart: () => {
        void room.localParticipant.publishData(
          encodeRecordingSyncMessage({ type: 'recording:start', from: userId }),
          { reliable: true, topic: MEETING_RECORDING_TOPIC },
        );
      },
      broadcastStop: () => room.localParticipant.publishData(
        encodeRecordingSyncMessage({ type: 'recording:stop', from: userId }),
        { reliable: true, topic: MEETING_RECORDING_TOPIC },
      ),
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
  return (
    <div className={shell.callControls}>
      <button
        type="button"
        className={`${styles.callIconButton}${isRecording ? ` ${styles.isRecording}` : ''}`}
        data-tooltip="녹화"
        aria-label="녹화 시작/종료"
        disabled={savingRecording}
        onClick={onToggleRecord}
      >
        <svg viewBox="0 0 24 24" fill={isRecording ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="7" />
        </svg>
      </button>
      <button type="button" className={`${shell.leaveButton} ${styles.roomLeaveButton}`} onClick={onLeave}>
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
  onResumeRecording,
  isRecording,
  isRecordingRef,
  savingRecording,
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
  onResumeRecording?: () => void;
  isRecording: boolean;
  isRecordingRef: RefObject<boolean>;
  savingRecording: boolean;
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
    'rectangle', 'ellipse', 'diamond', 'triangle', 'pentagon', 'hexagon', 'octagon', 'star', 'arrow', 'line', 'elbowArrow', 'curveArrow',
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
      // 문서 탭 저장과 별개로, 올린 직후 파일명 알림을 남깁니다.
      if (groupId) void notifyDocumentUpload(groupId, [saved.name]);
    } catch (err) {
      alert(err instanceof Error ? err.message : '파일 첨부에 실패했습니다.');
    } finally {
      setUploadingAttachment(false);
    }
  };

  const handlePick = (next: MeetingDrawAction) => {
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
        isRecordingRef={isRecordingRef}
        onRemoteStart={onRemoteStartRecording}
        onRemoteStop={onRemoteStopRecording}
        onResume={onResumeRecording}
      />
      <RoomRecordingBridge bridgeRef={recordingBridgeRef} />
      {(isRecording || savingRecording) ? (
        <div className={styles.meetingRecordingBanner}>
          {savingRecording ? '회의록 저장 중...' : '회의 화면 녹화 중...'}
        </div>
      ) : null}
      <main className={`${shell.meetingMain} ${styles.roomMain}`}>
        <div className={`${shell.whiteboard} ${styles.roomWhiteboard}`}>
          <CanvasBoard
            ref={canvasBoardRef}
            embedded
            meetingMode
            gropShell
            onToolChange={(tool) => {
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
          speakerMuted={speakerMuted}
          onSpeakerMutedChange={setSpeakerMuted}
        />
      </main>
      <footer className={`${shell.bottomBar} ${styles.roomBottomBar}`}>
        <MeetingDrawingTools
          compact
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
        />
      </footer>
    </>
  );
}

export default function Room() {
  const { id } = useParams();
  const navigate = useNavigate();
  // 개발 전용 미리보기: `npm run dev` 중에 주소 뒤에 ?preview=1 을 붙이면(예: /room/test?preview=1)
  // 백엔드(토큰 서버)·로그인·LiveKit 연결 없이 회의방 화면 틀만 띄웁니다. 레이아웃/CSS 작업용이라
  // 참가자·음성·녹화 같은 연결이 필요한 기능은 비어 있고, 배포 빌드(DEV=false)에서는 항상 꺼집니다.
  const isPreview = import.meta.env.DEV && new URLSearchParams(window.location.search).get('preview') === '1';
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
  /** IndexedDB에 쌓는 이번 녹화 id. 업로드와 회의록 저장이 끝난 뒤에만 비웁니다. */
  const activeRecordingIdRef = useRef<string | null>(null);
  /** 같은 회의 행 id를 조각마다 다시 쓰지 않기 위한 표시입니다. */
  const mirroredMeetingIdRef = useRef<string | null>(null);
  const userIdRef = useRef('');
  const groupNameRef = useRef('');
  const groupIdRef = useRef(id);
  const isRecordingRef = useRef(false);
  /** 이 방에서 녹화가 한 번이라도 켜졌는지. 나갈 때 남은 사람 녹화를 같이 끊을지 판단합니다. */
  const sharedRecordingRef = useRef(false);
  /** 늦게 들어온 쪽의 녹화 따라하기. 종료 신호가 오면 재시도를 멈춥니다. */
  const followRecordingRef = useRef(false);
  /** 지금 방에 연결된 사람 수. 나가기 전에 마지막 참가자인지 판단합니다. */
  const participantCountRef = useRef(1);
  /** persist 중인지 — 나가기 버튼이 저장을 끊지 않게 합니다. */
  const savingRecordingRef = useRef(false);
  /** 녹화 시작 준비 중(캡처 생성) — 중복 클릭 방지 */
  const startingRecordingRef = useRef(false);
  /** 회의 중 첨부 — RoomContent 와 공유 (파일만 올려도 문서 탭에 반영) */
  const sharedFilesRef = useRef<MeetingSharedFile[]>([]);
  const sessionMeetingIdRef = useRef<string | null>(null);
  /** LiveKit 연결 시각. 생성 시간의 시작점입니다. */
  const roomOpenedAtRef = useRef<number | null>(null);
  /** 회의 중 들어왔던 user id. 저장할 때 닉네임으로 바꿉니다. */
  const attendeeIdsRef = useRef<string[]>([]);

  useEffect(() => {
    groupIdRef.current = id;
  }, [id]);

  userIdRef.current = userId;
  groupNameRef.current = groupName;

  // 탭이 꺼지기 직전에 회의 행·채팅을 보관분에 남깁니다. 상태는 recording이라 다음 입장에서 업로드를 물어봅니다.
  useEffect(() => {
    const snapshot = () => {
      const recordingId = activeRecordingIdRef.current;
      if (!recordingId) return;
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state === 'recording') {
        try {
          recorder.requestData();
        } catch {
          // 마지막 조각을 못 요청해도 이미 들어간 조각은 남습니다.
        }
      }
      void patchLocalRecording(recordingId, {
        meetingId: sessionMeetingIdRef.current,
        attachments: toMeetingAttachments(sharedFilesRef.current),
        chatLog: withAttendeePresence(chatLogRef.current, [
          ...attendeeIdsRef.current,
          ...(isUserId(userIdRef.current) ? [userIdRef.current] : []),
        ]),
        createdBy: userIdRef.current || null,
        groupName: groupNameRef.current,
      }).catch(() => {});
    };
    window.addEventListener('pagehide', snapshot);
    return () => window.removeEventListener('pagehide', snapshot);
  }, []);

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

  /**
   * 회의방 열린 시각, 닫는 시각, 참석자 user id를 회의 행에 남깁니다.
   * 컬럼이 아직 없어도 녹화 저장 자체는 막지 않습니다.
   */
  const saveSessionMeta = async (meetingId: string, opts?: { close?: boolean }) => {
    const chatStart = chatLogRef.current.find((m) => m.ts > 0)?.ts ?? null;
    const opened = roomOpenedAtRef.current ?? chatStart ?? Date.now();
    const ids = new Set(attendeeIdsRef.current);
    // 목록 아이콘은 이 방의 모든 참가자여야 해서, 저장하는 사람도 빠지지 않게 넣습니다.
    if (isUserId(userId)) ids.add(userId);
    for (const msg of chatLogRef.current) {
      if (isUserId(msg.from || '')) ids.add(msg.from);
    }
    // 참석자는 덮어쓰지 않고 더합니다. 늦게 저장하는 사람이 앞사람을 지우지 않게 합니다.
    await mergeMeetingAttendees(meetingId, [...ids]);
    const payload: Record<string, unknown> = {
      started_at: new Date(opened).toISOString(),
    };
    // 끝난 시각은 마지막 사람이 나갈 때만 남깁니다. 진행중 여부는 방 인원으로 판단합니다.
    if (opts?.close) payload.ended_at = new Date().toISOString();
    try {
      for (let i = 0; i < 4; i += 1) {
        const { error } = await supabase.from('meetings').update(payload).eq('id', meetingId);
        if (!error) return;
        const col = missingMeetingsColumn(error.message);
        if (!col || !(col in payload)) {
          console.warn('회의 시간·참석자 저장 실패:', error.message);
          return;
        }
        delete payload[col];
        if (Object.keys(payload).length === 0) return;
      }
    } catch (err) {
      console.warn('회의 시간·참석자 저장 실패:', err);
    }
  };

  // 영상 원본은 브라우저가 R2에 직접 올리고, meetings에는 video_key와 업로드 상태만 저장합니다.
  // 올리기 전에 IndexedDB에 남겨 두어, 업로드나 회의록 저장이 실패해도 영상을 잃지 않습니다.
  const persistMeetingRecording = async (): Promise<{
    ok: boolean;
    error?: string;
    meetingId?: string;
    /** 브라우저 보관분에 남겼으면 true. 이 경우 오류창 대신 다시 시도 배너를 씁니다. */
    kept?: boolean;
    alreadyDone?: boolean;
  }> => {
    // stop 직후 마지막 청크가 늦게 들어오는 경우를 한 번 더 기다립니다.
    if (recordedChunksRef.current.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    let recordingId = activeRecordingIdRef.current;
    if (recordingId) {
      try {
        await flushRecordingWrites(recordingId);
      } catch (err) {
        console.warn('녹화 조각 저장을 끝내지 못했습니다.', err);
      }
    }

    let storedCount = 0;
    if (recordingId) {
      try {
        storedCount = await countRecordingChunks(recordingId);
      } catch (err) {
        console.warn('브라우저에 보관 중인 녹화 조각을 확인하지 못했습니다.', err);
      }
    }

    if (recordedChunksRef.current.length === 0 && storedCount === 0) {
      if (recordingId) {
        clearActiveRecording(recordingId);
        activeRecordingIdRef.current = null;
        void deleteLocalRecording(recordingId);
      }
      // 영상 청크는 없지만 첨부가 있으면 문서만이라도 남깁니다.
      const attachments = toMeetingAttachments(sharedFilesRef.current);
      if (attachments.length > 0 || sessionMeetingIdRef.current) {
        if (sessionMeetingIdRef.current) {
          await saveSessionMeta(sessionMeetingIdRef.current);
          return { ok: true };
        }
        const now = new Date();
        const titleStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 회의`;
        const { data: userData } = await supabase.auth.getUser();
        const result = await syncMeetingAttachmentsDoc({
          meetingId: null,
          groupId: groupIdRef.current ?? '',
          userId: userData.user?.id,
          files: sharedFilesRef.current,
        });
        if (result.meetingId) {
          sessionMeetingIdRef.current = result.meetingId;
          await saveSessionMeta(result.meetingId);
          return { ok: true };
        }
      }
      return {
        ok: false,
        error:
          '저장할 화면 녹화가 없습니다. 녹화 시작 후 배너가 뜬 것을 확인한 뒤, 몇 초 기다렸다가 종료해 주세요.',
      };
    }

    const { data: userData } = await supabase.auth.getUser();
    const gid = groupIdRef.current;
    if (!gid) {
      return { ok: false, error: '그룹 정보가 없어 회의록을 저장하지 못했습니다.' };
    }

    const remember = (meetingId: string) => {
      sessionMeetingIdRef.current = meetingId;
      rememberLastMeeting(meetingId);
    };
    // 채팅 기록은 마이크 없이 진행한 회의도 나중에 AI 요약을 만들 수 있게 해줍니다.
    const attachments = toMeetingAttachments(sharedFilesRef.current);
    const chatLog = withAttendeePresence(chatLogRef.current, [
      ...attendeeIdsRef.current,
      ...(isUserId(userId) ? [userId] : []),
    ]);
    const createdBy = userData.user?.id ?? null;

    try {
      if (!recordingId) {
        recordingId = newRecordingId();
        noteActiveRecording(recordingId);
        activeRecordingIdRef.current = recordingId;
        await createLocalRecording({
          id: recordingId,
          groupId: gid,
          mimeType: recorderMimeRef.current,
          createdBy,
          groupName,
        });
      }
      // 메모리에 있는 전체를 기준으로 맞춘 뒤에 대기 상태로 바꿉니다.
      // 이 시점 이후 탭이 꺼져도 다음 접속에서 자동으로 다시 올립니다.
      if (recordedChunksRef.current.length > 0) {
        await syncChunksFromMemory(recordingId, recordedChunksRef.current);
      }
      const stored = await getLocalRecording(recordingId);
      await patchLocalRecording(recordingId, {
        status: 'pending_upload',
        meetingId: sessionMeetingIdRef.current,
        title: recordingTitleFromDate(stored?.date ?? ''),
        attachments,
        chatLog,
        createdBy,
        groupName,
        mimeType: recorderMimeRef.current || stored?.mimeType,
      });
    } catch (storeErr) {
      console.warn('녹화를 브라우저에 보관하지 못했습니다. 메모리에 있는 파일만 올립니다.', storeErr);
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const blob = new Blob(recordedChunksRef.current, { type: recorderMimeRef.current || 'video/webm' });
      const fallback = await uploadBlobAndInsert({
        blob,
        groupId: gid,
        dateStr,
        mimeType: blob.type || 'video/webm',
        title: recordingTitleFromDate(dateStr),
        meetingId: sessionMeetingIdRef.current,
        attachments,
        chatLog,
        createdBy,
        groupName,
        startedAt: now.getTime(),
      });
      if (fallback.ok) {
        recordedChunksRef.current = [];
        if (recordingId) {
          clearActiveRecording(recordingId);
          activeRecordingIdRef.current = null;
          void deleteLocalRecording(recordingId);
        }
        remember(fallback.meetingId);
        await saveSessionMeta(fallback.meetingId);
        return { ok: true, meetingId: fallback.meetingId };
      }
      // 보관도 업로드도 못 하면 이번 세션의 메모리에서라도 파일로 남깁니다.
      if (blob.size > 0) downloadBlobFile(blob, `회의녹화-${dateStr}.webm`);
      return {
        ok: false,
        kept: false,
        error: blob.size > 0
          ? `${fallback.error}\n\n브라우저에 보관하지 못해 녹화 파일을 이 컴퓨터로 내려받았습니다.`
          : fallback.error,
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
      return { ok: true, meetingId: result.meetingId, alreadyDone: result.alreadyDone };
    }

    // 실패분은 pending_upload 로 남아 있습니다. 배너의 다시 시도·내 컴퓨터 저장으로 이어집니다.
    clearActiveRecording(recordingId);
    activeRecordingIdRef.current = null;
    return { ok: false, error: result.error, kept: result.kept };
  };

  useEffect(() => {
    const init = async () => {
      // 미리보기 모드: 로그인/토큰 요청을 건너뛰고 바로 화면을 그립니다 (위 isPreview 설명 참고)
      if (isPreview) {
        setUserId('preview-user');
        setUserName('미리보기');
        setGroupName('미리보기 그룹');
        setLoading(false);
        return;
      }
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
      const recorder = mediaRecorderRef.current;
      const recordingId = activeRecordingIdRef.current;
      // 종료 저장이 끝난 뒤에는 ref가 비어 있어 여기로 오지 않습니다.
      // 녹화 중에 방이 사라지면 조각을 남기고, 다시 열렸을 때 업로드를 물어봅니다.
      const interrupted = Boolean(
        recordingId
        && (isRecordingRef.current || recorder?.state === 'recording'),
      );
      if (recorder && recorder.state !== 'inactive') {
        try {
          if (recorder.state === 'recording') recorder.requestData();
        } catch {
          // 마지막 조각을 못 요청해도 이미 보관된 조각은 남습니다.
        }
        try {
          recorder.stop();
        } catch {
          // 이미 멈춘 녹화기는 무시합니다.
        }
      }
      if (!interrupted || !recordingId) return;
      clearActiveRecording(recordingId);
      void flushRecordingWrites(recordingId);
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('grop-recording-interrupted'));
      }, 600);
    };
  }, [id, navigate, isPreview]);

  const stopRecordingLocal = async (discardChunks: boolean) => {
    const recordingId = activeRecordingIdRef.current;
    await stopMediaRecorder();
    await new Promise((resolve) => setTimeout(resolve, 300));
    mediaRecorderRef.current = null;
    isRecordingRef.current = false;
    setIsRecording(false);
    if (discardChunks) {
      // 다른 참가자가 녹화를 끈 경우 이 브라우저 사본은 올리지 않습니다.
      recordedChunksRef.current = [];
      activeRecordingIdRef.current = null;
      if (recordingId) {
        clearActiveRecording(recordingId);
        try {
          await flushRecordingWrites(recordingId);
          await deleteLocalRecording(recordingId);
        } catch (err) {
          console.warn('버린 녹화를 브라우저 보관함에서 지우지 못했습니다.', err);
        }
      }
      return;
    }
    if (recordingId) {
      try {
        await flushRecordingWrites(recordingId);
      } catch (err) {
        console.warn('마지막 녹화 조각을 브라우저에 반영하지 못했습니다.', err);
      }
    }
  };

  const startRecording = async (opts?: { remote?: boolean; attempt?: number }) => {
    // mediaRecorderRef 가 남아 있어도 조용히 return 하지 않습니다. (예전엔 버튼이 안 눌린 것처럼 보임)
    if (isRecordingRef.current || startingRecordingRef.current || savingRecording) return;
    if (opts?.remote && !followRecordingRef.current) return;
    startingRecordingRef.current = true;

    const container = recordingAreaRef.current;
    const canvasEl = canvasBoardRef.current?.getCanvasElement();
    if (!container || !canvasEl || !('captureStream' in canvasEl)) {
      startingRecordingRef.current = false;
      const attempt = opts?.attempt ?? 0;
      // 입장 직후에는 캔버스가 아직 없습니다. 녹화 중이라는 답을 받았으면 잠시 뒤 다시 시작합니다.
      if (opts?.remote && followRecordingRef.current && attempt < 8) {
        window.setTimeout(() => {
          void startRecording({ remote: true, attempt: attempt + 1 });
        }, 400);
        return;
      }
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

      const combined = new MediaStream(videoTracks);
      // 믹서의 오디오 트랙은 마이크가 아직 안 붙어도 존재합니다.
      // MediaRecorder 시작 전에 넣어 둬야 나중에 목소리가 녹화에 들어갑니다.
      const settings = loadVoiceSettings();
      const wantMic = isSecureMediaContext() && !isNoneDevice(settings.micDeviceId);
      if (wantMic && recordingBridgeRef.current) {
        const mixed = recordingBridgeRef.current.prepareAudioStream();
        mixed.getAudioTracks()
          .filter((t) => t.readyState !== 'ended')
          .forEach((track) => combined.addTrack(track));
        await Promise.race([
          recordingBridgeRef.current.connectSources(),
          new Promise<void>((resolve) => {
            window.setTimeout(resolve, 1500);
          }),
        ]);
      }
      recordingStreamRef.current = combined;

      const hasAudio = combined.getAudioTracks().length > 0;
      const mimeType = pickMeetingRecorderMimeType(true, hasAudio);
      recorderMimeRef.current = mimeType || 'video/webm';

      let mediaRecorder: MediaRecorder;
      try {
        mediaRecorder = new MediaRecorder(combined, mimeType ? { mimeType } : undefined);
      } catch {
        mediaRecorder = new MediaRecorder(combined);
        recorderMimeRef.current = mediaRecorder.mimeType || 'video/webm';
      }

      const recordingId = newRecordingId();
      noteActiveRecording(recordingId);
      activeRecordingIdRef.current = recordingId;
      mirroredMeetingIdRef.current = null;
      try {
        await createLocalRecording({
          id: recordingId,
          groupId: groupIdRef.current ?? '',
          mimeType: recorderMimeRef.current,
          createdBy: userIdRef.current || null,
          groupName: groupNameRef.current,
        });
      } catch (storeErr) {
        // 보관이 막혀도 이번 녹화는 메모리로 진행합니다. 종료 때 한 번 더 보관을 시도합니다.
        console.warn('녹화를 브라우저에 보관하지 못했습니다. 이번 녹화는 메모리에만 남습니다.', storeErr);
        clearActiveRecording(recordingId);
        activeRecordingIdRef.current = null;
      }

      const storedId = activeRecordingIdRef.current;
      recordedChunksRef.current = [];
      mediaRecorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0) return;
        recordedChunksRef.current.push(event.data);
        if (!storedId) return;
        void appendRecordingChunk(storedId, event.data);
        const meetingId = sessionMeetingIdRef.current;
        if (meetingId && mirroredMeetingIdRef.current !== meetingId) {
          mirroredMeetingIdRef.current = meetingId;
          void patchLocalRecording(storedId, { meetingId }).catch(() => {});
        }
      };
      mediaRecorder.onerror = (ev) => {
        console.error('MediaRecorder 오류:', ev);
      };

      mediaRecorder.start(250);
      mediaRecorderRef.current = mediaRecorder;
      isRecordingRef.current = true;
      sharedRecordingRef.current = true;
      setIsRecording(true);
      rememberRecording(groupIdRef.current, true);

      if (!opts?.remote) {
        recordingSyncRef.current?.broadcastStart();
        const gid = groupIdRef.current;
        // 녹화 시작을 회의 시작으로 보고, 알림을 누르면 바로 회의방으로 들어오게 합니다.
        // 원격 동기화로 따라 시작한 참가자(opts.remote)는 중복 알림을 보내지 않습니다.
        if (gid) {
          void notifyGroupMembers({
            groupId: gid,
            type: 'meeting_start',
            title: `${groupName || '그룹'} 회의가 시작됐어요`,
            body: '지금 회의방에 참여할 수 있어요.',
            link: `/room/${gid}`,
            excludeSelf: false,
          });
        }
      }
    } catch (err) {
      console.error('회의 화면 녹화 시작 실패:', err);
      recordingCaptureCleanupRef.current?.();
      recordingCaptureCleanupRef.current = null;
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      const failedRecorder = mediaRecorderRef.current;
      if (failedRecorder && failedRecorder.state !== 'inactive') {
        try { failedRecorder.stop(); } catch { /* 시작에 실패한 녹화기는 멈춰 둡니다. */ }
      }
      const failedId = activeRecordingIdRef.current;
      mediaRecorderRef.current = null;
      activeRecordingIdRef.current = null;
      isRecordingRef.current = false;
      setIsRecording(false);
      // 조각이 없기 전에 실패한 빈 보관분만 지웁니다. 조각이 있으면 다음 입장에서 업로드를 물어봅니다.
      if (failedId) {
        clearActiveRecording(failedId);
        if (recordedChunksRef.current.length === 0) {
          void deleteLocalRecording(failedId);
        } else {
          window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent('grop-recording-interrupted'));
          }, 600);
        }
      }
      if (!opts?.remote) {
        alert(err instanceof Error ? err.message : '회의 화면 녹화를 시작하지 못했습니다.');
      }
    } finally {
      startingRecordingRef.current = false;
    }
  };

  const stopRecordingAndSave = async (opts?: { save?: boolean }) => {
    const shouldSave = opts?.save !== false;
    if (savingRecordingRef.current) return;
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
    savingRecordingRef.current = true;
    try {
      // 시작 직후 종료하면 MediaRecorder가 아직 없을 수 있어 잠깐 기다립니다.
      for (let i = 0; i < 25 && !mediaRecorderRef.current; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      await stopRecordingLocal(false);

      const result = await persistMeetingRecording();
      if (result.ok) {
        canvasBoardRef.current?.clearBoard();
        // 다른 경로가 먼저 저장을 끝낸 경우에는 배너 안내만 남기고 alert는 겹치지 않습니다.
        if (!result.alreadyDone) {
          alert('녹화를 종료하고 회의록에 저장했습니다.\nAI 요약 탭에서 바로 확인할 수 있습니다.');
        }
      } else if (!result.kept) {
        alert(`회의록 저장 실패: ${result.error}`);
      }
    } catch (err) {
      console.error('녹음 종료/저장 실패:', err);
      alert('녹음 종료 중 오류가 발생했습니다.');
      setIsRecording(false);
    } finally {
      savingRecordingRef.current = false;
      setSavingRecording(false);
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      // 녹화 종료 버튼을 누른 경우에만 모두의 녹화를 끊습니다. 그냥 나가기는 마지막 사람만 종료합니다.
      rememberRecording(groupIdRef.current, false);
      void (async () => {
        try {
          await recordingSyncRef.current?.broadcastStop();
        } catch (err) {
          console.warn('녹화 종료 알림 전달 실패:', err);
        }
        await stopRecordingAndSave({ save: true });
      })();
      return;
    }
    void startRecording();
  };

  const handleLeave = async () => {
    const recorderActive =
      isRecordingRef.current
      || mediaRecorderRef.current?.state === 'recording'
      || recordedChunksRef.current.length > 0;
    // 1명만 남았을 때만 녹화를 끝내고 나갑니다. 다른 사람이 있으면 그 사람들 녹화는 이어집니다.
    const isLastParticipant = participantCountRef.current <= 1;

    setSaving(true);
    // 이 브라우저가 방을 떠나면 다음 회의 타이머·회의 행이 이전 접속을 쓰지 않게 지웁니다.
    forgetRoomOpened(id);
    forgetSessionMeetingId(id);

    try {
      if (!isLastParticipant) {
        // 이 브라우저만 나갑니다. 방에 남은 사람의 녹화 표시는 그대로 둡니다.
        rememberRecording(id, false);
      } else if (recorderActive || savingRecordingRef.current) {
        rememberRecording(id, false);
        if (!savingRecordingRef.current) {
          await stopRecordingAndSave({ save: true });
        } else {
          for (let i = 0; i < 80 && savingRecordingRef.current; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
      }

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
    } catch (err) {
      console.error('오류:', err);
    }

    if (sessionMeetingIdRef.current) {
      // 생성 시간의 끝과 완료 표시는 마지막 사람이 나갈 때만 닫습니다.
      await saveSessionMeta(sessionMeetingIdRef.current, { close: isLastParticipant });
    }

    setSaving(false);
    const lastId = sessionMeetingIdRef.current;
    navigate(lastId ? `/ai?meeting=${lastId}` : `/group/${id}`);
  };

  if (loading) {
    return (
      <div className={shell.meetingLoading}>연결 중...</div>
    );
  }

  if (saving) {
    return (
      <div className={shell.meetingLoading}>회의록 저장 중...</div>
    );
  }

  if (!id) {
    navigate('/main');
    return null;
  }

  return (
    <div className={`meeting-page stage ${styles.roomPage}`}>
      <LiveKitRoom
        token={token}
        serverUrl={import.meta.env.VITE_LIVEKIT_URL}
        connect={!isPreview}
        audio={!isPreview && isSecureMediaContext() ? voiceCaptureOptions(loadVoiceSettings()) : false}
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
          <RoomTopHeader isRecording={isRecording} openedAtRef={roomOpenedAtRef} groupId={id} />
          <ParticipantCountTracker countRef={participantCountRef} />
          <MeetingAttendeesTracker attendeeIdsRef={attendeeIdsRef} />
          <LiveMeetingPresence
            groupId={id}
            userId={userId}
            sessionMeetingIdRef={sessionMeetingIdRef}
            attendeeIdsRef={attendeeIdsRef}
          />
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
            onRemoteStartRecording={() => {
              followRecordingRef.current = true;
              void startRecording({ remote: true });
            }}
            onRemoteStopRecording={() => {
              followRecordingRef.current = false;
              rememberRecording(id, false);
              void stopRecordingAndSave({ save: false });
            }}
            onResumeRecording={() => {
              if (!wasRecording(id)) return;
              followRecordingRef.current = true;
              void startRecording({ remote: true });
            }}
            isRecording={isRecording}
            isRecordingRef={isRecordingRef}
            savingRecording={savingRecording}
          />
        </div>
      </LiveKitRoom>
    </div>
  );
}

