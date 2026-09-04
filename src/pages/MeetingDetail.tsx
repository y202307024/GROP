import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { getApiBase } from '../utils/apiBase';
import { primeWebmSeeking, resolveMeetingVideoUrl } from '../utils/meetingVideo';
import {
  findActiveChapterIndex,
  formatTimestamp,
  normalizeChapters,
  parseTimestamp,
  type MeetingChapter,
} from '../utils/meetingChapters';

type Meeting = {
  id: string;
  title: string;
  date: string;
  summary: string | null;
  video_url: string | null;
  group_id: string;
  chapters?: unknown;
};

/** 요약 본문 안의 [MM:SS] 를 클릭 가능한 버튼으로 바꿔서 렌더링 */
function SummaryWithTimestamps({
  text,
  onSeek,
}: {
  text: string;
  onSeek: (seconds: number) => void;
}) {
  // [00:00] 또는 [1:02:03] 패턴으로 쪼갭니다.
  const parts = text.split(/(\[\d{1,2}(?::\d{2}){1,2}\])/g);

  return (
    <>
      {parts.map((part, i) => {
        const match = /^\[(\d{1,2}(?::\d{2}){1,2})\]$/.exec(part);
        if (!match) return <span key={i}>{part}</span>;

        const seconds = parseTimestamp(match[1]);
        if (seconds === null) return <span key={i}>{part}</span>;

        return (
          <button
            key={i}
            type="button"
            onClick={() => onSeek(seconds)}
            title={`${match[1]} 지점으로 이동`}
            style={{
              background: '#E1F5EE',
              color: '#085041',
              border: 'none',
              borderRadius: 4,
              padding: '1px 6px',
              margin: '0 2px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {match[1]}
          </button>
        );
      })}
    </>
  );
}

export default function MeetingDetail() {
  const { id: groupId, meetingId } = useParams();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryInput, setSummaryInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStep, setAiStep] = useState('');
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState('');

  // 챕터 타임라인 관련
  const [chapters, setChapters] = useState<MeetingChapter[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const seekPrimedRef = useRef(false);

  const activeIndex = findActiveChapterIndex(chapters, currentTime);

  useEffect(() => {
    fetchMeeting();
  }, [meetingId]);

  useEffect(() => {
    if (!meeting?.video_url) {
      setPlaybackUrl(null);
      setPlaybackError('');
      return;
    }
    let mounted = true;
    void resolveMeetingVideoUrl(meeting.video_url).then((url) => {
      if (!mounted) return;
      setPlaybackUrl(url);
      setPlaybackError('');
    }).catch(() => {
      if (!mounted) return;
      setPlaybackError('녹화 파일을 불러올 수 없습니다.');
    });
    return () => { mounted = false; };
  }, [meeting?.video_url]);

  const fetchMeeting = async () => {
    const { data } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .single();
    if (data) {
      setMeeting(data);
      setSummaryInput(data.summary || '');
      setChapters(normalizeChapters(data.chapters));
    }
    setLoading(false);
  };

  const saveSummary = async () => {
    await supabase
      .from('meetings')
      .update({ summary: summaryInput })
      .eq('id', meetingId);
    setEditingSummary(false);
    fetchMeeting();
  };

  /**
   * MediaRecorder webm은 길이 정보가 없어 seek이 막힙니다.
   * 메타데이터가 잡히는 시점에 한 번 보정해 둡니다.
   */
  const handleLoadedMetadata = async () => {
    const video = videoRef.current;
    if (!video || seekPrimedRef.current) return;
    seekPrimedRef.current = true;
    const resolved = await primeWebmSeeking(video);
    setDuration(resolved);
  };

  /** 챕터/타임스탬프 클릭 → 해당 시점으로 점프 후 재생 */
  const seekTo = async (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;

    if (!seekPrimedRef.current) {
      seekPrimedRef.current = true;
      const resolved = await primeWebmSeeking(video);
      setDuration(resolved);
    }

    video.currentTime = seconds;
    setCurrentTime(seconds);
    void video.play().catch(() => {
      // 자동재생이 막혀도 이동 자체는 됐으므로 무시
    });
    video.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // AI 요약 생성 (챕터 포함)
  const generateAiSummary = async () => {
    if (!meeting?.video_url) {
      alert('녹화 파일이 없어요!');
      return;
    }

    setAiLoading(true);

    try {
      setAiStep('🎙️ 음성 변환 중...');
      const playableUrl = await resolveMeetingVideoUrl(meeting.video_url);
      const res = await fetch(`${getApiBase()}/api/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: playableUrl })
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error((errBody as { error?: string }).error || `서버 오류 (${res.status})`);
      }

      setAiStep('📝 요약·타임라인 생성 중...');
      const data = await res.json();
      const nextChapters = normalizeChapters(data.chapters, data.duration);

      setAiStep('💾 저장 중...');
      // chapters 컬럼이 아직 없는 DB에서도 요약은 저장되도록 분리 처리
      const { error } = await supabase
        .from('meetings')
        .update({ summary: data.summary, chapters: nextChapters })
        .eq('id', meetingId);

      if (error?.message?.includes('chapters')) {
        await supabase
          .from('meetings')
          .update({ summary: data.summary })
          .eq('id', meetingId);
        setChapters(nextChapters);
        alert(
          '요약은 저장했지만 타임라인은 저장하지 못했어요.\n' +
          'supabase/meeting_chapters.sql 을 실행하면 다음부터 저장됩니다.'
        );
      } else if (error) {
        throw new Error(error.message);
      }

      await fetchMeeting();
      alert(
        nextChapters.length > 0
          ? `AI 요약 완성! 타임라인 ${nextChapters.length}개가 만들어졌어요 🎉`
          : 'AI 요약이 완성됐어요! 🎉'
      );

    } catch (err) {
      console.error('AI 요약 실패:', err);
      const msg = err instanceof Error ? err.message : '알 수 없는 오류';
      alert(`AI 요약 실패: ${msg}`);
    }

    setAiLoading(false);
    setAiStep('');
  };

  const downloadSummary = () => {
    if (!meeting?.summary) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    // 사용자가 수정할 수 있는 값이라 반드시 이스케이프합니다.
    const escapeHtml = (s: string) =>
      s.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const chapterRows = chapters.length > 0
      ? `<div class="chapters"><div class="chapters-title">🕘 타임라인</div>${chapters
          .map((c) => `<div class="chapter"><span class="t">${formatTimestamp(c.time)}</span> ${escapeHtml(c.title)}</div>`)
          .join('')}</div>`
      : '';

    printWindow.document.write(`
      <html>
        <head>
          <meta charset="utf-8">
          <title>${escapeHtml(meeting.title)}_회의록</title>
          <style>
            body { font-family: 'Malgun Gothic', sans-serif; padding: 40px; line-height: 1.8; color: #333; }
            h1 { font-size: 22px; margin-bottom: 6px; color: #111; }
            .date { color: #888; font-size: 13px; margin-bottom: 28px; }
            hr { border: none; border-top: 1px solid #eee; margin-bottom: 24px; }
            .chapters { margin-bottom: 24px; }
            .chapters-title { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
            .chapter { font-size: 13px; margin-bottom: 4px; }
            .chapter .t { display: inline-block; min-width: 54px; color: #085041; font-weight: 600; }
            .content { font-size: 14px; white-space: pre-wrap; line-height: 2; }
          </style>
        </head>
        <body>
          <h1>${escapeHtml(meeting.title)}</h1>
          <div class="date">📅 ${formatDate(meeting.date)} · 🕐 ${formatTime(meeting.date)}</div>
          <hr />
          ${chapterRows}
          <div class="content">${escapeHtml(meeting.summary)}</div>
          <script>window.onload = () => { window.print(); }</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  if (loading) return <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#888' }}>불러오는 중...</div>;
  if (!meeting) return <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#888' }}>회의록을 찾을 수 없어요</div>;

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', fontFamily: 'sans-serif', padding: '0 20px' }}>

      {/* 헤더 */}
      <div style={{ marginBottom: 24 }}>
        <button onClick={() => navigate(`/group/${groupId}/meetings`)}
          style={{ background: 'none', border: 'none', color: '#888', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 10 }}>
          ← 회의록 목록
        </button>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{meeting.title}</h2>
        <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
          📅 {formatDate(meeting.date)} · 🕐 {formatTime(meeting.date)}
        </div>
      </div>

      {/* 영상 섹션 */}
      <div style={{ background: '#fff', border: '0.5px solid #eee', borderRadius: 12, padding: 24, marginBottom: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>🎬 회의 녹화</div>
        {meeting.video_url ? (
          playbackUrl ? (
            <video
              ref={videoRef}
              key={playbackUrl}
              src={playbackUrl}
              controls
              playsInline
              preload="metadata"
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              style={{ width: '100%', borderRadius: 8, background: '#000', maxHeight: 400 }}
            />
          ) : (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#888', fontSize: 13 }}>
              {playbackError || '녹화 파일 불러오는 중...'}
            </div>
          )
        ) : (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#aaa' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>🎬</div>
            <div style={{ fontSize: 14, color: '#555' }}>녹화 파일이 없어요</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>회의가 끝나면 자동으로 저장돼요</div>
          </div>
        )}

        {/* 챕터 타임라인 — 누르면 해당 지점으로 점프 */}
        {chapters.length > 0 && (
          <div style={{ marginTop: 20, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>🕘 타임라인</div>
              <div style={{ fontSize: 11, color: '#aaa' }}>
                {duration > 0 ? `총 ${formatTimestamp(duration)}` : `${chapters.length}개 구간`}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {chapters.map((c, i) => {
                const isActive = i === activeIndex;
                return (
                  <button
                    key={`${c.time}-${i}`}
                    type="button"
                    onClick={() => void seekTo(c.time)}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 10px',
                      border: 'none',
                      borderRadius: 8,
                      borderLeft: isActive ? '3px solid #1D9E75' : '3px solid transparent',
                      background: isActive ? '#F2FBF7' : 'transparent',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                    }}
                  >
                    <span style={{
                      flexShrink: 0,
                      minWidth: 46,
                      fontSize: 12,
                      fontWeight: 600,
                      color: isActive ? '#085041' : '#1D9E75',
                      fontVariantNumeric: 'tabular-nums',
                      paddingTop: 1,
                    }}>
                      {formatTimestamp(c.time)}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{
                        display: 'block',
                        fontSize: 13,
                        fontWeight: isActive ? 600 : 500,
                        color: '#333',
                      }}>
                        {c.title}
                      </span>
                      {c.summary && (
                        <span style={{ display: 'block', fontSize: 12, color: '#999', marginTop: 2, lineHeight: 1.5 }}>
                          {c.summary}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* AI 요약 섹션 */}
      <div style={{ background: '#fff', border: '0.5px solid #eee', borderRadius: 12, padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>🤖 AI 회의록</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {meeting.video_url && !aiLoading && (
              <button onClick={generateAiSummary}
                style={{ fontSize: 12, padding: '5px 12px', background: '#1D9E75', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                ✨ AI 요약 생성
              </button>
            )}
            {meeting.summary && !editingSummary && !aiLoading && (
              <button onClick={downloadSummary}
                style={{ fontSize: 12, padding: '5px 12px', background: '#E1F5EE', color: '#085041', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                ⬇️ 다운로드
              </button>
            )}
            {!aiLoading && (
              <button onClick={() => setEditingSummary(!editingSummary)}
                style={{ fontSize: 12, padding: '5px 12px', background: '#f0f0f0', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                {editingSummary ? '취소' : '✏️ 수정'}
              </button>
            )}
          </div>
        </div>

        {/* AI 로딩 중 */}
        {aiLoading && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🤖</div>
            <div style={{ fontSize: 15, fontWeight: 500, color: '#333', marginBottom: 6 }}>AI가 회의록을 작성하고 있어요</div>
            <div style={{ fontSize: 13, color: '#1D9E75' }}>{aiStep}</div>
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 8 }}>회의 길이에 따라 1~3분 걸릴 수 있어요</div>
          </div>
        )}

        {/* 수정 모드 */}
        {!aiLoading && editingSummary && (
          <div>
            <textarea
              value={summaryInput}
              onChange={e => setSummaryInput(e.target.value)}
              rows={10}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #eee', borderRadius: 8, fontSize: 13, lineHeight: 1.6, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'sans-serif' }}
              placeholder="회의 내용을 입력하세요"
            />
            <button onClick={saveSummary}
              style={{ marginTop: 10, padding: '8px 20px', background: '#1D9E75', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
              저장
            </button>
          </div>
        )}

        {/* 요약 내용 표시 — [MM:SS] 는 눌러서 이동 가능 */}
        {!aiLoading && !editingSummary && meeting.summary && (
          <div style={{ fontSize: 13, lineHeight: 1.9, color: '#333', background: '#f9f9f9', padding: '16px 18px', borderRadius: 8, borderLeft: '3px solid #1D9E75', whiteSpace: 'pre-wrap' }}>
            <SummaryWithTimestamps text={meeting.summary} onSeek={(s) => void seekTo(s)} />
          </div>
        )}

        {/* 요약 없을 때 */}
        {!aiLoading && !editingSummary && !meeting.summary && (
          <div style={{ textAlign: 'center', padding: '30px 0', color: '#aaa' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🤖</div>
            <div style={{ fontSize: 14 }}>아직 AI 요약이 없어요</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              {meeting.video_url ? '✨ AI 요약 생성 버튼을 눌러보세요!' : '녹화 파일이 있어야 AI 요약이 가능해요'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
