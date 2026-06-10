import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { getApiBase } from '../utils/apiBase';

type Meeting = {
  id: string;
  title: string;
  date: string;
  summary: string | null;
  video_url: string | null;
  group_id: string;
};

export default function MeetingDetail() {
  const { id: groupId, meetingId } = useParams();
  const navigate = useNavigate();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryInput, setSummaryInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStep, setAiStep] = useState('');

  useEffect(() => {
    fetchMeeting();
  }, [meetingId]);

  const fetchMeeting = async () => {
    const { data } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .single();
    if (data) {
      setMeeting(data);
      setSummaryInput(data.summary || '');
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

  // AI 요약 생성
  const generateAiSummary = async () => {
    if (!meeting?.video_url) {
      alert('녹화 파일이 없어요!');
      return;
    }

    setAiLoading(true);

    try {
      setAiStep('🎙️ 음성 변환 중...');
      const res = await fetch(`${getApiBase()}/api/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: meeting.video_url })
      });

      if (!res.ok) throw new Error('서버 오류');

      setAiStep('📝 요약 생성 중...');
      const data = await res.json();

      // Supabase에 저장
      setAiStep('💾 저장 중...');
      await supabase
        .from('meetings')
        .update({ summary: data.summary })
        .eq('id', meetingId);

      await fetchMeeting();
      alert('AI 요약이 완성됐어요! 🎉');

    } catch (err) {
      console.error('AI 요약 실패:', err);
      alert('AI 요약 실패했어요. 다시 시도해주세요.');
    }

    setAiLoading(false);
    setAiStep('');
  };

 const downloadSummary = () => {
  if (!meeting?.summary) return;

  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  printWindow.document.write(`
    <html>
      <head>
        <meta charset="utf-8">
        <title>${meeting.title}_회의록</title>
        <style>
          body { font-family: 'Malgun Gothic', sans-serif; padding: 40px; line-height: 1.8; color: #333; }
          h1 { font-size: 22px; margin-bottom: 6px; color: #111; }
          .date { color: #888; font-size: 13px; margin-bottom: 28px; }
          hr { border: none; border-top: 1px solid #eee; margin-bottom: 24px; }
          .content { font-size: 14px; white-space: pre-wrap; line-height: 2; }
        </style>
      </head>
      <body>
        <h1>${meeting.title}</h1>
        <div class="date">📅 ${formatDate(meeting.date)} · 🕐 ${formatTime(meeting.date)}</div>
        <hr />
        <div class="content">${meeting.summary}</div>
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
          <video
            src={meeting.video_url}
            controls
            style={{ width: '100%', borderRadius: 8, background: '#000', maxHeight: 400 }}
          />
        ) : (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#aaa' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>🎬</div>
            <div style={{ fontSize: 14, color: '#555' }}>녹화 파일이 없어요</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>회의가 끝나면 자동으로 저장돼요</div>
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

        {/* 요약 내용 표시 */}
        {!aiLoading && !editingSummary && meeting.summary && (
          <div style={{ fontSize: 13, lineHeight: 1.9, color: '#333', background: '#f9f9f9', padding: '16px 18px', borderRadius: 8, borderLeft: '3px solid #1D9E75', whiteSpace: 'pre-wrap' }}>
            {meeting.summary}
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