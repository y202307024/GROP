import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import GroupEditModal from '../components/GroupEditModal';
import { getAvatarSrc } from '../utils/avatarOptions';
import { uniqueMembersByUserId } from '../utils/joinGroup';
import { formatStorageBytes } from '../utils/meetingVideo';
import { findNextLocalSchedule, loadLocalSchedules } from '../utils/localSchedules';
import styles from './GroupPage.module.css';

// created_at 은 groups 테이블에 있을 때만 채워집니다(select('*')라 컬럼이 없으면 undefined → 날짜를 그리지 않음).
type Group = { id: string; name: string; invite_code: string; created_at?: string | null };
type MyProfile = { nickname: string | null; avatar: string | null; avatar_url: string | null };
// user_id는 "나" 표시와 그룹 편집 모달의 멤버 권한 목록에 필요해서 함께 들고 있습니다.
type MemberPreview = { user_id: string; nickname: string; avatar: string };
/** 공지 미리보기 한 줄 */
type Notice = { id: string; title: string; created_at: string
  is_pinned?: boolean;
};

/** 그룹 카드의 다음 일정. "10월 24일 오전 10:00" */
function formatNextSchedule(when: Date) {
  const h = when.getHours();
  return `${when.getMonth() + 1}월 ${when.getDate()}일 ${h >= 12 ? '오후' : '오전'} ${h % 12 || 12}:${String(when.getMinutes()).padStart(2, '0')}`;
}

/** 그룹 하나당 저장 한도. 막대는 이 값 대비 지금 쓴 용량입니다. */
const GROUP_STORAGE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;

/** 첨부 목록에 적힌 파일 크기만 더합니다. 크기 없는 항목은 0으로 둡니다. */
function attachmentBytes(raw: unknown) {
  if (!Array.isArray(raw)) return 0;
  return raw.reduce((sum, item) => {
    if (!item || typeof item !== 'object') return sum;
    const size = (item as { size?: unknown }).size;
    return sum + (typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : 0);
  }, 0);
}

/** 그룹 생성일을 "2026.10.21" 형식으로 */
function formatCreatedDate(dateStr: string) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}.${month}.${day}`;
}

/**
 * 그룹 상세 — grop/pages/group-detail.html 마크업과 group-detail.css 를 그대로 사용합니다.
 */
export default function GroupPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // 그룹 목록(/groups)에서 들어왔으면 사이드바 "그룹"을, 아니면(메인 등) 예전처럼 "메인"을 선택 상태로 둡니다.
  // 출처는 이동할 때 넘긴 라우터 state.from 으로 구분합니다(GroupListPage 참고).
  const fromGroupList = (location.state as { from?: string } | null)?.from === 'member';
  const activePage = fromGroupList ? 'member' : 'main';
  const [group, setGroup] = useState<Group | null>(null);
  const [myProfile, setMyProfile] = useState<MyProfile | null>(null);
  const [members, setMembers] = useState<MemberPreview[]>([]);
  /** 통계 "완료된 요약" — AI 요약(summary)이 채워진 회의 수 */
  const [summaryCount, setSummaryCount] = useState(0);
  /** 공지 미리보기(최신 4개) */
  const [notices, setNotices] = useState<Notice[]>([]);
  const [copied, setCopied] = useState(false);
  const [currentUserId, setCurrentUserId] = useState('');
  /** 그룹 프로필 편집을 저장하면 올려서, 멤버 목록/내 프로필을 다시 불러오게 하는 카운터 */
  const [profileReload, setProfileReload] = useState(0);
  /** "그룹 편집" 버튼 → 설정 페이지 대신 그룹 편집 모달을 띄웁니다. */
  const [editOpen, setEditOpen] = useState(false);
  /**
   * 그룹 메모 — groups 테이블에 memo 컬럼이 없어서 아직 저장은 안 되고,
   * 편집 모달에서 저장을 누르면 이 세션 동안만 기억해서 아래 배너에 보여줍니다.
   */
  const [memo, setMemo] = useState('');
  /** 이 그룹 회의 영상 + 첨부 파일 용량. 아직 못 읽으면 null */
  const [storageBytes, setStorageBytes] = useState<number | null>(null);
  // 캘린더에서 이 그룹으로 등록한 일정 중, 아직 시작 전인 가장 가까운 것
  const nextSchedule = useMemo(
    () => (id ? findNextLocalSchedule(loadLocalSchedules(), new Date(), 62, id) : null),
    [id],
  );

  const copyInviteCode = async () => {
    if (!group) return;
    const code = group.invite_code.trim().toUpperCase();
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      prompt('초대코드를 복사하세요:', code);
    }
  };

  useEffect(() => {
    supabase.from('groups').select('*').eq('id', id).single()
      .then(({ data }) => { if (data) setGroup(data); });

    // "완료된 요약" — 회의 전체 개수가 아니라, 요약 텍스트가 실제로 들어 있는 회의만 셉니다
    // (녹화 전 문서만 만든 회의처럼 summary가 null/빈 문자열인 행 제외).
    supabase
      .from('meetings')
      .select('id', { count: 'exact', head: true })
      .eq('group_id', id)
      .not('summary', 'is', null)
      .neq('summary', '')
      .then(({ count }) => setSummaryCount(count ?? 0));

    // 공지 미리보기 — 최신 4개만. 테이블 조회가 실패하면(권한/미생성 등) 빈 목록으로 둡니다.
    supabase
      .from('notices')
      .select('id, title, created_at, is_pinned')
      .eq('group_id', id)
      // 고정 공지가 맨 위 — 공지 페이지와 같은 순서
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(4)
      .then(({ data }) => setNotices((data as Notice[] | null) ?? []));

    // 저장 공간 — 회의 영상(video_size_bytes)과 첨부(attachments.size)를 더합니다.
    // 영상 칸이 없는 배포에서는 첨부만 셉니다.
    setStorageBytes(null);
    void (async () => {
      const withVideo = await supabase
        .from('meetings')
        .select('video_size_bytes, attachments')
        .eq('group_id', id);
      const rows = withVideo.error && /video_size_bytes/i.test(withVideo.error.message)
        ? (await supabase.from('meetings').select('attachments').eq('group_id', id)).data
        : withVideo.data;
      const total = ((rows as { video_size_bytes?: number | null; attachments?: unknown }[] | null) ?? []).reduce(
        (sum, row) => sum + (Number(row.video_size_bytes) || 0) + attachmentBytes(row.attachments),
        0,
      );
      setStorageBytes(total);
    })();

    supabase.rpc('get_group_members_with_profiles', { p_group_id: id })
      .then(({ data }) => {
        if (data) {
          // 같은 user_id 가 여러 줄이면 화면에도 두 번 나옵니다. 가입이 빠른 한 명만 남깁니다.
          const rows = uniqueMembersByUserId(data as { user_id: string; nickname: string; avatar: string }[]);
          setMembers(rows.map((m) => ({
            user_id: m.user_id,
            nickname: m.nickname || '멤버',
            avatar: m.avatar || '🙂',
          })));
        }
      });
  }, [id, profileReload]);

  useEffect(() => {
    const fetchMyProfile = async () => {
      if (!id) return;
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      setCurrentUserId(userData.user.id);

      const { data: groupProfile } = await supabase
        .from('group_profiles')
        .select('nickname, avatar, avatar_url')
        .eq('group_id', id)
        .eq('user_id', userData.user.id)
        .maybeSingle();

      if (groupProfile) {
        setMyProfile(groupProfile);
        return;
      }

      const { data: defaultProfile } = await supabase
        .from('profiles')
        .select('nickname, avatar, avatar_url')
        .eq('id', userData.user.id)
        .maybeSingle();

      setMyProfile(defaultProfile ?? { nickname: null, avatar: '🐱', avatar_url: null });
    };
    fetchMyProfile();
  }, [id, profileReload]);

  if (!group) {
    return (
      <AppShell activePage={activePage}>
        <div className="page">불러오는 중...</div>
      </AppShell>
    );
  }

  const extra = Math.max(0, members.length - 3);
  const createdDate = group.created_at ? formatCreatedDate(group.created_at) : '';

  // 미리보기 정렬: 나 → 리더 → 나머지(멤버 페이지 MemberList와 같은 순서). 리더는 "가입 순서상 첫 번째 사람"
  // 규칙(원래 인덱스 0)이라, 나를 앞으로 옮긴 뒤 인덱스로 판정하면 뱃지가 엉뚱한 사람에게 붙으므로 정렬 전에 정해 둡니다.
  const sortedMembers = members
    .map((m, i) => ({ m, isAdmin: i === 0, isMe: m.user_id === currentUserId }))
    .sort((a, b) => {
      const rank = (x: { isAdmin: boolean; isMe: boolean }) => (x.isMe ? 0 : x.isAdmin ? 1 : 2);
      return rank(a) - rank(b); // 안정 정렬이라 같은 등급끼리는 원래(가입) 순서 유지
    });

  return (
    <AppShell activePage={activePage}>
      {/* 전체 베이지 배경(group-detail-page)은 쓰지 않습니다 — 베이지는 아래 .heroPanel(아이콘~메모)에만 깔고,
          통계 카드/미리보기 카드는 그 밖(페이지 배경 위)에 둡니다. */}
      <div className={`page ${styles.pageFit}`}>
        {/* 맨 윗줄: 왼쪽 그룹 생성일(글자만) / 오른쪽 뒤로가기. 멤버/회의록 페이지와 같은 초록 ‹ 화살표입니다 */}
        <div className={styles.topRow}>
          {createdDate && <span className={styles.createdDate}>그룹 생성일 {createdDate}</span>}
          <button className={styles.backButton} type="button" aria-label="내 그룹으로" title="내 그룹으로" onClick={() => navigate(fromGroupList ? '/groups' : '/main')}>
            <Icon name="chevron-left" />
          </button>
        </div>

        {/* 컬러 배경 패널: 그룹 아이콘 ~ 멤버 줄 ~ 메모 배너까지만 묶습니다 */}
        <section className={styles.heroPanel}>
        <div className={`group-detail-profile-row ${styles.profileRow}`}>
          <div className="group-detail-identity">
            <div className="group-detail-avatar">
              {myProfile?.avatar_url
                ? <img src={myProfile.avatar_url} alt="" />
                : (group.name.trim().charAt(0) || 'G')}
            </div>
            <div className={styles.identityText}>
              {/* 그룹 이름과 편집/회의방 버튼을 한 줄(.nameRow)에 두어 버튼이 이름 줄 가운데 높이에 정확히 맞게 합니다.
                  예전엔 버튼이 아이콘 맨 위(flex-start)에 붙어서 이름 줄과 높이가 어긋났습니다. */}
              <div className={styles.nameRow}>
                <div className="group-detail-name">{group.name}</div>
                <div className={styles.headerActions}>
                  <button
                    className={`secondary-button ${styles.editButton}`}
                    type="button"
                    onClick={() => setEditOpen(true)}
                  >
                    그룹 편집
                  </button>
                  <button className={`group-meeting-button ${styles.meetingButton}`} type="button" onClick={() => navigate(`/room/${id}`)}>
                    회의방으로 이동
                  </button>
                </div>
              </div>
              <div className="group-detail-invite">
                <span>초대코드 {group.invite_code}</span>
                <button
                  className={`group-invite-copy-button${copied ? ' is-copied' : ''}`}
                  type="button"
                  aria-label="초대코드 복사"
                  onClick={copyInviteCode}
                >
                  <Icon name="clipboard" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className={`group-detail-member-row ${styles.memberSummaryRow}`}>
          <div className="group-detail-member-summary">
            <div className="group-detail-avatar-stack">
              {sortedMembers.slice(0, 3).map(({ m }, i) => (
                <div className="mini-avatar" key={`${m.nickname}-${i}`}>
                  <img src={getAvatarSrc(m.avatar)} alt="" />
                </div>
              ))}
              {extra > 0 && <div className="mini-avatar mini-avatar-more">+{extra}</div>}
            </div>
            <span>멤버 {members.length}명</span>
          </div>
        </div>

        {/* 맨 아래 줄: 왼쪽은 메모, 오른쪽(회의방으로 이동 아래)은 이 그룹이 쓴 저장 공간 */}
        <div className={styles.heroBottom}>
          {memo ? (
            <div className={styles.memoBanner}>
              <span className={styles.memoText}>{memo}</span>
            </div>
          ) : (
            <div className={`${styles.memoBanner} ${styles.memoBannerMuted}`}>
              <Icon name="message-circle" className={styles.memoIcon} />
              <span className={styles.memoText}>그룹 메모가 아직 없어요. 그룹 편집에서 추가해보세요.</span>
            </div>
          )}
          <div className={styles.storageStat}>
            <span className={styles.storageLabel}>저장 공간</span>
            {/* 10GB 한도 대비 사용량. 아주 적어도 막대가 보이도록 사용 중이면 최소 너비를 둡니다. */}
            <div
              className={styles.storageTrack}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={GROUP_STORAGE_LIMIT_BYTES}
              aria-valuenow={storageBytes ?? 0}
              aria-label="그룹 저장 공간"
            >
              <div
                className={styles.storageFill}
                style={{
                  width:
                    storageBytes == null || storageBytes <= 0
                      ? '0%'
                      : `${Math.min(100, Math.max((storageBytes / GROUP_STORAGE_LIMIT_BYTES) * 100, 2))}%`,
                }}
              />
            </div>
            <span className={styles.storageValue}>
              {storageBytes == null
                ? `— / ${formatStorageBytes(GROUP_STORAGE_LIMIT_BYTES)}`
                : `${formatStorageBytes(storageBytes)} / ${formatStorageBytes(GROUP_STORAGE_LIMIT_BYTES)}`}
            </span>
          </div>
        </div>
        </section>

        <div className={styles.statsCard}>
          <div className={styles.statItem}>
            <Icon name="calendar" className={`${styles.statIcon} ${styles.statIconInfo}`} />
            <div>
              <div className={styles.statLabel}>다음 일정</div>
              <div className={styles.statValue}>
                {nextSchedule ? formatNextSchedule(nextSchedule.when) : '미정'}
              </div>
            </div>
          </div>
          <div className={styles.statDivider} />
          {/* 통계 표시 전용 — 클릭 이동은 아래 멤버 미리보기 카드의 "전체보기"로 하므로 버튼이 아닌 div로 둡니다 */}
          <div className={styles.statItem}>
            <Icon name="users" className={`${styles.statIcon} ${styles.statIconAccent}`} />
            <div>
              <div className={styles.statLabel}>참여 인원</div>
              <div className={styles.statValue}>{members.length}명</div>
            </div>
          </div>
          <div className={styles.statDivider} />
          <div className={styles.statItem}>
            <Icon name="file-text" className={`${styles.statIcon} ${styles.statIconPrimary}`} />
            <div>
              <div className={styles.statLabel}>완료된 요약</div>
              <div className={styles.statValue}>{summaryCount}건</div>
            </div>
          </div>
        </div>

        <div className={`group-detail-preview-grid ${styles.previewGrid}`}>
          <div className={`group-preview-card ${styles.previewCard}`}>
            <div className="group-preview-header">
              <span>멤버 {members.length}</span>
              <span className="group-preview-link" onClick={() => navigate(`/group/${id}/members`, { state: location.state })} style={{ cursor: 'pointer' }}>
                전체보기 ›
              </span>
            </div>
            <div className={styles.memberList}>
              {/* 리더 판정(가입 순서 첫 번째)과 정렬 규칙은 MemberList.tsx와 동일합니다. */}
              {sortedMembers.slice(0, 4).map(({ m, isAdmin }) => (
                <div
                  className={styles.memberRow}
                  key={m.user_id}
                  onClick={() => navigate(`/group/${id}/members`, { state: location.state })}
                >
                  <div className="mini-avatar">
                    <img src={getAvatarSrc(m.avatar)} alt="" />
                  </div>
                  <span className={styles.memberName}>{m.nickname}</span>
                  {isAdmin && <span className={styles.roleBadge}>리더</span>}
                  <Icon name="chevron-right" className={styles.memberChevron} />
                </div>
              ))}
            </div>
          </div>

          {/* 공지 — 회의록 목록 페이지를 없애면서 "최근 회의록" 자리를 대체합니다. */}
          <div className={`group-preview-card ${styles.previewCard}`}>
            <div className="group-preview-header">
              <span>공지</span>
              <span className="group-preview-link" onClick={() => navigate(`/group/${id}/notices`, { state: location.state })} style={{ cursor: 'pointer' }}>
                전체보기 ›
              </span>
            </div>
            {notices.length === 0 ? (
              <div className="group-preview-muted">등록된 공지가 없어요.</div>
            ) : (
              <div className={styles.memberList}>
                {/* 멤버 목록과 같은 줄 구성(아이콘 + 제목/날짜 + 화살표 + 구분선) */}
                {notices.map((n) => (
                  <div className={styles.noticeRow} key={n.id} onClick={() => navigate(`/group/${id}/notices`, { state: location.state })}>
                    <Icon name={n.is_pinned ? 'pin' : 'message-circle'} className={styles.noticeIcon} />
                    <div className={styles.noticeMeta}>
                      <div className={styles.noticeTitle}>{n.title}</div>
                      <div className={styles.noticeDate}>{formatCreatedDate(n.created_at)}</div>
                    </div>
                    <Icon name="chevron-right" className={styles.memberChevron} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <GroupEditModal
        open={editOpen}
        groupId={group.id}
        groupName={group.name}
        groupMemo={memo}
        members={members}
        currentUserId={currentUserId}
        onClose={() => setEditOpen(false)}
        onMemberProfileSaved={() => setProfileReload((n) => n + 1)}
        onSaved={(name, nextMemo) => {
          setGroup((prev) => (prev ? { ...prev, name } : prev));
          setMemo(nextMemo);
        }}
      />
    </AppShell>
  );
}
