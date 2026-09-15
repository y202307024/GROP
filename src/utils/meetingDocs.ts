import { supabase } from '../services/supabaseClient';
import { getApiBase } from './apiBase';
import type { MeetingSharedFile } from './meetingChat';

/** meetings.attachments / 서버 meeting-docs 에 넣을 형태로 맞춥니다. */
export function toMeetingAttachments(files: MeetingSharedFile[]) {
  return files.map((f) => ({
    id: f.id,
    name: f.name,
    path: f.path,
    size: f.size,
    mime: f.mime,
    ts: f.ts,
  }));
}

function meetingTitleFromNow(now = new Date()) {
  return `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 회의`;
}

function uploadHeaders(): HeadersInit | undefined {
  const uploadToken = import.meta.env.VITE_MEETING_UPLOAD_TOKEN as string | undefined;
  return uploadToken ? { 'x-upload-token': uploadToken, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

/** 서버 디스크에 회의 첨부 목록을 저장합니다. (DB 컬럼 없이도 문서 탭에서 조회 가능) */
export async function saveMeetingDocToServer(options: {
  meetingId: string;
  groupId: string;
  title: string;
  date: string;
  files: MeetingSharedFile[];
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${getApiBase()}/api/meeting-docs/${encodeURIComponent(options.meetingId)}`, {
      method: 'PUT',
      headers: uploadHeaders(),
      body: JSON.stringify({
        groupId: options.groupId,
        title: options.title,
        date: options.date,
        files: toMeetingAttachments(options.files),
      }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      return { ok: false, error: (errBody as { error?: string }).error || `저장 실패 (${res.status})` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '서버 저장 실패' };
  }
}

/** 문서 탭 「열기」: 서버에 저장된 첨부 목록을 가져옵니다. */
export async function fetchMeetingDocAttachments(
  meetingId: string,
  groupId?: string,
): Promise<ReturnType<typeof toMeetingAttachments>> {
  const qs = groupId ? `?groupId=${encodeURIComponent(groupId)}` : '';
  try {
    const res = await fetch(`${getApiBase()}/api/meeting-docs/${encodeURIComponent(meetingId)}${qs}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { files?: unknown };
    if (!Array.isArray(data.files)) return [];
    return data.files
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .filter((item) => typeof item.path === 'string' && typeof item.name === 'string')
      .map((item) => ({
        id: typeof item.id === 'string' ? item.id : crypto.randomUUID(),
        name: String(item.name),
        path: String(item.path),
        size: typeof item.size === 'number' ? item.size : 0,
        mime: typeof item.mime === 'string' ? item.mime : 'application/octet-stream',
        ts: typeof item.ts === 'number' ? item.ts : 0,
      }));
  } catch {
    return [];
  }
}

/** 그룹의 서버 문서 목록(첨부 포함) */
export async function fetchGroupMeetingDocs(groupId: string): Promise<Array<{
  id: string;
  groupId: string;
  title: string;
  date: string;
  files: ReturnType<typeof toMeetingAttachments>;
}>> {
  try {
    const res = await fetch(`${getApiBase()}/api/meeting-docs?groupId=${encodeURIComponent(groupId)}`);
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return [];
    return data
      .filter((d): d is Record<string, unknown> => Boolean(d) && typeof d === 'object' && typeof d.id === 'string')
      .map((d) => ({
        id: String(d.id),
        groupId: String(d.groupId || groupId),
        title: typeof d.title === 'string' ? d.title : '',
        date: typeof d.date === 'string' ? d.date : new Date().toISOString(),
        files: Array.isArray(d.files)
          ? d.files
              .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
              .filter((item) => typeof item.path === 'string' && typeof item.name === 'string')
              .map((item) => ({
                id: typeof item.id === 'string' ? item.id : crypto.randomUUID(),
                name: String(item.name),
                path: String(item.path),
                size: typeof item.size === 'number' ? item.size : 0,
                mime: typeof item.mime === 'string' ? item.mime : 'application/octet-stream',
                ts: typeof item.ts === 'number' ? item.ts : 0,
              }))
          : [],
      }));
  } catch {
    return [];
  }
}

/** 그룹 폴더에 실제로 저장된 첨부 파일 목록 (문서 열기 폴백) */
export async function fetchGroupChatFiles(groupId: string): Promise<ReturnType<typeof toMeetingAttachments>> {
  if (!groupId) return [];
  try {
    const res = await fetch(`${getApiBase()}/api/chat-files?groupId=${encodeURIComponent(groupId)}`);
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return [];
    return data
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .filter((item) => typeof item.path === 'string' && typeof item.name === 'string')
      .map((item) => ({
        id: typeof item.id === 'string' ? item.id : crypto.randomUUID(),
        name: String(item.name),
        path: String(item.path),
        size: typeof item.size === 'number' ? item.size : 0,
        mime: typeof item.mime === 'string' ? item.mime : 'application/octet-stream',
        ts: typeof item.ts === 'number' ? item.ts : 0,
      }));
  } catch {
    return [];
  }
}

/** 같은 날짜(로컬)인지 — 회의일과 업로드일을 맞출 때 씁니다. */
export function isSameLocalDay(aIso: string | number, bIso: string | number) {
  const a = new Date(aIso);
  const b = new Date(bIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  return (
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  );
}

/** path 기준으로 첨부 목록을 합칩니다. */
function mergeAttachmentLists(
  ...lists: Array<ReturnType<typeof toMeetingAttachments> | MeetingSharedFile[] | null | undefined>
) {
  const byPath = new Map<string, ReturnType<typeof toMeetingAttachments>[number]>();
  for (const list of lists) {
    if (!list) continue;
    for (const f of toMeetingAttachments(list as MeetingSharedFile[])) {
      if (!f.path) continue;
      byPath.set(f.path, f);
    }
  }
  return [...byPath.values()];
}

/** 오늘(로컬) 같은 그룹에 이미 만든 회의가 있으면 그 id·첨부를 돌려줍니다. */
async function findTodayMeetingForGroup(groupId: string): Promise<{
  id: string;
  attachments: ReturnType<typeof toMeetingAttachments>;
} | null> {
  const { data, error } = await supabase
    .from('meetings')
    .select('id, date, attachments')
    .eq('group_id', groupId)
    .order('date', { ascending: false })
    .limit(30);
  if (error || !data?.length) return null;

  const today = Date.now();
  const hit = data.find((row) => row?.id && isSameLocalDay(row.date, today));
  if (!hit?.id) return null;

  const raw = hit.attachments;
  const attachments = Array.isArray(raw)
    ? toMeetingAttachments(
        raw.filter((item): item is MeetingSharedFile => Boolean(item) && typeof item === 'object') as MeetingSharedFile[],
      )
    : [];

  return { id: hit.id as string, attachments };
}

/**
 * 회의 중 올린 파일을 문서 탭에 반영합니다.
 * 같은 날·같은 그룹이면 새 행을 만들지 않고 기존 회의에 첨부를 합칩니다.
 */
export async function syncMeetingAttachmentsDoc(options: {
  meetingId: string | null;
  groupId: string;
  userId?: string | null;
  files: MeetingSharedFile[];
}): Promise<{ meetingId: string | null; error?: string }> {
  const { groupId, userId, files } = options;
  if (!groupId || files.length === 0) {
    return { meetingId: options.meetingId };
  }

  const now = new Date();
  const title = meetingTitleFromNow(now);
  const date = now.toISOString();
  let meetingId = options.meetingId;
  const errors: string[] = [];
  let attachPayload = toMeetingAttachments(files);

  // 세션 id 가 없으면 오늘 같은 그룹 회의를 재사용합니다. (파일마다 행이 갈라지는 것 방지)
  if (!meetingId) {
    const existing = await findTodayMeetingForGroup(groupId);
    if (existing) {
      meetingId = existing.id;
      attachPayload = mergeAttachmentLists(existing.attachments, files);
    }
  }

  // 1) 회의록 행이 없으면 만듭니다. (attachments 컬럼 없이 먼저 시도)
  if (!meetingId) {
    meetingId = crypto.randomUUID();
    const baseRow = {
      id: meetingId,
      group_id: groupId,
      title,
      date,
      created_by: userId ?? null,
    };

    const withAttach = await supabase.from('meetings').insert({
      ...baseRow,
      attachments: attachPayload,
    });

    if (withAttach.error) {
      // attachments 컬럼이 없거나 기타 이유로 실패하면 기본 행만이라도 만듭니다.
      const withoutAttach = await supabase.from('meetings').insert(baseRow);
      if (withoutAttach.error) {
        // id 지정 insert 가 안 되면 id 없이 다시 시도
        const retry = await supabase
          .from('meetings')
          .insert({
            group_id: groupId,
            title,
            date,
            created_by: userId ?? null,
          })
          .select('id')
          .single();
        if (retry.error || !retry.data?.id) {
          return { meetingId: null, error: retry.error?.message || withAttach.error.message };
        }
        meetingId = retry.data.id as string;
      }
      // 컬럼 없음은 서버 meeting-docs 로 보완하므로 치명 오류로 올리지 않습니다.
      if (!/attachments/i.test(withAttach.error.message)) {
        errors.push(withAttach.error.message);
      }
    }
  } else {
    // 기존 행: DB에 있던 첨부와 합친 뒤 갱신합니다.
    const { data: row } = await supabase
      .from('meetings')
      .select('attachments')
      .eq('id', meetingId)
      .maybeSingle();
    if (Array.isArray(row?.attachments)) {
      attachPayload = mergeAttachmentLists(
        row.attachments as MeetingSharedFile[],
        attachPayload,
      );
    }

    const { error } = await supabase
      .from('meetings')
      .update({ attachments: attachPayload, title })
      .eq('id', meetingId);
    if (error && !/attachments/i.test(error.message)) {
      const fallback = await supabase
        .from('meetings')
        .update({ title })
        .eq('id', meetingId);
      if (fallback.error) errors.push(error.message);
    }
  }

  // 2) 서버에 첨부 목록 저장 — 문서 탭 「열기」의 주 데이터 소스
  const serverSave = await saveMeetingDocToServer({
    meetingId,
    groupId,
    title,
    date,
    files: attachPayload,
  });
  if (!serverSave.ok) {
    errors.push(serverSave.error || '서버 첨부 저장 실패');
  }

  return {
    meetingId,
    error: errors.length ? errors.join(' / ') : undefined,
  };
}
