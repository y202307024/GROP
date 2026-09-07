import { useState } from 'react';
import Icon from './Icon';

type Props = {
  open: boolean;
  groupName: string;
  inviteInput: string;
  joinMsg: string;
  joinSuccess: boolean;
  onClose: () => void;
  onGroupNameChange: (value: string) => void;
  onInviteChange: (value: string) => void;
  onCreate: () => void;
  onJoin: () => void;
};

/**
 * 그룹 추가 모달 — grop/css/group-modal.css 클래스명을 그대로 사용합니다.
 */
export default function GroupModal({
  open,
  groupName,
  inviteInput,
  joinMsg,
  joinSuccess,
  onClose,
  onGroupNameChange,
  onInviteChange,
  onCreate,
  onJoin,
}: Props) {
  const [tab, setTab] = useState<'create' | 'join'>('create');

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="group-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="profile-modal-header">
          <h2>그룹 추가</h2>
          <button className="modal-close-button" type="button" aria-label="닫기" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="group-modal-tabs">
          <button
            className={`group-tab${tab === 'create' ? ' is-active' : ''}`}
            type="button"
            onClick={() => setTab('create')}
          >
            그룹 만들기
          </button>
          <button
            className={`group-tab${tab === 'join' ? ' is-active' : ''}`}
            type="button"
            onClick={() => setTab('join')}
          >
            초대코드로 참여
          </button>
        </div>

        {tab === 'create' ? (
          <div className="group-panel">
            <div className="profile-field">
              <label htmlFor="groupNameInput">그룹 이름</label>
              <input
                id="groupNameInput"
                className="profile-input"
                placeholder="예: 디자인팀 그룹"
                maxLength={20}
                value={groupName}
                onChange={(e) => onGroupNameChange(e.target.value)}
              />
            </div>
            <p className="group-modal-message" />
            <button className="primary-button group-submit-button" type="button" onClick={onCreate}>
              그룹 생성하기
            </button>
          </div>
        ) : (
          <div className="group-panel">
            <div className="profile-field">
              <label htmlFor="inviteCodeInput">초대코드</label>
              <input
                id="inviteCodeInput"
                className="profile-input group-invite-input"
                placeholder="예: GRP-AB12C"
                maxLength={16}
                value={inviteInput}
                onChange={(e) => onInviteChange(e.target.value)}
              />
            </div>
            <p className={`group-modal-message${joinSuccess ? ' is-success' : ''}`}>{joinMsg}</p>
            <button className="primary-button group-submit-button" type="button" onClick={onJoin}>
              그룹 참여하기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
