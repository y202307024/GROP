/**
 * IndexedDB에 남겨 둔 회의 녹화를 올립니다.
 * 서버는 R2에 올릴 임시 주소만 발급하고, 파일은 브라우저가 R2로 직접 PUT 합니다.
 * 파일 업로드와 meetings 반영이 모두 끝난 뒤에만 브라우저 보관분을 지웁니다.
 */
import { supabase } from '../services/supabaseClient';
import { getApiBase, isNetlifyBackend } from './apiBase';
import { addGroupMember } from './joinGroup';
import { readSessionMeetingId } from './liveMeeting';
import { notifyGroupMembers } from './notifications';
import { rememberLastMeeting } from './lastMeeting';
import { uploadToNetlifyBlobs } from './netlifyUpload';
import {
  clearActiveRecording,
  clearRecordingUploadFailure,
  deleteLocalRecording,
  flushRecordingWrites,
  getLocalRecording,
  loadRecordingBlob,
  patchLocalRecording,
  reportRecordingUploadFailure,
} from './meetingRecordingStore';

export type RecordingUploadResult =
  | { ok: true; meetingId: string; alreadyDone?: boolean }
  | { ok: false; error: string; kept: boolean };

type SaveInput = {
  blob: Blob;
  groupId: string;
  dateStr: string;
  mimeType: string;
  title: string;
  meetingId?: string | null;
  attachments: unknown;
  chatLog: unknown;
  createdBy?: string | null;
  groupName?: string;
  startedAt?: number;
};

const uploadChains = new Map<string, Promise<unknown>>();
/** 회의록 저장은 끝났는데 브라우저 보관분 삭제만 실패한 id. 같은 탭에서 파일을 반복해서 올리지 않습니다. */
const savedButNotDeleted = new Set<string>();

/** 같은 녹화를 이 탭과 다른 탭에서 동시에 올리지 않습니다. */
function withRecordingLock<T>(id: string, task: () => Promise<T>): Promise<T> {
  const run = () => {
    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
      return navigator.locks.request(`grop-recording-upload:${id}`, { mode: 'exclusive' }, task);
    }
    return task();
  };
  // 사슬을 먼저 걸어 두어야 같은 탭의 두 호출이 나란히 시작되지 않습니다.
  const prev = uploadChains.get(id) ?? Promise.resolve();
  const next = prev.then(run, run);
  const settled = next.then(() => undefined, () => undefined);
  uploadChains.set(id, settled);
  return next.finally(() => {
    if (uploadChains.get(id) === settled) uploadChains.delete(id);
  });
}

export function recordingTitleFromDate(dateStr: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return '회의';
  return `${Number(match[1])}년 ${Number(match[2])}월 ${Number(match[3])}일 회의`;
}

function uploadError(err: unknown) {
  const msg = err instanceof Error ? err.message : '알 수 없는 오류';
  return `녹화본을 저장소로 전송하지 못했습니다: ${msg}\n\n서버가 켜져 있고, R2 설정과 버킷 CORS가 맞는지 확인해 주세요.`;
}

/** meetings에 넣을 영상 칸. R2는 키와 상태, 시연용 Blobs는 예전 재생 주소입니다. */
type StoredVideo =
  | { kind: 'r2'; videoKey: string; sizeBytes: number }
  | { kind: 'url'; videoUrl: string };

function videoColumns(stored: StoredVideo): Record<string, unknown> {
  if (stored.kind === 'r2') {
    return {
      video_key: stored.videoKey,
      video_status: 'uploaded',
      video_size_bytes: stored.sizeBytes,
    };
  }
  return { video_url: stored.videoUrl };
}

/** 칸이 아직 없으면 적용할 SQL을 같이 알려 줍니다. 녹화는 IndexedDB에 남아 있습니다. */
function explainVideoSaveError(message: string) {
  if (/video_key|video_status|video_size_bytes/i.test(message)) {
    return `${message}\n\nsupabase/08_영상_R2_상태.sql 을 적용하면 영상 키를 저장할 수 있습니다. 녹화는 이 브라우저에 남아 있어, 적용 후 다시 시도하면 올라갑니다.`;
  }
  return message;
}

async function storeVideoFile(input: SaveInput): Promise<StoredVideo> {
  if (isNetlifyBackend()) {
    // Netlify 시연은 서버 디스크 대신 Blobs에 올립니다. 재생 경로는 기존과 같게 맞춥니다.
    const rel = `${input.groupId || 'unknown'}/${input.dateStr}/${Date.now()}.webm`;
    const uploaded = await uploadToNetlifyBlobs(`videos/${rel}`, input.blob, {
      name: 'recording.webm',
      mime: input.mimeType,
    });
    return { kind: 'url', videoUrl: `${getApiBase()}/videos/${uploaded.path}` };
  }

  const uploadToken = import.meta.env.VITE_MEETING_UPLOAD_TOKEN as string | undefined;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (uploadToken) headers['x-upload-token'] = uploadToken;

  // 서버는 파일을 받지 않습니다. 15분짜리 PUT 주소와 객체 키만 받습니다.
  let ticketRes: Response;
  try {
    ticketRes = await fetch(`${getApiBase()}/api/meetings/upload-url`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        groupId: input.groupId,
        dateStr: input.dateStr,
        mimeType: input.mimeType || 'video/webm',
        size: input.blob.size,
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '네트워크 오류';
    throw new Error(`업로드 주소를 받지 못했습니다. 서버가 켜져 있는지 확인해 주세요. (${msg})`);
  }
  if (!ticketRes.ok) {
    const errBody = await ticketRes.json().catch(() => ({}));
    throw new Error((errBody as { error?: string }).error || `업로드 주소 발급 실패 (${ticketRes.status})`);
  }
  const ticket = (await ticketRes.json()) as { uploadUrl?: string; key?: string; contentType?: string };
  if (!ticket.uploadUrl || !ticket.key) {
    throw new Error('업로드 주소 응답이 올바르지 않습니다');
  }

  // 서명에 넣은 Content-Type과 같아야 해서, 녹화물 코덱 문자열이 아니라 서버가 돌려준 값을 씁니다.
  const contentType = ticket.contentType || 'video/webm';
  let putRes: Response;
  try {
    putRes = await fetch(ticket.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: input.blob,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '네트워크 오류';
    throw new Error(`저장소에 영상을 올리지 못했습니다. R2 버킷 CORS에서 이 화면 주소의 PUT을 허용했는지 확인해 주세요. (${msg})`);
  }
  if (!putRes.ok) {
    throw new Error(`저장소 업로드 실패 (HTTP ${putRes.status})`);
  }
  return { kind: 'r2', videoKey: ticket.key, sizeBytes: input.blob.size };
}

async function rememberStartedAt(meetingId: string, startedAt: number | undefined) {
  if (!meetingId || !startedAt) return;
  const { error } = await supabase
    .from('meetings')
    .update({ started_at: new Date(startedAt).toISOString() })
    .eq('id', meetingId);
  // 칸이 아직 없는 배포에서도 영상 저장은 막지 않습니다.
  if (error && !/started_at/i.test(error.message)) {
    console.warn('회의 시작 시각 저장 실패:', error.message);
  }
}

/**
 * 메모리에만 있는 영상을 올립니다. IndexedDB를 쓸 수 없을 때의 보조 경로입니다.
 * 성공해도 브라우저 보관분을 지우지는 않으므로, 호출하는 쪽에서 지웁니다.
 */
export async function uploadBlobAndInsert(input: SaveInput): Promise<{ ok: true; meetingId: string } | { ok: false; error: string }> {
  if (!input.groupId) {
    return { ok: false, error: '그룹 정보가 없어 회의록을 저장하지 못했습니다.' };
  }
  if (input.blob.size === 0) {
    return {
      ok: false,
      error: '저장할 화면 녹화가 없습니다. 녹화 시작 후 배너가 뜬 것을 확인한 뒤, 몇 초 기다렸다가 종료해 주세요.',
    };
  }

  let stored: StoredVideo;
  try {
    stored = await storeVideoFile(input);
  } catch (err) {
    return { ok: false, error: uploadError(err) };
  }

  const videoFields = videoColumns(stored);
  const { data: userData } = await supabase.auth.getUser();
  // RLS가 로그인한 사람 기준으로 회의 행을 허용하므로, 저장 주체는 지금 세션을 우선합니다.
  const userId = userData.user?.id ?? input.createdBy ?? null;
  if (userId) {
    await addGroupMember(input.groupId, userId);
    await supabase.rpc('ensure_group_creator_member', { p_group_id: input.groupId });
  }

  const recordedAt = new Date(input.startedAt ?? Date.now()).toISOString();
  const notifySaved = async (meetingId: string) => {
    try {
      await notifyGroupMembers({
        groupId: input.groupId,
        type: 'meeting_end',
        title: `${input.groupName || '그룹'} 녹화가 종료됐어요`,
        body: '녹화본이 저장되었습니다.',
        link: `/ai?meeting=${meetingId}`,
        excludeSelf: false,
      });
    } catch (err) {
      console.warn('녹화 종료 알림 실패:', err);
    }
  };

  const existingId = input.meetingId || null;
  if (existingId) {
    const { error: updateError } = await supabase
      .from('meetings')
      .update({
        ...videoFields,
        title: input.title,
        attachments: input.attachments,
        chat_log: input.chatLog,
      })
      .eq('id', existingId);

    if (updateError && /attachments|chat_log/i.test(updateError.message)) {
      const { error: fallbackError } = await supabase
        .from('meetings')
        .update({ ...videoFields, title: input.title })
        .eq('id', existingId);
      if (fallbackError) return { ok: false, error: explainVideoSaveError(fallbackError.message) };
    } else if (updateError) {
      return { ok: false, error: explainVideoSaveError(updateError.message) };
    }

    rememberLastMeeting(existingId);
    await rememberStartedAt(existingId, input.startedAt);
    await notifySaved(existingId);
    return { ok: true, meetingId: existingId };
  }

  const baseRow = {
    group_id: input.groupId,
    title: input.title,
    date: recordedAt,
    ...videoFields,
    created_by: userId,
  };
  const first = await supabase
    .from('meetings')
    .insert({ ...baseRow, attachments: input.attachments, chat_log: input.chatLog })
    .select('id')
    .maybeSingle();

  let insertedId = first.data?.id as string | undefined;
  if (first.error || !insertedId) {
    const canRetryWithoutAttach = !first.error || /attachments|chat_log/i.test(first.error.message);
    if (!canRetryWithoutAttach) {
      return { ok: false, error: explainVideoSaveError(first.error.message) };
    }
    const second = await supabase.from('meetings').insert(baseRow).select('id').maybeSingle();
    if (second.error || !second.data?.id) {
      return {
        ok: false,
        error: explainVideoSaveError(second.error?.message || first.error?.message || '회의록 저장에 실패했습니다.'),
      };
    }
    insertedId = second.data.id as string;
  }

  rememberLastMeeting(insertedId);
  await rememberStartedAt(insertedId, input.startedAt);
  await notifySaved(insertedId);
  return { ok: true, meetingId: insertedId };
}

async function uploadStoredRecordingBody(recordingId: string): Promise<RecordingUploadResult> {
  // 회의록은 이미 저장됐는데 보관분 삭제만 실패한 경우, 파일을 다시 올리지 않고 삭제만 재시도합니다.
  if (savedButNotDeleted.has(recordingId)) {
    try {
      await deleteLocalRecording(recordingId);
      savedButNotDeleted.delete(recordingId);
    } catch (err) {
      console.warn('올린 녹화를 브라우저 보관함에서 지우지 못했습니다.', err);
    }
    clearRecordingUploadFailure(recordingId);
    return { ok: true, meetingId: '', alreadyDone: true };
  }

  await flushRecordingWrites(recordingId);
  const record = await getLocalRecording(recordingId);
  if (!record) {
    clearRecordingUploadFailure(recordingId);
    return { ok: true, meetingId: '', alreadyDone: true };
  }

  // 올리는 도중에 탭이 꺼지면 다음 접속에서 물어보지 않고 이어서 올리도록 대기 상태로 바꿉니다.
  if (record.status !== 'pending_upload') {
    await patchLocalRecording(recordingId, { status: 'pending_upload' });
  }

  const loaded = await loadRecordingBlob(recordingId);
  if (!loaded || loaded.blob.size === 0) {
    await deleteLocalRecording(recordingId).catch(() => {});
    return {
      ok: false,
      kept: false,
      error: '저장할 화면 녹화가 없습니다. 녹화 시작 후 배너가 뜬 것을 확인한 뒤, 몇 초 기다렸다가 종료해 주세요.',
    };
  }

  const current = (await getLocalRecording(recordingId)) ?? loaded.record;
  const saved = await uploadBlobAndInsert({
    blob: loaded.blob,
    groupId: current.groupId,
    dateStr: current.date,
    mimeType: current.mimeType || loaded.blob.type || 'video/webm',
    title: current.title || recordingTitleFromDate(current.date),
    meetingId: current.meetingId || readSessionMeetingId(current.groupId),
    attachments: current.attachments ?? [],
    chatLog: current.chatLog ?? [],
    createdBy: current.createdBy ?? null,
    groupName: current.groupName,
    startedAt: current.createdAt,
  });

  if (!saved.ok) {
    // 실패 배너가 이 녹화를 "지금 녹화 중"으로 숨기지 않게, 알리기 전에 활성 표시를 풉니다.
    clearActiveRecording(recordingId);
    reportRecordingUploadFailure(recordingId, saved.error);
    return { ok: false, error: saved.error, kept: true };
  }

  savedButNotDeleted.add(recordingId);
  try {
    // 회의 행 id를 먼저 적어 두면, 삭제가 실패해도 다음 시도는 같은 행을 갱신합니다.
    await patchLocalRecording(recordingId, { meetingId: saved.meetingId, status: 'pending_upload' });
    await deleteLocalRecording(recordingId);
    savedButNotDeleted.delete(recordingId);
  } catch (err) {
    console.warn('올린 녹화를 브라우저 보관함에서 지우지 못했습니다.', err);
  }
  clearRecordingUploadFailure(recordingId);
  return { ok: true, meetingId: saved.meetingId };
}

/** 보관 중인 녹화 1건을 올리고, 회의록까지 저장되면 IndexedDB에서 지웁니다. */
export function uploadStoredRecording(recordingId: string) {
  return withRecordingLock(recordingId, () => uploadStoredRecordingBody(recordingId).catch(async (err) => {
    const message = uploadError(err);
    try {
      await patchLocalRecording(recordingId, { status: 'pending_upload' });
      clearActiveRecording(recordingId);
      reportRecordingUploadFailure(recordingId, message);
      return { ok: false as const, error: message, kept: true };
    } catch {
      return { ok: false as const, error: message, kept: false };
    }
  }));
}
