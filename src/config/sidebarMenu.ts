export type SidebarMenuItem = {
  icon: string;
  label: string;
  path: string;
  /**
   * 아직 화면이 없는 메뉴입니다.
   * 클릭해도 아무 일이 없으면 고장으로 오해하므로,
   * 비활성 처리하고 '준비중' 배지를 붙입니다.
   */
  comingSoon?: boolean;
};

export const sidebarMenuItems: SidebarMenuItem[] = [
  // MainPage 가 곧 그룹 목록 화면이라 '홈'과 '내 그룹'을 하나로 합쳤습니다.
  { icon: '👥', label: '내 그룹', path: '/main' },
  { icon: '✏️', label: '캔버스', path: '/canvas' },
  { icon: '⏪', label: '타임랩스', path: '/timelapse' },

  // 아래 둘은 아직 해당 화면이 없습니다.
  // 회의록은 현재 그룹 단위(/group/:id/meetings)로만 존재합니다.
  { icon: '📹', label: '회의', path: '/main', comingSoon: true },
  { icon: '📄', label: '문서', path: '/main', comingSoon: true },
];

export function isSidebarItemActive(pathname: string, item: SidebarMenuItem) {
  if (item.comingSoon) return false;
  return pathname === item.path;
}
