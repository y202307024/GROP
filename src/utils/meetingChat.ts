import { getApiBase } from './apiBase';
import { bearerHeaders } from './authHeader';
import { issueSignedMediaUrl } from './signedMediaUrl';

export const MEETING_CHAT_TOPIC = 'meeting-chat';
/** 하단 파일 도구로 올린 첨부 — 채팅이 아닌 사이드바 목록용 */
export const MEETING_FILE_TOPIC = 'meeting-files';
export const MAX_CHAT_FILE_BYTES = 20 * 1024 * 1024;

export type MeetingChatFile = {
  name: string;
  path: string;
  size: number;
  mime: string;
};

export type MeetingSharedFile = MeetingChatFile & {
  id: string;
  ts: number;
  /** 이 파일을 올린 사용자. 없으면 예전 파일이라 회의를 만든 사람으로 추정합니다. */
  uploadedBy?: string | null;
};

export type MeetingChatMessage = {
  id: string;
  from: string;
  name: string;
  text: string;
  ts: number;
  file?: MeetingChatFile;
};

const IMAGE_FILE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

/** Windows에서 한글 파일명은 MIME이 비어 이미지로 안 잡히는 경우가 있습니다. */
export function isImageFile(file: File) {
  if (file.type.startsWith('image/')) return true;
  return IMAGE_FILE_EXT.test(file.name);
}

export function encodeMeetingChatMessage(msg: MeetingChatMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(msg));
}

export function decodeMeetingChatMessage(payload: Uint8Array): MeetingChatMessage | null {
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

export function encodeMeetingSharedFile(file: MeetingSharedFile): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(file));
}

export function decodeMeetingSharedFile(payload: Uint8Array): MeetingSharedFile | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payload));
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.path !== 'string' || typeof parsed.name !== 'string') return null;
    return {
      id: typeof parsed.id === 'string' ? parsed.id : crypto.randomUUID(),
      name: parsed.name,
      path: parsed.path,
      size: typeof parsed.size === 'number' ? parsed.size : 0,
      mime: typeof parsed.mime === 'string' ? parsed.mime : 'application/octet-stream',
      ts: typeof parsed.ts === 'number' ? parsed.ts : Date.now(),
    };
  } catch {
    return null;
  }
}

/** 회의 첨부 파일을 회의 서버에 올리고 메타데이터를 돌려받습니다. */
export async function uploadMeetingAttachment(file: File, groupId?: string, userId?: string | null): Promise<MeetingChatFile> {
  if (file.size > MAX_CHAT_FILE_BYTES) {
    throw new Error('파일은 20MB 이하만 첨부할 수 있어요.');
  }
  const body = new FormData();
  body.append('file', file);
  // multer가 파일명을 latin1로 읽어 한글이 깨지므로, 원래 이름은 별도 필드로 보냅니다.
  body.append('originalName', file.name);
  body.append('groupId', groupId || 'unknown');
  if (userId) body.append('userId', userId);
  const res = await fetch(`${getApiBase()}/api/chat-files/upload`, {
    method: 'POST',
    headers: await bearerHeaders(),
    body,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error((errBody as { error?: string }).error || `업로드 실패 (${res.status})`);
  }
  return (await res.json()) as MeetingChatFile;
}

export function formatChatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** 첨부 파일을 브라우저에서 다운로드합니다. 짧은 주소를 받은 뒤 blob 으로 저장합니다. */
export async function downloadMeetingFile(file: Pick<MeetingChatFile, 'name' | 'path'>) {
  const issued = await issueSignedMediaUrl('file', file.path);
  const res = await fetch(issued.url);
  if (!res.ok) {
    throw new Error(`다운로드 실패 (${res.status})`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = displayFileName(file.name);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

/** 화면에 보이는 첨부 이름만 바꿉니다. 서버의 저장 파일명은 그대로입니다. */
export async function renameMeetingFile(path: string, name: string): Promise<string> {
  const res = await fetch(`${getApiBase()}/api/chat-files/name`, {
    method: 'PATCH',
    headers: await bearerHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ path, name }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string }).error || `이름 변경 실패 (${res.status})`);
  }
  const next = (body as { name?: string }).name;
  return typeof next === 'string' && next.trim() ? next : name.trim();
}

/** 첨부 파일과 회의 문서 목록의 그 항목을 지웁니다. */
export async function deleteMeetingFile(path: string) {
  const res = await fetch(`${getApiBase()}/api/chat-files`, {
    method: 'DELETE',
    headers: await bearerHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ path }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string }).error || `삭제 실패 (${res.status})`);
  }
}

/** 디스크에 저장한 `시각-임의문자.확장자` 이름인지. 이 이름이면 원래 파일명을 찾아 보여 줍니다. */
export function isStoredChatFileName(name: string) {
  return /^\d{13}-[a-z0-9]{6,}\.[a-z0-9]{1,8}$/i.test(name);
}

/**
 * 같은 파일을 여러 곳에서 합칠 때 화면에 쓸 이름.
 * 먼저 정해진 이름(업로드 이름, 그 다음 변경한 이름)을 유지하고,
 * 저장용 이름(시각-임의문자)만 있으면 나중에 찾은 원래 이름으로 바꿉니다.
 */
export function preferDisplayName(current: string, incoming: string) {
  if (!incoming) return current;
  if (!current) return incoming;
  if (isStoredChatFileName(current) && !isStoredChatFileName(incoming)) return incoming;
  return current;
}

/** 예전에 latin1로 저장된 한글 파일명을 화면에서 복원합니다. */
export function displayFileName(name: string) {
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

export function formatChatTime(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 채팅창에 한 번에 남겨 두는 메시지 수. 이번 회의와 이전 회의를 함께 보여 줍니다. */
export const DISPLAY_CHAT_LIMIT = 1000;

/** 받은 기록을 기존 목록에 합칩니다. 같은 id는 한 번만 넣고 시간순으로 정렬합니다. */
export function mergeChatMessages(
  prev: MeetingChatMessage[],
  incoming: unknown[],
  limit = DISPLAY_CHAT_LIMIT,
) {
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
  return [...prev, ...added].sort((a, b) => a.ts - b.ts).slice(-limit);
}

/**
 * meetings.chat_log에서 화면에 보여줄 메시지만 고릅니다.
 * 참석자 자리표시(본문이 빈 기록)는 채팅창에 올리지 않습니다.
 */
export function realChatMessages(raw: unknown): MeetingChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: MeetingChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const msg = item as Partial<MeetingChatMessage>;
    if (typeof msg.id !== 'string') continue;
    if (typeof msg.text !== 'string' || msg.text.trim() === '') continue;
    if (typeof msg.ts !== 'number') continue;
    out.push({
      id: msg.id,
      from: typeof msg.from === 'string' ? msg.from : '',
      name: typeof msg.name === 'string' ? msg.name : '',
      text: msg.text,
      ts: msg.ts,
    });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/** 날짜가 바뀌는 지점을 나누는 키. 같은 날 메시지는 한 묶음입니다. */
export function chatDayKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 이전 채팅 위에 붙이는 날짜. 올해가 아니면 연도도 적습니다. */
export function formatChatDay(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  if (sameDay) return '오늘';
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}
