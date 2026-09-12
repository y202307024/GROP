import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import styles from './StickyNoteOverlay.module.css';

/** 화이트보드에 올려 둔 메모장 한 장 */
export type PlacedSticky = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  text: string;
  drawing: string;
};

export type StickyEditMode = 'text' | 'pen';

const PEN_COLORS = ['#222222', '#d32f2f', '#1565c0'] as const;

function spineHoles(height: number) {
  const holes: number[] = [];
  for (let top = 16; top < height - 50; top += 34) holes.push(top);
  return holes;
}

type Props = {
  note: PlacedSticky;
  selected: boolean;
  editMode: StickyEditMode;
  penColor: string;
  onSelect: () => void;
  onEditMode: (mode: StickyEditMode) => void;
  onPenColor: (color: string) => void;
  onTextChange: (text: string) => void;
  onDrawingChange: (drawing: string) => void;
  onRemove: () => void;
  /** 제목줄을 잡아 옮길 때. 캡처는 호출 쪽에서 합니다. */
  onMovePointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onResizePointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
};

/**
 * 회의 보드 위 메모장.
 * 줄 있는 종이에 글을 쓰거나, 펜으로 낙서할 수 있습니다.
 */
export default function StickyNoteOverlay({
  note,
  selected,
  editMode,
  penColor,
  onSelect,
  onEditMode,
  onPenColor,
  onTextChange,
  onDrawingChange,
  onRemove,
  onMovePointerDown,
  onResizePointerDown,
  onPointerMove,
  onPointerUp,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const skipRedrawRef = useRef(false);

  useEffect(() => {
    if (!selected || editMode !== 'text') return;
    const id = window.setTimeout(() => editorRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [selected, editMode, note.id]);

  // 저장된 그림을 노트 크기에 맞춰 다시 올립니다. 그리는 중에는 덮어쓰지 않습니다.
  useEffect(() => {
    if (skipRedrawRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = Math.max(1, Math.round(canvas.clientWidth));
    const h = Math.max(1, Math.round(canvas.clientHeight));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    if (!note.drawing) return;
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, w, h);
    img.src = note.drawing;
  }, [note.drawing, note.width, note.height]);

  const canvasPoint = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const stroke = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = penColor;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  };

  const finishStroke = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    skipRedrawRef.current = true;
    onDrawingChange(canvas.toDataURL('image/png'));
    requestAnimationFrame(() => {
      skipRedrawRef.current = false;
    });
  };

  return (
    <div
      className={`${styles.note}${selected ? ` ${styles.noteSelected}` : ''}`}
      style={{
        left: note.x,
        top: note.y,
        width: note.width,
        height: note.height,
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div
        className={styles.header}
        onPointerDown={onMovePointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className={styles.title}>메모장</span>
        <button
          type="button"
          className={`${styles.modeBtn}${editMode === 'text' ? ` ${styles.modeBtnActive}` : ''}`}
          title="텍스트"
          aria-label="텍스트"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onEditMode('text')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7V5h16v2" />
            <path d="M12 5v14" />
            <path d="M8 19h8" />
          </svg>
        </button>
        <button
          type="button"
          className={`${styles.modeBtn}${editMode === 'pen' ? ` ${styles.modeBtnActive}` : ''}`}
          title="펜"
          aria-label="펜"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onEditMode('pen')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z" />
          </svg>
        </button>
        <span className={styles.spacer} />
        <button
          type="button"
          className={styles.removeBtn}
          title="닫기"
          aria-label="닫기"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemove}
        >
          ×
        </button>
      </div>

      <div className={styles.page}>
        <div className={styles.spine} aria-hidden="true">
          {spineHoles(note.height).map((top) => (
            <span key={top} className={styles.hole} style={{ top }} />
          ))}
        </div>
        <div className={styles.body}>
          {/* 그림은 줄 위에, 글자는 그 위에 올려 메모처럼 보이게 합니다. */}
          <canvas
            ref={canvasRef}
            className={`${styles.drawLayer} ${editMode === 'pen' ? styles.drawLayerActive : styles.drawLayerIdle}`}
            onPointerDown={(e) => {
              if (editMode !== 'pen') return;
              e.stopPropagation();
              e.preventDefault();
              const p = canvasPoint(e);
              if (!p) return;
              drawingRef.current = true;
              lastPointRef.current = p;
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!drawingRef.current) return;
              const p = canvasPoint(e);
              const last = lastPointRef.current;
              if (!p || !last) return;
              stroke(last, p);
              lastPointRef.current = p;
            }}
            onPointerUp={finishStroke}
            onPointerCancel={finishStroke}
          />
          <textarea
            ref={editorRef}
            className={`${styles.editor}${editMode === 'pen' ? ` ${styles.editorIdle}` : ''}`}
            value={note.text}
            placeholder="내용을 입력하세요"
            spellCheck={false}
            readOnly={editMode !== 'text'}
            onChange={(e) => onTextChange(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
      </div>

      {selected && editMode === 'pen' ? (
        <div className={styles.penColors}>
          {PEN_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`${styles.swatch}${penColor === c ? ` ${styles.swatchActive}` : ''}`}
              style={{ background: c }}
              aria-label={`펜 색 ${c}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onPenColor(c)}
            />
          ))}
        </div>
      ) : null}

      {selected ? (
        <div
          className={styles.handle}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onResizePointerDown(e);
          }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      ) : null}
    </div>
  );
}
