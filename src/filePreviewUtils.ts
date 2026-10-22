export type FilePreviewKind = 'pdf' | 'image' | 'text' | 'docx' | 'video' | 'audio' | 'other';

const TEXT_EXT = /\.(txt|md|csv|json|log|xml|html|htm|js|ts|css)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const VIDEO_EXT = /\.(mp4|webm|ogg)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac)$/i;

/** 확장자와 MIME으로 화이트보드에서 어떤 미리보기를 쓸지 고릅니다. */
export function getFilePreviewKind(name: string, mime: string): FilePreviewKind {
  const type = (mime || '').toLowerCase();
  const fileName = name || '';
  if (type === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')) return 'pdf';
  if (type.startsWith('image/') || IMAGE_EXT.test(fileName)) return 'image';
  if (type.startsWith('video/') || VIDEO_EXT.test(fileName)) return 'video';
  if (type.startsWith('audio/') || AUDIO_EXT.test(fileName)) return 'audio';
  if (
    type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    fileName.toLowerCase().endsWith('.docx')
  ) {
    return 'docx';
  }
  if (type.startsWith('text/') || TEXT_EXT.test(fileName)) return 'text';
  return 'other';
}

export function canPreviewFile(name: string, mime: string) {
  return getFilePreviewKind(name, mime) !== 'other';
}

/** 펼친 카드의 기본 크기. PDF는 세로로 길게 잡습니다. */
export function expandedFileSize(kind: FilePreviewKind) {
  if (kind === 'pdf' || kind === 'image' || kind === 'video') {
    return { width: 440, height: 580 };
  }
  return { width: 440, height: 420 };
}

const MAX_PREVIEW_CHARS = 200_000;

export function clipPreviewText(text: string) {
  if (text.length <= MAX_PREVIEW_CHARS) return text;
  return `${text.slice(0, MAX_PREVIEW_CHARS)}\n\n… 뒤는 생략했습니다.`;
}

/** docx(zip)에서 word/document.xml 을 찾아 글자만 꺼냅니다. */
export async function extractDocxPlainText(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const entry = await readZipEntry(bytes, 'word/document.xml');
  if (!entry) throw new Error('docx 본문을 찾지 못했습니다');
  return wordXmlToText(new TextDecoder('utf-8').decode(entry));
}

function wordXmlToText(xml: string) {
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\b[^/]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function readZipEntry(buf: Uint8Array, filename: string): Promise<Uint8Array | null> {
  const headerAt = findLocalHeader(buf, filename);
  if (headerAt < 0) return null;
  const view = new DataView(buf.buffer, buf.byteOffset + headerAt, 30);
  const method = view.getUint16(8, true);
  const compSize = view.getUint32(18, true);
  const nameLen = view.getUint16(26, true);
  const extraLen = view.getUint16(28, true);
  const dataStart = headerAt + 30 + nameLen + extraLen;
  if (compSize <= 0 || dataStart + compSize > buf.length) return null;
  const data = buf.subarray(dataStart, dataStart + compSize);
  if (method === 0) return data;
  if (method === 8) return inflateRaw(data);
  return null;
}

/** 파일 이름 문자열을 찾은 뒤, 바로 앞 로컬 헤더가 ZIP인지 확인합니다. */
function findLocalHeader(buf: Uint8Array, filename: string) {
  const name = new TextEncoder().encode(filename);
  for (let i = 30; i <= buf.length - name.length; i += 1) {
    let match = true;
    for (let j = 0; j < name.length; j += 1) {
      if (buf[i + j] !== name[j]) {
        match = false;
        break;
      }
    }
    if (!match) continue;
    const view = new DataView(buf.buffer, buf.byteOffset + i - 30, 30);
    if (view.getUint32(0, true) === 0x04034b50 && view.getUint16(26, true) === name.length) {
      return i - 30;
    }
  }
  return -1;
}

async function inflateRaw(data: Uint8Array) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
