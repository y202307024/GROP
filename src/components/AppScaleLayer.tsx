import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './AppScaleLayer.module.css';

/**
 * 모달/팝업을 body에 직접 그리되, AppShell(.app)과 똑같은 배율로 확대해서 그립니다.
 *
 * 왜 필요한가: AppShell의 .app이 transform: scale()을 가지기 때문에 그 안의 position: fixed 배경은 화면이 아니라
 * .app 기준이 되어 화면을 다 못 덮습니다. 그래서 모달들은 body로 빼서 그려 왔는데, 그러면 이번에 앱 전체를
 * 창 폭 ÷ 1440 만큼 확대하게 되면서 모달만 확대가 안 된 채(작게) 떠 버립니다.
 * 이 레이어는 body에 놓이면서도 .app과 같은 scale을 걸어서, 모달 CSS는 기존 1440 기준 px 그대로 쓰면 됩니다.
 * 레이어 안의 position: fixed; inset: 0 은 레이어(= 화면 전체) 기준이 됩니다.
 */
export function createScaledPortal(children: ReactNode) {
  return createPortal(<div className={styles.layer}>{children}</div>, document.body);
}
