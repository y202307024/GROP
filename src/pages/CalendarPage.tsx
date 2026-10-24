import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { createScaledPortal } from '../components/AppScaleLayer';
import { getAppShellScale } from '../hooks/useAppShellScale';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { isListedMeeting } from '../utils/meetingVideo';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import { useGroupMemberAvatars } from '../hooks/useGroupMemberAvatars';
import styles from './CalendarPage.module.css';
import {
  LOCAL_SCHEDULES_KEY,
  loadLocalSchedules,
  occursOn,
  type LocalSchedule,
  type RepeatType,
} from '../utils/localSchedules';

type MeetingRow = {
  id: string;
  title: string | null;
  date: string;
  group_id: string;
};

// 일정 등록/수정 패널 입력값(입력칸이 문자열이라 날짜/시간을 'YYYY-MM-DD', 'HH:mm'로 따로 들고 있다가 저장할 때 합칩니다)
// id가 null이면 "새 일정 등록", 값이 있으면 그 일정을 "수정"하는 중입니다(같은 패널·같은 입력칸을 씁니다).
type EditForm = {
  id: string | null;
  title: string;
  groupId: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  repeatType: RepeatType;
  weekdays: number[];
  remind: number;
};

// 등록/수정 패널의 반복 버튼 — 시안대로 4개가 전부입니다
const REPEAT_OPTIONS: { value: RepeatType; label: string }[] = [
  { value: 'none', label: '없음' },
  { value: 'daily', label: '매일' },
  { value: 'weekly', label: '매주' },
  { value: 'monthly', label: '매월' },
];
// 요일 칩은 월요일부터 보여줍니다(값은 Date.getDay() 기준: 일=0)
const WEEKDAY_CHIPS = [1, 2, 3, 4, 5, 6, 0];
const REMIND_STEP = 10; // 알림 − / + 버튼 단위(분)
const REMIND_MAX = 24 * 60;
// 오른쪽 패널(오늘/다가오는 일정)에 한 번에 보이는 카드 수 — 피그마 목록 박스가 카드 4장이 딱 맞는 높이입니다
const SIDE_LIST_MAX = 4;
// "다가오는 일정"은 한 달 단위로 끊어 보여줍니다: 오늘부터 +29일(오늘 포함 30일)까지만 읽습니다.
// 저장된 회의와 직접 등록한 일정(반복 포함) 모두 이 범위 안에 있는 것만 대상입니다.
const UPCOMING_DAYS = 29;

// 그룹별 스택 색(배경/글자) — groups 순서대로 돌려가며 씁니다. 같은 그룹의 회의·일정은 같은 색입니다.
const STACK_COLORS = [
  { bg: '#e6f4e8', fg: '#4f6340' },
  { bg: '#e3edf8', fg: '#3d5f8a' },
  { bg: '#fbeadc', fg: '#9a5a2c' },
  { bg: '#f8e4ea', fg: '#9a4560' },
  { bg: '#ece6f6', fg: '#5d4a8a' },
  { bg: '#f6f0d6', fg: '#80702a' },
];

type GroupOption = { id: string; name: string };

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THUR', 'FRI', 'SAT']; // 피그마 표기(THUR)를 따릅니다
// 5행(35칸) 고정이라, 그 달 1일의 요일에 따라 말일이 다섯째 주를 넘기는 달(예: 31일이
// 토요일인 달)이 생깁니다. 그 넘치는 날짜는 칸을 새로 만드는 대신, 마지막 줄의 같은
// 요일 칸에 "21/28"처럼 겹쳐 보여줍니다(overflowDay).
const WEEKS_SHOWN = 5;

type DayCell = {
  date: Date;
  day: number;
  inCurrentMonth: boolean;
  /** 마지막 줄에서, 5주를 넘겨 그리드 밖으로 밀려난 같은 요일의 날짜(있을 때만) */
  overflowDay?: number;
  overflowDate?: Date;
};

function formatMeetingTime(dateStr: string) {
  const d = new Date(dateStr);
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${String(hours).padStart(2, '0')}:${minutes}${ampm}`;
}

// 다가오는 일정 패널용 — 오늘이 아닌 날은 "10.21 10:00AM"처럼 날짜를 앞에 붙입니다(시간만으로는 며칠인지 알 수 없어서)
function formatUpcomingTime(dateStr: string, now: Date) {
  const d = new Date(dateStr);
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? formatMeetingTime(dateStr) : `${d.getMonth() + 1}.${d.getDate()} ${formatMeetingTime(dateStr)}`;
}

// 팝업 제목 옆에 옅게 보여줄 날짜 라벨(예: "10월 20일 (화)")
const KOREAN_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
function formatComposeDate(d: Date) {
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${KOREAN_WEEKDAYS[d.getDay()]})`;
}

/** 상세 팝업 시작 줄용 — "2026. 10. 12." */
function formatDotDate(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

/** 상세 팝업 시작 줄용 — "오후 2:00" */
function formatKoreanTime(dateStr: string) {
  const d = new Date(dateStr);
  const h = d.getHours();
  return `${h >= 12 ? '오후' : '오전'} ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function toDateInput(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function toTimeInput(d: Date) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 알림 라벨 — 0분은 "정시", 60분 이상은 "1시간 30분 전"처럼 */
function formatRemind(min: number) {
  if (min <= 0) return '정시';
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}시간 ${m ? `${m}분 ` : ''}전`;
}

/** 반복 안내 문구 — 예: "매주 화·목요일에 반복" */
function repeatHint(type: RepeatType, weekdays: number[], start: Date | null) {
  if (type === 'daily') return '매일 반복';
  if (type === 'monthly') return start ? `매월 ${start.getDate()}일에 반복` : '매월 반복';
  if (type === 'yearly') return start ? `매년 ${start.getMonth() + 1}월 ${start.getDate()}일에 반복` : '매년 반복';
  if (type === 'biweekly') return start ? `2주마다 ${KOREAN_WEEKDAYS[start.getDay()]}요일에 반복` : '2주마다 반복';
  if (type === 'weekly') {
    const names = WEEKDAY_CHIPS.filter((d) => weekdays.includes(d)).map((d) => KOREAN_WEEKDAYS[d]);
    return `매주 ${names.join('·')}요일에 반복`;
  }
  return '';
}

// 달력 스택(회의/직접 추가한 일정)을 눌렀을 때 상세 팝업에 보여줄 항목
// end = 그 발생분의 종료 시각(직접 추가한 일정만 있음 — 오른쪽 패널의 진행 상태 계산에 씁니다)
type DetailItem = { id: string; title: string; date: string; groupId: string | null; isLocal: boolean; end?: string };

// 오른쪽 패널 카드의 진행 상태 — 저장된 회의/직접 등록한 일정에 상태 필드가 없어서 시간으로 정합니다.
// 시작 전 = 예정, 시작~종료 사이 = 진행중, 종료 후 = 완료. 저장된 회의는 끝난 뒤에 기록되는 값이라
// 지난 시각이면 완료, 미래 시각이면 예정으로 봅니다(진행중이 될 수 없음).
type ScheduleStatus = '예정' | '진행중' | '완료';
function scheduleStatusOf(it: DetailItem, now: Date): ScheduleStatus {
  const start = new Date(it.date).getTime();
  if (now.getTime() < start) return '예정';
  const end = it.end ? new Date(it.end).getTime() : start;
  return now.getTime() <= end ? '진행중' : '완료';
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * 캘린더 페이지
 * - 사이드바 메뉴/페이지 파일까지 지웠다가(AppShell.tsx 주석 참고) 다시 살리면서, 이번에
 *   사용자가 보내준 피그마 변환 코드(Component5.tsx/.module.css — 2048x1152 캔버스)를
 *   기준으로 다시 맞췄습니다. 알림/프로필 아이콘은 그 코드에도 있지만 AppShell이 상단바로
 *   이미 공통으로 그려주고 있어서 여기서 또 넣지 않았습니다 — "오늘" 버튼 + 월 이동 +
 *   월별 달력 + 오늘 일정/다가오는 일정 패널만 이 페이지 몫입니다.
 */
export default function CalendarPage() {
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  // 연/월 라벨 옆 드롭다운 — 한 달씩 넘기지 않고 멀리 떨어진 날짜로 바로 건너뛸 때 씁니다.
  const [pickerOpen, setPickerOpen] = useState(false);

  // 팝업의 그룹 드롭다운 대신 오른쪽 패널의 그룹 선택에 쓸, 내가 속한 그룹 목록
  const [groups, setGroups] = useState<GroupOption[]>([]);
  // 오른쪽 패널 카드의 인원 수 — 회의별 참석자 정보가 없어서 그 그룹의 멤버 수를 씁니다(AI 요약 페이지와 같은 방식)
  const groupMembers = useGroupMemberAvatars(groups.map((g) => g.id));
  // 진행 상태("진행중")가 시간에 따라 바뀌므로 1분마다 현재 시각을 갱신합니다
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  // 일정 등록/수정 패널 — 달력에서 날짜 칸을 누르거나(등록) 상세 팝업의 [수정]을 누르면(수정)
  // 오른쪽 열이 이 패널로 바뀝니다(null이면 평소의 오늘/다가오는 일정). 등록과 수정은 id가 null인지로만 구분합니다.
  // 지금은 화면만 만든 단계라 저장해도 DB에는 넣지 않습니다(데이터 관리는 추후, 브라우저 localStorage에만 보관).
  const [editing, setEditing] = useState<EditForm | null>(null);
  // 달력에서 마지막으로 누른 날짜 — 팝업을 닫아도 강조(포커스)가 그 칸에 남고, 다른 칸을 누르면 옮겨갑니다.
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  // 날짜 칸 우클릭 시 커서 옆에 뜨는 작은 "일정 추가" 메뉴(null이면 닫힘). 메뉴의 버튼을 눌러야 팝업이 열립니다.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; date: Date } | null>(null);
  const [localSchedules, setLocalSchedules] = useState<LocalSchedule[]>(loadLocalSchedules);
  // 스택을 좌클릭하면 뜨는 "일정 상세" 팝업 — 그 날짜의 모든 스택(detailItems)을 담고,
  // 슬라이드 버튼(◀ ▶)으로 detailIndex를 옮겨가며 하나씩 봅니다(비어 있으면 닫힘).
  const [detailItems, setDetailItems] = useState<DetailItem[]>([]);
  const [detailIndex, setDetailIndex] = useState(0);
  const detail: DetailItem | null = detailItems[detailIndex] ?? null;
  // 직접 추가한 일정이면 원본(종료/반복/알림 포함) — detail의 date는 "그 날짜의 발생 시각"이라 원본을 따로 찾습니다.
  const detailSchedule = detail?.isLocal ? localSchedules.find((sc) => sc.id === detail.id) : undefined;
  const closeDetail = () => setDetailItems([]);
  // 처음 누른 스택부터 보여주고, 양 끝에서는 반대쪽 끝으로 돌아가지 않고 멈춥니다.
  const openDetail = (items: DetailItem[], index: number) => {
    setDetailItems(items);
    setDetailIndex(index);
  };
  const slideDetail = (step: number) =>
    setDetailIndex((i) => Math.min(Math.max(i + step, 0), detailItems.length - 1));

  // 일정이 바뀔 때마다 localStorage에 저장(저장 실패 — 용량/시크릿 모드 등 — 해도 화면은 계속 동작)
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_SCHEDULES_KEY, JSON.stringify(localSchedules));
    } catch {
      /* 저장만 포기 */
    }
  }, [localSchedules]);

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

      const ids = [...new Set((memberRows ?? []).map((row) => row.group_id).filter(Boolean))];
      if (!mounted) return;
      if (ids.length === 0) {
        setMeetings([]);
        return;
      }

      // 팝업의 그룹 드롭다운에 쓸, 내가 속한 그룹 목록
      const { data: groupRows } = await supabase.from('groups').select('id, name').in('id', ids);
      if (!mounted) return;
      setGroups(groupRows ?? []);

      const { data: meetingRows } = await supabase
        .from('meetings')
        .select('id, title, date, group_id')
        .in('group_id', ids);
      if (!mounted) return;
      setMeetings((meetingRows || []).filter((row) => isListedMeeting(row)));
    };

    load();
    return () => {
      mounted = false;
    };
  }, [navigate]);

  // 달력 그리드 — 일요일 시작, 5주(35칸) 고정 그리드로 이전/다음 달 날짜를 앞뒤에
  // 채웁니다. 일요일 시작이라 getDay()(일=0)를 오프셋으로 그대로 씁니다.
  const cells = useMemo<DayCell[]>(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const sundayOffset = firstOfMonth.getDay();
    const start = new Date(year, month, 1 - sundayOffset);

    return Array.from({ length: WEEKS_SHOWN * 7 }, (_, i) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const cell: DayCell = { date, day: date.getDate(), inCurrentMonth: date.getMonth() === month };

      // 마지막 줄(인덱스 28~34)만 — 한 주 뒤(+7일) 날짜가 아직 이번 달이면, 그 날짜는
      // 그리드 밖으로 밀려나는 거라 이 칸에 같이 겹쳐 보여줍니다.
      if (i >= (WEEKS_SHOWN - 1) * 7) {
        const overflow = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7);
        if (overflow.getMonth() === month) {
          cell.overflowDay = overflow.getDate();
          cell.overflowDate = overflow;
        }
      }
      return cell;
    });
  }, [cursor]);

  // 날짜(연-월-일)별 회의 목록 — 달력 칸과 "오늘 일정" 패널이 같이 씁니다.
  const meetingsByDate = useMemo(() => {
    const map = new Map<string, MeetingRow[]>();
    for (const m of meetings) {
      const d = new Date(m.date);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const list = map.get(key) ?? [];
      list.push(m);
      map.set(key, list);
    }
    return map;
  }, [meetings]);

  // 그 날짜에 보여줄 직접 추가한 일정 스택 — 반복 일정은 날짜마다 계산해서 나타납니다.
  // date는 "그 날짜 + 원래 시각"으로 맞춰서 시간순 정렬과 상세 팝업의 날짜 표시가 맞게 합니다.
  const localItemsOf = (day: Date) =>
    localSchedules
      .filter((sc) => occursOn(sc, day))
      .map((sc) => {
        const s = new Date(sc.date);
        const when = new Date(day.getFullYear(), day.getMonth(), day.getDate(), s.getHours(), s.getMinutes());
        // 종료는 "시작 + 원래 길이"(종료가 없던 기존 일정은 1시간)로 그 발생분에 맞춰 옮깁니다
        const length = sc.endDate ? new Date(sc.endDate).getTime() - s.getTime() : 60 * 60 * 1000;
        const end = new Date(when.getTime() + Math.max(length, 0));
        return { id: sc.id, title: sc.title, date: when.toISOString(), groupId: sc.groupId, isLocal: true, end: end.toISOString() };
      });

  // 렌더마다 새 Date 객체가 생기면 아래 useMemo들의 의존성이 계속 바뀌어서, 한 번만
  // 만들어두고 재사용합니다.
  const today = useMemo(() => new Date(), []);
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  const todayMeetings = useMemo(
    () => (meetingsByDate.get(todayKey) ?? []).sort((a, b) => a.date.localeCompare(b.date)),
    [meetingsByDate, todayKey],
  );

  /**
   * "다가오는 일정" — meetings.date는 회의가 끝난 뒤에 기록되는 값이라(사전 예약
   * 기능이 없음) 미래 날짜가 거의 생기지 않습니다. 그래서 지금은 실제로 미래 날짜인
   * 회의만 걸러서 보여주되(생기면 바로 뜨도록), 평소엔 빈 상태 문구만 보일 거예요.
   * MainPage의 upcomingMeetings와 같은 전제입니다.
   */
  const upcomingMeetings = useMemo(() => {
    // 조회 범위의 끝 = 오늘 + UPCOMING_DAYS일의 다음 날 0시(그날 하루가 통째로 포함되도록 미만으로 비교)
    const rangeEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + UPCOMING_DAYS + 1).getTime();
    return meetings
      .filter((m) => {
        const t = new Date(m.date).getTime();
        return t > today.getTime() && t < rangeEnd;
      })
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5);
  }, [meetings, today]);

  // ---- 오른쪽 패널(오늘/다가오는 일정)에 보여줄 목록 ----
  // 달력 칸과 같은 데이터(저장된 회의 + 직접 등록한 일정)를 합쳐서 시간순으로 보여줍니다.
  // 직접 등록한 반복 일정은 날짜마다 발생하므로 localItemsOf(그 날짜)로 계산합니다.
  const toDetailItem = (m: MeetingRow): DetailItem => ({
    id: m.id, title: m.title || '회의', date: m.date, groupId: m.group_id, isLocal: false,
  });
  const todayItems: DetailItem[] = [...todayMeetings.map(toDetailItem), ...localItemsOf(today)].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  // 다가오는 일정: 지금 이후로 발생하는 일정 중 가까운 4개(SIDE_LIST_MAX). 오늘 ~ +UPCOMING_DAYS(29)일 범위의 일정만 읽습니다
  // (한 달 단위 구분이면서, 매일 반복처럼 계속 생기는 일정을 끝없이 계산하지 않기 위한 조회 범위).
  const upcomingLocalItems: DetailItem[] = [];
  for (let i = 0; i <= UPCOMING_DAYS; i += 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    upcomingLocalItems.push(...localItemsOf(day).filter((it) => new Date(it.date).getTime() > today.getTime()));
  }
  const upcomingItems: DetailItem[] = [...upcomingMeetings.map(toDetailItem), ...upcomingLocalItems]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, SIDE_LIST_MAX);
  // 오른쪽 패널의 일정 카드 한 장 — 왼쪽 제목+시간 / 가운데 인원 / 오른쪽 진행 상태(오늘·다가오는 일정 공통)
  const renderScheduleCard = (it: DetailItem, timeLabel: string) => {
    const status = scheduleStatusOf(it, now);
    const memberCount = it.groupId ? groupMembers[it.groupId]?.length : undefined;
    const statusClass = status === '진행중' ? styles.statusProgress : status === '완료' ? styles.statusDone : styles.statusPlanned;
    return (
      <button
        type="button"
        // 같은 반복 일정이 여러 날짜에 나타나므로 id만으로는 key가 겹칩니다 → 발생 시각까지 붙입니다
        key={`${it.id}-${it.date}`}
        className={styles.scheduleItem}
        onClick={() => openScheduleItem(it)}
      >
        <span className={styles.scheduleItemMain}>
          <span className={styles.scheduleItemTitle}>{it.title}</span>
          <span className={styles.scheduleItemTime}>{timeLabel}</span>
        </span>
        {/* 인원 수는 그룹 멤버를 아직 못 불러왔으면 자리만 비워둡니다 */}
        <span className={styles.scheduleItemCount}>
          {memberCount !== undefined && (
            <>
              <Icon name="users" />
              {memberCount}
            </>
          )}
        </span>
        <span className={`${styles.scheduleStatus} ${statusClass}`}>{status}</span>
      </button>
    );
  };
  // 패널 항목 클릭: 저장된 회의는 회의방으로 이동, 직접 등록한 일정은 달력 칸과 같은 상세 팝업(이동할 곳이 없음).
  // 오른쪽 패널에서는 누른 일정 하나만 팝업에 넘깁니다(슬라이드로 다른 일정을 넘겨보는 건 달력 칸에서 여는 팝업만 가능)
  const openScheduleItem = (it: DetailItem) => {
    if (it.isLocal) openDetail([it], 0);
    else navigate(`/group/${it.groupId}/meeting/${it.id}`);
  };

  // 그룹 id → 스택 색 (groups 순서 기준, 목록에 없으면 첫 색)
  const stackColorOf = (groupId: string | null) => {
    const idx = groups.findIndex((g) => g.id === groupId);
    return STACK_COLORS[(idx < 0 ? 0 : idx) % STACK_COLORS.length];
  };

  // 날짜 칸을 눌러 "새 일정 등록" 패널을 엽니다 — 입력칸/레이아웃은 수정 패널과 같습니다.
  const openCompose = (date: Date) => {
    setCtxMenu(null);
    setSelectedDate(date);
    setEditing({
      id: null,
      title: '',
      // 그룹은 "그룹을 선택하세요"로 시작하되, 그룹이 하나뿐이면 따로 고를 필요가 없게 미리 선택합니다.
      groupId: groups.length === 1 ? groups[0].id : '',
      // 시작/종료 날짜는 누른 날짜, 시간은 10:00~11:00(1시간)으로 시작합니다
      startDate: toDateInput(date),
      startTime: '10:00',
      endDate: toDateInput(date),
      endTime: '11:00',
      repeatType: 'none',
      weekdays: [date.getDay()],
      // 알림은 수정 패널과 같은 −/+ 조절이라 "없음" 대신 기본 10분 전으로 시작합니다(0분 = 정시)
      remind: 10,
    });
  };

  // 직접 추가한 일정만 삭제합니다 — 저장된 회의(meetings)는 기록이라 여기서 지우지 않습니다.
  // 확인 단계 없이 바로 지우며, localSchedules가 바뀌면 위 useEffect가 localStorage에도 반영합니다.
  const deleteDetail = () => {
    if (!detail || !detail.isLocal) return;
    // 지우는 일정을 수정 중이었다면 패널도 닫습니다
    setEditing((f) => (f && f.id === detail.id ? null : f));
    setLocalSchedules((prev) => prev.filter((sc) => sc.id !== detail.id));
    // 같은 날짜의 다른 스택이 남아 있으면 팝업을 닫지 않고 다음(없으면 이전) 스택을 이어서 보여줍니다.
    const rest = detailItems.filter((it) => it.id !== detail.id);
    setDetailItems(rest);
    setDetailIndex((i) => Math.min(i, Math.max(rest.length - 1, 0)));
  };

  // ---- 일정 등록/수정 패널 ----
  // 반복 일정도 "반복 전체"를 한 번에 고칩니다(이 일정만 수정하는 기능은 없음).
  const patchEdit = (patch: Partial<EditForm>) => setEditing((f) => (f ? { ...f, ...patch } : f));

  const openEdit = (sc: LocalSchedule) => {
    const s = new Date(sc.date);
    // 종료가 없던 기존 일정은 시작 + 1시간으로 채워서 보여줍니다
    const e = sc.endDate ? new Date(sc.endDate) : new Date(s.getTime() + 60 * 60 * 1000);
    setEditing({
      id: sc.id,
      title: sc.title,
      groupId: sc.groupId,
      startDate: toDateInput(s),
      startTime: toTimeInput(s),
      endDate: toDateInput(e),
      endTime: toTimeInput(e),
      repeatType: sc.repeat?.type ?? 'none',
      weekdays: sc.repeat?.weekdays?.length ? sc.repeat.weekdays : [s.getDay()],
      remind: sc.remindMinutes ?? 10,
    });
    closeDetail();
  };

  // 'YYYY-MM-DD' + 'HH:mm' → Date (비어 있으면 Invalid Date)
  const editStart = editing ? new Date(`${editing.startDate}T${editing.startTime}`) : null;
  const editEnd = editing ? new Date(`${editing.endDate}T${editing.endTime}`) : null;
  const editTimesValid =
    !!editStart && !!editEnd && !Number.isNaN(editStart.getTime()) && !Number.isNaN(editEnd.getTime());
  // 종료가 시작보다 빠르면 저장할 수 없습니다
  const editRangeError = editTimesValid && editEnd!.getTime() < editStart!.getTime();
  const canSaveEdit =
    !!editing && editing.title.trim() !== '' && editing.groupId !== '' && editTimesValid && !editRangeError;

  const saveEdit = () => {
    if (!editing || !canSaveEdit || !editStart || !editEnd) return;
    // 매주 반복은 고른 요일을 같이 저장합니다(다른 반복은 요일이 필요 없음)
    const repeat = {
      type: editing.repeatType,
      weekdays: editing.repeatType === 'weekly' ? editing.weekdays : undefined,
    };
    // 등록(id가 null): 새 일정을 끝에 추가합니다.
    // 알림 시각이 되면 ScheduleReminderWatcher가 그룹 종알림을 보냅니다.
    if (editing.id === null) {
      setLocalSchedules((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          title: editing.title.trim(),
          date: editStart.toISOString(),
          groupId: editing.groupId,
          endDate: editEnd.toISOString(),
          repeat,
          remindMinutes: editing.remind,
        },
      ]);
      setEditing(null);
      return;
    }
    // 수정: 같은 id의 일정만 덮어씁니다.
    setLocalSchedules((prev) =>
      prev.map((sc) =>
        sc.id === editing.id
          ? {
              ...sc,
              title: editing.title.trim(),
              groupId: editing.groupId,
              date: editStart.toISOString(),
              endDate: editEnd.toISOString(),
              repeat,
              remindMinutes: editing.remind,
            }
          : sc,
      ),
    );
    setEditing(null);
  };

  // Esc로 팝업/우클릭 메뉴 닫기
  useEffect(() => {
    if (!ctxMenu && !detail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setCtxMenu(null); setDetailItems([]); }
      // 상세 팝업이 열려 있을 때 좌우 방향키로도 슬라이드
      if (detail && e.key === 'ArrowLeft') setDetailIndex((i) => Math.max(i - 1, 0));
      if (detail && e.key === 'ArrowRight') setDetailIndex((i) => Math.min(i + 1, detailItems.length - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctxMenu, detail, detailItems.length]);

  const goToday = () => setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
  const goPrevMonth = () => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1));
  const goNextMonth = () => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1));

  return (
    <AppShell activePage="calendar">
      <div className={styles.calendarPage}>
        <div className={styles.topBar}>
          {/* 보내주신 사진 기준으로 다시 배치했습니다: 이전/다음 달 화살표를 한 덩어리로
              묶고, 오늘 버튼, 그 다음 "2026년 1월" 라벨 + 드롭다운(화살표 토글) 순서 —
              드롭다운을 열면 연/월을 바로 선택해서 여러 달을 한 번에 건너뛸 수 있습니다. */}
          <div className={styles.todayNavGroup}>
            <div className={styles.arrowGroup}>
              <button type="button" className={styles.arrowButton} onClick={goPrevMonth} aria-label="이전 달">
                <Icon name="chevron-left" />
              </button>
              <button type="button" className={styles.arrowButton} onClick={goNextMonth} aria-label="다음 달">
                <Icon name="chevron-right" />
              </button>
            </div>

            <button type="button" className={styles.todayButton} onClick={goToday}>
              오늘
            </button>

            <div className={styles.monthPicker}>
              <button
                type="button"
                className={styles.monthPickerButton}
                onClick={() => setPickerOpen((prev) => !prev)}
              >
                <span className={styles.monthLabel}>{cursor.getFullYear()}년 {cursor.getMonth() + 1}월</span>
                <Icon name="chevron-down" className={styles.monthPickerCaret} />
              </button>
              {pickerOpen && (
                <>
                  {/* DocumentList의 더보기 메뉴와 같은 패턴 — 바깥을 누르면 닫히는
                      투명 오버레이 */}
                  <div className={styles.menuBackdrop} onClick={() => setPickerOpen(false)} />
                  <div className={styles.monthPickerDropdown}>
                    <select
                      className={styles.monthPickerSelect}
                      value={cursor.getFullYear()}
                      onChange={(e) => setCursor((c) => new Date(Number(e.target.value), c.getMonth(), 1))}
                    >
                      {Array.from({ length: 11 }, (_, i) => today.getFullYear() - 5 + i).map((y) => (
                        <option key={y} value={y}>{y}년</option>
                      ))}
                    </select>
                    <select
                      className={styles.monthPickerSelect}
                      value={cursor.getMonth()}
                      onChange={(e) => setCursor((c) => new Date(c.getFullYear(), Number(e.target.value), 1))}
                    >
                      {Array.from({ length: 12 }, (_, i) => i).map((m) => (
                        <option key={m} value={m}>{m + 1}월</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className={styles.contentArea}>
          <section className={styles.calendarPanel}>
            <div className={styles.weekHeader}>
              {WEEKDAYS.map((w) => (
                <div key={w} className={styles.weekdayCell}>{w}</div>
              ))}
            </div>
            <div className={styles.dayGrid}>
              {cells.map(({ date, day, inCurrentMonth, overflowDay, overflowDate }, i) => {
                const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
                // 겹쳐 보이는 칸(overflowDate 있음)은 그 날짜 회의도 같이 모아서 보여줍니다
                // — 안 그러면 그리드 밖으로 밀려난 날짜의 회의가 어디에도 안 보이게 됩니다.
                const overflowKey = overflowDate
                  ? `${overflowDate.getFullYear()}-${overflowDate.getMonth()}-${overflowDate.getDate()}`
                  : null;
                // 회의 + 팝업으로 추가한 일정을 시간순으로 한 줄에 쌓습니다(일정은 눌러도 이동 없음).
                const mainLocal = localItemsOf(date);
                const dayItems = [
                  ...(meetingsByDate.get(key) ?? []).map((m) => ({
                    id: m.id, title: m.title || '회의', date: m.date, groupId: m.group_id, isLocal: false,
                  })),
                  ...(overflowKey ? meetingsByDate.get(overflowKey) ?? [] : []).map((m) => ({
                    id: m.id, title: m.title || '회의', date: m.date, groupId: m.group_id, isLocal: false,
                  })),
                  ...mainLocal,
                  // 겹쳐 보이는 칸에서 같은 반복 일정이 두 날짜에 다 걸려도 한 번만 쌓습니다(id 중복 방지)
                  ...(overflowDate ? localItemsOf(overflowDate) : []).filter((it) => !mainLocal.some((m) => m.id === it.id)),
                ].sort((a, b) => a.date.localeCompare(b.date));
                const isToday = isSameDay(date, today) || (!!overflowDate && isSameDay(overflowDate, today));
                return (
                  <div
                    key={i}
                    className={`${styles.dayCell} ${inCurrentMonth ? '' : styles.dayCellOutside} ${isToday ? styles.dayCellToday : ''} ${selectedDate && isSameDay(selectedDate, date) ? styles.dayCellSelected : ''}`}
                    // 왼쪽 클릭은 그 날짜로 포커스만 옮기고, 우클릭하면 "일정 추가" 작은 메뉴가 뜹니다
                    // (회의 버튼은 아래에서 전파를 막음)
                    onClick={() => { setCtxMenu(null); setSelectedDate(date); }}
                    onContextMenu={(e) => {
                      e.preventDefault(); // 브라우저 기본 우클릭 메뉴 대신 우리 메뉴를 보여줍니다
                      setSelectedDate(date);
                      // 우클릭 메뉴는 확대된 레이어 안에 그려지므로 화면 좌표를 배율로 나눠 레이아웃 좌표로 바꿉니다
                      const sc = getAppShellScale();
                      setCtxMenu({ x: e.clientX / sc, y: e.clientY / sc, date });
                    }}
                  >
                    <span className={styles.dayNumber}>
                      {/* 선택한 날짜는 칸 테두리 대신 이 숫자에 진한 초록 원 하이라이트를 줍니다 */}
                      <span className={styles.dayNumberText}>{day}</span>
                      {/* "24/31"처럼 겹친 날짜 — 뒤쪽(밀려난 날짜)은 작고 옅게, 살짝 아래로 내려서
                          앞 숫자와 층이 지게 구분합니다 */}
                      {overflowDay && <span className={styles.dayNumberOverflow}>/{overflowDay}</span>}
                    </span>
                    {dayItems.length > 0 && (
                      <div className={styles.dayMeetings}>
                        {dayItems.slice(0, 2).map((m) => (
                          <button
                            type="button"
                            key={m.id}
                            className={styles.dayMeetingItem}
                            // 그룹 색을 CSS 변수로 넘깁니다(.dayMeetingItem이 --stack-bg/--stack-fg를 읽음).
                            style={{
                              '--stack-bg': stackColorOf(m.groupId).bg,
                              '--stack-fg': stackColorOf(m.groupId).fg,
                            } as CSSProperties}
                            onClick={(e) => {
                              e.stopPropagation();
                              // 회의든 직접 추가한 일정이든 바로 이동하지 않고, 간단한 정보 팝업을 띄웁니다.
                              // (회의방 이동/삭제는 팝업의 버튼에서)
                              setCtxMenu(null);
                              setSelectedDate(date);
                              openDetail(dayItems, dayItems.findIndex((it) => it.id === m.id));
                            }}
                          >
                            {m.title}
                          </button>
                        ))}
                        {dayItems.length > 2 && (
                          // "+N"을 누르면 숨겨진 첫 스택(3번째)부터 상세 팝업을 엽니다(팝업에서 슬라이드로 전부 확인)
                          <button
                            type="button"
                            className={styles.dayMeetingMore}
                            onClick={(e) => {
                              e.stopPropagation();
                              setCtxMenu(null);
                              setSelectedDate(date);
                              openDetail(dayItems, 2);
                            }}
                          >
                            +{dayItems.length - 2}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* editing이 있으면 오른쪽 열이 "일정 등록/수정" 영역으로 바뀌고(폭은 그대로라 달력 크기는 변하지 않음), 없으면 평소의 오늘/다가오는 일정.
              editing.id가 null이면 등록, 값이 있으면 수정입니다. */}
          {editing ? (
            <aside className={`${styles.sideColumn} ${styles.sideColumnEdit}`}>
              <section className={styles.editPanel} aria-label={editing.id === null ? '일정 등록' : '일정 수정'}>
                {/* 입력 영역은 스크롤, 취소/저장 버튼은 아래에 고정 */}
                <div className={styles.editBody}>
                  {/* 제목 + 안내 문구는 한 묶음으로 두고, 아래 입력 항목들과는 간격을 더 넓게 띄웁니다 */}
                  <div className={styles.editHeading}>
                    <h2 className={styles.editTitle}>{editing.id === null ? '일정 등록' : '일정 수정'}</h2>
                    <p className={styles.editSub}>
                      {editing.id === null ? '새 일정을 등록하세요.' : '선택한 일정을 수정하세요.'}
                    </p>
                  </div>

                  <label className={styles.editField}>
                    <span className={styles.editLabel}>회의 제목</span>
                    <input
                      className={styles.editInput}
                      value={editing.title}
                      onChange={(e) => patchEdit({ title: e.target.value })}
                    />
                  </label>

                  <label className={styles.editField}>
                    <span className={styles.editLabel}>그룹</span>
                    <div className={styles.editSelectWrap}>
                      <select
                        className={`${styles.editInput} ${styles.editSelect}`}
                        value={editing.groupId}
                        onChange={(e) => patchEdit({ groupId: e.target.value })}
                        disabled={groups.length === 0}
                      >
                        {/* 아직 그룹을 고르지 않은 등록 상태에서만 안내 항목을 둡니다(수정 중에는 항상 그룹이 있음) */}
                        {editing.groupId === '' && (
                          <option value="">{groups.length === 0 ? '먼저 그룹에 참여해주세요' : '그룹을 선택하세요'}</option>
                        )}
                        {groups.map((g) => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                      <Icon name="chevron-down" className={styles.editSelectCaret} />
                    </div>
                  </label>

                  <div className={styles.editField}>
                    <span className={styles.editLabel}>회의 시간</span>
                    {/* 시작/종료 각각 날짜 + 시간 (달력/시계 아이콘은 브라우저 기본 선택기 아이콘) */}
                    <div className={`${styles.editCard} ${styles.editTimeCard}`}>
                      <div className={styles.editTimeRow}>
                        <span className={styles.editTimeTag}>시작</span>
                        <input
                          className={styles.editPill}
                          type="date"
                          value={editing.startDate}
                          onChange={(e) => patchEdit({ startDate: e.target.value })}
                          aria-label="시작 날짜"
                        />
                        <input
                          className={styles.editPill}
                          type="time"
                          value={editing.startTime}
                          onChange={(e) => patchEdit({ startTime: e.target.value })}
                          aria-label="시작 시간"
                        />
                      </div>
                      <div className={styles.editTimeRow}>
                        <span className={styles.editTimeTag}>종료</span>
                        <input
                          className={styles.editPill}
                          type="date"
                          value={editing.endDate}
                          onChange={(e) => patchEdit({ endDate: e.target.value })}
                          aria-label="종료 날짜"
                        />
                        <input
                          className={styles.editPill}
                          type="time"
                          value={editing.endTime}
                          onChange={(e) => patchEdit({ endTime: e.target.value })}
                          aria-label="종료 시간"
                        />
                      </div>
                    </div>
                    {editRangeError && <span className={styles.editError}>종료 시간이 시작보다 빠를 수 없어요.</span>}
                  </div>

                  <div className={styles.editField}>
                    <span className={styles.editLabel}>반복</span>
                    <div className={`${styles.editCard} ${styles.editRepeatCard}`}>
                      <div className={styles.editSegment}>
                        {REPEAT_OPTIONS.map((opt) => (
                          <button
                            type="button"
                            key={opt.value}
                            className={`${styles.editSegBtn}${editing.repeatType === opt.value ? ` ${styles.editSegBtnActive}` : ''}`}
                            // 매주로 바꿀 때 고른 요일이 비어 있으면 시작 날짜의 요일을 기본으로 둡니다
                            onClick={() =>
                              patchEdit({
                                repeatType: opt.value,
                                weekdays: editing.weekdays.length ? editing.weekdays : [editStart && !Number.isNaN(editStart.getTime()) ? editStart.getDay() : 1],
                              })
                            }
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      {/* 요일 원은 항상 보여서(반복을 바꿔도 카드 높이가 변하지 않게) 매주가 아닐 때는 비활성화만 합니다.
                          최소 하나는 선택되어 있어야 해서 마지막 하나는 해제되지 않습니다 */}
                      <div className={styles.editWeekdays}>
                        {WEEKDAY_CHIPS.map((d) => {
                          const weekly = editing.repeatType === 'weekly';
                          const on = weekly && editing.weekdays.includes(d);
                          return (
                            <button
                              type="button"
                              key={d}
                              className={`${styles.editDayChip}${on ? ` ${styles.editDayChipActive}` : ''}`}
                              disabled={!weekly}
                              onClick={() => {
                                if (on && editing.weekdays.length === 1) return;
                                patchEdit({ weekdays: on ? editing.weekdays.filter((x) => x !== d) : [...editing.weekdays, d] });
                              }}
                            >
                              {KOREAN_WEEKDAYS[d]}
                            </button>
                          );
                        })}
                      </div>
                      {/* 예전 등록 팝업에서 "2주마다/매년"으로 만든 일정은 위 4개 버튼에 없어서, 안내 문구로 현재 반복을 보여줍니다 */}
                      {/* 안내 줄도 자리를 늘 차지해서(반복 없음이면 빈 줄) 반복을 바꿔도 카드 높이가 그대로입니다 */}
                      <span className={styles.editHint}>
                        {editing.repeatType !== 'none' ? repeatHint(editing.repeatType, editing.weekdays, editStart) : ''}
                      </span>
                    </div>
                  </div>

                  <div className={styles.editField}>
                    <span className={styles.editLabel}>알림</span>
                    {/* 10분 단위로 조절(0분 = 정시, 최대 24시간 전). 그 시각에 그룹 종알림을 보냅니다. */}
                    <div className={`${styles.editCard} ${styles.editRemindCard}`}>
                      <span className={styles.editRemindValue}>{formatRemind(editing.remind)}</span>
                      <button
                        type="button"
                        className={styles.editStepBtn}
                        onClick={() => patchEdit({ remind: Math.max(editing.remind - REMIND_STEP, 0) })}
                        disabled={editing.remind <= 0}
                        aria-label="알림 10분 줄이기"
                      >
                        −
                      </button>
                      <button
                        type="button"
                        className={styles.editStepBtn}
                        onClick={() => patchEdit({ remind: Math.min(editing.remind + REMIND_STEP, REMIND_MAX) })}
                        disabled={editing.remind >= REMIND_MAX}
                        aria-label="알림 10분 늘리기"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

                {/* 구분선은 이 버튼 줄 위에 한 줄만 있습니다(취소는 좁게, 저장은 넓게) */}
                <div className={styles.editFooter}>
                  <button type="button" className={styles.editCancel} onClick={() => setEditing(null)}>취소</button>
                  <button type="button" className={styles.editSave} onClick={saveEdit} disabled={!canSaveEdit}>
                    {editing.id === null ? '일정 등록' : '변경 사항 저장'}
                  </button>
                </div>
              </section>
            </aside>
          ) : (
          <aside className={styles.sideColumn}>
            <section className={styles.todayScheduleBox}>
              <div className={styles.sideHead}>
                <h2 className={styles.sideHeadTitle}>오늘 일정</h2>
              </div>
              <div className={styles.sideList}>
                {todayItems.length === 0 ? (
                  <div className={styles.sideEmpty}>오늘 예정된 회의가 없어요</div>
                ) : (
                  // 4개까지만 보이고, 카드를 누르면 그 일정 하나만 상세 팝업으로 엽니다
                  todayItems.slice(0, SIDE_LIST_MAX).map((it) => renderScheduleCard(it, formatMeetingTime(it.date)))
                )}
              </div>
            </section>

            <section className={styles.upcomingBox}>
              <div className={styles.sideHead}>
                <h3 className={styles.sideHeadTitle}>다가오는 일정</h3>
              </div>
              <div className={styles.sideList}>
                {upcomingItems.length === 0 ? (
                  <div className={styles.sideEmpty}>
                    예정된 회의가 없어요
                    {/* 회의 예약 기능이 없어서(meetings.date는 회의가 끝난 뒤 기록) 저장된 회의는 보통 비어 있고,
                        직접 등록한 일정(반복 포함)이 있으면 여기에 가까운 순으로 채워집니다. */}
                  </div>
                ) : (
                  upcomingItems.map((it) => renderScheduleCard(it, formatUpcomingTime(it.date, today)))
                )}
              </div>
            </section>
          </aside>
          )}
        </div>
      </div>

      {/* 일정 상세 팝업 — 스택 좌클릭 시. 위 팝업과 같은 이유로 body에 직접 그립니다.
          직접 추가한 일정: [닫기][삭제] / 저장된 회의: [닫기][회의방으로 이동](삭제 불가) */}
      {detail && createScaledPortal(
        <div className={styles.composeBackdrop} onClick={closeDetail}>
          {/* 팝업 양옆에 큰 화살표를 붙이려고 팝업을 relative 래퍼로 감쌉니다. 화살표는 팝업 바깥(배경 위)에
              있어서 클릭이 배경으로 전파돼 팝업이 닫히지 않게 stopPropagation 합니다. */}
          <div className={styles.detailWrap}>
            {/* 같은 날짜의 스택이 여러 개일 때만 슬라이드 화살표와 점 표시를 보여줍니다 */}
            {detailItems.length > 1 && (
              <>
                <button
                  type="button"
                  className={`${styles.detailSideBtn} ${styles.detailSideBtnLeft}`}
                  onClick={(e) => { e.stopPropagation(); slideDetail(-1); }}
                  disabled={detailIndex === 0}
                  aria-label="이전 일정"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className={`${styles.detailSideBtn} ${styles.detailSideBtnRight}`}
                  onClick={(e) => { e.stopPropagation(); slideDetail(1); }}
                  disabled={detailIndex === detailItems.length - 1}
                  aria-label="다음 일정"
                >
                  ›
                </button>
              </>
            )}
          {/* 새 디자인: 초록 카드 — 제목(일정 상세) / 그룹 칩 / 일정 제목 / 날짜 / 시작·종료·반복·알림 카드 / 삭제·수정.
              종료·반복·알림은 일정 데이터에 아직 없어서(LocalSchedule = id/title/date/groupId) "—"로 둡니다. */}
          <div
            className={styles.detailCard}
            role="dialog"
            aria-modal="true"
            aria-label="일정 상세"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className={styles.detailHeading}>일정 상세</h3>

            <span className={styles.detailGroupChip}>
              {groups.find((g) => g.id === detail.groupId)?.name ?? '그룹'}
            </span>
            <div className={styles.detailTitle}>{detail.title}</div>
            <div className={styles.detailDateLine}>
              {new Date(detail.date).getFullYear()}년 {formatComposeDate(new Date(detail.date))}
            </div>

            <dl className={styles.detailInfoCard}>
              <div className={styles.detailInfoRow}>
                <dt>시작</dt>
                <dd>{formatDotDate(detail.date)}</dd>
                <dd>{formatKoreanTime(detail.date)}</dd>
              </div>
              {/* 반복 일정은 그 날짜의 종료(detail.end)를 보여 줍니다. 종료가 없는 회의는 "—" */}
              <div className={styles.detailInfoRow}>
                <dt>종료</dt>
                {detail.end ? (
                  <>
                    <dd>{formatDotDate(detail.end)}</dd>
                    <dd>{formatKoreanTime(detail.end)}</dd>
                  </>
                ) : (
                  <dd>—</dd>
                )}
              </div>
              <div className={styles.detailInfoRow}>
                <dt>반복</dt>
                <dd>
                  {detailSchedule?.repeat && detailSchedule.repeat.type !== 'none'
                    ? repeatHint(detailSchedule.repeat.type, detailSchedule.repeat.weekdays ?? [], new Date(detailSchedule.date))
                    : '—'}
                </dd>
              </div>
              <div className={styles.detailInfoRow}>
                <dt>알림</dt>
                <dd>{detailSchedule?.remindMinutes !== undefined ? formatRemind(detailSchedule.remindMinutes) : '—'}</dd>
              </div>
            </dl>

            {/* 직접 추가한 일정: 왼쪽 [삭제] / 오른쪽 [수정](오른쪽 열이 수정 패널로 바뀜).
                저장된 회의는 삭제·수정 대신 [회의방으로 이동]만. 반복 일정은 삭제도 반복 전체가 지워집니다. */}
            <div className={styles.detailActions}>
              {detail.isLocal ? (
                <>
                  <button type="button" className={styles.detailDelete} onClick={deleteDetail}>삭제</button>
                  <button
                    type="button"
                    className={styles.detailEdit}
                    onClick={() => detailSchedule && openEdit(detailSchedule)}
                  >
                    수정
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={styles.detailEdit}
                  // 가정: 회의방 경로는 GroupPage가 쓰는 /room/:id (id = 그룹 id)
                  onClick={() => { const gid = detail.groupId; closeDetail(); if (gid) navigate(`/room/${gid}`); }}
                >
                  회의방으로 이동
                </button>
              )}
            </div>

            {/* 현재 몇 번째인지 — 점을 누르면 그 스택으로 바로 이동 */}
            {detailItems.length > 1 && (
              <div className={styles.detailDots}>
                {detailItems.map((it, i) => (
                  <button
                    type="button"
                    key={it.id}
                    className={`${styles.detailDot}${i === detailIndex ? ` ${styles.detailDotActive}` : ''}`}
                    onClick={() => setDetailIndex(i)}
                    aria-label={`${i + 1}번째 일정`}
                  />
                ))}
              </div>
            )}
          </div>
          </div>
        </div>,
      )}
      {/* 우클릭 메뉴 — body에 직접 그립니다(위 팝업과 같은 이유: .app의 transform 때문에 fixed가 어긋남).
          바깥(투명 배경)을 누르거나 다시 우클릭하면 닫힙니다. */}
      {ctxMenu && createScaledPortal(
        <div
          className={styles.ctxBackdrop}
          onClick={() => setCtxMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}
        >
          <div
            className={styles.ctxMenu}
            // 화면 오른쪽/아래 끝에서 잘리지 않게 위치를 안쪽으로 보정
            style={{ left: Math.min(ctxMenu.x, window.innerWidth / getAppShellScale() - 130), top: Math.min(ctxMenu.y, window.innerHeight / getAppShellScale() - 50) }}
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" className={styles.ctxItem} onClick={() => openCompose(ctxMenu.date)}>
              일정 추가
            </button>
          </div>
        </div>,
      )}
    </AppShell>
  );
}
