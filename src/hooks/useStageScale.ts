import { useLayoutEffect } from 'react';

// grop/css/common.css의 --stage-width/--stage-height와 반드시 같은 값이어야 합니다. (16:9)
const STAGE_WIDTH = 1440;
const STAGE_HEIGHT = 810;

/**
 * 화면(.stage, 1440x810 고정 캔버스)을 실제 창 크기에 정확히 맞춰 늘립니다.
 *
 * 배경: 기존에는 .stage가 `min-width: 1440px`만 강제해서, 창이 그보다 좁은 노트북에서는
 * 가로 스크롤이 생기고 사이드바 메뉴가 화면 밖으로 밀려났습니다(세로는 실제 창 높이를
 * 그대로 따라서 노트북마다 잘리는 정도가 달랐습니다).
 *
 * 배율 계산: 가로/세로 배율(scaleX/scaleY)을 각각 따로 구해서 `transform: scale(scaleX, scaleY)`로
 * 적용합니다(스트레치). 그래서 창 비율이 16:9와 달라도 스크롤이 생기거나 요소가 화면
 * 밖으로 잘리는 일 없이 항상 창에 정확히 꽉 채워집니다 — 다만 가로/세로 배율이 서로
 * 달라지는 만큼 UI가 아주 살짝 눌리거나 늘어나 보일 수 있습니다(16:9에서 크게 벗어나지
 * 않는 한 거의 눈에 띄지 않는 수준입니다).
 *
 * (참고: 가로/세로 중 더 넉넉한 쪽 하나에만 맞추는 Math.max 방식도 써봤지만, 실제
 * 브라우저 창은 전체화면이어도 타이틀바 등 때문에 순수 16:9가 아닌 경우가 많아 그 오차만큼
 * 항상 가장자리가 잘려 보이는 문제가 있어서, 절대 안 잘리는 이 스트레치 방식으로 바꿨습니다.)
 *
 * App() 최상단에서 한 번만 호출하면 됩니다 — 모든 페이지가 .stage 클래스를 공유하기 때문에
 * 페이지마다 따로 붙일 필요는 없습니다.
 */
export function useStageScale() {
  useLayoutEffect(() => {
    const applyScale = () => {
      const scaleX = window.innerWidth / STAGE_WIDTH;
      const scaleY = window.innerHeight / STAGE_HEIGHT;
      document.documentElement.style.setProperty('--stage-scale-x', String(scaleX));
      document.documentElement.style.setProperty('--stage-scale-y', String(scaleY));
    };

    applyScale();
    window.addEventListener('resize', applyScale);
    return () => window.removeEventListener('resize', applyScale);
  }, []);
}
