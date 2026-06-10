import { useEffect, useState, type MouseEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { isSidebarItemActive, sidebarMenuItems } from '../config/sidebarMenu';
import '../pages/MainPage.css';

type Props = {
  onLogout?: () => void;
};

export default function AppSidebar({ onLogout }: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [nickname, setNickname] = useState('');
  const [avatar, setAvatar] = useState('🐱');

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!mounted || !data.user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('nickname, avatar')
        .eq('id', data.user.id)
        .single();
      if (profile) {
        setNickname(profile.nickname ?? '');
        setAvatar(profile.avatar ?? '🐱');
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const handleLogout = async (e: MouseEvent) => {
    e.stopPropagation();
    await supabase.auth.signOut();
    onLogout?.();
    navigate('/');
  };

  return (
    <div className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">G</div>
        <span className="sidebar-logo-text">Groupop</span>
      </div>
      <div className="sidebar-menu">
        {sidebarMenuItems.map((item, i) => (
          <button
            key={`${item.label}-${i}`}
            type="button"
            className={`menu-item ${isSidebarItemActive(pathname, item, i) ? 'active' : ''}`}
            onClick={() => navigate(item.path)}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
      <div className="sidebar-profile" onClick={() => navigate('/profile')} style={{ cursor: 'pointer' }}>
        <div className="profile-avatar">
          <div className="avatar-circle">{avatar}</div>
          <div className="online-dot" />
        </div>
        <div className="profile-info">
          <div className="profile-name">{nickname || '...'}</div>
          <div className="profile-status">온라인</div>
        </div>
        <button type="button" className="logout-btn" onClick={handleLogout} title="로그아웃">
          🚪
        </button>
      </div>
    </div>
  );
}
