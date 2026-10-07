import { getApiBase } from './apiBase';

/**
 * Netlify Blobs 조각 업로드 (Netlify 백엔드 모드 전용)
 * - Netlify 함수는 요청 본문이 약 4.5MB(바이너리)로 제한되어 큰 녹화 영상을 한 번에 못 올립니다.
 * - 그래서 3MiB 조각으로 나눠 /api/blob-upload/part 에 올리고, 마지막에 /api/blob-upload/complete 로 확정합니다.
 * - 조각 크기는 netlify/lib/uploads.mjs 의 UPLOAD_PART_BYTES 와 같아야 합니다.
 */
export const NETLIFY_UPLOAD_PART_BYTES = 3 * 1024 * 1024;

/** 동시에 올리는 조각 수. 너무 많으면 느린 회선에서 오히려 타임아웃이 늘어납니다. */
const PARALLEL_UPLOADS = 3;
const MAX_RETRIES = 3;

export type NetlifyUploadResult = {
  /** Express 업로드 응답과 같은 상대경로 (예: 그룹id/2026-10-07/1234.webm) */
  path: string;
  name: string;
  size: number;
  mime: string;
};

function uploadTokenHeaders(): Record<string, string> {
  const uploadToken = import.meta.env.VITE_MEETING_UPLOAD_TOKEN as string | undefined;
  return uploadToken ? { 'x-upload-token': uploadToken } : {};
}

async function readError(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  return (body as { error?: string }).error || `${fallback} (${res.status})`;
}

/** 서버가 명확히 거절한 오류(4xx). 다시 보내도 같은 결과라 재시도하지 않습니다. */
class NonRetryableUploadError extends Error {}

/** 조각 하나를 올립니다. 네트워크 오류·5xx 는 잠깐 쉬었다가 재시도합니다. */
async function uploadPart(key: string, index: number, chunk: Blob) {
  const url = `${getApiBase()}/api/blob-upload/part?key=${encodeURIComponent(key)}&index=${index}`;
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', ...uploadTokenHeaders() },
        body: chunk,
      });
      if (res.ok) return;
      const message = await readError(res, '조각 업로드 실패');
      if (res.status < 500) throw new NonRetryableUploadError(message);
      lastError = new Error(message);
    } catch (err) {
      if (err instanceof NonRetryableUploadError) throw err;
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
  throw lastError instanceof Error ? lastError : new Error('조각 업로드 실패');
}

/**
 * Blob 을 Netlify Blobs 의 key 위치에 저장합니다.
 * @param key videos/<groupId>/<날짜>/<파일> 또는 files/<groupId>/<저장파일명>
 * @param blob 올릴 데이터 (녹화 영상, 첨부 파일)
 * @param options.name 화면에 보일 원래 파일 이름
 * @param options.mime 콘텐츠 타입 (비어 있으면 서버가 확장자로 추정)
 */
export async function uploadToNetlifyBlobs(
  key: string,
  blob: Blob,
  options: { name: string; mime?: string },
): Promise<NetlifyUploadResult> {
  // 빈 파일도 조각 1개(0바이트)로 올려야 complete 검증을 통과합니다.
  const parts = Math.max(1, Math.ceil(blob.size / NETLIFY_UPLOAD_PART_BYTES));

  // 조각 번호를 하나씩 꺼내 가는 작업자 PARALLEL_UPLOADS 개를 돌립니다.
  let next = 0;
  const worker = async () => {
    while (next < parts) {
      const index = next++;
      const start = index * NETLIFY_UPLOAD_PART_BYTES;
      await uploadPart(key, index, blob.slice(start, start + NETLIFY_UPLOAD_PART_BYTES));
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_UPLOADS, parts) }, worker));

  const res = await fetch(`${getApiBase()}/api/blob-upload/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...uploadTokenHeaders() },
    body: JSON.stringify({ key, parts, size: blob.size, mime: options.mime || blob.type, name: options.name }),
  });
  if (!res.ok) throw new Error(await readError(res, '업로드 확정 실패'));
  return (await res.json()) as NetlifyUploadResult;
}

/** 저장용 파일 이름. URL·저장 key 에 한글이 들어가지 않게 타임스탬프+난수+확장자로 만듭니다. (Express 와 같은 규칙) */
export function storedUploadFileName(originalName: string) {
  const match = /\.[a-z0-9]{1,8}$/i.exec(originalName || '');
  const ext = match ? match[0].toLowerCase() : '';
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
}
