import { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import {
  countRecordingChunks,
  deleteLocalRecording,
  downloadRecordingFile,
  isActiveRecording,
  listLocalRecordings,
  recordingRecoveryNotice,
  recordingUploadFailures,
  refreshRecordingRecovery,
  setRecordingRecoveryNotice,
  subscribeRecordingRecovery,
  type LocalRecording,
} from '../utils/meetingRecordingStore';
import { uploadStoredRecording } from '../utils/meetingRecordingUpload';
import styles from './MeetingRecordingRecovery.module.css';

type BannerItem = {
  id: string;
  message: string;
};

/** 이번 탭에서 이미 물어본 녹화. 토큰 갱신마다 같은 질문을 반복하지 않습니다. */
const promptedIds = new Set<string>();
/** 사용자가 아직 올리지 않겠다고 한 녹화. 자동 업로드는 하지 않고 버튼만 남깁니다. */
const declinedIds = new Set<string>();

let passQueue: Promise<void> = Promise.resolve();

function ownsRecording(record: LocalRecording, userId: string) {
  return !record.createdBy || record.createdBy === userId;
}

async function loadBannerItems(): Promise<BannerItem[]> {
  let records: LocalRecording[] = [];
  try {
    records = await listLocalRecordings();
  } catch (err) {
    console.warn('보관한 녹화 목록을 읽지 못했습니다.', err);
    return [];
  }

  const failures = recordingUploadFailures();
  const items: BannerItem[] = [];
  for (const record of records) {
    if (isActiveRecording(record.id)) continue;
    const error = failures.get(record.id);
    const declined = declinedIds.has(record.id);
    // 실패했거나, 사용자가 자동 업로드를 거절한 녹화만 버튼을 보여 줍니다.
    if (!error && !declined) continue;
    items.push({
      id: record.id,
      message: error
        ? `녹화본을 서버에 올리지 못했습니다. 이 브라우저에 보관 중이라 사라지지 않습니다.\n\n${error}`
        : '이전 녹화가 남아 있어요. 이 브라우저에 보관 중이라 탭을 닫아도 사라지지 않습니다.',
    });
  }
  return items;
}

/**
 * 앱을 다시 열거나 온라인이 되면 대기 중인 녹화를 올리고,
 * 녹화 중에 끊긴 조각은 올리기 전에 한 번 물어봅니다.
 */
async function runRecoveryPass() {
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (!userId) return;

  let records: LocalRecording[] = [];
  try {
    records = await listLocalRecordings();
  } catch (err) {
    console.warn('보관한 녹화를 확인하지 못했습니다.', err);
    return;
  }

  for (const record of records) {
    if (record.status !== 'recording') continue;
    if (isActiveRecording(record.id) || !ownsRecording(record, userId)) continue;
    if (promptedIds.has(record.id) || declinedIds.has(record.id)) continue;

    let count = 0;
    try {
      count = await countRecordingChunks(record.id);
    } catch {
      continue;
    }
    if (count === 0) {
      await deleteLocalRecording(record.id).catch(() => {});
      continue;
    }

    promptedIds.add(record.id);
    const yes = window.confirm('이전 녹화가 남아 있어요. 업로드할까요?');
    if (!yes) {
      declinedIds.add(record.id);
      refreshRecordingRecovery();
      continue;
    }
    const result = await uploadStoredRecording(record.id);
    if (result.ok && !result.alreadyDone) {
      setRecordingRecoveryNotice('이전 녹화를 회의록에 저장했습니다.');
    }
  }

  let pending: LocalRecording[] = [];
  try {
    pending = await listLocalRecordings();
  } catch {
    return;
  }
  for (const record of pending) {
    if (record.status !== 'pending_upload') continue;
    if (isActiveRecording(record.id) || !ownsRecording(record, userId)) continue;
    const result = await uploadStoredRecording(record.id);
    if (result.ok && !result.alreadyDone) {
      setRecordingRecoveryNotice('녹화를 회의록에 저장했습니다.');
    }
  }
}

function enqueueRecoveryPass() {
  passQueue = passQueue.then(() => runRecoveryPass()).catch((err) => {
    console.warn('대기 중인 녹화 업로드를 확인하지 못했습니다.', err);
  });
}

/**
 * 회의방 밖에서도 실패한 녹화의 [다시 시도] / [내 컴퓨터에 저장]을 보여 줍니다.
 * 업로드에 실패한 채 회의방을 나가도 버튼을 잃지 않게 앱 루트에 붙입니다.
 */
export default function MeetingRecordingRecovery() {
  const [items, setItems] = useState<BannerItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const pull = () => {
      void loadBannerItems().then((next) => {
        if (!alive) return;
        setItems(next);
        setNotice(recordingRecoveryNotice());
      });
    };

    pull();
    const unsubscribe = subscribeRecordingRecovery(pull);
    enqueueRecoveryPass();

    const onOnline = () => enqueueRecoveryPass();
    const onVisible = () => {
      // 탭으로 돌아오면 대기 중인 업로드를 다시 시도합니다. 이미 물어본 녹화는 다시 묻지 않습니다.
      if (document.visibilityState === 'visible') enqueueRecoveryPass();
    };
    const onInterrupted = () => enqueueRecoveryPass();
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('grop-recording-interrupted', onInterrupted);
    const { data: auth } = supabase.auth.onAuthStateChange(() => enqueueRecoveryPass());

    return () => {
      alive = false;
      unsubscribe();
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('grop-recording-interrupted', onInterrupted);
      auth.subscription.unsubscribe();
    };
  }, []);

  const retry = async (id: string) => {
    setBusyId(id);
    declinedIds.delete(id);
    try {
      const result = await uploadStoredRecording(id);
      if (result.ok && !result.alreadyDone) {
        setRecordingRecoveryNotice('녹화를 회의록에 저장했습니다.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const saveOnComputer = async (id: string) => {
    setBusyId(id);
    try {
      await downloadRecordingFile(id);
    } catch (err) {
      alert(err instanceof Error ? err.message : '녹화 파일을 저장하지 못했습니다.');
    } finally {
      setBusyId(null);
    }
  };

  if (items.length === 0 && !notice) return null;

  return (
    <div className={styles.wrap}>
      {notice && <div className={styles.notice}>{notice}</div>}
      {items.map((item) => (
        <div key={item.id} className={styles.card} role="alert">
          <p className={styles.message}>{item.message}</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.retry}
              disabled={busyId === item.id}
              onClick={() => void retry(item.id)}
            >
              다시 시도
            </button>
            <button
              type="button"
              className={styles.save}
              disabled={busyId === item.id}
              onClick={() => void saveOnComputer(item.id)}
            >
              내 컴퓨터에 저장
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
