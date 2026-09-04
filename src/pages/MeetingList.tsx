import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';

type Meeting = {
  id: string;
  title: string;
  date: string;
  summary: string | null;
  video_url: string | null;
};

type GroupedMeetings = {
  [date: string]: Meeting[];
};

export default function MeetingList() {
  const { id: groupId } = useParams();
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDates, setOpenDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchMeetings();
  }, [groupId]);

  const fetchMeetings = async () => {
    const { data } = await supabase
      .from('meetings')
      .select('*')
      .eq('group_id', groupId)
      .order('date', { ascending: false });
    setMeetings(data || []);
    setLoading(false);
  };

  // 날짜별로 그룹핑
  const groupByDate = (meetings: Meeting[]): GroupedMeetings => {
    return meetings.reduce((acc, meeting) => {
      const d = new Date(meeting.date);
      const dateKey = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
      if (!acc[dateKey]) acc[dateKey] = [];
      acc[dateKey].push(meeting);
      return acc;
    }, {} as GroupedMeetings);
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const toggleDate = (date: string) => {
    setOpenDates(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  if (loading) return (
    <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#888' }}>불러오는 중...</div>
  );

  const grouped = groupByDate(meetings);
  const dates = Object.keys(grouped);

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', fontFamily: 'sans-serif', padding: '0 20px' }}>

      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <button onClick={() => navigate(`/group/${groupId}`)}
            style={{ background: 'none', border: 'none', color: '#888', fontSize: 13, cursor: 'pointer', marginBottom: 6, padding: 0 }}>
            ← 그룹으로
          </button>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>📁 회의록</h2>
          <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>날짜를 클릭하면 그날 회의를 볼 수 있어요</div>
        </div>
      </div>

      {/* 회의록 없을 때 */}
      {dates.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#aaa' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
          <div style={{ fontSize: 14 }}>아직 회의록이 없어요</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>회의가 끝나면 자동으로 저장돼요</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {dates.map(date => {
            const isOpen = openDates.has(date);
            const dayMeetings = grouped[date];

            return (
              <div key={date} style={{ background: '#fff', border: '0.5px solid #eee', borderRadius: 12, overflow: 'hidden' }}>

                {/* 날짜 폴더 헤더 */}
                <div
                  onClick={() => toggleDate(date)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', cursor: 'pointer', userSelect: 'none' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#fafafa')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ fontSize: 20 }}>{isOpen ? '📂' : '📁'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#222' }}>{date}</div>
                    <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                      회의 {dayMeetings.length}개
                    </div>
                  </div>
                  <span style={{ fontSize: 13, color: '#aaa' }}>{isOpen ? '▲' : '▼'}</span>
                </div>

                {/* 날짜 안 회의 목록 */}
                {isOpen && (
                  <div style={{ borderTop: '0.5px solid #f0f0f0' }}>
                    {dayMeetings.map((m, i) => (
                      <div
                        key={m.id}
                        onClick={() => navigate(`/group/${groupId}/meeting/${m.id}`)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 14,
                          padding: '12px 20px 12px 52px',
                          borderTop: i === 0 ? 'none' : '0.5px solid #f5f5f5',
                          cursor: 'pointer',
                          background: '#fff'
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#f9f9f9')}
                        onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                      >
                        {/* 영상 있는지 여부 */}
                        <span style={{ fontSize: 18 }}>{m.video_url ? '🎬' : '📄'}</span>

                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 500, color: '#333' }}>
                            {formatTime(m.date)} 회의
                          </div>
                          {m.summary && (
                            <div style={{ fontSize: 12, color: '#888', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400 }}>
                              {m.summary}
                            </div>
                          )}
                        </div>

                        <div style={{ display: 'flex', gap: 6 }}>
                          {m.video_url && (
                            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#E6F1FB', color: '#185FA5' }}>🎬 영상</span>
                          )}
                          {m.summary && (
                            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#E1F5EE', color: '#085041' }}>📝 메모</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}