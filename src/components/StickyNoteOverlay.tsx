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
  /** 이 메모를 연 사람. 있으면 그 사람만 글을 고칩니다. */
  authorId?: string;
};

function spineHoles(height: number) {
  const holes: number[] = [];
  for (let top = 16; top < height - 50; top += 34) holes.push(top);
  return holes;
}

type Props = {
  note: PlacedSticky;
  selected: boolean;
  /** 연 사람만 true. 다른 사람은 글은 보이지만 고치지 못합니다. */
  canEdit?: boolean;
  /** 아직 보드에 붙기 전 작성 창. 고정을 눌러야 붙습니다. */
  draft?: boolean;
  /** 화면 가운데에 띄울 때 보드 좌표를 쓰지 않습니다. */
  floating?: boolean;
  /** 지우개 등에서 클릭을 캔버스로 통과시킵니다 */
  passThrough?: boolean;
  onSelect: () => void;
  onTextChange: (text: string) => void;
  /** 작성 창의 고정. 지금 글을 화이트보드에 붙입니다. */
  onPin?: () => void;
  onRemove: () => void;
  /** 제목줄을 잡아 옮길 때. 캡처는 호출 쪽에서 합니다. */
  onMovePointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onResizePointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
};

/**
 * 회의 보드 위 메모장.
 * 글은 메모를 연 사람만 고치고, 작성 창은 고정을 눌러야 보드에 붙습니다.
 */
export default function StickyNoteOverlay({
  note,
  selected,
  canEdit = true,
  draft = false,
  floating = false,
  passThrough = false,
  onSelect,
  onTextChange,
  onPin,
  onRemove,
  onMovePointerDown,
  onResizePointerDown,
  onPointerMove,
  onPointerUp,
}: Props) {
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!canEdit || (!selected && !draft)) return;
    const id = window.setTimeout(() => editorRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [canEdit, selected, draft, note.id]);

  return (
    <div
      className={`${styles.note}${selected ? ` ${styles.noteSelected}` : ''}${floating ? ` ${styles.noteFloating}` : ''}`}
      style={{
        left: floating ? undefined : note.x,
        top: floating ? undefined : note.y,
        width: note.width,
        height: note.height,
        // 툴바에서 고른 종이색을 카드 전체에 반영합니다.
        backgroundColor: note.color || '#fffef8',
        pointerEvents: passThrough ? 'none' : 'auto',
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
        <span className={styles.spacer} />
        {draft ? (
          <button
            type="button"
            className={styles.removeBtn}
            title="고정"
            aria-label="고정"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onPin?.()}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M9 4h6l-1 6 3 3H7l3-3-1-6Z" />
              <path d="M12 13v7" />
            </svg>
          </button>
        ) : null}
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
        <div className={styles.body} style={{ backgroundColor: note.color || '#fffef8' }}>
          <textarea
            ref={editorRef}
            className={styles.editor}
            data-board-text-editor="true"
            value={note.text}
            placeholder={canEdit ? '내용을 입력하세요' : ''}
            spellCheck={false}
            readOnly={!canEdit}
            onChange={(e) => {
              if (!canEdit) return;
              onTextChange(e.target.value);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
      </div>

      {selected && !draft ? (
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
