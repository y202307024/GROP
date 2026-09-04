import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Login from './pages/Login'
import SignUp from './pages/SignUp'
import MainPage from './pages/MainPage'
import CreateRoom from './pages/CreateRoom'
import Room from './pages/Room'
import GroupProfile from './pages/GroupProfile'
import DefaultProfile from './pages/DefaultProfile'
import SetupProfile from './pages/SetupProfile';
import GroupPage from './pages/GroupPage'
import GroupSettings from './pages/GroupSettings'
import MeetingList from './pages/MeetingList'
import MeetingDetail from './pages/MeetingDetail'
import MemberList from './pages/MemberList'
import CanvasPage from './pages/CanvasPage'
import JoinGroupPage from './pages/JoinGroupPage'
import TimelapsePage from './pages/TimelapsePage'
import NotFound from './pages/NotFound'


export default function App() {
  return (
    <BrowserRouter>
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
        <Route path="/group/:id" element={<GroupPage />} />
        <Route path="/group/:id/settings" element={<GroupSettings />} />
        <Route path="/group/:id/meetings" element={<MeetingList />} />
        <Route path="/group/:id/meeting/:meetingId" element={<MeetingDetail />} />
        <Route path="/group/:id/members" element={<MemberList />} />
        <Route path="/group/:id/canvas" element={<CanvasPage />} />
        <Route path="/canvas" element={<CanvasPage />} />
        <Route path="/timelapse" element={<TimelapsePage />} />
        {/* 등록되지 않은 경로는 흰 화면 대신 안내 페이지로 */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  )
}