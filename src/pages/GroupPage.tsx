import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import { getAvatarSrc } from '../utils/avatarOptions';
import { fetchGroupMeta, isGroupOwner, type GroupMeta } from '../utils/groupPermissions';

type Group = {
  id: string;
  name: string;
  invite_code: string;
  created_by?: string | null;
  avatar_url?: string | null;
};
type MyProfile = { nickname: string | null; avatar: string | null; avatar_url: string | null };
type MemberPreview = { nickname: string; avatar: string; is_owner?: boolean; user_id?: string };

/**
 * 그룹 상세 — 그룹 프사·방장 기준·공지/예약 바로가기.
 */
export default function GroupPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState<Group | null>(null);
  const [meta, setMeta] = useState<GroupMeta | null>(null);
  const [userId, setUserId] = useState('');
  const [myProfile, setMyProfile] = useState<MyProfile | null>(null);
  const [members, setMembers] = useState<MemberPreview[]>([]);
  const [meetingCount, setMeetingCount] = useState(0);
  const [nextMeetingLabel, setNextMeetingLabel] = useState('미정');
  const [latestNotice, setLatestNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleTitle, setScheduleTitle] = useState('');
  const [scheduleWhen, setScheduleWhen] = useState('');
  const [scheduling, setScheduling] = useState(false);

  const owner = isGroupOwner(meta, userId);

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

  const refreshMeetings = async (groupId: string) => {
    const { count } = await supabase
      .from('meetings')
      .select('id', { count: 'exact', head: true })
      .eq('group_id', groupId);
    setMeetingCount(count ?? 0);

    const nowIso = new Date().toISOString();
    const { data: upcoming } = await supabase
      .from('meetings')
      .select('title, date')
      .eq('group_id', groupId)
      .gte('date', nowIso)
      .order('date', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (upcoming?.date) {
      const d = new Date(upcoming.date);
      const label = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      setNextMeetingLabel(upcoming.title ? `${label} · ${upcoming.title}` : label);
    } else {
      setNextMeetingLabel('미정');
    }
  };

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!id) return;
      const { data: userData } = await supabase.auth.getUser();
      if (!mounted) return;
      setUserId(userData.user?.id || '');

      const loadedMeta = await fetchGroupMeta(id);
      if (!mounted) return;
      setMeta(loadedMeta);
      if (loadedMeta) {
        setGroup({
          id: loadedMeta.id,
          name: loadedMeta.name,
          invite_code: loadedMeta.inviteCode,
          created_by: loadedMeta.createdBy,
          avatar_url: loadedMeta.avatarUrl,
        });
      } else {
        const { data } = await supabase.from('groups').select('*').eq('id', id).single();
        if (mounted && data) setGroup(data);
      }

      await refreshMeetings(id);

      const { data: memberData } = await supabase.rpc('get_group_members_with_profiles', {
        p_group_id: id,
      });
      if (mounted && memberData) {
        setMembers(
          memberData.map((m: MemberPreview & { nickname: string; avatar: string }) => ({
            nickname: m.nickname || '멤버',
            avatar: m.avatar || '🙂',
            is_owner: m.is_owner,
            user_id: m.user_id,
          })),
        );
      }

      const { data: notice } = await supabase
        .from('group_announcements')
        .select('title')
        .eq('group_id', id)
        .not('published_at', 'is', null)
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (mounted) setLatestNotice(notice?.title ?? null);
    };
    void load();
    return () => {
      mounted = false;
    };
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
    void fetchMyProfile();
  }, [id]);

  /** 방장: 회의 예약 → meetings insert → 멤버 캘린더에 자동 표시 */
  const submitSchedule = async () => {
    if (!owner || !id) return;
    if (!scheduleTitle.trim() || !scheduleWhen) {
      alert('제목과 일시를 입력해 주세요.');
      return;
    }
    setScheduling(true);
    const { error } = await supabase.from('meetings').insert({
      group_id: id,
      title: scheduleTitle.trim(),
      date: new Date(scheduleWhen).toISOString(),
    });
    setScheduling(false);
    if (error) {
      alert(`예약 실패: ${error.message}`);
      return;
    }
    setScheduleOpen(false);
    setScheduleTitle('');
    setScheduleWhen('');
    await refreshMeetings(id);
    alert('회의가 예약되었습니다. 그룹원 캘린더에 표시됩니다.');
  };

  if (!group) {
    return (
      <AppShell activePage="main">
        <div className="page">불러오는 중...</div>
      </AppShell>
    );
  }

  const extra = Math.max(0, members.length - 3);
  const groupAvatarLetter = (group.name.trim().charAt(0) || 'G').toUpperCase();

  return (
    <AppShell activePage="main">
      <div className="page group-detail-page">
        <button className="group-back-button" type="button" aria-label="내 그룹으로" onClick={() => navigate('/main')}>
          <Icon name="arrow-left" />
        </button>

        <div className="group-detail-profile-row">
          <div className="group-detail-identity">
            {/* 그룹 프사 — groups.avatar_url (개인 프로필과 분리) */}
            <div className="group-detail-avatar">
              {group.avatar_url ? (
                <img src={group.avatar_url} alt="" />
              ) : (
                groupAvatarLetter
              )}
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
                <div className="mini-avatar" key={`${m.nickname}-${i}`}>
                  <img src={getAvatarSrc(m.avatar)} alt="" />
                </div>
              ))}
              {extra > 0 && <div className="mini-avatar mini-avatar-more">+{extra}</div>}
            </div>
            <span>멤버 {members.length}명</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {owner ? (
              <button className="secondary-button" type="button" onClick={() => setScheduleOpen(true)}>
                회의 예약
              </button>
            ) : null}
            <button className="group-meeting-button" type="button" onClick={() => navigate(`/room/${id}`)}>
              회의방으로 이동
            </button>
          </div>
        </div>

        <div className="group-detail-memo">
          {myProfile?.nickname ? `${myProfile.nickname} 님, 이 그룹에서 협업을 이어가세요.` : '그룹 메모가 아직 없어요.'}
        </div>

        <div className="group-detail-stats">
          <div className="group-stat-card">
            <div className="group-stat-emoji">📅</div>
            <div className="group-stat-label">다음 일정</div>
            <div className="group-stat-value" style={{ fontSize: 14 }}>{nextMeetingLabel}</div>
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
                  {m.is_owner ? `👑 ${m.nickname}` : m.nickname}
                  {m.is_owner && <span className="group-preview-muted"> · 방장</span>}
                </div>
              ))}
            </div>
          </div>

          <div className="group-preview-card">
            <div className="group-preview-header">
              <span>공지사항</span>
              <span
                className="group-preview-link"
                onClick={() => navigate(`/group/${id}/announcements`)}
                style={{ cursor: 'pointer' }}
              >
                전체보기 ›
              </span>
            </div>
            <div className="group-preview-list">
              {latestNotice ? (
                <div>{latestNotice}</div>
              ) : (
                <div className="group-preview-muted">게시된 공지가 없습니다.</div>
              )}
            </div>
          </div>
        </div>

        {scheduleOpen ? (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.35)',
              display: 'grid',
              placeItems: 'center',
              zIndex: 50,
            }}
            onClick={() => setScheduleOpen(false)}
          >
            <div
              className="settings-card"
              style={{ width: 'min(420px, 92vw)', margin: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="settings-section">
                <h3>회의 예약</h3>
                <p className="settings-desc">예약하면 그룹원 캘린더에 자동으로 표시됩니다.</p>
                <div className="settings-row">
                  <label>제목</label>
                  <input
                    className="settings-field"
                    value={scheduleTitle}
                    onChange={(e) => setScheduleTitle(e.target.value)}
                    placeholder="예: 주간 회의"
                  />
                </div>
                <div className="settings-row">
                  <label>일시</label>
                  <input
                    className="settings-field"
                    type="datetime-local"
                    value={scheduleWhen}
                    onChange={(e) => setScheduleWhen(e.target.value)}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="primary-button" type="button" disabled={scheduling} onClick={submitSchedule}>
                    {scheduling ? '저장 중...' : '예약하기'}
                  </button>
                  <button className="secondary-button" type="button" onClick={() => setScheduleOpen(false)}>
                    취소
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
