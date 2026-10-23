import { useState, useEffect, useRef } from 'react';
import { supabase } from '../services/supabaseClient';
import { useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import VoiceSettingsPanel from '../components/VoiceSettingsPanel';
import voiceVolumeIcon from '../assets/voice/voice-volume.svg';
import { AVATAR_OPTIONS, DEFAULT_AVATAR_KEY, getAvatarSrc } from '../utils/avatarOptions';
import styles from './DefaultProfile.module.css';

const MAX_FILE_SIZE_MB = 3;
const MIN_PASSWORD_LENGTH = 6;

// 앱 전체에서 쓰이는 "기본 프로필" (그룹별로 따로 설정 안 하면 이게 대신 보임)
// 피그마 "설정 페이지" export(계정설정 탭)를 반영한 화면입니다.
// 아바타 선택 박스 표시 순서 — 피그마는 위에서 아래로 한 열씩(햄스터/거북이/고양이 → 문어/돼지/판다 →
// 벌/아홀로틀/펭귄 → 양/병아리/해파리) 채웁니다. AVATAR_OPTIONS는 다른 화면(프로필 모달 등)도 같이
// 쓰는 배열이라 순서를 바꾸지 않고, 이 페이지에서만 정렬해서 씁니다.
const FIGMA_AVATAR_ORDER = [
  'hamster', 'turtle', 'cat', 'octopus', 'pig', 'panda',
  'bee', 'axolotl', 'penguin', 'sheep', 'chick', 'jellyfish',
];
const ORDERED_AVATARS = [...AVATAR_OPTIONS].sort(
  (a, b) => FIGMA_AVATAR_ORDER.indexOf(a.key) - FIGMA_AVATAR_ORDER.indexOf(b.key),
);

export default function DefaultProfile() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** 계정설정 / 음성 탭 */
  const [activeTab, setActiveTab] = useState<'account' | 'voice'>('account');

  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState(DEFAULT_AVATAR_KEY);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  /**
   * 이름 / 연락처 / 소속 — 피그마 디자인엔 있지만 profiles 테이블엔 저장할 컬럼이 아직 없어서,
   * 화면에만 반영하고 입력값은 저장하지 않습니다. (나중에 컬럼이 추가되면 fetchProfile/handleSave에
   * 실제 값을 채우고 저장하도록 연결하면 됩니다.)
   */
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [affiliation, setAffiliation] = useState('');

  /** 새 비밀번호 / 확인 — Supabase Auth로 실제로 바뀝니다 (둘 다 비워두면 비밀번호는 그대로 둡니다) */
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    const fetchProfile = async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) { navigate('/'); return; }
      setUserId(userData.user.id);
      setEmail(userData.user.email ?? '');

      const { data } = await supabase
        .from('profiles')
        .select('nickname, avatar, avatar_url')
        .eq('id', userData.user.id)
        .maybeSingle();

      if (data) {
        setNickname(data.nickname ?? '');
        setSelectedAvatar(data.avatar ?? DEFAULT_AVATAR_KEY);
        setAvatarUrl(data.avatar_url ?? null);
      }
      setLoading(false);
    };
    fetchProfile();
  }, [navigate]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;

    if (!file.type.startsWith('image/')) {
      alert('이미지 파일만 업로드할 수 있어요');
      return;
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      alert(`이미지 용량은 ${MAX_FILE_SIZE_MB}MB 이하로 올려주세요`);
      return;
    }

    setUploading(true);
    const ext = file.name.split('.').pop();
    const path = `${userId}/default-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true });

    if (uploadError) {
      alert(`사진 업로드 실패: ${uploadError.message}`);
      setUploading(false);
      return;
    }

    const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(path);
    setAvatarUrl(publicUrlData.publicUrl);
    setUploading(false);
  };

  const handleSave = async () => {
    if (!nickname.trim()) { alert('닉네임을 입력해주세요'); return; }
    if (!userId) return;

    // 새 비밀번호를 하나라도 입력했으면 저장 전에 먼저 확인합니다.
    // 둘 다 비워두면 비밀번호는 그대로 두고 프로필만 저장합니다.
    const wantsPasswordChange = newPassword.length > 0 || confirmPassword.length > 0;
    if (wantsPasswordChange) {
      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        alert(`새 비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 해요`);
        return;
      }
      if (newPassword !== confirmPassword) {
        alert('새 비밀번호가 서로 달라요');
        return;
      }
    }

    setSaving(true);
    const { error } = await supabase.from('profiles').upsert({
      id: userId,
      nickname,
      avatar: selectedAvatar,
      avatar_url: avatarUrl,
    });

    if (error) {
      setSaving(false);
      alert(`저장 실패: ${error.message}`);
      return;
    }

    if (wantsPasswordChange) {
      const { error: passwordError } = await supabase.auth.updateUser({ password: newPassword });
      if (passwordError) {
        setSaving(false);
        alert(`프로필은 저장됐지만 비밀번호 변경에는 실패했어요: ${passwordError.message}`);
        return;
      }
      setNewPassword('');
      setConfirmPassword('');
    }

    setSaving(false);
    alert('기본 프로필이 저장되었습니다!');
    navigate('/main');
  };

  /** 전체 설정에서 로그아웃 — 세션 종료 후 로그인 화면으로 */
  const handleLogout = async () => {
    if (!confirm('로그아웃 하시겠습니까?')) return;
    setLoggingOut(true);
    const { error } = await supabase.auth.signOut();
    setLoggingOut(false);
    if (error) {
      alert(`로그아웃 실패: ${error.message}`);
      return;
    }
    navigate('/');
  };

  if (loading) {
    return (
      <AppShell activePage="setting">
        <div className={styles.page}>불러오는 중...</div>
      </AppShell>
    );
  }

  return (
    <AppShell activePage="setting">
      <div className={styles.page}>
        <div className={styles.header}>
          <h1 className={styles.title}>설정</h1>
          <p className={styles.subtitle}>GROP의 기본 설정을 변경하고, 나에게 맞는 환경을 만들어보세요.</p>
        </div>

        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${activeTab === 'account' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('account')}
          >
            계정
          </button>
          <button
            type="button"
            className={`${styles.tab} ${activeTab === 'voice' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('voice')}
          >
            음성
          </button>
        </div>

        {activeTab === 'account' ? (
          <form
            className={styles.card}
            onSubmit={(e) => { e.preventDefault(); void handleSave(); }}
          >
            <div className={styles.formGrid}>
              <div className={styles.fieldsColumn}>
                <h2 className={styles.sectionTitle}>프로필 관리</h2>
                <p className={styles.sectionDesc}>개인정보를 수정하고 프로필을 관리할 수 있습니다.</p>

                <div className={styles.avatarRow}>
                  {/* 피그마엔 사진 업로드/제거 버튼이 없어서, 아바타 원을 누르면 사진을 올릴 수 있게 했습니다.
                      (제거는 아래 아바타 선택 박스에서 동물을 고르면 올린 사진이 해제되는 걸로 대신합니다) */}
                  <button
                    type="button"
                    className={styles.avatarPreview}
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    aria-label={uploading ? '사진 업로드 중' : '프로필 사진 업로드'}
                    title="클릭해서 사진 업로드"
                  >
                    <img src={avatarUrl || getAvatarSrc(selectedAvatar)} alt="프로필 사진" />
                  </button>
                  <div className={styles.nicknameField}>
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>닉네임</span>
                      <input
                        className={styles.fieldInput}
                        type="text"
                        placeholder="닉네임을 입력하세요"
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                        maxLength={12}
                      />
                    </div>
                    <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} hidden />
                  </div>
                </div>

                <div className={styles.field}>
                  <span className={styles.fieldLabel}>이름</span>
                  <input
                    className={styles.fieldInput}
                    type="text"
                    placeholder="이름을 입력하세요"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>

                {/* 로그인 계정의 실제 이메일을 읽기 전용으로 보여줍니다 (이메일 변경은 지원하지 않음) */}
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>이메일</span>
                  <input className={styles.fieldInput} type="email" value={email} disabled />
                </div>

                <div className={styles.field}>
                  <span className={styles.fieldLabel}>연락처</span>
                  <input
                    className={styles.fieldInput}
                    type="text"
                    placeholder="전화번호를 입력하세요"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>

                <div className={styles.field}>
                  <span className={styles.fieldLabel}>소속</span>
                  <input
                    className={styles.fieldInput}
                    type="text"
                    placeholder="학교 또는 회사명을 입력하세요"
                    value={affiliation}
                    onChange={(e) => setAffiliation(e.target.value)}
                  />
                </div>
              </div>

              {/* 오른쪽 열: 아바타 선택 → 비밀번호 변경 → 취소/저장하기 버튼이 한 열에 세로로 쌓입니다
                  (스크린샷 기준 레이아웃 — 이전엔 비밀번호/버튼이 카드 전체 너비로 따로 떨어져 있었습니다) */}
              <div className={styles.avatarSelection}>
                <div className={styles.avatarPickerBox}>
                  {ORDERED_AVATARS.map((a) => (
                    <button
                      key={a.key}
                      type="button"
                      className={`${styles.avatarChip} ${!avatarUrl && selectedAvatar === a.key ? styles.avatarChipActive : ''}`}
                      onClick={() => { setSelectedAvatar(a.key); setAvatarUrl(null); }}
                    >
                      <img src={a.src} alt="" />
                    </button>
                  ))}
                </div>

                <div className={styles.passwordSection}>
                  <h3 className={styles.passwordSectionTitle}>비밀번호 변경</h3>
                  <div className={styles.passwordRow}>
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>새 비밀번호</span>
                      <input
                        className={styles.fieldInput}
                        type="password"
                        placeholder="새 비밀번호를 입력하세요"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                      />
                    </div>
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>비밀번호 확인</span>
                      <input
                        className={styles.fieldInput}
                        type="password"
                        placeholder="새 비밀번호를 다시 입력하세요"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className={styles.actionButtons}>
                  <button
                    type="button"
                    className="danger-button"
                    disabled={loggingOut}
                    onClick={() => void handleLogout()}
                  >
                    {loggingOut ? '로그아웃 중...' : '로그아웃'}
                  </button>
                  <button type="button" className={styles.cancelButton} onClick={() => navigate('/main')}>
                    취소
                  </button>
                  <button type="submit" className={styles.saveButton} disabled={saving || uploading}>
                    {saving ? '저장 중...' : '저장하기'}
                  </button>
                </div>
              </div>
            </div>
          </form>
        ) : (
          // 계정설정 카드(.card)와 같은 틀(높이 64.84vh, 안쪽 여백, 그림자)을 씁니다.
          <div className={`${styles.card} ${styles.voiceCard}`}>
            <h2 className={styles.voiceTitleRow}>
              {/* 피그마 icon-Volume 2(32px)를 마스크로 그려 글자색을 따라가게 합니다 */}
              <span
                className={styles.voiceTitleIcon}
                style={{ '--icon-url': `url(${JSON.stringify(voiceVolumeIcon)})` } as React.CSSProperties}
                aria-hidden="true"
              />
              음성
            </h2>
            <p className={styles.voiceDesc}>마이크와 헤드셋을 고르고 음량을 조절합니다. 장치가 없으면 없음을 선택하세요. 회의방에 그대로 적용됩니다.</p>
            <VoiceSettingsPanel hideHeading />
          </div>
        )}
      </div>
    </AppShell>
  );
}
