import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import {
  displayFileName,
  downloadMeetingFile,
  formatChatFileSize,
  type MeetingSharedFile,
} from '../utils/meetingChat';
import {
  fetchGroupMeetingDocs,
  fetchMeetingDocAttachments,
  fetchGroupChatFiles,
  isSameLocalDay,
} from '../utils/meetingDocs';

type MeetingAttachment = Pick<MeetingSharedFile, 'id' | 'name' | 'path' | 'size' | 'mime' | 'ts'>;

type MeetingDoc = {
  id: string;
  title: string | null;
  date: string;
  summary: string | null;
  group_id: string;
  /** 회의가 열린 그룹 이름 — 「연결된 회의」열에 표시 */
  group_name?: string | null;
  attachments?: MeetingAttachment[] | null;
};

/** 회의 날짜를 목업처럼 '9월 3일' 형식으로 보여줍니다. */
function formatDocDate(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** 문서 제목: 회의 이름 + 회의록 */
function documentTitle(meetingTitle: string | null, dateStr: string) {
  const base = meetingTitle?.trim() || formatDocDate(dateStr) + ' 회의';
  return base.includes('회의록') ? base : `${base} - 회의록`;
}

/** DB jsonb 첨부를 안전하게 배열로 맞춥니다. */
function normalizeAttachments(raw: unknown): MeetingAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw
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
}

/** 로컬 날짜 키 (같은 날 회의 합치기용) */
function localDayKey(dateStr: string) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 같은 그룹·같은 날 회의는 한 줄로 합치고 첨부를 모읍니다. */
function mergeSameDayMeetings(docs: MeetingDoc[]): MeetingDoc[] {
  const buckets = new Map<string, MeetingDoc>();
  for (const doc of docs) {
    const key = `${doc.group_id}::${localDayKey(doc.date)}`;
    const prev = buckets.get(key);
    if (!prev) {
      buckets.set(key, { ...doc, attachments: normalizeAttachments(doc.attachments) });
      continue;
    }
    const filesByPath = new Map<string, MeetingAttachment>();
    for (const f of normalizeAttachments(prev.attachments)) filesByPath.set(f.path, f);
    for (const f of normalizeAttachments(doc.attachments)) filesByPath.set(f.path, f);
    const newer = new Date(doc.date).getTime() > new Date(prev.date).getTime() ? doc : prev;
    buckets.set(key, {
      ...newer,
      group_name: newer.group_name || prev.group_name,
      summary: newer.summary || prev.summary,
      attachments: [...filesByPath.values()],
    });
  }
  return [...buckets.values()].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
}

/**
 * 문서 탭
 * 내가 속한 그룹의 회의(녹화·요약·첨부)를 문서 목록으로 보여 줍니다.
 * 열기 → 그 회의에 첨부된 파일 목록 + 개별 다운로드.
 */
export default function DocumentList() {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<MeetingDoc[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  /** 열기로 고른 문서 — 첨부 목록 모달 */
  const [openDoc, setOpenDoc] = useState<MeetingDoc | null>(null);
  const [openFiles, setOpenFiles] = useState<MeetingAttachment[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        navigate('/');
        return;
      }

      const { data: memberRows } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', sessionData.session.user.id);

      const ids = [...new Set((memberRows ?? []).map((row) => row.group_id).filter(Boolean))];
      if (!mounted) return;
      setGroupIds(ids);

      if (ids.length === 0) {
        setDocs([]);
        setLoading(false);
        return;
      }

      // 그룹 id → 이름 (연결된 회의 열에 표시)
      const { data: groupRows } = await supabase
        .from('groups')
        .select('id, name')
        .in('id', ids);
      const groupNameById = new Map<string, string>();
      for (const g of groupRows ?? []) {
        if (g?.id && typeof g.name === 'string' && g.name.trim()) {
          groupNameById.set(g.id, g.name.trim());
        }
      }

      // attachments 컬럼이 있으면 함께 읽고, 없으면 기본 컬럼만 다시 조회합니다.
      let meetings: MeetingDoc[] = [];
      const withAttach = await supabase
        .from('meetings')
        .select('id, title, date, summary, group_id, attachments')
        .in('group_id', ids)
        .order('date', { ascending: false });

      if (withAttach.error && /attachments/i.test(withAttach.error.message)) {
        const fallback = await supabase
          .from('meetings')
          .select('id, title, date, summary, group_id')
          .in('group_id', ids)
          .order('date', { ascending: false });
        meetings = (fallback.data as MeetingDoc[] | null) ?? [];
      } else {
        meetings = (withAttach.data as MeetingDoc[] | null) ?? [];
      }

      // 서버 meeting-docs 와 병합 — DB에 첨부가 없어도 파일이 보이게 합니다.
      const byId = new Map<string, MeetingDoc>();
      for (const m of meetings) {
        byId.set(m.id, {
          ...m,
          group_name: groupNameById.get(m.group_id) ?? null,
        });
      }

      await Promise.all(
        ids.map(async (gid) => {
          const serverDocs = await fetchGroupMeetingDocs(gid);
          for (const sd of serverDocs) {
            const prev = byId.get(sd.id);
            const groupId = sd.groupId || gid;
            const groupName = groupNameById.get(groupId) ?? null;
            if (prev) {
              const dbFiles = normalizeAttachments(prev.attachments);
              const merged = sd.files.length ? sd.files : dbFiles;
              byId.set(sd.id, {
                ...prev,
                attachments: merged,
                group_name: prev.group_name || groupName,
              });
            } else if (sd.files.length > 0) {
              byId.set(sd.id, {
                id: sd.id,
                title: sd.title || null,
                date: sd.date,
                summary: null,
                group_id: groupId,
                group_name: groupName,
                attachments: sd.files,
              });
            }
          }
        }),
      );

      // meeting-docs/DB 첨부가 비어 있으면, 같은 날 업로드된 실제 파일로 보강합니다.
      await Promise.all(
        ids.map(async (gid) => {
          const diskFiles = await fetchGroupChatFiles(gid);
          if (diskFiles.length === 0) return;
          for (const [id, doc] of byId) {
            if (doc.group_id !== gid) continue;
            if (normalizeAttachments(doc.attachments).length > 0) continue;
            const sameDay = diskFiles.filter((f) => f.ts && isSameLocalDay(f.ts, doc.date));
            if (sameDay.length > 0) {
              byId.set(id, { ...doc, attachments: sameDay });
            }
          }
        }),
      );

      const merged = mergeSameDayMeetings([...byId.values()]);

      if (!mounted) return;
      setDocs(merged);
      setLoading(false);
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [navigate]);

  const handleCreate = () => {
    if (groupIds.length === 1) {
      navigate(`/room/${groupIds[0]}`);
      return;
    }
    if (groupIds.length > 1) {
      navigate('/main');
      return;
    }
    alert('먼저 그룹을 만든 뒤 회의방에서 파일을 올리거나 녹화를 저장하면, 여기에 문서가 생깁니다.');
  };

  const handleOpen = async (doc: MeetingDoc) => {
    setOpenDoc(doc);
    setOpenFiles(normalizeAttachments(doc.attachments));
    setLoadingFiles(true);
    try {
      // 1) 서버 meeting-docs 우선
      const serverFiles = await fetchMeetingDocAttachments(doc.id, doc.group_id);
      if (serverFiles.length > 0) {
        setOpenFiles(serverFiles);
        return;
      }

      // 2) DB attachments
      const dbFiles = normalizeAttachments(doc.attachments);
      if (dbFiles.length > 0) {
        setOpenFiles(dbFiles);
        return;
      }

      // 3) 폴백: 같은 그룹·같은 날짜에 올라간 실제 파일 (예전 서버에 meeting-docs 없을 때)
      const groupFiles = await fetchGroupChatFiles(doc.group_id);
      const sameDay = groupFiles.filter((f) => f.ts && isSameLocalDay(f.ts, doc.date));
      setOpenFiles(sameDay);
    } finally {
      setLoadingFiles(false);
    }
  };

  const handleDownload = async (file: MeetingAttachment) => {
    setDownloadingPath(file.path);
    try {
      await downloadMeetingFile(file);
    } catch (err) {
      alert(err instanceof Error ? err.message : '파일을 내려받지 못했습니다.');
    } finally {
      setDownloadingPath(null);
    }
  };

  /** 연결된 회의: 그룹명 우선, 없으면 기존 회의 제목 */
  const linkedMeetingLabel = (doc: MeetingDoc) => {
    const group = doc.group_name?.trim();
    if (group) return group;
    return doc.title?.trim() || `${formatDocDate(doc.date)} 회의`;
  };

  const meetingName = openDoc
    ? [
        openDoc.group_name?.trim(),
        openDoc.title?.trim() || `${formatDocDate(openDoc.date)} 회의`,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <AppShell activePage="document">
      <div className="page">
        <div className="page-header">
          <h1>문서</h1>
          <button type="button" className="primary-button" onClick={handleCreate}>
            <Icon name="plus" />
            새 문서 작성
          </button>
        </div>

        {loading ? (
          <div>불러오는 중...</div>
        ) : (
          <div className="list-card">
            <div className="list-row list-head doc-row">
              <span>문서 제목</span>
              <span>연결된 회의</span>
              <span>마지막 수정</span>
              <span />
            </div>

            {docs.length === 0 ? (
              <div className="list-row">
                아직 문서가 없어요. 회의방에서 파일을 올리거나 녹화를 저장하면 이 목록에 나타납니다.
              </div>
            ) : (
              docs.map((doc) => {
                const fileCount = normalizeAttachments(doc.attachments).length;
                return (
                  <div className="list-row doc-row" key={doc.id}>
                    <span>
                      {documentTitle(doc.title, doc.date)}
                      {fileCount > 0 ? (
                        <span style={{ marginLeft: 8, color: '#888', fontSize: 12 }}>
                          첨부 {fileCount}
                        </span>
                      ) : null}
                    </span>
                    <span>{linkedMeetingLabel(doc)}</span>
                    <span>{formatDocDate(doc.date)}</span>
                    <button type="button" className="text-button" onClick={() => { void handleOpen(doc); }}>
                      열기
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {openDoc ? (
        <div
          className="doc-attach-backdrop"
          role="presentation"
          onClick={() => setOpenDoc(null)}
        >
          <div
            className="doc-attach-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="doc-attach-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="doc-attach-header">
              <div>
                <h2 id="doc-attach-title">첨부 파일</h2>
                <p className="doc-attach-subtitle">{meetingName}</p>
              </div>
              <button
                type="button"
                className="doc-attach-close"
                aria-label="닫기"
                onClick={() => setOpenDoc(null)}
              >
                ×
              </button>
            </div>

            {loadingFiles ? (
              <p className="doc-attach-empty">첨부 목록 불러오는 중...</p>
            ) : openFiles.length === 0 ? (
              <p className="doc-attach-empty">
                이 회의에 저장된 첨부 파일이 없습니다.
                <br />
                회의방에서 파일을 올린 뒤 잠시 기다렸다가 나가면 여기에 나타납니다.
              </p>
            ) : (
              <ul className="doc-attach-list">
                {openFiles.map((file) => (
                  <li key={file.id || file.path} className="doc-attach-item">
                    <div className="doc-attach-meta">
                      <span className="doc-attach-name" title={displayFileName(file.name)}>
                        {displayFileName(file.name)}
                      </span>
                      <span className="doc-attach-size">{formatChatFileSize(file.size)}</span>
                    </div>
                    <button
                      type="button"
                      className="doc-attach-download"
                      disabled={downloadingPath === file.path}
                      onClick={() => { void handleDownload(file); }}
                    >
                      {downloadingPath === file.path ? '받는 중…' : '다운로드'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
