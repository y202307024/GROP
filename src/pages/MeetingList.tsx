import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import s from './MeetingList.module.css';

type Meeting = {
  id: string;
  title: string;
  date: string;
  summary: string | null;
  video_url: string | null;
  video_key?: string | null;
  video_status?: string | null;
  group_id: string;
  group_name?: string | null;
  /** 회의에 첨부(사용)된 문서 파일 이름들 — meetings.attachments(jsonb)에서 이름만 뽑습니다 */
  fileNames: string[];
};

/** DB jsonb 첨부에서 파일 이름만 안전하게 꺼냅니다(DocumentList의 normalizeAttachments와 같은 기준: path·name이 문자열인 항목). */
function attachmentNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((it): it is Record<string, unknown> => Boolean(it) && typeof it === 'object')
    .filter((it) => typeof it.path === 'string' && typeof it.name === 'string')
    .map((it) => String(it.name));
}

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

      // attachments 컬럼이 있으면 함께 읽고, 없으면 기본 컬럼만 다시 조회합니다(DocumentList와 같은 방식).
      type Row = Omit<Meeting, 'group_name' | 'fileNames'> & { attachments?: unknown };
      let rows: Row[];
      const withAttach = await supabase
        .from('meetings')
        .select('id, title, date, summary, video_url, group_id, attachments')
        .in('group_id', targetGroupIds)
        .order('date', { ascending: false });
      if (withStatus.error && /video_key|video_status/i.test(withStatus.error.message)) {
        const fallback = await supabase
          .from('meetings')
          .select('id, title, date, summary, video_url, group_id')
          .in('group_id', targetGroupIds)
          .order('date', { ascending: false });
        if (fallback.error) console.warn('회의록 목록을 불러오지 못했습니다:', fallback.error.message);
        rows = (fallback.data ?? null) as Meeting[] | null;
      } else {
        if (withStatus.error) console.warn('회의록 목록을 불러오지 못했습니다:', withStatus.error.message);
        rows = (withStatus.data ?? null) as Meeting[] | null;
      }

      if (withAttach.error && /attachments/i.test(withAttach.error.message)) {
        const fallback = await supabase
          .from('meetings')
          .select('id, title, date, summary, video_url, group_id')
          .in('group_id', targetGroupIds)
          .order('date', { ascending: false });
        rows = (fallback.data as Row[] | null) ?? [];
      } else {
        rows = (withAttach.data as Row[] | null) ?? [];
      }

      if (!mounted) return;
      setMeetings(
        rows.map((m) => ({
          id: m.id,
          title: m.title,
          date: m.date,
          summary: m.summary,
          video_url: m.video_url,
          group_id: m.group_id,
          group_name: nameById.get(m.group_id) ?? null,
          fileNames: attachmentNames(m.attachments),
        })),
      );
      setLoading(false);
    };

    void fetchMeetings();
    return () => {
      mounted = false;
    };
  }, [groupId, navigate]);

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  /** 「첨부 문서」 칸 문구: 첫 파일 이름 + (여럿이면) "외 N개", 없으면 "문서 없음" */
  const fileLabel = (names: string[]) =>
    names.length === 0 ? '문서 없음' : names.length > 1 ? `${names[0]} 외 ${names.length - 1}개` : names[0];

  // 하단 요약용 — 회의 수와, 그 회의들에 첨부된 문서 파일 수
  const docCount = meetings.reduce((sum, m) => sum + m.fileNames.length, 0);

  return (
    <AppShell activePage="meeting">
      {/* 페이지 높이를 화면에 고정하고, 날짜 폴더가 많아지면 목록(.list) 안에서만 스크롤됩니다 */}
      <div className={`page ${s.fixedPage}`}>
        {loading ? (
          <div>불러오는 중...</div>
        ) : (
          <>
            {/* 문서 페이지처럼 왼쪽 탭 제목 + 오른쪽 버튼 줄. "그룹으로"는 그룹 상세에서 들어온 경우(/group/:id/meetings)에만
                돌아갈 그룹이 있어서 그때만 보여줍니다 */}
            <div className={s.docHeader}>
              <div className={s.tabs}>
                <span className={s.tab}>회의록</span>
              </div>
              {groupId ? (
                <div className={s.toolbar}>
                  <button
                    className={s.backButton}
                    type="button"
                    aria-label="그룹으로"
                    title="그룹으로"
                    onClick={() => navigate(`/group/${groupId}`)}
                  >
                    <Icon name="chevron-left" />
                  </button>
                </div>
              ) : null}
            </div>

            {meetings.length === 0 ? (
              <div className={s.empty}>
                <div>아직 회의록이 없어요</div>
                <div>회의가 끝나면 자동으로 저장돼요</div>
              </div>
            ) : (
              <div className={s.meetingCard}>
                {/* 헤더(sticky) + 행들이 이 영역 안에서만 스크롤됩니다 */}
                <div className={s.meetingBody}>
                  <div className="list-row list-head meeting-row">
                    <span>회의록 / 사용된 문서</span>
                    <span>날짜</span>
                    <span>첨부 문서</span>
                    <span>구분</span>
                  </div>
                  {meetings.map((m) => (
                    <div
                      key={m.id}
                      className={`list-row meeting-row ${s.meetingRow}`}
                      onClick={() =>
                        navigate(`/group/${m.group_id}/meeting/${m.id}`, {
                          state: { from: groupId ? 'group-meetings' : 'meetings' },
                        })
                      }
                    >
                      <div className={s.titleCell}>
                        <span className={s.rowIcon}>{m.video_url ? '🎬' : '📄'}</span>
                        <div className={s.titleText}>
                          <span className={s.titleName}>{formatTime(m.date)} 회의</span>
                          {/* 전체 회의록(/meetings)에서는 어느 그룹 회의인지도 함께 보여줍니다 */}
                          {(m.summary || (!groupId && m.group_name)) && (
                            <span className={s.titleSub}>
                              {!groupId && m.group_name ? `${m.group_name}${m.summary ? ' · ' : ''}` : ''}
                              {m.summary ?? ''}
                            </span>
                          )}
                        </div>
                      </div>
                      <span>{formatDate(m.date)}</span>
                      <span className={m.fileNames.length === 0 ? s.noFile : s.fileName}>{fileLabel(m.fileNames)}</span>
                      <span className={s.pills}>
                        {m.video_url && <span className={`${s.pill} ${s.pillInfo}`}>영상</span>}
                        {m.summary && <span className={s.pill}>메모</span>}
                      </span>
                    </div>
                  ))}
                </div>
                {/* 하단 요약 — 문서 페이지의 "문서 N개" 줄과 같은 자리 */}
                <div className={s.listFooter}>
                  {groupId ? '이 그룹 ' : ''}회의록 {meetings.length}개 · 사용된 문서 {docCount}개
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
