import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { supabase } from './services/supabaseClient';
import ExcalidrawToolbar, { toolShortcutMap, type ExcalidrawTool } from './components/ExcalidrawToolbar';
// 타임랩스 사이드 패널 컴포넌트 import (현재 비활성화)
import CanvasViewportControls from './components/CanvasViewportControls';
import { CANVAS_FONT_FAMILY, drawShapeTool, drawStamp, drawText, textFontSize, type ShapeTool } from './canvasShapeUtils';
import { explainBoardError } from './boardErrors';
import { dedupeBoardsById, getBoardOptionLabel } from './timelapseApi';
// 타임랩스 사이드 패널 CSS import (현재 비활성화)
import cb from './CanvasBoard.module.css';
import { RoomEvent } from 'livekit-client';
import { useLocalParticipant, useRoomContext } from '@livekit/components-react';
import { getApiBase } from './utils/apiBase';
import BoardFilePreview from './components/BoardFilePreview';
import { expandedFileSize, getFilePreviewKind } from './filePreviewUtils';
import { rasterizeBoardFile } from './rasterizeBoardFile';

const MEETING_CHAT_TOPIC = 'meeting-chat';
const MEETING_BOARD_TOPIC = 'meeting-board';

type MeetingChatFile = {
  name: string;
  path: string;
  size: number;
  mime: string;
};

type MeetingChatMessage = {
  id: string;
  from: string;
  name: string;
  text: string;
  ts: number;
  file?: MeetingChatFile;
};

type MeetingBoardMessage = {
  type: 'board:selected';
  boardId: string;
  title?: string;
  from: string;
};

function encodeMeetingChatMessage(msg: MeetingChatMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(msg));
}

function decodeMeetingChatMessage(payload: Uint8Array): MeetingChatMessage | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payload));
    if (!parsed || typeof parsed !== 'object') return null;
    const hasText = typeof parsed.text === 'string';
    const hasFile = parsed.file && typeof parsed.file.path === 'string';
    if (!hasText && !hasFile) return null;
    return {
      ...(parsed as MeetingChatMessage),
      text: hasText ? parsed.text : '',
    };
  } catch {
    return null;
  }
}

const MAX_CHAT_FILE_BYTES = 20 * 1024 * 1024;

function formatChatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function chatFileUrl(relPath: string) {
  return `${getApiBase()}/files/${relPath.split('/').map(encodeURIComponent).join('/')}`;
}

const IMAGE_FILE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

/** Windows에서 한글 파일명은 MIME이 비어 이미지로 안 잡히는 경우가 있습니다. */
function isImageFile(file: File) {
  if (file.type.startsWith('image/')) return true;
  return IMAGE_FILE_EXT.test(file.name);
}

/** 예전에 latin1로 저장된 한글 파일명을 화면에서 복원합니다. */
function displayFileName(name: string) {
  if (!name) return 'file';
  if (/[가-힣]/.test(name)) return name;
  try {
    const bytes = Uint8Array.from(name, (ch) => ch.charCodeAt(0) & 0xff);
    const decoded = new TextDecoder('utf-8').decode(bytes);
    if (decoded.includes('\uFFFD')) return name;
    if (/[가-힣]/.test(decoded)) return decoded;
  } catch {
    /* 복원 실패 시 원본을 그대로 보여줍니다. */
  }
  return name;
}

function encodeMeetingBoardMessage(msg: MeetingBoardMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(msg));
}

function decodeMeetingBoardMessage(payload: Uint8Array): MeetingBoardMessage | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payload));
    if (parsed && parsed.type === 'board:selected' && typeof parsed.boardId === 'string') {
      return parsed as MeetingBoardMessage;
    }
    return null;
  } catch {
    return null;
  }
}

function decodeMeetingBoardMetadata(metadata?: string): MeetingBoardMessage | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    if (parsed && parsed.type === 'board:selected' && typeof parsed.boardId === 'string') {
      return parsed as MeetingBoardMessage;
    }
    return null;
  } catch {
    return null;
  }
}

function formatChatTime(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 회의방 안에서만 보이는 채팅 패널입니다.
// 이 컴포넌트는 같은 회의방에 있는 사람들끼리 텍스트 메시지를 주고받게 해줍니다.
// LiveKit 데이터 채널을 이용해서 다른 참가자에게 메시지를 보내고, 받은 메시지를 화면에 표시합니다.
function MeetingChatPanel({ onClose, groupId }: { onClose: () => void; groupId?: string }) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const [messages, setMessages] = useState<MeetingChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [uploading, setUploading] = useState(false);
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

  return (
    <div
      style={{
        width: 260,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#2b2d31',
        borderLeft: '1px solid #1e1f22',
        minHeight: 0,
      }}
    >
      <div
        style={{
          flexShrink: 0,
          padding: '10px 12px',
          borderBottom: '1px solid #1e1f22',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: '#dbdee1' }}>💬 채팅</span>
        <button
          type="button"
          onClick={onClose}
          title="채팅 닫기"
          style={{
            border: 'none',
            background: 'transparent',
            color: '#949ba4',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          닫기 ✕
        </button>
      </div>

      <div
        ref={listRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '10px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {messages.length === 0 ? (
          <div style={{ fontSize: 12, color: '#6b7280', textAlign: 'center', marginTop: 20 }}>
            아직 채팅이 없어요.
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#f2f3f5' }}>{m.name}</span>
                <span style={{ fontSize: 10, color: '#6b7280' }}>{formatChatTime(m.ts)}</span>
              </div>
              <div style={{ fontSize: 13, color: '#dbdee1', wordBreak: 'break-word', marginTop: 2 }}>
                {m.text}
              </div>
              {m.file ? (
                <div style={{ marginTop: 6 }}>
                  {m.file.mime.startsWith('image/') ? (
                    <a href={chatFileUrl(m.file.path)} target="_blank" rel="noreferrer">
                      <img
                        src={chatFileUrl(m.file.path)}
                        alt={displayFileName(m.file.name)}
                        style={{ maxWidth: '100%', maxHeight: 140, borderRadius: 6, display: 'block' }}
                      />
                    </a>
                  ) : null}
                  <a
                    href={chatFileUrl(m.file.path)}
                    target="_blank"
                    rel="noreferrer"
                    download={displayFileName(m.file.name)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      marginTop: 6,
                      padding: '6px 8px',
                      borderRadius: 6,
                      background: '#1e1f22',
                      color: '#c7c9cc',
                      textDecoration: 'none',
                      fontSize: 12,
                    }}
                  >
                    <span>📎 {displayFileName(m.file.name)}</span>
                    <span style={{ color: '#6b7280' }}>{formatChatFileSize(m.file.size)}</span>
                  </a>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          gap: 6,
          padding: 10,
          borderTop: '1px solid #1e1f22',
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
        <button
          type="button"
          title="파일 첨부"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          style={{
            padding: '8px 10px',
            border: '1px solid #1e1f22',
            borderRadius: 6,
            background: '#1e1f22',
            color: '#dbdee1',
            cursor: uploading ? 'not-allowed' : 'pointer',
            fontSize: 13,
            flexShrink: 0,
          }}
        >
          📎
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder={uploading ? '파일 올리는 중...' : '메시지 입력...'}
          disabled={uploading}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '8px 10px',
            border: '1px solid #1e1f22',
            borderRadius: 6,
            background: '#1e1f22',
            color: '#dbdee1',
            fontSize: 13,
          }}
        />
        <button
          type="button"
          onClick={sendMessage}
          disabled={uploading}
          style={{
            padding: '8px 12px',
            border: 'none',
            borderRadius: 6,
            background: '#5865f2',
            color: 'white',
            cursor: uploading ? 'not-allowed' : 'pointer',
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          전송
        </button>
      </div>
    </div>
  );
}

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
const DEFAULT_ZOOM_INDEX = 3;
const MAX_HISTORY = 50;
const STROKE_CHUNK_MS = 40;
const MIN_EVENT_GAP_MS = 1;

type Tool = ExcalidrawTool;

const GROUP_BOARD_TITLE_PREFIX = '__group__:';

type Props = {
  onBack?: () => void;
  embedded?: boolean;
  meetingMode?: boolean;
  meetingHeaderExtra?: ReactNode;
  groupId?: string;
  groupName?: string;
  initialBoardId?: string;
  initialTimelapseSaveId?: string;
  autoPlayTimelapse?: boolean;
};

export type CanvasBoardHandle = {
  clearBoard: () => void;
  getCanvasElement: () => HTMLCanvasElement | null;
};

type Point = { x: number; y: number };

type Board = { id: string; title: string; created_at: string };

type StrokeTool = 'pen' | 'eraser';
type EventType =
  | 'stroke.begin'
  | 'stroke.append'
  | 'stroke.end'
  | 'board.clear'
  | 'shape.add'
  | 'image.add'
  | 'image.transform'
  | 'text.add'
  | 'text.transform'
  | 'file.add'
  | 'file.transform'
  | 'file.remove'
  | 'stamp.add';

// 캔버스에 붙이는 이미지: 파일 용량 상한, 화면에 그릴 때 가로 최대 픽셀
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_DRAW_WIDTH = 800;
const MIN_IMAGE_DRAW_SIZE = 48;

type BoardEventRow = {
  id: string;
  board_id: string;
  seq: number;
  ts: string;
  actor_id: string;
  type: EventType;
  payload: unknown;
};

type StrokeBeginPayload = {
  strokeId: string;
  tool: StrokeTool;
  color: string;
  size: number;
  point: Point;
};

type StrokeAppendPayload = {
  strokeId: string;
  points: Point[];
};

type StrokeEndPayload = {
  strokeId: string;
};

type ShapeAddPayload = {
  tool: ShapeTool;
  from: Point;
  to: Point;
  color: string;
  size: number;
};

type ImageAddPayload = {
  id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl: string;
};

type ImageTransformPayload = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type FileAddPayload = {
  id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  path: string;
  size: number;
  mime: string;
  expanded?: boolean;
};

type FileTransformPayload = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  expanded?: boolean;
};

type FileRemovePayload = {
  id: string;
};

type PlacedFile = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  path: string;
  size: number;
  mime: string;
  expanded?: boolean;
};

const MIN_FILE_CARD_W = 160;
const MIN_FILE_CARD_H = 56;
const DEFAULT_FILE_CARD_W = 240;
const DEFAULT_FILE_CARD_H = 72;
const FILE_CARD_HEADER_H = 36;
const FILE_SCROLL_BAR_H = 16;

type PlacedImage = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl: string;
  aspect: number;
  committed: boolean;
};

type ImageResizeHandle = 'nw' | 'ne' | 'sw' | 'se';

function resizePlacedImage(img: PlacedImage, handle: ImageResizeHandle, p: Point): PlacedImage {
  const aspect = img.aspect || img.width / Math.max(img.height, 1);
  const right = img.x + img.width;
  const bottom = img.y + img.height;
  let x = img.x;
  let y = img.y;
  let w = img.width;
  let h = img.height;

  if (handle === 'se') {
    w = Math.max(MIN_IMAGE_DRAW_SIZE, p.x - img.x);
    h = w / aspect;
  } else if (handle === 'ne') {
    w = Math.max(MIN_IMAGE_DRAW_SIZE, p.x - img.x);
    h = w / aspect;
    y = bottom - h;
  } else if (handle === 'sw') {
    w = Math.max(MIN_IMAGE_DRAW_SIZE, right - p.x);
    h = w / aspect;
    x = right - w;
  } else {
    w = Math.max(MIN_IMAGE_DRAW_SIZE, right - p.x);
    h = w / aspect;
    x = right - w;
    y = bottom - h;
  }

  return { ...img, x, y, width: w, height: h, aspect };
}

function hitTestImage(images: PlacedImage[], p: Point): PlacedImage | null {
  for (let i = images.length - 1; i >= 0; i -= 1) {
    const im = images[i];
    if (p.x >= im.x && p.x <= im.x + im.width && p.y >= im.y && p.y <= im.y + im.height) {
      return im;
    }
  }
  return null;
}

function hitTestFile(files: PlacedFile[], p: Point): PlacedFile | null {
  for (let i = files.length - 1; i >= 0; i -= 1) {
    const f = files[i];
    if (p.x >= f.x && p.x <= f.x + f.width && p.y >= f.y && p.y <= f.y + f.height) {
      return f;
    }
  }
  return null;
}

function resizePlacedFile(file: PlacedFile, handle: ImageResizeHandle, p: Point): PlacedFile {
  const aspect = file.width / Math.max(file.height, 1);
  const right = file.x + file.width;
  const bottom = file.y + file.height;
  let x = file.x;
  let y = file.y;
  let w = file.width;
  let h = file.height;

  if (handle === 'se') {
    w = Math.max(MIN_FILE_CARD_W, p.x - file.x);
    h = Math.max(MIN_FILE_CARD_H, w / aspect);
  } else if (handle === 'ne') {
    w = Math.max(MIN_FILE_CARD_W, p.x - file.x);
    h = Math.max(MIN_FILE_CARD_H, w / aspect);
    y = bottom - h;
  } else if (handle === 'sw') {
    w = Math.max(MIN_FILE_CARD_W, right - p.x);
    h = Math.max(MIN_FILE_CARD_H, w / aspect);
    x = right - w;
  } else {
    w = Math.max(MIN_FILE_CARD_W, right - p.x);
    h = Math.max(MIN_FILE_CARD_H, w / aspect);
    x = right - w;
    y = bottom - h;
  }
  return { ...file, x, y, width: w, height: h };
}

function drawFileCard(_ctx: CanvasRenderingContext2D, _file: PlacedFile) {
  // 파일 카드는 HTML로만 그립니다. 캔버스에 칠하면 펼친 파일 위 그림이 가려집니다.
}

type TextAddPayload = {
  id?: string;
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  /** 실제 글자 크기(px). 예전 이벤트에는 없어서 size(굵기)로 환산합니다. */
  fontSize?: number;
  width?: number;
  height?: number;
};

type TextTransformPayload = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
};

type PlacedText = {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
  width: number;
  height: number;
};

/** 캔버스 위 인라인 텍스트 입력 중인 초안. size는 글자 크기(px)입니다. */
type TextDraft = {
  x: number;
  y: number;
  value: string;
  color: string;
  size: number;
  width: number;
  height: number;
};

const MIN_TEXT_SIZE = 12;
const MAX_TEXT_SIZE = 144;
const TEXT_SIZE_STEP = 4;
const DEFAULT_TEXT_SIZE = 24;
const MIN_TEXT_BOX = 40;

function defaultTextBoxSize(fontSize: number) {
  return {
    width: Math.max(160, fontSize * 6),
    height: Math.max(MIN_TEXT_BOX, fontSize * 1.4),
  };
}

/** 이미지와 같이 반대쪽 모서리를 고정한 채 박스를 늘리고, 글자 크기도 비율만큼 맞춥니다. */
function resizeTextDraft(draft: TextDraft, handle: ImageResizeHandle, p: Point): TextDraft {
  const aspect = draft.width / Math.max(draft.height, 1);
  const right = draft.x + draft.width;
  const bottom = draft.y + draft.height;
  let x = draft.x;
  let y = draft.y;
  let w = draft.width;
  let h = draft.height;

  if (handle === 'se') {
    w = Math.max(MIN_TEXT_BOX, p.x - draft.x);
    h = w / aspect;
  } else if (handle === 'ne') {
    w = Math.max(MIN_TEXT_BOX, p.x - draft.x);
    h = w / aspect;
    y = bottom - h;
  } else if (handle === 'sw') {
    w = Math.max(MIN_TEXT_BOX, right - p.x);
    h = w / aspect;
    x = right - w;
  } else {
    w = Math.max(MIN_TEXT_BOX, right - p.x);
    h = w / aspect;
    x = right - w;
    y = bottom - h;
  }

  const nextSize = Math.min(
    MAX_TEXT_SIZE,
    Math.max(MIN_TEXT_SIZE, Math.round(draft.size * (w / Math.max(draft.width, 1)))),
  );
  return { ...draft, x, y, width: w, height: h, size: nextSize };
}

function resolveTextFontSize(p: Pick<TextAddPayload, 'size' | 'fontSize'>) {
  return p.fontSize ?? textFontSize(p.size);
}

function measurePlacedText(text: string, fontSize: number, width?: number, height?: number) {
  const lines = text.split('\n');
  const longest = Math.max(1, ...lines.map((line) => line.length));
  return {
    width: width ?? Math.max(MIN_TEXT_BOX, longest * fontSize * 0.62),
    height: height ?? Math.max(MIN_TEXT_BOX, lines.length * fontSize * 1.25),
  };
}

function hitTestText(texts: PlacedText[], p: Point): PlacedText | null {
  for (let i = texts.length - 1; i >= 0; i -= 1) {
    const t = texts[i];
    if (p.x >= t.x && p.x <= t.x + t.width && p.y >= t.y && p.y <= t.y + t.height) {
      return t;
    }
  }
  return null;
}

function resizePlacedText(item: PlacedText, handle: ImageResizeHandle, p: Point): PlacedText {
  const draft = resizeTextDraft(
    {
      x: item.x,
      y: item.y,
      value: item.text,
      color: item.color,
      size: item.fontSize,
      width: item.width,
      height: item.height,
    },
    handle,
    p,
  );
  return {
    ...item,
    x: draft.x,
    y: draft.y,
    width: draft.width,
    height: draft.height,
    fontSize: draft.size,
  };
}

type StampAddPayload = {
  x: number;
  y: number;
  kind: 'rect' | 'circle' | 'triangle';
  color: string;
  size: number;
};

function isHistoryCommitEvent(type: EventType): boolean {
  return (
    type === 'stroke.end' ||
    type === 'shape.add' ||
    type === 'image.add' ||
    type === 'image.transform' ||
    type === 'text.add' ||
    type === 'text.transform' ||
    type === 'file.add' ||
    type === 'file.transform' ||
    type === 'file.remove' ||
    type === 'stamp.add' ||
    type === 'board.clear'
  );
}

// 캔버스 메인 컴포넌트입니다.
// 이 파일은 사용자가 그림을 그리거나, 보드를 선택하거나, 회의방에서 다른 사람과 같은 캔버스를 공유하는 기능을 모두 담당합니다.
// 즉, 화면 UI + 그리기 로직 + 데이터 저장/불러오기 + 회의방 동기화까지 한 파일에서 처리합니다.
const CanvasBoard = forwardRef<CanvasBoardHandle, Props>(function CanvasBoard({
  onBack,
  embedded = false,
  meetingMode = false,
  meetingHeaderExtra,
  groupId,
  groupName,
  initialBoardId,
  initialTimelapseSaveId,
  autoPlayTimelapse = false,
}, ref) {
  const isEmbedded = embedded || meetingMode;
  const isGroupCanvas = Boolean(groupId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasAreaRef = useRef<HTMLDivElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);
  const localStrokeIdRef = useRef<string | null>(null);
  const strokeStartPointRef = useRef<Point | null>(null);
  const pendingChunkRef = useRef<Point[]>([]);
  const chunkTimerRef = useRef<number | null>(null);
  const strokeWriteChainRef = useRef<Promise<void>>(Promise.resolve());
  const remoteLastPointByStrokeRef = useRef<Map<string, Point>>(new Map());
  const remotePendingAppendsRef = useRef<Map<string, Point[][]>>(new Map());
  const remotePendingEndsRef = useRef<Set<string>>(new Set());
  const replayTimerRef = useRef<number | null>(null);
  const isReplayingRef = useRef(false);
  const strokeStyleByIdRef = useRef<Map<string, { tool: StrokeTool; color: string; size: number }>>(new Map());
  const replayRafRef = useRef<number | null>(null);
  const lastReplayUiUpdateMsRef = useRef<number>(0);
  const replayEventsRef = useRef<BoardEventRow[]>([]);
  const replayAdjustedMsRef = useRef<number[]>([]);
  const replayIndexRef = useRef(0);
  const replayBoardIdRef = useRef<string>('');
  const shapeStartRef = useRef<Point | null>(null);
  const snapshotRef = useRef<ImageData | null>(null);
  const panningRef = useRef(false);
  const panAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const boardFileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingFilePointRef = useRef<Point | null>(null);
  const placedFilesRef = useRef<PlacedFile[]>([]);
  const selectedFileIdRef = useRef<string | null>(null);
  const placedFileDragRef = useRef<{
    id: string;
    mode: 'move' | ImageResizeHandle;
    startPoint: Point;
    start: PlacedFile;
  } | null>(null);
  const removePlacedFileRef = useRef<(id: string) => void>(() => {});
  const undoHistoryRef = useRef<() => void>(() => {});
  const redoHistoryRef = useRef<() => void>(() => {});
  const textInputRef = useRef<HTMLTextAreaElement | null>(null);
  const textDraftRef = useRef<TextDraft | null>(null);
  const commitTextDraftRef = useRef<(opts?: { keepTool?: boolean }) => void>(() => {});
  const startTextInViewRef = useRef<() => void>(() => {});
  const ignoreTextBlurRef = useRef(false);
  const textResizeRef = useRef<{
    handle: ImageResizeHandle;
    startPoint: Point;
    start: TextDraft;
  } | null>(null);
  const pendingImagePointRef = useRef<Point | null>(null);
  const pendingStampRef = useRef<'rect' | 'circle' | 'triangle' | null>(null);
  const actorIdRef = useRef('unknown');
  const lastInsertErrorAlertMsRef = useRef(0);
  const deepLinkHandledRef = useRef(false);
  const historyRef = useRef<ImageData[]>([]);
  const historyIndexRef = useRef(-1);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const placedImagesRef = useRef<PlacedImage[]>([]);
  const selectedImageIdRef = useRef<string | null>(null);
  const imageDragRef = useRef<{
    id: string;
    mode: 'move' | ImageResizeHandle;
    startPoint: Point;
    start: PlacedImage;
  } | null>(null);
  const placedTextsRef = useRef<PlacedText[]>([]);
  const selectedTextIdRef = useRef<string | null>(null);
  const placedTextDragRef = useRef<{
    id: string;
    mode: 'move' | ImageResizeHandle;
    startPoint: Point;
    start: PlacedText;
  } | null>(null);
  const lastSavedTitleRef = useRef<Record<string, string>>({});
  const replaySpeedRef = useRef(10);
  const compressGapsRef = useRef(true);
  const maxGapMsRef = useRef(200);
  const replayLastTickMsRef = useRef(0);
  const replayLastVirtualMsRef = useRef(0);
  const replayClockRef = useRef({ anchorVirtualMs: 0, anchorWallMs: 0, speed: 10 });

  const [tool, setTool] = useState<Tool>('pen');
  const [locked, setLocked] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [pendingStampKind, setPendingStampKind] = useState<'rect' | 'circle' | 'triangle' | null>(null);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const [placedImages, setPlacedImages] = useState<PlacedImage[]>([]);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [placedFiles, setPlacedFiles] = useState<PlacedFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [placedTexts, setPlacedTexts] = useState<PlacedText[]>([]);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [color, setColor] = useState('#111827');
  const [size, setSize] = useState(6);
  const [textSize, setTextSize] = useState(DEFAULT_TEXT_SIZE);
  const [chatOpen, setChatOpen] = useState(false);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);

  const [actorId, setActorId] = useState<string>('unknown');

  // 사용자 ID를 초기화하는 영역입니다.
  // 이 값은 나중에 어떤 사람이 그린 선인지 구분할 때 사용됩니다.
  // 로그인되어 있으면 계정 ID를 쓰고, 없으면 브라우저에 저장된 값이나 임시 ID를 사용합니다.
  useEffect(() => {
    actorIdRef.current = actorId;
  }, [actorId]);

  const [boards, setBoards] = useState<Board[]>([]);
  const [boardId, setBoardId] = useState<string>(initialBoardId ?? '');
  const [boardTitle, setBoardTitle] = useState<string>('새 보드');
  const [isLoadingBoards, setIsLoadingBoards] = useState(false);
  const [, setIsLoadingBoard] = useState(false);

  // 아래부터는 회의방 전용 상태와 보드 선택 로직입니다.
  // 회의 모드일 때는 첫 참가자에게 새 보드를 만들지, 기존 보드를 불러올지 선택하게 합니다.
  // 이 과정은 같은 회의방의 다른 사람들과 보드 상태를 맞추기 위해 필요합니다.
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const [showInitChoice, setShowInitChoice] = useState(false);
  const initChoiceHandledRef = useRef(false);
  const latestBoardSelectionRef = useRef<MeetingBoardMessage | null>(null);

  const publishBoardSelection = (payload: MeetingBoardMessage) => {
    if (!localParticipant) return;
    void localParticipant.publishData(encodeMeetingBoardMessage(payload), {
      reliable: true,
      topic: MEETING_BOARD_TOPIC,
    });
    void localParticipant.setMetadata(JSON.stringify(payload)).catch((err) => {
      console.warn('LiveKit metadata update failed:', err);
    });
  };

  // 회의방 접속 상태를 확인해서, 첫 참가자일 때만 초기 선택창을 띄웁니다.
  // 방에 아무도 없던 시점에 첫 사람이 들어오면 이 모달이 보이고,
  // 이후 참가자들은 이미 선택된 보드를 따라가게 됩니다.
  useEffect(() => {
    if (!room) return;

    const ensureInitChoice = () => {
      if (!meetingMode || room.state !== 'connected') return;
      if (room.remoteParticipants.size !== 0 || initChoiceHandledRef.current) return;
      setShowInitChoice(true);
    };

    if (room.state !== 'connected') {
      initChoiceHandledRef.current = false;
    }

    ensureInitChoice();

    const onStateChange = () => {
      ensureInitChoice();
    };

    room.on(RoomEvent.ConnectionStateChanged, onStateChange);
    return () => {
      room.off(RoomEvent.ConnectionStateChanged, onStateChange);
    };
  }, [room, room?.state, room?.remoteParticipants.size, meetingMode]);

  useEffect(() => {
    if (!showInitChoice) return;
    clearAllLocal();
    setBoardId('');
    setBoardTitle('새 보드');
  }, [showInitChoice]);

  // LiveKit으로 보드 선택 정보를 주고받는 영역입니다.
  // 다른 참가자에게 현재 선택된 보드를 알려주고, 누가 새로 들어오거나 다시 들어와도
  // 같은 보드를 보도록 상태를 맞춰줍니다.
  useEffect(() => {
    if (!room) return;
    if (!meetingMode) return;

    const applyBoardSelection = (msg: MeetingBoardMessage) => {
      if (!msg.boardId) return;
      setShowInitChoice(false);
      initChoiceHandledRef.current = true;
      setBoardId(msg.boardId);
      if (msg.title) setBoardTitle(msg.title);
      latestBoardSelectionRef.current = msg;
      publishBoardSelection(msg);
    };

    const handler = (payload: Uint8Array, participant?: unknown, _kind?: unknown, topic?: string) => {
      if (topic && topic !== MEETING_BOARD_TOPIC) return;
      const msg = decodeMeetingBoardMessage(payload);
      if (!msg) return;
      if (participant && 'identity' in (participant as any) && (participant as any).identity === localParticipant.identity) {
        return;
      }
      applyBoardSelection(msg);
    };

    const participantMetadataHandler = (metadata: string | undefined, participant?: unknown) => {
      if (!participant || !room) return;
      if (!('identity' in (participant as any))) return;
      const remote = participant as { identity: string; metadata?: string };
      if (remote.identity === localParticipant.identity) return;
      const msg = decodeMeetingBoardMetadata(metadata);
      if (!msg) return;
      applyBoardSelection(msg);
    };

    const syncFromExistingParticipants = () => {
      for (const participant of room.remoteParticipants.values()) {
        const msg = decodeMeetingBoardMetadata(participant.metadata);
        if (msg) {
          applyBoardSelection(msg);
          return;
        }
      }
    };

    const publishCurrentBoardSelection = () => {
      const payload = latestBoardSelectionRef.current;
      if (payload) publishBoardSelection(payload);
    };

    const onParticipantConnected = (participant: unknown) => {
      if (!localParticipant) return;
      if (!participant || !('identity' in (participant as any))) return;
      const remote = participant as { identity: string };
      if (remote.identity === localParticipant.identity) return;
      publishCurrentBoardSelection();
    };

    syncFromExistingParticipants();
    room.on(RoomEvent.DataReceived, handler);
    room.on(RoomEvent.ParticipantMetadataChanged, participantMetadataHandler);
    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    return () => {
      room.off(RoomEvent.DataReceived, handler);
      room.off(RoomEvent.ParticipantMetadataChanged, participantMetadataHandler);
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
    };
  }, [room, meetingMode, localParticipant.identity]);

  // 초기 선택창에서 '새 보드 생성'을 눌렀을 때 실행되는 함수입니다.
  // 새 보드를 데이터베이스에 만들고, 그 보드 ID를 현재 캔버스에 연결합니다.
  const handleCreateNewBoardChoice = async () => {
    setShowInitChoice(false);
    initChoiceHandledRef.current = true;
    try {
      const title = isGroupCanvas ? `${GROUP_BOARD_TITLE_PREFIX}${groupId ?? ''}${Date.now()}` : '새 보드';
      const { data, error } = await supabase.from('boards').insert([{ title }]).select().limit(1).single();
      if (error) throw error;
      if (data && data.id) {
        const board = data as Board;
        const title = board.title ?? '새 보드';
        setBoards((prev) => [board, ...prev]);
        setBoardId(board.id);
        setBoardTitle(title);
        if (localParticipant) {
          const payload: MeetingBoardMessage = {
            type: 'board:selected',
            boardId: board.id,
            title,
            from: localParticipant.identity,
          };
          latestBoardSelectionRef.current = payload;
          publishBoardSelection(payload);
        }
      }
    } catch (e) {
      console.error('failed to create board on choice', e);
      // 대체로 기존 createBoard 흐름을 호출합니다. 이때 인증 요청이 나올 수 있습니다.
      try {
        await createBoard();
      } catch {
        // 무시합니다.
      }
    }
  };

  // 초기 선택창에서 '기존 보드 불러오기'를 눌렀을 때 실행되는 함수입니다.
  // 이미 저장된 보드 중 가장 최근 보드를 찾아서 현재 캔버스에 연결합니다.
  const handleUseExistingBoardChoice = async () => {
    setShowInitChoice(false);
    initChoiceHandledRef.current = true;
    try {
      const { data, error } = await supabase.from('boards').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (!error && data && data.id) {
        const board = data as Board;
        const title = board.title ?? '보드';
        setBoardId(board.id);
        setBoardTitle(title);
        if (localParticipant) {
          const payload: MeetingBoardMessage = {
            type: 'board:selected',
            boardId: board.id,
            title,
            from: localParticipant.identity,
          };
          latestBoardSelectionRef.current = payload;
          publishBoardSelection(payload);
        }
      }
    } catch (e) {
      console.error('failed to load existing board on choice', e);
    }
  };

  const [, setIsReplaying] = useState(false);
  const [replaySpeed] = useState(10);
  const [compressGaps] = useState(true);
  const [maxGapMs] = useState(200);
  // const [timelapseSaveDraft, setTimelapseSaveDraft] = useState('');
  // const [isSavingTimelapse, setIsSavingTimelapse] = useState(false);
  const [replaySession, setReplaySession] = useState<{
    total: number;
    index: number;
    startTs?: string;
    endTs?: string;
    durationMs: number;
  } | null>(null);

  const effectiveStrokeStyle = useMemo(() => {
    return tool === 'eraser' ? '#ffffff' : color;
  }, [tool, color]);

  const activeTool = spacePressed ? 'hand' : tool;
  const zoomScale = ZOOM_STEPS[zoomIndex];
  const zoomPercent = Math.round(zoomScale * 100);
  const isShapeTool = (t: Tool): t is ShapeTool =>
    t === 'rectangle' || t === 'diamond' || t === 'ellipse' || t === 'arrow' || t === 'line';

  // 이 도구들은 펼친 파일 위를 통과해서 캔버스에 그립니다. 손 도구는 파일 스크롤을 남깁니다.
  const drawThroughFile = isShapeTool(activeTool) || activeTool === 'pen' || activeTool === 'eraser' || activeTool === 'text' || Boolean(pendingStampKind);

  useEffect(() => {
    if (!drawThroughFile) return;
    document.querySelectorAll('iframe').forEach((frame) => frame.blur());
    canvasRef.current?.focus({ preventScroll: true });
  }, [drawThroughFile]);

  const pickTool = (next: ExcalidrawTool) => {
    // A(텍스트)는 고르는 즉시 입력칸을 엽니다. 다른 도구로 바꿀 때만 초안을 확정합니다.
    if (next !== 'text') {
      commitTextDraftRef.current({ keepTool: true });
    }
    if (next !== 'image') {
      void commitUncommittedImage();
      selectPlacedImage(null);
    }
    if (next !== 'hand' && tool === 'hand') {
      setPanOffset({ x: 0, y: 0 });
    }
    setTool(next);
    if (next === 'text') {
      startTextInViewRef.current();
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 인라인 텍스트/입력칸에 타이핑 중이면 스페이스·단축키를 가로채지 않습니다.
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        setSpacePressed(true);
      }
      // 한글 입력기에서는 e.key 가 z 가 아닐 수 있어 code 로 받습니다.
      const isZ = e.code === 'KeyZ' || e.key.toLowerCase() === 'z';
      const isY = e.code === 'KeyY' || e.key.toLowerCase() === 'y';
      if ((e.ctrlKey || e.metaKey) && isZ && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        undoHistoryRef.current();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (isY || (isZ && e.shiftKey))) {
        e.preventDefault();
        e.stopPropagation();
        redoHistoryRef.current();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedFileIdRef.current) {
        e.preventDefault();
        removePlacedFileRef.current(selectedFileIdRef.current);
        return;
      }
      const mapped = toolShortcutMap[e.key];
      if (mapped) pickTool(mapped);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePressed(false);
    };
    // capture: PDF iframe 보다 먼저 단축키를 받습니다. iframe 안 키는 여전히 못 받으므로 포커스를 보드로 되돌립니다.
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, []);

  const ensureContext = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return null;
    ctxRef.current = ctx;
    return ctx;
  };

  const resizeCanvasIfNeeded = () => {
    const canvas = canvasRef.current;
    const area = canvasAreaRef.current;
    if (!canvas || !area) return;

    const rect = area.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const nextWidth = Math.max(1, Math.floor(rect.width));
    const nextHeight = Math.max(1, Math.floor(rect.height));

    const wantW = Math.floor(nextWidth * dpr);
    const wantH = Math.floor(nextHeight * dpr);

    if (canvas.width === wantW && canvas.height === wantH) return;

    // 리사이즈 시 기존 그림을 유지합니다.
    const prev = document.createElement('canvas');
    prev.width = canvas.width;
    prev.height = canvas.height;
    const prevCtx = prev.getContext('2d');
    if (prevCtx) prevCtx.drawImage(canvas, 0, 0);

    canvas.width = wantW;
    canvas.height = wantH;
    canvas.style.width = `${nextWidth}px`;
    canvas.style.height = `${nextHeight}px`;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;
    ctxRef.current = ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    // 배경은 보드 영역(#fff)과 펼친 파일이 비치도록 투명하게 둡니다.
    ctx.clearRect(0, 0, nextWidth, nextHeight);

    // 기존 내용을 최대한 복원합니다.
    if (prev.width > 0 && prev.height > 0) {
      const prevCssW = prev.width / dpr;
      const prevCssH = prev.height / dpr;
      ctx.drawImage(prev, 0, 0, prev.width, prev.height, 0, 0, prevCssW, prevCssH);
    }

    revealExpandedFilesOnCanvas();
    initHistory();
  };

  const captureCanvasState = (): ImageData | null => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current ?? ensureContext();
    if (!canvas || !ctx || canvas.width === 0 || canvas.height === 0) return null;
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  };

  const applyCanvasState = (data: ImageData) => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current ?? ensureContext();
    if (!canvas || !ctx) return;
    ctx.putImageData(data, 0, 0);
    revealExpandedFilesOnCanvas();
  };

  /** 펼친 파일 자리의 흰 배경만 지워, 파일 내용이 비치고 그 위에 획이 올라가게 합니다. */
  const revealExpandedFilesOnCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current ?? ensureContext();
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    for (const file of placedFilesRef.current) {
      if (!file.expanded) continue;
      const x = Math.max(0, Math.floor(file.x * dpr));
      const y = Math.max(0, Math.floor((file.y + FILE_CARD_HEADER_H) * dpr));
      const w = Math.min(canvas.width - x, Math.floor(file.width * dpr));
      const h = Math.min(
        canvas.height - y,
        Math.floor((file.height - FILE_CARD_HEADER_H - FILE_SCROLL_BAR_H) * dpr),
      );
      if (w <= 0 || h <= 0) continue;
      let data: ImageData;
      try {
        data = ctx.getImageData(x, y, w, h);
      } catch {
        continue;
      }
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] >= 240 && px[i + 1] >= 240 && px[i + 2] >= 240) px[i + 3] = 0;
      }
      ctx.putImageData(data, x, y);
    }
  };

  useEffect(() => {
    if (placedFiles.some((file) => file.expanded)) revealExpandedFilesOnCanvas();
  }, [placedFiles]);

  const syncHistoryUi = () => {
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(historyIndexRef.current >= 0 && historyIndexRef.current < historyRef.current.length - 1);
  };

  const resetHistory = () => {
    historyRef.current = [];
    historyIndexRef.current = -1;
    syncHistoryUi();
  };

  const initHistory = () => {
    const snap = captureCanvasState();
    if (!snap) {
      resetHistory();
      return;
    }
    historyRef.current = [snap];
    historyIndexRef.current = 0;
    syncHistoryUi();
  };

  const commitHistory = () => {
    const snap = captureCanvasState();
    if (!snap) return;

    const idx = historyIndexRef.current;
    if (idx >= 0) {
      historyRef.current = historyRef.current.slice(0, idx + 1);
    }

    historyRef.current.push(snap);
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift();
    } else {
      historyIndexRef.current += 1;
    }
    syncHistoryUi();
  };

  const undoHistory = () => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    const state = historyRef.current[historyIndexRef.current];
    if (state) applyCanvasState(state);
    syncHistoryUi();
  };

  const redoHistory = () => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    const state = historyRef.current[historyIndexRef.current];
    if (state) applyCanvasState(state);
    syncHistoryUi();
  };
  undoHistoryRef.current = undoHistory;
  redoHistoryRef.current = redoHistory;

  const zoomOut = () => {
    setZoomIndex((i) => Math.max(0, i - 1));
  };

  const zoomIn = () => {
    setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1));
  };

  useEffect(() => {
    const runResize = () => {
      requestAnimationFrame(() => resizeCanvasIfNeeded());
    };

    runResize();

    const onResize = () => runResize();
    window.addEventListener('resize', onResize);

    const area = canvasAreaRef.current;
    const observer = area ? new ResizeObserver(() => runResize()) : null;
    if (area && observer) observer.observe(area);

    return () => {
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => resizeCanvasIfNeeded());
  }, [replaySession]);

  useEffect(() => {
    // actorId: 로그인한 사용자가 있으면 user.id를 사용하고, 없으면 브라우저 세션 ID를 사용합니다.
    let isMounted = true;
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!isMounted) return;
        const uid = data.user?.id;
        if (uid) {
          setActorId(uid);
          return;
        }
        const key = 'wb_actor_id';
        const existing = localStorage.getItem(key);
        if (existing) {
          setActorId(existing);
        } else {
          const rnd = crypto.randomUUID();
          localStorage.setItem(key, rnd);
          setActorId(rnd);
        }
      })
      .catch(() => {
        // ignore
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const formatBoardTitle = (title: string) => {
    if (title.startsWith(GROUP_BOARD_TITLE_PREFIX)) {
      return `${groupName || '그룹'} 캔버스`;
    }
    return title;
  };

  const fetchGroupBoards = async (targetGroupId: string): Promise<Board[]> => {
    const { data: byGroupId, error: groupColError } = await supabase
      .from('boards')
      .select('id,title,created_at')
      .eq('group_id', targetGroupId)
      .order('created_at', { ascending: false });

    if (!groupColError && byGroupId?.length) {
      return byGroupId as Board[];
    }

    const { data: byTitle } = await supabase
      .from('boards')
      .select('id,title,created_at')
      .eq('title', `${GROUP_BOARD_TITLE_PREFIX}${targetGroupId}`)
      .order('created_at', { ascending: false });

    return (byTitle as Board[] | null) ?? [];
  };

  const loadGroupBoards = async () => {
    if (!groupId) return;

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      alert('보드를 사용하려면 로그인이 필요합니다.');
      return;
    }

    setIsLoadingBoards(true);
    let list = await fetchGroupBoards(groupId);

    if (list.length === 0) {
      const defaultTitle = `${groupName || '그룹'} 캔버스`;
      const insertPayload: { title: string; group_id?: string } = {
        title: defaultTitle,
        group_id: groupId,
      };
      let { data, error } = await supabase
        .from('boards')
        .insert(insertPayload)
        .select('id,title,created_at')
        .single();

      if (error?.message?.includes('group_id')) {
        ({ data, error } = await supabase
          .from('boards')
          .insert({ title: `${GROUP_BOARD_TITLE_PREFIX}${groupId}` })
          .select('id,title,created_at')
          .single());
      }

      if (error || !data) {
        setIsLoadingBoards(false);
        alert(`그룹 캔버스 생성 실패: ${explainBoardError(error?.message ?? 'unknown')}`);
        return;
      }
      list = [data as Board];
    }

    const deduped = dedupeBoardsById(list);
    setBoards(deduped);
    const preferredId = boardId || initialBoardId;
    const selected = deduped.find((b) => b.id === preferredId) ?? deduped[0];
    if (selected) {
      const title = formatBoardTitle(selected.title);
      setBoardId(selected.id);
      setBoardTitle(title);
      lastSavedTitleRef.current[selected.id] = title;
    }
    setIsLoadingBoards(false);
  };

  const loadBoards = async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      alert('보드 목록을 불러오려면 로그인이 필요합니다.');
      return;
    }

    setIsLoadingBoards(true);
    const { data, error } = await supabase.from('boards').select('id,title,created_at').order('created_at', { ascending: false });
    setIsLoadingBoards(false);
    if (error) {
      console.error('loadBoards error:', error);
      alert(`보드 목록 로드 실패: ${explainBoardError(error.message)}`);
      return;
    }
    const list = dedupeBoardsById((data ?? []) as Board[]);
    setBoards(list);
    const preferredId = boardId || initialBoardId;
    if (preferredId) {
      const selected = list.find((b) => b.id === preferredId);
      if (selected) {
        setBoardId(selected.id);
        setBoardTitle(selected.title);
      }
    }
  };

  useEffect(() => {
    if (isGroupCanvas) {
      void loadGroupBoards();
    } else {
      loadBoards();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, groupName]);

  const createBoard = async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      alert('보드를 만들려면 로그인이 필요합니다.\n메인에서 로그인한 뒤 캔버스로 다시 들어와 주세요.');
      return;
    }

    const title = boardTitle.trim() || (isGroupCanvas ? `${groupName || '그룹'} 보드` : '새 보드');
    const insertPayload: { title: string; group_id?: string } = { title };
    if (isGroupCanvas && groupId) insertPayload.group_id = groupId;

    let { data, error } = await supabase.from('boards').insert(insertPayload).select('id,title,created_at').single();
    if (error?.message?.includes('group_id') && isGroupCanvas && groupId) {
      ({ data, error } = await supabase
        .from('boards')
        .insert({ title: `${GROUP_BOARD_TITLE_PREFIX}${groupId}-${Date.now()}` })
        .select('id,title,created_at')
        .single());
    }

    if (error) {
      alert(`보드 생성 실패: ${explainBoardError(error.message)}`);
      return;
    }
    const b = data as Board;
    const savedTitle = formatBoardTitle(b.title);
    setBoards((prev) => [b, ...prev]);
    setBoardId(b.id);
    setBoardTitle(savedTitle);
    lastSavedTitleRef.current[b.id] = savedTitle;
  };

  const saveBoardTitle = async () => {
    if (!boardId) return;
    const title = boardTitle.trim() || '새 보드';
    if (lastSavedTitleRef.current[boardId] === title) return;

    const { error } = await supabase.from('boards').update({ title }).eq('id', boardId);
    if (error) {
      alert(`보드 이름 저장 실패: ${explainBoardError(error.message)}`);
      return;
    }
    lastSavedTitleRef.current[boardId] = title;
    setBoards((prev) => prev.map((b) => (b.id === boardId ? { ...b, title } : b)));
  };

  const refreshBoards = () => {
    if (isGroupCanvas) void loadGroupBoards();
    else void loadBoards();
  };

  const applyStrokeSegment = (p1: Point, p2: Point, strokeTool: StrokeTool, strokeColor: string, strokeSize: number) => {
    const ctx = ctxRef.current ?? ensureContext();
    if (!ctx) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 지우개는 흰 칠 대신 픽셀을 지워, 펼친 파일이 다시 보이게 합니다.
    ctx.globalCompositeOperation = strokeTool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = strokeTool === 'eraser' ? '#000000' : strokeColor;
    ctx.lineWidth = strokeSize;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.restore();
  };

  const applyStrokeDot = (p: Point, strokeTool: StrokeTool, strokeColor: string, strokeSize: number) => {
    const ctx = ctxRef.current ?? ensureContext();
    if (!ctx) return;
    ctx.save();
    ctx.globalCompositeOperation = strokeTool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.fillStyle = strokeTool === 'eraser' ? '#000000' : strokeColor;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(strokeSize / 2, 1), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  const applyStrokeAppendPoints = (strokeId: string, points: Point[]) => {
    const last = remoteLastPointByStrokeRef.current.get(strokeId);
    if (!last) return false;
    const style = strokeStyleByIdRef.current.get(strokeId);
    if (!style) return false;
    for (const next of points) {
      if (last.x === next.x && last.y === next.y) {
        applyStrokeDot(next, style.tool, style.color, style.size);
      } else {
        applyStrokeSegment(last, next, style.tool, style.color, style.size);
      }
      last.x = next.x;
      last.y = next.y;
    }
    return true;
  };

  const flushRemotePendingStroke = (strokeId: string) => {
    const pending = remotePendingAppendsRef.current.get(strokeId);
    if (pending) {
      remotePendingAppendsRef.current.delete(strokeId);
      for (const points of pending) {
        applyStrokeAppendPoints(strokeId, points);
      }
    }
    if (remotePendingEndsRef.current.has(strokeId)) {
      remotePendingEndsRef.current.delete(strokeId);
      remoteLastPointByStrokeRef.current.delete(strokeId);
      strokeStyleByIdRef.current.delete(strokeId);
    }
  };

  const clearAllLocal = () => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current ?? ensureContext();
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    replacePlacedImages([]);
    selectPlacedImage(null);
    imageDragRef.current = null;
    replacePlacedTexts([]);
    selectPlacedText(null);
    placedTextDragRef.current = null;
    replacePlacedFiles([]);
    selectPlacedFile(null);
    placedFileDragRef.current = null;
  };

  const loadCachedImage = (dataUrl: string): Promise<HTMLImageElement> => {
    const cached = imageCacheRef.current.get(dataUrl);
    if (cached) return Promise.resolve(cached);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        imageCacheRef.current.set(dataUrl, img);
        resolve(img);
      };
      img.onerror = () => reject(new Error('이미지 로드 실패'));
      img.src = dataUrl;
    });
  };

  const drawImagePayload = async (ctx: CanvasRenderingContext2D, payload: ImageAddPayload) => {
    const img = await loadCachedImage(payload.dataUrl);
    ctx.drawImage(img, payload.x, payload.y, payload.width, payload.height);
  };

  const reportInsertError = (message: string) => {
    console.warn('board_events insert failed:', message);
    const now = Date.now();
    if (now - lastInsertErrorAlertMsRef.current < 8000) return;
    lastInsertErrorAlertMsRef.current = now;
    alert(
      `이벤트 저장 실패: ${message}\n\n그림은 이 기기에서 계속 그릴 수 있어요. 로그인 상태와 Supabase RLS(board_events, board_seq) 설정을 확인해 주세요.`,
    );
  };

  const insertEvent = async (type: EventType, payload: unknown) => {
    if (!boardId) return;
    const { error } = await supabase.from('board_events').insert({
      board_id: boardId,
      actor_id: actorIdRef.current,
      type,
      payload,
    });
    if (error) reportInsertError(error.message);
  };

  const selectPlacedImage = (id: string | null) => {
    selectedImageIdRef.current = id;
    setSelectedImageId(id);
  };

  const replacePlacedImages = (next: PlacedImage[]) => {
    placedImagesRef.current = next;
    setPlacedImages(next);
  };

  const upsertPlacedImage = (img: PlacedImage) => {
    const next = placedImagesRef.current.filter((x) => x.id !== img.id);
    next.push(img);
    replacePlacedImages(next);
  };

  // 아직 캔버스에 확정하지 않은 이미지는 모서리 조절 후 여기서 그립니다.
  const commitUncommittedImage = async () => {
    const img = placedImagesRef.current.find((x) => x.id === selectedImageIdRef.current && !x.committed);
    if (!img) {
      selectPlacedImage(null);
      return;
    }
    const ctx = ctxRef.current ?? ensureContext();
    if (!ctx) return;
    await drawImagePayload(ctx, {
      id: img.id,
      x: img.x,
      y: img.y,
      width: img.width,
      height: img.height,
      dataUrl: img.dataUrl,
    });
    upsertPlacedImage({ ...img, committed: true });
    void insertEvent('image.add', {
      id: img.id,
      x: img.x,
      y: img.y,
      width: img.width,
      height: img.height,
      dataUrl: img.dataUrl,
    } satisfies ImageAddPayload);
    commitHistory();
    selectPlacedImage(img.id);
  };

  const persistImageTransform = (img: PlacedImage) => {
    void insertEvent('image.transform', {
      id: img.id,
      x: img.x,
      y: img.y,
      width: img.width,
      height: img.height,
    } satisfies ImageTransformPayload);
  };

  const selectPlacedFile = (id: string | null) => {
    selectedFileIdRef.current = id;
    setSelectedFileId(id);
  };

  const replacePlacedFiles = (next: PlacedFile[]) => {
    placedFilesRef.current = next;
    setPlacedFiles(next);
  };

  const upsertPlacedFile = (item: PlacedFile) => {
    const next = placedFilesRef.current.filter((x) => x.id !== item.id);
    next.push(item);
    replacePlacedFiles(next);
  };

  const persistFileTransform = (item: PlacedFile) => {
    return insertEvent('file.transform', {
      id: item.id,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      expanded: Boolean(item.expanded),
    } satisfies FileTransformPayload);
  };

  const togglePlacedFileExpanded = (id: string) => {
    const item = placedFilesRef.current.find((x) => x.id === id);
    if (!item) return;
    const nextExpanded = !item.expanded;
    const size = nextExpanded
      ? expandedFileSize(getFilePreviewKind(item.name, item.mime))
      : { width: DEFAULT_FILE_CARD_W, height: DEFAULT_FILE_CARD_H };
    const next: PlacedFile = {
      ...item,
      expanded: nextExpanded,
      width: nextExpanded ? Math.max(item.width, size.width) : size.width,
      height: nextExpanded ? Math.max(item.height, size.height) : size.height,
    };
    upsertPlacedFile(next);
    if (next.expanded) revealExpandedFilesOnCanvas();
    // 미리보기가 바로 뜨도록 보드 전체를 다시 그리지 않고 크기만 저장합니다.
    void persistFileTransform(next);
  };

  const persistAndReloadFile = (item: PlacedFile) => {
    void persistFileTransform(item).then(() => {
      if (boardId) return loadAndRenderBoard(boardId);
    }).then(() => selectPlacedFile(item.id));
  };

  const removePlacedFile = (id: string) => {
    const exists = placedFilesRef.current.some((x) => x.id === id);
    if (!exists) return;
    replacePlacedFiles(placedFilesRef.current.filter((x) => x.id !== id));
    if (selectedFileIdRef.current === id) selectPlacedFile(null);
    void insertEvent('file.remove', { id } satisfies FileRemovePayload).then(() => {
      if (boardId) return loadAndRenderBoard(boardId);
    });
  };
  removePlacedFileRef.current = removePlacedFile;

  const selectPlacedText = (id: string | null) => {
    selectedTextIdRef.current = id;
    setSelectedTextId(id);
  };

  const replacePlacedTexts = (next: PlacedText[]) => {
    placedTextsRef.current = next;
    setPlacedTexts(next);
  };

  const upsertPlacedText = (item: PlacedText) => {
    const next = placedTextsRef.current.filter((x) => x.id !== item.id);
    next.push(item);
    replacePlacedTexts(next);
  };

  const persistTextTransform = (item: PlacedText) => {
    return insertEvent('text.transform', {
      id: item.id,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      fontSize: item.fontSize,
    } satisfies TextTransformPayload);
  };

  const persistAndReloadText = (item: PlacedText) => {
    void persistTextTransform(item).then(() => {
      if (boardId) return loadAndRenderBoard(boardId);
    }).then(() => selectPlacedText(item.id));
  };

  const enqueueStrokeWrite = (type: EventType, payload: unknown): Promise<void> => {
    const task = strokeWriteChainRef.current.then(() => insertEvent(type, payload));
    strokeWriteChainRef.current = task.catch(() => {});
    return task;
  };

  const flushChunk = async () => {
    if (!localStrokeIdRef.current) return;
    const points = pendingChunkRef.current;
    if (points.length === 0) return;
    pendingChunkRef.current = [];
    await enqueueStrokeWrite('stroke.append', {
      strokeId: localStrokeIdRef.current,
      points,
    } satisfies StrokeAppendPayload);
  };

  const scheduleChunkFlush = () => {
    if (chunkTimerRef.current != null) return;
    chunkTimerRef.current = window.setTimeout(async () => {
      chunkTimerRef.current = null;
      await flushChunk();
    }, 40);
  };

  const stopReplay = () => {
    if (replayTimerRef.current != null) {
      window.clearTimeout(replayTimerRef.current);
      replayTimerRef.current = null;
    }
    if (replayRafRef.current != null) {
      cancelAnimationFrame(replayRafRef.current);
      replayRafRef.current = null;
    }
    isReplayingRef.current = false;
    setIsReplaying(false);
  };

  const getReplayVirtualMs = () => {
    const clock = replayClockRef.current;
    return clock.anchorVirtualMs + (performance.now() - clock.anchorWallMs) * clock.speed;
  };

  const armReplayClock = (virtualMs: number) => {
    replayClockRef.current = {
      anchorVirtualMs: virtualMs,
      anchorWallMs: performance.now(),
      speed: replaySpeedRef.current,
    };
    replayLastVirtualMsRef.current = virtualMs;
    replayLastTickMsRef.current = performance.now();
  };

  const buildAdjustedMs = (events: BoardEventRow[]) => {
    const adjustedMs: number[] = new Array(events.length);
    adjustedMs[0] = 0;
    const gapCompress = compressGapsRef.current;
    const gapMax = maxGapMsRef.current;

    for (let k = 1; k < events.length; k += 1) {
      const prev = new Date(events[k - 1].ts).getTime();
      const cur = new Date(events[k].ts).getTime();
      let delta = Math.max(0, cur - prev);

      // DB 타임스탬프가 같으면 delta=0 → 한 프레임에 몰림. stroke 간격을 추정해 보정.
      if (delta === 0) {
        const type = events[k].type;
        if (type === 'stroke.append' || type === 'stroke.end') {
          delta = STROKE_CHUNK_MS;
        } else {
          delta = MIN_EVENT_GAP_MS;
        }
      }

      if (gapCompress) delta = Math.min(delta, Math.max(0, gapMax));
      adjustedMs[k] = adjustedMs[k - 1] + delta;
    }
    return adjustedMs;
  };

  const primeEventStyle = (ev: BoardEventRow) => {
    if (ev.type !== 'stroke.begin') return;
    const p = ev.payload as StrokeBeginPayload;
    strokeStyleByIdRef.current.set(p.strokeId, { tool: p.tool, color: p.color, size: p.size });
  };

  const clearReplaySession = () => {
    stopReplay();
    replayEventsRef.current = [];
    replayAdjustedMsRef.current = [];
    replayIndexRef.current = 0;
    replayBoardIdRef.current = '';
    setReplaySession(null);
  };

  const prepareReplaySession = async (targetBoardId: string, maxSeq?: number) => {
    let query = supabase
      .from('board_events')
      .select('id,board_id,seq,ts,actor_id,type,payload')
      .eq('board_id', targetBoardId)
      .order('seq', { ascending: true });

    if (maxSeq != null) {
      query = query.lte('seq', maxSeq);
    }

    const { data, error } = await query;

    if (error) {
      alert(`타임랩스 로드 실패: ${error.message}`);
      return false;
    }

    const events = (data ?? []) as BoardEventRow[];
    if (events.length === 0) {
      alert(maxSeq != null ? '저장된 카테고리에 재생할 기록이 없어요.' : '이 보드에는 아직 기록(이벤트)이 없어요. 먼저 한 번 그려보세요.');
      return false;
    }

    const adjustedMs = buildAdjustedMs(events);
    replayEventsRef.current = events;
    replayAdjustedMsRef.current = adjustedMs;
    replayIndexRef.current = 0;
    replayBoardIdRef.current = targetBoardId;

    setReplaySession({
      total: events.length,
      index: 0,
      startTs: events[0].ts,
      endTs: events[events.length - 1].ts,
      durationMs: adjustedMs[adjustedMs.length - 1] ?? 0,
    });

    clearAllLocal();
    remoteLastPointByStrokeRef.current = new Map();
    strokeStyleByIdRef.current = new Map();
    return true;
  };

  const seekReplay = async (index: number) => {
    const events = replayEventsRef.current;
    if (events.length === 0) return;

    stopReplay();
    const clamped = Math.max(0, Math.min(events.length, Math.floor(index)));

    clearAllLocal();
    remoteLastPointByStrokeRef.current = new Map();
    strokeStyleByIdRef.current = new Map();

    for (let k = 0; k < clamped; k += 1) {
      primeEventStyle(events[k]);
      await applyEvent(events[k]);
    }

    replayIndexRef.current = clamped;
    setReplaySession((prev) => (prev ? { ...prev, index: clamped } : prev));
  };

  const startReplay = () => {
    const events = replayEventsRef.current;
    if (events.length === 0) return;

    stopReplay();
    isReplayingRef.current = true;
    setIsReplaying(true);

    let i = replayIndexRef.current;
    const adjustedMs = replayAdjustedMsRef.current;
    armReplayClock(adjustedMs[i] ?? 0);

    const tick = () => {
      if (!isReplayingRef.current) return;
      const now = performance.now();
      const speed = replaySpeedRef.current;
      const timeline = replayAdjustedMsRef.current;
      const virtualMs = getReplayVirtualMs();

      const virtualDelta = Math.max(1, virtualMs - replayLastVirtualMsRef.current);
      replayLastVirtualMsRef.current = virtualMs;
      const maxPerFrame =
        speed <= 1
          ? Math.max(4, Math.ceil(virtualDelta / STROKE_CHUNK_MS) + 2)
          : Math.min(400, Math.max(20, Math.ceil(virtualDelta / 8)));

      let processed = 0;
      while (i < events.length) {
        const at = timeline[i];
        if (at == null || at > virtualMs) break;
        primeEventStyle(events[i]);
        void applyEvent(events[i]);
        i += 1;
        processed += 1;
        if (processed >= maxPerFrame) break;
      }

      replayIndexRef.current = i;

      if (now - lastReplayUiUpdateMsRef.current >= 100) {
        lastReplayUiUpdateMsRef.current = now;
        setReplaySession((prev) => (prev ? { ...prev, index: i } : prev));
      }

      if (i >= events.length) {
        isReplayingRef.current = false;
        setIsReplaying(false);
        replayRafRef.current = null;
        return;
      }

      replayRafRef.current = requestAnimationFrame(tick);
    };

    replayRafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    replaySpeedRef.current = replaySpeed;
    if (!isReplayingRef.current) return;
    armReplayClock(getReplayVirtualMs());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaySpeed]);

  useEffect(() => {
    compressGapsRef.current = compressGaps;
    maxGapMsRef.current = maxGapMs;
    if (!isReplayingRef.current || replayEventsRef.current.length === 0) return;
    const idx = replayIndexRef.current;
    replayAdjustedMsRef.current = buildAdjustedMs(replayEventsRef.current);
    const atMs = replayAdjustedMsRef.current[Math.min(idx, replayAdjustedMsRef.current.length - 1)] ?? 0;
    armReplayClock(atMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compressGaps, maxGapMs]);

  // Supabase에 저장된 보드 이벤트를 읽어서 캔버스에 다시 그리는 함수입니다.
  // 예를 들어 이전에 그린 선이나 도형이 있다면, 새로 들어왔을 때 다시 화면에 그려줍니다.
  const loadAndRenderBoard = async (targetBoardId: string) => {
    if (!targetBoardId) return;
    clearReplaySession();
    setIsLoadingBoard(true);
    clearAllLocal();
    remoteLastPointByStrokeRef.current = new Map();
    remotePendingAppendsRef.current = new Map();
    remotePendingEndsRef.current = new Set();

    const { data, error } = await supabase
      .from('board_events')
      .select('id,board_id,seq,ts,actor_id,type,payload')
      .eq('board_id', targetBoardId)
      .order('seq', { ascending: true });

    setIsLoadingBoard(false);
    if (error) {
      alert(`보드 로드 실패: ${error.message}`);
      return;
    }
    const events = (data ?? []) as BoardEventRow[];
    const transforms = new Map<string, ImageTransformPayload>();
    const textTransforms = new Map<string, TextTransformPayload>();
    const fileTransforms = new Map<string, FileTransformPayload>();
    const removedFiles = new Set<string>();
    for (const ev of events) {
      if (ev.type === 'image.transform') {
        const p = ev.payload as ImageTransformPayload;
        if (p?.id) transforms.set(p.id, p);
      }
      if (ev.type === 'text.transform') {
        const p = ev.payload as TextTransformPayload;
        if (p?.id) textTransforms.set(p.id, p);
      }
      if (ev.type === 'file.transform') {
        const p = ev.payload as FileTransformPayload;
        if (p?.id) fileTransforms.set(p.id, p);
      }
      if (ev.type === 'file.remove') {
        const p = ev.payload as FileRemovePayload;
        if (p?.id) removedFiles.add(p.id);
      }
    }

    resetHistory();
    for (const ev of events) {
      if (ev.type === 'image.transform' || ev.type === 'text.transform' || ev.type === 'file.transform' || ev.type === 'file.remove') {
        continue;
      }
      if (ev.type === 'image.add') {
        const p = ev.payload as ImageAddPayload;
        const id = p.id || ev.id;
        const t = transforms.get(id);
        const folded: ImageAddPayload = t
          ? { ...p, id, x: t.x, y: t.y, width: t.width, height: t.height }
          : { ...p, id };
        await applyEvent({ ...ev, payload: folded });
        if (isHistoryCommitEvent(ev.type)) commitHistory();
        continue;
      }
      if (ev.type === 'text.add') {
        const p = ev.payload as TextAddPayload;
        const id = p.id || ev.id;
        const t = textTransforms.get(id);
        const folded: TextAddPayload = t
          ? { ...p, id, x: t.x, y: t.y, width: t.width, height: t.height, fontSize: t.fontSize }
          : { ...p, id };
        await applyEvent({ ...ev, payload: folded });
        if (isHistoryCommitEvent(ev.type)) commitHistory();
        continue;
      }
      if (ev.type === 'file.add') {
        const p = ev.payload as FileAddPayload;
        const id = p.id || ev.id;
        if (removedFiles.has(id)) continue;
        const t = fileTransforms.get(id);
        const folded: FileAddPayload = t
          ? { ...p, id, x: t.x, y: t.y, width: t.width, height: t.height, expanded: t.expanded ?? p.expanded }
          : { ...p, id };
        await applyEvent({ ...ev, payload: folded });
        if (isHistoryCommitEvent(ev.type)) commitHistory();
        continue;
      }
      await applyEvent(ev);
      if (isHistoryCommitEvent(ev.type)) commitHistory();
    }
    revealExpandedFilesOnCanvas();
    if (historyRef.current.length === 0) initHistory();
  };

  useEffect(() => {
    if (!boardId) return;
    const b = boards.find((x) => x.id === boardId);
    if (b) {
      const title = formatBoardTitle(b.title);
      setBoardTitle(title);
      lastSavedTitleRef.current[boardId] = title;
    }
    if (!initialTimelapseSaveId) {
      loadAndRenderBoard(boardId);
    }

    const channel = supabase
      .channel(`board-events:${boardId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'board_events', filter: `board_id=eq.${boardId}` },
        (payload) => {
          const row = payload.new as BoardEventRow;
          // 재생 중이면 라이브 반영은 일단 막아(타임라인이 섞이는 것 방지)
          if (isReplayingRef.current) return;
          // 내가 보낸 이벤트는 이미 로컬에서 그렸으므로 중복 적용하지 않음
          if (row.actor_id === actorIdRef.current) return;
          void applyEvent(row).then(() => {
            if (isHistoryCommitEvent(row.type)) commitHistory();
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // isReplaying은 실시간 반영 차단에만 사용. boardId 변경시 재구독 필요
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  useEffect(() => {
    if (deepLinkHandledRef.current || !initialTimelapseSaveId || !boardId) return;
    if (initialBoardId && boardId !== initialBoardId) return;

    deepLinkHandledRef.current = true;
    void (async () => {
      const { data: save, error } = await supabase
        .from('board_timelapse_saves')
        .select('id,board_id,title,max_seq,event_count,start_ts,end_ts,created_at')
        .eq('id', initialTimelapseSaveId)
        .single();

      if (error || !save) {
        void loadAndRenderBoard(boardId);
        return;
      }

      const ok = await prepareReplaySession(save.board_id, save.max_seq);
      if (!ok) {
        void loadAndRenderBoard(boardId);
        return;
      }

      if (autoPlayTimelapse) startReplay();
      else seekReplay(0);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, initialBoardId, initialTimelapseSaveId, autoPlayTimelapse]);

  const applyEvent = async (ev: BoardEventRow) => {
    if (ev.type === 'board.clear') {
      clearAllLocal();
      remoteLastPointByStrokeRef.current = new Map();
      remotePendingAppendsRef.current = new Map();
      remotePendingEndsRef.current = new Set();
      strokeStyleByIdRef.current = new Map();
      return;
    }

    if (ev.type === 'stroke.begin') {
      const p = ev.payload as StrokeBeginPayload;
      remoteLastPointByStrokeRef.current.set(p.strokeId, { x: p.point.x, y: p.point.y });
      strokeStyleByIdRef.current.set(p.strokeId, { tool: p.tool, color: p.color, size: p.size });
      flushRemotePendingStroke(p.strokeId);
      return;
    }

    if (ev.type === 'stroke.append') {
      const p = ev.payload as StrokeAppendPayload;
      if (!remoteLastPointByStrokeRef.current.has(p.strokeId)) {
        const list = remotePendingAppendsRef.current.get(p.strokeId) ?? [];
        list.push(p.points);
        remotePendingAppendsRef.current.set(p.strokeId, list);
        return;
      }
      applyStrokeAppendPoints(p.strokeId, p.points);
      return;
    }

    if (ev.type === 'stroke.end') {
      const p = ev.payload as StrokeEndPayload;
      if (!remoteLastPointByStrokeRef.current.has(p.strokeId)) {
        remotePendingEndsRef.current.add(p.strokeId);
        return;
      }
      remoteLastPointByStrokeRef.current.delete(p.strokeId);
      strokeStyleByIdRef.current.delete(p.strokeId);
      return;
    }

    if (ev.type === 'shape.add') {
      const p = ev.payload as ShapeAddPayload;
      const ctx = ctxRef.current ?? ensureContext();
      if (!ctx) return;
      drawShapeTool(ctx, p.tool, p.from, p.to, { strokeStyle: p.color, lineWidth: p.size }, false);
      return;
    }

    if (ev.type === 'image.add') {
      const p = ev.payload as ImageAddPayload;
      const ctx = ctxRef.current ?? ensureContext();
      if (!ctx || !p.dataUrl) return;
      const id = p.id || ev.id;
      await drawImagePayload(ctx, { ...p, id });
      upsertPlacedImage({
        id,
        x: p.x,
        y: p.y,
        width: p.width,
        height: p.height,
        dataUrl: p.dataUrl,
        aspect: p.width / Math.max(p.height, 1),
        committed: true,
      });
      return;
    }

    if (ev.type === 'image.transform') {
      const p = ev.payload as ImageTransformPayload;
      if (!p?.id) return;
      const prev = placedImagesRef.current.find((x) => x.id === p.id);
      if (prev) {
        upsertPlacedImage({
          ...prev,
          x: p.x,
          y: p.y,
          width: p.width,
          height: p.height,
        });
      }
      // 로컬이 이미 다시 그리는 중이면 구독 이벤트로 한 번 더 로드하지 않습니다.
      if (ev.actor_id === actorIdRef.current) return;
      if (boardId) void loadAndRenderBoard(boardId);
      return;
    }

    if (ev.type === 'text.add') {
      const p = ev.payload as TextAddPayload;
      const ctx = ctxRef.current ?? ensureContext();
      if (!ctx) return;
      const fontSize = resolveTextFontSize(p);
      const box = measurePlacedText(p.text, fontSize, p.width, p.height);
      drawText(ctx, { x: p.x, y: p.y }, p.text, {
        strokeStyle: p.color,
        lineWidth: p.size,
        fontSize,
      });
      upsertPlacedText({
        id: p.id || ev.id,
        x: p.x,
        y: p.y,
        text: p.text,
        color: p.color,
        fontSize,
        width: box.width,
        height: box.height,
      });
      return;
    }

    if (ev.type === 'text.transform') {
      const p = ev.payload as TextTransformPayload;
      if (!p?.id) return;
      const prev = placedTextsRef.current.find((x) => x.id === p.id);
      if (prev) {
        upsertPlacedText({
          ...prev,
          x: p.x,
          y: p.y,
          width: p.width,
          height: p.height,
          fontSize: p.fontSize,
        });
      }
      if (ev.actor_id === actorIdRef.current) return;
      if (boardId) void loadAndRenderBoard(boardId);
      return;
    }

    if (ev.type === 'file.add') {
      const p = ev.payload as FileAddPayload;
      const ctx = ctxRef.current ?? ensureContext();
      if (!ctx || !p.path) return;
      const placed: PlacedFile = {
        id: p.id || ev.id,
        x: p.x,
        y: p.y,
        width: p.width || DEFAULT_FILE_CARD_W,
        height: p.height || DEFAULT_FILE_CARD_H,
        name: p.name,
        path: p.path,
        size: p.size,
        mime: p.mime,
        expanded: Boolean(p.expanded),
      };
      drawFileCard(ctx, placed);
      upsertPlacedFile(placed);
      return;
    }

    if (ev.type === 'file.remove') {
      const p = ev.payload as FileRemovePayload;
      if (!p?.id) return;
      replacePlacedFiles(placedFilesRef.current.filter((x) => x.id !== p.id));
      if (selectedFileIdRef.current === p.id) selectPlacedFile(null);
      if (isReplayingRef.current || ev.actor_id === actorIdRef.current) return;
      if (boardId) void loadAndRenderBoard(boardId);
      return;
    }

    if (ev.type === 'file.transform') {
      const p = ev.payload as FileTransformPayload;
      if (!p?.id) return;
      const prev = placedFilesRef.current.find((x) => x.id === p.id);
      if (prev) {
        upsertPlacedFile({
          ...prev,
          x: p.x,
          y: p.y,
          width: p.width,
          height: p.height,
          expanded: p.expanded ?? prev.expanded,
        });
      }
      if (ev.actor_id === actorIdRef.current) return;
      if (boardId) void loadAndRenderBoard(boardId);
      return;
    }

    if (ev.type === 'stamp.add') {
      const p = ev.payload as StampAddPayload;
      const ctx = ctxRef.current ?? ensureContext();
      if (!ctx) return;
      drawStamp(ctx, { x: p.x, y: p.y }, p.kind, { strokeStyle: p.color, lineWidth: p.size });
    }
  };

  const getPoint = (e: PointerEvent): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.clientWidth,
      y: ((e.clientY - rect.top) / rect.height) * canvas.clientHeight,
    };
  };

  const getDrawStyle = () => ({ strokeStyle: color, lineWidth: size });

  const syncTextDraft = (next: TextDraft | null) => {
    textDraftRef.current = next;
    setTextDraft(next);
  };

  // 입력칸 내용을 캔버스에 그리고 보드 이벤트로 저장합니다. 빈 값이면 그냥 닫습니다.
  const commitTextDraft = (opts?: { keepTool?: boolean }) => {
    const draft = textDraftRef.current;
    if (!draft) return;
    const text = draft.value.replace(/\s+$/u, '');
    syncTextDraft(null);
    if (text) {
      const id = crypto.randomUUID();
      const placed: PlacedText = {
        id,
        x: draft.x,
        y: draft.y,
        text,
        color: draft.color,
        fontSize: draft.size,
        width: draft.width,
        height: draft.height,
      };
      drawText(ctxRef.current ?? ensureContext()!, { x: placed.x, y: placed.y }, placed.text, {
        strokeStyle: placed.color,
        lineWidth: size,
        fontSize: placed.fontSize,
      });
      upsertPlacedText(placed);
      void insertEvent('text.add', {
        id,
        x: placed.x,
        y: placed.y,
        text: placed.text,
        color: placed.color,
        size,
        fontSize: placed.fontSize,
        width: placed.width,
        height: placed.height,
      } satisfies TextAddPayload);
      commitHistory();
    }
    if (!opts?.keepTool && !locked) setTool('pen');
  };
  commitTextDraftRef.current = commitTextDraft;

  const startTextDraft = (p: Point) => {
    selectPlacedText(null);
    const box = defaultTextBoxSize(textSize);
    syncTextDraft({
      x: p.x,
      y: p.y,
      value: '',
      color: color,
      size: textSize,
      width: box.width,
      height: box.height,
    });
  };

  const writeTextDraft = (next: TextDraft) => {
    textDraftRef.current = next;
    setTextDraft(next);
    setTextSize(next.size);
  };

  // 입력 중인 글자 크기를 바꾸고, 박스도 같은 비율로 키우거나 줄입니다.
  const applyTextSize = (next: number, persist = true) => {
    const clamped = Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, next));
    const draft = textDraftRef.current;
    if (!draft) {
      const selected = placedTextsRef.current.find((t) => t.id === selectedTextIdRef.current);
      if (selected) {
        const scale = clamped / Math.max(selected.fontSize, 1);
        const nextW = Math.max(MIN_TEXT_BOX, selected.width * scale);
        const nextH = Math.max(MIN_TEXT_BOX, selected.height * scale);
        const cx = selected.x + selected.width / 2;
        const cy = selected.y + selected.height / 2;
        const updated = {
          ...selected,
          fontSize: clamped,
          width: nextW,
          height: nextH,
          x: cx - nextW / 2,
          y: cy - nextH / 2,
        };
        upsertPlacedText(updated);
        setTextSize(clamped);
        if (persist) persistAndReloadText(updated);
        return;
      }
      setTextSize(clamped);
      return;
    }
    const scale = clamped / Math.max(draft.size, 1);
    const nextW = Math.max(MIN_TEXT_BOX, draft.width * scale);
    const nextH = Math.max(MIN_TEXT_BOX, draft.height * scale);
    const cx = draft.x + draft.width / 2;
    const cy = draft.y + draft.height / 2;
    writeTextDraft({
      ...draft,
      size: clamped,
      width: nextW,
      height: nextH,
      x: cx - nextW / 2,
      y: cy - nextH / 2,
    });
  };

  // A 버튼을 누르면 지금 보이는 캔버스 가운데에 입력칸을 띄웁니다.
  const startTextInView = () => {
    if (textDraftRef.current) {
      requestAnimationFrame(() => textInputRef.current?.focus());
      return;
    }
    const area = canvasAreaRef.current;
    let x = 48;
    let y = 48;
    if (area) {
      x = Math.max(24, (area.clientWidth / 2 - panOffset.x) / zoomScale - textSize * 2);
      y = Math.max(24, (area.clientHeight / 2 - panOffset.y) / zoomScale - textSize);
    }
    startTextDraft({ x, y });
  };
  startTextInViewRef.current = startTextInView;

  // 입력칸이 뜨면 툴바 버튼보다 늦게 포커스를 가져와서 바로 타이핑되게 합니다.
  useEffect(() => {
    if (!textDraft) return;
    const focusEditor = () => textInputRef.current?.focus();
    focusEditor();
    const id = window.setTimeout(focusEditor, 0);
    return () => window.clearTimeout(id);
  }, [textDraft?.x, textDraft?.y]);

  const takeSnapshot = () => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current ?? ensureContext();
    if (!canvas || !ctx) return;
    snapshotRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
  };

  const restoreSnapshot = () => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current ?? ensureContext();
    if (!canvas || !ctx || !snapshotRef.current) return;
    ctx.putImageData(snapshotRef.current, 0, 0);
  };

  const placeRasterOnBoard = (point: Point, dataUrl: string, srcW: number, srcH: number) => {
    const w = Math.min(MAX_IMAGE_DRAW_WIDTH, srcW);
    const h = (srcH / Math.max(srcW, 1)) * w;
    const img = new Image();
    img.onload = () => {
      imageCacheRef.current.set(dataUrl, img);
      const placed: PlacedImage = {
        id: crypto.randomUUID(),
        x: point.x,
        y: point.y,
        width: w,
        height: h,
        dataUrl,
        aspect: w / Math.max(h, 1),
        committed: false,
      };
      upsertPlacedImage(placed);
      setTool('image');
    };
    img.src = dataUrl;
  };

  const handleImageFile = (file: File) => {
    const point = pendingImagePointRef.current;
    if (!point) return;
    pendingImagePointRef.current = null;
    void placeFileOnBoard(file, point);
  };

  /** 이미지·PDF·문서를 카드가 아니라 화이트보드 그림으로 바로 붙입니다. */
  const placeFileOnBoard = async (file: File, point: Point) => {
    if (file.size > MAX_CHAT_FILE_BYTES) {
      alert('파일은 20MB 이하만 올릴 수 있어요.');
      return;
    }
    try {
      const raster = await rasterizeBoardFile(file);
      placeRasterOnBoard(point, raster.dataUrl, raster.width, raster.height);
    } catch (err) {
      alert(err instanceof Error ? err.message : '파일을 화이트보드에 올리지 못했습니다.');
    }
  };

  const handleBoardFile = async (file: File) => {
    const point = pendingFilePointRef.current;
    if (!point) return;
    pendingFilePointRef.current = null;
    await placeFileOnBoard(file, point);
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    // PDF iframe 이 포커스를 가져가면 Ctrl+Z 가 보드에 안 들어가서, 그릴 때 캔버스로 되돌립니다.
    e.currentTarget.focus({ preventScroll: true });
    if (document.activeElement instanceof HTMLIFrameElement) {
      document.activeElement.blur();
    }
    const p = getPoint(e.nativeEvent);
    if (!p) return;

    if (activeTool !== 'image') {
      void commitUncommittedImage();
    }

    if (activeTool === 'hand') {
      panningRef.current = true;
      panAnchorRef.current = { x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const hitText = hitTestText(placedTextsRef.current, p);
    if (hitText && !pendingStampRef.current) {
      if (textDraftRef.current) commitTextDraft({ keepTool: true });
      const alreadySelected = selectedTextIdRef.current === hitText.id;
      selectPlacedImage(null);
      selectPlacedText(hitText.id);
      setTextSize(hitText.fontSize);
      // 한 번 클릭해서 고른 뒤에만 드래그/모서리 조절을 시작합니다.
      if (alreadySelected) {
        placedTextDragRef.current = { id: hitText.id, mode: 'move', startPoint: p, start: { ...hitText } };
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      return;
    }
    const hitFile = hitTestFile(placedFilesRef.current, p);
    if (hitFile && !pendingStampRef.current && !drawThroughFile) {
      const alreadySelected = selectedFileIdRef.current === hitFile.id;
      selectPlacedImage(null);
      selectPlacedText(null);
      selectPlacedFile(hitFile.id);
      if (alreadySelected) {
        placedFileDragRef.current = { id: hitFile.id, mode: 'move', startPoint: p, start: { ...hitFile } };
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      return;
    }

    if (selectedTextIdRef.current) selectPlacedText(null);
    if (selectedImageIdRef.current) selectPlacedImage(null);
    if (selectedFileIdRef.current) selectPlacedFile(null);

    if (pendingStampRef.current) {
      const kind = pendingStampRef.current;
      const style = getDrawStyle();
      drawStamp(ctxRef.current ?? ensureContext()!, p, kind, style);
      pendingStampRef.current = null;
      setPendingStampKind(null);
      setShowLibrary(false);
      void insertEvent('stamp.add', {
        x: p.x,
        y: p.y,
        kind,
        color: style.strokeStyle,
        size: style.lineWidth,
      } satisfies StampAddPayload);
      commitHistory();
      return;
    }

    if (activeTool === 'text') {
      // 이미 입력 중이면 먼저 확정한 뒤, 새로 클릭한 자리에 입력칸을 다시 엽니다.
      if (textDraftRef.current) commitTextDraft({ keepTool: true });
      startTextDraft(p);
      return;
    }

    if (activeTool === 'file') {
      pendingFilePointRef.current = p;
      boardFileInputRef.current?.click();
      return;
    }

    if (activeTool === 'image') {
      const hit = hitTestImage(placedImagesRef.current, p);
      if (hit) {
        const alreadySelected = selectedImageIdRef.current === hit.id;
        selectPlacedImage(hit.id);
        if (alreadySelected) {
          imageDragRef.current = { id: hit.id, mode: 'move', startPoint: p, start: { ...hit } };
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        return;
      }
      void commitUncommittedImage();
      pendingImagePointRef.current = p;
      imageInputRef.current?.click();
      return;
    }

    if (isShapeTool(activeTool)) {
      shapeStartRef.current = p;
      takeSnapshot();
      drawingRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (activeTool !== 'pen' && activeTool !== 'eraser') return;

    const ctx = ctxRef.current ?? ensureContext();
    if (!ctx) return;

    drawingRef.current = true;
    lastPointRef.current = p;
    strokeStartPointRef.current = p;
    localStrokeIdRef.current = crypto.randomUUID();
    pendingChunkRef.current = [];

    const strokeTool: StrokeTool = activeTool === 'eraser' ? 'eraser' : 'pen';
    strokeStyleByIdRef.current.set(localStrokeIdRef.current, { tool: strokeTool, color, size });
    remoteLastPointByStrokeRef.current.set(localStrokeIdRef.current, { ...p });
    if (boardId) {
      void enqueueStrokeWrite('stroke.begin', {
        strokeId: localStrokeIdRef.current,
        tool: strokeTool,
        color,
        size,
        point: p,
      } satisfies StrokeBeginPayload);
    }

    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (panningRef.current && panAnchorRef.current) {
      const dx = e.clientX - panAnchorRef.current.x;
      const dy = e.clientY - panAnchorRef.current.y;
      panAnchorRef.current = { x: e.clientX, y: e.clientY };
      setPanOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      return;
    }

    if (textResizeRef.current) {
      const p = getPoint(e.nativeEvent);
      if (!p) return;
      const drag = textResizeRef.current;
      writeTextDraft(resizeTextDraft(drag.start, drag.handle, p));
      return;
    }

    if (placedTextDragRef.current) {
      const p = getPoint(e.nativeEvent);
      if (!p) return;
      const drag = placedTextDragRef.current;
      if (drag.mode === 'move') {
        upsertPlacedText({
          ...drag.start,
          x: drag.start.x + (p.x - drag.startPoint.x),
          y: drag.start.y + (p.y - drag.startPoint.y),
        });
      } else {
        upsertPlacedText(resizePlacedText(drag.start, drag.mode, p));
      }
      return;
    }

    if (placedFileDragRef.current) {
      const p = getPoint(e.nativeEvent);
      if (!p) return;
      const drag = placedFileDragRef.current;
      if (drag.mode === 'move') {
        upsertPlacedFile({
          ...drag.start,
          x: drag.start.x + (p.x - drag.startPoint.x),
          y: drag.start.y + (p.y - drag.startPoint.y),
        });
      } else {
        upsertPlacedFile(resizePlacedFile(drag.start, drag.mode, p));
      }
      return;
    }

    if (imageDragRef.current) {
      const p = getPoint(e.nativeEvent);
      if (!p) return;
      const drag = imageDragRef.current;
      if (drag.mode === 'move') {
        upsertPlacedImage({
          ...drag.start,
          x: drag.start.x + (p.x - drag.startPoint.x),
          y: drag.start.y + (p.y - drag.startPoint.y),
        });
      } else {
        upsertPlacedImage(resizePlacedImage(drag.start, drag.mode, p));
      }
      return;
    }

    if (isShapeTool(activeTool) && drawingRef.current && shapeStartRef.current) {
      const ctx = ctxRef.current ?? ensureContext();
      const p = getPoint(e.nativeEvent);
      if (!ctx || !p) return;
      lastPointRef.current = p;
      restoreSnapshot();
      drawShapeTool(ctx, activeTool, shapeStartRef.current, p, getDrawStyle(), true);
      return;
    }

    if (!drawingRef.current || (activeTool !== 'pen' && activeTool !== 'eraser')) return;
    const ctx = ctxRef.current ?? ensureContext();
    if (!ctx) return;

    const p = getPoint(e.nativeEvent);
    const last = lastPointRef.current;
    if (!p || !last) return;

    applyStrokeSegment(last, p, activeTool === 'eraser' ? 'eraser' : 'pen', effectiveStrokeStyle, size);
    pendingChunkRef.current.push(p);
    scheduleChunkFlush();
    lastPointRef.current = p;
  };

  const handlePointerUp = () => {
    if (textResizeRef.current) {
      textResizeRef.current = null;
      ignoreTextBlurRef.current = false;
      requestAnimationFrame(() => textInputRef.current?.focus());
      return;
    }

    if (placedTextDragRef.current) {
      const id = placedTextDragRef.current.id;
      placedTextDragRef.current = null;
      const item = placedTextsRef.current.find((x) => x.id === id);
      if (item) persistAndReloadText(item);
      return;
    }

    if (placedFileDragRef.current) {
      const id = placedFileDragRef.current.id;
      placedFileDragRef.current = null;
      const item = placedFilesRef.current.find((x) => x.id === id);
      if (item) persistAndReloadFile(item);
      return;
    }

    if (imageDragRef.current) {
      const id = imageDragRef.current.id;
      imageDragRef.current = null;
      const img = placedImagesRef.current.find((x) => x.id === id);
      if (img?.committed) {
        persistImageTransform(img);
        if (boardId) void loadAndRenderBoard(boardId);
      }
      return;
    }

    if (panningRef.current) {
      panningRef.current = false;
      panAnchorRef.current = null;
      return;
    }

    if (isShapeTool(activeTool) && drawingRef.current && shapeStartRef.current) {
      const ctx = ctxRef.current ?? ensureContext();
      const from = shapeStartRef.current;
      const end = lastPointRef.current ?? from;
      if (ctx) {
        restoreSnapshot();
        drawShapeTool(ctx, activeTool, from, end, getDrawStyle(), false);
      }
      if (boardId) {
        void insertEvent('shape.add', {
          tool: activeTool,
          from,
          to: end,
          color,
          size,
        } satisfies ShapeAddPayload);
      }
      shapeStartRef.current = null;
      snapshotRef.current = null;
      drawingRef.current = false;
      lastPointRef.current = null;
      if (!locked) setTool('pen');
      commitHistory();
      return;
    }

    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    const sid = localStrokeIdRef.current;
    const startPoint = strokeStartPointRef.current;
    strokeStartPointRef.current = null;
    localStrokeIdRef.current = null;

    if (chunkTimerRef.current != null) {
      window.clearTimeout(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
    void (async () => {
      if (pendingChunkRef.current.length === 0 && startPoint) {
        const strokeTool: StrokeTool = activeTool === 'eraser' ? 'eraser' : 'pen';
        applyStrokeDot(startPoint, strokeTool, effectiveStrokeStyle, size);
        pendingChunkRef.current.push(startPoint);
      }
      await flushChunk();
      if (sid) await enqueueStrokeWrite('stroke.end', { strokeId: sid } satisfies StrokeEndPayload);
      commitHistory();
    })();
  };

  const clearAllRef = useRef<() => void>(() => {});

  const clearAll = () => {
    clearAllLocal();
    commitHistory();
    void insertEvent('board.clear', {});
  };

  clearAllRef.current = clearAll;

  useImperativeHandle(ref, () => ({
    clearBoard: () => clearAllRef.current(),
    getCanvasElement: () => canvasRef.current,
  }));

  /* const downloadPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `canvas-${Date.now()}.png`;
    a.click();
  }; */

  // 아래부터는 화면에 실제 UI를 그려주는 영역입니다.
  // 상단에 보드 이름, 도구 버튼, 색상/굵기 선택, 캔버스 영역을 한 번에 보여줍니다.
  // 이 JSX가 실제로 사용자가 보는 화면을 구성합니다.
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        fontFamily: "'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        background: meetingMode ? '#313338' : '#f3f4f6',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          flexShrink: 0,
          padding: meetingMode ? '8px 12px' : '12px 16px',
          borderBottom: meetingMode ? '1px solid #1e1f22' : '1px solid #e5e7eb',
          background: meetingMode ? '#2b2d31' : '#fff',
          boxShadow: meetingMode ? 'none' : '0 1px 3px rgba(0,0,0,0.06)',
        }}
      >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: meetingMode ? 0 : 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!isEmbedded && onBack ? (
            <button type="button" onClick={onBack} style={{ padding: '10px 12px', border: '1px solid #e5e7eb', background: 'white', cursor: 'pointer' }}>
              ← 뒤로
            </button>
          ) : null}
          {!meetingMode ? (
            <div>
              <h2 style={{ margin: 0 }}>{isGroupCanvas ? `${boardTitle || '그룹 캔버스'}` : '캔버스'}</h2>
              {isGroupCanvas ? (
                <div style={{ fontSize: 12, color: '#6366f1', marginTop: 4 }}>초대코드 멤버와 실시간 공유 중</div>
              ) : null}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, gap: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#dbdee1', flexShrink: 0 }}>
                ✏️ 회의 캔버스 {groupName ? `· ${groupName}` : ''}
              </div>
              {meetingHeaderExtra}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: meetingMode ? 6 : 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ color: meetingMode ? '#949ba4' : '#6b7280', fontSize: 12 }}>{isGroupCanvas ? '그룹 보드' : '보드'}</span>
            <select
              value={boardId}
              onChange={(e) => setBoardId(e.target.value)}
              disabled={isLoadingBoards}
              style={{
                padding: meetingMode ? '6px 8px' : '8px 10px',
                border: meetingMode ? '1px solid #1e1f22' : '1px solid #e5e7eb',
                background: meetingMode ? '#313338' : 'white',
                color: meetingMode ? '#dbdee1' : 'inherit',
                minWidth: 120,
                fontSize: meetingMode ? 12 : undefined,
              }}
            >
              <option value="">선택...</option>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {getBoardOptionLabel({ ...b, title: formatBoardTitle(b.title) }, boards.map((x) => ({ ...x, title: formatBoardTitle(x.title) })))}
                </option>
              ))}
            </select>
            <input
              value={boardTitle}
              onChange={(e) => setBoardTitle(e.target.value)}
              onBlur={() => void saveBoardTitle()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void saveBoardTitle();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="보드 이름"
              style={{
                padding: meetingMode ? '6px 8px' : '8px 10px',
                border: meetingMode ? '1px solid #1e1f22' : '1px solid #e5e7eb',
                background: meetingMode ? '#313338' : 'white',
                color: meetingMode ? '#dbdee1' : 'inherit',
                width: meetingMode ? 120 : 160,
                fontSize: meetingMode ? 12 : undefined,
              }}
            />
            <button type="button" onClick={createBoard} style={{ padding: meetingMode ? '6px 8px' : '8px 10px', border: 'none', background: meetingMode ? '#5865f2' : '#111827', color: 'white', cursor: 'pointer', fontSize: meetingMode ? 12 : undefined }}>
              새 보드
            </button>
            {!meetingMode ? (
            <button type="button" onClick={refreshBoards} style={{ padding: '8px 10px', border: '1px solid #e5e7eb', background: 'white', cursor: 'pointer' }}>
              새로고침
            </button>
            ) : null}
          </div>

          {meetingMode ? (
            <button
              type="button"
              onClick={() => setChatOpen((v) => !v)}
              style={{
                padding: '6px 8px',
                border: '1px solid #1e1f22',
                borderRadius: 6,
                background: chatOpen ? '#5865f2' : '#313338',
                color: '#dbdee1',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              {chatOpen ? '💬 채팅 닫기' : '💬 채팅 열기'}
            </button>
          ) : null}
          </div>

          <div style={{ display: 'flex', gap: 6, flexDirection: 'column', alignItems: 'flex-end' }}>
            <ExcalidrawToolbar
              tool={activeTool}
              locked={locked}
              onToolChange={pickTool}
              onLockToggle={() => setLocked((v) => !v)}
              onLibraryOpen={() => setShowLibrary((v) => !v)}
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            색
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} disabled={tool === 'eraser'} />
          </label>

          {tool === 'text' || textDraft || selectedTextId ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: meetingMode ? '#dbdee1' : undefined }}>
              텍스트 크기
              <button
                type="button"
                className={cb.textSizeBtn}
                title="텍스트 축소"
                onClick={() => applyTextSize(textSize - TEXT_SIZE_STEP)}
              >
                A−
              </button>
              <input
                type="range"
                min={MIN_TEXT_SIZE}
                max={MAX_TEXT_SIZE}
                step={TEXT_SIZE_STEP}
                value={textSize}
                onChange={(e) => applyTextSize(Number(e.target.value), false)}
                onPointerUp={() => {
                  const selected = placedTextsRef.current.find((t) => t.id === selectedTextIdRef.current);
                  if (selected && !textDraftRef.current) persistAndReloadText(selected);
                }}
              />
              <button
                type="button"
                className={cb.textSizeBtn}
                title="텍스트 확대"
                onClick={() => applyTextSize(textSize + TEXT_SIZE_STEP)}
              >
                A+
              </button>
              <span style={{ width: 36, textAlign: 'right' }}>{textSize}</span>
            </label>
          ) : (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            굵기
            <input type="range" min={2} max={30} value={size} onChange={(e) => setSize(Number(e.target.value))} />
            <span style={{ width: 28, textAlign: 'right' }}>{size}</span>
          </label>
          )}

          <button type="button" onClick={clearAll} style={{ padding: '8px 10px', border: '1px solid #e5e7eb', background: 'white', cursor: 'pointer' }}>
            전체 지우기
          </button>
          {/* <button type="button" onClick={downloadPng} style={{ padding: '8px 10px', border: 'none', background: '#2563eb', color: 'white', cursor: 'pointer' }}>
            PNG 저장
          </button> */}
        </div>
      </div>
      </div>

      <div className={cb.mainRow}>
      <div
        ref={canvasAreaRef}
        className={cb.area}
        style={{
          position: 'relative',
          background: '#fff',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
            transformOrigin: '0 0',
          }}
        >
          {placedFiles.filter((item) => item.expanded).map((item) => (
            <div
              key={`preview-${item.id}`}
              className={cb.filePreviewBehind}
              style={{
                left: item.x,
                top: item.y + FILE_CARD_HEADER_H,
                width: item.width,
                height: Math.max(40, item.height - FILE_CARD_HEADER_H - FILE_SCROLL_BAR_H),
                // 미리보기는 항상 캔버스 아래. 그림이 파일 위에 올라가게 합니다.
                zIndex: 1,
                pointerEvents: drawThroughFile ? 'none' : 'auto',
              }}
            >
              <BoardFilePreview
                url={chatFileUrl(item.path)}
                name={displayFileName(item.name)}
                mime={item.mime}
                interactive={!drawThroughFile}
              />
            </div>
          ))}
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{
              display: 'block',
              position: 'relative',
              zIndex: 2,
              background: 'transparent',
              touchAction: 'none',
              outline: 'none',
              tabIndex: 0,
              cursor: activeTool === 'hand' ? 'grab' : activeTool === 'text' ? 'text' : activeTool === 'file' ? 'copy' : 'crosshair',
            }}
          />
          {textDraft ? (
            <div
              className={cb.textBox}
              style={{
                left: textDraft.x,
                top: textDraft.y,
                width: textDraft.width,
                height: textDraft.height,
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
            <textarea
              ref={textInputRef}
              className={cb.textEditor}
              value={textDraft.value}
              rows={1}
              spellCheck={false}
              onChange={(e) => {
                const next = { ...textDraft, value: e.target.value };
                textDraftRef.current = next;
                setTextDraft(next);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+' || e.code === 'Equal')) {
                  e.preventDefault();
                  applyTextSize(textSize + TEXT_SIZE_STEP);
                  return;
                }
                if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_' || e.code === 'Minus')) {
                  e.preventDefault();
                  applyTextSize(textSize - TEXT_SIZE_STEP);
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  commitTextDraft();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  syncTextDraft(null);
                  if (!locked) setTool('pen');
                }
              }}
              placeholder="텍스트 입력"
              onBlur={() => {
                // 모서리 핸들을 잡는 순간에도 blur가 나서, 그때는 확정하지 않습니다.
                if (ignoreTextBlurRef.current || textResizeRef.current) return;
                if (!textDraftRef.current?.value.trim()) return;
                commitTextDraft();
              }}
              style={{
                color: textDraft.color,
                caretColor: textDraft.color,
                fontSize: textDraft.size,
                lineHeight: 1.25,
              }}
            />
            </div>
          ) : null}
          {placedTexts.map((item) => {
            const selected = item.id === selectedTextId;
            const handlePos: Record<ImageResizeHandle, { left: number; top: number; cursor: string }> = {
              nw: { left: -6, top: -6, cursor: 'nwse-resize' },
              ne: { left: item.width - 6, top: -6, cursor: 'nesw-resize' },
              sw: { left: -6, top: item.height - 6, cursor: 'nesw-resize' },
              se: { left: item.width - 6, top: item.height - 6, cursor: 'nwse-resize' },
            };
            return (
              <div
                key={item.id}
                className={cb.textBox}
                title={selected ? '모서리를 드래그하거나 휠로 크기를 조절하세요' : '클릭해서 크기 조절'}
                style={{
                  left: item.x,
                  top: item.y,
                  width: item.width,
                  height: item.height,
                  zIndex: selected ? 19 : 18,
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const alreadySelected = selectedTextIdRef.current === item.id;
                  selectPlacedImage(null);
                  selectPlacedFile(null);
                  selectPlacedText(item.id);
                  setTextSize(item.fontSize);
                  if (!alreadySelected) return;
                  const p = getPoint(e.nativeEvent);
                  if (!p) return;
                  placedTextDragRef.current = { id: item.id, mode: 'move', startPoint: p, start: { ...item } };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onWheel={(e) => {
                  if (!selected) return;
                  e.preventDefault();
                  e.stopPropagation();
                  applyTextSize(Math.round(item.fontSize * (e.deltaY < 0 ? 1.08 : 0.92)));
                }}
              >
                {selected
                  ? (['nw', 'ne', 'sw', 'se'] as ImageResizeHandle[]).map((handle) => (
                      <div
                        key={handle}
                        className={cb.textHandle}
                        style={{ left: handlePos[handle].left, top: handlePos[handle].top, cursor: handlePos[handle].cursor }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          const p = getPoint(e.nativeEvent);
                          if (!p) return;
                          placedTextDragRef.current = { id: item.id, mode: handle, startPoint: p, start: { ...item } };
                          e.currentTarget.setPointerCapture(e.pointerId);
                        }}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                      />
                    ))
                  : null}
              </div>
            );
          })}
          {placedFiles.map((item) => {
            const selected = item.id === selectedFileId;
            const expanded = Boolean(item.expanded);
            const handlePos: Record<ImageResizeHandle, { left: number; top: number; cursor: string }> = {
              nw: { left: -6, top: -6, cursor: 'nwse-resize' },
              ne: { left: item.width - 6, top: -6, cursor: 'nesw-resize' },
              sw: { left: -6, top: item.height - 6, cursor: 'nesw-resize' },
              se: { left: item.width - 6, top: item.height - 6, cursor: 'nwse-resize' },
            };
            const startFileMove = (e: ReactPointerEvent<HTMLElement>) => {
              e.stopPropagation();
              const alreadySelected = selectedFileIdRef.current === item.id;
              selectPlacedImage(null);
              selectPlacedText(null);
              selectPlacedFile(item.id);
              if (!alreadySelected) return;
              const p = getPoint(e.nativeEvent);
              if (!p) return;
              placedFileDragRef.current = { id: item.id, mode: 'move', startPoint: p, start: { ...item } };
              e.currentTarget.setPointerCapture(e.pointerId);
            };
            return (
              <div
                key={item.id}
                className={`${cb.fileCard} ${expanded ? cb.fileCardExpanded : ''} ${drawThroughFile ? cb.fileCardDrawThrough : ''}`}
                title={selected ? '모서리를 드래그하거나 더블클릭해서 펼치기' : '클릭해서 선택'}
                style={{
                  left: item.x,
                  top: item.y,
                  width: item.width,
                  height: item.height,
                  border: selected ? '2px solid #8b5cf6' : '1px solid #cbd5e1',
                  background: expanded ? 'transparent' : undefined,
                  zIndex: selected || expanded ? 19 : 17,
                }}
                onPointerDown={expanded ? undefined : startFileMove}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  togglePlacedFileExpanded(item.id);
                }}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              >
                <div className={cb.fileCardHeader} onPointerDown={expanded ? startFileMove : undefined}>
                  <div className={cb.fileCardBody}>
                    <span className={cb.fileCardName}>📎 {displayFileName(item.name)}</span>
                    {expanded ? null : <span className={cb.fileCardMeta}>{formatChatFileSize(item.size)}</span>}
                  </div>
                  <button
                    type="button"
                    className={cb.fileExpandBtn}
                    title={expanded ? '접기' : '내용 펼치기'}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePlacedFileExpanded(item.id);
                    }}
                  >
                    {expanded ? '접기' : '펼치기'}
                  </button>
                </div>
                {expanded ? <div className={cb.filePreviewSpacer} /> : null}
                {expanded ? (
                  <div
                    className={cb.fileScrollBar}
                    title="가로 스크롤"
                    onPointerDown={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                  />
                ) : null}
                {selected ? (
                  <button
                    type="button"
                    className={cb.fileRemoveBtn}
                    title="파일 제거"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      removePlacedFile(item.id);
                    }}
                  >
                    ✕
                  </button>
                ) : null}
                {selected
                  ? (['nw', 'ne', 'sw', 'se'] as ImageResizeHandle[]).map((handle) => (
                      <div
                        key={handle}
                        className={cb.textHandle}
                        style={{ left: handlePos[handle].left, top: handlePos[handle].top, cursor: handlePos[handle].cursor }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          const p = getPoint(e.nativeEvent);
                          if (!p) return;
                          placedFileDragRef.current = { id: item.id, mode: handle, startPoint: p, start: { ...item } };
                          e.currentTarget.setPointerCapture(e.pointerId);
                        }}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                      />
                    ))
                  : null}
              </div>
            );
          })}
          {placedImages.map((img) => {
            const selected = img.id === selectedImageId;
            const handles: ImageResizeHandle[] = ['nw', 'ne', 'sw', 'se'];
            const handlePos: Record<ImageResizeHandle, { left: number; top: number; cursor: string }> = {
              nw: { left: -6, top: -6, cursor: 'nwse-resize' },
              ne: { left: img.width - 6, top: -6, cursor: 'nesw-resize' },
              sw: { left: -6, top: img.height - 6, cursor: 'nesw-resize' },
              se: { left: img.width - 6, top: img.height - 6, cursor: 'nwse-resize' },
            };
            return (
              <div
                key={img.id}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const alreadySelected = selectedImageIdRef.current === img.id;
                  selectPlacedText(null);
                  selectPlacedFile(null);
                  selectPlacedImage(img.id);
                  if (!alreadySelected) return;
                  const p = getPoint(e.nativeEvent);
                  if (!p) return;
                  imageDragRef.current = { id: img.id, mode: 'move', startPoint: p, start: { ...img } };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onWheel={(e) => {
                  if (!selected) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const factor = e.deltaY < 0 ? 1.08 : 0.92;
                  const nextW = Math.max(MIN_IMAGE_DRAW_SIZE, img.width * factor);
                  const nextH = nextW / (img.aspect || 1);
                  const cx = img.x + img.width / 2;
                  const cy = img.y + img.height / 2;
                  const next = {
                    ...img,
                    width: nextW,
                    height: nextH,
                    x: cx - nextW / 2,
                    y: cy - nextH / 2,
                  };
                  upsertPlacedImage(next);
                  if (next.committed) persistImageTransform(next);
                }}
                style={{
                  position: 'absolute',
                  left: img.x,
                  top: img.y,
                  width: img.width,
                  height: img.height,
                  boxSizing: 'border-box',
                  border: selected ? '2px solid #8b5cf6' : '2px solid transparent',
                  cursor: drawThroughFile ? 'crosshair' : 'move',
                  pointerEvents: drawThroughFile ? 'none' : 'auto',
                  zIndex: selected ? 3 : 2,
                }}
                title={selected ? '모서리를 드래그하거나 휠로 크기를 조절하세요' : '클릭해서 크기 조절'}
              >
                {!img.committed ? (
                  <img
                    src={img.dataUrl}
                    alt=""
                    draggable={false}
                    style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
                  />
                ) : null}
                {selected ? (
                  <>
                    {handles.map((handle) => (
                      <div
                        key={handle}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          const p = getPoint(e.nativeEvent);
                          if (!p) return;
                          imageDragRef.current = { id: img.id, mode: handle, startPoint: p, start: { ...img } };
                          e.currentTarget.setPointerCapture(e.pointerId);
                        }}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        style={{
                          position: 'absolute',
                          left: handlePos[handle].left,
                          top: handlePos[handle].top,
                          width: 12,
                          height: 12,
                          background: '#fff',
                          border: '2px solid #8b5cf6',
                          borderRadius: 2,
                          cursor: handlePos[handle].cursor,
                          boxSizing: 'border-box',
                        }}
                      />
                    ))}
                  </>
                ) : null}
              </div>
            );
          })}
        </div>

        <input
          ref={boardFileInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleBoardFile(file);
            e.target.value = '';
          }}
        />
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*,.pdf,.docx,.txt,.md,.csv"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImageFile(file);
            e.target.value = '';
          }}
        />

        <CanvasViewportControls
          zoomPercent={zoomPercent}
          canUndo={canUndo}
          canRedo={canRedo}
          onZoomOut={zoomOut}
          onZoomIn={zoomIn}
          onUndo={undoHistory}
          onRedo={redoHistory}
        />

        {showLibrary ? (
          <div
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 10,
              padding: 10,
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
              zIndex: 5,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>라이브러리 (임시)</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['rect', 'circle', 'triangle'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => {
                    pendingStampRef.current = kind;
                    setPendingStampKind(kind);
                  }}
                  style={{
                    padding: '8px 12px',
                    border: pendingStampKind === kind ? '2px solid #8b5cf6' : '1px solid #e5e7eb',
                    borderRadius: 8,
                    background: pendingStampKind === kind ? '#ede9fe' : '#f9fafb',
                    cursor: 'pointer',
                  }}
                >
                  {kind === 'rect' ? '▭' : kind === 'circle' ? '○' : '△'}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* <TimelapseSidePanel
        boardId={boardId}
        isLoadingBoard={isLoadingBoard}
        isReplaying={isReplaying}
        replaySpeed={replaySpeed}
        compressGaps={compressGaps}
        maxGapMs={maxGapMs}
        replaySession={replaySession}
        onResync={() => {
          if (!boardId) return;
          stopReplay();
          void loadAndRenderBoard(boardId);
        }}
        onReplaySpeedChange={setReplaySpeed}
        onCompressGapsChange={setCompressGaps}
        onMaxGapMsChange={setMaxGapMs}
        onPlay={() => void handleTimelapsePlay()}
        onPause={() => stopReplay()}
        onLoad={() => void handleTimelapseLoad()}
        onSeek={seekReplay}
        saveDraftTitle={timelapseSaveDraft}
        isSaving={isSavingTimelapse}
        onSaveDraftTitleChange={setTimelapseSaveDraft}
        onSave={() => void handleSaveTimelapse()}
      /> */}

      {showInitChoice ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.4)',
            zIndex: 60,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            style={{
              width: 420,
              padding: 18,
              borderRadius: 10,
              background: meetingMode ? '#2b2d31' : '#fff',
              color: meetingMode ? '#dbdee1' : '#111827',
              boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>새 보드 생성 또는 기존 보드 불러오기</div>
            <div style={{ fontSize: 13, color: meetingMode ? '#c7c9cc' : '#374151' }}>원하는 작업을 선택하세요.</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={handleUseExistingBoardChoice}
                style={{ padding: '8px 12px', border: '1px solid #e5e7eb', background: meetingMode ? '#313338' : 'white', cursor: 'pointer' }}
              >
                기존 보드 불러오기
              </button>
              <button
                type="button"
                onClick={handleCreateNewBoardChoice}
                style={{ padding: '8px 12px', border: 'none', background: '#111827', color: 'white', cursor: 'pointer' }}
              >
                새 보드 생성
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {meetingMode && chatOpen ? <MeetingChatPanel onClose={() => setChatOpen(false)} groupId={groupId} /> : null}
      </div>
    </div>
  );
});

export default CanvasBoard;