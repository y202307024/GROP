export type ExcalidrawTool =
  | 'hand'
  | 'rectangle'
  | 'diamond'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'pen'
  | 'text'
  | 'image'
  | 'eraser';

type Props = {
  tool: ExcalidrawTool;
  locked: boolean;
  onToolChange: (tool: ExcalidrawTool) => void;
  onLockToggle: () => void;
  onLibraryOpen: () => void;
};

const tools: { id: ExcalidrawTool; icon: string; label: string; shortcut?: string }[] = [
  { id: 'hand', icon: '✋', label: '손', shortcut: '' },
  { id: 'rectangle', icon: '▭', label: '사각형', shortcut: '2' },
  { id: 'diamond', icon: '◇', label: '마름모', shortcut: '3' },
  { id: 'ellipse', icon: '○', label: '원', shortcut: '4' },
  { id: 'arrow', icon: '→', label: '화살표', shortcut: '5' },
  { id: 'line', icon: '─', label: '직선', shortcut: '6' },
  { id: 'pen', icon: '✏', label: '펜', shortcut: '7' },
  { id: 'text', icon: 'A', label: '텍스트', shortcut: '8' },
  { id: 'image', icon: '🖼', label: '이미지', shortcut: '9' },
  { id: 'eraser', icon: 'eraser', label: '지우개', shortcut: '0' },
];

function ToolIcon({ icon }: { icon: string }) {
  if (icon !== 'eraser') return <>{icon}</>;

  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M16.24 3.56a2.5 2.5 0 0 1 3.54 3.54L9.9 17.98l-4.6.92.92-4.6 10.02-10.74Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M6.5 19.5h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function ExcalidrawToolbar({ tool, locked, onToolChange, onLockToggle, onLibraryOpen }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '6px 8px',
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
        flexWrap: 'wrap',
      }}
    >
      <button
        type="button"
        title="도구 고정"
        onClick={onLockToggle}
        style={{
          width: 36,
          height: 36,
          border: 'none',
          borderRadius: 8,
          background: locked ? '#ede9fe' : 'transparent',
          cursor: 'pointer',
          fontSize: 16,
        }}
      >
        🔒
      </button>

      <div style={{ width: 1, height: 28, background: '#e5e7eb', margin: '0 4px' }} />

      {tools.map((t) => {
        const active = tool === t.id;
        return (
          <button
            key={t.id}
            type="button"
            title={`${t.label}${t.shortcut ? ` (${t.shortcut})` : ''}`}
            onClick={() => onToolChange(t.id)}
            style={{
              minWidth: 36,
              height: 36,
              padding: '0 6px',
              border: 'none',
              borderRadius: 8,
              background: active ? '#ede9fe' : 'transparent',
              color: '#111827',
              cursor: 'pointer',
              fontSize: t.id === 'text' ? 15 : 18,
              fontWeight: t.id === 'text' ? 700 : 400,
              position: 'relative',
            }}
          >
            {t.id === 'text' ? (
              t.icon
            ) : (
              <ToolIcon icon={t.icon} />
            )}
            {t.shortcut ? (
              <span style={{ position: 'absolute', right: 2, bottom: 1, fontSize: 9, color: '#9ca3af' }}>{t.shortcut}</span>
            ) : null}
          </button>
        );
      })}

      <div style={{ width: 1, height: 28, background: '#e5e7eb', margin: '0 4px' }} />

      <button
        type="button"
        title="라이브러리"
        onClick={onLibraryOpen}
        style={{ width: 36, height: 36, border: 'none', borderRadius: 8, background: 'transparent', cursor: 'pointer', fontSize: 16 }}
      >
        📚
      </button>
    </div>
  );
}

export const toolShortcutMap: Record<string, ExcalidrawTool> = {
  '2': 'rectangle',
  '3': 'diamond',
  '4': 'ellipse',
  '5': 'arrow',
  '6': 'line',
  '7': 'pen',
  '8': 'text',
  '9': 'image',
  '0': 'eraser',
};
