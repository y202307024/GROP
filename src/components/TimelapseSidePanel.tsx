import s from './TimelapseSidePanel.module.css';
type ReplaySession = {
  total: number;
  index: number;
  startTs?: string;
  endTs?: string;
  durationMs: number;
};

type Props = {
  boardId: string;
  isLoadingBoard: boolean;
  isReplaying: boolean;
  replaySpeed: number;
  compressGaps: boolean;
  maxGapMs: number;
  replaySession: ReplaySession | null;
  onResync: () => void;
  onReplaySpeedChange: (value: number) => void;
  onCompressGapsChange: (value: boolean) => void;
  onMaxGapMsChange: (value: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onLoad: () => void;
  onSeek: (index: number) => void;
  saveDraftTitle: string;
  isSaving: boolean;
  onSaveDraftTitleChange: (value: string) => void;
  onSave: () => void;
};

export default function TimelapseSidePanel({
  boardId,
  isLoadingBoard,
  isReplaying,
  replaySpeed,
  compressGaps,
  maxGapMs,
  replaySession,
  onResync,
  onReplaySpeedChange,
  onCompressGapsChange,
  onMaxGapMsChange,
  onPlay,
  onPause,
  onLoad,
  onSeek,
  saveDraftTitle,
  isSaving,
  onSaveDraftTitleChange,
  onSave,
}: Props) {
  return (
    <aside className={s.panel}>
      <div className={s.head}>
        <div className={s.title}>타임랩스</div>
      </div>

      <div className={s.section}>
        <div className={s.label}>보드</div>
        {boardId ? (
          <code className={s.boardId}>{boardId}</code>
        ) : (
          <div className={s.hint}>보드를 선택해 주세요</div>
        )}
        {isLoadingBoard ? <div className={s.hint}>로딩 중…</div> : null}
      </div>

      <div className={s.section}>
        <button type="button" className={`${s.btn} ${s.btnOutline}`} onClick={onResync} disabled={!boardId}>
          재동기화
        </button>
        <button type="button" className={`${s.btn} ${s.btnOutline}`} onClick={onLoad} disabled={!boardId}>
          타임랩스 불러오기
        </button>
      </div>

      <div className={s.section}>
        <div className={s.label}>저장</div>
        <input
          className={s.input}
          value={saveDraftTitle}
          onChange={(e) => onSaveDraftTitleChange(e.target.value)}
          placeholder="카테고리 이름 (예: 1차 시안)"
          disabled={!boardId || isSaving}
        />
        <button
          type="button"
          className={`${s.btn} ${s.btnSave}`}
          onClick={onSave}
          disabled={!boardId || isSaving}
        >
          {isSaving ? '저장 중…' : '타임랩스 저장'}
        </button>
      </div>

      <div className={s.section}>
        <label className={s.field}>
          <span>재생 속도</span>
          <div className={s.rangeRow}>
            <input type="range" min={1} max={50} value={replaySpeed} onChange={(e) => onReplaySpeedChange(Number(e.target.value))} />
            <span>{replaySpeed}x</span>
          </div>
        </label>

        <label className={s.check}>
          <input type="checkbox" checked={compressGaps} onChange={(e) => onCompressGapsChange(e.target.checked)} />
          <span>공백 압축</span>
        </label>

        <label className={`${s.field} ${compressGaps ? '' : s.isDisabled}`}>
          <span>최대 공백</span>
          <div className={s.rangeRow}>
            <input
              type="range"
              min={0}
              max={2000}
              step={50}
              value={maxGapMs}
              disabled={!compressGaps}
              onChange={(e) => onMaxGapMsChange(Number(e.target.value))}
            />
            <span>{maxGapMs}ms</span>
          </div>
        </label>
      </div>

      <div className={`${s.section} ${s.playRow}`}>
        <button
          type="button"
          className={`${s.btn} ${s.btnPlay}`}
          onClick={onPlay}
          disabled={isReplaying || !boardId}
        >
          {isReplaying ? '재생 중' : '타임랩스 재생'}
        </button>
        <button type="button" className={`${s.btn} ${s.btnOutline}`} onClick={onPause} disabled={!isReplaying}>
          일시정지
        </button>
      </div>

      {replaySession ? (
        <div className={`${s.section} ${s.timeline}`}>
          <div className={s.label}>타임라인</div>
          <div className={s.meta}>
            {replaySession.startTs ? new Date(replaySession.startTs).toLocaleString() : '-'} →{' '}
            {replaySession.endTs ? new Date(replaySession.endTs).toLocaleString() : '-'}
          </div>
          <div className={s.meta}>
            진행 {replaySession.index}/{replaySession.total} (
            {replaySession.total ? Math.min(100, Math.floor((replaySession.index / replaySession.total) * 100)) : 0}%)
            {isReplaying ? ' · 재생 중' : ' · 정지'}
          </div>
          <input
            type="range"
            min={0}
            max={replaySession.total}
            step={1}
            value={replaySession.index}
            onChange={(e) => onSeek(Number(e.target.value))}
            className={s.seek}
          />
        </div>
      ) : null}
    </aside>
  );
}
