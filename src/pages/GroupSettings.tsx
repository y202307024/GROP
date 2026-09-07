import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import VoiceSettingsPanel from '../components/VoiceSettingsPanel';
import { supabase } from '../supabaseClient';
import AppShell from '../components/AppShell';

/** 그룹 설정 — grop/css/setting.css 카드 레이아웃을 그대로 사용합니다. */
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
    <AppShell activePage="setting">
      <div className="page">
        <div className="page-header">
          <h1>설정</h1>
        </div>

        <div className="settings-card">
          <div className="settings-section">
            <h3>그룹 이름</h3>
            <p className="settings-desc">다른 멤버에게 보이는 그룹 이름입니다.</p>
            <div className="settings-row">
              <label htmlFor="groupName">그룹 이름</label>
              <input id="groupName" className="settings-field" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <button className="primary-button" type="button" onClick={saveName}>저장하기</button>
          </div>

          <div className="settings-section">
            <h3>초대코드</h3>
            <p className="settings-desc">이 코드를 공유하면 그룹에 참여할 수 있습니다.</p>
            <div className="settings-row">
              <label>초대코드</label>
              <input className="settings-field" value={inviteCode} disabled />
            </div>
            <button className="secondary-button" type="button" onClick={copyCode}>
              {copied ? '복사됨' : '복사'}
            </button>
          </div>

          <div className="settings-section">
            <h3>음성</h3>
            <p className="settings-desc">마이크와 스피커를 미리 확인하고 조절합니다.</p>
            <VoiceSettingsPanel hideHeading />
          </div>

          <div className="settings-section">
            <button className="danger-button" type="button" onClick={() => navigate(`/group/${id}`)}>
              그룹으로 돌아가기
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
