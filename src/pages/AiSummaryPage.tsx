import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import MeetingDetailView from '../components/MeetingDetailView';
import { readLastMeeting } from '../utils/lastMeeting';

// 우측 회의 목록에 쓸 회의 행 타입 (문서 탭과 동일한 meetings 데이터)
type MeetingRow = {
  id: string;
  title: string | null;
  date: string;
  summary: string | null;
  video_url?: string | null;
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
  const [searchParams] = useSearchParams();
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

      const { data: memberRows, error: memberError } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', sessionData.session.user.id);
      if (memberError) {
        console.warn('그룹 목록을 불러오지 못했습니다:', memberError.message);
      }

      const ids = [...new Set((memberRows ?? []).map((row) => row.group_id).filter(Boolean))];
      if (!mounted) return;
      if (ids.length === 0) {
        setMeetings([]);
        setSelectedId(null);
        return;
      }

      const { data, error } = await supabase
        .from('meetings')
        .select('id, title, date, summary, video_url, group_id')
        .in('group_id', ids)
        .order('date', { ascending: false });
      if (error) {
        console.warn('회의록 목록을 불러오지 못했습니다:', error.message);
      }

      if (!mounted) return;
      const rows = data ?? [];
      setMeetings(rows);

      // 방금 녹화 저장한 회의가 있으면 그걸 엽니다. 이미 다른 행을 보고 있으면 유지합니다.
      const wanted = searchParams.get('meeting') || readLastMeeting();
      setSelectedId((prev) => {
        if (searchParams.get('meeting') && rows.some((r) => r.id === wanted)) return wanted;
        if (prev && rows.some((r) => r.id === prev)) return prev;
        if (wanted && rows.some((r) => r.id === wanted)) return wanted;
        return rows[0]?.id ?? null;
      });
    };

    void load();
    const onFocus = () => {
      void load();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      mounted = false;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [navigate, searchParams]);

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
                const hasSummary = !!m.summary?.trim();
                const active = m.id === selectedId;
                // 요약이 없으면 진행 상태에 '내용 없음' 표시 (상세 본문은 '아무 내용이 없습니다')
                const statusLabel = hasSummary ? '완료' : '내용 없음';
                const statusClass = hasSummary ? 'done' : 'progress';
                return (
                  <div
                    className="meeting-card-row"
                    key={m.id}
                    onClick={() => setSelectedId(m.id)}
                    style={active ? { borderColor: 'var(--color-primary)', background: '#faf8f6' } : undefined}
                  >
                    <div className="meeting-card-row-top">
                      <span className="title">{m.title?.trim() || '회의'}</span>
                      <span className={`status-pill ${statusClass}`}>
                        {statusLabel}
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
                        {hasSummary
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
