import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { joinGroupByInviteCode } from '../utils/joinGroup';

export default function JoinGroupPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [message, setMessage] = useState('초대코드로 그룹 참여 중…');

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      const inviteCode = code?.trim();
      if (!inviteCode) {
        navigate('/main');
        return;
      }

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        navigate('/', { state: { afterLogin: `/join/${inviteCode.toUpperCase()}` } });
        return;
      }

      const result = await joinGroupByInviteCode(inviteCode, userData.user.id);
      if (!mounted) return;

      if (!result.ok) {
        alert(result.error);
        navigate('/main');
        return;
      }

      if (result.alreadyMember) {
        setMessage(`이미 ${result.group.name}에 참여 중입니다. 그룹으로 이동합니다…`);
      } else {
        setMessage(`${result.group.name}에 참여했습니다!`);
      }

      setTimeout(() => navigate(`/group/${result.group.id}`), 600);
    };

    void run();

    return () => {
      mounted = false;
    };
  }, [code, navigate]);

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'sans-serif' }}>
      <div style={{ textAlign: 'center', color: '#374151' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔑</div>
        <div>{message}</div>
      </div>
    </div>
  );
}
