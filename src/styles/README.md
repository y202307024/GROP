# 스타일 구조 안내

UI/UX 작업을 시작하기 전에 이 문서만 읽으면 됩니다.

## 파일 배치

```
src/styles/
  index.css              ← main.tsx 가 import 하는 유일한 전역 진입점
  tokens.css             ← 색·간격·글자크기 변수 (여기가 단일 진실 공급원)
  reset.css              ← 브라우저 기본값 정리
  base.css               ← 클래스 없는 기본 요소 스타일
  pageLayout.module.css  ← 사이드바 있는 화면의 공통 껍데기

src/pages/MainPage.tsx        ↔  src/pages/MainPage.module.css
src/components/AppSidebar.tsx ↔  src/components/AppSidebar.module.css
```

**규칙: 스타일은 그 스타일을 쓰는 파일 바로 옆에 둡니다.**

## 새 화면을 만들 때

```tsx
import layout from '../styles/pageLayout.module.css';
import s from './MyPage.module.css';

export default function MyPage() {
  return (
    <div className={layout.wrap}>
      <AppSidebar />
      <div className={layout.content}>
        <div className={layout.contentHeader}>
          <div>
            <div className={layout.pageTitle}>제목</div>
            <div className={layout.pageSub}>설명</div>
          </div>
        </div>

        <div className={s.myThing}>...</div>
      </div>
    </div>
  );
}
```

## 지켜야 할 것

**1. 색·간격·글자크기를 하드코딩하지 마세요.**

```css
/* ❌ */
.card { background: #fff; padding: 16px; font-size: 13px; }

/* ✅ */
.card {
  background: var(--color-surface);
  padding: var(--space-8);
  font-size: var(--text-base);
}
```

필요한 값이 `tokens.css` 에 없으면 **거기에 먼저 추가한 뒤** 사용합니다.
그래야 나중에 다크모드나 테마 변경이 한 파일 수정으로 끝납니다.

**2. 클래스 이름은 camelCase 로.**

CSS Modules 에서 `s.menu-item` 은 문법 오류라 `s['menu-item']` 을 써야 합니다.
처음부터 `.menuItem` 으로 쓰면 `s.menuItem` 으로 깔끔하게 접근됩니다.

**3. 여러 클래스를 붙일 때는 템플릿 리터럴.**

```tsx
<div className={`${s.actionIcon} ${s.actionIconGreen}`} />
<button className={`${s.menuItem} ${isActive ? s.menuItemActive : ''}`} />
```

**4. 오타는 조용히 실패합니다.**

`s.typoName` 처럼 없는 클래스를 쓰면 에러 없이 `class="undefined"` 가 됩니다.
스타일이 안 먹으면 개발자도구에서 `class="undefined"` 부터 확인하세요.

## 왜 전역 CSS 를 쓰지 않나

이전 구조에서 실제로 났던 문제입니다.

- `MainPage.css` 를 `TimelapsePage.tsx` 와 `AppSidebar.tsx` 가 같이 import
  → MainPage 스타일을 고치면 무관한 두 화면이 같이 깨짐
- `.timelapse-btn` 이 `TimelapsePage.css` 와 `TimelapseSavePanel.css` 에 중복 정의
  → 한쪽만 고치면 나머지가 어긋남
- `.canvas-main-row` 는 **세 파일**에 중복 정의

CSS Modules 는 빌드할 때 클래스 이름을 파일별로 고유하게 바꿔주기 때문에
(`sidebar` → `_sidebar_1a2b3`) 이런 충돌이 구조적으로 생기지 않습니다.

## 아직 남은 일

`style={{ ... }}` 인라인 스타일이 18개 파일에 약 300곳 남아 있습니다.
(`CanvasBoard.tsx` 52곳, `MeetingDetail.tsx` 45곳, `Room.tsx` 34곳 ...)

한 번에 옮기지 말고, **그 화면의 UI 를 손볼 때 해당 파일만** 모듈로 옮기세요.
그때도 위의 토큰 규칙을 그대로 적용하면 됩니다.
