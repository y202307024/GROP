import { useEffect, useState, type MouseEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { isSidebarItemActive, sidebarMenuItems } from '../config/sidebarMenu';
import s from './AppSidebar.module.css';

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
        .maybeSingle();
      if (!mounted || !profile) return;
      setNickname(profile.nickname ?? '');
      setAvatar(profile.avatar ?? '🐱');
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
    <div className={s.sidebar}>
      <div className={s.logo}>
        <div className={s.logoIcon}>G</div>
        <span className={s.logoText}>Groupop</span>
      </div>

      <div className={s.menu}>
        {sidebarMenuItems.map((item, i) => (
          <button
            key={`${item.label}-${i}`}
            type="button"
            className={`${s.menuItem} ${isSidebarItemActive(pathname, item) ? s.menuItemActive : ''}`}
            onClick={() => navigate(item.path)}
            disabled={item.comingSoon}
            title={item.comingSoon ? '아직 준비 중인 기능입니다' : undefined}
          >
            <span>{item.icon}</span>
            <span className={s.menuItemLabel}>{item.label}</span>
            {item.comingSoon && <span className={s.comingSoon}>준비중</span>}
          </button>
        ))}
      </div>

      <div className={s.profile} onClick={() => navigate('/profile')}>
        <div className={s.avatar}>
          <div className={s.avatarCircle}>{avatar}</div>
          <div className={s.onlineDot} />
        </div>
        <div className={s.profileInfo}>
          <div className={s.profileName}>{nickname || '...'}</div>
          <div className={s.profileStatus}>온라인</div>
        </div>
        <button type="button" className={s.logoutBtn} onClick={handleLogout} title="로그아웃">
          🚪
        </button>
      </div>
    </div>
  );
}
