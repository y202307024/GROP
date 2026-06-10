import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import CanvasBoard from '../CanvasBoard';
import { supabase } from '../services/supabaseClient';

export default function CanvasPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [authReady, setAuthReady] = useState(false);

  const initialBoardId = searchParams.get('boardId') ?? undefined;
  const initialTimelapseSaveId = searchParams.get('saveId') ?? undefined;
  const autoPlayTimelapse = searchParams.get('play') === '1';

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (!data.session) {
        alert('캔버스를 사용하려면 로그인이 필요합니다.');
        navigate('/');
        return;
      }
      setAuthReady(true);
    });
    return () => {
      mounted = false;
    };
  }, [navigate]);

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
        onBack={() => navigate('/main')}
        initialBoardId={initialBoardId}
        initialTimelapseSaveId={initialTimelapseSaveId}
        autoPlayTimelapse={autoPlayTimelapse}
      />
    </div>
  );
}
