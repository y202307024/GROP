import { useLayoutEffect } from 'react';

// 앱 레이아웃의 기준 폭(px). 피그마 시안은 2048 캔버스인데, 이 프로젝트의 페이지 CSS는 전부
// 그걸 ×0.703 해서 1440 기준으로 적혀 있습니다. 그래서 1440 레이아웃을 창 폭에 맞춰 통째로 확대/축소하면
// 어떤 모니터·디스플레이 배율에서도 "2048 시안을 그 크기로 본 것"과 같은 비율이 됩니다.
// (사이드바 192px + .main 1248px = 1440, AppShell.module.css와 맞춰야 합니다)
const BASE_APP_WIDTH = 1440;

/**
 * AppShell(사이드바+본문 껍데기)을 창 폭에 맞춰 통째로 확대/축소합니다.
 * 가로/세로를 같은 배율로 키우기 때문에 UI가 눌리거나 늘어나 보이지 않습니다.
 *
 * 예전엔 1440보다 좁을 때만 줄였고(넓으면 scale 1로 두고 내용이 늘어남), 그래서 200% 배율(CSS 폭 1440)에서
 * 맞춰 둔 화면이 100% 배율(2048 폭)에서는 요소가 작고 여백이 많아 보였습니다.
 *
 * 확대하면 레이아웃이 차지하는 실제 크기는 "창 크기 ÷ 배율"이 되는데, CSS의 vh/100dvh는 확대 전 창 크기를
 * 그대로 가리켜서 페이지 높이 계산이 어긋납니다. 그래서 확대 후 레이아웃 높이를 변수로 내려 줍니다:
 *   --app-h  : 레이아웃 높이(px)   → 100dvh 대신 사용
 *   --app-vh : 레이아웃 높이의 1%  → 1vh 대신 사용 (예: calc(29 * var(--app-vh)))
 *   --app-vw : 레이아웃 폭(1440)의 1% → 1vw 대신 사용
 * 마우스 좌표(clientX/clientY)는 확대 전 화면 기준이라, 레이아웃 안에 놓을 때는 getAppShellScale()로 나눠야 합니다.
 */
export function useAppShellScale() {
  useLayoutEffect(() => {
    const applyScale = () => {
      const scale = window.innerWidth / BASE_APP_WIDTH;
      const layoutHeight = window.innerHeight / scale;
      const root = document.documentElement.style;
      root.setProperty('--app-shell-scale', String(scale));
      root.setProperty('--app-h', `${layoutHeight}px`);
      root.setProperty('--app-vh', `${layoutHeight / 100}px`);
      root.setProperty('--app-vw', `${BASE_APP_WIDTH / 100}px`);
    };

    applyScale();
    window.addEventListener('resize', applyScale);
    return () => {
      window.removeEventListener('resize', applyScale);
      // AppShell 밖 화면(로그인 등)에서 오래된 값이 남지 않게 지웁니다(변수 없으면 배율 1로 동작)
      const root = document.documentElement.style;
      ['--app-shell-scale', '--app-h', '--app-vh', '--app-vw'].forEach((k) => root.removeProperty(k));
    };
  }, []);
}

/** 현재 앱 확대 배율(창 폭 ÷ 1440). AppShell 밖이면 1 */
export function getAppShellScale() {
  const v = parseFloat(document.documentElement.style.getPropertyValue('--app-shell-scale'));
  return Number.isFinite(v) && v > 0 ? v : 1;
}
