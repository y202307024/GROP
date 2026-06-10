import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LiveKitRoom, useLocalParticipant, useParticipants } from '@livekit/components-react';
import '@livekit/components-styles';
import { supabase } from '../services/supabaseClient';
import { getApiBase } from '../utils/apiBase';

function RoomContent({ onLeave, onStartRecord, isRecording, avatar, userName }: {
  onLeave: () => void,
  onStartRecord: () => void,
  isRecording: boolean,
  avatar: string,
  userName: string
}) {
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  const [micOn, setMicOn] = useState(true);

  const toggleMic = () => {
    localParticipant.setMicrophoneEnabled(!micOn);
    setMicOn(!micOn);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 24, padding: 40 }}>
        {participants.map((p) => (
          <div key={p.identity} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 80, height: 80, borderRadius: '50%', background: '#5865f2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, border: p.isSpeaking ? '3px solid #57f287' : '3px solid transparent' }}>
              🐱
            </div>
            <span style={{ color: 'white', fontSize: 13 }}>{p.identity}</span>
            <span style={{ fontSize: 11, color: p.isSpeaking ? '#57f287' : '#949ba4' }}>
              {p.isSpeaking ? '🎙️ 말하는 중' : '🔇 대기 중'}
            </span>
          </div>
        ))}
      </div>

      {isRecording && (
        <div style={{ textAlign: 'center', padding: '6px', background: '#3a1a1a', color: '#ed4245', fontSize: 12 }}>
          🔴 녹음 중...
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', background: '#232428', borderTop: '1px solid #1a1b1e', height: 52 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#5865f2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
            {avatar}
          </div>
          <div>
            <div style={{ color: 'white', fontSize: 12, fontWeight: 600 }}>{userName}</div>
            <div style={{ color: '#57f287', fontSize: 10 }}>● 연결됨</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={toggleMic} title={micOn ? '마이크 끄기' : '마이크 켜기'} style={{
            width: 36, height: 36, borderRadius: 8, border: 'none', cursor: 'pointer',
            background: micOn ? '#35373c' : '#ed4245', color: 'white', fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            {micOn ? '🎙️' : '🔇'}
          </button>
          <button onClick={onStartRecord} title={isRecording ? '녹음 중 (나가면 자동저장)' : '녹음 시작'} style={{
            width: 36, height: 36, borderRadius: 8, border: 'none', cursor: 'pointer',
            background: isRecording ? '#ed4245' : '#35373c', color: 'white', fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            {isRecording ? '⏹️' : '🔴'}
          </button>
          <button onClick={onLeave} title="나가기" style={{
            width: 36, height: 36, borderRadius: 8, border: 'none', cursor: 'pointer',
            background: '#ed4245', color: 'white', fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            📞
          </button>
        </div>

        <div style={{ width: 80 }} />
      </div>
    </div>
  );
}

export default function Room() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [userName, setUserName] = useState('');
  const [avatar, setAvatar] = useState('🐱');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const groupIdRef = useRef(id);

  useEffect(() => {
    const init = async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) { navigate('/'); return; }

      const { data: profile } = await supabase
        .from('profiles').select('nickname, avatar')
        .eq('id', userData.user.id).maybeSingle();

      const name = profile?.nickname || userData.user.email || '익명';
      setUserName(name);
      setAvatar(profile?.avatar || '🐱');

      const res = await fetch(`${getApiBase()}/api/livekit-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName: id, userName: name })
      });
      const data = await res.json();
      setToken(data.token);
      setLoading(false);
    };
    init();

    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  // ✅ 팝업 없이 마이크 오디오만 자동 녹음
  const startRecording = async () => {
    if (isRecording) return;
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: true
      });

      const mediaRecorder = new MediaRecorder(audioStream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };

      mediaRecorder.start(1000);
      setIsRecording(true);
      console.log('녹음 시작!');
    } catch (err) {
      console.error('녹음 시작 실패:', err);
      alert('마이크 권한이 필요해요!');
    }
  };

  const handleLeave = async () => {
    setSaving(true);

    console.log('=== 회의 종료 ===');
    console.log('녹음 청크 수:', recordedChunksRef.current.length);
    console.log('녹음 상태:', mediaRecorderRef.current?.state);

    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      console.log('중지 후 청크 수:', recordedChunksRef.current.length);

      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const titleStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 회의`;

      const { data: userData } = await supabase.auth.getUser();
      let videoUrl = null;

      if (recordedChunksRef.current.length > 0) {
        // ✅ 오디오 파일로 저장
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
        console.log('blob 크기:', blob.size);

        const fileName = `${groupIdRef.current}/${dateStr}/${Date.now()}.webm`;
        console.log('업로드 경로:', fileName);

        const { error: uploadError } = await supabase.storage
          .from('meeting-videos')
          .upload(fileName, blob);

        if (uploadError) {
          console.error('업로드 실패:', uploadError);
        } else {
          const { data: urlData } = supabase.storage
            .from('meeting-videos')
            .getPublicUrl(fileName);
          videoUrl = urlData.publicUrl;
          console.log('업로드 성공! URL:', videoUrl);
        }
      } else {
        console.log('청크 없음 - 녹음 안 됨');
      }

      const { error: insertError } = await supabase.from('meetings').insert({
        group_id: groupIdRef.current,
        title: titleStr,
        date: now.toISOString(),
        video_url: videoUrl,
        created_by: userData.user?.id,
      });

      if (insertError) console.error('회의록 저장 실패:', insertError);
      else console.log('회의록 저장 성공!');

    } catch (err) {
      console.error('오류:', err);
    }

    setSaving(false);
    navigate(`/group/${id}`);
  };

  if (loading) return (
    <div style={{ height: '100vh', background: '#1e1f22', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 18 }}>
      🎙️ 연결 중...
    </div>
  );

  if (saving) return (
    <div style={{ height: '100vh', background: '#1e1f22', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white', gap: 16 }}>
      <div style={{ fontSize: 40 }}>💾</div>
      <div style={{ fontSize: 18 }}>회의록 저장 중...</div>
      <div style={{ fontSize: 13, color: '#949ba4' }}>잠시만 기다려주세요</div>
    </div>
  );

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#1e1f22', fontFamily: 'sans-serif' }}>
      <div style={{ padding: '0 16px', background: '#1a1b1e', color: 'white', display: 'flex', alignItems: 'center', gap: 8, height: 48, borderBottom: '1px solid #2f3136' }}>
        <span style={{ color: '#949ba4', fontSize: 20 }}>🔊</span>
        <span style={{ fontWeight: 600, fontSize: 15 }}>회의 채널</span>
        <span style={{ fontSize: 11, color: '#57f287', background: '#1a3a2a', padding: '2px 8px', borderRadius: 10, marginLeft: 4 }}>● 진행 중</span>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ width: 240, background: '#2b2d31', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 8px 4px 16px', fontSize: 11, color: '#949ba4', fontWeight: 700, letterSpacing: 1 }}>
            연결됨
          </div>
          <div style={{ padding: '2px 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 4 }}>
              <div style={{ position: 'relative' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#5865f2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
                  {avatar}
                </div>
                <div style={{ position: 'absolute', bottom: -1, right: -1, width: 10, height: 10, background: '#57f287', borderRadius: '50%', border: '2px solid #2b2d31' }} />
              </div>
              <span style={{ color: '#dbdee1', fontSize: 14 }}>{userName}</span>
              <span style={{ marginLeft: 'auto', fontSize: 14, color: '#949ba4' }}>🎙️</span>
            </div>
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#313338' }}>
          <LiveKitRoom
            token={token}
            serverUrl={import.meta.env.VITE_LIVEKIT_URL}
            connect={true}
            audio={true}
            video={false}
            style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
          >
            <RoomContent
              onLeave={handleLeave}
              onStartRecord={startRecording}
              isRecording={isRecording}
              avatar={avatar}
              userName={userName}
            />
          </LiveKitRoom>
        </div>
      </div>
    </div>
  );
}