import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import Icon from './Icon';

type Props = {
  children: ReactNode;
  /** 사이드바에서 현재 페이지로 표시할 메뉴 id */
  activePage?: 'main' | 'meeting' | 'document' | 'ai' | 'calendar' | 'member' | 'setting';
};

const navItems = [
  { id: 'main', label: '메인', icon: 'home' as const, path: '/main' },
  { id: 'meeting', label: '회의', icon: 'clipboard-list' as const, path: '/canvas' },
  { id: 'document', label: '문서', icon: 'file-text' as const, path: '/documents' },
  { id: 'ai', label: 'AI 요약', icon: 'sparkles' as const, path: '/ai' },
  { id: 'calendar', label: '캘린더', icon: 'calendar' as const, comingSoon: true },
  { id: 'member', label: '팀원', icon: 'users' as const, path: '/main' },
  { id: 'setting', label: '설정', icon: 'settings' as const, path: '/profile' },
];

/**
 * grop/main.html 과 같은 앱 껍데기
 * - 사이드바: 메인/회의/문서/AI/캘린더/팀원/설정
 * - 상단바: 알림 + 프로필
 * - children: 각 페이지 본문
 */
export default function AppShell({ children, activePage = 'main' }: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [avatar, setAvatar] = useState('🙂');
  const [notifyOpen, setNotifyOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!mounted || !data.user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('nickname, avatar, avatar_url')
        .eq('id', data.user.id)
        .maybeSingle();
      if (!mounted || !profile) return;
      setAvatar(profile.avatar_url || profile.avatar || '🙂');
    });
    return () => {
      mounted = false;
    };
  }, [pathname]);

  const current =
    activePage ||
    (pathname.startsWith('/profile') ? 'setting' : pathname.startsWith('/documents') ? 'document' : pathname.startsWith('/group') ? 'main' : 'main');

  return (
    <div className="app stage">
      <aside className="sidebar">
        <div className="logo">GROP</div>
        <nav className="nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item menu${current === item.id ? ' active' : ''}`}
              onClick={() => {
                // 원본 HTML과 같이 AI/캘린더는 아직 화면이 없습니다.
                if (item.comingSoon) {
                  alert('아직 준비 중인 기능입니다');
                  return;
                }
                if (item.path) navigate(item.path);
              }}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="notification-wrapper">
            <button
              className="icon-btn"
              type="button"
              aria-label="알림"
              onClick={() => setNotifyOpen((open) => !open)}
            >
              <Icon name="bell" />
            </button>
            <div className="notification-dropdown" hidden={!notifyOpen}>
              <div className="notification-dropdown-arrow" />
              <div className="notification-dropdown-header">알림</div>
              <div className="notification-list">
                <div className="notification-item">
                  <div className="notification-item-title">새 회의가 생성됐어요</div>
                  <div className="notification-item-time">5분 전</div>
                </div>
                <div className="notification-item">
                  <div className="notification-item-title">AI 요약이 완료됐어요</div>
                  <div className="notification-item-time">1시간 전</div>
                </div>
                <div className="notification-item">
                  <div className="notification-item-title">그룹에 새 멤버가 참여했어요</div>
                  <div className="notification-item-time">어제</div>
                </div>
              </div>
            </div>
          </div>

          <button
            className="icon-btn profile-button"
            type="button"
            aria-label="내 프로필"
            onClick={() => navigate('/profile')}
          >
            <span className="profile-button-avatar">
              {avatar.startsWith('http') ? <img src={avatar} alt="" /> : avatar}
            </span>
          </button>
        </div>

        {children}
      </main>
    </div>
  );
}
