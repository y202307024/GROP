import { BrowserRouter, Routes, Route } from 'react-router-dom'
import MeetingRecordingRecovery from './components/MeetingRecordingRecovery'
import { useStageScale } from './hooks/useStageScale'
import Login from './pages/Login'
import SignUp from './pages/SignUp'
import MainPage from './pages/MainPage'
import CreateRoom from './pages/CreateRoom'
import Room from './pages/Room'
import GroupProfile from './pages/GroupProfile'
import DefaultProfile from './pages/DefaultProfile'
import SetupProfile from './pages/SetupProfile';
import GroupPage from './pages/GroupPage'
import GroupListPage from './pages/GroupListPage'
import GroupSettings from './pages/GroupSettings'
import NoticeList from './pages/NoticeList'
import DocumentList from './pages/DocumentList'
import MeetingDetail from './pages/MeetingDetail'
import MemberList from './pages/MemberList'
import CanvasPage from './pages/CanvasPage'
import AiSummaryPage from './pages/AiSummaryPage'
import AiMeetingList from './pages/AiMeetingList'
import CalendarPage from './pages/CalendarPage'
import JoinGroupPage from './pages/JoinGroupPage'
import TimelapsePage from './pages/TimelapsePage'
import NotFound from './pages/NotFound'


export default function App() {
  // .stage(모든 페이지가 공유하는 1440x900 고정 캔버스)를 실제 창 크기에 맞춰 스케일합니다.
  // — 노트북마다 해상도/화면비가 달라도 항상 같은 비율로 보이게 하기 위함.
  useStageScale();

  return (
    <BrowserRouter>
      {/* 회의방을 나간 뒤에도 실패한 녹화의 다시 시도·내 컴퓨터 저장이 보이게 합니다. */}
      <MeetingRecordingRecovery />
      <Routes>
        <Route path="/join/:code" element={<JoinGroupPage />} />
        <Route path="/" element={<Login />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/main" element={<MainPage />} />
        <Route path="/create" element={<CreateRoom />} />
        <Route path="/room/:id" element={<Room />} />
        <Route path="/profile" element={<DefaultProfile />} />
        <Route path="/group/:groupId/profile" element={<GroupProfile />} />
        <Route path="/setup-profile" element={<SetupProfile />} />
        <Route path="/groups" element={<GroupListPage />} />
        <Route path="/group/:id" element={<GroupPage />} />
        <Route path="/group/:id/settings" element={<GroupSettings />} />
        <Route path="/documents" element={<DocumentList />} />
        <Route path="/group/:id/meeting/:meetingId" element={<MeetingDetail />} />
        <Route path="/group/:id/members" element={<MemberList />} />
        <Route path="/group/:id/notices" element={<NoticeList />} />
        <Route path="/group/:id/canvas" element={<CanvasPage />} />
        <Route path="/canvas" element={<CanvasPage />} />
        <Route path="/ai" element={<AiMeetingList />} />
        <Route path="/ai/:meetingId" element={<AiSummaryPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/timelapse" element={<TimelapsePage />} />
        {/* 등록되지 않은 경로는 흰 화면 대신 안내 페이지로 */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  )
}