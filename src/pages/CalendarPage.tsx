import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';

// 캘린더에 표시할 회의 (문서/AI요약 탭과 같은 meetings 소스)
type MeetingRow = {
  id: string;
  title: string | null;
  date: string;
  group_id: string;
};

// 내 회의 링크 — DB 없이 이 브라우저(localStorage)에만 저장합니다.
type LinkItem = { id: string; name: string; url: string };

const LINKS_KEY = 'grop:meetingLinks';

function loadLinks(): LinkItem[] {
  try {
    const raw = localStorage.getItem(LINKS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLinks(list: LinkItem[]) {
  try {
    localStorage.setItem(LINKS_KEY, JSON.stringify(list));
  } catch {
    /* 저장 실패는 무시 (프라이빗 모드 등) */
  }
}

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THUR', 'FRI', 'SAT', 'SUN'];

/** yyyy-mm-dd 키 (로컬 기준) */
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 해당 월의 달력 6주(42칸)를 월요일 시작으로 만듭니다. */
function buildMonthCells(year: number, month: number) {
  const first = new Date(year, month, 1);
  // 월요일 시작: 일(0)→6, 월(1)→0 ...
  const startPad = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - startPad);

  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return { date, otherMonth: date.getMonth() !== month };
  });
}

function fmtTime(dateStr: string) {
  const d = new Date(dateStr);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${h}:${m}${ampm}`;
}

/**
 * 캘린더 페이지
 * - 왼쪽: 월 달력 (회의를 날짜별 이벤트로 표시)
 * - 오른쪽: 오늘 일정 / 다가오는 일정
 * - 아래: 내 회의 링크 (localStorage CRUD)
 */
export default function CalendarPage() {
  const navigate = useNavigate();
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [links, setLinks] = useState<LinkItem[]>(loadLinks);

  // 내가 속한 그룹의 회의를 모두 가져옵니다.
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        navigate('/');
        return;
      }
      const { data: memberRows } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', sessionData.session.user.id);

      const ids = [...new Set((memberRows ?? []).map((r) => r.group_id).filter(Boolean))];
      if (!mounted || ids.length === 0) {
        if (mounted) setMeetings([]);
        return;
      }
      const { data } = await supabase
        .from('meetings')
        .select('id, title, date, group_id')
        .in('group_id', ids)
        .order('date', { ascending: true });
      if (mounted) setMeetings(data ?? []);
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [navigate]);

  useEffect(() => {
    saveLinks(links);
  }, [links]);

  const cells = useMemo(() => buildMonthCells(cursor.y, cursor.m), [cursor]);

  // 날짜(yyyy-mm-dd) → 그날 회의 목록
  const byDay = useMemo(() => {
    const map = new Map<string, MeetingRow[]>();
    for (const m of meetings) {
      const key = ymd(new Date(m.date));
      const arr = map.get(key);
      if (arr) arr.push(m);
      else map.set(key, [m]);
    }
    return map;
  }, [meetings]);

  const todayKey = ymd(today);
  const todayItems = byDay.get(todayKey) ?? [];
  const upcoming = useMemo(
    () => meetings.filter((m) => new Date(m.date).getTime() > today.getTime()).slice(0, 6),
    [meetings, today],
  );

  const openMeeting = (m: MeetingRow) => navigate(`/group/${m.group_id}/meeting/${m.id}`);

  const shiftMonth = (delta: number) => {
    setCursor((c) => {
      const d = new Date(c.y, c.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  };

  // 내 회의 링크 추가 — 간단히 prompt 로 이름/URL 만 받습니다.
  const addLink = () => {
    const name = window.prompt('회의 이름')?.trim();
    if (!name) return;
    const url = window.prompt('회의 링크 (URL)')?.trim();
    if (!url) return;
    setLinks((prev) => [...prev, { id: crypto.randomUUID(), name, url }]);
  };

  const removeLink = (id: string) => {
    if (window.confirm('이 링크를 삭제할까요?')) {
      setLinks((prev) => prev.filter((l) => l.id !== id));
    }
  };

  return (
    <AppShell activePage="calendar">
      <div className="page calendar-page">
        <div className="calendar-layout">
          {/* ---------- 달력 ---------- */}
          <div className="calendar-card">
            <div className="calendar-nav">
              <button
                type="button"
                className="calendar-nav-button"
                aria-label="이전 달"
                onClick={() => shiftMonth(-1)}
              >
                <Icon name="chevron-left" />
              </button>
              <button
                type="button"
                className="calendar-nav-button"
                aria-label="다음 달"
                onClick={() => shiftMonth(1)}
              >
                <Icon name="chevron-right" />
              </button>
              <span className="calendar-month-label">
                {cursor.y}년 {cursor.m + 1}월 <span aria-hidden>▾</span>
              </span>
            </div>

            <div className="calendar-grid">
              {WEEKDAYS.map((w) => (
                <div className="calendar-weekday" key={w}>{w}</div>
              ))}

              {cells.map(({ date, otherMonth }) => {
                const key = ymd(date);
                const isToday = key === todayKey;
                const dayMeetings = byDay.get(key) ?? [];
                return (
                  <div
                    key={key}
                    className={`calendar-day${otherMonth ? ' is-other-month' : ''}${isToday ? ' is-today' : ''}`}
                  >
                    <span className="day-number">{date.getDate()}</span>
                    {/* 그날 회의는 이벤트 칩으로, 누르면 회의록으로 이동 */}
                    {dayMeetings.map((m) => (
                      <span
                        key={m.id}
                        className="calendar-event"
                        title={m.title || '회의'}
                        onClick={() => openMeeting(m)}
                      >
                        {m.title || '회의'}
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ---------- 우측 레일 ---------- */}
          <aside className="calendar-rail">
            <section className="rail-card">
              <div className="rail-head">
                <h2>오늘 일정</h2>
                <a
                  href="/documents"
                  onClick={(e) => { e.preventDefault(); navigate('/documents'); }}
                >
                  더보기 &gt;
                </a>
              </div>
              <div className="rail-body">
                {todayItems.length === 0 ? (
                  <p className="rail-empty">오늘 예정된 회의가 없습니다.</p>
                ) : (
                  todayItems.map((m) => (
                    <div key={m.id} className="rail-item" onClick={() => openMeeting(m)}>
                      <div className="t">{m.title || '회의'}</div>
                      <div className="d">{fmtTime(m.date)}</div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rail-card">
              <div className="rail-head">
                <h2>다가오는 일정</h2>
                <a
                  href="/documents"
                  onClick={(e) => { e.preventDefault(); navigate('/documents'); }}
                >
                  더보기 &gt;
                </a>
              </div>
              <div className="rail-body">
                {upcoming.length === 0 ? (
                  <p className="rail-empty">다가오는 회의가 없습니다.</p>
                ) : (
                  upcoming.map((m) => (
                    <div key={m.id} className="rail-item" onClick={() => openMeeting(m)}>
                      <div className="t">{m.title || '회의'}</div>
                      <div className="d">{fmtTime(m.date)}</div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </aside>
        </div>

        {/* ---------- 내 회의 링크 ---------- */}
        <section className="meeting-links">
          <div className="meeting-links-head">
            <h2>내 회의 링크</h2>
            <p>자주 사용하는 링크를 관리하세요</p>
          </div>

          <div className="meeting-links-grid">
            {links.map((l) => (
              <div className="link-card" key={l.id}>
                <span className="name">{l.name}</span>
                <span className="url">{l.url}</span>
                <div className="actions">
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard?.writeText(l.url)}
                  >
                    <Icon name="copy" />
                    복사
                  </button>
                  <button
                    type="button"
                    onClick={() => window.open(l.url, '_blank', 'noopener')}
                  >
                    열기
                  </button>
                  <button type="button" onClick={() => removeLink(l.id)}>
                    삭제
                  </button>
                </div>
              </div>
            ))}

            <div
              className="link-card link-card--add"
              role="button"
              tabIndex={0}
              onClick={addLink}
              onKeyDown={(e) => { if (e.key === 'Enter') addLink(); }}
            >
              <span className="plus">+</span>
              새 회의 링크 생성하기
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
