/**
 * 회의 영상 챕터(유튜브식 타임라인) 관련 순수 함수 모음.
 * 서버가 만들어 준 챕터 JSON을 화면에서 쓰기 좋은 형태로 다듬습니다.
 */

export type MeetingChapter = {
  /** 챕터 시작 지점 (초 단위) */
  time: number;
  title: string;
  summary?: string;
};

/** 초 → "MM:SS" 또는 1시간 넘으면 "H:MM:SS" */
export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "1:02:03" / "02:03" / "123" 을 초로 변환. 실패하면 null */
export function parseTimestamp(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(:\d{1,2}){0,2}$/.test(trimmed)) return null;
  const parts = trimmed.split(':').map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/**
 * 서버/DB에서 온 값(신뢰할 수 없는 형태)을 MeetingChapter[]로 정규화합니다.
 * - time이 숫자가 아니면 "MM:SS" 문자열도 허용
 * - 제목 없는 항목은 버림
 * - 시간순 정렬 + 같은 시각 중복 제거
 * - duration을 알면 그보다 뒤에 있는 챕터는 버림
 */
export function normalizeChapters(raw: unknown, durationSec?: number): MeetingChapter[] {
  if (!Array.isArray(raw)) return [];

  const list: MeetingChapter[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;

    let time: number | null = null;
    if (typeof rec.time === 'number' && Number.isFinite(rec.time)) {
      time = Math.max(0, Math.floor(rec.time));
    } else if (typeof rec.time === 'string') {
      time = parseTimestamp(rec.time);
    }
    if (time === null) continue;

    const title = typeof rec.title === 'string' ? rec.title.trim() : '';
    if (!title) continue;

    const summary = typeof rec.summary === 'string' ? rec.summary.trim() : undefined;
    list.push({ time, title, summary: summary || undefined });
  }

  const withinDuration = typeof durationSec === 'number' && durationSec > 0
    ? list.filter((c) => c.time <= durationSec + 1)
    : list;

  withinDuration.sort((a, b) => a.time - b.time);

  const deduped: MeetingChapter[] = [];
  for (const c of withinDuration) {
    if (deduped.length > 0 && deduped[deduped.length - 1].time === c.time) continue;
    deduped.push(c);
  }
  return deduped;
}

/**
 * 현재 재생 위치에 해당하는 챕터 index.
 * 첫 챕터 시작 전이면 -1.
 */
export function findActiveChapterIndex(chapters: MeetingChapter[], currentTime: number): number {
  let active = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].time <= currentTime + 0.25) active = i;
    else break;
  }
  return active;
}

/** 챕터 구간 길이(다음 챕터까지). 마지막이면 duration까지. */
export function getChapterDuration(
  chapters: MeetingChapter[],
  index: number,
  durationSec?: number,
): number | null {
  const cur = chapters[index];
  if (!cur) return null;
  const next = chapters[index + 1];
  const end = next ? next.time : durationSec;
  if (typeof end !== 'number' || !Number.isFinite(end)) return null;
  return Math.max(0, end - cur.time);
}
