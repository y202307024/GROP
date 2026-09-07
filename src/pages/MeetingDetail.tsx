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
  const fromDocuments = (location.state as { from?: string } | null)?.from === 'documents';

  if (!meetingId) return null;

  return (
    <MeetingDetailView
      meetingId={meetingId}
      backLabel={fromDocuments ? '문서 목록' : '회의록 목록'}
      onBack={() => navigate(fromDocuments ? '/documents' : `/group/${groupId}/meetings`)}
    />
  );
}
