import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import CanvasBoard from '../CanvasBoard';
import { supabase } from '../services/supabaseClient';
import { ensureGroupCanvasAccess } from '../utils/groupAccess';

export default function CanvasPage() {
  const navigate = useNavigate();
  const { id: groupId } = useParams();
  const [searchParams] = useSearchParams();
  const [authReady, setAuthReady] = useState(false);
  const [groupName, setGroupName] = useState('');

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

  if (!authReady) {
    return (
      <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: '#fff' }}>
        로그인 확인 중…
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#fff' }}>
      <CanvasBoard
        onBack={() => navigate(groupId ? `/group/${groupId}` : '/main')}
        groupId={groupId}
        groupName={groupName}
        initialBoardId={initialBoardId}
        initialTimelapseSaveId={initialTimelapseSaveId}
        autoPlayTimelapse={autoPlayTimelapse}
      />
    </div>
  );
}
