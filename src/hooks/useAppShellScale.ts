import { useLayoutEffect } from 'react';

// 앱 레이아웃의 기준 폭(px). 피그마 시안은 2048 캔버스인데, 이 프로젝트의 페이지 CSS는 전부
// 그걸 ×0.703 해서 1440 기준으로 적혀 있습니다. 창이 1440px 이상일 때는 이 1440 레이아웃을 창 폭에 맞춰
// 통째로 확대해서, 어떤 모니터·디스플레이 배율에서도 "2048 시안을 그 크기로 본 것"과 같은 비율로 보이게 합니다.
const BASE_APP_WIDTH = 1440;

// 사이드바 폭(px) — AppShell.module.css의 .sidebar width와 같아야 합니다. 창 크기와 상관없이 항상 이 폭입니다.
const SIDEBAR_WIDTH = 192;

// 중앙(.main) 영역의 최소 폭(px) — AppShell.module.css의 .main min-width와 같아야 합니다.
// 이보다 좁아지면 중앙 영역은 더 줄지 않고 가로 스크롤이 생깁니다(요소가 아래로 밀려 내려가는 것을 막기 위함).
const MAIN_MIN_WIDTH = 760;

/** 사이드바 + 중앙 최소 폭 = AppShell 화면의 기본 최소 폭(952px) */
const DEFAULT_MIN_APP_WIDTH = SIDEBAR_WIDTH + MAIN_MIN_WIDTH;

/** 가로 스크롤바 두께(px) — 처음 한 번만 재서 저장합니다 (오버레이 스크롤바면 0) */
let cachedScrollbarSize: number | null = null;
function getScrollbarSize() {
  if (cachedScrollbarSize !== null) return cachedScrollbarSize;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll;';
  document.body.appendChild(probe);
  cachedScrollbarSize = probe.offsetHeight - probe.clientHeight;
  document.body.removeChild(probe);
  return cachedScrollbarSize;
}

/**
 * AppShell(사이드바+본문 껍데기)의 가로 규칙 — 창 폭에 따라 세 구간으로 동작합니다.
 *
 *  1) 1440px 이상  : 1440 레이아웃을 창 폭 ÷ 1440 만큼 통째로 확대(가로/세로 같은 배율이라 눌려 보이지 않음).
 *  2) 952~1440px   : 확대/축소 없이(배율 1) 레이아웃 폭이 창 폭을 그대로 따릅니다. 사이드바(192px)와 글자 크기는 그대로고
 *                    중앙 영역만 줄어듭니다. (예전엔 이 구간에서도 전체를 줄여서 사이드바·글자까지 작아졌습니다)
 *  3) 952px 미만   : 사이드바 + 중앙 최소 폭(760px)에서 멈추고 가로 스크롤이 생깁니다.
 *
 * 세로는 어느 구간에서도 배율로 바꾸지 않습니다. 확대 구간에서만 "창 높이 ÷ 배율"이 레이아웃 높이가 됩니다.
 * CSS의 vh/100dvh는 확대 전 창 크기를 가리켜서 페이지 높이 계산이 어긋나므로, 레이아웃 크기를 변수로 내려 줍니다:
 *   --app-shell-scale : 확대 배율 (1440 미만이면 1)
 *   --app-w  : .app 폭 (확대 구간 1440px / 중간 구간 100% / 최소 폭 미만 952px)
 *   --app-h  : 레이아웃 높이(px)   → 100dvh 대신 사용 (가로 스크롤바가 생기면 그 두께만큼 뺍니다)
 *   --app-vh : 레이아웃 높이의 1%  → 1vh 대신 사용 (예: calc(29 * var(--app-vh)))
 *   --app-vw : 레이아웃 폭의 1%    → 1vw 대신 사용 (확대 구간에선 1440의 1%)
 * 마우스 좌표(clientX/clientY)는 확대 전 화면 기준이라, 레이아웃 안에 놓을 때는 getAppShellScale()로 나눠야 합니다.
 */
export function useAppShellScale(options: { minWidth?: number } = {}) {
  // 사이드바가 없는 화면(로그인/회원가입 등)은 더 좁게 쓸 수 있도록 최소 폭을 직접 정할 수 있습니다
  const MIN_APP_WIDTH = options.minWidth ?? DEFAULT_MIN_APP_WIDTH;
  useLayoutEffect(() => {
    const applyScale = () => {
      const width = window.innerWidth;
      const scale = width >= BASE_APP_WIDTH ? width / BASE_APP_WIDTH : 1;
      const layoutWidth = width >= BASE_APP_WIDTH ? BASE_APP_WIDTH : Math.max(width, MIN_APP_WIDTH);
      const hasHScroll = width < MIN_APP_WIDTH;
      const availableHeight = window.innerHeight - (hasHScroll ? getScrollbarSize() : 0);
      const layoutHeight = availableHeight / scale;

      const root = document.documentElement.style;
      root.setProperty('--app-shell-scale', String(scale));
      root.setProperty('--app-min-w', `${MIN_APP_WIDTH}px`);
      // 중간 구간은 100%로 두어야 세로 스크롤바가 생겨도 가로 스크롤이 따라 생기지 않습니다
      root.setProperty('--app-w', scale > 1 ? `${BASE_APP_WIDTH}px` : hasHScroll ? `${MIN_APP_WIDTH}px` : '100%');
      root.setProperty('--app-h', `${layoutHeight}px`);
      root.setProperty('--app-vh', `${layoutHeight / 100}px`);
      root.setProperty('--app-vw', `${layoutWidth / 100}px`);
    };

    applyScale();
    window.addEventListener('resize', applyScale);
    return () => {
      window.removeEventListener('resize', applyScale);
      // AppShell 밖 화면(로그인 등)에서 오래된 값이 남지 않게 지웁니다(변수 없으면 배율 1로 동작)
      const root = document.documentElement.style;
      ['--app-shell-scale', '--app-min-w', '--app-w', '--app-h', '--app-vh', '--app-vw'].forEach((k) => root.removeProperty(k));
    };
  }, [MIN_APP_WIDTH]);
}

/** 현재 앱 확대 배율(창 폭 ÷ 1440, 1440 미만이면 1). AppShell 밖이면 1 */
export function getAppShellScale() {
  const v = parseFloat(document.documentElement.style.getPropertyValue('--app-shell-scale'));
  return Number.isFinite(v) && v > 0 ? v : 1;
}
