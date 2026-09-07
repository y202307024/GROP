import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';

type Group = { id: string; name: string; invite_code: string };
type MyProfile = { nickname: string | null; avatar: string | null; avatar_url: string | null };
type MemberPreview = { nickname: string; avatar: string };

/**
 * 그룹 상세 — grop/pages/group-detail.html 마크업과 group-detail.css 를 그대로 사용합니다.
 */
export default function GroupPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState<Group | null>(null);
  const [myProfile, setMyProfile] = useState<MyProfile | null>(null);
  const [members, setMembers] = useState<MemberPreview[]>([]);
  const [meetingCount, setMeetingCount] = useState(0);
  const [copied, setCopied] = useState(false);

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

    supabase.from('meetings').select('id', { count: 'exact', head: true }).eq('group_id', id)
      .then(({ count }) => setMeetingCount(count ?? 0));

    supabase.rpc('get_group_members_with_profiles', { p_group_id: id })
      .then(({ data }) => {
        if (data) {
          setMembers(data.map((m: { nickname: string; avatar: string }) => ({
            nickname: m.nickname || '멤버',
            avatar: m.avatar || '🙂',
          })));
        }
      });
  }, [id]);

  useEffect(() => {
    const fetchMyProfile = async () => {
      if (!id) return;
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;

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
  }, [id]);

  if (!group) {
    return (
      <AppShell activePage="main">
        <div className="page">불러오는 중...</div>
      </AppShell>
    );
  }

  const extra = Math.max(0, members.length - 3);

  return (
    <AppShell activePage="main">
      <div className="page group-detail-page">
        <button className="group-back-button" type="button" aria-label="내 그룹으로" onClick={() => navigate('/main')}>
          <Icon name="arrow-left" />
        </button>

        <div className="group-detail-profile-row">
          <div className="group-detail-identity">
            <div className="group-detail-avatar">
              {myProfile?.avatar_url
                ? <img src={myProfile.avatar_url} alt="" />
                : (group.name.trim().charAt(0) || 'G')}
            </div>
            <div>
              <div className="group-detail-name">{group.name}</div>
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
          <button
            className="group-edit-icon-button"
            type="button"
            aria-label="그룹 편집"
            onClick={() => navigate(`/group/${id}/settings`)}
          >
            <Icon name="pencil" />
          </button>
        </div>

        <div className="group-detail-member-row">
          <div className="group-detail-member-summary">
            <div className="group-detail-avatar-stack">
              {members.slice(0, 3).map((m, i) => (
                <div className="mini-avatar" key={`${m.nickname}-${i}`}>{m.avatar}</div>
              ))}
              {extra > 0 && <div className="mini-avatar mini-avatar-more">+{extra}</div>}
            </div>
            <span>멤버 {members.length}명</span>
          </div>
          <button className="group-meeting-button" type="button" onClick={() => navigate(`/room/${id}`)}>
            회의방으로 이동
          </button>
        </div>

        <div className="group-detail-memo">
          {myProfile?.nickname ? `${myProfile.nickname} 님, 이 그룹에서 협업을 이어가세요.` : '그룹 메모가 아직 없어요.'}
        </div>

        <div className="group-detail-stats">
          <div className="group-stat-card">
            <div className="group-stat-emoji">📅</div>
            <div className="group-stat-label">다음 일정</div>
            <div className="group-stat-value">미정</div>
          </div>
          <div className="group-stat-card" onClick={() => navigate(`/group/${id}/members`)} style={{ cursor: 'pointer' }}>
            <div className="group-stat-emoji">👥</div>
            <div className="group-stat-label">참여 인원</div>
            <div className="group-stat-value">{members.length}명</div>
          </div>
          <div className="group-stat-card" onClick={() => navigate(`/group/${id}/meetings`)} style={{ cursor: 'pointer' }}>
            <div className="group-stat-emoji">🗓️</div>
            <div className="group-stat-label">누적 회의</div>
            <div className="group-stat-value">{meetingCount}회</div>
          </div>
        </div>

        <div className="group-detail-preview-grid">
          <div className="group-preview-card">
            <div className="group-preview-header">
              <span>멤버</span>
              <span className="group-preview-link" onClick={() => navigate(`/group/${id}/members`)} style={{ cursor: 'pointer' }}>
                전체보기 ›
              </span>
            </div>
            <div className="group-preview-list">
              {members.slice(0, 3).map((m, i) => (
                <div key={`${m.nickname}-${i}`}>
                  {i === 0 ? `👑 ${m.nickname}` : m.nickname}
                  {i === 0 && <span className="group-preview-muted"> · 방장</span>}
                </div>
              ))}
            </div>
          </div>

          <div className="group-preview-card">
            <div className="group-preview-header">
              <span>최근 회의록</span>
              <span className="group-preview-link" onClick={() => navigate(`/group/${id}/meetings`)} style={{ cursor: 'pointer' }}>
                전체보기 ›
              </span>
            </div>
            <div className="group-preview-list">
              <div className="group-preview-muted">회의록에서 지난 기록을 확인하세요.</div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
