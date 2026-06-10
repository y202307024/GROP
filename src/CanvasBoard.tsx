import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './services/supabaseClient';
import ExcalidrawToolbar, { toolShortcutMap, type ExcalidrawTool } from './components/ExcalidrawToolbar';
// import TimelapseSidePanel from './components/TimelapseSidePanel';
import CanvasViewportControls from './components/CanvasViewportControls';
import { drawShapeTool, drawStamp, drawText, type ShapeTool } from './canvasShapeUtils';
import { explainBoardError } from './boardErrors';
import { dedupeBoardsById, getBoardOptionLabel } from './timelapseApi';
// import './components/TimelapseSidePanel.css';
import './components/CanvasViewportControls.css';

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
const DEFAULT_ZOOM_INDEX = 3;
const MAX_HISTORY = 50;
const STROKE_CHUNK_MS = 40;
const MIN_EVENT_GAP_MS = 1;

type Tool = ExcalidrawTool;

const GROUP_BOARD_TITLE_PREFIX = '__group__:';

type Props = {
  onBack?: () => void;
  embedded?: boolean;
  groupId?: string;
  groupName?: string;
  initialBoardId?: string;
  initialTimelapseSaveId?: string;
  autoPlayTimelapse?: boolean;
};

type Point = { x: number; y: number };

type Board = { id: string; title: string; created_at: string };

type StrokeTool = 'pen' | 'eraser';
type EventType =
  | 'stroke.begin'
  | 'stroke.append'
  | 'stroke.end'
  | 'board.clear'
  | 'shape.add'
  | 'image.add'
  | 'text.add'
  | 'stamp.add';

const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

type BoardEventRow = {
  id: string;
  board_id: string;
  seq: number;
  ts: string;
  actor_id: string;
  type: EventType;
  payload: unknown;
};

type StrokeBeginPayload = {
  strokeId: string;
  tool: StrokeTool;
  color: string;
  size: number;
  point: Point;
};

type StrokeAppendPayload = {
  strokeId: string;
  points: Point[];
};

type StrokeEndPayload = {
  strokeId: string;
};

type ShapeAddPayload = {
  tool: ShapeTool;
  from: Point;
  to: Point;
  color: string;
  size: number;
};

type ImageAddPayload = {
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl: string;
};

type TextAddPayload = {
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
};

type StampAddPayload = {
  x: number;
  y: number;
  kind: 'rect' | 'circle' | 'triangle';
  color: string;
  size: number;
};

function isHistoryCommitEvent(type: EventType): boolean {
  return (
    type === 'stroke.end' ||
    type === 'shape.add' ||
    type === 'image.add' ||
    type === 'text.add' ||
    type === 'stamp.add' ||
    type === 'board.clear'
  );
}

export default function CanvasBoard({
  onBack,
  embedded = false,
  groupId,
  groupName,
  initialBoardId,
  initialTimelapseSaveId,
  autoPlayTimelapse = false,
}: Props) {
  const isGroupCanvas = Boolean(groupId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasAreaRef = useRef<HTMLDivElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);
  const localStrokeIdRef = useRef<string | null>(null);
  const pendingChunkRef = useRef<Point[]>([]);
  const chunkTimerRef = useRef<number | null>(null);
  const remoteLastPointByStrokeRef = useRef<Map<string, Point>>(new Map());
  const replayTimerRef = useRef<number | null>(null);
  const isReplayingRef = useRef(false);
  const strokeStyleByIdRef = useRef<Map<string, { tool: StrokeTool; color: string; size: number }>>(new Map());
  const replayRafRef = useRef<number | null>(null);
  const lastReplayUiUpdateMsRef = useRef<number>(0);
  const replayEventsRef = useRef<BoardEventRow[]>([]);
  const replayAdjustedMsRef = useRef<number[]>([]);
  const replayIndexRef = useRef(0);
  const replayBoardIdRef = useRef<string>('');
  const shapeStartRef = useRef<Point | null>(null);
  const snapshotRef = useRef<ImageData | null>(null);
  const panningRef = useRef(false);
  const panAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const pendingImagePointRef = useRef<Point | null>(null);
  const pendingStampRef = useRef<'rect' | 'circle' | 'triangle' | null>(null);
  const actorIdRef = useRef('unknown');
  const lastInsertErrorAlertMsRef = useRef(0);
  const deepLinkHandledRef = useRef(false);
  const historyRef = useRef<ImageData[]>([]);
  const historyIndexRef = useRef(-1);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const lastSavedTitleRef = useRef<Record<string, string>>({});
  const replaySpeedRef = useRef(10);
  const compressGapsRef = useRef(true);
  const maxGapMsRef = useRef(200);
  const replayLastTickMsRef = useRef(0);
  const replayLastVirtualMsRef = useRef(0);
  const replayClockRef = useRef({ anchorVirtualMs: 0, anchorWallMs: 0, speed: 10 });

  const [tool, setTool] = useState<Tool>('pen');
  const [locked, setLocked] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [pendingStampKind, setPendingStampKind] = useState<'rect' | 'circle' | 'triangle' | null>(null);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const [color, setColor] = useState('#111827');
  const [size, setSize] = useState(6);

  const [actorId, setActorId] = useState<string>('unknown');

  useEffect(() => {
    actorIdRef.current = actorId;
  }, [actorId]);

  const [boards, setBoards] = useState<Board[]>([]);
  const [boardId, setBoardId] = useState<string>(initialBoardId ?? '');
  const [boardTitle, setBoardTitle] = useState<string>('새 보드');
  const [isLoadingBoards, setIsLoadingBoards] = useState(false);
  const [, setIsLoadingBoard] = useState(false);

  const [, setIsReplaying] = useState(false);
  const [replaySpeed] = useState(10);
  const [compressGaps] = useState(true);
  const [maxGapMs] = useState(200);
  // const [timelapseSaveDraft, setTimelapseSaveDraft] = useState('');
  // const [isSavingTimelapse, setIsSavingTimelapse] = useState(false);
  const [replaySession, setReplaySession] = useState<{
    total: number;
    index: number;
    startTs?: string;
    endTs?: string;
    durationMs: number;
  } | null>(null);

  const effectiveStrokeStyle = useMemo(() => {
    return tool === 'eraser' ? '#ffffff' : color;
  }, [tool, color]);

  const activeTool = spacePressed ? 'hand' : tool;
  const zoomScale = ZOOM_STEPS[zoomIndex];
  const zoomPercent = Math.round(zoomScale * 100);
  const isShapeTool = (t: Tool): t is ShapeTool =>
    t === 'rectangle' || t === 'diamond' || t === 'ellipse' || t === 'arrow' || t === 'line';

  const pickTool = (next: ExcalidrawTool) => {
    if (next !== 'hand' && tool === 'hand') {
      setPanOffset({ x: 0, y: 0 });
    }
    setTool(next);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setSpacePressed(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoHistory();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redoHistory();
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const mapped = toolShortcutMap[e.key];
      if (mapped) pickTool(mapped);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePressed(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const ensureContext = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctxRef.current = ctx;
    return ctx;
  };

  const resizeCanvasIfNeeded = () => {
    const canvas = canvasRef.current;
    const area = canvasAreaRef.current;
    if (!canvas || !area) return;

    const rect = area.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const nextWidth = Math.max(1, Math.floor(rect.width));
    const nextHeight = Math.max(1, Math.floor(rect.height));

    const wantW = Math.floor(nextWidth * dpr);
    const wantH = Math.floor(nextHeight * dpr);

    if (canvas.width === wantW && canvas.height === wantH) return;

    // Preserve drawing on resize
    const prev = document.createElement('canvas');
    prev.width = canvas.width;
    prev.height = canvas.height;
    const prevCtx = prev.getContext('2d');
    if (prevCtx) prevCtx.drawImage(canvas, 0, 0);

    canvas.width = wantW;
    canvas.height = wantH;
    canvas.style.width = `${nextWidth}px`;
    canvas.style.height = `${nextHeight}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctxRef.current = ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    // White background (so eraser works & export isn't transparent)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, nextWidth, nextHeight);

    // Draw previous content back (best-effort)
    if (prev.width > 0 && prev.height > 0) {
      const prevCssW = prev.width / dpr;
      const prevCssH = prev.height / dpr;
      ctx.drawImage(prev, 0, 0, prev.width, prev.height, 0, 0, prevCssW, prevCssH);
    }

    initHistory();
  };

  const captureCanvasState = (): ImageData | null => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current ?? ensureContext();
    if (!canvas || !ctx || canvas.width === 0 || canvas.height === 0) return null;
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  };

  const applyCanvasState = (data: ImageData) => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current ?? ensureContext();
    if (!canvas || !ctx) return;
    ctx.putImageData(data, 0, 0);
  };

  const syncHistoryUi = () => {
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(historyIndexRef.current >= 0 && historyIndexRef.current < historyRef.current.length - 1);
  };

  const resetHistory = () => {
    historyRef.current = [];
    historyIndexRef.current = -1;
    syncHistoryUi();
  };

  const initHistory = () => {
    const snap = captureCanvasState();
    if (!snap) {
      resetHistory();
      return;
    }
    historyRef.current = [snap];
    historyIndexRef.current = 0;
    syncHistoryUi();
  };

  const commitHistory = () => {
    const snap = captureCanvasState();
    if (!snap) return;

    const idx = historyIndexRef.current;
    if (idx >= 0) {
      historyRef.current = historyRef.current.slice(0, idx + 1);
    }

    historyRef.current.push(snap);
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift();
    } else {
      historyIndexRef.current += 1;
    }
    syncHistoryUi();
  };

  const undoHistory = () => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    const state = historyRef.current[historyIndexRef.current];
    if (state) applyCanvasState(state);
    syncHistoryUi();
  };

  const redoHistory = () => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    const state = historyRef.current[historyIndexRef.current];
    if (state) applyCanvasState(state);
    syncHistoryUi();
  };

  const zoomOut = () => {
    setZoomIndex((i) => Math.max(0, i - 1));
  };

  const zoomIn = () => {
    setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1));
  };

  useEffect(() => {
    const runResize = () => {
      requestAnimationFrame(() => resizeCanvasIfNeeded());
    };

    runResize();

    const onResize = () => runResize();
    window.addEventListener('resize', onResize);

    const area = canvasAreaRef.current;
    const observer = area ? new ResizeObserver(() => runResize()) : null;
    if (area && observer) observer.observe(area);

    return () => {
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => resizeCanvasIfNeeded());
  }, [replaySession]);

  useEffect(() => {
    // actorId: 로그인 유저가 있으면 user.id, 없으면 브라우저 세션 id
    let isMounted = true;
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!isMounted) return;
        const uid = data.user?.id;
        if (uid) {
          setActorId(uid);
          return;
        }
        const key = 'wb_actor_id';
        const existing = localStorage.getItem(key);
        if (existing) {
          setActorId(existing);
        } else {
          const rnd = crypto.randomUUID();
          localStorage.setItem(key, rnd);
          setActorId(rnd);
        }
      })
      .catch(() => {
        // ignore
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const formatBoardTitle = (title: string) => {
    if (title.startsWith(GROUP_BOARD_TITLE_PREFIX)) {
      return `${groupName || '그룹'} 캔버스`;
    }
    return title;
  };

  const fetchGroupBoards = async (targetGroupId: string): Promise<Board[]> => {
    const { data: byGroupId, error: groupColError } = await supabase
      .from('boards')
      .select('id,title,created_at')
      .eq('group_id', targetGroupId)
      .order('created_at', { ascending: false });

    if (!groupColError && byGroupId?.length) {
      return byGroupId as Board[];
    }

    const { data: byTitle } = await supabase
      .from('boards')
      .select('id,title,created_at')
      .eq('title', `${GROUP_BOARD_TITLE_PREFIX}${targetGroupId}`)
      .order('created_at', { ascending: false });

    return (byTitle as Board[] | null) ?? [];
  };

  const loadGroupBoards = async () => {
    if (!groupId) return;

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      alert('보드를 사용하려면 로그인이 필요합니다.');
      return;
    }

    setIsLoadingBoards(true);
    let list = await fetchGroupBoards(groupId);

    if (list.length === 0) {
      const defaultTitle = `${groupName || '그룹'} 캔버스`;
      const insertPayload: { title: string; group_id?: string } = {
        title: defaultTitle,
        group_id: groupId,
      };
      let { data, error } = await supabase
        .from('boards')
        .insert(insertPayload)
        .select('id,title,created_at')
        .single();

      if (error?.message?.includes('group_id')) {
        ({ data, error } = await supabase
          .from('boards')
          .insert({ title: `${GROUP_BOARD_TITLE_PREFIX}${groupId}` })
          .select('id,title,created_at')
          .single());
      }

      if (error || !data) {
        setIsLoadingBoards(false);
        alert(`그룹 캔버스 생성 실패: ${explainBoardError(error?.message ?? 'unknown')}`);
        return;
      }
      list = [data as Board];
    }

    const deduped = dedupeBoardsById(list);
    setBoards(deduped);
    const preferredId = boardId || initialBoardId;
    const selected = deduped.find((b) => b.id === preferredId) ?? deduped[0];
    if (selected) {
      const title = formatBoardTitle(selected.title);
      setBoardId(selected.id);
      setBoardTitle(title);
      lastSavedTitleRef.current[selected.id] = title;
    }
    setIsLoadingBoards(false);
  };

  const loadBoards = async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      alert('보드 목록을 불러오려면 로그인이 필요합니다.');
      return;
    }

    setIsLoadingBoards(true);
    const { data, error } = await supabase.from('boards').select('id,title,created_at').order('created_at', { ascending: false });
    setIsLoadingBoards(false);
    if (error) {
      console.error('loadBoards error:', error);
      alert(`보드 목록 로드 실패: ${explainBoardError(error.message)}`);
      return;
    }
    const list = dedupeBoardsById((data ?? []) as Board[]);
    setBoards(list);
    const preferredId = boardId || initialBoardId;
    if (preferredId) {
      const selected = list.find((b) => b.id === preferredId);
      if (selected) {
        setBoardId(selected.id);
        setBoardTitle(selected.title);
      }
    }
  };

  useEffect(() => {
    if (isGroupCanvas) {
      void loadGroupBoards();
    } else {
      loadBoards();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, groupName]);

  const createBoard = async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      alert('보드를 만들려면 로그인이 필요합니다.\n메인에서 로그인한 뒤 캔버스로 다시 들어와 주세요.');
      return;
    }

    const title = boardTitle.trim() || (isGroupCanvas ? `${groupName || '그룹'} 보드` : '새 보드');
    const insertPayload: { title: string; group_id?: string } = { title };
    if (isGroupCanvas && groupId) insertPayload.group_id = groupId;

    let { data, error } = await supabase.from('boards').insert(insertPayload).select('id,title,created_at').single();
    if (error?.message?.includes('group_id') && isGroupCanvas && groupId) {
      ({ data, error } = await supabase
        .from('boards')
        .insert({ title: `${GROUP_BOARD_TITLE_PREFIX}${groupId}-${Date.now()}` })
        .select('id,title,created_at')
        .single());
    }

    if (error) {
      alert(`보드 생성 실패: ${explainBoardError(error.message)}`);
      return;
    }
    const b = data as Board;
    const savedTitle = formatBoardTitle(b.title);
    setBoards((prev) => [b, ...prev]);
    setBoardId(b.id);
    setBoardTitle(savedTitle);
    lastSavedTitleRef.current[b.id] = savedTitle;
  };

  const saveBoardTitle = async () => {
    if (!boardId) return;
    const title = boardTitle.trim() || '새 보드';
    if (lastSavedTitleRef.current[boardId] === title) return;

    const { error } = await supabase.from('boards').update({ title }).eq('id', boardId);
    if (error) {
      alert(`보드 이름 저장 실패: ${explainBoardError(error.message)}`);
      return;
    }
    lastSavedTitleRef.current[boardId] = title;
    setBoards((prev) => prev.map((b) => (b.id === boardId ? { ...b, title } : b)));
  };

  const refreshBoards = () => {
    if (isGroupCanvas) void loadGroupBoards();
    else void loadBoards();
  };

  const applyStrokeSegment = (p1: Point, p2: Point, strokeTool: StrokeTool, strokeColor: string, strokeSize: number) => {
    const ctx = ctxRef.current ?? ensureContext();
    if (!ctx) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = strokeTool === 'eraser' ? '#ffffff' : strokeColor;
    ctx.lineWidth = strokeSize;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  };

  const clearAllLocal = () => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current ?? ensureContext();
    if (!canvas || !ctx) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  };

  const loadCachedImage = (dataUrl: string): Promise<HTMLImageElement> => {
    const cached = imageCacheRef.current.get(dataUrl);
    if (cached) return Promise.resolve(cached);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        imageCacheRef.current.set(dataUrl, img);
        resolve(img);
      };
      img.onerror = () => reject(new Error('이미지 로드 실패'));
      img.src = dataUrl;
    });
  };

  const drawImagePayload = async (ctx: CanvasRenderingContext2D, payload: ImageAddPayload) => {
    const img = await loadCachedImage(payload.dataUrl);
    ctx.drawImage(img, payload.x, payload.y, payload.width, payload.height);
  };

  const reportInsertError = (message: string) => {
    console.warn('board_events insert failed:', message);
    const now = Date.now();
    if (now - lastInsertErrorAlertMsRef.current < 8000) return;
    lastInsertErrorAlertMsRef.current = now;
    alert(
      `이벤트 저장 실패: ${message}\n\n그림은 이 기기에서 계속 그릴 수 있어요. 로그인 상태와 Supabase RLS(board_events, board_seq) 설정을 확인해 주세요.`,
    );
  };

  const insertEvent = async (type: EventType, payload: unknown) => {
    if (!boardId) return;
    const { error } = await supabase.from('board_events').insert({
      board_id: boardId,
      actor_id: actorIdRef.current,
      type,
      payload,
    });
    if (error) reportInsertError(error.message);
  };

  const flushChunk = async () => {
    if (!localStrokeIdRef.current) return;
    const points = pendingChunkRef.current;
    if (points.length === 0) return;
    pendingChunkRef.current = [];
    await insertEvent('stroke.append', { strokeId: localStrokeIdRef.current, points } satisfies StrokeAppendPayload);
  };

  const scheduleChunkFlush = () => {
    if (chunkTimerRef.current != null) return;
    chunkTimerRef.current = window.setTimeout(async () => {
      chunkTimerRef.current = null;
      await flushChunk();
    }, 40);
  };

  const stopReplay = () => {
    if (replayTimerRef.current != null) {
      window.clearTimeout(replayTimerRef.current);
      replayTimerRef.current = null;
    }
    if (replayRafRef.current != null) {
      cancelAnimationFrame(replayRafRef.current);
      replayRafRef.current = null;
    }
    isReplayingRef.current = false;
    setIsReplaying(false);
  };

  const getReplayVirtualMs = () => {
    const clock = replayClockRef.current;
    return clock.anchorVirtualMs + (performance.now() - clock.anchorWallMs) * clock.speed;
  };

  const armReplayClock = (virtualMs: number) => {
    replayClockRef.current = {
      anchorVirtualMs: virtualMs,
      anchorWallMs: performance.now(),
      speed: replaySpeedRef.current,
    };
    replayLastVirtualMsRef.current = virtualMs;
    replayLastTickMsRef.current = performance.now();
  };

  const buildAdjustedMs = (events: BoardEventRow[]) => {
    const adjustedMs: number[] = new Array(events.length);
    adjustedMs[0] = 0;
    const gapCompress = compressGapsRef.current;
    const gapMax = maxGapMsRef.current;

    for (let k = 1; k < events.length; k += 1) {
      const prev = new Date(events[k - 1].ts).getTime();
      const cur = new Date(events[k].ts).getTime();
      let delta = Math.max(0, cur - prev);

      // DB 타임스탬프가 같으면 delta=0 → 한 프레임에 몰림. stroke 간격을 추정해 보정.
      if (delta === 0) {
        const type = events[k].type;
        if (type === 'stroke.append' || type === 'stroke.end') {
          delta = STROKE_CHUNK_MS;
        } else {
          delta = MIN_EVENT_GAP_MS;
        }
      }

      if (gapCompress) delta = Math.min(delta, Math.max(0, gapMax));
      adjustedMs[k] = adjustedMs[k - 1] + delta;
    }
    return adjustedMs;
  };

  const primeEventStyle = (ev: BoardEventRow) => {
    if (ev.type !== 'stroke.begin') return;
    const p = ev.payload as StrokeBeginPayload;
    strokeStyleByIdRef.current.set(p.strokeId, { tool: p.tool, color: p.color, size: p.size });
  };

  const clearReplaySession = () => {
    stopReplay();
    replayEventsRef.current = [];
    replayAdjustedMsRef.current = [];
    replayIndexRef.current = 0;
    replayBoardIdRef.current = '';
    setReplaySession(null);
  };

  const prepareReplaySession = async (targetBoardId: string, maxSeq?: number) => {
    let query = supabase
      .from('board_events')
      .select('id,board_id,seq,ts,actor_id,type,payload')
      .eq('board_id', targetBoardId)
      .order('seq', { ascending: true });

    if (maxSeq != null) {
      query = query.lte('seq', maxSeq);
    }

    const { data, error } = await query;

    if (error) {
      alert(`타임랩스 로드 실패: ${error.message}`);
      return false;
    }

    const events = (data ?? []) as BoardEventRow[];
    if (events.length === 0) {
      alert(maxSeq != null ? '저장된 카테고리에 재생할 기록이 없어요.' : '이 보드에는 아직 기록(이벤트)이 없어요. 먼저 한 번 그려보세요.');
      return false;
    }

    const adjustedMs = buildAdjustedMs(events);
    replayEventsRef.current = events;
    replayAdjustedMsRef.current = adjustedMs;
    replayIndexRef.current = 0;
    replayBoardIdRef.current = targetBoardId;

    setReplaySession({
      total: events.length,
      index: 0,
      startTs: events[0].ts,
      endTs: events[events.length - 1].ts,
      durationMs: adjustedMs[adjustedMs.length - 1] ?? 0,
    });

    clearAllLocal();
    remoteLastPointByStrokeRef.current = new Map();
    strokeStyleByIdRef.current = new Map();
    return true;
  };

  /* const handleTimelapsePlay = async () => {
    if (!boardId) return;
    if (replayBoardIdRef.current !== boardId || replayEventsRef.current.length === 0) {
      const ok = await prepareReplaySession(boardId);
      if (!ok) return;
    } else {
      replayAdjustedMsRef.current = buildAdjustedMs(replayEventsRef.current);
      setReplaySession((prev) =>
        prev
          ? {
              ...prev,
              durationMs: replayAdjustedMsRef.current[replayAdjustedMsRef.current.length - 1] ?? 0,
            }
          : prev,
      );
    }

    if (replayIndexRef.current >= replayEventsRef.current.length) {
      seekReplay(0);
    }
    startReplay();
  };

  const handleTimelapseLoad = async () => {
    if (!boardId) return;
    const ok = await prepareReplaySession(boardId);
    if (ok) seekReplay(0);
  };

  const handleSaveTimelapse = async () => {
    if (!boardId) return;

    const title = timelapseSaveDraft.trim() || window.prompt('타임랩스 카테고리 이름')?.trim();
    if (!title) return;

    setIsSavingTimelapse(true);
    try {
      await saveTimelapseCategory(boardId, title);
      setTimelapseSaveDraft('');
      alert(`「${title}」 타임랩스가 저장됐어요.\n사이드바 「타임랩스」 메뉴에서 확인할 수 있어요.`);
    } catch (e) {
      alert(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setIsSavingTimelapse(false);
    }
  }; */

  const seekReplay = async (index: number) => {
    const events = replayEventsRef.current;
    if (events.length === 0) return;

    stopReplay();
    const clamped = Math.max(0, Math.min(events.length, Math.floor(index)));

    clearAllLocal();
    remoteLastPointByStrokeRef.current = new Map();
    strokeStyleByIdRef.current = new Map();

    for (let k = 0; k < clamped; k += 1) {
      primeEventStyle(events[k]);
      await applyEvent(events[k]);
    }

    replayIndexRef.current = clamped;
    setReplaySession((prev) => (prev ? { ...prev, index: clamped } : prev));
  };

  const startReplay = () => {
    const events = replayEventsRef.current;
    if (events.length === 0) return;

    stopReplay();
    isReplayingRef.current = true;
    setIsReplaying(true);

    let i = replayIndexRef.current;
    const adjustedMs = replayAdjustedMsRef.current;
    armReplayClock(adjustedMs[i] ?? 0);

    const tick = () => {
      if (!isReplayingRef.current) return;
      const now = performance.now();
      const speed = replaySpeedRef.current;
      const timeline = replayAdjustedMsRef.current;
      const virtualMs = getReplayVirtualMs();

      const virtualDelta = Math.max(1, virtualMs - replayLastVirtualMsRef.current);
      replayLastVirtualMsRef.current = virtualMs;
      const maxPerFrame =
        speed <= 1
          ? Math.max(4, Math.ceil(virtualDelta / STROKE_CHUNK_MS) + 2)
          : Math.min(400, Math.max(20, Math.ceil(virtualDelta / 8)));

      let processed = 0;
      while (i < events.length) {
        const at = timeline[i];
        if (at == null || at > virtualMs) break;
        primeEventStyle(events[i]);
        void applyEvent(events[i]);
        i += 1;
        processed += 1;
        if (processed >= maxPerFrame) break;
      }

      replayIndexRef.current = i;

      if (now - lastReplayUiUpdateMsRef.current >= 100) {
        lastReplayUiUpdateMsRef.current = now;
        setReplaySession((prev) => (prev ? { ...prev, index: i } : prev));
      }

      if (i >= events.length) {
        isReplayingRef.current = false;
        setIsReplaying(false);
        replayRafRef.current = null;
        return;
      }

      replayRafRef.current = requestAnimationFrame(tick);
    };

    replayRafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    replaySpeedRef.current = replaySpeed;
    if (!isReplayingRef.current) return;
    armReplayClock(getReplayVirtualMs());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaySpeed]);

  useEffect(() => {
    compressGapsRef.current = compressGaps;
    maxGapMsRef.current = maxGapMs;
    if (!isReplayingRef.current || replayEventsRef.current.length === 0) return;
    const idx = replayIndexRef.current;
    replayAdjustedMsRef.current = buildAdjustedMs(replayEventsRef.current);
    const atMs = replayAdjustedMsRef.current[Math.min(idx, replayAdjustedMsRef.current.length - 1)] ?? 0;
    armReplayClock(atMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compressGaps, maxGapMs]);

  const loadAndRenderBoard = async (targetBoardId: string) => {
    if (!targetBoardId) return;
    clearReplaySession();
    setIsLoadingBoard(true);
    clearAllLocal();
    remoteLastPointByStrokeRef.current = new Map();

    const { data, error } = await supabase
      .from('board_events')
      .select('id,board_id,seq,ts,actor_id,type,payload')
      .eq('board_id', targetBoardId)
      .order('seq', { ascending: true });

    setIsLoadingBoard(false);
    if (error) {
      alert(`보드 로드 실패: ${error.message}`);
      return;
    }
    const events = (data ?? []) as BoardEventRow[];
    resetHistory();
    for (const ev of events) {
      await applyEvent(ev);
      if (isHistoryCommitEvent(ev.type)) commitHistory();
    }
    if (historyRef.current.length === 0) initHistory();
  };

  useEffect(() => {
    if (!boardId) return;
    const b = boards.find((x) => x.id === boardId);
    if (b) {
      const title = formatBoardTitle(b.title);
      setBoardTitle(title);
      lastSavedTitleRef.current[boardId] = title;
    }
    if (!initialTimelapseSaveId) {
      loadAndRenderBoard(boardId);
    }

    const channel = supabase
      .channel(`board-events:${boardId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'board_events', filter: `board_id=eq.${boardId}` },
        (payload) => {
          const row = payload.new as BoardEventRow;
          // 재생 중이면 라이브 반영은 일단 막아(타임라인이 섞이는 것 방지)
          if (isReplayingRef.current) return;
          // 내가 보낸 이벤트는 이미 로컬에서 그렸으므로 중복 적용하지 않음
          if (row.actor_id === actorIdRef.current) return;
          void applyEvent(row).then(() => {
            if (isHistoryCommitEvent(row.type)) commitHistory();
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // isReplaying은 실시간 반영 차단에만 사용. boardId 변경시 재구독 필요
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  useEffect(() => {
    if (deepLinkHandledRef.current || !initialTimelapseSaveId || !boardId) return;
    if (initialBoardId && boardId !== initialBoardId) return;

    deepLinkHandledRef.current = true;
    void (async () => {
      const { data: save, error } = await supabase
        .from('board_timelapse_saves')
        .select('id,board_id,title,max_seq,event_count,start_ts,end_ts,created_at')
        .eq('id', initialTimelapseSaveId)
        .single();

      if (error || !save) {
        void loadAndRenderBoard(boardId);
        return;
      }

      const ok = await prepareReplaySession(save.board_id, save.max_seq);
      if (!ok) {
        void loadAndRenderBoard(boardId);
        return;
      }

      if (autoPlayTimelapse) startReplay();
      else seekReplay(0);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, initialBoardId, initialTimelapseSaveId, autoPlayTimelapse]);

  const applyEvent = async (ev: BoardEventRow) => {
    if (ev.type === 'board.clear') {
      clearAllLocal();
      remoteLastPointByStrokeRef.current = new Map();
      strokeStyleByIdRef.current = new Map();
      return;
    }

    if (ev.type === 'stroke.begin') {
      const p = ev.payload as StrokeBeginPayload;
      remoteLastPointByStrokeRef.current.set(p.strokeId, { x: p.point.x, y: p.point.y });
      strokeStyleByIdRef.current.set(p.strokeId, { tool: p.tool, color: p.color, size: p.size });
      return;
    }

    if (ev.type === 'stroke.append') {
      const p = ev.payload as StrokeAppendPayload;
      const last = remoteLastPointByStrokeRef.current.get(p.strokeId);
      if (!last) return;
      for (const next of p.points) {
        const style = strokeStyleByIdRef.current.get(p.strokeId);
        if (!style) return;
        applyStrokeSegment(last, next, style.tool, style.color, style.size);
        last.x = next.x;
        last.y = next.y;
      }
      return;
    }

    if (ev.type === 'stroke.end') {
      const p = ev.payload as StrokeEndPayload;
      remoteLastPointByStrokeRef.current.delete(p.strokeId);
      strokeStyleByIdRef.current.delete(p.strokeId);
      return;
    }

    if (ev.type === 'shape.add') {
      const p = ev.payload as ShapeAddPayload;
      const ctx = ctxRef.current ?? ensureContext();
      if (!ctx) return;
      drawShapeTool(ctx, p.tool, p.from, p.to, { strokeStyle: p.color, lineWidth: p.size }, false);
      return;
    }

    if (ev.type === 'image.add') {
      const p = ev.payload as ImageAddPayload;
      const ctx = ctxRef.current ?? ensureContext();
      if (!ctx || !p.dataUrl) return;
      await drawImagePayload(ctx, p);
      return;
    }

    if (ev.type === 'text.add') {
      const p = ev.payload as TextAddPayload;
      const ctx = ctxRef.current ?? ensureContext();
      if (!ctx) return;
      drawText(ctx, { x: p.x, y: p.y }, p.text, { strokeStyle: p.color, lineWidth: p.size });
      return;
    }

    if (ev.type === 'stamp.add') {
      const p = ev.payload as StampAddPayload;
      const ctx = ctxRef.current ?? ensureContext();
      if (!ctx) return;
      drawStamp(ctx, { x: p.x, y: p.y }, p.kind, { strokeStyle: p.color, lineWidth: p.size });
    }
  };

  const getPoint = (e: PointerEvent): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.clientWidth,
      y: ((e.clientY - rect.top) / rect.height) * canvas.clientHeight,
    };
  };

  const getDrawStyle = () => ({ strokeStyle: color, lineWidth: size });

  const takeSnapshot = () => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current ?? ensureContext();
    if (!canvas || !ctx) return;
    snapshotRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
  };

  const restoreSnapshot = () => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current ?? ensureContext();
    if (!canvas || !ctx || !snapshotRef.current) return;
    ctx.putImageData(snapshotRef.current, 0, 0);
  };

  const handleImageFile = (file: File) => {
    const point = pendingImagePointRef.current;
    const ctx = ctxRef.current ?? ensureContext();
    if (!point || !ctx) return;
    if (file.size > MAX_IMAGE_BYTES) {
      alert('이미지는 1.5MB 이하만 올릴 수 있어요.');
      pendingImagePointRef.current = null;
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== 'string') return;

      const img = new Image();
      img.onload = () => {
        const w = Math.min(240, img.width);
        const h = (img.height / img.width) * w;
        ctx.drawImage(img, point.x, point.y, w, h);
        imageCacheRef.current.set(dataUrl, img);
        pendingImagePointRef.current = null;

        const payload: ImageAddPayload = { x: point.x, y: point.y, width: w, height: h, dataUrl };
        void insertEvent('image.add', payload);
        commitHistory();
        if (!locked) setTool('pen');
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = getPoint(e.nativeEvent);
    if (!p) return;

    if (activeTool === 'hand') {
      panningRef.current = true;
      panAnchorRef.current = { x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (pendingStampRef.current) {
      const kind = pendingStampRef.current;
      const style = getDrawStyle();
      drawStamp(ctxRef.current ?? ensureContext()!, p, kind, style);
      pendingStampRef.current = null;
      setPendingStampKind(null);
      setShowLibrary(false);
      void insertEvent('stamp.add', {
        x: p.x,
        y: p.y,
        kind,
        color: style.strokeStyle,
        size: style.lineWidth,
      } satisfies StampAddPayload);
      commitHistory();
      return;
    }

    if (activeTool === 'text') {
      const text = window.prompt('텍스트 입력');
      if (text) {
        const style = getDrawStyle();
        drawText(ctxRef.current ?? ensureContext()!, p, text, style);
        void insertEvent('text.add', {
          x: p.x,
          y: p.y,
          text,
          color: style.strokeStyle,
          size: style.lineWidth,
        } satisfies TextAddPayload);
        commitHistory();
      }
      if (!locked) setTool('pen');
      return;
    }

    if (activeTool === 'image') {
      pendingImagePointRef.current = p;
      imageInputRef.current?.click();
      return;
    }

    if (isShapeTool(activeTool)) {
      shapeStartRef.current = p;
      takeSnapshot();
      drawingRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (activeTool !== 'pen' && activeTool !== 'eraser') return;

    const ctx = ctxRef.current ?? ensureContext();
    if (!ctx) return;

    drawingRef.current = true;
    lastPointRef.current = p;
    localStrokeIdRef.current = crypto.randomUUID();
    pendingChunkRef.current = [];

    const strokeTool: StrokeTool = activeTool === 'eraser' ? 'eraser' : 'pen';
    strokeStyleByIdRef.current.set(localStrokeIdRef.current, { tool: strokeTool, color, size });
    remoteLastPointByStrokeRef.current.set(localStrokeIdRef.current, { ...p });
    if (boardId) {
      void insertEvent('stroke.begin', {
        strokeId: localStrokeIdRef.current,
        tool: strokeTool,
        color,
        size,
        point: p,
      } satisfies StrokeBeginPayload);
    }

    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (panningRef.current && panAnchorRef.current) {
      const dx = e.clientX - panAnchorRef.current.x;
      const dy = e.clientY - panAnchorRef.current.y;
      panAnchorRef.current = { x: e.clientX, y: e.clientY };
      setPanOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
      return;
    }

    if (isShapeTool(activeTool) && drawingRef.current && shapeStartRef.current) {
      const ctx = ctxRef.current ?? ensureContext();
      const p = getPoint(e.nativeEvent);
      if (!ctx || !p) return;
      lastPointRef.current = p;
      restoreSnapshot();
      drawShapeTool(ctx, activeTool, shapeStartRef.current, p, getDrawStyle(), true);
      return;
    }

    if (!drawingRef.current || (activeTool !== 'pen' && activeTool !== 'eraser')) return;
    const ctx = ctxRef.current ?? ensureContext();
    if (!ctx) return;

    const p = getPoint(e.nativeEvent);
    const last = lastPointRef.current;
    if (!p || !last) return;

    applyStrokeSegment(last, p, activeTool === 'eraser' ? 'eraser' : 'pen', effectiveStrokeStyle, size);
    pendingChunkRef.current.push(p);
    scheduleChunkFlush();
    lastPointRef.current = p;
  };

  const handlePointerUp = () => {
    if (panningRef.current) {
      panningRef.current = false;
      panAnchorRef.current = null;
      return;
    }

    if (isShapeTool(activeTool) && drawingRef.current && shapeStartRef.current) {
      const ctx = ctxRef.current ?? ensureContext();
      const from = shapeStartRef.current;
      const end = lastPointRef.current ?? from;
      if (ctx) {
        restoreSnapshot();
        drawShapeTool(ctx, activeTool, from, end, getDrawStyle(), false);
      }
      if (boardId) {
        void insertEvent('shape.add', {
          tool: activeTool,
          from,
          to: end,
          color,
          size,
        } satisfies ShapeAddPayload);
      }
      shapeStartRef.current = null;
      snapshotRef.current = null;
      drawingRef.current = false;
      lastPointRef.current = null;
      if (!locked) setTool('pen');
      commitHistory();
      return;
    }

    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    const sid = localStrokeIdRef.current;
    localStrokeIdRef.current = null;

    if (chunkTimerRef.current != null) {
      window.clearTimeout(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
    void (async () => {
      await flushChunk();
      if (sid) await insertEvent('stroke.end', { strokeId: sid } satisfies StrokeEndPayload);
      commitHistory();
    })();
  };

  const clearAll = () => {
    clearAllLocal();
    commitHistory();
    void insertEvent('board.clear', {});
  };

  /* const downloadPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `canvas-${Date.now()}.png`;
    a.click();
  }; */

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        fontFamily: 'sans-serif',
        background: '#f3f4f6',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          flexShrink: 0,
          padding: '12px 16px',
          borderBottom: '1px solid #e5e7eb',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}
      >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!embedded && onBack ? (
            <button type="button" onClick={onBack} style={{ padding: '10px 12px', border: '1px solid #e5e7eb', background: 'white', cursor: 'pointer' }}>
              ← 뒤로
            </button>
          ) : null}
          <div>
            <h2 style={{ margin: 0 }}>{isGroupCanvas ? `${boardTitle || '그룹 캔버스'}` : '캔버스'}</h2>
            {isGroupCanvas ? (
              <div style={{ fontSize: 12, color: '#6366f1', marginTop: 4 }}>초대코드 멤버와 실시간 공유 중</div>
            ) : null}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ color: '#6b7280', fontSize: 12 }}>{isGroupCanvas ? '그룹 보드' : '보드'}</span>
            <select
              value={boardId}
              onChange={(e) => setBoardId(e.target.value)}
              disabled={isLoadingBoards}
              style={{ padding: '8px 10px', border: '1px solid #e5e7eb', background: 'white', minWidth: 140 }}
            >
              <option value="">선택...</option>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {getBoardOptionLabel({ ...b, title: formatBoardTitle(b.title) }, boards.map((x) => ({ ...x, title: formatBoardTitle(x.title) })))}
                </option>
              ))}
            </select>
            <input
              value={boardTitle}
              onChange={(e) => setBoardTitle(e.target.value)}
              onBlur={() => void saveBoardTitle()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void saveBoardTitle();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="보드 이름"
              style={{ padding: '8px 10px', border: '1px solid #e5e7eb', background: 'white', width: 160 }}
            />
            <button type="button" onClick={createBoard} style={{ padding: '8px 10px', border: 'none', background: '#111827', color: 'white', cursor: 'pointer' }}>
              새 보드
            </button>
            <button type="button" onClick={refreshBoards} style={{ padding: '8px 10px', border: '1px solid #e5e7eb', background: 'white', cursor: 'pointer' }}>
              새로고침
            </button>
          </div>

          <div style={{ display: 'flex', gap: 6, flexDirection: 'column', alignItems: 'flex-end' }}>
            <ExcalidrawToolbar
              tool={activeTool}
              locked={locked}
              onToolChange={pickTool}
              onLockToggle={() => setLocked((v) => !v)}
              onLibraryOpen={() => setShowLibrary((v) => !v)}
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            색
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} disabled={tool === 'eraser'} />
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            굵기
            <input type="range" min={2} max={30} value={size} onChange={(e) => setSize(Number(e.target.value))} />
            <span style={{ width: 28, textAlign: 'right' }}>{size}</span>
          </label>

          <button type="button" onClick={clearAll} style={{ padding: '8px 10px', border: '1px solid #e5e7eb', background: 'white', cursor: 'pointer' }}>
            전체 지우기
          </button>
          {/* <button type="button" onClick={downloadPng} style={{ padding: '8px 10px', border: 'none', background: '#2563eb', color: 'white', cursor: 'pointer' }}>
            PNG 저장
          </button> */}
        </div>
      </div>
      </div>

      <div className="canvas-main-row">
      <div
        ref={canvasAreaRef}
        className="canvas-area"
        style={{
          position: 'relative',
          background: '#fff',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
            transformOrigin: '0 0',
          }}
        >
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{
              display: 'block',
              touchAction: 'none',
              cursor: activeTool === 'hand' ? 'grab' : activeTool === 'text' ? 'text' : 'crosshair',
            }}
          />
        </div>

        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImageFile(file);
            e.target.value = '';
          }}
        />

        <CanvasViewportControls
          zoomPercent={zoomPercent}
          canUndo={canUndo}
          canRedo={canRedo}
          onZoomOut={zoomOut}
          onZoomIn={zoomIn}
          onUndo={undoHistory}
          onRedo={redoHistory}
        />

        {showLibrary ? (
          <div
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 10,
              padding: 10,
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
              zIndex: 5,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>라이브러리 (임시)</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['rect', 'circle', 'triangle'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => {
                    pendingStampRef.current = kind;
                    setPendingStampKind(kind);
                  }}
                  style={{
                    padding: '8px 12px',
                    border: pendingStampKind === kind ? '2px solid #8b5cf6' : '1px solid #e5e7eb',
                    borderRadius: 8,
                    background: pendingStampKind === kind ? '#ede9fe' : '#f9fafb',
                    cursor: 'pointer',
                  }}
                >
                  {kind === 'rect' ? '▭' : kind === 'circle' ? '○' : '△'}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* <TimelapseSidePanel
        boardId={boardId}
        isLoadingBoard={isLoadingBoard}
        isReplaying={isReplaying}
        replaySpeed={replaySpeed}
        compressGaps={compressGaps}
        maxGapMs={maxGapMs}
        replaySession={replaySession}
        onResync={() => {
          if (!boardId) return;
          stopReplay();
          void loadAndRenderBoard(boardId);
        }}
        onReplaySpeedChange={setReplaySpeed}
        onCompressGapsChange={setCompressGaps}
        onMaxGapMsChange={setMaxGapMs}
        onPlay={() => void handleTimelapsePlay()}
        onPause={() => stopReplay()}
        onLoad={() => void handleTimelapseLoad()}
        onSeek={seekReplay}
        saveDraftTitle={timelapseSaveDraft}
        isSaving={isSavingTimelapse}
        onSaveDraftTitleChange={setTimelapseSaveDraft}
        onSave={() => void handleSaveTimelapse()}
      /> */}
      </div>
    </div>
  );
}
