import type { ExcalidrawTool } from './ExcalidrawToolbar';

export type MeetingDrawAction = ExcalidrawTool | 'stamp';

type ToolItem = {
  id: MeetingDrawAction;
  tooltip: string;
  icon: 'pointer' | 'pen' | 'link' | 'type' | 'shape' | 'sticky' | 'eraser' | 'clip';
};

const TOOLS: ToolItem[] = [
  { id: 'hand', tooltip: '선택', icon: 'pointer' },
  { id: 'pen', tooltip: '펜', icon: 'pen' },
  { id: 'arrow', tooltip: '연결선', icon: 'link' },
  { id: 'text', tooltip: '텍스트', icon: 'type' },
  { id: 'rectangle', tooltip: '도형', icon: 'shape' },
  { id: 'stamp', tooltip: '메모장', icon: 'sticky' },
  { id: 'eraser', tooltip: '지우개', icon: 'eraser' },
  { id: 'file', tooltip: '파일 첨부', icon: 'clip' },
];

type Props = {
  /** 현재 선택된 그리기 도구. 메모장은 stamp */
  active: MeetingDrawAction;
  onPick: (tool: MeetingDrawAction) => void;
};

function ToolSvg({ icon }: { icon: ToolItem['icon'] }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    width: 20,
    height: 20,
    'aria-hidden': true,
  };

  switch (icon) {
    case 'pointer':
      return (
        <svg {...common}>
          <path d="M4 4l7.07 17 2.51-7.39L21 11.07z" />
        </svg>
      );
    case 'pen':
      return (
        <svg {...common}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z" />
        </svg>
      );
    case 'link':
      return (
        <svg {...common}>
          <path d="M10 13a5 5 0 0 0 7.07 0l1.41-1.41a5 5 0 0 0-7.07-7.07L10 5.93" />
          <path d="M14 11a5 5 0 0 0-7.07 0L5.52 12.41a5 5 0 0 0 7.07 7.07L14 18.07" />
        </svg>
      );
    case 'type':
      return (
        <svg {...common}>
          <path d="M4 7V5h16v2" />
          <path d="M12 5v14" />
          <path d="M8 19h8" />
        </svg>
      );
    case 'shape':
      return (
        <svg {...common}>
          <path d="M12 3 3 20h18z" />
        </svg>
      );
    case 'sticky':
      return (
        <svg {...common}>
          <path d="M15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10l6-6V5a2 2 0 0 0-2-2z" />
          <path d="M15 3v6h6" />
        </svg>
      );
    case 'eraser':
      return (
        <svg {...common}>
          <path d="M16.24 3.56a2.5 2.5 0 0 1 3.54 3.54L9.9 17.98l-4.6.92.92-4.6 10.02-10.74Z" />
          <path d="M6.5 19.5h11" />
        </svg>
      );
    case 'clip':
      return (
        <svg {...common}>
          <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.83l8.49-8.48" />
        </svg>
      );
    default:
      return null;
  }
}

/**
 * grop/meeting.html 하단 .drawing-tools
 * 원본 7개 도구 + 실제 그리기에 필요한 펜을 포함합니다.
 */
export default function MeetingDrawingTools({ active, onPick }: Props) {
  return (
    <div className="drawing-tools">
      {TOOLS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`tool-button${active === item.id ? ' active' : ''}`}
          data-tooltip={item.tooltip}
          aria-label={item.tooltip}
          onClick={() => onPick(item.id)}
        >
          <ToolSvg icon={item.icon} />
        </button>
      ))}
    </div>
  );
}
