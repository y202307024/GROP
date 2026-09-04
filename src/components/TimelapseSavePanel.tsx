export type TimelapseSave = {
  id: string;
  board_id: string;
  title: string;
  max_seq: number;
  event_count: number;
  start_ts: string | null;
  end_ts: string | null;
  created_at: string;
};

import tbtn from './timelapseButton.module.css';
import s from './TimelapseSavePanel.module.css';

type BoardOption = { id: string; title: string; created_at: string };

type Props = {
  boardId: string;
  boards: BoardOption[];
  isLoadingBoards: boolean;
  onBoardChange: (boardId: string) => void;
  getBoardOptionLabel: (board: BoardOption) => string;
  saves: TimelapseSave[];
  isLoading: boolean;
  isSaving: boolean;
  draftTitle: string;
  onDraftTitleChange: (value: string) => void;
  onSave: () => void;
  onLoad: (save: TimelapseSave) => void;
  onPlay: (save: TimelapseSave) => void;
  onDelete: (save: TimelapseSave) => void;
};

function formatRange(startTs: string | null, endTs: string | null) {
  if (!startTs || !endTs) return '-';
  return `${new Date(startTs).toLocaleString()} → ${new Date(endTs).toLocaleString()}`;
}

export default function TimelapseSavePanel({
  boardId,
  boards,
  isLoadingBoards,
  onBoardChange,
  getBoardOptionLabel,
  saves,
  isLoading,
  isSaving,
  draftTitle,
  onDraftTitleChange,
  onSave,
  onLoad,
  onPlay,
  onDelete,
}: Props) {
  return (
    <div className={s.panel}>
      <div className={s.head}>
        <div>
          <div className={s.title}>타임랩스 카테고리</div>
          <div className={s.boardPicker}>
            <label htmlFor="timelapse-board">보드 선택</label>
            <select
              id="timelapse-board"
              value={boardId}
              onChange={(e) => onBoardChange(e.target.value)}
              disabled={isLoadingBoards}
            >
              <option value="">선택…</option>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {getBoardOptionLabel(b)}
                </option>
              ))}
            </select>
          </div>
          {boardId ? (
            <div className={s.sub}>
              저장된 카테고리 {saves.length}개
            </div>
          ) : (
            <div className={s.sub}>보드를 선택하면 이 보드 전용 타임랩스를 저장할 수 있어요.</div>
          )}
        </div>

        <div className={s.actions}>
          <input
            className={s.input}
            value={draftTitle}
            onChange={(e) => onDraftTitleChange(e.target.value)}
            placeholder="카테고리 이름 (예: 1차 시안, 오후 세션)"
            disabled={!boardId || isSaving}
          />
          <button type="button" className={s.saveBtn} onClick={onSave} disabled={!boardId || isSaving}>
            {isSaving ? '저장 중…' : '현재 기록 저장'}
          </button>
        </div>
      </div>

      {!boardId ? (
        <div className={s.hint}>위에서 보드를 선택하거나 캔버스에서 새 보드를 만든 뒤 저장하세요.</div>
      ) : isLoading ? (
        <div className={s.hint}>카테고리 불러오는 중…</div>
      ) : saves.length === 0 ? (
        <div className={s.hint}>아직 저장된 타임랩스가 없어요. 캔버스에서 그린 뒤 「현재 기록 저장」을 눌러 보세요.</div>
      ) : (
        <div className={s.list}>
          {saves.map((save) => (
            <div key={save.id} className={s.item}>
              <div className={s.itemBody}>
                <div className={s.itemTitle}>{save.title}</div>
                <div className={s.itemMeta}>
                  이벤트 {save.event_count}개 · 저장 {new Date(save.created_at).toLocaleString()}
                </div>
                <div className={s.itemRange}>{formatRange(save.start_ts, save.end_ts)}</div>
              </div>
              <div className={s.itemBtns}>
                <button type="button" className={tbtn.btn} onClick={() => onLoad(save)}>
                  불러오기
                </button>
                <button type="button" className={`${tbtn.btn} ${tbtn.primary}`} onClick={() => onPlay(save)}>
                  재생
                </button>
                <button type="button" className={`${tbtn.btn} ${tbtn.danger}`} onClick={() => onDelete(save)}>
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
