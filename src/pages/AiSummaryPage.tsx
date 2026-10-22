import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import MeetingDetailView from '../components/MeetingDetailView';
import MeetingAttendeeFaces, { attendeeUserIds, loadGroupFaceIndex } from '../components/MeetingAttendeeFaces';
import { liveIdentitiesFor, useLiveRooms } from '../utils/liveMeeting';
import { readLastMeeting } from '../utils/lastMeeting';
import { getApiBase } from '../utils/apiBase';
import { meetingHasStoredVideo, meetingVideoStatusLabel } from '../utils/meetingVideo';

// 우측 회의 목록에 쓸 회의 행 타입 (문서 탭과 동일한 meetings 데이터)
type MeetingRow = {
  id: string;
  title: string | null;
  date: string;
  summary: string | null;
  video_url?: string | null;
  video_key?: string | null;
  video_status?: string | null;
  video_size_bytes?: number | null;
  group_id: string;
  attendees?: unknown;
  chat_log?: unknown;
  created_by?: string | null;
};

/** DB bigint는 문자열로 올 수 있어서, 용량으로 쓸 수 있는 숫자만 고릅니다. */
function asBytes(value: unknown): number | null {
  const bytes = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  return bytes;
}

/** 목록과 전체 용량에 바로 보일 짧은 크기 문자열입니다. 없으면 null입니다. */
function formatVideoSize(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

/** 영상 키의 날짜 칸(YYYY-MM-DD)과 맞출 회의의 지역 날짜입니다. */
function meetingDayKey(dateStr: string): string | null {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * 이 카드 체크 왼쪽에 쓸 영상 바이트.
 * 저장된 키가 그 파일이고, 키가 없으면 같은 그룹·같은 날짜의 파일을 그 회의 영상으로 봅니다.
 */
function meetingVideoBytes(
  meeting: MeetingRow,
  rows: MeetingRow[],
  sizeByKey: Record<string, number>,
): number | null {
  const keyed = meeting.video_key ? asBytes(sizeByKey[meeting.video_key]) : null;
  if (keyed) return keyed;
  const saved = asBytes(meeting.video_size_bytes);
  if (saved) return saved;

  const day = meetingDayKey(meeting.date);
  if (!meeting.group_id || !day) return null;
  const claimed = new Set(rows.map((row) => row.video_key).filter((key): key is string => !!key));
  const prefix = `meeting-videos/${meeting.group_id}/${day}/`;
  let sum = 0;
  for (const [key, size] of Object.entries(sizeByKey)) {
    if (claimed.has(key) || !key.startsWith(prefix)) continue;
    sum += asBytes(size) ?? 0;
  }
  return sum > 0 ? sum : null;
}

/** '2026.09.06 10:00AM' 형식으로 회의 날짜를 표시합니다. */
function formatMeetingDate(dateStr: string) {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${y}.${m}.${day} ${String(hours).padStart(2, '0')}:${minutes}${ampm}`;
}

/**
 * AI 요약 페이지
 * - 왼쪽: 선택한 회의의 녹화 영상 + AI 회의록 (MeetingDetailView 재사용)
 * - 오른쪽: 회의 목록. 행을 누르면 왼쪽이 그 회의로 바뀝니다.
 */
export default function AiSummaryPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // 우측 회의 목록 — 문서 탭과 같은 소스(내가 속한 그룹의 회의)를 최신순으로 보여 줍니다.
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  // 왼쪽에 표시할 회의 id. 목록을 누르면 여기가 바뀝니다.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // R2에 있는 실제 파일 크기. 목록 칸에 크기가 없어도 용량을 바로 채웁니다.
  const [storageBytes, setStorageBytes] = useState<number | null>(null);
  const [sizeByKey, setSizeByKey] = useState<Record<string, number>>({});
  // 지운 회의는 5초 새로고침이 다시 넣지 않습니다.
  const removedIds = useRef(new Set<string>());
  const [storageTick, setStorageTick] = useState(0);
  const [avatarByUserId, setAvatarByUserId] = useState<Record<string, string>>({});
  const [nicknameToIdByGroup, setNicknameToIdByGroup] = useState<Map<string, Map<string, string>>>(() => new Map());
  // 진행중은 그 회의 방에 사람이 남아 있을 때만입니다. 비면 완료입니다.
  const liveRooms = useLiveRooms();

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        navigate('/');
        return;
      }

      const { data: memberRows, error: memberError } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', sessionData.session.user.id);
      if (memberError) {
        console.warn('그룹 목록을 불러오지 못했습니다:', memberError.message);
      }

      const ids = [...new Set((memberRows ?? []).map((row) => row.group_id).filter(Boolean))];
      if (!mounted) return;
      if (ids.length === 0) {
        setMeetings([]);
        setSelectedId(null);
        return;
      }

      // attendees 칸이 없어도 created_by 는 남겨야 참석자 아이콘이 전부 비지 않습니다.
      // 맨 위는 R2 상태 칸을 포함합니다. SQL 적용 전이면 아래 예전 칸으로 내려갑니다.
      const meetingColumns = [
        'id, title, date, summary, video_url, video_key, video_status, video_size_bytes, group_id, attendees, chat_log, created_by',
        // 용량 칸만 없어도 영상 키는 남겨야 체크 왼쪽 크기를 파일과 맞출 수 있습니다.
        'id, title, date, summary, video_url, video_key, video_status, group_id, attendees, chat_log, created_by',
        'id, title, date, summary, video_url, group_id, attendees, chat_log, created_by',
        'id, title, date, summary, video_url, group_id, chat_log, created_by',
        'id, title, date, summary, video_url, group_id, created_by',
      ];
      let data: MeetingRow[] | null = null;
      for (const columns of meetingColumns) {
        const res = await supabase
          .from('meetings')
          .select(columns)
          .in('group_id', ids)
          .order('date', { ascending: false });
        if (!res.error) {
          data = res.data as unknown as MeetingRow[] | null;
          break;
        }
        if (!/attendees|chat_log|video_key|video_status|video_size_bytes/i.test(res.error.message)) {
          console.warn('회의록 목록을 불러오지 못했습니다:', res.error.message);
          break;
        }
      }
      const faces = await loadGroupFaceIndex(ids);
      if (!mounted) return;
      setAvatarByUserId(faces.avatarByUserId);
      setNicknameToIdByGroup(faces.nicknameToIdByGroup);

      if (!mounted || data === null) return;
      const rows = data.filter((row) => !removedIds.current.has(row.id));
      setMeetings(rows);

      // 5초마다 목록만 새로고칩니다. 주소의 회의로 다시 바꾸면 보고 있던 화면이 자꾸 바뀝니다.
      setSelectedId((prev) => {
        if (prev && rows.some((row) => row.id === prev)) return prev;
        const fromUrl = searchParams.get('meeting');
        if (fromUrl && rows.some((row) => row.id === fromUrl)) return fromUrl;
        const last = readLastMeeting();
        if (last && rows.some((row) => row.id === last)) return last;
        return rows[0]?.id ?? null;
      });
    };

    void load();
    const timer = window.setInterval(() => { void load(); }, 5000);
    const onFocus = () => {
      // 탭이 가려진 동안에는 다시 고르지 않습니다. 돌아왔을 때만 목록을 갱신합니다.
      if (document.visibilityState === 'hidden') return;
      void load();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      mounted = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [navigate, searchParams]);

  useEffect(() => {
    let alive = true;
    const loadStorage = async () => {
      const uploadToken = import.meta.env.VITE_MEETING_UPLOAD_TOKEN as string | undefined;
      const headers: Record<string, string> = {};
      if (uploadToken) headers['x-upload-token'] = uploadToken;
      // 서버 용량 주소가 없어도, 이 사이트가 파일 크기를 주면 체크 왼쪽에 바로 씁니다.
      const bases = [window.location.origin.replace(/\/$/, '')];
      const api = getApiBase();
      if (!bases.includes(api)) bases.push(api);
      for (const base of bases) {
        try {
          const res = await fetch(`${base}/api/meetings/storage`, { headers });
          const type = res.headers.get('content-type') || '';
          if (!res.ok || !type.includes('json') || !alive) continue;
          const data = await res.json() as { totalBytes?: number; files?: { key: string; size: number }[] };
          if (!alive) return;
          setStorageBytes(typeof data.totalBytes === 'number' ? data.totalBytes : 0);
          const next: Record<string, number> = {};
          for (const file of data.files ?? []) next[file.key] = file.size;
          setSizeByKey(next);
          return;
        } catch {
          // 다음 주소에서 용량을 찾습니다.
        }
      }
    };
    void loadStorage();
    return () => {
      alive = false;
    };
  }, [storageTick]);

  const totalBytes = meetings.reduce((sum, row) => sum + (asBytes(row.video_size_bytes) ?? 0), 0);

  /** 체크·마이너스·X 로 그 회의 카드, 영상, 요약, 챕터를 지웁니다. */
  const deleteMeetingCard = async (meeting: MeetingRow) => {
    if (!window.confirm('정말 삭제하시겠습니까?')) return;

    // 영상 주소가 아직 없어도 챕터와 회의 카드는 이어서 지웁니다.
    if (meetingHasStoredVideo(meeting)) {
      const params = new URLSearchParams();
      if (meeting.video_key) params.set('key', meeting.video_key);
      if (meeting.video_url) params.set('path', meeting.video_url);
      const uploadToken = import.meta.env.VITE_MEETING_UPLOAD_TOKEN as string | undefined;
      const headers: Record<string, string> = {};
      if (uploadToken) headers['x-upload-token'] = uploadToken;
      try {
        await fetch(`${getApiBase()}/api/meetings/video?${params}`, { method: 'DELETE', headers });
      } catch {
        // 파일 서버가 꺼져 있어도 목록의 회의와 챕터는 지웁니다.
      }
    }

    const removed = await supabase.from('meetings').delete().eq('id', meeting.id).select('id');
    if (!removed.error && (removed.data?.length ?? 0) > 0) {
      removedIds.current.add(meeting.id);
      const rest = meetings.filter((row) => row.id !== meeting.id);
      setMeetings(rest);
      setSelectedId((current) => (current === meeting.id ? rest[0]?.id ?? null : current));
      setStorageTick((tick) => tick + 1);
      return;
    }

    // 행 삭제가 막혀 있으면 챕터·요약·영상 칸을 비워 화면에 남지 않게 합니다.
    const payload: Record<string, null> = {
      summary: null,
      video_url: null,
      video_key: null,
      video_status: null,
      video_size_bytes: null,
      chapters: null,
      speakers: null,
      transcript: null,
    };
    let error: { message: string } | null = null;
    for (let i = 0; i < 8; i += 1) {
      const result = await supabase.from('meetings').update(payload).eq('id', meeting.id);
      if (!result.error) {
        error = null;
        break;
      }
      error = result.error;
      const missing = result.error.message.match(/Could not find the '([^']+)' column/)?.[1]
        ?? result.error.message.match(/column "([^"]+)" of relation "meetings" does not exist/)?.[1];
      if (!missing || !(missing in payload)) break;
      delete payload[missing];
      if (Object.keys(payload).length === 0) break;
    }
    if (error) {
      alert(error.message);
      return;
    }

    removedIds.current.add(meeting.id);
    const rest = meetings.filter((row) => row.id !== meeting.id);
    setMeetings(rest);
    setSelectedId((current) => (current === meeting.id ? rest[0]?.id ?? null : current));
    setStorageTick((tick) => tick + 1);
  };

  // 기본 포함 10GB 안에서 사용량과 남은 양을 막대로 보여 줍니다.
  const includedBytes = 10 * 1024 * 1024 * 1024;
  const usedBytes = storageBytes ?? totalBytes;
  const remainingBytes = Math.max(0, includedBytes - usedBytes);
  const usedPercent = Math.min(100, (usedBytes / includedBytes) * 100);

  return (
    <AppShell activePage="ai">
      <div className="ai-page">
        {/* 좌측: 선택한 회의의 영상 + AI 회의록 */}
        <div className="ai-main-column">
          {selectedId ? (
            <MeetingDetailView key={selectedId} meetingId={selectedId} variant="ai" />
          ) : (
            <div className="panel" style={{ padding: 40, color: '#888' }}>
              왼쪽에 표시할 회의록이 없어요. 회의방에서 녹화를 저장하면 여기에 나타납니다.
            </div>
          )}
        </div>

        {/* 우측: 회의 목록 패널 — 누르면 왼쪽이 그 회의로 전환됩니다 */}
        <section className="panel ai-meeting-list-panel">
          <div className="section-head">
            <h2>회의 목록</h2>
          </div>

          <div className="ai-meeting-list-head">
            <span className="col-title">회의 제목</span>
            <span className="col-meta">
              <span>진행 상태</span>
              <span>참석자</span>
              <span>AI 요약</span>
            </span>
          </div>

          <div className="ai-meeting-list">
            {meetings.length === 0 ? (
              <div className="meeting-card-row" style={{ cursor: 'default' }}>
                <span className="title">아직 회의록이 없어요</span>
              </div>
            ) : (
              meetings.map((m) => {
                const hasSummary = !!m.summary?.trim();
                const active = m.id === selectedId;
                // 방에 사람이 있으면 진행중, 아무도 없으면 완료입니다. AI 요약 여부는 오른쪽 아이콘입니다.
                const inRoom = liveRooms.some((room) => room.meetingId === m.id);
                const statusLabel = inRoom ? '진행중' : '완료';
                const statusClass = inRoom ? 'progress' : 'done';
                const videoLabel = meetingVideoStatusLabel(m.video_status);
                const sizeLabel = formatVideoSize(meetingVideoBytes(m, meetings, sizeByKey));
                const faceIds = attendeeUserIds(m, nicknameToIdByGroup.get(m.group_id));
                for (const id of liveIdentitiesFor(liveRooms, m.id)) {
                  if (!faceIds.includes(id)) faceIds.push(id);
                }
                return (
                  <div
                    className="meeting-card-row"
                    key={m.id}
                    onClick={() => setSelectedId(m.id)}
                    style={active ? { borderColor: 'var(--color-primary)', background: '#faf8f6' } : undefined}
                  >
                    <div className="meeting-card-row-top">
                      <span className="title">
                        {m.title?.trim() || '회의'}
                        {videoLabel ? (
                          <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: '#888' }}>{videoLabel}</span>
                        ) : null}
                      </span>
                      <span className="meeting-card-row-actions">
                        <span className={`status-pill ${statusClass}`}>
                          {statusLabel}
                        </span>
                        {/* 카드에 마우스를 올렸을 때만 오른쪽 위에 보입니다. */}
                        <button
                          type="button"
                          className="ai-card-delete"
                          aria-label="영상 및 요약 삭제"
                          title="영상 및 요약 삭제"
                          onClick={(event) => {
                            event.stopPropagation();
                            void deleteMeetingCard(m);
                          }}
                        >
                          ×
                        </button>
                      </span>
                    </div>
                    <div className="meeting-card-row-bottom">
                      <span>{formatMeetingDate(m.date)}</span>
                      <MeetingAttendeeFaces
                        ids={faceIds}
                        avatarByUserId={avatarByUserId}
                      />
                      <span className="ai-summary-mark">
                        {/* 마이너스·체크 바로 왼쪽. 이 영상 파일이 차지하는 용량입니다. */}
                        {sizeLabel ? <span className="ai-video-size">{sizeLabel}</span> : null}
                        {/* 체크·마이너스를 누르면 이 회의 카드와 챕터를 지웁니다. */}
                        <button
                          type="button"
                          className="ai-icon"
                          aria-label="이 회의와 챕터 삭제"
                          title="이 회의와 챕터 삭제"
                          onClick={(event) => {
                            event.stopPropagation();
                            void deleteMeetingCard(m);
                          }}
                        >
                          {hasSummary
                            ? <Icon name="check-circle" className="done" />
                            : <Icon name="minus-circle" className="pending" />}
                        </button>
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {/* 목록 아래 막대. 스크롤해도 패널 바닥에 사용량과 남은 용량이 바로 보입니다. */}
          <div className="ai-storage-total">
            <div className="ai-storage-bar" aria-hidden="true">
              <div className="ai-storage-bar-used" style={{ width: `${usedPercent}%` }} />
            </div>
            <div className="ai-storage-labels">
              <span>사용 {formatVideoSize(usedBytes) ?? '0B'}</span>
              <span>남음 {formatVideoSize(remainingBytes) ?? '0B'}</span>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
