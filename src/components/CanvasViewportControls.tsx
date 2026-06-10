type Props = {
  zoomPercent: number;
  canUndo: boolean;
  canRedo: boolean;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onUndo: () => void;
  onRedo: () => void;
};

export default function CanvasViewportControls({
  zoomPercent,
  canUndo,
  canRedo,
  onZoomOut,
  onZoomIn,
  onUndo,
  onRedo,
}: Props) {
  return (
    <div className="canvas-viewport-controls">
      <div className="canvas-viewport-group">
        <button type="button" className="canvas-viewport-btn" onClick={onZoomOut} title="축소" aria-label="축소">
          −
        </button>
        <span className="canvas-viewport-zoom">{zoomPercent}%</span>
        <button type="button" className="canvas-viewport-btn" onClick={onZoomIn} title="확대" aria-label="확대">
          +
        </button>
      </div>
      <div className="canvas-viewport-group">
        <button
          type="button"
          className="canvas-viewport-btn canvas-viewport-icon"
          onClick={onUndo}
          disabled={!canUndo}
          title="실행 취소"
          aria-label="실행 취소"
        >
          ↶
        </button>
        <button
          type="button"
          className="canvas-viewport-btn canvas-viewport-icon"
          onClick={onRedo}
          disabled={!canRedo}
          title="다시 실행"
          aria-label="다시 실행"
        >
          ↷
        </button>
      </div>
    </div>
  );
}
