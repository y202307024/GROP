import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import AppShell from '../components/AppShell';
import s from './MeetingList.module.css';

type Meeting = {
  id: string;
  title: string;
  date: string;
  summary: string | null;
  video_url: string | null;
  group_id: string;
  group_name?: string | null;
};

type GroupedMeetings = {
  [date: string]: Meeting[];
};

/**
 * 회의록 목록
 * - /meetings : 내가 속한 모든 그룹 회의
 * - /group/:id/meetings : 해당 그룹만
 */
export default function MeetingList() {
  const { id: groupId } = useParams();
  const navigate = useNavigate();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDates, setOpenDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    let mounted = true;

    const fetchMeetings = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        navigate('/');
        return;
      }

      let targetGroupIds: string[] = [];
      if (groupId) {
        targetGroupIds = [groupId];
      } else {
        const { data: memberRows } = await supabase
          .from('group_members')
          .select('group_id')
          .eq('user_id', sessionData.session.user.id);
        targetGroupIds = [...new Set((memberRows ?? []).map((r) => r.group_id).filter(Boolean))];
      }

      if (!mounted) return;
      if (targetGroupIds.length === 0) {
        setMeetings([]);
        setLoading(false);
        return;
      }

      // 그룹 이름 (목록에 표시)
      const { data: groupRows } = await supabase
        .from('groups')
        .select('id, name')
        .in('id', targetGroupIds);
      const nameById = new Map<string, string>();
      for (const g of groupRows ?? []) {
        if (g?.id && typeof g.name === 'string') nameById.set(g.id, g.name);
      }

      const { data } = await supabase
        .from('meetings')
        .select('id, title, date, summary, video_url, group_id')
        .in('group_id', targetGroupIds)
        .order('date', { ascending: false });

      if (!mounted) return;
      setMeetings(
        (data ?? []).map((m) => ({
          ...m,
          group_name: nameById.get(m.group_id) ?? null,
        })),
      );
      setLoading(false);
    };

    void fetchMeetings();
    return () => {
      mounted = false;
    };
  }, [groupId, navigate]);

  const groupByDate = (rows: Meeting[]): GroupedMeetings => {
    return rows.reduce((acc, meeting) => {
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
    setOpenDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const grouped = groupByDate(meetings);
  const dates = Object.keys(grouped);

  return (
    <AppShell activePage="meeting">
      <div className="page">
        {loading ? (
          <div>불러오는 중...</div>
        ) : (
          <>
            <div className="page-header">
              <h1>회의록</h1>
            </div>

            {dates.length === 0 ? (
              <div className={s.empty}>
                <div>아직 회의록이 없어요</div>
                <div>회의가 끝나면 자동으로 저장돼요</div>
              </div>
            ) : (
              <div className={s.list}>
                {dates.map((date) => {
                  const isOpen = openDates.has(date);
                  const dayMeetings = grouped[date];

                  return (
                    <div key={date} className={s.folder}>
                      <div className={s.folderHead} onClick={() => toggleDate(date)}>
                        <span>{isOpen ? '📂' : '📁'}</span>
                        <div>
                          <div className={s.folderTitle}>{date}</div>
                          <div className={s.folderMeta}>회의 {dayMeetings.length}개</div>
                        </div>
                        <span className={s.chevron}>{isOpen ? '▲' : '▼'}</span>
                      </div>

                      {isOpen && (
                        <div className={s.meetings}>
                          {dayMeetings.map((m) => (
                            <div
                              key={m.id}
                              className={s.meeting}
                              onClick={() =>
                                navigate(`/group/${m.group_id}/meeting/${m.id}`, {
                                  state: { from: groupId ? 'group-meetings' : 'meetings' },
                                })
                              }
                            >
                              <span>{m.video_url ? '🎬' : '📄'}</span>
                              <div>
                                <div className={s.meetingTitle}>
                                  {formatTime(m.date)} 회의
                                  {!groupId && m.group_name ? (
                                    <span style={{ marginLeft: 8, color: '#888', fontWeight: 400, fontSize: 13 }}>
                                      · {m.group_name}
                                    </span>
                                  ) : null}
                                </div>
                                {m.summary && <div className={s.meetingSummary}>{m.summary}</div>}
                              </div>
                              <div className={s.pills}>
                                {m.video_url && <span className={`${s.pill} ${s.pillInfo}`}>영상</span>}
                                {m.summary && <span className={s.pill}>메모</span>}
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
          </>
        )}
      </div>
    </AppShell>
  );
}
