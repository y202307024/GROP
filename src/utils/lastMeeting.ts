/** 방금 저장한 회의록 id. AI 요약 탭이 그 행을 바로 고르게 합니다. */
const LAST_MEETING_KEY = 'grop:lastMeetingId';

export function rememberLastMeeting(id: string) {
  if (!id) return;
  try {
    sessionStorage.setItem(LAST_MEETING_KEY, id);
  } catch {
    /* 시크릿 모드 등 */
  }
}

export function readLastMeeting(): string | null {
  try {
    return sessionStorage.getItem(LAST_MEETING_KEY);
  } catch {
    return null;
  }
}
