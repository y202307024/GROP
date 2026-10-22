import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import AppShell from '../components/AppShell';
import MeetingDetailView from '../components/MeetingDetailView';
import styles from './AiSummaryPage.module.css';

/**
 * AI 요약 상세 — 첫 화면(AiMeetingList)에서 고른 회의 한 건을 "요약 생성 / 회의 영상" 두 탭으로 보여줍니다.
 * 예전 오른쪽 회의 목록 패널은 첫 화면의 그룹 탭 + 회의록 목록이 대신해서 없앴고,
 * 돌아가기(‹)는 같은 그룹 탭이 열린 첫 화면으로 보냅니다.
 */
export default function AiSummaryPage() {
  const navigate = useNavigate();
  const { meetingId } = useParams();
  // 첫 화면으로 돌아갈 때 같은 그룹 탭이 열리도록 이 회의의 그룹 id를 기억합니다
  const [groupId, setGroupId] = useState('');

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        navigate('/');
        return;
      }
      // RLS 때문에 내가 속하지 않은 그룹의 회의는 조회되지 않으므로 그 경우 첫 화면으로 돌려보냅니다
      const { data: current } = await supabase
        .from('meetings')
        .select('group_id')
        .eq('id', meetingId ?? '')
        .maybeSingle();
      if (!mounted) return;
      if (!current?.group_id) {
        navigate('/ai', { replace: true });
        return;
      }
      setGroupId(current.group_id);
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [navigate, meetingId]);

  return (
    <AppShell activePage="ai">
      <div className={`page ${styles.aiDetailPage}`}>
        <MeetingDetailView
          key={meetingId}
          meetingId={meetingId ?? null}
          variant="ai"
          backLabel="회의록 목록으로"
          onBack={() => navigate(groupId ? `/ai?group=${groupId}` : '/ai')}
        />
      </div>
    </AppShell>
  );
}
