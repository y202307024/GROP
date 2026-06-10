import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './App.css'
import Login from './pages/Login'
import SignUp from './pages/SignUp'
import MainPage from './pages/MainPage'
import CreateRoom from './pages/CreateRoom'
import Room from './pages/Room'
import Profile from './pages/Profile'
import SetupProfile from './pages/SetupProfile';
import GroupPage from './pages/GroupPage'
import GroupSettings from './pages/GroupSettings'


export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/main" element={<MainPage />} />
        <Route path="/create" element={<CreateRoom />} />
        <Route path="/room/:id" element={<Room />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/setup-profile" element={<SetupProfile />} />
        <Route path="/group/:id" element={<GroupPage />} />
        <Route path="/group/:id/settings" element={<GroupSettings />} />
      </Routes>
    </BrowserRouter>
  )
}