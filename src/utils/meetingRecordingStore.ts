/**
 * 회의 녹화를 브라우저 IndexedDB에 남겨 둡니다.
 * 서버로 올리기 전에 탭이 꺼지거나 업로드가 실패해도 조각을 잃지 않기 위함입니다.
 * 라이브러리 없이 IndexedDB만 사용합니다.
 *
 * 조각은 녹화 정보와 다른 저장소에 둡니다.
 * 녹화 중에는 약 0.25초마다 조각이 오는데, 한 레코드에 이어 붙이면 영상 전체를 매번 다시 쓰게 됩니다.
 */

export type RecordingStatus = 'recording' | 'pending_upload';

/** 녹화 1건. 업로드가 끝나 meetings 행까지 저장된 뒤에만 지웁니다. */
export type LocalRecording = {
  id: string;
  groupId: string;
  /** 녹화를 시작한 로컬 날짜. YYYY-MM-DD. 서버 폴더와 회의 제목에 씁니다. */
  date: string;
  mimeType: string;
  status: RecordingStatus;
  createdAt: number;
  /** 이미 회의 행이 있으면 재시도 때 새 행을 만들지 않고 이 행에 영상을 붙입니다. */
  meetingId?: string | null;
  /**
   * 이 녹화가 그 회의 행의 영상을 이미 쓴 뒤입니다.
   * 다시 올릴 때는 그 행을 갱신하고, 아직이면 영상이 있는 행을 덮지 않습니다.
   */
  ownsMeetingRow?: boolean;
  title?: string;
  attachments?: unknown;
  chatLog?: unknown;
  createdBy?: string | null;
  groupName?: string;
  /**
   * 업로드 직전에 메모리 조각으로 다시 쓴 묶음 번호.
   * 다시 쓰는 도중 탭이 꺼져도 이전 조각은 이 값이 생기기 전까지 그대로 둡니다.
   */
  committedGeneration?: number;
};

type ChunkRow = {
  id?: number;
  recordingId: string;
  seq: number;
  /** 0 은 녹화 중에 바로 넣은 조각입니다. */
  generation: number;
  blob: Blob;
};

const DB_NAME = 'grop-meeting-recordings';
const DB_VERSION = 1;
const RECORDINGS = 'recordings';
const CHUNKS = 'chunks';

const activeIds = new Set<string>();
const writeTails = new Map<string, Promise<void>>();
const nextSeq = new Map<string, number>();

const recoveryListeners = new Set<() => void>();
const uploadFailures = new Map<string, string>();
let recoveryNotice: string | null = null;
let noticeTimer = 0;

let dbPromise: Promise<IDBDatabase> | null = null;

/** 지금 이 탭에서 녹화 중인 id. 이전 녹화로 오인하고 업로드를 묻지 않기 위해 구분합니다. */
export function noteActiveRecording(id: string) {
  activeIds.add(id);
}

export function clearActiveRecording(id: string) {
  activeIds.delete(id);
}

export function isActiveRecording(id: string) {
  return activeIds.has(id);
}

export function newRecordingId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `rec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function subscribeRecordingRecovery(listener: () => void) {
  recoveryListeners.add(listener);
  return () => recoveryListeners.delete(listener);
}

function emitRecovery() {
  recoveryListeners.forEach((listener) => listener());
}

export function refreshRecordingRecovery() {
  emitRecovery();
}

export function recordingUploadFailures() {
  return new Map(uploadFailures);
}

export function reportRecordingUploadFailure(id: string, message: string) {
  uploadFailures.set(id, message);
  emitRecovery();
}

export function clearRecordingUploadFailure(id: string) {
  if (!uploadFailures.delete(id)) return;
  emitRecovery();
}

export function recordingRecoveryNotice() {
  return recoveryNotice;
}

/** 자동으로 다시 올린 뒤 잠깐 보여주는 안내. 회의 화면의 alert와 겹치지 않게 배너만 바꿉니다. */
export function setRecordingRecoveryNotice(message: string | null) {
  recoveryNotice = message;
  window.clearTimeout(noticeTimer);
  if (message) {
    noticeTimer = window.setTimeout(() => {
      recoveryNotice = null;
      emitRecovery();
    }, 6000);
  }
  emitRecovery();
}

function formatLocalDate(time: number) {
  const now = new Date(time);
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function openRecordingDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('이 브라우저는 녹화 보관(IndexedDB)을 지원하지 않습니다.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RECORDINGS)) {
        database.createObjectStore(RECORDINGS, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(CHUNKS)) {
        const chunks = database.createObjectStore(CHUNKS, { keyPath: 'id', autoIncrement: true });
        chunks.createIndex('byRecording', 'recordingId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB를 열지 못했습니다.'));
  });
}

function getDb() {
  if (!dbPromise) {
    dbPromise = openRecordingDb().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

function runTx(
  database: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, mode);
    try {
      work(tx.objectStore(storeName));
    } catch (err) {
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 작업이 중단되었습니다.'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 작업에 실패했습니다.'));
  });
}

/** 녹화 1건을 만들기만 합니다. 조각은 이후 append로 쌓입니다. */
export async function createLocalRecording(input: {
  id: string;
  groupId: string;
  mimeType: string;
  createdBy?: string | null;
  groupName?: string;
}) {
  const now = Date.now();
  const row: LocalRecording = {
    id: input.id,
    groupId: input.groupId,
    date: formatLocalDate(now),
    mimeType: input.mimeType || 'video/webm',
    status: 'recording',
    createdAt: now,
    createdBy: input.createdBy ?? null,
    groupName: input.groupName,
  };
  const database = await getDb();
  await runTx(database, RECORDINGS, 'readwrite', (store) => {
    store.put(row);
  });
  nextSeq.set(input.id, 0);
}

export async function getLocalRecording(id: string): Promise<LocalRecording | null> {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(RECORDINGS, 'readonly');
    const request = tx.objectStore(RECORDINGS).get(id);
    request.onsuccess = () => resolve((request.result as LocalRecording | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('녹화 정보를 읽지 못했습니다.'));
  });
}

export async function listLocalRecordings(): Promise<LocalRecording[]> {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(RECORDINGS, 'readonly');
    const request = tx.objectStore(RECORDINGS).getAll();
    request.onsuccess = () => resolve((request.result as LocalRecording[] | undefined) ?? []);
    request.onerror = () => reject(request.error ?? new Error('녹화 목록을 읽지 못했습니다.'));
  });
}

/** 상태와 회의 정보만 바꿉니다. 없는 녹화는 조용히 무시합니다. */
export async function patchLocalRecording(id: string, patch: Partial<Omit<LocalRecording, 'id'>>) {
  const current = await getLocalRecording(id);
  if (!current) return;
  const database = await getDb();
  await runTx(database, RECORDINGS, 'readwrite', (store) => {
    store.put({ ...current, ...patch, id });
  });
}

async function readChunks(recordingId: string): Promise<ChunkRow[]> {
  const database = await getDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(CHUNKS, 'readonly');
    const request = tx.objectStore(CHUNKS).index('byRecording').getAll(IDBKeyRange.only(recordingId));
    request.onsuccess = () => resolve((request.result as ChunkRow[] | undefined) ?? []);
    request.onerror = () => reject(request.error ?? new Error('녹화 조각을 읽지 못했습니다.'));
  });
}

function chunksForPlayback(record: LocalRecording, rows: ChunkRow[]) {
  const generation = record.committedGeneration ?? 0;
  return rows
    .filter((row) => row.generation === generation && row.blob && row.blob.size > 0)
    .sort((a, b) => a.seq - b.seq);
}

export async function countRecordingChunks(recordingId: string) {
  const record = await getLocalRecording(recordingId);
  if (!record) return 0;
  const rows = await readChunks(recordingId);
  return chunksForPlayback(record, rows).length;
}

export async function loadRecordingBlob(recordingId: string): Promise<{ record: LocalRecording; blob: Blob } | null> {
  const record = await getLocalRecording(recordingId);
  if (!record) return null;
  const pieces = chunksForPlayback(record, await readChunks(recordingId)).map((row) => row.blob);
  if (pieces.length === 0) return null;
  return {
    record,
    blob: new Blob(pieces, { type: record.mimeType || 'video/webm' }),
  };
}

async function appendChunkNow(recordingId: string, blob: Blob, seq: number) {
  const database = await getDb();
  await runTx(database, CHUNKS, 'readwrite', (store) => {
    store.add({ recordingId, seq, generation: 0, blob });
  });
}

/**
 * 조각을 순서대로 넣습니다.
 * ondataavailable이 겹쳐 들어와도 순서가 꼬이지 않게 녹화 id마다 한 줄로 잇습니다.
 * 한 조각이 실패해도 다음 조각은 계속 넣고, 메모리에 남은 전체는 업로드 직전에 다시 맞춥니다.
 */
export function appendRecordingChunk(recordingId: string, blob: Blob): Promise<void> {
  const prev = writeTails.get(recordingId) ?? Promise.resolve();
  const job = prev.then(async () => {
    const seq = nextSeq.get(recordingId) ?? 0;
    await appendChunkNow(recordingId, blob, seq);
    nextSeq.set(recordingId, seq + 1);
  }).catch((err) => {
    console.warn('녹화 조각을 브라우저에 저장하지 못했습니다.', err);
  });
  writeTails.set(recordingId, job);
  return job;
}

export function flushRecordingWrites(recordingId: string) {
  return writeTails.get(recordingId) ?? Promise.resolve();
}

/**
 * 메모리에 있는 조각이 IndexedDB와 개수가 다르면, 메모리를 새 묶음으로 쓴 뒤에만 이전 조각을 지웁니다.
 * 개수가 같으면 녹화 중에 이미 다 들어간 것이므로 영상 전체를 다시 쓰지 않습니다.
 */
export async function syncChunksFromMemory(recordingId: string, blobs: Blob[]) {
  // 먼저 대기 중인 저장을 끝내야, 방금 들어온 마지막 조각이 빠지지 않습니다.
  await flushRecordingWrites(recordingId);
  const usable = blobs.filter((blob) => blob && blob.size > 0);
  // 빈 목록으로 덮어쓰면 이미 보관된 조각까지 지워집니다.
  if (usable.length === 0) return;
  const record = await getLocalRecording(recordingId);
  if (!record) throw new Error('보관 중인 녹화 정보를 찾지 못했습니다.');
  const saved = chunksForPlayback(record, await readChunks(recordingId));
  if (saved.length === usable.length) return;

  const generation = Date.now();
  const database = await getDb();
  await runTx(database, CHUNKS, 'readwrite', (store) => {
    usable.forEach((blob, seq) => {
      store.add({ recordingId, seq, generation, blob });
    });
  });
  // 이 값을 적은 뒤에야 이전 조각을 지웁니다. 그 전에 탭이 꺼지면 예전 조각으로 복구합니다.
  await patchLocalRecording(recordingId, { committedGeneration: generation });
  await runTx(database, CHUNKS, 'readwrite', (store) => {
    const request = store.index('byRecording').openCursor(IDBKeyRange.only(recordingId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const value = cursor.value as ChunkRow;
      if (value.generation !== generation) cursor.delete();
      cursor.continue();
    };
  });
  nextSeq.set(recordingId, usable.length);
}

/** 업로드와 회의록 저장이 모두 끝난 뒤에만 호출합니다. */
export async function deleteLocalRecording(id: string) {
  const database = await getDb();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction([RECORDINGS, CHUNKS], 'readwrite');
    tx.objectStore(RECORDINGS).delete(id);
    const request = tx.objectStore(CHUNKS).index('byRecording').openCursor(IDBKeyRange.only(id));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('녹화 보관분을 지우지 못했습니다.'));
    tx.onerror = () => reject(tx.error ?? new Error('녹화 보관분을 지우지 못했습니다.'));
  });
  writeTails.delete(id);
  nextSeq.delete(id);
  uploadFailures.delete(id);
  clearActiveRecording(id);
  emitRecovery();
}

/** 조각을 이어 붙여 .webm 으로 이 컴퓨터에 내려받습니다. */
export function downloadBlobFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 브라우저가 다운로드를 시작하기 전에 주소를 지우면 저장이 취소되는 경우가 있습니다.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadRecordingFile(recordingId: string) {
  const loaded = await loadRecordingBlob(recordingId);
  if (!loaded || loaded.blob.size === 0) {
    throw new Error('이 브라우저에 저장할 녹화 조각이 없습니다.');
  }
  const safeDate = loaded.record.date || 'recording';
  downloadBlobFile(loaded.blob, `회의녹화-${safeDate}.webm`);
}
