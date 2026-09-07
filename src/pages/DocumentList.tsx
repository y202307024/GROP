import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';

type MeetingDoc = {
  id: string;
  title: string | null;
  date: string;
  summary: string | null;
  group_id: string;
};

/** 회의 날짜를 목업처럼 '9월 3일' 형식으로 보여줍니다. */
function formatDocDate(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** 문서 제목: 회의 이름 + 회의록 */
function documentTitle(meetingTitle: string | null, dateStr: string) {
  const base = meetingTitle?.trim() || formatDocDate(dateStr) + ' 회의';
  return base.includes('회의록') ? base : `${base} - 회의록`;
}

/**
 * 문서 탭
 * 내가 속한 그룹의 회의(녹화·요약)를 문서 목록으로 보여 줍니다.
 * 열기 → 해당 회의록 상세(요약·영상).
 */
export default function DocumentList() {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<MeetingDoc[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        navigate('/');
        return;
      }

      const { data: memberRows } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', sessionData.session.user.id);

      const ids = [...new Set((memberRows ?? []).map((row) => row.group_id).filter(Boolean))];
      if (!mounted) return;
      setGroupIds(ids);

      if (ids.length === 0) {
        setDocs([]);
        setLoading(false);
        return;
      }

      const { data: meetings } = await supabase
        .from('meetings')
        .select('id, title, date, summary, group_id')
        .in('group_id', ids)
        .order('date', { ascending: false });

      if (!mounted) return;
      setDocs(meetings ?? []);
      setLoading(false);
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [navigate]);

  const openDoc = (doc: MeetingDoc) => {
    navigate(`/group/${doc.group_id}/meeting/${doc.id}`, { state: { from: 'documents' } });
  };

  const handleCreate = () => {
    if (groupIds.length === 1) {
      navigate(`/room/${groupIds[0]}`);
      return;
    }
    if (groupIds.length > 1) {
      navigate('/main');
      return;
    }
    alert('먼저 그룹을 만든 뒤 회의방에서 녹화를 저장하면, 여기에 회의록이 생깁니다.');
  };

  return (
    <AppShell activePage="document">
      <div className="page">
        <div className="page-header">
          <h1>문서</h1>
          <button type="button" className="primary-button" onClick={handleCreate}>
            <Icon name="plus" />
            새 문서 작성
          </button>
        </div>

        {loading ? (
          <div>불러오는 중...</div>
        ) : (
          <div className="list-card">
            <div className="list-row list-head doc-row">
              <span>문서 제목</span>
              <span>연결된 회의</span>
              <span>마지막 수정</span>
              <span />
            </div>

            {docs.length === 0 ? (
              <div className="list-row">
                아직 회의록이 없어요. 회의방에서 녹화를 저장하면 이 목록에 나타납니다.
              </div>
            ) : (
              docs.map((doc) => {
                const meetingName = doc.title?.trim() || `${formatDocDate(doc.date)} 회의`;
                return (
                  <div className="list-row doc-row" key={doc.id}>
                    <span>{documentTitle(doc.title, doc.date)}</span>
                    <span>{meetingName}</span>
                    <span>{formatDocDate(doc.date)}</span>
                    <button type="button" className="text-button" onClick={() => openDoc(doc)}>
                      열기
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
