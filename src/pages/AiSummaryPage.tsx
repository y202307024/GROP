import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import MeetingDetailView from '../components/MeetingDetailView';

// 우측 회의 목록에 쓸 회의 행 타입 (문서 탭과 동일한 meetings 데이터)
type MeetingRow = {
  id: string;
  title: string | null;
  date: string;
  summary: string | null;
  group_id: string;
};

/** '2026.09.06 10:00AM' 형식으로 회의 날짜를 표시합니다. */
function formatMeetingDate(dateStr: string) {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${y}.${m}.${day} ${String(hours).padStart(2, '0')}:${minutes}${ampm}`;
}

/**
 * AI 요약 페이지
 * - 왼쪽: 선택한 회의의 녹화 영상 + AI 회의록 (MeetingDetailView 재사용)
 * - 오른쪽: 회의 목록. 행을 누르면 왼쪽이 그 회의로 바뀝니다.
 */
export default function AiSummaryPage() {
  const navigate = useNavigate();
  // 우측 회의 목록 — 문서 탭과 같은 소스(내가 속한 그룹의 회의)를 최신순으로 보여 줍니다.
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  // 왼쪽에 표시할 회의 id. 목록을 누르면 여기가 바뀝니다.
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
      if (!mounted || ids.length === 0) {
        if (mounted) setMeetings([]);
        return;
      }

      const { data } = await supabase
        .from('meetings')
        .select('id, title, date, summary, group_id')
        .in('group_id', ids)
        .order('date', { ascending: false });

      if (!mounted) return;
      const rows = data ?? [];
      setMeetings(rows);
      // 처음 진입 시 가장 최근 회의를 기본으로 선택합니다.
      setSelectedId((prev) => prev ?? rows[0]?.id ?? null);
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [navigate]);

  return (
    <AppShell activePage="ai">
      <div className="ai-page">
        {/* 좌측: 선택한 회의의 영상 + AI 회의록 */}
        <div className="ai-main-column">
          {selectedId ? (
            <MeetingDetailView key={selectedId} meetingId={selectedId} variant="ai" />
          ) : (
            <div className="panel" style={{ padding: 40, color: '#888' }}>
              왼쪽에 표시할 회의록이 없어요. 회의방에서 녹화를 저장하면 여기에 나타납니다.
            </div>
          )}
        </div>

        {/* 우측: 회의 목록 패널 — 누르면 왼쪽이 그 회의로 전환됩니다 */}
        <section className="panel ai-meeting-list-panel">
          <div className="section-head">
            <h2>회의 목록</h2>
          </div>

          <div className="ai-meeting-list-head">
            <span className="col-title">회의 제목</span>
            <span className="col-meta">
              <span>진행 상태</span>
              <span>참석자</span>
              <span>AI 요약</span>
            </span>
          </div>

          <div className="ai-meeting-list">
            {meetings.length === 0 ? (
              <div className="meeting-card-row" style={{ cursor: 'default' }}>
                <span className="title">아직 회의록이 없어요</span>
              </div>
            ) : (
              meetings.map((m) => {
                const done = !!m.summary; // 요약이 있으면 완료로 표시
                const active = m.id === selectedId;
                return (
                  <div
                    className="meeting-card-row"
                    key={m.id}
                    onClick={() => setSelectedId(m.id)}
                    style={active ? { borderColor: 'var(--color-primary)', background: '#faf8f6' } : undefined}
                  >
                    <div className="meeting-card-row-top">
                      <span className="title">{m.title?.trim() || '회의'}</span>
                      <span className={`status-pill ${done ? 'done' : 'progress'}`}>
                        {done ? '완료' : '진행중'}
                      </span>
                    </div>
                    <div className="meeting-card-row-bottom">
                      <span>{formatMeetingDate(m.date)}</span>
                      <span className="attendees">
                        <Icon name="circle-user" />
                        <Icon name="circle-user" />
                        <Icon name="circle-user" />
                      </span>
                      <span className="ai-icon">
                        {done
                          ? <Icon name="check-circle" className="done" />
                          : <Icon name="minus-circle" className="pending" />}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
