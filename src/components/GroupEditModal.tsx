import { useEffect, useRef, useState } from 'react';
import { createScaledPortal } from './AppScaleLayer';
import { supabase } from '../services/supabaseClient';
import { getAvatarSrc } from '../utils/avatarOptions';
import Icon from './Icon';
import GroupProfileEditModal from './GroupProfileEditModal';
import styles from './GroupEditModal.module.css';

export type GroupEditMember = {
  user_id: string;
  nickname: string;
  avatar: string;
};

type Props = {
  open: boolean;
  groupId: string;
  groupName: string;
  /** 그룹 상세 페이지의 메모 배너와 세션 동안 공유하는 값 (DB에 저장되진 않습니다). */
  groupMemo: string;
  /**
   * 멤버 목록 — GroupPage/MemberList와 똑같이 "배열의 첫 번째가 방장"이라는 규칙을 따릅니다.
   * (group_members에 role 컬럼이 없어서 이 프로젝트 전체가 이 방식으로 방장을 구분하고 있습니다.)
   */
  members: GroupEditMember[];
  currentUserId: string;
  onClose: () => void;
  /** 그룹 이름 저장이 성공했을 때 호출 — 호출한 쪽(GroupPage)이 화면에 바로 반영할 수 있도록 알려줍니다. */
  onSaved: (name: string, memo: string) => void;
  /** 내 "그룹 프로필 편집"을 저장했을 때 호출 — 호출한 쪽이 멤버 목록(이름/아바타)을 다시 불러옵니다. */
  onMemberProfileSaved?: () => void;
};

/**
 * 그룹 편집 모달 — grop/pages/group-detail.html + group-edit-modal.css/js를
 * 리액트로 옮기면서, 피그마 새 디자인(그룹 정보/멤버 권한 2단 구성 + 안내 문구)에 맞춰
 * 레이아웃을 조금 더 추가했습니다. 새로 추가된 레이아웃(subtitle, 2단 구성, 사진 영역,
 * 하단 안내문)은 GroupEditModal.module.css에 모아뒀고, 모달 틀/입력창/버튼/멤버 권한 줄은
 * 기존 global css(.modal-overlay, .profile-modal-*, .group-edit-*)를 그대로 재사용합니다.
 */
export default function GroupEditModal({
  open,
  groupId,
  groupName,
  groupMemo,
  members,
  currentUserId,
  onClose,
  onSaved,
  onMemberProfileSaved,
}: Props) {
  const [name, setName] = useState(groupName);
  /**
   * 그룹 메모 / 대표 이미지 / 멤버 권한 변경은 전부 화면에서만 동작합니다.
   * groups 테이블에 memo·avatar 컬럼이 없고 group_members에도 role 컬럼이 없어서,
   * 지금은 저장을 눌러도 그룹 "이름"만 실제로 저장되고 나머지는 모달을 다시 열면 초기화됩니다.
   * 실제로 저장하려면 DB 스키마 추가가 먼저 필요합니다.
   */
  const [memo, setMemo] = useState('');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [roleDraft, setRoleDraft] = useState<Record<string, '멤버' | '리더'>>({});
  const [saving, setSaving] = useState(false);
  /** 내 줄을 눌렀을 때 뜨는 "그룹 프로필 편집" 팝업 */
  const [profileOpen, setProfileOpen] = useState(false);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 모달을 열 때마다 입력값을 현재 그룹 이름/메모 기준으로 되돌립니다.
  useEffect(() => {
    if (!open) return;
    setName(groupName);
    setMemo(groupMemo);
    setAvatarPreview(null);
    setRoleDraft({});
    setProfileOpen(false);
  }, [open, groupName, groupMemo]);

  if (!open) return null;

  // 방장 = 배열의 첫 번째(이 프로젝트 전체 규칙). 줄 순서를 바꾸기 전에 먼저 구해 둬야 합니다.
  const ownerId = members[0]?.user_id;
  /**
   * 방장이 아니면(= 멤버 권한) 이 화면은 읽기 전용입니다: 그룹 이름·메모·이미지·권한을 바꿀 수 없고
   * 저장 버튼도 없습니다. (서버 RLS가 아니라 화면에서만 막는 것이라, 서버 쪽 제한은 따로 필요합니다.)
   */
  const readOnly = !currentUserId || currentUserId !== ownerId;
  // 내 프로필 줄을 맨 위로 — 나머지는 원래 순서를 유지합니다.
  const me = members.find((m) => m.user_id === currentUserId);
  const orderedMembers = me ? [me, ...members.filter((m) => m.user_id !== currentUserId)] : members;

  const initial = groupName.trim().charAt(0) || 'G';

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 업로드 API가 따로 없어서, 레거시 group-edit-modal.js와 똑같이 미리보기만 보여줍니다.
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setAvatarPreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      nameInputRef.current?.focus();
      return;
    }

    setSaving(true);
    const { error } = await supabase.from('groups').update({ name: trimmed }).eq('id', groupId);
    setSaving(false);

    if (error) {
      alert(`저장 실패: ${error.message}`);
      return;
    }

    onSaved(trimmed, memo.trim());
    onClose();
  };

  // createPortal로 body에 직접 그립니다 — AppShell의 .app이 transform: scale()을 가져서 그 안의
  // position: fixed 배경(.modal-overlay)이 화면이 아니라 .app 기준이 되어 화면을 다 못 덮었습니다.
  return (
    <>
    {createScaledPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`group-edit-modal ${styles.modal}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="groupEditModalTitle"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="profile-modal-header">
          <div>
            <h2 id="groupEditModalTitle">그룹 편집</h2>
            <p className={styles.subtitle}>
              {readOnly ? '그룹 정보와 멤버 권한을 확인할 수 있어요.' : '그룹 정보와 멤버 권한을 관리하세요.'}
            </p>
          </div>
          <button className="modal-close-button" type="button" aria-label="닫기" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className={styles.photoSection}>
          <div className={styles.photoPreview}>
            {avatarPreview ? <img src={avatarPreview} alt="" /> : initial}
          </div>
          <div>
            <button
              type="button"
              className={`secondary-button ${styles.photoButton}`}
              disabled={readOnly}
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon name="image" />
              이미지 변경
            </button>
            <p className={styles.photoCaption}>PNG, JPG · 최대 5MB</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg"
            hidden
            onChange={handlePhotoChange}
          />
        </div>

        <div className={styles.body}>
          <div className={styles.column}>
            <div className="profile-field">
              <label htmlFor="groupEditNameInput">그룹 이름</label>
              <input
                id="groupEditNameInput"
                ref={nameInputRef}
                className="profile-input"
                maxLength={20}
                value={name}
                readOnly={readOnly}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            {/* 그룹 메모 칸은 왼쪽 열에 남는 높이를 채웁니다(모달 전체 크기는 그대로) */}
            <div className={`profile-field ${styles.memoField}`}>
              <label htmlFor="groupEditMemoInput">그룹 메모</label>
              <textarea
                id="groupEditMemoInput"
                className="profile-input group-edit-textarea"
                maxLength={80}
                value={memo}
                readOnly={readOnly}
                onChange={(e) => setMemo(e.target.value)}
              />
            </div>
          </div>

          <div className={styles.column}>
            <div className="group-edit-permission-title">
              멤버 권한
              <span className="group-edit-permission-hint"> · 리더만 변경할 수 있어요</span>
            </div>

            {/* 멤버가 많아져도 모달이 세로로 길어지지 않게, 멤버 줄은 고정 높이 박스 안에서만 스크롤합니다 */}
            <div className={styles.memberList}>
            {/* 내 줄이 맨 위. 방장(배지 고정)은 members[0], 나머지는 멤버/방장 드롭다운(화면에서만 동작).
                읽기 전용이면 드롭다운 대신 글자로만 보여줍니다. */}
            {orderedMembers.map((m) => {
              const isOwner = m.user_id === ownerId;
              const isMe = m.user_id === currentUserId;
              return (
                <div className="group-edit-member-row" key={m.user_id}>
                  {/* 내 줄은 눌러서 "그룹 프로필 편집"을 엽니다 */}
                  <div
                    className={`group-edit-member-info${isMe ? ` ${styles.myRowInfo}` : ''}`}
                    {...(isMe
                      ? {
                          role: 'button',
                          tabIndex: 0,
                          title: '그룹 프로필 편집',
                          onClick: () => setProfileOpen(true),
                          onKeyDown: (e: React.KeyboardEvent) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setProfileOpen(true);
                            }
                          },
                        }
                      : {})}
                  >
                    <div className="mini-avatar">
                      <img src={getAvatarSrc(m.avatar)} alt="" />
                    </div>
                    {m.nickname}
                    {isMe && <span className="group-edit-me-tag">(나)</span>}
                  </div>
                  {isOwner ? (
                    <span className="group-edit-role-badge">👑 리더</span>
                  ) : readOnly ? (
                    <span className={styles.roleText}>{m.user_id in roleDraft ? roleDraft[m.user_id] : '멤버'}</span>
                  ) : (
                    <select
                      className="group-edit-role-select"
                      value={roleDraft[m.user_id] ?? '멤버'}
                      onChange={(e) =>
                        setRoleDraft((prev) => ({
                          ...prev,
                          [m.user_id]: e.target.value as '멤버' | '리더',
                        }))
                      }
                    >
                      <option value="멤버">멤버</option>
                      <option value="리더">리더</option>
                    </select>
                  )}
                </div>
              );
            })}
            </div>
          </div>
        </div>

        {readOnly ? (
          // 읽기 전용: 저장할 게 없으니 안내 문구 대신 "방장만 수정할 수 있어요"와 닫기 버튼만
          <>
            <div className={styles.footerNote}>
              <Icon name="info" className={styles.footerNoteIcon} />
              그룹 정보는 리더만 수정할 수 있어요. 내 프로필 줄을 누르면 그룹 프로필을 편집할 수 있어요.
            </div>
            <div className="profile-modal-actions">
              <button className="secondary-button" type="button" onClick={onClose}>
                닫기
              </button>
            </div>
          </>
        ) : (
          <>
            <div className={styles.footerNote}>
              <Icon name="info" className={styles.footerNoteIcon} />
              변경한 내용은 저장 후 적용돼요.
            </div>

            <div className="profile-modal-actions">
              <button className="secondary-button" type="button" onClick={onClose}>
                취소
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={saving}
                onClick={() => {
                  void handleSave();
                }}
              >
                {saving ? '저장 중...' : '저장하기'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    )}

    {/* 내 그룹 프로필 편집 팝업 — 그룹 편집 모달 위에 겹쳐 뜹니다.
        React 이벤트는 portal을 따라 부모로 번지기 때문에, 위 overlay(onClick=onClose) 안이 아니라
        형제로 둬야 이 팝업을 눌러도 그룹 편집 모달이 같이 닫히지 않습니다. */}
    <GroupProfileEditModal
      open={profileOpen}
      groupId={groupId}
      onClose={() => setProfileOpen(false)}
      onSaved={() => onMemberProfileSaved?.()}
    />
    </>
  );
}
