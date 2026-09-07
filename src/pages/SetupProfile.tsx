import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';

const avatars = ['🐱','🐶','🐸','🐼','🦊','🐨','🐯','🦁','🐙','🐬'];

/** 가입 직후 프로필 — grop 프로필 모달 CSS를 페이지로 사용합니다. */
export default function SetupProfile() {
  const [nickname, setNickname] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('🐱');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim()) { alert('닉네임을 입력해주세요'); return; }

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    const { error } = await supabase
      .from('profiles')
      .upsert({ id: userId, nickname, avatar: selectedAvatar });

    if (error) {
      alert(`프로필 저장 실패: ${error.message}`);
    } else {
      navigate('/main');
    }
  };

  return (
    <div className="signup-shell stage" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div className="profile-modal">
        <div className="profile-modal-header">
          <h2>프로필 설정</h2>
        </div>
        <p className="settings-desc">처음 오셨군요! 프로필을 설정해주세요</p>

        <form onSubmit={handleSubmit}>
          <div className="profile-photo-section">
            <div className="profile-photo-preview">{selectedAvatar}</div>
          </div>

          <div className="profile-avatar-section">
            <div className="profile-section-label">아바타 선택</div>
            <div className="avatar-grid">
              {avatars.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={`avatar-option${selectedAvatar === a ? ' is-selected' : ''}`}
                  onClick={() => setSelectedAvatar(a)}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <div className="profile-field">
            <label htmlFor="setup-nickname">닉네임</label>
            <input
              id="setup-nickname"
              className="profile-input"
              type="text"
              placeholder="닉네임 입력"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              required
              maxLength={12}
            />
          </div>

          <div className="profile-modal-actions">
            <button type="submit" className="primary-button">시작하기</button>
          </div>
        </form>
      </div>
    </div>
  );
}
