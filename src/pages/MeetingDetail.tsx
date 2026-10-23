import { useParams, useNavigate, useLocation } from 'react-router-dom';
import MeetingDetailView from '../components/MeetingDetailView';

/**
 * 회의록 상세 페이지 (단독 라우트)
 * 본문은 MeetingDetailView 로 옮겨 AI 요약 탭과 공유합니다.
 */
export default function MeetingDetail() {
  const { id: groupId, meetingId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  if (!meetingId) return null;

  const backToMeetings = () => {
    if (from === 'documents') {
      navigate('/documents');
      return;
    }
    if (from === 'meetings') {
      navigate('/meetings');
      return;
    }
    navigate(`/group/${groupId}/meetings`);
  };

  return (
    <MeetingDetailView
      meetingId={meetingId}
      backLabel={from === 'documents' ? '문서 목록' : '회의록 목록'}
      onBack={backToMeetings}
    />
  );
}
