import { useEffect, useState } from 'react';
import { createScaledPortal } from './AppScaleLayer';
import { supabase } from '../services/supabaseClient';
import { getAvatarSrc } from '../utils/avatarOptions';
import styles from './LeaveGroupModal.module.css';

export type LeaveGroupMember = {
  user_id: string;
  nickname: string;
  avatar: string;
};

type Props = {
  open: boolean;
  groupId: string;
  groupName: string;
  /** 리더가 맨 앞인 멤버 목록(get_group_members_with_profiles 순서 그대로) */
  members: LeaveGroupMember[];
  currentUserId: string;
  isLeader: boolean;
  onClose: () => void;
  /** 나가기/위임/삭제가 끝났을 때 — 호출한 쪽이 그룹 목록으로 이동합니다 */
  onLeft: () => void;
};

/** confirm: 일반 멤버 확인 / choice: 리더 선택 / delegate: 새 리더 고르기 / delete: 그룹 삭제 */
type Step = 'confirm' | 'choice' | 'delegate' | 'delete';

/**
 * 그룹 나가기 모달.
 * - 일반 멤버: 한 번 확인 후 leave_group
 * - 리더: "권한 위임 후 나가기" / "그룹 삭제" 중 선택. 혼자 남은 리더는 위임할 사람이 없으니 바로 삭제 단계로 갑니다.
 * 실제 처리는 전부 서버 RPC(08_그룹_나가기.sql)가 권한을 다시 검사하므로, 화면 조작만으로는 우회할 수 없습니다.
 */
export default function LeaveGroupModal({
  open,
  groupId,
  groupName,
  members,
  currentUserId,
  isLeader,
  onClose,
  onLeft,
}: Props) {
  const others = members.filter((m) => m.user_id !== currentUserId);
  const firstStep: Step = !isLeader ? 'confirm' : others.length > 0 ? 'choice' : 'delete';

  const [step, setStep] = useState<Step>(firstStep);
  const [choice, setChoice] = useState<'delegate' | 'delete'>('delegate');
  const [newLeaderId, setNewLeaderId] = useState('');
  const [typedName, setTypedName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // 열 때마다 처음 단계로 되돌립니다(이전에 입력한 그룹 이름이 남아 있으면 안 되므로)
  useEffect(() => {
    if (!open) return;
    setStep(firstStep);
    setChoice('delegate');
    setNewLeaderId('');
    setTypedName('');
    setBusy(false);
    setError('');
  }, [open, firstStep]);

  if (!open) return null;

  const close = () => {
    if (!busy) onClose();
  };

  /** RPC 하나를 실행하고, 실패하면 모달 안에 오류를 보여줍니다 */
  const run = async (fn: string, args: Record<string, string>) => {
    setBusy(true);
    setError('');
    const { error: rpcError } = await supabase.rpc(fn, args);
    if (rpcError) {
      console.error(`${fn} 실패:`, rpcError);
      setError('처리하지 못했어요. 잠시 후 다시 시도해주세요.');
      setBusy(false);
      return;
    }
    onLeft();
  };

  // 그룹 이름을 정확히 입력해야만 삭제 버튼이 켜집니다
  const nameMatches = typedName.trim() === groupName.trim();

  return createScaledPortal(
    // .app 에 transform 이 걸려 있어 fixed 모달은 body 로 빼야 화면 전체를 덮습니다(GroupEditModal과 같은 방식)
    <div className={styles.overlay} onClick={close}>
      <div className={styles.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {step === 'confirm' && (
          <>
            <h2 className={styles.title}>그룹에서 나가시겠어요?</h2>
            <p className={styles.desc}>
              나가면 이 그룹의 회의, 문서, 공지에 더 이상 접근할 수 없어요. 다시 들어오려면 초대 코드가 필요해요.
            </p>
            {error && <div className={styles.error}>{error}</div>}
            <div className={styles.footer}>
              <button type="button" className={styles.secondary} onClick={close} disabled={busy}>
                취소
              </button>
              <button
                type="button"
                className={styles.danger}
                disabled={busy}
                onClick={() => void run('leave_group', { p_group_id: groupId })}
              >
                나가기
              </button>
            </div>
          </>
        )}

        {step === 'choice' && (
          <>
            <h2 className={styles.title}>그룹을 나가기 전에 선택해 주세요</h2>
            <p className={styles.desc}>리더는 그냥 나갈 수 없어요. 아래 중 하나를 골라주세요.</p>
            <div className={styles.cards}>
              <button
                type="button"
                className={`${styles.card} ${choice === 'delegate' ? styles.cardActive : ''}`}
                onClick={() => setChoice('delegate')}
              >
                <span className={styles.cardTitle}>권한 위임 후 나가기</span>
                <span className={styles.cardDesc}>다른 멤버에게 리더를 넘기고 나가요. 그룹은 그대로 유지돼요.</span>
              </button>
              <button
                type="button"
                className={`${styles.card} ${choice === 'delete' ? styles.cardActiveDanger : ''}`}
                onClick={() => setChoice('delete')}
              >
                <span className={`${styles.cardTitle} ${styles.cardTitleDanger}`}>그룹 삭제</span>
                <span className={styles.cardDesc}>그룹과 모든 데이터가 삭제되고, 되돌릴 수 없어요.</span>
              </button>
            </div>
            <div className={styles.footer}>
              <button type="button" className={styles.secondary} onClick={close}>
                취소
              </button>
              <button
                type="button"
                className={styles.primary}
                onClick={() => setStep(choice === 'delegate' ? 'delegate' : 'delete')}
              >
                다음
              </button>
            </div>
          </>
        )}

        {step === 'delegate' && (
          <>
            <h2 className={styles.title}>새 리더를 선택해 주세요</h2>
            <p className={styles.desc}>선택한 멤버가 리더가 되고, 나는 그룹에서 나가요.</p>
            <div className={styles.memberList} role="radiogroup" aria-label="새 리더">
              {others.map((m) => (
                <label key={m.user_id} className={`${styles.memberRow} ${newLeaderId === m.user_id ? styles.memberRowActive : ''}`}>
                  <input
                    type="radio"
                    name="new-leader"
                    checked={newLeaderId === m.user_id}
                    onChange={() => setNewLeaderId(m.user_id)}
                  />
                  <span className={styles.avatar}>
                    <img src={getAvatarSrc(m.avatar)} alt="" />
                  </span>
                  <span className={styles.memberName}>{m.nickname || '알 수 없음'}</span>
                </label>
              ))}
            </div>
            {error && <div className={styles.error}>{error}</div>}
            <div className={styles.footer}>
              <button type="button" className={styles.secondary} onClick={() => setStep('choice')} disabled={busy}>
                이전
              </button>
              <button
                type="button"
                className={styles.primary}
                disabled={busy || !newLeaderId}
                onClick={() =>
                  void run('transfer_leadership_and_leave', { p_group_id: groupId, p_new_leader: newLeaderId })
                }
              >
                위임하고 나가기
              </button>
            </div>
          </>
        )}

        {step === 'delete' && (
          <>
            <h2 className={styles.title}>정말 그룹을 삭제할까요?</h2>
            <div className={styles.warnBox}>
              그룹의 멤버, 회의, 문서, 공지가 모두 삭제되고 복구할 수 없어요.
            </div>
            <label className={styles.confirmLabel}>
              확인을 위해 그룹 이름 <b>{groupName}</b> 을(를) 입력해 주세요.
              <input
                className={styles.input}
                value={typedName}
                placeholder={groupName}
                onChange={(e) => setTypedName(e.target.value)}
                autoFocus
              />
            </label>
            {error && <div className={styles.error}>{error}</div>}
            <div className={styles.footer}>
              {/* 혼자 남은 리더는 '이전'으로 돌아갈 선택지가 없으므로 취소만 둡니다 */}
              <button
                type="button"
                className={styles.secondary}
                onClick={others.length > 0 ? () => setStep('choice') : close}
                disabled={busy}
              >
                {others.length > 0 ? '이전' : '취소'}
              </button>
              <button
                type="button"
                className={styles.danger}
                disabled={busy || !nameMatches}
                onClick={() => void run('delete_group', { p_group_id: groupId })}
              >
                그룹 삭제
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
  );
}
