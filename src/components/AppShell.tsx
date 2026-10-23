import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import NotificationBell from './NotificationBell';
import ProfileEditModal from './ProfileEditModal';
import { DEFAULT_AVATAR_KEY, getAvatarSrc } from '../utils/avatarOptions';
import { useAppShellScale } from '../hooks/useAppShellScale';
import styles from './AppShell.module.css';
import sidebarHome from '../assets/sidebar/sidebar-home.svg';
import sidebarDocument from '../assets/sidebar/sidebar-document.svg';
import sidebarAi from '../assets/sidebar/sidebar-ai.svg';
import sidebarCalendar from '../assets/sidebar/sidebar-calendar.svg';
import sidebarGroup from '../assets/sidebar/sidebar-group.svg';
import sidebarSettings from '../assets/sidebar/sidebar-settings.svg';

// 페이지마다 AppShell이 새로 mount되는데, 매번 기본 아바타(고양이)로 시작한 뒤
// 조회가 끝나야 실제 아바타로 바뀌면 탭 전환할 때마다 고양이가 깜빡여 보입니다.
// 모듈 스코프에 마지막으로 불러온 아바타를 캐싱해 다음 mount는 여기서 바로 시작합니다.
let cachedAvatar: string | null = null;

type Props = {
  children: ReactNode;
  /**
   * 사이드바에서 현재 페이지로 표시할 메뉴 id.
   * 회의록 목록 페이지(MeetingList)를 삭제해서 'meeting' 값은 타입에서 뺐습니다.
   * 'calendar'는 한 번 메뉴/페이지 파일까지 지웠다가 다시 살리기로 해서 복원했습니다.
   */
  activePage?: 'main' | 'document' | 'ai' | 'calendar' | 'member' | 'setting';
};

// 피그마 원본 사이드바 순서(메인/회의/문서/AI 요약/캘린더/그룹/설정) 기준으로
// 캘린더를 "AI 요약"과 "그룹" 사이에 다시 넣었습니다.
// 모든 탭이 시안 SVG를 마스크로 그려 글자색(currentColor)을 따라갑니다.
// 회의 탭은 앱에 없는 메뉴라 뺐습니다.
const navItems: { id: string; label: string; iconSrc: string; path: string }[] = [
  { id: 'main', label: '메인', iconSrc: sidebarHome, path: '/main' },
  { id: 'document', label: '문서', iconSrc: sidebarDocument, path: '/documents' },
  { id: 'ai', label: 'AI 요약', iconSrc: sidebarAi, path: '/ai' },
  { id: 'calendar', label: '캘린더', iconSrc: sidebarCalendar, path: '/calendar' },
  { id: 'member', label: '그룹', iconSrc: sidebarGroup, path: '/groups' },
  { id: 'setting', label: '설정', iconSrc: sidebarSettings, path: '/profile' },
];

/**
 * grop/main.html 과 같은 앱 껍데기
 * - 사이드바: 메인/문서/AI/캘린더/그룹/설정 (회의는 메뉴에서만 제거, 페이지·라우트는 유지)
 * - 상단바: 알림 + 프로필
 * - children: 각 페이지 본문
 */
export default function AppShell({ children, activePage = 'main' }: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // 뷰포트가 1440px보다 좁은 모니터/배율에서 사이드바·상단바가 잘리지 않도록
  // .app을 통째로 축소합니다 (자세한 배경은 useAppShellScale.ts 참고).
  useAppShellScale();
  const [avatar, setAvatar] = useState(cachedAvatar ?? DEFAULT_AVATAR_KEY);
  // 상단바 프로필 아이콘을 누르면 페이지 이동 없이 이 모달을 띄웁니다.
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  // 프로필 행이 없다 = 가입 직후 최초 진입. 팝업을 강제로 띄웁니다.
  const [needsProfileSetup, setNeedsProfileSetup] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(async ({ data }) => {
      if (!mounted || !data.user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('nickname, avatar, avatar_url')
        .eq('id', data.user.id)
        .maybeSingle();
      if (!mounted) return;
      if (!profile) {
        setNeedsProfileSetup(true);
        setProfileModalOpen(true);
        return;
      }
      const next = profile.avatar_url || profile.avatar || DEFAULT_AVATAR_KEY;
      cachedAvatar = next;
      setAvatar(next);
    });
    return () => {
      mounted = false;
    };
  }, [pathname]);

  const current =
    activePage ||
    (pathname.startsWith('/profile') ? 'setting' : pathname.startsWith('/documents') ? 'document' : pathname.startsWith('/group') ? 'main' : 'main');

  return (
    // 고정 1440x810 캔버스(.stage + transform: scale) 대신 stageFluid.css의
    // .stageFluid(실제 뷰포트 크기 + 스크롤/클리핑)를 씁니다 — ResponsiveTestPage에서
    // 먼저 검증해본 방식입니다. 바깥(stageFluid)과 안(styles.app)을 나눈 이유는
    // ResponsiveTestPage.tsx와 같습니다: 안쪽이 최소 크기보다 못 줄어들 때 그만큼
    // 커지는 역할과, 그걸 스크롤/클리핑하는 역할을 같은 요소가 동시에 하면 꼬입니다.
    <div className="stageFluid">
      <div className={styles.app}>
        <aside className={styles.sidebar}>
          <div className={styles.logo}>GROP</div>
          <nav className={styles.nav}>
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`${styles.navItem}${current === item.id ? ` ${styles.active}` : ''}`}
                onClick={() => navigate(item.path)}
              >
                <span
                  className={styles.navMaskIcon}
                  style={{ '--icon-url': `url(${JSON.stringify(item.iconSrc)})` } as CSSProperties}
                  aria-hidden="true"
                />
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        <main className={styles.main}>
          <div className={styles.topbar}>
            <NotificationBell />

            <button
              className={`${styles.iconBtn} ${styles.profileButton}`}
              type="button"
              aria-label="내 프로필"
              onClick={() => setProfileModalOpen(true)}
            >
              <span className={styles.profileButtonAvatar}>
                <img src={getAvatarSrc(avatar)} alt="" />
              </span>
            </button>
          </div>

          {children}
        </main>

        <ProfileEditModal
          open={profileModalOpen}
          required={needsProfileSetup}
          onClose={() => {
            setProfileModalOpen(false);
            setNeedsProfileSetup(false);
          }}
          onSaved={(next) => {
            cachedAvatar = next;
            setAvatar(next);
          }}
        />
      </div>
    </div>
  );
}
