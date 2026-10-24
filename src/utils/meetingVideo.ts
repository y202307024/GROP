import { supabase } from '../services/supabaseClient';
import { getApiBase } from './apiBase';

/** 바이트를 B/KB/MB/GB로 짧게 바꿉니다. 그룹 저장 공간과 회의 영상 용량이 같은 표기를 씁니다. */
export function formatStorageBytes(bytes: number) {
  if (bytes < 1024) return `${Math.round(bytes)}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return mb >= 10 ? `${Math.round(mb)}MB` : `${mb.toFixed(1)}MB`;
  const gb = mb / 1024;
  return gb >= 10 ? `${Math.round(gb)}GB` : `${gb.toFixed(1)}GB`;
}

/** 목록·상세에 재생할 영상이 있는지. R2 키와 예전 디스크 주소를 같이 봅니다. */
export function meetingHasStoredVideo(source: {
  video_url?: string | null;
  video_key?: string | null;
} | null | undefined): boolean {
  if (!source) return false;
  return Boolean(source.video_url?.trim() || source.video_key?.trim());
}

/**
 * 영상 상태 문구. 상태가 없는 예전 디스크 영상은 아무것도 보여 주지 않습니다.
 * backed_up 도 저장이 끝난 상태라 화면에는 저장 완료로 둡니다.
 */
export function meetingVideoStatusLabel(status: string | null | undefined): string | null {
  if (status === 'pending_upload') return '업로드 대기';
  if (status === 'uploaded' || status === 'backed_up') return '저장 완료';
  if (status === 'failed') return '업로드 실패';
  return null;
}

const HIDDEN_MEETINGS_KEY = 'grop.hiddenMeetings';
/**
 * 행 삭제가 막혀도 목록에서 빼기 위한 제목 표시.
 * video_status 는 pending/uploaded/backed_up/failed 만 허용해서 'removed' 를 넣을 수 없습니다.
 */
export const REMOVED_MEETING_TITLE_PREFIX = '__removed__:';

/** 목록에서 뺀 회의. 지운 제목 표시, 또는 이 브라우저에 기억한 id 입니다. */
export function isListedMeeting(row: { id: string; title?: string | null; video_status?: string | null }) {
  if (row.video_status === 'removed') return false;
  if ((row.title ?? '').startsWith(REMOVED_MEETING_TITLE_PREFIX)) return false;
  return !hiddenMeetingIds().has(row.id);
}

function readHiddenIds(storage: Storage): string[] {
  try {
    const raw = JSON.parse(storage.getItem(HIDDEN_MEETINGS_KEY) || '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

/** 이 브라우저에서 지운 회의. 목록을 다시 읽어도 그 탭에 남지 않게 합니다. */
export function hiddenMeetingIds(): Set<string> {
  const ids = new Set<string>(readHiddenIds(localStorage));
  // 예전에는 탭을 닫으면 사라지는 저장소에 두었습니다. 그 목록도 같이 읽습니다.
  try {
    for (const id of readHiddenIds(sessionStorage)) ids.add(id);
  } catch {
    // sessionStorage 를 못 읽어도 localStorage 목록은 유지합니다.
  }
  return ids;
}

function rememberHiddenMeeting(id: string) {
  const ids = hiddenMeetingIds();
  ids.add(id);
  try {
    localStorage.setItem(HIDDEN_MEETINGS_KEY, JSON.stringify([...ids].slice(-200)));
  } catch {
    // 저장이 막혀도 방금 지운 화면에서는 목록에서 빼집니다.
  }
}

/** 로그인 세션으로 서버에 행 삭제를 맡깁니다. 브라우저 삭제 권한이 없을 때의 경로입니다. */
async function deleteMeetingOnServer(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: '로그인이 필요합니다.' };
  try {
    const res = await fetch(`${getApiBase()}/api/meetings/record/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return { ok: true };
    if (res.status === 404) return { ok: false, error: '회의 삭제 서버가 아직 없습니다.' };
    const body = await res.json().catch(() => ({}));
    const message = (body as { error?: string }).error || '회의를 목록에서 지우지 못했습니다.';
    return { ok: false, error: message };
  } catch (err) {
    const message = err instanceof Error ? err.message : '네트워크 오류';
    return { ok: false, error: message };
  }
}

async function deleteMeetingRow(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = await supabase.from('meetings').delete().eq('id', id).select('id');
  if (!client.error && client.data?.length) return { ok: true };
  return deleteMeetingOnServer(id);
}

/**
 * 행 삭제가 막히면 제목을 숨김 표시로 바꿉니다.
 * 상태 칸에 'removed' 를 넣으면 DB 제약 때문에 삭제가 실패합니다.
 */
async function hideMeetingRow(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const title = `${REMOVED_MEETING_TITLE_PREFIX}${id}`;
  const full = {
    title,
    summary: null,
    video_url: null,
    video_key: null,
    video_status: null,
    video_size_bytes: null,
  };
  const first = await supabase.from('meetings').update(full).eq('id', id).select('id');
  if (!first.error && first.data?.length) return { ok: true };
  // 영상 칸이 없는 배포에서는 제목과 주소만 바꿉니다.
  if (first.error && /video_key|video_status|video_size_bytes|summary/i.test(first.error.message)) {
    const second = await supabase.from('meetings').update({ title, video_url: null }).eq('id', id).select('id');
    if (!second.error && second.data?.length) return { ok: true };
    return { ok: false, error: second.error?.message || first.error.message };
  }
  return { ok: false, error: first.error?.message || '회의를 목록에서 지우지 못했습니다.' };
}

/**
 * 이 회의 전체를 목록에서 뺍니다. 영상이 없어도 행을 지웁니다.
 * 행 삭제가 막혀 있으면 제목 표시로 숨기고, 이 브라우저 목록에서도 빼 둡니다.
 */
export async function deleteMeetingRecord(meeting: {
  id: string;
  video_url?: string | null;
  video_key?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await deleteMeetingRow(meeting.id);
  if (!row.ok) {
    const hidden = await hideMeetingRow(meeting.id);
    if (!hidden.ok) {
      // DB 가 행을 그대로 둬도, 이 브라우저의 회의 목록에서는 바로 빼 둡니다.
      rememberHiddenMeeting(meeting.id);
      return { ok: true };
    }
  }
  rememberHiddenMeeting(meeting.id);
  // 파일 삭제가 실패해도 목록에서 뺀 결과는 유지합니다.
  if (meetingHasStoredVideo(meeting)) await deleteStoredMeetingVideo(meeting);
  return { ok: true };
}

/**
 * 이 회의의 녹화 파일만 지웁니다. 회의 행과 요약은 남기고 영상 칸만 비웁니다.
 */
export async function deleteStoredMeetingVideo(meeting: {
  id: string;
  video_url?: string | null;
  video_key?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = meeting.video_key?.trim() || '';
  const path = meeting.video_url?.trim() || '';
  if (!key && !path) return { ok: false, error: '지울 녹화 영상이 없습니다.' };

  const uploadToken = import.meta.env.VITE_MEETING_UPLOAD_TOKEN as string | undefined;
  const headers: Record<string, string> = {};
  if (uploadToken) headers['x-upload-token'] = uploadToken;
  const params = new URLSearchParams();
  if (key) params.set('key', key);
  if (path) params.set('path', path);

  try {
    const res = await fetch(`${getApiBase()}/api/meetings/video?${params.toString()}`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok && res.status !== 404) {
      const body = await res.json().catch(() => ({}));
      const message = (body as { error?: string }).error || `녹화 영상을 지우지 못했습니다 (${res.status})`;
      return { ok: false, error: message };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '네트워크 오류';
    return { ok: false, error: `녹화 영상을 지우지 못했습니다. (${message})` };
  }

  const cleared = {
    video_url: null,
    video_key: null,
    video_status: null,
    video_size_bytes: null,
  };
  const first = await supabase.from('meetings').update(cleared).eq('id', meeting.id);
  if (first.error && /video_key|video_status|video_size_bytes/i.test(first.error.message)) {
    const second = await supabase.from('meetings').update({ video_url: null }).eq('id', meeting.id);
    if (second.error) return { ok: false, error: second.error.message };
  } else if (first.error) {
    return { ok: false, error: first.error.message };
  }
  return { ok: true };
}

/**
 * 재생 주소.
 * video_key(R2)가 있으면 서버가 1시간짜리 주소를 발급합니다.
 * 없으면 예전 video_url(/videos/...)을 서버 디스크 재생 주소로 바꿉니다.
 */
export async function resolveMeetingVideoUrl(
  videoUrl: string | null | undefined,
  videoKey?: string | null,
): Promise<string> {
  const key = videoKey?.trim();
  if (key) {
    const res = await fetch(`${getApiBase()}/api/meetings/video-url?key=${encodeURIComponent(key)}`);
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const message = (errBody as { error?: string }).error || `재생 주소를 받지 못했습니다 (${res.status})`;
      // 디스크에도 파일이 있으면 R2가 잠깐 실패해도 예전 주소로 재생합니다.
      if (videoUrl?.trim()) return resolveLegacyMeetingVideoUrl(videoUrl);
      throw new Error(message);
    }
    const data = (await res.json()) as { url?: string };
    if (!data.url) throw new Error('재생 주소를 받지 못했습니다');
    return data.url;
  }
  return resolveLegacyMeetingVideoUrl(videoUrl || '');
}

/**
 * DB의 video_url → 서버 컴퓨터에서 재생하는 주소
 * 예전 영상은 Storage가 아니라 서버 디스크에 있으므로 Supabase Storage는 호출하지 않습니다.
 */
function resolveLegacyMeetingVideoUrl(videoUrl: string): string {
  let path = videoUrl.trim();
  if (!path) return videoUrl;

  if (path.startsWith('http')) {
    const videosMarker = '/videos/';
    const videosIdx = path.indexOf(videosMarker);
    if (videosIdx >= 0) {
      path = decodeURIComponent(path.slice(videosIdx + videosMarker.length).split('?')[0] ?? '');
    } else {
      const marker = '/meeting-videos/';
      const idx = path.indexOf(marker);
      if (idx < 0) return videoUrl;
      path = decodeURIComponent(path.slice(idx + marker.length).split('?')[0] ?? '');
    }
  }

  if (path.endsWith('.url.txt')) path = path.slice(0, -'.url.txt'.length);

  // DB에 localhost가 들어 있어도, 호스트는 VITE_API_URL(서버 PC)로 붙입니다.
  return `${getApiBase()}/videos/${path}`;
}

export function pickMeetingRecorderMimeType(hasVideo: boolean, hasAudio = true): string {
  // 마이크가 없을 때는 opus(오디오) 코덱을 빼야 MediaRecorder 가 안정적으로 돕니다.
  const candidates = hasVideo
    ? hasAudio
      ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    : ['audio/webm;codecs=opus', 'audio/webm'];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? (hasVideo ? 'video/webm' : 'audio/webm');
}

/**
 * MediaRecorder로 만든 webm은 duration/Cues 메타데이터가 없어서
 * video.currentTime 대입(seek)이 무시되는 경우가 있습니다.
 * 아주 큰 값으로 한 번 이동시켜 브라우저가 끝까지 훑으며 길이를 계산하게 한 뒤 0으로 되돌립니다.
 * (챕터 타임라인 점프가 동작하려면 재생 전에 한 번 거쳐야 합니다.)
 *
 * @returns 확정된 재생 길이(초). 알아내지 못하면 0
 */
export function primeWebmSeeking(video: HTMLVideoElement): Promise<number> {
  return new Promise((resolve) => {
    if (Number.isFinite(video.duration) && video.duration > 0) {
      resolve(video.duration);
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('timeupdate', onTimeUpdate);
      window.clearTimeout(timer);
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      try {
        video.currentTime = 0;
      } catch {
        // 일부 브라우저는 되돌리기가 실패할 수 있으나 길이는 이미 확정됨
      }
      resolve(duration);
    };

    const onTimeUpdate = () => finish();
    // 메타데이터가 끝내 안 잡히는 파일도 있어 3초 뒤 포기
    const timer = window.setTimeout(finish, 3000);
    video.addEventListener('timeupdate', onTimeUpdate);

    try {
      video.currentTime = 1e101;
    } catch {
      finish();
    }
  });
}