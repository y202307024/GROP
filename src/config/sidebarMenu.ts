export type SidebarMenuItem = {
  icon: string;
  label: string;
  path: string;
};

export const sidebarMenuItems: SidebarMenuItem[] = [
  { icon: '🏠', label: '홈', path: '/main' },
  { icon: '👥', label: '내 그룹', path: '/main' },
  { icon: '📹', label: '회의', path: '/main' },
  { icon: '📄', label: '문서', path: '/main' },
  { icon: '✏️', label: '캔버스', path: '/canvas' },
  { icon: '⏪', label: '타임랩스', path: '/timelapse' },
];

export function isSidebarItemActive(pathname: string, item: SidebarMenuItem, index: number) {
  if (item.label === '타임랩스') return pathname === '/timelapse';
  if (item.label === '캔버스') return pathname === '/canvas';
  if (item.path === '/main') return pathname === '/main' && index === 0;
  return false;
}
