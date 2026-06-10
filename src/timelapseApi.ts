import { supabase } from './supabaseClient';
import type { TimelapseSave } from './components/TimelapseSavePanel';

type BoardRow = { id: string; title: string; created_at: string };

export type TimelapseSaveWithBoard = TimelapseSave & {
  boards: { title: string } | null;
};

export function dedupeBoardsById(boards: BoardRow[]): BoardRow[] {
  const map = new Map<string, BoardRow>();
  for (const board of boards) {
    if (!map.has(board.id)) map.set(board.id, board);
  }
  return Array.from(map.values());
}

export function getBoardOptionLabel(board: BoardRow, all: BoardRow[]): string {
  const sameTitleCount = all.filter((b) => b.title === board.title).length;
  if (sameTitleCount <= 1) return board.title;
  const created = new Date(board.created_at);
  const when = created.toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${board.title} (${when})`;
}

export async function fetchBoards() {
  const { data, error } = await supabase.from('boards').select('id,title,created_at').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return dedupeBoardsById((data ?? []) as BoardRow[]);
}

export async function fetchTimelapseSavesForBoard(boardId: string) {
  const { data, error } = await supabase
    .from('board_timelapse_saves')
    .select('id,board_id,title,max_seq,event_count,start_ts,end_ts,created_at')
    .eq('board_id', boardId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as TimelapseSave[];
}

export async function fetchAllTimelapseSaves() {
  const { data, error } = await supabase
    .from('board_timelapse_saves')
    .select('id,board_id,title,max_seq,event_count,start_ts,end_ts,created_at,boards(title)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const boards = row.boards as { title: string } | { title: string }[] | null;
    const boardTitle = Array.isArray(boards) ? boards[0]?.title : boards?.title;
    return {
      ...row,
      boards: boardTitle ? { title: boardTitle } : null,
    } as TimelapseSaveWithBoard;
  });
}

export async function saveTimelapseCategory(boardId: string, title: string) {
  const { data, error } = await supabase
    .from('board_events')
    .select('seq,ts')
    .eq('board_id', boardId)
    .order('seq', { ascending: true });

  if (error) throw new Error(`기록 조회 실패: ${error.message}`);

  const events = data ?? [];
  if (events.length === 0) {
    throw new Error('저장할 그리기 기록이 없어요. 캔버스에서 먼저 펜으로 그려보세요.');
  }

  const last = events[events.length - 1];
  const { error: insertError } = await supabase.from('board_timelapse_saves').insert({
    board_id: boardId,
    title,
    max_seq: last.seq,
    event_count: events.length,
    start_ts: events[0].ts,
    end_ts: last.ts,
  });

  if (insertError) {
    throw new Error(
      `타임랩스 저장 실패: ${insertError.message}\n\nSupabase에서 supabase/timelapse_saves.sql 을 실행했는지 확인해 주세요.`,
    );
  }
}

export async function deleteTimelapseSave(id: string) {
  const { error } = await supabase.from('board_timelapse_saves').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
