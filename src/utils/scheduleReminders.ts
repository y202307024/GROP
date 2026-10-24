/**
 * 일정에 적어 둔 "N분 전" 알림을 그룹 종알림으로 보냅니다.
 * 일정은 이 브라우저에만 있으므로, 그 브라우저가 열려 있을 때만 시각을 확인합니다.
 */
import { notifyGroupMembers } from './notifications';
import { supabase } from '../services/supabaseClient';
import { loadLocalSchedules, occurrenceStart, occursOn, type LocalSchedule } from './localSchedules';

const SENT_KEY = 'grop.calendar.sentReminders';
const SENT_MAX = 300;

function loadSent() {
  try {
    const raw = localStorage.getItem(SENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set<string>();
  }
}

function markSent(key: string) {
  const next = [...loadSent(), key].slice(-SENT_MAX);
  try {
    localStorage.setItem(SENT_KEY, JSON.stringify(next));
  } catch {
    // 저장이 막혀도 이번 탭의 inflight가 같은 알림을 바로 다시 보내지 않습니다.
  }
}

function koreanWhen(when: Date) {
  const h = when.getHours();
  return `${when.getMonth() + 1}월 ${when.getDate()}일 ${h >= 12 ? '오후' : '오전'} ${h % 12 || 12}:${String(when.getMinutes()).padStart(2, '0')}`;
}

/** 지금 보내야 하는 발생분이면 알림 시각과 중복 키를 돌려줍니다. */
function dueReminder(sc: LocalSchedule, day: Date, now: Date) {
  const start = occurrenceStart(sc, day);
  const remindMin = typeof sc.remindMinutes === 'number' && sc.remindMinutes >= 0 ? sc.remindMinutes : 10;
  // 정시는 시작 시각부터 2분 안에, 그 외는 "N분 전"부터 시작 전까지 한 번만 보냅니다.
  const open = remindMin <= 0 ? start.getTime() : start.getTime() - remindMin * 60_000;
  const close = remindMin <= 0 ? start.getTime() + 2 * 60_000 : start.getTime();
  if (now.getTime() < open || now.getTime() >= close) return null;
  return { start, key: `${sc.id}:${start.getTime()}` };
}

const inflight = new Set<string>();

/** 로그인된 동안, 시각이 된 일정 알림을 그룹 멤버 종에 넣습니다. */
export async function dispatchDueScheduleReminders(now = new Date()) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;

  const schedules = loadLocalSchedules();
  const sent = loadSent();
  // 알림은 최대 24시간 전이라, 어제·오늘·내일 발생분만 보면 됩니다.
  for (let i = -1; i <= 1; i += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    for (const sc of schedules) {
      if (!sc.groupId || !occursOn(sc, day)) continue;
      const due = dueReminder(sc, day, now);
      if (!due || sent.has(due.key) || inflight.has(due.key)) continue;
      inflight.add(due.key);
      try {
        await notifyGroupMembers({
          groupId: sc.groupId,
          type: 'schedule_remind',
          title: `${sc.title} 회의 알림`,
          body: `${koreanWhen(due.start)}에 시작됩니다.`,
          link: '/calendar',
          excludeSelf: false,
        });
        markSent(due.key);
      } catch (err) {
        console.warn('일정 알림을 보내지 못했습니다:', err);
      } finally {
        inflight.delete(due.key);
      }
    }
  }
}
