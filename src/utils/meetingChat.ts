import { getApiBase } from './apiBase';

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

/** 회의 첨부 파일을 서버에 올리고 메타데이터를 돌려받습니다. */
export async function uploadMeetingAttachment(file: File, groupId?: string): Promise<MeetingChatFile> {
  if (file.size > MAX_CHAT_FILE_BYTES) {
    throw new Error('파일은 20MB 이하만 첨부할 수 있어요.');
  }
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
  return (await res.json()) as MeetingChatFile;
}

export function formatChatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function chatFileUrl(relPath: string) {
  return `${getApiBase()}/files/${relPath.split('/').map(encodeURIComponent).join('/')}`;
}

/** 첨부 파일을 브라우저에서 다운로드합니다. (CORS·인라인 응답에도 동작) */
export async function downloadMeetingFile(file: Pick<MeetingChatFile, 'name' | 'path'>) {
  const url = chatFileUrl(file.path);
  const res = await fetch(url);
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
