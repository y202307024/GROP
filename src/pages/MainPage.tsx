// 요약 완료/미완 아이콘 — 시안 SVG(색 포함)를 그대로 <img>로 씁니다.
import aiCheckDone from '../assets/ai-status/ai-check-done.svg';
import aiCheckPending from '../assets/ai-status/ai-check-pending.svg';
import docIcon from '../assets/icon-description.svg';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { addGroupMember, joinGroupByInviteCode } from '../utils/joinGroup';
import AppShell from '../components/AppShell';
import GroupModal from '../components/GroupModal';
import Icon from '../components/Icon';
import { useGroupMemberAvatars } from '../hooks/useGroupMemberAvatars';
import { getAvatarSrc } from '../utils/avatarOptions';
import { findNextLocalSchedule, loadLocalSchedules } from '../utils/localSchedules';
import styles from './MainPage.module.css';

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

// 그룹 카드에 표시할 "회의 N / 문서 N / 멤버 N" — group_id별로 집계해서 보관합니다.
type GroupStats = {
  meetingCount: number;
  docCount: number;
  memberCount: number;
};

type MeetingRow = {
  id: string;
  title: string | null;
  date: string;
  summary: string | null;
  group_id: string;
};

/** 하단 패널에 보여줄 카드 수 — 회의 목록 5장, 최근 AI 요약 4장. 카드 높이는 패널 높이를 이 수로 나눠 가집니다 */
const MEETING_VISIBLE = 5;
const SUMMARY_VISIBLE = 4;
/** 회의를 넉넉히 가져와서, 그중 요약이 있는 것만 골라 AI 요약 4장을 채웁니다 */
const MAX_MEETINGS = 12;

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

/**
 * 메인 대시보드
 * grop/js/main.js 의 메인 HTML 구조를 그대로 쓰고, 그룹/회의 데이터만 실제 DB에서 채웁니다.
 */
export default function MainPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [groupName, setGroupName] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  // 그룹 카드/회의 행의 "참석자" 자리에 그릴 실제 그룹원 프로필 이미지(그룹별)
  const memberAvatars = useGroupMemberAvatars([...groups.map((g) => g.id), ...meetings.map((m) => m.group_id)]);
  // "최근 그룹" 카드의 회의/문서/멤버 수 — group_id를 키로 저장합니다.
  const [groupStats, setGroupStats] = useState<Record<string, GroupStats>>({});
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
      setGroupStats({});
      return;
    }
    const { data: meetingRows } = await supabase
      .from('meetings')
      .select('id, title, date, summary, group_id')
      .in('group_id', ids)
      .order('date', { ascending: false })
      .limit(MAX_MEETINGS);
    setMeetings(meetingRows || []);

    // 그룹 카드의 "회의 N / 문서 N" 표시용 — 위 meetingRows는 최근 4건만 잘라서 가져와서
    // 카드 집계로는 못 쓰고, 그룹당 전체 회의/첨부파일 수를 따로 세야 합니다. 문서는
    // 별도 documents 테이블이 없고 meetings.attachments(JSON 배열)에 붙어있어서, 배열
    // 길이를 더해 "문서 수"로 씁니다(DocumentList.tsx의 normalizeAttachments처럼 정교한
    // 파싱까지는 안 하고 단순 length만 씁니다 — 카드 배지용 숫자라 정확도보다 가벼움이 우선).
    const { data: statsRows } = await supabase
      .from('meetings')
      .select('group_id, attachments')
      .in('group_id', ids);
    const { data: memberRows } = await supabase
      .from('group_members')
      .select('group_id')
      .in('group_id', ids);

    const stats: Record<string, GroupStats> = {};
    for (const id of ids) stats[id] = { meetingCount: 0, docCount: 0, memberCount: 0 };
    for (const row of (statsRows || []) as { group_id: string; attachments: unknown }[]) {
      const s = stats[row.group_id];
      if (!s) continue;
      s.meetingCount += 1;
      s.docCount += Array.isArray(row.attachments) ? row.attachments.length : 0;
    }
    for (const row of (memberRows || []) as { group_id: string }[]) {
      const s = stats[row.group_id];
      if (s) s.memberCount += 1;
    }
    setGroupStats(stats);
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

  const calendarLabel = `${new Date().getMonth() + 1}월${new Date().getDate()}일`;

  /**
   * 날짜 아래 바/캘린더 아이콘 옆에 띄울 "예정된 회의" 한 건.
   * 캘린더 페이지에서 직접 등록한 일정(localStorage, 반복 포함)을 읽어 지금 이후로 가장
   * 가까운 발생분을 보여줍니다. 캘린더의 "다가오는 일정"과 같은 규칙(utils/localSchedules)이라
   * 두 화면의 결과가 항상 같습니다. DB의 meetings.date는 회의가 끝난 뒤에 기록돼서 미래 값이
   * 생기지 않으므로 여기서는 쓰지 않습니다(사전 예약 기능이 생기면 같이 비교하면 됩니다).
   * 렌더마다 localStorage를 다시 읽지 않도록 useMemo로 한 번만 계산합니다.
   */
  const nextSchedule = useMemo(() => findNextLocalSchedule(loadLocalSchedules(), new Date(), 29), []);
  // 일정이 연결된 그룹 이름을 우선 쓰고, 그룹을 못 찾으면(탈퇴 등) 일정 제목으로 대신합니다
  const nextMeetingGroupName =
    groups.find((g) => g.id === nextSchedule?.schedule.groupId)?.name ?? nextSchedule?.schedule.title ?? '그룹';
  const nextMeetingDateLabel = nextSchedule
    ? `${nextSchedule.when.getMonth() + 1}월 ${nextSchedule.when.getDate()}일`
    : '';

  return (
    <AppShell activePage="main">
      {/* 일정 / 그룹카드 / 회의·문서, 이렇게 3개를 세로로 1:2:3 비율로 나눠 채웁니다
          (styles.thirdsLayout). 회의 목록과 최근 AI 요약(문서)은 서로 다른 두 칸이
          아니라 한 칸 안에 2열로 나란히 둡니다 — 그 칸 안에서 목록이 넘치면 페이지
          전체가 늘어나는 대신 패널(.panel)이 자체적으로 overflow-y: auto로
          스크롤합니다. */}
      <div className={styles.thirdsLayout}>
        <div className={`${styles.todayHeader} ${styles.thirdsSection}`}>
          <h1 className={styles.todayDate}>{calendarLabel}</h1>

          {/* 날짜 아래 바 + 캘린더 아이콘. 옆에는 캘린더에 등록한 가장 가까운 예정 일정을 보여주고,
              없으면 안내 문구를 띄웁니다. */}
          <div className={styles.todayMetaRow}>
            <span className={styles.todayBar} aria-hidden="true" />
            <Icon name="calendar" className={styles.todayCalendarIcon} />
            {/* 가장 가까운 예정 회의 한 건만 문장으로 보여주고, 없으면 안내 문구를 띄웁니다. */}
            <div className={styles.upcomingMeetings}>
              {nextSchedule ? (
                <span className={styles.upcomingMeetingItem}>
                  {nextMeetingGroupName}의 회의가 {nextMeetingDateLabel}에 예정되어 있습니다.
                </span>
              ) : (
                <span className={styles.upcomingMeetingItem}>예정된 회의가 없습니다</span>
              )}
            </div>
          </div>
        </div>

        {/* 참고로 받은 최신 Figma 변환본(titleWrapper/h37 "최근 그룹")엔 카드 위에
            섹션 제목이 붙어있어서 추가했습니다.
            캐러셀(좌우 화살표 + 가로 스크롤)은 없앴습니다 — 최신 그룹 4개까지만
            스크롤 없이 한 화면에 고정으로 보여주는 스택 형태로 바꿨습니다. 5번째
            그룹부터는 이 카드 영역엔 아예 안 나타납니다(전체 그룹은 그룹 목록
            페이지에서 봅니다). */}
        <div className={`${styles.groupSection} ${styles.thirdsSection}`}>
          <h2 className={styles.groupSectionTitle}>최근 그룹</h2>

          <div className={styles.groupCards}>
            {groups.slice(0, 4).map((g) => {
              // zip 기준 — 카드가 배지(왼쪽 진한 컬러 블록)와 본문(이름/초대코드 +
              // 멤버 아이콘 + 회의·문서 수)으로 나뉩니다.
              const stat = groupStats[g.id] ?? { meetingCount: 0, docCount: 0, memberCount: 0 };
              const visibleMembers = Math.min(3, stat.memberCount);
              const extraMembers = stat.memberCount - visibleMembers;
              return (
                <div
                  key={g.id}
                  className={styles.groupCard}
                  onClick={() => navigate(`/group/${g.id}`)}
                >
                  {/* 시안처럼 각 요소를 카드 안에 비율 좌표로 배치합니다(CSS 참고) */}
                  <div className={styles.groupCardBadge}>{g.name.trim().charAt(0) || 'G'}</div>
                  <div className={styles.groupCardName}>{g.name}</div>
                  <div className={styles.groupCardInvite}>초대코드 {g.invite_code}</div>
                  <div className={styles.groupCardMembers}>
                    {/* 실제 그룹원 프로필 이미지 — 아직 못 불러왔으면 기존 임시 아이콘으로 대신합니다 */}
                    {Array.from({ length: visibleMembers }).map((_, i) => {
                      const member = memberAvatars[g.id]?.[i];
                      return member ? (
                        <img key={member.user_id} src={getAvatarSrc(member.avatar)} alt="" />
                      ) : (
                        <Icon key={i} name="circle-user" />
                      );
                    })}
                    {extraMembers > 0 && <span className={styles.groupCardMore}>+{extraMembers}</span>}
                  </div>
                  <div className={styles.groupCardStats}>
                    <span className={styles.groupCardStat}>
                      <Icon name="file-text" />
                      회의 {stat.meetingCount}
                    </span>
                    <span className={styles.groupCardStat}>
                      <Icon name="file-text" />
                      문서 {stat.docCount}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 참고 코드(contentWrapper/projectCard)는 "회의 목록"·"최근 AI 요약" 제목과
            전체보기 링크 4개를 패널 안이 아니라 패널 위 공용 헤더 한 줄로 몰아뒀습니다
            — 그래서 기존에 각 .panel 안에 있던 .sectionHead를 이 헤더 줄(dashboardHead)로
            옮기고, 패널(.panel)은 표/목록 내용만 담도록 바꿨습니다. */}
        <div className={`${styles.dashboardSection} ${styles.thirdsSection}`}>
          <div className={styles.dashboardHead}>
            {/* 제목만 보여줍니다 — "전체 보기" 링크는 뺐습니다 */}
            <div className={styles.sectionHead}>
              <h2>문서 목록</h2>
            </div>
            <div className={styles.sectionHead}>
              <h2>최근 AI 요약</h2>
            </div>
          </div>

          <div className={styles.dashboardRow}>
          <section className={`${styles.panel} ${styles.meetingPanel}`}>
            <div className={styles.meetingCols}>
              <span>회의 제목</span><span>진행 상태</span><span>날짜</span><span>참석자</span><span>AI 요약</span>
            </div>
            {/* zip의 rectangleGroup(행 하나 = 독립된 흰 카드) 스타일로 — 예전엔 표 한 줄씩
                구분선(hr)만 있었는데, 지금은 각 회의가 자기 카드를 갖습니다. */}
            <div className={styles.meetingList}>
              {/* 데이터가 없을 땐 안내 문구 없이 빈 패널만 보여주고, 회의가 생기면 행이 추가됩니다. */}
              {meetings.slice(0, MEETING_VISIBLE).map((m) => (
                <div
                  key={m.id}
                  className={styles.meetingCard}
                  onClick={() => navigate(`/group/${m.group_id}/meeting/${m.id}`)}
                >
                  <span className={styles.title}>{m.title || '회의'}</span>
                  <span className={`${styles.statusPill} ${m.summary ? styles.statusPillDone : styles.statusPillProgress}`}>
                    {m.summary ? '완료' : '진행중'}
                  </span>
                  <span className={styles.date}>{formatMeetingDate(m.date)}</span>
                  {/* 회의별 참석자 기록이 없어서, 그 회의가 속한 그룹의 그룹원(최대 3명)을 보여줍니다.
                      아직 못 불러왔으면 기존 임시 아이콘 3개로 대신합니다 */}
                  <span className={styles.attendees}>
                    {memberAvatars[m.group_id]
                      ? memberAvatars[m.group_id].slice(0, 3).map((member) => (
                          <img key={member.user_id} src={getAvatarSrc(member.avatar)} alt="" />
                        ))
                      : [0, 1, 2].map((i) => <Icon key={i} name="circle-user" />)}
                  </span>
                  <span className={styles.aiIcon}>
                    <img src={m.summary ? aiCheckDone : aiCheckPending} alt={m.summary ? '요약 완료' : '요약 미완'} />
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.summaryList}>
              {meetings.filter((m) => m.summary).slice(0, SUMMARY_VISIBLE).map((m) => (
                <div key={m.id} className={styles.summaryCard}>
                  {/* 시안의 문서 아이콘(icon-description.svg, 초록 고정색) — 임시 선형 아이콘(file-text)을 교체 */}
                  <img src={docIcon} alt="" className={styles.docIcon} />
                  <div className={styles.content}>
                    <div className={styles.topRow}>
                      <span className={styles.summaryTitle}>{m.title || '회의'}</span>
                      <span className={styles.summaryDate}>{formatMeetingDate(m.date)}</span>
                    </div>
                    <p className={styles.desc}>{m.summary}</p>
                  </div>
                  <span className={`${styles.statusPill} ${styles.statusPillDone}`}>완료</span>
                </div>
              ))}
            </div>
          </section>
          </div>
        </div>
      </div>

      {/* 액션바(새 회의 생성/AI 요약/문서 작성/멤버 관리)를 뺐습니다. 다만 "새 회의
          생성" 버튼이 아래 GroupModal(그룹 생성/참가)을 여는 유일한 진입점이었어서,
          지금은 이 페이지에서 모달을 열 방법이 없습니다 — modalOpen 상태와
          GroupModal 자체는 나중에 다른 곳에 다시 연결할 수 있게 그대로 남겨뒀습니다. */}
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
