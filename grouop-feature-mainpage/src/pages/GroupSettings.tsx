import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';

export default function GroupSettings() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    supabase.from('groups').select('*').eq('id', id).single()
      .then(({ data }) => {
        if (data) { setName(data.name); setInviteCode(data.invite_code); }
      });
  }, [id]);

  const saveName = async () => {
    if (!name.trim()) return;
    const { error } = await supabase.from('groups').update({ name }).eq('id', id);
    if (error) alert(`저장 실패: ${error.message}`);
    else alert('그룹 이름이 변경되었습니다!');
  };

  const copyCode = () => {
    navigator.clipboard.writeText(inviteCode).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ maxWidth: 400, margin: '60px auto', fontFamily: 'sans-serif', padding: '0 20px' }}>
      <h2>그룹 설정</h2>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, color: '#888', marginBottom: 6 }}>그룹 이름 변경</div>
        <input value={name} onChange={e => setName(e.target.value)}
          style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', boxSizing: 'border-box', marginBottom: 8 }} />
        <button onClick={saveName}
          style={{ width: '100%', padding: 10, background: '#3498db', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
          저장하기
        </button>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, color: '#888', marginBottom: 6 }}>초대코드</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, padding: 10, background: '#f5f5f5', borderRadius: 8, fontWeight: 600, letterSpacing: 2 }}>
            {inviteCode}
          </div>
          <button onClick={copyCode}
            style={{ padding: '10px 16px', background: copied ? '#2ecc71' : '#eee', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
            {copied ? '✅' : '📋'}
          </button>
        </div>
      </div>

      <button onClick={() => navigate(`/group/${id}`)}
        style={{ width: '100%', padding: 10, background: '#7f8c8d', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
        ⬅️ 돌아가기
      </button>
    </div>
  );
}