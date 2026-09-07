import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import CanvasBoard, { type CanvasBoardHandle } from '../CanvasBoard';
import MeetingDrawingTools, { type MeetingDrawAction } from '../components/MeetingDrawingTools';
import type { ExcalidrawTool } from '../components/ExcalidrawToolbar';
import { supabase } from '../services/supabaseClient';
import { ensureGroupCanvasAccess } from '../utils/groupAccess';

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
    if (next === 'stamp') {
      canvasBoardRef.current?.toggleLibrary();
      return;
    }
    canvasBoardRef.current?.pickTool(next as ExcalidrawTool);
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
            onToolChange={(tool) => setDrawTool(tool)}
            groupId={groupId}
            groupName={groupName}
            initialBoardId={initialBoardId}
            initialTimelapseSaveId={initialTimelapseSaveId}
            autoPlayTimelapse={autoPlayTimelapse}
          />
        </div>
      </main>

      <footer className="bottom-bar">
        <MeetingDrawingTools active={drawTool} onPick={handlePick} />
        <div className="call-controls">
          <button type="button" className="leave-button" onClick={goBack}>
            나가기
          </button>
        </div>
      </footer>
    </div>
  );
}
