import { getApiBase } from './apiBase';

/**
 * DB의 video_url → 서버 컴퓨터에서 재생하는 주소
 * 영상 파일은 Storage에 없고 서버 디스크에만 있으므로 Supabase Storage는 호출하지 않습니다.
 */
export async function resolveMeetingVideoUrl(videoUrl: string): Promise<string> {
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

export function pickMeetingRecorderMimeType(hasVideo: boolean): string {
  const candidates = hasVideo
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
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