import { getApiBase } from './apiBase';

export const MEETING_CHAT_TOPIC = 'meeting-chat';
export const MAX_CHAT_FILE_BYTES = 20 * 1024 * 1024;

export type MeetingChatFile = {
  name: string;
  path: string;
  size: number;
  mime: string;
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

export function formatChatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function chatFileUrl(relPath: string) {
  return `${getApiBase()}/files/${relPath.split('/').map(encodeURIComponent).join('/')}`;
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
