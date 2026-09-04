import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import AppSidebar from '../components/AppSidebar';
import TimelapseSavePanel, { type TimelapseSave } from '../components/TimelapseSavePanel';
import {
  deleteTimelapseSave,
  fetchAllTimelapseSaves,
  fetchBoards,
  fetchTimelapseSavesForBoard,
  getBoardOptionLabel,
  saveTimelapseCategory,
  type TimelapseSaveWithBoard,
} from '../timelapseApi';
import layout from '../styles/pageLayout.module.css';
import tbtn from '../components/timelapseButton.module.css';
import s from './TimelapsePage.module.css';

export default function TimelapsePage() {
  const navigate = useNavigate();
  const [boards, setBoards] = useState<{ id: string; title: string; created_at: string }[]>([]);
  const [boardId, setBoardId] = useState('');
  const [boardSaves, setBoardSaves] = useState<TimelapseSave[]>([]);
  const [allSaves, setAllSaves] = useState<TimelapseSaveWithBoard[]>([]);
  const [isLoadingBoards, setIsLoadingBoards] = useState(true);
  const [isLoadingSaves, setIsLoadingSaves] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [loadError, setLoadError] = useState('');

  const loadBoards = async () => {
    setIsLoadingBoards(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        navigate('/');
        return;
      }

      const list = await fetchBoards();
      setBoards(list);
      if (!boardId && list[0]) setBoardId(list[0].id);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '보드 불러오기 실패');
    } finally {
      setIsLoadingBoards(false);
    }
  };

  const loadAllSaves = async () => {
    try {
      const rows = await fetchAllTimelapseSaves();
      setAllSaves(rows);
      setLoadError('');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '타임랩스 불러오기 실패');
      setAllSaves([]);
    }
  };

  const loadBoardSaves = async (targetBoardId: string) => {
    if (!targetBoardId) {
      setBoardSaves([]);
      return;
    }

    setIsLoadingSaves(true);
    try {
      const rows = await fetchTimelapseSavesForBoard(targetBoardId);
      setBoardSaves(rows);
    } catch (e) {
      console.warn(e);
      setBoardSaves([]);
    } finally {
      setIsLoadingSaves(false);
    }
  };

  useEffect(() => {
    void loadBoards();
    void loadAllSaves();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadBoardSaves(boardId);
  }, [boardId]);

  const otherBoardGroups = useMemo(() => {
    const map = new Map<string, { boardTitle: string; items: TimelapseSaveWithBoard[] }>();
    for (const save of allSaves) {
      if (save.board_id === boardId) continue;
      const title = save.boards?.title ?? '이름 없는 보드';
      const existing = map.get(save.board_id);
      if (existing) existing.items.push(save);
      else map.set(save.board_id, { boardTitle: title, items: [save] });
    }
    return Array.from(map.entries());
  }, [allSaves, boardId]);

  const refreshAfterChange = async (targetBoardId: string) => {
    await Promise.all([loadBoardSaves(targetBoardId), loadAllSaves()]);
  };

  const handleSave = async () => {
    if (!boardId) return;
    const title = draftTitle.trim() || window.prompt('타임랩스 카테고리 이름')?.trim();
    if (!title) return;

    setIsSaving(true);
    try {
      await saveTimelapseCategory(boardId, title);
      setDraftTitle('');
      await refreshAfterChange(boardId);
    } catch (e) {
      alert(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setIsSaving(false);
    }
  };

  const openInCanvas = (save: { board_id: string; id: string }, play: boolean) => {
    const params = new URLSearchParams({
      boardId: save.board_id,
      saveId: save.id,
    });
    if (play) params.set('play', '1');
    navigate(`/canvas?${params.toString()}`);
  };

  const handleDelete = async (save: TimelapseSave) => {
    if (!window.confirm(`「${save.title}」 타임랩스를 삭제할까요?`)) return;

    try {
      await deleteTimelapseSave(save.id);
      await refreshAfterChange(save.board_id);
    } catch (e) {
      alert(e instanceof Error ? e.message : '삭제 실패');
    }
  };

  return (
    <div className={layout.wrap}>
      <AppSidebar />

      <div className={layout.content}>
        <div className={layout.contentHeader}>
          <div>
            <div className={layout.pageTitle}>타임랩스</div>
            <div className={layout.pageSub}>캔버스 그리기 기록을 카테고리별로 저장하고 재생합니다</div>
          </div>
          <button type="button" className={layout.btnPrimary} onClick={() => navigate(boardId ? `/canvas?boardId=${boardId}` : '/canvas')}>
            캔버스 열기
          </button>
        </div>

        {loadError ? (
          <div className={`${s.empty} ${s.error}`}>
            {loadError}
            <br />
            Supabase에서 <code>supabase/timelapse_saves.sql</code> 실행 여부를 확인해 주세요.
          </div>
        ) : null}

        <TimelapseSavePanel
          boardId={boardId}
          boards={boards}
          isLoadingBoards={isLoadingBoards}
          onBoardChange={setBoardId}
          getBoardOptionLabel={(board) => getBoardOptionLabel(board, boards)}
          saves={boardSaves}
          isLoading={isLoadingSaves}
          isSaving={isSaving}
          draftTitle={draftTitle}
          onDraftTitleChange={setDraftTitle}
          onSave={() => void handleSave()}
          onLoad={(save) => openInCanvas(save, false)}
          onPlay={(save) => openInCanvas(save, true)}
          onDelete={(save) => void handleDelete(save)}
        />

        {otherBoardGroups.length > 0 ? (
          <>
            <div className={layout.sectionLabel}>다른 보드 타임랩스</div>
            {otherBoardGroups.map(([id, group]) => (
              <section key={id} className={s.boardSection}>
                <div className={s.otherBoardTitle}>{group.boardTitle}</div>
                <div className={s.grid}>
                  {group.items.map((save) => (
                    <div key={save.id} className={s.card}>
                      <div className={s.cardIcon}>⏪</div>
                      <div className={s.cardTitle}>{save.title}</div>
                      <div className={s.cardMeta}>이벤트 {save.event_count}개</div>
                      <div className={s.cardMeta}>저장 {new Date(save.created_at).toLocaleString()}</div>
                      <div className={s.cardActions}>
                        <button type="button" className={tbtn.btn} onClick={() => openInCanvas(save, false)}>
                          불러오기
                        </button>
                        <button type="button" className={`${tbtn.btn} ${tbtn.primary}`} onClick={() => openInCanvas(save, true)}>
                          재생
                        </button>
                        <button type="button" className={`${tbtn.btn} ${tbtn.danger}`} onClick={() => void handleDelete(save)}>
                          삭제
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}
