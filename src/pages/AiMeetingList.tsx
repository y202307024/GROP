import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import { useGroupMemberAvatars } from '../hooks/useGroupMemberAvatars';
import { getAvatarSrc } from '../utils/avatarOptions';
import { getAppShellScale } from '../hooks/useAppShellScale';
// 문서 페이지와 같은 틀(탭 줄/검색/목록/하단 요약)을 그대로 쓰려고 DocumentList의 스타일을 가져옵니다.
import d from './DocumentList.module.css';
import s from './AiMeetingList.module.css';

type GroupRow = { id: string; name: string };
type MeetingRow = { id: string; title: string | null; date: string; summary: string | null; group_id: string };

/** '2026.09.06 10:00AM' 형식 (AI 요약 상세의 회의 목록과 같은 표기) */
function formatMeetingDate(dateStr: string) {
  const dt = new Date(dateStr);
  let hours = dt.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')} ${String(hours).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}${ampm}`;
}

/**
 * AI 요약 첫 화면 — 내가 가입한 그룹을 탭으로 나누고, 선택한 그룹의 회의록 목록을 보여줍니다.
 * 행을 누르면 기존 AI 요약 화면(AiSummaryPage, /ai/:meetingId)으로 들어갑니다.
 * 선택한 그룹은 주소(?group=)에 담아 두어서, 상세에서 돌아와도 같은 탭이 열립니다.
 */
export default function AiMeetingList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

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
        .select('group_id, joined_at')
        .eq('user_id', sessionData.session.user.id)
        .order('joined_at', { ascending: true });
      const ids = [...new Set((memberRows ?? []).map((r) => r.group_id).filter(Boolean))] as string[];
      if (ids.length === 0) {
        if (mounted) {
          setGroups([]);
          setLoading(false);
        }
        return;
      }

      const [{ data: groupRows }, { data: meetingRows }] = await Promise.all([
        supabase.from('groups').select('id, name').in('id', ids),
        supabase
          .from('meetings')
          .select('id, title, date, summary, group_id')
          .in('group_id', ids)
          .order('date', { ascending: false }),
      ]);
      if (!mounted) return;
      // 탭 순서는 가입한 순서
      const byId = new Map((groupRows ?? []).map((g) => [g.id, g as GroupRow]));
      setGroups(ids.map((id) => byId.get(id)).filter((g): g is GroupRow => !!g));
      setMeetings((meetingRows ?? []) as MeetingRow[]);
      setLoading(false);
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [navigate]);

  // 주소의 ?group= 이 내 그룹이 아니거나 없으면 첫 번째 그룹
  const activeGroupId = groups.find((g) => g.id === searchParams.get('group'))?.id ?? groups[0]?.id ?? '';

  const groupMeetings = useMemo(() => meetings.filter((m) => m.group_id === activeGroupId), [meetings, activeGroupId]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? groupMeetings.filter((m) => (m.title?.trim() || '회의').toLowerCase().includes(q)) : groupMeetings;
  }, [groupMeetings, query]);
  const summaryDone = groupMeetings.filter((m) => !!m.summary?.trim()).length;

  // 참석자 자리: 회의별 참석 기록이 없어서 그 그룹의 그룹원(최대 3명)을 보여줍니다(AI 요약 상세와 같은 방식)
  const memberAvatars = useGroupMemberAvatars(activeGroupId ? [activeGroupId] : []);
  const avatars = memberAvatars[activeGroupId];

  const selectGroup = (id: string) => {
    setQuery('');
    // 탭을 바꿀 때마다 뒤로가기 기록이 쌓이지 않게 replace
    setSearchParams({ group: id }, { replace: true });
  };

  const tabsRef = useRef<HTMLDivElement>(null);
  // 드래그로 탭을 넘긴 뒤에는 그 동작이 탭 클릭으로 이어지지 않게 구분합니다.
  const tabDragRef = useRef({ active: false, startX: 0, scrollLeft: 0, moved: false });
  const tabDragCleanupRef = useRef<(() => void) | null>(null);
  const [tabDragging, setTabDragging] = useState(false);

  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    // 휠은 세로로 들어오므로, 넘치는 탭 줄에서는 가로로 옮깁니다. passive면 preventDefault가 막힙니다.
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (delta === 0) return;
      el.scrollLeft += delta / getAppShellScale();
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const endTabDrag = () => {
    const drag = tabDragRef.current;
    drag.active = false;
    setTabDragging(false);
    // click은 pointerup 다음에 오므로, 넘긴 직후의 탭 선택은 그 클릭에서 막습니다.
    const moved = drag.moved;
    window.setTimeout(() => {
      if (tabDragRef.current.moved === moved) tabDragRef.current.moved = false;
    }, 0);
  };

  const onTabPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const el = tabsRef.current;
    if (!el || e.pointerType !== 'mouse' || e.button !== 0) return;
    if (el.scrollWidth <= el.clientWidth) return;
    // 포인터를 잡으면 클릭이 그룹 버튼까지 전달되지 않습니다. 창에서 움직임을 듣고, 4px 넘긴 뒤만 드래그로 봅니다.
    tabDragRef.current = { active: true, startX: e.clientX, scrollLeft: el.scrollLeft, moved: false };

    const onMove = (ev: globalThis.PointerEvent) => {
      const drag = tabDragRef.current;
      if (!drag.active) return;
      const screenDx = ev.clientX - drag.startX;
      if (Math.abs(screenDx) <= 4) return;
      if (!drag.moved) {
        drag.moved = true;
        setTabDragging(true);
      }
      el.scrollLeft = drag.scrollLeft - screenDx / getAppShellScale();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      tabDragCleanupRef.current = null;
      endTabDrag();
    };
    tabDragCleanupRef.current?.();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    tabDragCleanupRef.current = onUp;
  };

  useEffect(() => () => tabDragCleanupRef.current?.(), []);

  const onTabClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    if (!tabDragRef.current.moved) return;
    e.preventDefault();
    e.stopPropagation();
    tabDragRef.current.moved = false;
  };

  return (
    <AppShell activePage="ai">
      <div className={`page ${d.docPage}`}>
        <div className={d.docHeader}>
          {/* 그룹이 많아 탭이 넘치면 이 줄 안에서만 가로 스크롤 */}
          <div
            ref={tabsRef}
            className={`${d.tabs} ${s.tabsScroll}${tabDragging ? ` ${s.tabsDragging}` : ''}`}
            onPointerDown={onTabPointerDown}
            onClickCapture={onTabClickCapture}
          >
            {groups.map((g) => (
              <button
                key={g.id}
                type="button"
                className={`${d.tab} ${s.groupTab} ${g.id === activeGroupId ? d.tabActive : ''}`}
                onClick={() => selectGroup(g.id)}
              >
                {g.name}
              </button>
            ))}
          </div>

          <div className={d.toolbar}>
            <div className={d.searchBox}>
              <Icon name="search" />
              <input
                className={d.searchInput}
                type="text"
                placeholder="회의명 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
        </div>

        {loading ? (
          <div>불러오는 중...</div>
        ) : groups.length === 0 ? (
          <div className={d.empty}>아직 속한 그룹이 없어요.</div>
        ) : shown.length === 0 ? (
          <div className={d.empty}>
            {groupMeetings.length === 0 ? '이 그룹에는 아직 회의록이 없어요.' : '검색 결과가 없어요.'}
          </div>
        ) : (
          <div className={d.docList}>
            <div className={d.docBody}>
              {/* 문서 목록과 같은 5열 그리드(.doc-row) — 회의 | 날짜 | 참석자 | AI 요약 | 이동 화살표 */}
              <div className={`list-row list-head doc-row ${s.aiRow}`}>
                <span>회의</span>
                <span>날짜</span>
                <span>참석자</span>
                <span>AI 요약</span>
                <span />
              </div>
              {shown.map((m) => {
                const hasSummary = !!m.summary?.trim();
                return (
                  <div
                    key={m.id}
                    className={`list-row doc-row ${s.aiRow} ${s.meetingRow}`}
                    onClick={() => navigate(`/ai/${m.id}`)}
                  >
                    <span className={d.titleName}>{m.title?.trim() || '회의'}</span>
                    <span>{formatMeetingDate(m.date)}</span>
                    <span className={s.attendees}>
                      {avatars
                        ? avatars.slice(0, 3).map((member) => (
                            <img key={member.user_id} src={getAvatarSrc(member.avatar)} alt="" />
                          ))
                        : [0, 1, 2].map((i) => <Icon key={i} name="circle-user" />)}
                    </span>
                    <span>
                      <span className={`status-pill ${hasSummary ? 'done' : 'progress'}`}>
                        {hasSummary ? '요약 완료' : '내용 없음'}
                      </span>
                    </span>
                    <span className={s.go}>
                      <Icon name="chevron-right" />
                    </span>
                  </div>
                );
              })}
            </div>
            <div className={d.listFooter}>
              회의록 {groupMeetings.length}개 · 요약 완료 {summaryDone}개
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
