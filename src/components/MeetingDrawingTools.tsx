import { useEffect, useRef, useState, type CSSProperties } from 'react';
import styles from './MeetingDrawingTools.module.css';
import type { ExcalidrawTool } from './ExcalidrawToolbar';
import { chatFileUrl, displayFileName, type MeetingChatFile } from '../utils/meetingChat';
// 시안 SVG 아이콘 모음 (파일별 원래 크기 포함)
import * as ICON from './toolIcons';

/** 하단 메인 도구. shapes는 서브메뉴에서 실제 Excalidraw 도구로 분기합니다. */
export type MeetingDrawAction = ExcalidrawTool | 'stamp' | 'shapes' | 'pan';

type PrimaryTool = {
  id: MeetingDrawAction;
  tooltip: string;
  icon: ICON.ToolIcon;
};

const PRIMARY_TOOLS: PrimaryTool[] = [
  { id: 'hand', tooltip: '선택', icon: ICON.pointer },
  { id: 'pan', tooltip: '이동', icon: ICON.hand },
  { id: 'pen', tooltip: '펜', icon: ICON.pen },
  { id: 'text', tooltip: '텍스트', icon: ICON.text },
  { id: 'shapes', tooltip: '도형', icon: ICON.shape },
  { id: 'stamp', tooltip: '메모장', icon: ICON.sticker },
  { id: 'image', tooltip: '이미지', icon: ICON.image },
  { id: 'file', tooltip: '파일', icon: ICON.file },
];

/** 펜 색 팔레트 — 시안 순서: 검정·빨강·노랑·초록·파랑·보라·흰색 */
const PEN_COLORS = ['#000000', '#ff0000', '#ffe100', '#59ff00', '#0077ff', '#7300ff', '#ffffff'] as const;

/** 펜·텍스트·도형에서 쓰는 공통 색 팔레트 */
export const DRAW_COLORS = PEN_COLORS;

export type PenTipId = 'pencil' | 'marker' | 'brush';

/** 시안: 연필 · 마커 · 붓 — 마커는 형광펜처럼 반투명·넓은 획 */
export const PEN_TIPS = [
  { id: 'pencil' as const, label: '연필', size: 3, opacity: 1 },
  { id: 'marker' as const, label: '마커', size: 18, opacity: 0.4 },
  { id: 'brush' as const, label: '붓', size: 14, opacity: 1 },
];
const PEN_TIP_ICONS: Record<PenTipId, ICON.ToolIcon> = {
  pencil: ICON.penPencil,
  marker: ICON.penMarker,
  brush: ICON.penBrush,
};
/** 마커(형광펜) 기본 강조색 — 검정에서 바꿀 때 씁니다 (팔레트의 노랑) */
const MARKER_DEFAULT_COLOR = '#ffe100';
/** 메모장 배경색 팔레트 — 시안 순서 */
const STICKY_COLORS = ['#737373', '#ffffff', '#ff8080', '#fff080', '#adff80', '#80bcff', '#da80ff'] as const;

/**
 * 도형 종류 — 시안 순서. 아이콘 이름과 보드 도구 이름이 달라서 짝을 여기서 정합니다.
 * (꺾은선 화살표 = zigzag, 곡선 화살표 = S자 곡선 화살표 아이콘)
 */
const SHAPE_ITEMS: { id: ExcalidrawTool; label: string; icon: ICON.ToolIcon }[] = [
  { id: 'elbowArrow', label: '꺾은선 화살표', icon: ICON.shapeZigzagArrow },
  { id: 'curveArrow', label: '곡선 화살표', icon: ICON.shapeCurveArrow },
  { id: 'arrow', label: '화살표', icon: ICON.shapeArrow },
  { id: 'line', label: '직선', icon: ICON.shapeLine },
  { id: 'rectangle', label: '사각형', icon: ICON.shapeSquare },
  { id: 'ellipse', label: '원', icon: ICON.shapeCircle },
  { id: 'triangle', label: '삼각형', icon: ICON.shapeTriangle },
  { id: 'pentagon', label: '오각형', icon: ICON.shapePentagon },
  { id: 'octagon', label: '팔각형', icon: ICON.shapeOctagon },
];

export type ShapeStyleOptions = {
  dash: 'solid' | 'dashed';
  strokeOpacity: number;
  fillEnabled: boolean;
  fillColor: string;
  fillOpacity: number;
};

export type PenStyleOptions = {
  opacity: number;
  dash: 'solid' | 'dashed';
};

type StrokeStylePatch = {
  color?: string;
  size?: number;
  opacity?: number;
  dash?: 'solid' | 'dashed';
};

type Props = {
  active: MeetingDrawAction;
  onPick: (tool: MeetingDrawAction) => void;
  activeShape?: ExcalidrawTool;
  onPickShape?: (tool: ExcalidrawTool) => void;
  strokeColor: string;
  strokeSize: number;
  onStrokeStyle: (style: StrokeStylePatch) => void;
  /** 지우개 모드일 때 아이콘 강조 */
  isEraser?: boolean;
  /** 연필/마커/붓 — 부모에서 유지해 굵기 변경 시 초기화되지 않게 합니다 */
  penTip?: PenTipId;
  onPenTipChange?: (tip: PenTipId) => void;
  /** 펜 불투명도·실선/점선 (보드 연동용) */
  penStyle?: PenStyleOptions;
  /** 도형 테두리·채우기 옵션 */
  shapeStyle?: ShapeStyleOptions;
  onShapeStyle?: (style: Partial<ShapeStyleOptions>) => void;
  onPickEraser?: () => void;
  /** 전체 지우기 */
  onClearAll?: () => void;
  /** 영역 지우기(네모 드래그) 모드 */
  onAreaErase?: () => void;
  /** 영역 지우기 모드 강조 */
  isAreaErase?: boolean;
  /** EyeDropper 미지원 시 캔버스에서 색 찍기 */
  onStartEyedropper?: () => void;
  stickyColor: string;
  onStickyColor: (color: string) => void;
  attachments?: MeetingChatFile[];
  /** 피그마 비율(×0.703)에 맞춘 작은 툴바로 그립니다 (회의방 전용 — 기본값은 기존 크기) */
  compact?: boolean;
  /** true면 오른쪽 '도구 옵션'을 그리지 않습니다 (기본 false) */
  hideOptions?: boolean;
  /** 파일 도구에서 새 첨부를 고를 때 */
  onUploadFile?: (file: File) => void;
  uploadingAttachment?: boolean;
  /** 텍스트 서식 메뉴를 띄울지 — 텍스트 도구이거나, 배치된 글을 고른 상태 */
  textSelected?: boolean;
  textFontSize?: number;
  onTextFontSize?: (size: number) => void;
  /** 텍스트 가로 정렬 */
  textAlign?: 'left' | 'center' | 'right';
  onTextAlign?: (align: 'left' | 'center' | 'right') => void;
  /** 텍스트 굵게·취소선·밑줄 */
  textBold?: boolean;
  textStrike?: boolean;
  textUnderline?: boolean;
  onTextDecor?: (style: Partial<{ bold: boolean; strike: boolean; underline: boolean }>) => void;
};

/**
 * SVG 파일을 currentColor로 칠해서 그립니다 (CSS mask).
 * <img>는 색을 못 바꿔서 선택 시 초록으로 바뀌는 시안을 표현할 수 없고,
 * svgr 같은 새 라이브러리는 쓰지 않기로 해서 mask 방식을 씁니다.
 * 크기 = SVG 원래 크기 × --s (회의방 0.703, 기본 1) — CSS에서 계산합니다.
 */
function MaskIcon({ icon, className }: { icon: ICON.ToolIcon; className?: string }) {
  // JSON.stringify: 인라인(data:) SVG 안의 따옴표를 이스케이프해서 url()이 깨지지 않게 합니다.
  const vars = { '--icon-url': `url(${JSON.stringify(icon.src)})`, '--icon-w': icon.w, '--icon-h': icon.h } as CSSProperties;
  return <span className={`${styles.maskIcon}${className ? ` ${className}` : ''}`} style={vars} aria-hidden="true" />;
}

/** 정렬 드롭다운에서 가운데·오른쪽 정렬 아이콘 (시안 SVG는 왼쪽 정렬만 있어 나머지는 기존 선 아이콘 유지) */
function AlignLineIcon({ kind }: { kind: 'center' | 'right' }) {
  return (
    <svg
      className={styles.inlineAlignIcon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      {kind === 'center' ? <path d="M5 7h14M7 12h10M5 17h14" /> : <path d="M5 7h14M9 12h10M12 17h7" />}
    </svg>
  );
}

/**
 * 회의/캔버스 하단 그리기 도구.
 * 메인·서브메뉴 아이콘은 시안(얇은 라인) 기준으로 맞춥니다.
 */
export default function MeetingDrawingTools({
  active,
  onPick,
  activeShape = 'rectangle',
  onPickShape,
  strokeColor,
  strokeSize,
  onStrokeStyle,
  isEraser = false,
  penTip = 'pencil',
  onPenTipChange,
  onPickEraser,
  stickyColor,
  onStickyColor,
  attachments = [],
  compact = false,
  hideOptions = false,
  onUploadFile,
  uploadingAttachment = false,
  textSelected = false,
  textFontSize = 20,
  onTextFontSize,
  textAlign = 'left',
  onTextAlign,
  textBold = false,
  textStrike = false,
  textUnderline = false,
  onTextDecor,
}: Props) {
  const showTextSub = active === 'text' || textSelected;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // 텍스트 px 입력칸 — 타이핑 중에는 문자열로 두고, 확정 시 숫자로 반영합니다.
  const [textSizeDraft, setTextSizeDraft] = useState(String(textFontSize));
  // 글자 크기 드롭다운 → 위로 px 입력칸 펼침
  const [textFontSizeMenuOpen, setTextFontSizeMenuOpen] = useState(false);
  // 정렬 드롭다운 → 위로 좌·중·우 정렬 펼침
  const [textAlignMenuOpen, setTextAlignMenuOpen] = useState(false);
  // 드롭다운 바깥 클릭 시 닫기
  const textFontSizeMenuRef = useRef<HTMLDivElement | null>(null);
  const textAlignMenuRef = useRef<HTMLDivElement | null>(null);

  /** 연필/마커/붓 선택을 바꿉니다. (굵기 슬라이더와는 분리) */
  const selectPenTip = (tip: PenTipId) => {
    onPenTipChange?.(tip);
  };

  useEffect(() => {
    setTextSizeDraft(String(textFontSize));
  }, [textFontSize]);

  // 도구를 바꾸면 글자 크기·정렬 드롭다운은 접습니다.
  useEffect(() => {
    setTextFontSizeMenuOpen(false);
    setTextAlignMenuOpen(false);
  }, [active, textSelected]);

  // 드롭다운이 열려 있는 동안만 바깥 클릭을 감시합니다. (값은 input blur에서 이미 확정)
  useEffect(() => {
    if (!textFontSizeMenuOpen && !textAlignMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (textFontSizeMenuRef.current && !textFontSizeMenuRef.current.contains(target)) {
        setTextFontSizeMenuOpen(false);
      }
      if (textAlignMenuRef.current && !textAlignMenuRef.current.contains(target)) {
        setTextAlignMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [textFontSizeMenuOpen, textAlignMenuOpen]);

  const commitTextSizeDraft = () => {
    const n = Number(textSizeDraft);
    if (!Number.isFinite(n)) {
      setTextSizeDraft(String(textFontSize));
      return;
    }
    const clamped = Math.min(144, Math.max(12, Math.round(n)));
    setTextSizeDraft(String(clamped));
    if (clamped !== textFontSize) onTextFontSize?.(clamped);
  };

  /** 같은 색인지 (대소문자 무시) */
  const sameColor = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  /** 펜 기본색이 예전 #111111로 시작하는 곳이 있어서, 검정 칩은 두 값 모두 선택된 것으로 봅니다. */
  const isPenColorActive = (c: string) =>
    sameColor(strokeColor, c) || (c === '#000000' && sameColor(strokeColor, '#111111'));

  return (
    <div className={`${styles.drawingTools}${compact ? ` ${styles.drawingToolsCompact}` : ''}`}>
      <div className={styles.drawingToolsPrimary} role="toolbar" aria-label="그리기 도구">
        {PRIMARY_TOOLS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`${styles.toolButton}${active === item.id ? ` ${styles.active}` : ''}`}
            data-tooltip={item.tooltip}
            aria-label={item.tooltip}
            aria-pressed={active === item.id}
            onClick={() => onPick(item.id)}
          >
            <MaskIcon icon={item.icon} />
          </button>
        ))}
      </div>

      {/* 도구별 옵션 (시안 기준). hideOptions면 통째로 그리지 않습니다. */}
      {!hideOptions ? (
        <div className={styles.drawingToolsSubmenu} role="group" aria-label="도구 옵션">
          {/* ===== 펜: 연필·마커·붓·지우개 / 굵기 슬라이더 / 색 ===== */}
          {active === 'pen' && !textSelected ? (
            <>
              <div className={styles.optGroup} role="group" aria-label="펜 종류">
                {PEN_TIPS.map((tip) => (
                  <button
                    key={tip.id}
                    type="button"
                    className={`${styles.optBtn}${!isEraser && penTip === tip.id ? ` ${styles.active}` : ''}`}
                    title={tip.id === 'marker' ? '마커 (형광펜)' : tip.label}
                    aria-label={tip.label}
                    onClick={() => {
                      selectPenTip(tip.id);
                      onPick('pen');
                      // 마커: 반투명 넓은 획으로 텍스트 위를 강조. 연필/붓은 불투명으로 복구.
                      const patch: { color?: string; size: number; opacity: number } = {
                        size: tip.size,
                        opacity: tip.opacity,
                      };
                      if (tip.id === 'marker') {
                        const c = strokeColor.toLowerCase();
                        // 검정이면 형광 노랑으로 바꿔 바로 강조에 쓸 수 있게 합니다.
                        if (c === '#111111' || c === '#000000' || c === '#111827') {
                          patch.color = MARKER_DEFAULT_COLOR;
                        }
                      }
                      onStrokeStyle(patch);
                    }}
                  >
                    <MaskIcon icon={PEN_TIP_ICONS[tip.id]} />
                  </button>
                ))}
                <button
                  type="button"
                  className={`${styles.optBtn}${isEraser ? ` ${styles.active}` : ''}`}
                  title="지우개"
                  aria-label="지우개"
                  onClick={() => onPickEraser?.()}
                >
                  <MaskIcon icon={ICON.penEraser} />
                </button>
              </div>

              {/* 굵기 슬라이더 — 지우개 모드에서는 지우개 굵기로 씁니다 */}
              <label className={styles.optSlider} title={isEraser ? '지우개 굵기' : '선 굵기'}>
                <span className={styles.visuallyHidden}>{isEraser ? '지우개 굵기' : '선 굵기'}</span>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={strokeSize}
                  onChange={(e) => {
                    const nextSize = Number(e.target.value);
                    if (isEraser) {
                      onStrokeStyle({ size: nextSize, opacity: 1 });
                      return;
                    }
                    // 굵기만 바꿉니다. 연필/마커/붓 선택은 유지하고, 팁별 투명도도 같이 유지합니다.
                    const tip = PEN_TIPS.find((t) => t.id === penTip) ?? PEN_TIPS[0];
                    onStrokeStyle({ size: nextSize, opacity: tip.opacity });
                  }}
                />
              </label>

              <div className={styles.optSwatches} role="group" aria-label="색상">
                {PEN_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`${styles.swatch}${isPenColorActive(c) ? ` ${styles.active}` : ''}`}
                    style={{ background: c }}
                    title={c}
                    aria-label={`색 ${c}`}
                    onClick={() => onStrokeStyle({ color: c })}
                  />
                ))}
              </div>
            </>
          ) : null}

          {/* ===== 텍스트: 크기▾ | 글꼴▾ | B S U 목록 | 정렬▾ ===== */}
          {showTextSub ? (
            <>
              {/* 글자 크기 — 누르면 위로 px 입력창 */}
              <div className={styles.optPopWrap} ref={textFontSizeMenuRef}>
                <button
                  type="button"
                  className={`${styles.optBtn} ${styles.optBtnDropdown}${textFontSizeMenuOpen ? ` ${styles.active}` : ''}`}
                  title="글자 크기"
                  aria-label="글자 크기"
                  aria-expanded={textFontSizeMenuOpen}
                  onClick={() => {
                    setTextAlignMenuOpen(false);
                    setTextFontSizeMenuOpen((v) => !v);
                  }}
                >
                  <MaskIcon icon={ICON.textSize} />
                  <MaskIcon icon={ICON.chevronDown} className={styles.chevronUp} />
                </button>
                {textFontSizeMenuOpen ? (
                  <label className={styles.optPopover}>
                    <span className={styles.visuallyHidden}>글자 크기(px)</span>
                    <input
                      className={styles.optPxInput}
                      type="number"
                      min={12}
                      max={144}
                      step={1}
                      value={textSizeDraft}
                      autoFocus
                      onChange={(e) => setTextSizeDraft(e.target.value)}
                      onBlur={() => commitTextSizeDraft()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitTextSizeDraft();
                          setTextFontSizeMenuOpen(false);
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          setTextSizeDraft(String(textFontSize));
                          setTextFontSizeMenuOpen(false);
                        }
                      }}
                      aria-label="글자 크기 픽셀"
                    />
                    <span className={styles.optPxUnit}>px</span>
                  </label>
                ) : null}
              </div>

              <div className={styles.optDivider} />

              {/* 글꼴 — 시안대로 모양만 있습니다. 보드가 글꼴 변경을 아직 지원하지 않아 동작은 없습니다. */}
              <button
                type="button"
                className={styles.optFontFamily}
                title="글꼴 (준비 중)"
                aria-label="글꼴 (준비 중)"
                aria-disabled="true"
              >
                <span>Roboto</span>
                <MaskIcon icon={ICON.chevronDown} className={styles.chevronUp} />
              </button>

              <div className={styles.optDivider} />

              <div className={`${styles.optGroup} ${styles.optGroupText}`} role="group" aria-label="텍스트 서식">
                <button
                  type="button"
                  className={`${styles.optBtn}${textBold ? ` ${styles.active}` : ''}`}
                  title="굵게"
                  aria-label="굵게"
                  aria-pressed={textBold}
                  onClick={() => onTextDecor?.({ bold: !textBold })}
                >
                  <MaskIcon icon={ICON.textBold} />
                </button>
                <button
                  type="button"
                  className={`${styles.optBtn}${textStrike ? ` ${styles.active}` : ''}`}
                  title="취소선"
                  aria-label="취소선"
                  aria-pressed={textStrike}
                  onClick={() => onTextDecor?.({ strike: !textStrike })}
                >
                  <MaskIcon icon={ICON.textStrike} />
                </button>
                <button
                  type="button"
                  className={`${styles.optBtn}${textUnderline ? ` ${styles.active}` : ''}`}
                  title="밑줄"
                  aria-label="밑줄"
                  aria-pressed={textUnderline}
                  onClick={() => onTextDecor?.({ underline: !textUnderline })}
                >
                  <MaskIcon icon={ICON.textUnderline} />
                </button>
                {/* 번호 목록 — 시안대로 모양만 있습니다. 보드가 목록을 아직 지원하지 않아 동작은 없습니다. */}
                <button
                  type="button"
                  className={styles.optBtn}
                  title="번호 목록 (준비 중)"
                  aria-label="번호 목록 (준비 중)"
                  aria-disabled="true"
                >
                  <MaskIcon icon={ICON.textList} />
                </button>
              </div>

              <div className={styles.optDivider} />

              {/* 정렬 — 지금 정렬 아이콘이 버튼에 보이고, 누르면 위로 좌·중·우 선택 */}
              <div className={styles.optPopWrap} ref={textAlignMenuRef}>
                <button
                  type="button"
                  className={`${styles.optBtn} ${styles.optBtnDropdown}${textAlignMenuOpen ? ` ${styles.active}` : ''}`}
                  title="정렬"
                  aria-label="정렬"
                  aria-expanded={textAlignMenuOpen}
                  onClick={() => {
                    setTextFontSizeMenuOpen(false);
                    setTextAlignMenuOpen((v) => !v);
                  }}
                >
                  {textAlign === 'left' ? (
                    <MaskIcon icon={ICON.textAlignLeft} />
                  ) : (
                    <AlignLineIcon kind={textAlign} />
                  )}
                  <MaskIcon icon={ICON.chevronDown} className={styles.chevronUp} />
                </button>
                {textAlignMenuOpen ? (
                  <div className={styles.optPopover} role="group" aria-label="텍스트 정렬">
                    <button
                      type="button"
                      className={`${styles.optBtn}${textAlign === 'left' ? ` ${styles.active}` : ''}`}
                      title="왼쪽 정렬"
                      aria-label="왼쪽 정렬"
                      aria-pressed={textAlign === 'left'}
                      onClick={() => {
                        onTextAlign?.('left');
                        setTextAlignMenuOpen(false);
                      }}
                    >
                      <MaskIcon icon={ICON.textAlignLeft} />
                    </button>
                    <button
                      type="button"
                      className={`${styles.optBtn}${textAlign === 'center' ? ` ${styles.active}` : ''}`}
                      title="가운데 정렬"
                      aria-label="가운데 정렬"
                      aria-pressed={textAlign === 'center'}
                      onClick={() => {
                        onTextAlign?.('center');
                        setTextAlignMenuOpen(false);
                      }}
                    >
                      <AlignLineIcon kind="center" />
                    </button>
                    <button
                      type="button"
                      className={`${styles.optBtn}${textAlign === 'right' ? ` ${styles.active}` : ''}`}
                      title="오른쪽 정렬"
                      aria-label="오른쪽 정렬"
                      aria-pressed={textAlign === 'right'}
                      onClick={() => {
                        onTextAlign?.('right');
                        setTextAlignMenuOpen(false);
                      }}
                    >
                      <AlignLineIcon kind="right" />
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          {/* ===== 도형 종류 ===== */}
          {active === 'shapes' && !textSelected ? (
            <div className={`${styles.optGroup} ${styles.optGroupShapes}`} role="group" aria-label="도형 종류">
              {SHAPE_ITEMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`${styles.optBtn}${activeShape === item.id ? ` ${styles.active}` : ''}`}
                  title={item.label}
                  aria-label={item.label}
                  onClick={() => onPickShape?.(item.id)}
                >
                  <MaskIcon icon={item.icon} />
                </button>
              ))}
            </div>
          ) : null}

          {/* ===== 메모장 배경색 ===== */}
          {active === 'stamp' && !textSelected ? (
            <div className={styles.optSwatches} role="group" aria-label="메모 배경색">
              {STICKY_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`${styles.swatch}${sameColor(stickyColor, c) ? ` ${styles.active}` : ''}`}
                  style={{ background: c }}
                  title="메모 배경색"
                  aria-label={`메모 색 ${c}`}
                  onClick={() => onStickyColor(c)}
                />
              ))}
            </div>
          ) : null}

          {/* ===== 파일: 올라온 파일 칩 (누르면 다운로드) ===== */}
          {active === 'file' && !textSelected ? (
            <div className={styles.submenuAttachments}>
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUploadFile?.(file);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className={styles.attachmentAddBtn}
                disabled={uploadingAttachment || !onUploadFile}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadingAttachment ? '올리는 중…' : '+ 파일 추가'}
              </button>
              {attachments.length === 0 ? (
                <span className={styles.submenuEmpty}>추가한 파일이 여기 쌓입니다</span>
              ) : (
                attachments.map((file, index) => (
                  <a
                    key={`${file.path}-${index}`}
                    className={styles.attachmentChip}
                    href={chatFileUrl(file.path)}
                    target="_blank"
                    rel="noreferrer"
                    download={displayFileName(file.name)}
                    title={displayFileName(file.name)}
                  >
                    <MaskIcon icon={ICON.fileDoc} className={styles.attachmentChipIcon} />
                    <span>{displayFileName(file.name)}</span>
                  </a>
                ))
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
