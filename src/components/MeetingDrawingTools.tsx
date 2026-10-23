import { useEffect, useRef, useState } from 'react';
import type { ExcalidrawTool } from './ExcalidrawToolbar';
import { chatFileUrl, displayFileName, type MeetingChatFile } from '../utils/meetingChat';
// 시안 PNG (Vite가 번들에 넣고 URL을 줍니다)
import iconPointer from '../assets/toolbar/pointer.png';
import iconHand from '../assets/toolbar/hand.png';
import iconPen from '../assets/toolbar/pen.png';
import iconType from '../assets/toolbar/type.png';
import iconShape from '../assets/toolbar/shape.png';
import iconSticky from '../assets/toolbar/sticky.png';
import iconImage from '../assets/toolbar/image.png';
import iconClip from '../assets/toolbar/clip.png';

/** 하단 메인 도구. shapes는 서브메뉴에서 실제 Excalidraw 도구로 분기합니다. */
export type MeetingDrawAction = ExcalidrawTool | 'stamp' | 'shapes' | 'pan';

type PrimaryTool = {
  id: MeetingDrawAction;
  tooltip: string;
  icon: 'pointer' | 'hand' | 'pen' | 'type' | 'shape' | 'sticky' | 'image' | 'clip';
};

const PRIMARY_TOOLS: PrimaryTool[] = [
  { id: 'hand', tooltip: '선택', icon: 'pointer' },
  { id: 'pan', tooltip: '이동', icon: 'hand' },
  { id: 'pen', tooltip: '펜', icon: 'pen' },
  { id: 'text', tooltip: '텍스트', icon: 'type' },
  { id: 'shapes', tooltip: '도형', icon: 'shape' },
  { id: 'stamp', tooltip: '메모장', icon: 'sticky' },
  { id: 'image', tooltip: '이미지', icon: 'image' },
  { id: 'file', tooltip: '파일', icon: 'clip' },
];

const TOOLBAR_ICON_SRC: Record<PrimaryTool['icon'], string> = {
  pointer: iconPointer,
  hand: iconHand,
  pen: iconPen,
  type: iconType,
  shape: iconShape,
  sticky: iconSticky,
  image: iconImage,
  clip: iconClip,
};

const PEN_COLORS = ['#111111', '#e53935', '#fbc02d', '#43a047', '#1e88e5', '#8e24aa', '#ffffff'] as const;
/** 접힌 상태에 고정으로 보이는 기본 검정 */
const DEFAULT_VISIBLE_COLOR = '#111111';

/** 펜·텍스트·도형에서 쓰는 공통 색 팔레트 */
export const DRAW_COLORS = PEN_COLORS;

export type PenTipId = 'pencil' | 'marker' | 'brush';

/** 시안: 연필 · 마커 · 붓 — 마커는 형광펜처럼 반투명·넓은 획 */
export const PEN_TIPS = [
  { id: 'pencil' as const, label: '연필', size: 3, opacity: 1 },
  { id: 'marker' as const, label: '마커', size: 18, opacity: 0.4 },
  { id: 'brush' as const, label: '붓', size: 14, opacity: 1 },
];
/** 마커(형광펜) 기본 강조색 — 검정에서 바꿀 때 씁니다 */
const MARKER_DEFAULT_COLOR = '#fbc02d';
const STICKY_COLORS = ['#5c5c5c', '#ffffff', '#f6c1c1', '#f7e7a5', '#cfe8c8', '#c5ddf5', '#ddd0f0'] as const;

/** 요구사항 도형 종류 — 다각형은 오각형으로 매핑합니다. 연결선은 이미지 순서(꺾은선·곡선·직선화살·직선). */
const SHAPE_ITEMS: { id: ExcalidrawTool; label: string; icon: ShapeIconKind }[] = [
  { id: 'rectangle', label: '직사각형', icon: 'square' },
  { id: 'ellipse', label: '원/타원', icon: 'circle' },
  { id: 'triangle', label: '삼각형', icon: 'triangle' },
  { id: 'pentagon', label: '다각형', icon: 'pentagon' },
  { id: 'star', label: '별', icon: 'star' },
  { id: 'elbowArrow', label: '꺾은선 화살표', icon: 'elbowArrow' },
  { id: 'curveArrow', label: '곡선 화살표', icon: 'curveArrow' },
  { id: 'arrow', label: '화살표', icon: 'arrow' },
  { id: 'line', label: '직선', icon: 'line' },
];

type ShapeIconKind =
  | 'square'
  | 'circle'
  | 'triangle'
  | 'pentagon'
  | 'star'
  | 'arrow'
  | 'line'
  | 'elbowArrow'
  | 'curveArrow';

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

const svgBase = {
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
};

/** 시안 PNG를 그대로 그립니다. */
function ToolSvg({ icon }: { icon: PrimaryTool['icon'] }) {
  return (
    <img
      className="tool-button-img"
      src={TOOLBAR_ICON_SRC[icon]}
      alt=""
      draggable={false}
      width={24}
      height={24}
    />
  );
}

/** 펜 서브메뉴: 연필 · 마커 · 붓 · 지우개 */
function PenTipIcon({ kind }: { kind: 'pencil' | 'marker' | 'brush' | 'eraser' }) {
  const common = { ...svgBase, width: 18, height: 18 };

  if (kind === 'pencil') {
    return (
      <svg {...common}>
        <path d="M13.8 3.6a1.8 1.8 0 0 1 2.6 2.6L8.2 14.4 4.8 15.2l.8-3.4z" />
        <path d="M12.2 5.2 16.8 9.8" />
        <path d="M4.5 19.5h10" />
      </svg>
    );
  }
  if (kind === 'marker') {
    return (
      <svg {...common}>
        <path d="M8.2 19.2 15.5 5.4l2.2 1.2-7.3 13.8z" />
        <path d="M14.8 6.6 17.4 8" />
        <path d="M8 19.4h4.2" />
      </svg>
    );
  }
  if (kind === 'brush') {
    return (
      <svg {...common}>
        <path d="M9.2 20.2a3.2 3.2 0 0 0 5.6 0" />
        <path d="M12 16.8V11.2" />
        <path d="M8.2 8.2c0-2.8 1.7-4.7 3.8-4.7s3.8 1.9 3.8 4.7c0 1.8-.9 3.2-1.9 4.1H10c-1-.9-1.8-2.3-1.8-4.1z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M15.8 4.2a2.2 2.2 0 0 1 3.1 3.1L9.6 16.6l-4.1.8.8-4.1z" />
      <path d="M6.2 19.5h11" />
    </svg>
  );
}

function ShapeIcon({ kind }: { kind: ShapeIconKind }) {
  const common = { ...svgBase, width: 18, height: 18 };

  switch (kind) {
    case 'square':
      return (
        <svg {...common}>
          <rect x="5.5" y="5.5" width="13" height="13" rx="1" />
        </svg>
      );
    case 'circle':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="6.5" />
        </svg>
      );
    case 'triangle':
      return (
        <svg {...common}>
          <path d="M12 5.5 18.5 18.5h-13z" />
        </svg>
      );
    case 'pentagon':
      return (
        <svg {...common}>
          <path d="M12 4.5 18.2 9.1 15.8 18.5H8.2L5.8 9.1z" />
        </svg>
      );
    case 'star':
      return (
        <svg {...common}>
          <path d="M12 4.2 13.9 9.5H19.5L15 12.8l1.7 5.5L12 15.4 7.3 18.3 9 12.8 4.5 9.5h5.6z" />
        </svg>
      );
    case 'arrow':
      return (
        <svg {...common}>
          <path d="M5 12h12.5" />
          <path d="M14 8.5 17.5 12 14 15.5" />
        </svg>
      );
    case 'line':
      return (
        <svg {...common}>
          <path d="M5.5 17.5 18.5 6.5" />
        </svg>
      );
    case 'elbowArrow':
      return (
        <svg {...common}>
          <path d="M4.5 16.5H11V7.5h5.2" />
          <path d="M14.2 5.2 18.2 7.5 14.2 9.8" />
        </svg>
      );
    case 'curveArrow':
      return (
        <svg {...common}>
          <path d="M4.5 16.5C8 16.5 8 7.5 12 7.5h5" />
          <path d="M14.2 5 18.2 7.5 14.2 10" />
        </svg>
      );
    default:
      return null;
  }
}

/** activeShape → 서브메뉴 아이콘 id */
function shapeIconForTool(tool: ExcalidrawTool): ShapeIconKind {
  if (tool === 'ellipse') return 'circle';
  if (tool === 'triangle') return 'triangle';
  if (tool === 'pentagon' || tool === 'hexagon' || tool === 'diamond') return 'pentagon';
  if (tool === 'star') return 'star';
  if (tool === 'elbowArrow') return 'elbowArrow';
  if (tool === 'curveArrow') return 'curveArrow';
  if (tool === 'line') return 'line';
  if (tool === 'arrow') return 'arrow';
  return 'square';
}

function TextSubIcon({ kind }: { kind: 'font' | 'bold' | 'strike' | 'underline' | 'list' | 'alignLeft' | 'alignCenter' | 'alignRight' }) {
  const common = { ...svgBase, width: 18, height: 18 };

  if (kind === 'font') {
    return (
      <svg {...common} strokeWidth={1.6}>
        <text x="3.2" y="16" fontSize="11" fontFamily="Arial, sans-serif" fill="currentColor" stroke="none" fontWeight="700">A</text>
        <text x="12" y="16" fontSize="9" fontFamily="Arial, sans-serif" fill="currentColor" stroke="none" fontWeight="700">a</text>
      </svg>
    );
  }
  if (kind === 'bold') {
    return (
      <svg {...common} strokeWidth={2.2}>
        <path d="M8 5.5h5.2a2.8 2.8 0 0 1 0 5.6H8z" />
        <path d="M8 11.1h5.8a3 3 0 0 1 0 6H8z" />
      </svg>
    );
  }
  if (kind === 'strike') {
    return (
      <svg {...common} strokeWidth={2}>
        <path d="M7 7.5c.8-1.5 2.4-2.2 4.2-2.2 2.5 0 4 1.3 4 3.2 0 1.2-.5 2.1-1.5 2.7" />
        <path d="M8.2 16.8c.9.7 2.1 1 3.5 1 2.6 0 4.3-1.4 4.3-3.4" />
        <path d="M5.5 12h13" />
      </svg>
    );
  }
  if (kind === 'underline') {
    return (
      <svg {...common} strokeWidth={2}>
        <path d="M7.5 5.5v7.2a4.5 4.5 0 0 0 9 0V5.5" />
        <path d="M6.5 19h11" />
      </svg>
    );
  }
  if (kind === 'list') {
    return (
      <svg {...common}>
        <circle cx="6" cy="7" r="1.1" fill="currentColor" stroke="none" />
        <circle cx="6" cy="12" r="1.1" fill="currentColor" stroke="none" />
        <circle cx="6" cy="17" r="1.1" fill="currentColor" stroke="none" />
        <path d="M10 7h8M10 12h8M10 17h8" />
      </svg>
    );
  }
  if (kind === 'alignCenter') {
    return (
      <svg {...common}>
        <path d="M5 7h14M7 12h10M5 17h14" />
      </svg>
    );
  }
  if (kind === 'alignRight') {
    return (
      <svg {...common}>
        <path d="M5 7h14M9 12h10M12 17h7" />
      </svg>
    );
  }
  // alignLeft
  return (
    <svg {...common}>
      <path d="M5 7h14M5 12h10M5 17h7" />
    </svg>
  );
}

function FileDocIcon() {
  // 시안: 접힌 모서리 + 본문 줄 3개, 올리브 그린
  return (
    <svg className="attachment-chip-icon" viewBox="0 0 24 24" width={16} height={16} fill="none" aria-hidden="true">
      <path
        d="M14 2H7.5A1.5 1.5 0 0 0 6 3.5v17A1.5 1.5 0 0 0 7.5 22h9a1.5 1.5 0 0 0 1.5-1.5V8z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M9 12h6M9 15.5h6M9 19h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
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
  penStyle: _penStyle = { opacity: 1, dash: 'solid' },
  shapeStyle = {
    dash: 'solid',
    strokeOpacity: 1,
    fillEnabled: false,
    fillColor: '#93c5a0',
    fillOpacity: 0.35,
  },
  onShapeStyle,
  onPickEraser,
  onClearAll,
  onAreaErase,
  isAreaErase = false,
  onStartEyedropper: _onStartEyedropper,
  stickyColor,
  onStickyColor,
  attachments = [],
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
  // 마지막으로 고른 도형 아이콘만 강조합니다.
  const [activeShapeIcon, setActiveShapeIcon] = useState<ShapeIconKind>(() => shapeIconForTool(activeShape));
  // 텍스트 px 입력칸 — 타이핑 중에는 문자열로 두고, 확정 시 숫자로 반영합니다.
  const [textSizeDraft, setTextSizeDraft] = useState(String(textFontSize));
  // 색상: 기본은 검정만, + 로 다른 팔레트 색을 펼칩니다.
  const [colorPanelOpen, setColorPanelOpen] = useState(false);
  // 글꼴 크기(Aa) 버튼 → 오른쪽에 px 입력칸 펼침
  const [textFontSizeMenuOpen, setTextFontSizeMenuOpen] = useState(false);
  // 목록 버튼 → 오른쪽에 정렬 옵션 펼침
  const [textAlignMenuOpen, setTextAlignMenuOpen] = useState(false);
  const colorPanelRef = useRef<HTMLDivElement | null>(null);
  // 글꼴 크기 팝오버 — 바깥 클릭 시 닫기
  const textFontSizeMenuRef = useRef<HTMLDivElement | null>(null);
  // 직접 고르기용 브라우저 색상 input
  const nativeColorInputRef = useRef<HTMLInputElement | null>(null);
  const nativeColorValue = /^#[0-9a-f]{6}$/i.test(strokeColor) ? strokeColor : '#111111';

  /** 연필/마커/붓 선택을 바꿉니다. (굵기 슬라이더와는 분리) */
  const selectPenTip = (tip: PenTipId) => {
    onPenTipChange?.(tip);
  };

  useEffect(() => {
    setActiveShapeIcon(shapeIconForTool(activeShape));
  }, [activeShape]);

  useEffect(() => {
    setTextSizeDraft(String(textFontSize));
  }, [textFontSize]);

  // 도구를 바꾸면 색 패널·글꼴 크기·정렬 메뉴는 접습니다.
  useEffect(() => {
    setColorPanelOpen(false);
    setTextFontSizeMenuOpen(false);
    setTextAlignMenuOpen(false);
  }, [active, textSelected]);

  useEffect(() => {
    if (!colorPanelOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (colorPanelRef.current && !colorPanelRef.current.contains(e.target as Node)) {
        setColorPanelOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [colorPanelOpen]);

  // 글꼴 크기 px 창: 바깥을 누르면 닫습니다. (값은 input blur에서 이미 확정)
  useEffect(() => {
    if (!textFontSizeMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (textFontSizeMenuRef.current && !textFontSizeMenuRef.current.contains(e.target as Node)) {
        setTextFontSizeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [textFontSizeMenuOpen]);

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

  /** 오른쪽 공통 색상 — 도형 단색 채우기일 때는 채우기 색도 같이 맞춥니다. */
  const applyStrokeColor = (color: string) => {
    onStrokeStyle({ color });
    // 메모장 도구일 때는 오른쪽 상시 색상도 종이색으로 씁니다.
    if (active === 'stamp') {
      onStickyColor(color);
    }
    if (active === 'shapes' && shapeStyle.fillEnabled) {
      onShapeStyle?.({ fillColor: color });
    }
  };

  /** 하단 오른쪽 고정: 검정만 노출 · + 누르면 왼쪽으로 팔레트 */
  const toolbarColorRow = (
    <div className="submenu-colors-end" ref={colorPanelRef} role="group" aria-label="색상">
      <div className="submenu-divider" />
      {colorPanelOpen ? (
        <div className="submenu-color-popover" role="dialog" aria-label="색상 설정">
          <div className="submenu-swatches">
            {PEN_COLORS.filter((c) => c !== DEFAULT_VISIBLE_COLOR).map((c) => (
              <button
                key={c}
                type="button"
                className={`color-swatch${strokeColor.toLowerCase() === c ? ' active' : ''}${c === '#ffffff' ? ' is-light' : ''}`}
                style={{ background: c }}
                title={c}
                aria-label={`색 ${c}`}
                onClick={() => applyStrokeColor(c)}
              />
            ))}
            {/* 스포이트 아이콘 = 직접 고르기(네이티브 색상 피커) */}
            <button
              type="button"
              className="submenu-icon-btn"
              title="직접 고르기"
              aria-label="직접 고르기"
              onClick={() => nativeColorInputRef.current?.click()}
            >
              <svg {...svgBase} width={18} height={18}>
                <path d="M14.5 3.5 18 7l-2 2-3.5-3.5z" />
                <path d="M12.5 5.5 6 12v3h3l6.5-6.5" />
                <path d="M5 17h4" />
              </svg>
            </button>
            <input
              ref={nativeColorInputRef}
              type="color"
              className="submenu-native-color-input"
              value={nativeColorValue}
              aria-hidden
              tabIndex={-1}
              onChange={(e) => applyStrokeColor(e.target.value)}
            />
          </div>
        </div>
      ) : null}
      <button
        type="button"
        className={`submenu-color-plus${colorPanelOpen ? ' active' : ''}`}
        title={colorPanelOpen ? '색상 닫기' : '색상 더보기'}
        aria-expanded={colorPanelOpen}
        aria-label="색상 더보기"
        onClick={() => setColorPanelOpen((v) => !v)}
      >
        {colorPanelOpen ? '−' : '+'}
      </button>
      <button
        type="button"
        className={`color-swatch color-swatch-main${strokeColor.toLowerCase() === DEFAULT_VISIBLE_COLOR ? ' active' : ''}`}
        style={{ background: DEFAULT_VISIBLE_COLOR }}
        title="검정"
        aria-label="검정"
        onClick={() => applyStrokeColor(DEFAULT_VISIBLE_COLOR)}
      />
    </div>
  );

  return (
    <div className="drawing-tools has-submenu">
      <div className="drawing-tools-primary" role="toolbar" aria-label="그리기 도구">
        {PRIMARY_TOOLS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`tool-button${active === item.id ? ' active' : ''}`}
            data-tooltip={item.tooltip}
            aria-label={item.tooltip}
            aria-pressed={active === item.id}
            onClick={() => onPick(item.id)}
          >
            <ToolSvg icon={item.icon} />
          </button>
        ))}
      </div>

      {/* 서브옵션 + 색상. 색상은 선택/이동/메모 등 어떤 도구에서도 오른쪽에 상시 표시 */}
      <div className="drawing-tools-submenu" role="group" aria-label="도구 옵션">
          {active === 'pen' && !textSelected ? (
            <>
              {/* 시안: 연필 · 마커 · 붓 · 지우개 */}
              <div className="submenu-group" role="group" aria-label="펜 종류">
                {PEN_TIPS.map((tip) => (
                  <button
                    key={tip.id}
                    type="button"
                    className={`submenu-icon-btn${!isEraser && penTip === tip.id ? ' active' : ''}`}
                    title={tip.id === 'marker' ? '마커 (형광펜)' : tip.label}
                    onClick={() => {
                      selectPenTip(tip.id);
                      onPick('pen');
                      // 마커: 반투명 넓은 획으로 텍스트 위를 강조. 연필/붓은 불투명으로 복구.
                      const patch: StrokeStylePatch = { size: tip.size, opacity: tip.opacity };
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
                    <PenTipIcon kind={tip.id} />
                  </button>
                ))}
                <button
                  type="button"
                  className={`submenu-icon-btn${isEraser ? ' active' : ''}`}
                  title="지우개"
                  onClick={() => onPickEraser?.()}
                >
                  <PenTipIcon kind="eraser" />
                </button>
              </div>

              <div className="submenu-divider" />
              {/* 지우개: 슬라이더 · 영역/전체 지우기. 색상 선택은 펜/지우개 공통으로 오른쪽에 상시 표시 */}
              {isEraser ? (
                <div className="eraser-submenu-actions" role="group" aria-label="지우개 옵션">
                  <label className="submenu-slider" title="지우개 굵기">
                    <span className="visually-hidden">지우개 굵기</span>
                    <input
                      type="range"
                      min={1}
                      max={100}
                      value={strokeSize}
                      onChange={(e) => {
                        onStrokeStyle({ size: Number(e.target.value), opacity: 1 });
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className={`eraser-action-btn${isAreaErase ? ' active' : ''}`}
                    onClick={() => onAreaErase?.()}
                  >
                    영역 지우기
                  </button>
                  <button
                    type="button"
                    className="eraser-action-btn"
                    onClick={() => onClearAll?.()}
                  >
                    전체 지우기
                  </button>
                </div>
              ) : (
                <label className="submenu-slider" title="선 굵기">
                  <span className="visually-hidden">굵기</span>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    value={strokeSize}
                    onChange={(e) => {
                      const nextSize = Number(e.target.value);
                      // 굵기만 바꿉니다. 연필/마커/붓 선택은 유지하고, 팁별 투명도도 같이 유지합니다.
                      const tip = PEN_TIPS.find((t) => t.id === penTip) ?? PEN_TIPS[0];
                      onStrokeStyle({ size: nextSize, opacity: tip.opacity });
                    }}
                  />
                </label>
              )}
            </>
          ) : null}

          {showTextSub ? (
            <>
              <div className="submenu-group" role="group" aria-label="텍스트 서식">
                {/* 글꼴 크기 버튼 — 누르면 오른쪽에 px 입력창 */}
                <div className="submenu-font-size-wrap" ref={textFontSizeMenuRef}>
                  <button
                    type="button"
                    className={`submenu-icon-btn${textFontSizeMenuOpen ? ' active' : ''}`}
                    title="글꼴 크기"
                    aria-label="글꼴 크기"
                    aria-expanded={textFontSizeMenuOpen}
                    onClick={() => {
                      setTextAlignMenuOpen(false);
                      setTextFontSizeMenuOpen((v) => !v);
                    }}
                  >
                    <TextSubIcon kind="font" />
                  </button>
                  {textFontSizeMenuOpen ? (
                    <label className="submenu-font submenu-font-px">
                      <span className="visually-hidden">글자 크기(px)</span>
                      <input
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
                      <span className="submenu-font-unit">px</span>
                    </label>
                  ) : null}
                </div>
                <button
                  type="button"
                  className={`submenu-icon-btn${textBold ? ' active' : ''}`}
                  title="굵게"
                  aria-label="굵게"
                  aria-pressed={textBold}
                  onClick={() => onTextDecor?.({ bold: !textBold })}
                >
                  <TextSubIcon kind="bold" />
                </button>
                <button
                  type="button"
                  className={`submenu-icon-btn${textStrike ? ' active' : ''}`}
                  title="취소선"
                  aria-label="취소선"
                  aria-pressed={textStrike}
                  onClick={() => onTextDecor?.({ strike: !textStrike })}
                >
                  <TextSubIcon kind="strike" />
                </button>
                <button
                  type="button"
                  className={`submenu-icon-btn${textUnderline ? ' active' : ''}`}
                  title="밑줄"
                  aria-label="밑줄"
                  aria-pressed={textUnderline}
                  onClick={() => onTextDecor?.({ underline: !textUnderline })}
                >
                  <TextSubIcon kind="underline" />
                </button>
              </div>
              <div className="submenu-divider" />
              <div className="submenu-group" role="group" aria-label="텍스트 정렬">
                <button
                  type="button"
                  className={`submenu-icon-btn${textAlignMenuOpen ? ' active' : ''}`}
                  title="정렬"
                  aria-label="정렬"
                  aria-expanded={textAlignMenuOpen}
                  onClick={() => {
                    setTextFontSizeMenuOpen(false);
                    setTextAlignMenuOpen((v) => !v);
                  }}
                >
                  <TextSubIcon kind="list" />
                </button>
                {/* 목록(정렬) 버튼 오른쪽에 좌·중·우 정렬 */}
                {textAlignMenuOpen ? (
                  <>
                    <button
                      type="button"
                      className={`submenu-icon-btn${textAlign === 'left' ? ' active' : ''}`}
                      title="왼쪽 정렬"
                      aria-label="왼쪽 정렬"
                      aria-pressed={textAlign === 'left'}
                      onClick={() => onTextAlign?.('left')}
                    >
                      <TextSubIcon kind="alignLeft" />
                    </button>
                    <button
                      type="button"
                      className={`submenu-icon-btn${textAlign === 'center' ? ' active' : ''}`}
                      title="가운데 정렬"
                      aria-label="가운데 정렬"
                      aria-pressed={textAlign === 'center'}
                      onClick={() => onTextAlign?.('center')}
                    >
                      <TextSubIcon kind="alignCenter" />
                    </button>
                    <button
                      type="button"
                      className={`submenu-icon-btn${textAlign === 'right' ? ' active' : ''}`}
                      title="오른쪽 정렬"
                      aria-label="오른쪽 정렬"
                      aria-pressed={textAlign === 'right'}
                      onClick={() => onTextAlign?.('right')}
                    >
                      <TextSubIcon kind="alignRight" />
                    </button>
                  </>
                ) : null}
              </div>
            </>
          ) : null}

          {active === 'shapes' && !textSelected ? (
            <>
              {/* 도형 종류 */}
              <div className="submenu-group submenu-shapes" role="group" aria-label="도형 종류">
                {SHAPE_ITEMS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`submenu-icon-btn${activeShapeIcon === item.icon ? ' active' : ''}`}
                    title={item.label}
                    onClick={() => {
                      setActiveShapeIcon(item.icon);
                      onPickShape?.(item.id);
                    }}
                  >
                    <ShapeIcon kind={item.icon} />
                  </button>
                ))}
              </div>

              <div className="submenu-divider" />

              {/* 테두리: 굵기 · 실선/점선 · 불투명도 (색은 사이드바) */}
              <div className="submenu-group submenu-shape-opts" role="group" aria-label="테두리">
                <span className="submenu-label">테두리</span>
                <label className="submenu-slider" title="테두리 굵기">
                  <span className="visually-hidden">테두리 굵기</span>
                  <input
                    type="range"
                    min={1}
                    max={24}
                    value={strokeSize}
                    onChange={(e) => onStrokeStyle({ size: Number(e.target.value) })}
                  />
                </label>
                <button
                  type="button"
                  className={`submenu-chip${shapeStyle.dash === 'solid' ? ' active' : ''}`}
                  title="실선"
                  onClick={() => onShapeStyle?.({ dash: 'solid' })}
                >
                  실선
                </button>
                <button
                  type="button"
                  className={`submenu-chip${shapeStyle.dash === 'dashed' ? ' active' : ''}`}
                  title="점선"
                  onClick={() => onShapeStyle?.({ dash: 'dashed' })}
                >
                  점선
                </button>
                <label className="submenu-slider submenu-opacity" title="테두리 불투명도">
                  <span className="visually-hidden">테두리 불투명도</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(shapeStyle.strokeOpacity * 100)}
                    onChange={(e) => onShapeStyle?.({ strokeOpacity: Number(e.target.value) / 100 })}
                  />
                </label>
              </div>

              <div className="submenu-divider" />

              {/* 채우기: 단색 · 투명 · 불투명도 (색은 오른쪽 공통 색상 선택) */}
              <div className="submenu-group submenu-shape-opts" role="group" aria-label="채우기">
                <span className="submenu-label">채우기</span>
                <button
                  type="button"
                  className={`submenu-chip${!shapeStyle.fillEnabled ? ' active' : ''}`}
                  title="투명"
                  onClick={() => onShapeStyle?.({ fillEnabled: false })}
                >
                  투명
                </button>
                <button
                  type="button"
                  className={`submenu-chip${shapeStyle.fillEnabled ? ' active' : ''}`}
                  title="단색"
                  onClick={() => onShapeStyle?.({ fillEnabled: true, fillColor: strokeColor })}
                >
                  단색
                </button>
                <label
                  className={`submenu-slider submenu-opacity${shapeStyle.fillEnabled ? '' : ' is-disabled'}`}
                  title="채우기 불투명도"
                >
                  <span className="visually-hidden">채우기 불투명도</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(shapeStyle.fillOpacity * 100)}
                    disabled={!shapeStyle.fillEnabled}
                    onChange={(e) => onShapeStyle?.({ fillOpacity: Number(e.target.value) / 100 })}
                  />
                </label>
              </div>
            </>
          ) : null}

          {active === 'stamp' && !textSelected ? (
            <div className="submenu-swatches sticky-swatches">
              {STICKY_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`color-swatch is-rounded${stickyColor.toLowerCase() === c.toLowerCase() ? ' active' : ''}${c === '#ffffff' ? ' is-light' : ''}`}
                  style={{ background: c }}
                  title="메모 배경색"
                  aria-label={`메모 색 ${c}`}
                  onClick={() => onStickyColor(c)}
                />
              ))}
            </div>
          ) : null}

          {active === 'file' && !textSelected ? (
            <div className="submenu-attachments">
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
                className="attachment-add-btn"
                disabled={uploadingAttachment || !onUploadFile}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadingAttachment ? '올리는 중…' : '+ 파일 추가'}
              </button>
              {attachments.length === 0 ? (
                <span className="submenu-empty">추가한 파일이 여기 쌓입니다</span>
              ) : (
                attachments.map((file, index) => (
                  <a
                    key={`${file.path}-${index}`}
                    className="attachment-chip"
                    href={chatFileUrl(file.path)}
                    target="_blank"
                    rel="noreferrer"
                    download={displayFileName(file.name)}
                    title={displayFileName(file.name)}
                  >
                    <FileDocIcon />
                    <span>{displayFileName(file.name)}</span>
                  </a>
                ))
              )}
            </div>
          ) : null}

          {/* 오른쪽 하단 색상 — 선택·이동·메모장 등 모든 도구에서 항상 표시 */}
          {toolbarColorRow}
      </div>
    </div>
  );
}
