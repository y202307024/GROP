import { useEffect, useState } from 'react';
import { createScaledPortal } from '../components/AppScaleLayer';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
// 멤버 페이지와 같은 틀(상단 줄/카드/스크롤 영역/하단 요약)을 그대로 쓰려고 MemberList의 스타일을 가져옵니다.
import m from './MemberList.module.css';
import s from './NoticeList.module.css';

type Notice = {
  id: string;
  title: string;
  content: string;
  author_id: string;
  created_at: string;
  updated_at: string;
  /** 목록 맨 위에 고정된 공지인지 — 그룹당 1개만(09_공지_고정.sql 의 트리거가 기존 고정을 자동 해제) */
  is_pinned: boolean;
};
type Member = { user_id: string; nickname: string };
/** create: 새 공지 / view: 내용 보기(모든 멤버) / edit: 수정(리더) */
type ModalState = { mode: 'create' } | { mode: 'view' | 'edit'; notice: Notice } | null;

const TITLE_MAX = 100;
const CONTENT_MAX = 2000;

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * 공지 전체보기 — 멤버 페이지(MemberList)와 같은 구성.
 * 모든 멤버가 읽을 수 있고, 등록/수정/삭제는 리더만 합니다(서버 쪽 권한은 notices.sql 의 RLS 가 막습니다).
 */
export default function NoticeList() {
  const { id: groupId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [modal, setModal] = useState<ModalState>(null);

  // 리더 = 멤버 목록의 첫 번째 사람(가입 순서). 그룹 상세/멤버 페이지와 같은 기존 규칙입니다.
  const isLeader = members.length > 0 && members[0].user_id === currentUserId;
  const nameById = new Map(members.map((x) => [x.user_id, x.nickname]));

  const fetchNotices = async () => {
    const { data, error } = await supabase
      .from('notices')
      .select('id, title, content, author_id, created_at, updated_at, is_pinned')
      .eq('group_id', groupId)
      // 고정 공지가 맨 위, 나머지는 최신순
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) {
      console.error('공지 조회 실패:', error);
      setLoadError('공지를 불러오지 못했어요.');
      return;
    }
    setLoadError('');
    setNotices((data as Notice[] | null) ?? []);
  };

  useEffect(() => {
    const init = async () => {
      const { data: userData } = await supabase.auth.getUser();
      setCurrentUserId(userData.user?.id || '');

      const { data: memberRows } = await supabase.rpc('get_group_members_with_profiles', { p_group_id: groupId });
      setMembers(
        ((memberRows as { user_id: string; nickname: string }[] | null) ?? []).map((r) => ({
          user_id: r.user_id,
          nickname: r.nickname || '알 수 없음',
        })),
      );

      await fetchNotices();
      setLoading(false);
    };
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const saveNotice = async (title: string, content: string, isPinned: boolean) => {
    // 그룹 편집 모달의 readOnly 와 같은 규칙: 리더가 아니면 등록/수정 요청 자체를 보내지 않습니다(화면 방어, 서버는 RLS)
    if (!isLeader) return '공지는 리더만 등록할 수 있어요.';
    if (modal?.mode === 'edit') {
      const { error } = await supabase
        .from('notices')
        .update({ title, content, is_pinned: isPinned, updated_at: new Date().toISOString() })
        .eq('id', modal.notice.id);
      if (error) return error.message;
    } else {
      // author_id 는 DB 기본값(auth.uid())으로 들어가지만, 정책 검사를 위해 명시해 둡니다
      const { error } = await supabase
        .from('notices')
        .insert({ group_id: groupId, title, content, author_id: currentUserId, is_pinned: isPinned });
      if (error) return error.message;
    }
    setModal(null);
    await fetchNotices();
    return '';
  };

  const deleteNotice = async (notice: Notice) => {
    if (!isLeader) return;
    if (!window.confirm(`"${notice.title}" 공지를 삭제할까요?`)) return;
    const { error } = await supabase.from('notices').delete().eq('id', notice.id);
    if (error) {
      window.alert(`삭제에 실패했어요: ${error.message}`);
      return;
    }
    setModal(null);
    await fetchNotices();
  };

  // 그룹 상세에서 들어온 화면이라 사이드바 선택도 그 상세가 쓰던 항목을 유지합니다(MemberList와 동일)
  const fromGroupList = (location.state as { from?: string } | null)?.from === 'member';

  return (
    <AppShell activePage={fromGroupList ? 'member' : 'main'}>
      <div className={`page ${m.fixedPage}`}>
        <div className={m.docHeader}>
          <div className={m.tabs}>
            <span className={m.tab}>공지</span>
          </div>
          <div className={m.toolbar}>
            <button
              className={m.backButton}
              type="button"
              aria-label="그룹으로"
              title="그룹으로"
              onClick={() => navigate(`/group/${groupId}`, { state: location.state })}
            >
              <Icon name="chevron-left" />
            </button>
          </div>
        </div>

        {loading ? (
          <div>불러오는 중...</div>
        ) : loadError ? (
          <div className={s.empty}>{loadError}</div>
        ) : notices.length === 0 && !isLeader ? (
          // 리더는 공지가 없어도 아래 목록(머리글 + "새 공지 추가" 행)이 보여야 첫 공지를 남길 수 있습니다
          <div className={s.empty}>
            <div>등록된 공지가 없어요</div>
          </div>
        ) : (
          <div className={m.memberCard}>
            <div className={m.memberBody}>
              {/* member-row 가 4칸 그리드라 멤버 페이지와 같은 칸 비율을 그대로 씁니다 */}
              <div className="list-row list-head member-row">
                <span>제목</span>
                <span>작성자</span>
                <span>작성일</span>
                <span></span>
              </div>
              {/* 공지 등록 버튼 대신 목록 맨 위(데이터가 들어가는 자리)에 두는 추가 행 — 리더만 보입니다.
                  누르면 기존 등록 팝업이 열리고, + 아이콘은 다른 행의 액션 자리(오른쪽 끝)에 둡니다 */}
              {isLeader && (
                <div
                  className={`list-row member-row ${s.addRow}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setModal({ mode: 'create' })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setModal({ mode: 'create' });
                  }}
                >
                  <span className={s.addLabel}>새 공지 추가</span>
                  <Icon name="plus" className={s.addIcon} />
                </div>
              )}
              {/* 리더는 공지가 없어도 목록 화면이 보이므로, 비어 있다는 안내를 여기서 따로 보여줍니다 */}
              {notices.length === 0 && (
                <div className={s.emptyHint}>등록된 공지가 없어요. 위의 “새 공지 추가”로 첫 공지를 남겨보세요.</div>
              )}
              {notices.map((n) => (
                <div
                  key={n.id}
                  className={`list-row member-row ${s.noticeRow}${n.is_pinned ? ` ${s.pinnedRow}` : ''}`}
                  onClick={() => setModal({ mode: 'view', notice: n })}
                >
                  <div className={s.titleCell}>
                    <div className={s.titleLine}>
                      {n.is_pinned && <Icon name="pin" className={s.pinIcon} />}
                      <span className={s.titleName}>{n.title}</span>
                      {n.is_pinned && <span className={s.pinBadge}>고정</span>}
                    </div>
                    {n.content && <div className={s.titleSub}>{n.content}</div>}
                  </div>
                  <span>{nameById.get(n.author_id) ?? '알 수 없음'}</span>
                  <span>{formatDate(n.created_at)}</span>
                  <span className={s.actions}>
                    {isLeader && (
                      <>
                        <button
                          type="button"
                          className={s.textButton}
                          onClick={(e) => {
                            e.stopPropagation();
                            setModal({ mode: 'edit', notice: n });
                          }}
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          className={`${s.textButton} ${s.danger}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void deleteNotice(n);
                          }}
                        >
                          삭제
                        </button>
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <div className={m.listFooter}>공지 {notices.length}개</div>
          </div>
        )}
      </div>

      {modal && (
        <NoticeModal
          // 모드/대상이 바뀔 때 입력 상태를 새로 시작하도록 key 를 줍니다
          key={modal.mode === 'create' ? 'create' : `${modal.mode}-${modal.notice.id}`}
          modal={modal}
          isLeader={isLeader}
          authorName={modal.mode === 'create' ? '' : nameById.get(modal.notice.author_id) ?? '알 수 없음'}
          onClose={() => setModal(null)}
          onSave={saveNotice}
          onEdit={(notice) => setModal({ mode: 'edit', notice })}
          onDelete={deleteNotice}
        />
      )}
    </AppShell>
  );
}

type ModalProps = {
  modal: NonNullable<ModalState>;
  isLeader: boolean;
  authorName: string;
  onClose: () => void;
  /** 저장 실패 시 오류 문구를, 성공하면 빈 문자열을 돌려줍니다 */
  onSave: (title: string, content: string, isPinned: boolean) => Promise<string>;
  onEdit: (notice: Notice) => void;
  onDelete: (notice: Notice) => Promise<void>;
};

/** 공지 보기 / 등록 / 수정 모달 */
function NoticeModal({ modal, isLeader, authorName, onClose, onSave, onEdit, onDelete }: ModalProps) {
  const notice = modal.mode === 'create' ? null : modal.notice;
  const [title, setTitle] = useState(notice?.title ?? '');
  const [content, setContent] = useState(notice?.content ?? '');
  // 목록 맨 위 고정 — 이미 고정된 다른 공지가 있으면 저장할 때 DB 트리거가 그 공지의 고정을 풀어 줍니다
  const [pinned, setPinned] = useState(notice?.is_pinned ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!title.trim()) {
      setError('제목을 입력해주세요.');
      return;
    }
    setSaving(true);
    setError('');
    const message = await onSave(title.trim(), content.trim(), pinned);
    // 성공하면 부모가 모달을 닫으므로 실패했을 때만 상태를 되돌립니다
    if (message) {
      setError(message);
      setSaving(false);
    }
  };

  // .app 의 transform 때문에 fixed 모달이 화면 전체를 덮지 못해 body 로 포털합니다
  return createScaledPortal(
    <div className={s.overlay} onClick={onClose}>
      <div className={s.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {modal.mode === 'view' && notice ? (
          <>
            <div className={s.modalTitle}>
              {notice.is_pinned && <span className={s.pinBadge}>고정</span>} {notice.title}
            </div>
            <div className={s.modalMeta}>
              {authorName} · {formatDate(notice.created_at)}
              {notice.updated_at !== notice.created_at && ' (수정됨)'}
            </div>
            <div className={s.modalContent}>{notice.content || '내용이 없어요.'}</div>
            <div className={s.modalFooter}>
              {isLeader && (
                <>
                  <button type="button" className={`${s.textButton} ${s.danger}`} onClick={() => void onDelete(notice)}>
                    삭제
                  </button>
                  <button type="button" className={s.secondaryButton} onClick={() => onEdit(notice)}>
                    수정
                  </button>
                </>
              )}
              <button type="button" className={s.primaryButton} onClick={onClose}>
                닫기
              </button>
            </div>
          </>
        ) : (
          <>
            <div className={s.modalTitle}>{modal.mode === 'edit' ? '공지 수정' : '공지 등록'}</div>
            <input
              className={s.input}
              value={title}
              maxLength={TITLE_MAX}
              placeholder="제목"
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
            <textarea
              className={s.textarea}
              value={content}
              maxLength={CONTENT_MAX}
              placeholder="멤버들에게 전할 내용을 적어주세요"
              onChange={(e) => setContent(e.target.value)}
            />
            <label className={s.pinOption}>
              <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
              <span className={s.pinOptionText}>
                <span className={s.pinOptionTitle}>목록 맨 위에 고정</span>
                <span className={s.pinOptionHint}>
                  고정 공지는 그룹당 1개예요. 이미 고정된 공지가 있으면 해제되고 이 공지로 바뀌어요.
                </span>
              </span>
            </label>
            {error && <div className={s.error}>{error}</div>}
            <div className={s.modalFooter}>
              <button type="button" className={s.secondaryButton} onClick={onClose} disabled={saving}>
                취소
              </button>
              <button type="button" className={s.primaryButton} onClick={() => void submit()} disabled={saving}>
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
  );
}
