import { supabase } from '../services/supabaseClient';
import { getApiBase } from './apiBase';

/**
 * storage 경로 → 재생 가능한 URL
 * 새 녹화본은 내 서버 컴퓨터 디스크에 있으므로 /videos 경로로 바로 접근합니다.
 * 마이그레이션 이전에 Supabase Storage에 저장됐던 예전 녹화본은
 * 로컬 서버에서 못 찾으면 예전처럼 signed URL 로 폴백합니다.
 */
export async function resolveMeetingVideoUrl(videoUrl: string): Promise<string> {
  let path = videoUrl.trim();
  if (!path) return videoUrl;

  if (path.startsWith('http')) {
    const marker = '/meeting-videos/';
    const idx = path.indexOf(marker);
    if (idx < 0) return videoUrl; // 알 수 없는 외부 URL이면 그대로 사용
    path = decodeURIComponent(path.slice(idx + marker.length).split('?')[0] ?? '');
  }

  const localUrl = `${getApiBase()}/videos/${path}`;

  try {
    const head = await fetch(localUrl, { method: 'HEAD' });
    if (head.ok) return localUrl;
  } catch {
    // 서버 컴퓨터가 꺼져있거나 접속 불가 → 예전 Supabase Storage 경로로 폴백 시도
  }

  const { data, error } = await supabase.storage
    .from('meeting-videos')
    .createSignedUrl(path, 60 * 60);

  if (error || !data?.signedUrl) {
    return localUrl; // 둘 다 실패하면 로컬 URL 그대로 반환 (video 태그의 onError에서 처리됨)
  }
  return data.signedUrl;
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