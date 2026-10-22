/**
 * 직접 추가한 일정(LocalSchedule) 공용 모듈
 * 캘린더 페이지에서 등록한 일정을 메인 페이지의 "예정된 회의" 문구도 똑같이 읽어야 해서,
 * 타입/저장소/반복 규칙을 한 곳으로 모았습니다(두 페이지의 계산이 달라지지 않게).
 */

// 반복 종류 — 'none'이면 시작 날짜 하루만, 나머지는 시작 날짜 이후 규칙대로 반복(수정/삭제는 반복 전체에 적용)
export type RepeatType = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';

// 팝업으로 추가한 일정(아직 DB 저장 없이 이 브라우저 localStorage에만 보관됩니다)
// date = 시작 일시. endDate/repeat/remindMinutes는 수정 패널에서 넣는 선택 값이라,
// 없는 기존 일정도 그대로 동작합니다(하위 호환). remindMinutes는 저장만 하고 실제 알림은 보내지 않습니다.
export type LocalSchedule = {
  id: string;
  title: string;
  date: string;
  groupId: string;
  endDate?: string;
  repeat?: { type: RepeatType; weekdays?: number[] };
  remindMinutes?: number;
};

// 임시 저장소 — DB 연결 전까지 팝업으로 추가한 일정을 브라우저 localStorage에 보관해서
// 다른 페이지에 갔다 와도(컴포넌트가 다시 만들어져도) 유지되게 합니다. DB가 정해지면 교체합니다.
export const LOCAL_SCHEDULES_KEY = 'grop.calendar.localSchedules';

export function loadLocalSchedules(): LocalSchedule[] {
  try {
    const raw = localStorage.getItem(LOCAL_SCHEDULES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    // 깨진 값이 섞여 있어도 화면이 죽지 않게, 필요한 필드가 문자열인 것만 남깁니다.
    return parsed.filter(
      (x): x is LocalSchedule =>
        !!x && typeof x.id === 'string' && typeof x.title === 'string' &&
        typeof x.date === 'string' && typeof x.groupId === 'string',
    );
  } catch {
    return [];
  }
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** 그 날짜(day)에 일정이 있는지 — 반복 일정은 시작 날짜 이후에만, 규칙에 맞는 날에 나타납니다 */
export function occursOn(sc: LocalSchedule, day: Date) {
  const start = new Date(sc.date);
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const target = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  if (target < startDay) return false;
  switch (sc.repeat?.type) {
    case 'daily':
      return true;
    case 'weekly': {
      // 요일을 따로 고르지 않았다면 시작 날짜의 요일로 반복
      const days = sc.repeat.weekdays?.length ? sc.repeat.weekdays : [start.getDay()];
      return days.includes(target.getDay());
    }
    case 'biweekly':
      // 시작 날짜로부터 14일 간격(같은 요일)
      return Math.round((target.getTime() - startDay.getTime()) / 86400000) % 14 === 0;
    case 'monthly':
      // 31일 일정은 31일이 없는 달에는 건너뜁니다
      return target.getDate() === startDay.getDate();
    case 'yearly':
      // 2월 29일 일정은 윤년에만 나타납니다
      return target.getMonth() === startDay.getMonth() && target.getDate() === startDay.getDate();
    default:
      return isSameDay(target, startDay);
  }
}


/**
 * 지금 이후로 가장 가까운 일정 한 건(반복 일정은 그 발생분 기준). 없으면 null.
 * 반복 일정이 끝없이 이어지므로 앞으로 days일 안에서만 찾습니다(캘린더의 UPCOMING_DAYS와 같은 이유).
 * 시각은 일정의 원래 시작 시각(date의 시:분)을 그 날짜에 붙여서 계산합니다.
 */
export function findNextLocalSchedule(
  schedules: LocalSchedule[],
  now: Date,
  days: number,
): { schedule: LocalSchedule; when: Date } | null {
  let best: { schedule: LocalSchedule; when: Date } | null = null;
  for (let i = 0; i <= days; i += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    for (const sc of schedules) {
      if (!occursOn(sc, day)) continue;
      const s = new Date(sc.date);
      const when = new Date(day.getFullYear(), day.getMonth(), day.getDate(), s.getHours(), s.getMinutes());
      if (when.getTime() > now.getTime() && (!best || when < best.when)) best = { schedule: sc, when };
    }
    // 날짜 순으로 보고 있으므로 이 날에 찾았으면 더 먼 날은 볼 필요가 없습니다
    if (best) break;
  }
  return best;
}
