import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { addGroupMember, joinGroupByInviteCode } from '../utils/joinGroup';
import AppShell from '../components/AppShell';
import GroupModal from '../components/GroupModal';
import Icon from '../components/Icon';

function rndCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = 'GRP-';
  for (let i = 0; i < 5; i++) out += c[Math.floor(Math.random() * c.length)];
  return out;
}

type Group = {
  id: string;
  name: string;
  invite_code: string;
};

type MeetingRow = {
  id: string;
  title: string | null;
  date: string;
  summary: string | null;
  group_id: string;
};

function formatMeetingDate(dateStr: string) {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${y}.${m}.${day} ${String(hours).padStart(2, '0')}:${minutes}${ampm}`;
}

function MiniWeek() {
  const today = new Date();
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const startPad = start.getDay();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const prevDays = new Date(today.getFullYear(), today.getMonth(), 0).getDate();

  const columns = labels.map((label, weekday) => {
    const dates: { num: number; disabled: boolean; today: boolean }[] = [];
    for (let week = 0; week < 5; week++) {
      const cell = week * 7 + weekday;
      const dayNum = cell - startPad + 1;
      if (dayNum < 1) {
        dates.push({ num: prevDays + dayNum, disabled: true, today: false });
      } else if (dayNum > daysInMonth) {
        dates.push({ num: dayNum - daysInMonth, disabled: true, today: false });
      } else {
        dates.push({
          num: dayNum,
          disabled: false,
          today: dayNum === today.getDate(),
        });
      }
    }
    return { label, dates };
  });

  return (
    <div className="mini-week">
      {columns.map((col) => (
        <div className="day-col" key={col.label}>
          <div className="day-label">{col.label}</div>
          {col.dates.map((d, i) => (
            <div
              key={`${col.label}-${i}`}
              className={`date-num${d.disabled ? ' disabled' : ''}${d.today ? ' today' : ''}`}
            >
              {d.num}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * 메인 대시보드
 * grop/js/main.js 의 메인 HTML 구조를 그대로 쓰고, 그룹/회의 데이터만 실제 DB에서 채웁니다.
 */
export default function MainPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const trackRef = useRef<HTMLDivElement>(null);
  const [groupName, setGroupName] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [inviteInput, setInviteInput] = useState(searchParams.get('code')?.toUpperCase() ?? '');
  const [joinMsg, setJoinMsg] = useState('');
  const [joinSuccess, setJoinSuccess] = useState(false);
  const [userId, setUserId] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    const init = async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) { navigate('/'); return; }
      setUserId(userData.user.id);
      fetchGroups(userData.user.id);
    };
    init();
  }, []);

  const fetchGroups = async (uid: string) => {
    const { data } = await supabase
      .from('group_members')
      .select('group_id, groups(id, name, invite_code)')
      .eq('user_id', uid);
    const seen = new Set<string>();
    const list: Group[] = [];
    if (data) {
      for (const row of data as { groups: Group | Group[] | null }[]) {
        const raw = row.groups;
        const g = Array.isArray(raw) ? raw[0] : raw;
        if (!g?.id || seen.has(g.id)) continue;
        seen.add(g.id);
        list.push(g);
      }
    }
    setGroups(list);

    const ids = list.map((g) => g.id);
    if (ids.length === 0) {
      setMeetings([]);
      return;
    }
    const { data: meetingRows } = await supabase
      .from('meetings')
      .select('id, title, date, summary, group_id')
      .in('group_id', ids)
      .order('date', { ascending: false })
      .limit(4);
    setMeetings(meetingRows || []);
  };

  const createGroup = async () => {
    if (!groupName.trim()) return;
    const code = rndCode();
    const { data, error } = await supabase
      .from('groups')
      .insert({ name: groupName, invite_code: code, created_by: userId })
      .select().maybeSingle();

    if (error || !data) { alert(`생성 실패: ${error?.message}`); return; }

    const memberResult = await addGroupMember(data.id, userId);
    if (!memberResult.ok) {
      alert(`그룹은 만들어졌지만 멤버 등록 실패: ${memberResult.error}`);
      return;
    }
    setGroupName('');
    setModalOpen(false);
    fetchGroups(userId);
    navigate(`/group/${data.id}`);
  };

  const joinGroup = async () => {
    if (!userId) return;
    const result = await joinGroupByInviteCode(inviteInput, userId);
    if (!result.ok) {
      setJoinMsg(result.error);
      setJoinSuccess(false);
      return;
    }

    setJoinMsg(result.alreadyMember ? `이미 ${result.group.name}에 참여 중이에요` : `${result.group.name}에 참여했어요!`);
    setJoinSuccess(true);
    setInviteInput('');
    fetchGroups(userId);
    setTimeout(() => {
      setModalOpen(false);
      navigate(`/group/${result.group.id}`);
    }, 800);
  };

  const firstGroup = groups[0];
  const calendarLabel = `${new Date().getMonth() + 1}월 ${new Date().getDate()}일`;

  return (
    <AppShell activePage="main">
      <div className="group-carousel">
        <span
          className="chevron prev-button"
          aria-label="이전 그룹"
          onClick={() => trackRef.current?.scrollBy({ left: -420, behavior: 'smooth' })}
        >
          <Icon name="chevron-left" />
        </span>

        <div className="group-cards" ref={trackRef}>
          {groups.map((g) => (
            <div
              key={g.id}
              className="group-card"
              onClick={() => navigate(`/group/${g.id}`)}
            >
              <div className="badge">{g.name.trim().charAt(0) || 'G'}</div>
              <div className="name">{g.name}</div>
            </div>
          ))}
        </div>

        <span
          className="chevron next-button"
          aria-label="다음 그룹"
          onClick={() => trackRef.current?.scrollBy({ left: 420, behavior: 'smooth' })}
        >
          <Icon name="chevron-right" />
        </span>
      </div>

      <div className="row-2col row-2col--panels">
        <section className="panel meeting-table">
          <div className="section-head">
            <h2>회의 목록</h2>
            {firstGroup && (
              <a className="see-all" href={`/group/${firstGroup.id}/meetings`} onClick={(e) => { e.preventDefault(); navigate(`/group/${firstGroup.id}/meetings`); }}>
                전체 보기 &gt;
              </a>
            )}
          </div>
          <div className="cols">
            <span>회의 제목</span><span>진행 상태</span><span>날짜</span><span>참석자</span><span>AI 요약</span>
          </div>
          <hr />
          {meetings.length === 0 ? (
            <div className="meeting-row">
              <span className="title">아직 회의록이 없어요</span>
            </div>
          ) : meetings.map((m) => (
            <div
              key={m.id}
              className="meeting-row"
              onClick={() => navigate(`/group/${m.group_id}/meeting/${m.id}`)}
            >
              <span className="title">{m.title || '회의'}</span>
              <span className={`status-pill ${m.summary ? 'done' : 'progress'}`}>
                {m.summary ? '완료' : '진행중'}
              </span>
              <span className="date">{formatMeetingDate(m.date)}</span>
              <span className="attendees">
                <Icon name="circle-user" />
                <Icon name="circle-user" />
                <Icon name="circle-user" />
              </span>
              <span className="ai-icon">
                {m.summary
                  ? <Icon name="check-circle" className="done" />
                  : <Icon name="minus-circle" className="pending" />}
              </span>
            </div>
          ))}
        </section>

        <section className="panel">
          <div className="section-head">
            <h2>최근 AI 요약</h2>
            <a
              className="see-all"
              href="/documents"
              onClick={(e) => { e.preventDefault(); navigate('/documents'); }}
            >
              전체 보기 &gt;
            </a>
          </div>
          <div className="summary-list">
            {meetings.filter((m) => m.summary).slice(0, 3).map((m) => (
              <div key={m.id} className="summary-item">
                <Icon name="file-text" className="doc-icon" />
                <div className="content">
                  <div className="top-row">
                    <span className="title">{m.title || '회의'}</span>
                    <span className="date">{formatMeetingDate(m.date)}</span>
                  </div>
                  <p className="desc">{m.summary}</p>
                </div>
                {/* 완료 배지는 카드 오른쪽 끝에 세로 중앙 정렬 (스크린샷 기준) */}
                <span className="status-pill done">완료</span>
              </div>
            ))}
            {meetings.filter((m) => m.summary).length === 0 && (
              <div className="summary-item">
                <Icon name="file-text" className="doc-icon" />
                <div className="content">
                  <div className="top-row">
                    <span className="title">요약 없음</span>
                  </div>
                  <p className="desc">회의가 끝나면 AI 요약이 여기에 표시됩니다.</p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="row-2col">
        <section>
          <div className="section-head"><h2>빠른 작업</h2></div>
          <div className="quick-actions">
            <button className="qa-card" type="button" onClick={() => setModalOpen(true)}>
              <Icon name="plus" />
              <span>그룹 추가</span>
            </button>
            <button className="qa-card" type="button" onClick={() => navigate('/ai')}>
              <Icon name="sparkles" />
              <span>AI 요약</span>
            </button>
            <button className="qa-card" type="button" onClick={() => navigate('/canvas')}>
              <Icon name="file-text" />
              <span>문서 작성</span>
            </button>
            <button className="qa-card" type="button" onClick={() => firstGroup && navigate(`/group/${firstGroup.id}/members`)}>
              <Icon name="users" />
              <span>멤버 관리</span>
            </button>
          </div>
        </section>

        <section>
          <div className="section-head">
            <h2>캘린더</h2>
            {/* 캘린더 화면은 아직 없어 사이드바와 동일하게 안내만 합니다 */}
            <a
              className="see-all"
              href="#"
              onClick={(e) => { e.preventDefault(); alert('아직 준비 중인 기능입니다'); }}
            >
              전체 보기 &gt;
            </a>
          </div>
          <div className="calendar-panel">
            <div className="calendar-date">{calendarLabel}</div>
            <MiniWeek />
            <p className="calendar-empty">예정 되어있는 회의가 없습니다.</p>
          </div>
        </section>
      </div>

      <GroupModal
        open={modalOpen}
        groupName={groupName}
        inviteInput={inviteInput}
        joinMsg={joinMsg}
        joinSuccess={joinSuccess}
        onClose={() => setModalOpen(false)}
        onGroupNameChange={setGroupName}
        onInviteChange={setInviteInput}
        onCreate={createGroup}
        onJoin={joinGroup}
      />
    </AppShell>
  );
}
