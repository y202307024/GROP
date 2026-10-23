import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import LeaveGroupModal from '../components/LeaveGroupModal';
import { getAvatarSrc } from '../utils/avatarOptions';
import styles from './MemberList.module.css';

type Member = {
  id: string;
  user_id: string;
  joined_at: string;
  nickname: string;
  avatar: string;
};

/** 멤버 목록 — grop/css/member.css 클래스명을 그대로 사용합니다. */
export default function MemberList() {
  const { id: groupId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState('');
  const [groupName, setGroupName] = useState('');
  const [leaveOpen, setLeaveOpen] = useState(false);

  useEffect(() => {
    fetchMembers();
  }, [groupId]);

  const fetchMembers = async () => {
    const { data: userData } = await supabase.auth.getUser();
    setCurrentUserId(userData.user?.id || '');

    const { data, error } = await supabase.rpc('get_group_members_with_profiles', {
      p_group_id: groupId
    });

    if (error) {
      console.error('멤버 조회 실패:', error);
      setLoading(false);
      return;
    }

    setMembers(data || []);

    // 그룹 삭제 확인(이름 입력)에 쓸 그룹 이름
    const { data: groupRow } = await supabase.from('groups').select('name').eq('id', groupId).maybeSingle();
    setGroupName(groupRow?.name ?? '');
    setLoading(false);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  // 정렬: 나 → 관리자 → 나머지 멤버(가입 순서 유지). 관리자는 "가입 순서상 첫 번째 사람"이라는 기존 규칙(i === 0)인데,
  // 나를 앞으로 옮긴 뒤 인덱스로 판정하면 관리자 뱃지가 엉뚱한 사람에게 붙으므로 정렬 전에 먼저 역할을 정해 둡니다.
  const sortedMembers = members
    .map((m, i) => ({ m, isAdmin: i === 0, isMe: m.user_id === currentUserId }))
    .sort((a, b) => {
      const rank = (x: { isAdmin: boolean; isMe: boolean }) => (x.isMe ? 0 : x.isAdmin ? 1 : 2);
      return rank(a) - rank(b); // Array.sort는 안정 정렬이라 같은 등급끼리는 원래(가입) 순서가 유지됩니다
    });

  // 그룹 상세(GroupPage)에서 "멤버 전체 보기"로 들어오는 화면이라, 사이드바 선택도 그 상세가 쓰던 항목을 그대로
  // 유지합니다(그룹 목록에서 왔으면 "그룹", 아니면 "메인") — 예전엔 항상 "그룹"이라 선택이 옮겨가 버렸습니다.
  const fromGroupList = (location.state as { from?: string } | null)?.from === 'member';
  return (
    <AppShell activePage={fromGroupList ? 'member' : 'main'}>
      {/* 페이지 높이를 화면에 고정하고, 멤버가 많아지면 목록 카드 안에서만 스크롤됩니다(.fixedPage/.memberBody) */}
      <div className={`page ${styles.fixedPage}`}>
        {/* 문서/회의록 페이지와 같은 상단 줄: 왼쪽 탭 제목 "멤버" + 오른쪽 "그룹으로" 버튼 */}
        <div className={styles.docHeader}>
          <div className={styles.tabs}>
            <span className={styles.tab}>멤버</span>
          </div>
          <div className={styles.toolbar}>
            <button
              className={styles.backButton}
              type="button"
              aria-label="그룹으로"
              title="그룹으로"
              onClick={() => navigate(`/group/${groupId}`, { state: location.state })}
            >
              <Icon name="chevron-left" />
            </button>
          </div>
        </div>

        {loading ? (
          <div>불러오는 중...</div>
        ) : (
          <div className={styles.memberCard}>
            {/* 헤더(sticky) + 행들이 이 영역 안에서만 스크롤됩니다 */}
            <div className={styles.memberBody}>
            <div className="list-row list-head member-row">
              <span>이름</span>
              <span>역할</span>
              <span>가입일</span>
              <span></span>
            </div>
            {sortedMembers.map(({ m, isAdmin, isMe }) => {
              return (
                <div key={m.id} className="list-row member-row">
                  <div className="person-cell">
                    <div className="avatar-circle"><img src={getAvatarSrc(m.avatar)} alt="" /></div>
                    <div>
                      <div className="person-name">{m.nickname || '알 수 없음'}</div>
                      <div className="person-sub">{isMe ? '나' : ''}</div>
                    </div>
                  </div>
                  <span>
                    <span className={`badge${isAdmin ? '' : ' badge-muted'}`}>{isAdmin ? '리더' : '멤버'}</span>
                  </span>
                  <span>{formatDate(m.joined_at)}</span>
                  {/* 내 줄 맨 오른쪽에만 "그룹 나가기" — 리더/일반 멤버 분기는 모달이 처리합니다 */}
                  <span className={styles.leaveCell}>
                    {isMe && (
                      <button type="button" className={styles.leaveButton} onClick={() => setLeaveOpen(true)}>
                        그룹 나가기
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
            </div>
            {/* 하단 요약 — 문서 페이지의 "문서 N개" 줄과 같은 자리 */}
            <div className={styles.listFooter}>멤버 {members.length}명</div>
          </div>
        )}
      </div>
      <LeaveGroupModal
        open={leaveOpen}
        groupId={groupId ?? ''}
        groupName={groupName}
        members={members}
        currentUserId={currentUserId}
        // 리더 = 목록 첫 번째(08_그룹_나가기.sql 이 위임된 리더를 맨 앞으로 보냅니다)
        isLeader={members.length > 0 && members[0].user_id === currentUserId}
        onClose={() => setLeaveOpen(false)}
        onLeft={() => navigate('/groups', { replace: true })}
      />
    </AppShell>
  );
}
