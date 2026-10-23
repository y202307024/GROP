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

  // 회의록 목록 페이지를 없앴으므로, 문서 목록에서 온 게 아니면 그룹 상세로 돌아갑니다.
  const backToMeetings = () => {
    if (from === 'documents') {
      navigate('/documents');
      return;
    }
    navigate(`/group/${groupId}`);
  };

  return (
    <MeetingDetailView
      meetingId={meetingId}
      backLabel={from === 'documents' ? '문서 목록' : '그룹'}
      onBack={backToMeetings}
    />
  );
}
