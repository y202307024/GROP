import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import CanvasBoard, { type CanvasBoardHandle } from '../CanvasBoard';
import MeetingDrawingTools, { type MeetingDrawAction } from '../components/MeetingDrawingTools';
import type { ExcalidrawTool } from '../components/ExcalidrawToolbar';
import { supabase } from '../services/supabaseClient';
import { ensureGroupCanvasAccess } from '../utils/groupAccess';
import { uploadMeetingAttachment, type MeetingChatFile } from '../utils/meetingChat';

const SHAPE_TOOLS: ExcalidrawTool[] = [
  'rectangle', 'ellipse', 'diamond', 'triangle', 'pentagon', 'hexagon', 'star', 'arrow', 'line', 'elbowArrow', 'curveArrow',
];

/**
 * 단독 캔버스 페이지
 * 회의방과 같은 meeting.html 껍데기를 쓰되, 채팅·통화 버튼은 없습니다.
 */
export default function CanvasPage() {
  const navigate = useNavigate();
  const { id: groupId } = useParams();
  const [searchParams] = useSearchParams();
  const [authReady, setAuthReady] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [drawTool, setDrawTool] = useState<MeetingDrawAction>('hand');
  const [activeShape, setActiveShape] = useState<ExcalidrawTool>('rectangle');
  const [strokeColor, setStrokeColor] = useState('#111111');
  const [strokeSize, setStrokeSize] = useState(6);
  const [penOpacity, setPenOpacity] = useState(1);
  const [penDash, setPenDash] = useState<'solid' | 'dashed'>('solid');
  // 연필/마커/붓 — 굵기 슬라이더와 분리해 유지합니다.
  const [penTip, setPenTip] = useState<'pencil' | 'marker' | 'brush'>('pencil');
  const [eraserActive, setEraserActive] = useState(false);
  /** 지우개 → 영역 지우기 (네모 드래그) */
  const [areaEraseActive, setAreaEraseActive] = useState(false);
  const [stickyColor, setStickyColor] = useState('#f7e7a5');
  const [textFontSize, setTextFontSize] = useState(20);
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>('left');
  const [textBold, setTextBold] = useState(false);
  const [textStrike, setTextStrike] = useState(false);
  const [textUnderline, setTextUnderline] = useState(false);
  // 배치된 텍스트를 고르면 하단 서식(밑줄·취소선 등) 메뉴를 띄웁니다.
  const [textSelected, setTextSelected] = useState(false);
  const [shapeDash, setShapeDash] = useState<'solid' | 'dashed'>('solid');
  const [shapeStrokeOpacity, setShapeStrokeOpacity] = useState(1);
  const [shapeFillEnabled, setShapeFillEnabled] = useState(false);
  const [shapeFillColor, setShapeFillColor] = useState('#93c5a0');
  const [shapeFillOpacity, setShapeFillOpacity] = useState(0.35);
  const [attachments, setAttachments] = useState<MeetingChatFile[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const canvasBoardRef = useRef<CanvasBoardHandle | null>(null);

  const initialBoardId = searchParams.get('boardId') ?? undefined;
  const initialTimelapseSaveId = searchParams.get('saveId') ?? undefined;
  const autoPlayTimelapse = searchParams.get('play') === '1';

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!mounted) return;

      if (!sessionData.session) {
        alert('캔버스를 사용하려면 로그인이 필요합니다.');
        navigate('/');
        return;
      }

      if (groupId) {
        const userId = sessionData.session.user.id;
        const access = await ensureGroupCanvasAccess(groupId, userId);

        if (!access.ok) {
          if (access.error === 'not_member') {
            alert('이 그룹 멤버만 캔버스를 사용할 수 있습니다.\n메인에서 초대코드로 그룹에 참여한 뒤 다시 시도해 주세요.');
          } else {
            alert(`멤버 확인 실패: ${access.error}`);
          }
          navigate(groupId ? `/group/${groupId}` : '/main');
          return;
        }

        const { data: group } = await supabase
          .from('groups')
          .select('name')
          .eq('id', groupId)
          .maybeSingle();

        if (group?.name) setGroupName(group.name);
      }

      setAuthReady(true);
    };

    void init();

    return () => {
      mounted = false;
    };
  }, [groupId, navigate]);

  const handlePick = (next: MeetingDrawAction) => {
    setDrawTool(next);
    setEraserActive(false);
    setAreaEraseActive(false);
    if (next === 'stamp') {
      // 메모장: 도구만 고르고, 화면을 한 번 더 클릭해야 붙습니다.
      canvasBoardRef.current?.setStickyPaperColor(stickyColor);
      canvasBoardRef.current?.addStickyNote();
      return;
    }
    canvasBoardRef.current?.cancelStickyPlace();
    if (next === 'pan' || next === 'hand') {
      canvasBoardRef.current?.pickTool('hand');
      return;
    }
    if (next === 'shapes') {
      canvasBoardRef.current?.pickTool(activeShape);
      return;
    }
    if (next === 'file') return;
    canvasBoardRef.current?.pickTool(next as ExcalidrawTool);
  };

  const handleUploadAttachment = async (file: File) => {
    setUploadingAttachment(true);
    try {
      const saved = await uploadMeetingAttachment(file, groupId);
      setAttachments((prev) => [...prev, saved]);
    } catch (err) {
      alert(err instanceof Error ? err.message : '파일 첨부에 실패했습니다.');
    } finally {
      setUploadingAttachment(false);
    }
  };

  const goBack = () => navigate(groupId ? `/group/${groupId}` : '/main');

  if (!authReady) {
    return <div className="meeting-loading">로그인 확인 중…</div>;
  }

  return (
    <div className="meeting-page stage">
      <header className="meeting-header">
        <Link to="/main" className="logo">GROP</Link>
        <span className="meeting-title">{groupName || '캔버스'}</span>
      </header>

      <main className="meeting-main">
        <div className="whiteboard">
          <CanvasBoard
            ref={canvasBoardRef}
            embedded
            gropShell
            onBack={goBack}
            onToolChange={(tool) => {
              if (SHAPE_TOOLS.includes(tool)) {
                setDrawTool('shapes');
                setActiveShape(tool);
                return;
              }
              if (tool === 'eraser') {
                setDrawTool('pen');
                setEraserActive(true);
                return;
              }
              setEraserActive(false);
              setAreaEraseActive(false);
              setDrawTool(tool);
            }}
            groupId={groupId}
            groupName={groupName}
            initialBoardId={initialBoardId}
            initialTimelapseSaveId={initialTimelapseSaveId}
            autoPlayTimelapse={autoPlayTimelapse}
            onTextAlignChange={setTextAlign}
            onTextDecorChange={(style) => {
              setTextBold(style.bold);
              setTextStrike(style.strike);
              setTextUnderline(style.underline);
            }}
            onTextSelectedChange={setTextSelected}
            onTextFontSizeChange={setTextFontSize}
          />
        </div>
      </main>

      <footer className="bottom-bar">
        <MeetingDrawingTools
          active={drawTool}
          onPick={handlePick}
          activeShape={activeShape}
          onPickShape={(tool) => {
            setActiveShape(tool);
            setDrawTool('shapes');
            canvasBoardRef.current?.pickTool(tool);
          }}
          strokeColor={strokeColor}
          strokeSize={strokeSize}
          onStrokeStyle={(style) => {
            // 지우개 굵기 조절 시에는 지우개 모드를 유지합니다.
            if (style.color) setStrokeColor(style.color);
            if (typeof style.size === 'number') setStrokeSize(style.size);
            if (typeof style.opacity === 'number') setPenOpacity(style.opacity);
            if (style.dash) setPenDash(style.dash);
            canvasBoardRef.current?.setStrokeStyle(style);
          }}
          isEraser={eraserActive}
          isAreaErase={areaEraseActive}
          penTip={penTip}
          onPenTipChange={setPenTip}
          penStyle={{ opacity: penOpacity, dash: penDash }}
          onStartEyedropper={() => {
            canvasBoardRef.current?.startEyedropper((hex) => {
              setStrokeColor(hex);
              canvasBoardRef.current?.setStrokeStyle({ color: hex });
            });
          }}
          shapeStyle={{
            dash: shapeDash,
            strokeOpacity: shapeStrokeOpacity,
            fillEnabled: shapeFillEnabled,
            fillColor: shapeFillColor,
            fillOpacity: shapeFillOpacity,
          }}
          onShapeStyle={(style) => {
            if (style.dash) setShapeDash(style.dash);
            if (typeof style.strokeOpacity === 'number') setShapeStrokeOpacity(style.strokeOpacity);
            if (typeof style.fillEnabled === 'boolean') setShapeFillEnabled(style.fillEnabled);
            if (typeof style.fillColor === 'string') setShapeFillColor(style.fillColor);
            if (typeof style.fillOpacity === 'number') setShapeFillOpacity(style.fillOpacity);
            canvasBoardRef.current?.setShapeStyle(style);
          }}
          onPickEraser={() => {
            setDrawTool('pen');
            setEraserActive(true);
            setAreaEraseActive(false);
            canvasBoardRef.current?.pickTool('eraser');
            canvasBoardRef.current?.setAreaEraseMode(false);
          }}
          onAreaErase={() => {
            setDrawTool('pen');
            setEraserActive(true);
            setAreaEraseActive(true);
            canvasBoardRef.current?.pickTool('eraser');
            canvasBoardRef.current?.setAreaEraseMode(true);
          }}
          onClearAll={() => {
            setAreaEraseActive(false);
            canvasBoardRef.current?.setAreaEraseMode(false);
            canvasBoardRef.current?.clearBoard();
          }}
          stickyColor={stickyColor}
          onStickyColor={(color) => {
            setStickyColor(color);
            canvasBoardRef.current?.setStickyPaperColor(color);
          }}
          attachments={attachments}
          onUploadFile={(file) => { void handleUploadAttachment(file); }}
          uploadingAttachment={uploadingAttachment}
          textSelected={textSelected}
          textFontSize={textFontSize}
          onTextFontSize={(size) => {
            setTextFontSize(size);
            canvasBoardRef.current?.setTextFontSize(size);
          }}
          textAlign={textAlign}
          onTextAlign={(align) => {
            setTextAlign(align);
            canvasBoardRef.current?.setTextAlign(align);
          }}
          textBold={textBold}
          textStrike={textStrike}
          textUnderline={textUnderline}
          onTextDecor={(style) => {
            if (typeof style.bold === 'boolean') setTextBold(style.bold);
            if (typeof style.strike === 'boolean') setTextStrike(style.strike);
            if (typeof style.underline === 'boolean') setTextUnderline(style.underline);
            canvasBoardRef.current?.setTextDecor(style);
          }}
        />
        <div className="call-controls">
          <button type="button" className="leave-button" onClick={goBack}>
            나가기
          </button>
        </div>
      </footer>
    </div>
  );
}
