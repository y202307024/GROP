import { supabase } from '../services/supabaseClient';

/** storage 경로 또는 public URL → 재생 가능한 signed URL */
export async function resolveMeetingVideoUrl(videoUrl: string): Promise<string> {
  let path = videoUrl.trim();
  if (!path) return videoUrl;

  if (path.startsWith('http')) {
    const marker = '/meeting-videos/';
    const idx = path.indexOf(marker);
    if (idx >= 0) {
      path = decodeURIComponent(path.slice(idx + marker.length).split('?')[0] ?? '');
    } else {
      return videoUrl;
    }
  }

  const { data, error } = await supabase.storage
    .from('meeting-videos')
    .createSignedUrl(path, 60 * 60);

  if (error || !data?.signedUrl) {
    return videoUrl;
  }
  return data.signedUrl;
}

export function pickMeetingRecorderMimeType(hasVideo: boolean): string {
  const candidates = hasVideo
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  : ['audio/webm;codecs=opus', 'audio/webm'];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? (hasVideo ? 'video/webm' : 'audio/webm');
}
