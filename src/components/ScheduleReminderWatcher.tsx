/**
 * 앱이 열려 있는 동안 일정 알림 시각을 확인합니다.
 * 회의방처럼 AppShell이 없는 화면에서도 같은 타이머가 돌게 App 아래에 둡니다.
 */
import { useEffect } from 'react';
import { dispatchDueScheduleReminders } from '../utils/scheduleReminders';

export default function ScheduleReminderWatcher() {
  useEffect(() => {
    let stop = false;
    const tick = () => {
      if (!stop) void dispatchDueScheduleReminders();
    };
    tick();
    const id = window.setInterval(tick, 30_000);
    window.addEventListener('focus', tick);
    return () => {
      stop = true;
      window.clearInterval(id);
      window.removeEventListener('focus', tick);
    };
  }, []);

  return null;
}
