import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import Icon from './Icon';
import NotificationBell from './NotificationBell';
import ProfileEditModal from './ProfileEditModal';
import { DEFAULT_AVATAR_KEY, getAvatarSrc } from '../utils/avatarOptions';

type Props = {
  children: ReactNode;
  /** 사이드바에서 현재 페이지로 표시할 메뉴 id */
  activePage?: 'main' | 'meeting' | 'document' | 'ai' | 'calendar' | 'member' | 'setting';
};

const navItems = [
  { id: 'main', label: '메인', icon: 'home' as const, path: '/main' },
  // { id: 'meeting', label: '회의', icon: 'clipboard-list' as const, path: '/meetings' },
  { id: 'document', label: '문서', icon: 'file-text' as const, path: '/documents' },
  { id: 'ai', label: 'AI 요약', icon: 'sparkles' as const, path: '/ai' },
  // { id: 'calendar', label: '캘린더', icon: 'calendar' as const, path: '/calendar' },
  { id: 'member', label: '팀원', icon: 'users' as const, path: '/main' },
  { id: 'setting', label: '설정', icon: 'settings' as const, path: '/profile' },
];

/**
 * grop/main.html 과 같은 앱 껍데기
 * - 사이드바: 메인/문서/AI/팀원/설정 (회의·캘린더 탭은 잠시 숨김)
 * - 상단바: 알림 + 프로필
 * - children: 각 페이지 본문
 */
export default function AppShell({ children, activePage = 'main' }: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [avatar, setAvatar] = useState(DEFAULT_AVATAR_KEY);
  // 상단바 프로필 아이콘을 누르면 페이지 이동 없이 이 모달을 띄웁니다.
  const [profileModalOpen, setProfileModalOpen] = useState(false);

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
      setAvatar(profile.avatar_url || profile.avatar || DEFAULT_AVATAR_KEY);
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
              onClick={() => navigate(item.path)}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="main">
        <div className="topbar">
          <NotificationBell />

          <button
            className="icon-btn profile-button"
            type="button"
            aria-label="내 프로필"
            onClick={() => setProfileModalOpen(true)}
          >
            <span className="profile-button-avatar">
              <img src={getAvatarSrc(avatar)} alt="" />
            </span>
          </button>
        </div>

        {children}
      </main>

      <ProfileEditModal
        open={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        onSaved={setAvatar}
      />
    </div>
  );
}
