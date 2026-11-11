import { useEffect, useMemo, useState, useRef } from 'react';
import { createScaledPortal } from '../components/AppScaleLayer';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import FileTypeIcon from '../components/FileTypeIcon';
import moreVerticalIcon from '../assets/action-icons/more-vertical.svg';
import bookmarkIcon from '../assets/action-icons/bookmark.svg';
import bookmarkFillIcon from '../assets/action-icons/bookmark-fill.svg';
import checkIcon from '../assets/action-icons/check.svg';
import closeIcon from '../assets/action-icons/close.svg';
import saveFloppyIcon from '../assets/action-icons/save-floppy-disk.svg';
import trashIcon from '../assets/action-icons/trash.svg';
import styles from './DocumentList.module.css';
import {
  deleteMeetingFile,
  displayFileName,
  downloadMeetingFile,
  formatChatFileSize,
  isStoredChatFileName,
  preferDisplayName,
  renameMeetingFile,
  uploadMeetingAttachment,
  type MeetingSharedFile,
} from '../utils/meetingChat';
import {
  fetchGroupMeetingDocs,
  fetchMeetingDocAttachments,
  fetchGroupChatFiles,
  isSameLocalDay,
  saveMeetingDocToServer,
  syncMeetingAttachmentsDoc,
} from '../utils/meetingDocs';
import { isListedMeeting } from '../utils/meetingVideo';

/** 별표는 DB 칸이 없어서 이 브라우저에만 저장합니다. 다시 열어도 그 문서가 위에 남습니다. */
const DOC_BOOKMARKS_KEY = 'grop.favoriteDocuments';

function loadDocBookmarks(): Set<string> {
  try {
    const raw = localStorage.getItem(DOC_BOOKMARKS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

type MeetingAttachment = Pick<MeetingSharedFile, 'id' | 'name' | 'path' | 'size' | 'mime' | 'ts' | 'uploadedBy'>;

/** 파일 탐색기에서 고른 뒤, 회의를 고르고 체크하기 전까지 화면에만 있는 파일 */
type PendingUpload = {
  id: string;
  file: File;
  date: string;
};

/** "연결할 회의를 선택하세요" 드롭다운에 쓰는 내 그룹 목록 */
type GroupOption = { id: string; name: string };

type MeetingDoc = {
  id: string;
  title: string | null;
  date: string;
  summary: string | null;
  group_id: string;
  /** 회의가 열린 그룹 이름 — 「연결된 회의」열에 표시 */
  group_name?: string | null;
  attachments?: MeetingAttachment[] | null;
  /** meetings.created_by — 이 문서(회의록 행)를 만든 사람. 「내가 올린 문서」 탭의 기준입니다 */
  created_by?: string | null;
  /** 같은 날 회의를 한 줄로 합칠 때 합쳐진 행들의 created_by 모음(내가 만든 행이 하나라도 있으면 "내 문서") */
  creator_ids?: string[];
  /** 전체 문서에서 파일 한 개로 나눈 행. sourceId가 실제 회의 행 id입니다. */
  sourceId?: string;
  fileRow?: boolean;
};

/** 묶인 첨부를 파일마다 한 줄로 나눕니다. 전체 문서에서 파일을 따로 고치기 위해 씁니다. */
function splitIntoFileRows(doc: MeetingDoc): MeetingDoc[] {
  const files = normalizeAttachments(doc.attachments);
  if (files.length === 0) return [];
  return files.map((file) => ({
    ...doc,
    id: `${doc.id}::${file.path}`,
    sourceId: doc.id,
    fileRow: true,
    title: displayFileName(file.name),
    attachments: [file],
    date: file.ts ? new Date(file.ts).toISOString() : doc.date,
  }));
}

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

/**
 * 저장용 이름만 있는 항목은, 서버가 찾아 준 원래 이름으로 바꿉니다.
 * 디스크 폴백이 회의 문서보다 먼저 잡혀도 화면에는 올린 파일명이 남게 합니다.
 */
function withResolvedFileNames(
  files: MeetingAttachment[],
  resolved: MeetingAttachment[],
): MeetingAttachment[] {
  const byPath = new Map(resolved.map((file) => [file.path, file]));
  return files.map((file) => {
    const known = byPath.get(file.path);
    const better = known?.name;
    const named = better && isStoredChatFileName(file.name) && !isStoredChatFileName(better)
      ? { ...file, name: better }
      : file;
    if (!named.uploadedBy && known?.uploadedBy) return { ...named, uploadedBy: known.uploadedBy };
    return named;
  });
}

/** DB jsonb 첨부를 안전하게 배열로 맞춥니다. 문자열로 저장된 JSON도 읽습니다. */
function normalizeAttachments(raw: unknown): MeetingAttachment[] {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .filter((item) => typeof item.path === 'string' && typeof item.name === 'string')
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id : crypto.randomUUID(),
      name: String(item.name),
      path: String(item.path),
      size: typeof item.size === 'number' ? item.size : 0,
      mime: typeof item.mime === 'string' ? item.mime : 'application/octet-stream',
      ts: typeof item.ts === 'number' ? item.ts : 0,
      ...(typeof item.uploadedBy === 'string' && item.uploadedBy ? { uploadedBy: item.uploadedBy } : {}),
    }));
}

/** 경로가 같은 파일은 한 번만 남기고, DB·서버·디스크 첨부를 합칩니다. */
function unionAttachments(...lists: unknown[]): MeetingAttachment[] {
  const byPath = new Map<string, MeetingAttachment>();
  for (const list of lists) {
    for (const file of normalizeAttachments(list)) {
      if (!file.path) continue;
      const prev = byPath.get(file.path);
      if (!prev) {
        byPath.set(file.path, file);
        continue;
      }
      // 디스크 목록의 저장용 이름이 회의 기록에 있는 원래 이름을 덮어쓰지 않게 합니다.
      byPath.set(file.path, {
        ...file,
        name: preferDisplayName(prev.name, file.name),
        ...(file.uploadedBy || prev.uploadedBy ? { uploadedBy: file.uploadedBy || prev.uploadedBy } : {}),
      });
    }
  }
  return [...byPath.values()];
}

/**
 * 문서명 아래에 보여줄 "형식 · 크기" 문구.
 * 형식은 첫 파일의 확장자(대문자), 크기는 전체 합계이고, 파일이 여럿이면 "PDF 외 2개 · 3.4MB"로 줄여 씁니다.
 * 첨부가 없는 문서(회의록만 있는 경우)는 null을 돌려 그 줄을 숨깁니다.
 */
/** 정렬에 쓰는 업로드 시각. 파일에 찍힌 시각이 있으면 그 시각, 없으면 회의 날짜를 씁니다. */
function uploadTime(doc: MeetingDoc) {
  const files = normalizeAttachments(doc.attachments);
  const latestFile = files.reduce((max, file) => Math.max(max, file.ts || 0), 0);
  const meeting = new Date(doc.date).getTime();
  return Math.max(latestFile, Number.isNaN(meeting) ? 0 : meeting);
}

function fileSummary(files: MeetingAttachment[]): string | null {
  if (files.length === 0) return null;
  const dot = files[0].name.lastIndexOf('.');
  const ext = dot > 0 && dot < files[0].name.length - 1 ? files[0].name.slice(dot + 1).toUpperCase() : '파일';
  const total = files.reduce((sum, f) => sum + (f.size || 0), 0);
  const kind = files.length > 1 ? `${ext} 외 ${files.length - 1}개` : ext;
  return `${kind} · ${formatChatFileSize(total)}`;
}

/**
 * 같은 회의방(그룹)의 문서는 한 줄로 합칩니다.
 * 그 방에서 올린 파일은 한 첨부 목록에 여러 개로 모입니다.
 */
function mergeSameDayMeetings(docs: MeetingDoc[]): MeetingDoc[] {
  const buckets = new Map<string, MeetingDoc>();
  for (const doc of docs) {
    const prev = buckets.get(doc.group_id);
    if (!prev) {
      buckets.set(doc.group_id, {
        ...doc,
        attachments: normalizeAttachments(doc.attachments),
        creator_ids: doc.created_by ? [doc.created_by] : [],
      });
      continue;
    }
    const filesByPath = new Map<string, MeetingAttachment>();
    // 먼저 넣은 회의의 이름을 남깁니다. 그쪽이 저장용 이름뿐이면 다른 회의의 파일명을 씁니다.
    for (const file of unionAttachments(prev.attachments, doc.attachments)) filesByPath.set(file.path, file);
    const newer = new Date(doc.date).getTime() > new Date(prev.date).getTime() ? doc : prev;
    buckets.set(doc.group_id, {
      ...newer,
      group_name: newer.group_name || prev.group_name,
      summary: newer.summary || prev.summary,
      attachments: [...filesByPath.values()],
      // 합쳐지는 어느 쪽이든 내가 만든 행이면 "내 문서"로 남도록 만든 사람을 모읍니다
      creator_ids: [...new Set([...(prev.creator_ids ?? []), ...(doc.created_by ? [doc.created_by] : [])])],
    });
  }
  return [...buckets.values()].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
}

/**
 * 문서 탭
 * 내가 속한 그룹에서 파일을 올린 회의만 문서 목록으로 보여 줍니다.
 * 회의가 끝난 뒤에도, 그때 올린 파일이 있으면 이 탭에 남습니다.
 * 열기 → 그 회의에 첨부된 파일 목록 + 개별 다운로드.
 */
export default function DocumentList() {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<MeetingDoc[]>([]);
  const [loading, setLoading] = useState(true);
  /** 열기로 고른 문서 — 첨부 목록 모달 */
  const [openDoc, setOpenDoc] = useState<MeetingDoc | null>(null);
  const [openFiles, setOpenFiles] = useState<MeetingAttachment[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  /** 첨부 모달에서 이름을 고치는 중인 파일 경로와 입력값 */
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [savingRename, setSavingRename] = useState(false);
  /**
   * 상단 탭. 「내가 올린 문서」는 파일의 올린 사람(uploadedBy)이 나인 것만 보여 줍니다.
   */
  const [activeTab, setActiveTab] = useState<'all' | 'mine' | 'group'>('all');
  /** 「그룹별 문서」 탭에서 접어 둔 그룹 id. 기본은 펼쳐서 그 그룹 문서를 묶음으로 보여 줍니다. */
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(new Set());
  /** 「내가 올린 문서」에서 펼쳐 둔 문서 id */
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());
  /** 로그인한 사용자 id — 「내가 올린 문서」 필터와 「올린 사람」 열의 "나" 표시에 씁니다 */
  const [myUserId, setMyUserId] = useState<string | null>(null);
  /** 만든 사람 id → 닉네임(profiles.nickname). 「올린 사람」 열에 내가 아닌 사람의 이름을 보여줄 때 씁니다 */
  const [nameById, setNameById] = useState<Record<string, string>>({});
  /** 문서명 또는 연결된 회의명으로 목록을 좁혀주는 검색어 */
  const [query, setQuery] = useState('');
  /** "연결할 회의를 선택하세요" 드롭다운 옵션 — 내가 속한 그룹 목록 */
  const [groups, setGroups] = useState<GroupOption[]>([]);
  /**
   * 연결 확정은 화면에서만 쓰는 상태라 새로고침하면 초기화됩니다.
   * 별표는 localStorage에 남기고, 목록에서는 그 문서를 맨 앞에 둡니다.
   */
  /** 별표한 문서 id */
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(loadDocBookmarks);
  /** 지금 "더보기(⋮)" 메뉴가 열려 있는 문서 id */
  const [openMenuDocId, setOpenMenuDocId] = useState<string | null>(null);
  // ⋮ 메뉴를 위로 펼칠지 — 목록 영역(스크롤 박스)이 메뉴를 잘라내서, 아래 공간이 모자라면 위로 엽니다.
  const [menuUp, setMenuUp] = useState(false);
  const docBodyRef = useRef<HTMLDivElement>(null);
  /** 문서명 수정 중인 문서 id와 입력값 — 한 번에 한 문서만 수정합니다 */
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  /** 저장 요청 중이면 중복 저장(Enter 후 blur 등)을 막습니다 */
  const [savingTitle, setSavingTitle] = useState(false);
  /** "저장 대기" 행에서 드롭다운으로 고른(아직 저장 안 한) 그룹 id */
  const [pendingLinkDraft, setPendingLinkDraft] = useState<Record<string, string>>({});
  /** 체크(저장)로 확정한 연결 — 문서 id → 그룹 이름 */
  const [linkOverrides, setLinkOverrides] = useState<Record<string, string>>({});
  /** 업로드가 끝나면 목록을 다시 읽습니다. */
  const [listVersion, setListVersion] = useState(0);
  /**
   * 파일 탐색기에서 골랐지만 아직 회의에 넣지 않은 파일.
   * 체크를 눌러야 선택한 회의로 올라갑니다.
   */
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  /** 체크를 눌러 서버에 올리는 중인 대기 행 id */
  const [savingPendingId, setSavingPendingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      setMyUserId(sessionData.session.user.id);

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
      if (mounted) {
        setGroups([...groupNameById.entries()].map(([id, name]) => ({ id, name })));
      }

      // attachments·created_by 컬럼이 있으면 함께 읽고, 없으면 기본 컬럼만 다시 조회합니다.
      let meetings: MeetingDoc[] = [];
      const withAttach = await supabase
        .from('meetings')
        .select('id, title, date, summary, group_id, attachments, created_by')
        .in('group_id', ids)
        .order('date', { ascending: false });

      if (withAttach.error && /attachments|created_by/i.test(withAttach.error.message)) {
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
              // 서버 목록만 쓰면, 끝난 회의에 DB로 남아 있는 업로드 파일이 문서 탭에서 빠집니다.
              const merged = unionAttachments(prev.attachments, sd.files);
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

      // 올린 사람이 비어 있는 예전 파일은, 그 회의를 만든 사람의 파일로 둡니다.
      // 같은 날 디스크 파일을 합치기 전에 찍어야 다른 사람 파일이 내 것으로 바뀌지 않습니다.
      for (const [id, doc] of byId) {
        if (!doc.created_by) continue;
        byId.set(id, {
          ...doc,
          attachments: normalizeAttachments(doc.attachments).map((file) => (
            file.uploadedBy ? file : { ...file, uploadedBy: doc.created_by }
          )),
        });
      }

      // 첨부가 없으면 같은 날 파일을 채우고, 있으면 저장용 이름을 원래 이름으로 바꿉니다.
      await Promise.all(
        ids.map(async (gid) => {
          const diskFiles = await fetchGroupChatFiles(gid);
          if (diskFiles.length === 0) return;
          for (const [id, doc] of byId) {
            if (doc.group_id !== gid) continue;
            // 회의가 끝난 뒤에도, 그 날 올린 파일은 문서 탭 행에 붙입니다.
            const sameDay = diskFiles.filter((f) => f.ts && isSameLocalDay(f.ts, doc.date));
            const current = normalizeAttachments(doc.attachments);
            if (sameDay.length === 0 && current.length === 0) continue;
            // 회의 기록의 이름을 먼저 둡니다. 디스크의 저장용 이름은 기록이 없을 때만 채웁니다.
            const mergedFiles = sameDay.length > 0 ? unionAttachments(current, sameDay) : current;
            byId.set(id, { ...doc, attachments: withResolvedFileNames(mergedFiles, diskFiles) });
          }
        }),
      );

      // 올린 파일이 있는 회의만 문서 탭에 둡니다. 끝난 회의도 파일이 있으면 여기 포함됩니다.
      const merged = mergeSameDayMeetings([...byId.values()])
        .filter((doc) => isListedMeeting(doc))
        .filter((doc) => normalizeAttachments(doc.attachments).length > 0);

      // 「올린 사람」 열에 쓸 닉네임을 한 번에 조회합니다(문서마다 따로 부르지 않도록 id를 모아서).
      // profiles를 못 읽거나 닉네임이 없으면 이름 없이 "—"로 남습니다.
      const creatorIds = [
        ...new Set(merged.map((d) => d.created_by).filter((v): v is string => !!v)),
      ];
      if (creatorIds.length > 0) {
        const { data: profileRows } = await supabase
          .from('profiles')
          .select('id, nickname')
          .in('id', creatorIds);
        const names: Record<string, string> = {};
        for (const row of profileRows ?? []) {
          if (row?.id && typeof row.nickname === 'string' && row.nickname.trim()) {
            names[row.id] = row.nickname.trim();
          }
        }
        if (mounted) setNameById(names);
      }

      if (!mounted) return;
      setDocs(merged);
      setLoading(false);
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [navigate, listVersion]);

  const handleCreate = () => {
    if (groups.length === 0) {
      alert('먼저 그룹을 만든 뒤 문서를 올릴 수 있어요.');
      return;
    }
    const input = fileInputRef.current;
    if (!input) return;
    input.value = '';
    input.click();
  };

  /** 고른 파일은 아직 올리지 않고, 저장 대기 행으로만 목록 위에 둡니다. */
  const handleUploadFiles = (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (files.length === 0) return;
    const date = new Date().toISOString();
    setPendingUploads((prev) => [
      ...files.map((file) => ({ id: crypto.randomUUID(), file, date })),
      ...prev,
    ]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleOpen = async (doc: MeetingDoc) => {
    setOpenDoc(doc);
    setOpenFiles(normalizeAttachments(doc.attachments));
    setLoadingFiles(true);
    try {
      // 디스크에만 남은 파일은 저장용 이름이라, 서버가 원래 이름을 찾으면 그걸로 바꿉니다.
      const groupFiles = await fetchGroupChatFiles(doc.group_id);
      const applyNames = (files: MeetingAttachment[]) => withResolvedFileNames(files, groupFiles);

      // 1) 서버 meeting-docs와 모아 둔 첨부를 함께 엽니다.
      const serverFiles = await fetchMeetingDocAttachments(doc.id, doc.group_id);
      const mergedFiles = unionAttachments(doc.attachments, serverFiles);
      if (mergedFiles.length > 0) {
        setOpenFiles(applyNames(mergedFiles));
        return;
      }

      // 첨부가 없으면, 같은 그룹·같은 날짜에 올라간 실제 파일로 엽니다.
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

  /** 같은 이름 저장이 겹치지 않게 합니다. Enter와 포커스 아웃이 같이 들어와도 한 번만 저장합니다. */
  const renameLock = useRef(false);
  /** Esc로 닫을 때 따라오는 blur가 방금 친 이름을 저장하지 않게 합니다. */
  const skipRenameBlur = useRef(false);

  /** 첨부 이름을 바꿉니다. 파일 서버에 원본이 없어도 목록에 보이는 이름은 저장합니다. */
  const commitRename = async (file: MeetingAttachment, nextName?: string) => {
    if (renameLock.current) return;
    const next = (nextName ?? renameDraft).trim();
    const current = displayFileName(file.name);
    if (!next || next === current) {
      setRenamingPath(null);
      setEditingDocId(null);
      return;
    }
    renameLock.current = true;
    setSavingRename(true);
    // 서버가 확장자를 붙여 주던 것과 같이, 서버 요청이 실패해도 확장자는 남깁니다.
    const storedExt = (file.path.split('/').pop() || '').match(/\.[a-z0-9]{1,8}$/i)?.[0] || '';
    let saved = storedExt && !next.toLowerCase().endsWith(storedExt.toLowerCase()) ? `${next}${storedExt}` : next;
    try {
      saved = await renameMeetingFile(file.path, next);
    } catch (err) {
      // 디스크에 파일이 없어도 문서 목록의 이름은 바꿉니다.
      console.warn('파일 서버 이름 변경 실패, 목록 이름만 저장합니다:', err);
    }
    try {
      const renameFile = (item: MeetingAttachment) => (item.path === file.path ? { ...item, name: saved } : item);
      setOpenFiles((prev) => prev.map(renameFile));
      const renamedDocs = docs.map((doc) => {
        const files = normalizeAttachments(doc.attachments);
        if (!files.some((item) => item.path === file.path)) return doc;
        return {
          ...doc,
          attachments: files.map((item) => (item.path === file.path ? { ...item, name: saved } : item)),
        };
      });
      setDocs(renamedDocs);
      // 같은 파일이 여러 회의 행에 있으면 전부 바꿉니다. 한 곳만 바꾸면 다음 조회에서 예전 이름이 다시 나옵니다.
      const groupId = file.path.split('/').filter(Boolean)[0];
      if (groupId) {
        const { data: rows, error: readError } = await supabase
          .from('meetings')
          .select('id, attachments')
          .eq('group_id', groupId);
        if (readError && !/attachments/i.test(readError.message)) {
          console.warn('첨부 이름 DB 조회 실패:', readError.message);
        }
        await Promise.all((rows ?? []).map(async (row) => {
          const files = normalizeAttachments(row.attachments);
          if (!files.some((item) => item.path === file.path)) return;
          const nextFiles = files.map((item) => (item.path === file.path ? { ...item, name: saved } : item));
          const { error } = await supabase.from('meetings').update({ attachments: nextFiles }).eq('id', row.id);
          if (error && !/attachments/i.test(error.message)) {
            console.warn('첨부 이름 DB 반영 실패:', error.message);
          }
        }));
      }
      await Promise.all(renamedDocs.map(async (doc) => {
        const files = normalizeAttachments(doc.attachments);
        if (!files.some((item) => item.path === file.path)) return;
        const meetingId = doc.sourceId || doc.id.split('::')[0];
        if (!meetingId || !doc.group_id) return;
        await saveMeetingDocToServer({
          meetingId,
          groupId: doc.group_id,
          title: doc.title || '',
          date: doc.date,
          files,
        });
      }));
      setRenamingPath(null);
      setEditingDocId(null);
    } finally {
      renameLock.current = false;
      setSavingRename(false);
    }
  };

  /** 파일 한 개를 디스크와 문서 목록에서 지웁니다. 같은 경로가 들어 있는 회의 행도 함께 갱신합니다. */
  const deleteAttachment = async (file: MeetingAttachment) => {
    const label = displayFileName(file.name);
    if (!confirm(`"${label}" 파일을 삭제할까요?`)) return;
    setOpenMenuDocId(null);
    try {
      await deleteMeetingFile(file.path);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      // 배포 화면은 파일 서버가 없어 404가 납니다. 그때는 회의 기록의 첨부만 지워 목록에서 뺍니다.
      if (!/\b404\b/.test(message)) {
        alert(message || '파일을 지우지 못했습니다.');
        return;
      }
    }
    const strip = (files: MeetingAttachment[]) => files.filter((item) => item.path !== file.path);
    const targets = docs.filter((doc) => normalizeAttachments(doc.attachments).some((item) => item.path === file.path));
    setDocs((prev) => prev
      .map((doc) => {
        const files = normalizeAttachments(doc.attachments);
        if (!files.some((item) => item.path === file.path)) return doc;
        return { ...doc, attachments: strip(files) };
      })
      .filter((doc) => normalizeAttachments(doc.attachments).length > 0));
    await Promise.all(targets.map(async (doc) => {
      const files = strip(normalizeAttachments(doc.attachments));
      const { error } = await supabase.from('meetings').update({ attachments: files }).eq('id', doc.id);
      if (error && !/attachments/i.test(error.message)) {
        console.warn('첨부 삭제 DB 반영 실패:', error.message);
      }
      await saveMeetingDocToServer({
        meetingId: doc.id,
        groupId: doc.group_id,
        title: doc.title || '',
        date: doc.date,
        files,
      });
    }));
  };

  /** 연결된 회의: 화면에서 확정한 값 → 그룹명 → 기존 회의 제목 순으로 표시 */
  const linkedMeetingLabel = (doc: MeetingDoc) => {
    const override = linkOverrides[doc.id];
    if (override) return override;
    const group = doc.group_name?.trim();
    if (group) return group;
    return doc.title?.trim() || `${formatDocDate(doc.date)} 회의`;
  };

  /** 저장 대기: 방금 고른 파일이거나, 연결된 회의가 아직 없는 문서 */
  const isPendingLink = (doc: MeetingDoc) =>
    pendingUploads.some((item) => item.id === doc.id) || (!linkOverrides[doc.id] && !doc.group_name?.trim());

  /** 체크 — 드롭다운에서 고른 회의에 파일을 올리고 목록을 다시 읽습니다. */
  const confirmPendingLink = async (doc: MeetingDoc) => {
    const groupId = pendingLinkDraft[doc.id];
    const pending = pendingUploads.find((item) => item.id === doc.id);
    if (!groupId || savingPendingId) return;
    // 파일 없이 회의만 비어 있는 예전 행은 화면에서만 이름을 붙입니다.
    if (!pending) {
      const group = groups.find((item) => item.id === groupId);
      if (!group) return;
      setLinkOverrides((prev) => ({ ...prev, [doc.id]: group.name }));
      setPendingLinkDraft((prev) => {
        const next = { ...prev };
        delete next[doc.id];
        return next;
      });
      return;
    }

    setSavingPendingId(doc.id);
    try {
      const meta = await uploadMeetingAttachment(pending.file, groupId, myUserId);
      const result = await syncMeetingAttachmentsDoc({
        meetingId: null,
        groupId,
        userId: myUserId,
        files: [{
          id: crypto.randomUUID(),
          name: meta.name,
          path: meta.path,
          size: meta.size,
          mime: meta.mime,
          ts: Date.now(),
          uploadedBy: myUserId,
        }],
      });
      if (result.error) {
        alert(result.error);
        return;
      }
      setPendingUploads((prev) => prev.filter((item) => item.id !== doc.id));
      setPendingLinkDraft((prev) => {
        const next = { ...prev };
        delete next[doc.id];
        return next;
      });
      setListVersion((version) => version + 1);
    } catch (err) {
      alert(err instanceof Error ? err.message : '문서를 올리지 못했습니다.');
    } finally {
      setSavingPendingId(null);
    }
  };

  /** 닫기(×) — 아직 올리지 않은 대기 파일을 목록에서 뺍니다. */
  const cancelPendingLink = (docId: string) => {
    setPendingUploads((prev) => prev.filter((item) => item.id !== docId));
    setPendingLinkDraft((prev) => {
      const next = { ...prev };
      delete next[docId];
      return next;
    });
  };

  /** 별표 — 켜면 그 문서를 목록 앞으로, 끄면 날짜 순 자리로 되돌립니다. */
  const toggleBookmark = (docId: string) => {
    setBookmarkedIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      try {
        localStorage.setItem(DOC_BOOKMARKS_KEY, JSON.stringify([...next]));
      } catch {
        // 저장이 막혀도 이번 화면의 순서는 바뀝니다
      }
      return next;
    });
  };

  /**
   * 문서 주인 = 이 문서(회의록 행)를 만든 사람(meetings.created_by).
   * 서버 파일만으로 만들어진 문서처럼 created_by가 없으면 주인을 알 수 없어서 수정할 수 없습니다.
   * (DB의 update 정책은 그룹 멤버면 누구나 허용이라, 주인 제한은 화면에서만 겁니다.)
   */
  const isDocOwner = (doc: MeetingDoc) => !!myUserId && doc.created_by === myUserId;

  /** ⋮ 메뉴의 "수정" — 문서명을 입력창으로 바꿉니다(회의 제목을 고칩니다) */
  const startEditTitle = (doc: MeetingDoc) => {
    setOpenMenuDocId(null);
    setEditTitle(doc.title?.trim() || '');
    setEditingDocId(doc.id);
  };

  /** Enter/포커스 아웃 — 바뀐 제목을 meetings.title에 저장하고 목록에도 바로 반영 */
  const commitEditTitle = async (doc: MeetingDoc) => {
    if (savingTitle) return;
    const next = editTitle.trim();
    // 비었거나 그대로면 저장하지 않고 닫습니다
    if (!next || next === (doc.title?.trim() || '')) {
      setEditingDocId(null);
      return;
    }
    setSavingTitle(true);
    const { error } = await supabase.from('meetings').update({ title: next }).eq('id', doc.id);
    setSavingTitle(false);
    if (error) {
      alert(`문서명을 바꾸지 못했습니다: ${error.message}`);
      return;
    }
    setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, title: next } : d)));
    setEditingDocId(null);
  };

  const meetingName = openDoc
    ? openDoc.group_name?.trim() || `${formatDocDate(openDoc.date)} 회의`
    : '';

  /** 검색창 입력값으로 문서명/연결된 회의명을 좁힙니다. */
  const filteredDocs = useMemo(() => {
    const q = query.trim().toLowerCase();
    // 「내가 올린 문서」는 내가 올린 파일만 남깁니다. 다른 사람 파일은 같은 그룹이어도 빼니다.
    const base =
      activeTab === 'mine'
        ? docs
            .map((doc) => ({
              ...doc,
              attachments: normalizeAttachments(doc.attachments).filter((file) => file.uploadedBy === myUserId),
            }))
            .filter((doc) => normalizeAttachments(doc.attachments).length > 0)
        : docs;
    const matched = !q
      ? base
      : base.filter((doc) => {
          const title = (doc.group_name?.trim() || documentTitle(null, doc.date)).toLowerCase();
          const linked = linkedMeetingLabel(doc).toLowerCase();
          return title.includes(q) || linked.includes(q);
        });
    // 전체 문서는 업로드가 최근인 것부터. 다른 탭은 별표한 문서를 맨 위에 둡니다.
    return [...matched].sort((a, b) => {
      if (activeTab === 'all') return uploadTime(b) - uploadTime(a);
      return Number(bookmarkedIds.has(b.id)) - Number(bookmarkedIds.has(a.id));
    });
  }, [docs, query, linkedMeetingLabel, activeTab, myUserId, bookmarkedIds]);

  /**
   * 「그룹별 문서」 탭용 — 내가 속한 그룹마다 (검색어에 걸린) 문서를 모읍니다.
   * 문서가 최근에 올라온 그룹이 위로, 문서 없는 그룹은 맨 아래로 보냅니다.
   * 검색 중에는 걸리는 문서가 없는 그룹은 숨기고, 평소엔 빈 그룹도 "문서 없음"으로 보여줍니다.
   */
  const groupSections = useMemo(() => {
    const q = query.trim();
    return groups
      .map((group) => {
        const groupDocs = filteredDocs.filter((doc) => doc.group_id === group.id);
        // 별표한 문서가 앞에 올 수 있어서 첫 문서가 아니라 가장 최근 날짜를 따로 찾습니다
        const latest = groupDocs.reduce<string | null>(
          (acc, doc) => (!acc || new Date(doc.date).getTime() > new Date(acc).getTime() ? doc.date : acc),
          null,
        );
        return { group, docs: groupDocs, latest };
      })
      .filter((section) => !q || section.docs.length > 0)
      .sort((a, b) => {
        if (!a.latest || !b.latest) return a.latest ? -1 : b.latest ? 1 : a.group.name.localeCompare(b.group.name);
        return new Date(b.latest).getTime() - new Date(a.latest).getTime();
      });
  }, [groups, filteredDocs, query]);

  /** 파일 탐색기에서 고른 파일을 저장 대기 행으로 바꿉니다. 확장자는 아래 형식 줄에만 둡니다. */
  const pendingDocs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pendingUploads
      .map((item): MeetingDoc => {
        const dot = item.file.name.lastIndexOf('.');
        const title = dot > 0 ? item.file.name.slice(0, dot) : item.file.name;
        return {
          id: item.id,
          title,
          date: item.date,
          summary: null,
          group_id: '',
          group_name: null,
          created_by: myUserId,
          creator_ids: myUserId ? [myUserId] : [],
          attachments: [{
            id: item.id,
            name: item.file.name,
            path: item.id,
            size: item.file.size,
            mime: item.file.type || 'application/octet-stream',
            ts: new Date(item.date).getTime(),
          }],
        };
      })
      .filter((doc) => !q || (doc.title || '').toLowerCase().includes(q));
  }, [pendingUploads, query, myUserId]);

  /** 전체 문서는 묶인 파일을 한 줄씩 나눠, 파일마다 수정·삭제가 되게 합니다. */
  const allFileDocs = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = docs.flatMap(splitIntoFileRows);
    const matched = !q
      ? rows
      : rows.filter((doc) => {
          const name = (doc.title || '').toLowerCase();
          const linked = (doc.group_name || '').toLowerCase();
          return name.includes(q) || linked.includes(q);
        });
    return matched.sort((a, b) => uploadTime(b) - uploadTime(a));
  }, [docs, query]);

  /** 저장 대기 행을 저장된 문서보다 위에 둡니다. 전체 문서는 파일 한 줄씩입니다. */
  const visibleDocs = useMemo(
    () => [...pendingDocs, ...(activeTab === 'all' ? allFileDocs : filteredDocs)],
    [pendingDocs, filteredDocs, allFileDocs, activeTab],
  );

  /** 하단 "문서 N개 · 저장 대기 M개" 요약에 쓰는 저장 대기 문서 수 */
  const pendingCount = pendingDocs.length + filteredDocs.filter((doc) => isPendingLink(doc)).length;

  /** 문서 한 행. expand가 있으면 제목은 팝업을 열지 않고, 오른쪽 화살표로 파일을 아래에 펼칩니다. */
  const renderDocRow = (doc: MeetingDoc, expand?: { expanded: boolean; onToggle: () => void }) => {
          const attachments = normalizeAttachments(doc.attachments);
          const pending = isPendingLink(doc);
          const bookmarked = bookmarkedIds.has(doc.id);
          const menuOpen = openMenuDocId === doc.id;
          // 대표 아이콘은 첫 첨부 파일의 확장자를 따라갑니다. 첨부가 없으면 기본 문서 아이콘.
          return (
            <div className="list-row doc-row" key={doc.id}>
              {/* "열기" 버튼 대신 문서명 자체를 눌러서 열도록 합니다(피그마 디자인엔 별도 열기 버튼이 없음) */}
              {editingDocId === doc.id ? (
                // 수정 중: 파일 행은 그 파일 이름, 묶인 문서는 회의 제목을 고칩니다.
                <input
                  className={styles.titleInput}
                  value={editTitle}
                  autoFocus
                  disabled={savingTitle || savingRename}
                  placeholder="문서명"
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={(e) => {
                    const file = normalizeAttachments(doc.attachments)[0];
                    if (doc.fileRow && file) void commitRename(file, e.currentTarget.value);
                    else void commitEditTitle(doc);
                  }}
                  onKeyDown={(e) => {
                    // 한글 조합 중 Enter는 글자를 확정할 뿐이라, 그때는 저장하지 않습니다.
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const file = normalizeAttachments(doc.attachments)[0];
                      if (doc.fileRow && file) void commitRename(file, e.currentTarget.value);
                      else void commitEditTitle(doc);
                    }
                    if (e.key === 'Escape') setEditingDocId(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className={`${styles.titleCell}${expand ? ` ${styles.titleCellStatic}` : ''}`}
                  onClick={() => { if (!pending && !expand) void handleOpen(doc); }}
                >
                  <FileTypeIcon fileName={attachments[0]?.name} className={styles.fileIcon} />
                  <span className={styles.titleText}>
                    {/* 저장 대기는 올린 파일 이름, 저장된 문서는 그룹 이름을 보여 줍니다. */}
                    <span className={styles.titleName}>
                      {doc.fileRow
                        ? (doc.title?.trim() || displayFileName(attachments[0]?.name || '') || '문서')
                        : pending
                          ? (doc.title?.trim() || attachments[0]?.name || '문서')
                          : (doc.group_name?.trim() || `${formatDocDate(doc.date)} 회의`)}
                    </span>
                    {/* 문서명 아래 "형식 · 크기". 아직 회의에 넣기 전이면 저장 대기를 붙입니다. */}
                    {fileSummary(attachments) ? (
                      <span className={styles.fileMeta}>
                        {fileSummary(attachments)}
                        {pending ? <span className={styles.pendingMark}> | 저장 대기</span> : null}
                      </span>
                    ) : null}
                  </span>
                </button>
              )}

              {/* 연결된 회의 — 저장 대기 중이면 선택 드롭다운, 아니면 그냥 이름 */}
              {pending ? (
                <select
                  className={styles.linkSelect}
                  value={pendingLinkDraft[doc.id] ?? ''}
                  onChange={(e) =>
                    setPendingLinkDraft((prev) => ({ ...prev, [doc.id]: e.target.value }))
                  }
                >
                  <option value="" disabled>
                    연결할 회의를 선택하세요
                  </option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span>{linkedMeetingLabel(doc)}</span>
              )}

              {/* 업로드 날짜 열은 회의 날짜가 아니라, 파일이 올라온 시각을 보여 줍니다. */}
              <span>{formatDocDate(new Date(uploadTime(doc) || doc.date).toISOString())}</span>

              {/* 올린 사람 — 피그마 기준 저장 대기 행도 이 칸엔 업로더가 그대로 보입니다
                  (체크/닫기는 오른쪽 액션 칸으로). 내가 아니면 만든 사람(created_by)의 닉네임을, 모르면 "—"를 보여줍니다.
                  저장 대기 행은 방금 내가 올려서 연결을 고르는 중인 경우라 "나"로 둡니다. */}
              <span className={styles.uploaderCol}>
                {pending || activeTab === 'mine' || (!!myUserId && (doc.creator_ids ?? []).includes(myUserId))
                  ? '나'
                  : (doc.created_by && nameById[doc.created_by]) || '—'}
              </span>

              <span className={styles.rowActions}>
                {pending ? (
                  // 저장 대기 행: 북마크/더보기/열기 대신 연결 저장(체크)·취소(닫기)만 보여줍니다
                  <span className={styles.linkActions}>
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label="선택한 회의에 업로드"
                      disabled={!pendingLinkDraft[doc.id] || savingPendingId === doc.id}
                      onClick={() => { void confirmPendingLink(doc); }}
                    >
                      <img src={checkIcon} alt="" />
                    </button>
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label="연결 취소"
                      onClick={() => cancelPendingLink(doc.id)}
                    >
                      <img src={closeIcon} alt="" />
                    </button>
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label={bookmarked ? '즐겨찾기 해제' : '즐겨찾기'}
                      aria-pressed={bookmarked}
                      onClick={() => toggleBookmark(doc.id)}
                    >
                      {/* 시안과 같은 북마크: 꺼짐 = 윤곽선, 켜짐 = 채움 */}
                      <img src={bookmarked ? bookmarkFillIcon : bookmarkIcon} alt="" />
                    </button>

                    <span className={styles.moreMenuWrapper}>
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label="더보기"
                        aria-expanded={menuOpen}
                        onClick={(e) => {
                          if (!menuOpen) {
                            // 목록 아래 끝까지 남은 공간이 메뉴 높이(≈140px)보다 작으면 위로 엽니다
                            const btnBottom = e.currentTarget.getBoundingClientRect().bottom;
                            const bodyBottom = docBodyRef.current?.getBoundingClientRect().bottom ?? Infinity;
                            setMenuUp(bodyBottom - btnBottom < 140);
                          }
                          setOpenMenuDocId(menuOpen ? null : doc.id);
                        }}
                      >
                        <img src={moreVerticalIcon} alt="" />
                      </button>
                      {menuOpen ? (
                        <>
                          {/* 메뉴 바깥을 누르면 닫히도록 하는 투명 오버레이 */}
                          <div
                            className={styles.menuBackdrop}
                            role="presentation"
                            onClick={() => setOpenMenuDocId(null)}
                          />
                          <div className={`${styles.moreMenu}${menuUp ? ` ${styles.moreMenuUp}` : ''}`} role="menu">
                            <button
                              type="button"
                              className={styles.moreMenuItem}
                              role="menuitem"
                              disabled={!attachments[0] || downloadingPath === attachments[0].path}
                              onClick={() => {
                                setOpenMenuDocId(null);
                                if (attachments[0]) void handleDownload(attachments[0]);
                              }}
                            >
                              <img src={saveFloppyIcon} alt="" />
                              저장
                            </button>
                            {/* 파일 행은 그 파일 이름을, 묶인 문서는 주인이 회의 제목을 고칩니다. */}
                            {(doc.fileRow || isDocOwner(doc)) ? (
                              <button
                                type="button"
                                className={styles.moreMenuItem}
                                role="menuitem"
                                onClick={() => startEditTitle(doc)}
                              >
                                <Icon name="pencil" />
                                수정
                              </button>
                            ) : null}
                            {doc.fileRow && attachments[0] ? (
                              <button
                                type="button"
                                className={`${styles.moreMenuItem} ${styles.moreMenuItemDanger}`}
                                role="menuitem"
                                onClick={() => { void deleteAttachment(attachments[0]); }}
                              >
                                <img src={trashIcon} alt="" />
                                삭제
                              </button>
                            ) : null}
                          </div>
                        </>
                      ) : null}
                    </span>
                    {expand ? (
                      <button
                        type="button"
                        className={`${styles.groupToggle}${expand.expanded ? ` ${styles.groupToggleOpen}` : ''}`}
                        aria-label={expand.expanded ? '첨부 접기' : '첨부 펼치기'}
                        aria-expanded={expand.expanded}
                        onClick={expand.onToggle}
                      >
                        <Icon name="chevron-down" />
                      </button>
                    ) : null}
                  </>
                )}
              </span>
            </div>
          );
  };

  /** 펼친 첨부 — 그룹 행이든 내가 올린 문서 행이든 같은 줄 모양으로 위쪽부터 쌓습니다. */
  const renderInlineFiles = (listedFiles: MeetingAttachment[], loading: boolean, emptyText: string) => (
    <div className={styles.groupDocs}>
      {loading ? (
        <div className={styles.groupFileStatus}>첨부 목록 불러오는 중...</div>
      ) : listedFiles.length === 0 ? (
        <div className={styles.groupFileStatus}>{emptyText}</div>
      ) : listedFiles.map((file) => (
        <div className={`list-row doc-row ${styles.groupFileRow}`} key={file.path}>
          <div className={styles.titleCell}>
            <FileTypeIcon fileName={file.name} className={styles.fileIcon} />
            <span className={styles.titleText}>
              {renamingPath === file.path ? (
                <input
                  className={styles.renameInput}
                  value={renameDraft}
                  autoFocus
                  disabled={savingRename}
                  aria-label="첨부 파일 이름"
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={(e) => {
                    if (skipRenameBlur.current) {
                      skipRenameBlur.current = false;
                      return;
                    }
                    void commitRename(file, e.currentTarget.value);
                  }}
                  onKeyDown={(e) => {
                    // 한글 조합 중 Enter는 글자를 확정할 뿐이라, 그때는 저장하지 않습니다.
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void commitRename(file, e.currentTarget.value);
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      skipRenameBlur.current = true;
                      setRenamingPath(null);
                    }
                  }}
                />
              ) : (
                <span className={styles.titleName} title={displayFileName(file.name)}>
                  {displayFileName(file.name)}
                </span>
              )}
              <span className={styles.fileMeta}>{formatChatFileSize(file.size)}</span>
            </span>
          </div>
          <span />
          <span className={styles.rowActions}>
            <span className={styles.moreMenuWrapper}>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="더보기"
                aria-expanded={openMenuDocId === `file:${file.path}`}
                onClick={() => setOpenMenuDocId(openMenuDocId === `file:${file.path}` ? null : `file:${file.path}`)}
              >
                <img src={moreVerticalIcon} alt="" />
              </button>
              {openMenuDocId === `file:${file.path}` ? (
                <>
                  <div className={styles.menuBackdrop} role="presentation" onClick={() => setOpenMenuDocId(null)} />
                  <div className={styles.moreMenu} role="menu">
                    <button
                      type="button"
                      className={styles.moreMenuItem}
                      role="menuitem"
                      disabled={downloadingPath === file.path}
                      onClick={() => { setOpenMenuDocId(null); void handleDownload(file); }}
                    >
                      <img src={saveFloppyIcon} alt="" />
                      저장
                    </button>
                    <button
                      type="button"
                      className={styles.moreMenuItem}
                      role="menuitem"
                      onClick={() => {
                        setOpenMenuDocId(null);
                        setRenamingPath(file.path);
                        setRenameDraft(displayFileName(file.name));
                      }}
                    >
                      <Icon name="pencil" />
                      수정
                    </button>
                    <button
                      type="button"
                      className={`${styles.moreMenuItem} ${styles.moreMenuItemDanger}`}
                      role="menuitem"
                      onClick={() => { void deleteAttachment(file); }}
                    >
                      <img src={trashIcon} alt="" />
                      삭제
                    </button>
                  </div>
                </>
              ) : null}
            </span>
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <AppShell activePage="document">
      {/* 화면 전체가 아니라 목록 영역 안에서만 스크롤되도록 .docPage로 페이지 높이를 화면에 고정합니다
          (구글 드라이브처럼: 위 = 탭/검색 줄, 가운데 = 목록(스크롤), 아래 = "문서 N개" 줄) */}
      <div className={`page ${styles.docPage}`}>
        <div className={styles.docHeader}>
          <div className={styles.tabs}>
            <button
              type="button"
              className={`${styles.tab} ${activeTab === 'all' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('all')}
            >
              전체 문서
            </button>
            <button
              type="button"
              className={`${styles.tab} ${activeTab === 'group' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('group')}
            >
              그룹별 문서
            </button>
            <button
              type="button"
              className={`${styles.tab} ${activeTab === 'mine' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('mine')}
            >
              내가 올린 문서
            </button>
          </div>

          <div className={styles.toolbar}>
            <div className={styles.searchBox}>
              <Icon name="search" />
              <input
                className={styles.searchInput}
                type="text"
                placeholder="문서명 또는 회의명 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className={styles.toolbarDivider} />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => { void handleUploadFiles(e.target.files); }}
            />
            <button type="button" className={styles.uploadButton} onClick={handleCreate}>
              <Icon name="plus" />
              문서 업로드
            </button>
          </div>
        </div>

        {loading ? (
          <div>불러오는 중...</div>
        ) : (activeTab === 'group' ? groupSections.length === 0 && pendingDocs.length === 0 : visibleDocs.length === 0) ? (
          // MeetingList와 같은 패턴: 문서가 하나도 없을 땐 목록 카드(헤더 포함)를 아예 안 띄우고
          // 빈 상태 문구만 보여줍니다. (전엔 헤더 행이 .list-card 안에 항상 떠 있어서, 그 행이
          // ":last-child"가 되는 바람에 구분선도 사라지고 화면에 빈 테이블처럼 남아있었습니다.)
          <div className={styles.empty}>
            {activeTab === 'group'
              ? query.trim()
                ? '검색 결과가 없어요.'
                : '아직 속한 그룹이 없어요.'
              : docs.length === 0
                ? '아직 문서가 없어요. 문서 업로드로 파일을 올리면 이 목록에 나타납니다.'
              : activeTab === 'mine' && !query.trim()
                ? '내가 올린 문서가 없어요.'
                : '검색 결과가 없어요.'}
          </div>
        ) : (
          // 피그마 디자인엔 MemberList류가 쓰는 흰 카드 패널(.list-card: 배경/테두리/그림자)이
          // 없고, 배경 위에 행 구분선만 있습니다. 그래서 공용 .list-card 대신 이 페이지
          // 전용 .docList(패널 없이 grid/구분선만)를 씁니다 — .list-row/.doc-row는 그대로
          // 재사용(구분선·그리드 비율은 그 클래스들이 맡음).
          <div className={styles.docList}>
            {/* 스크롤 영역 — 컬럼 헤더는 이 안에서 sticky로 맨 위에 붙어 있어서(스크롤바가 생겨도) 열 폭이 어긋나지 않습니다 */}
            <div className={styles.docBody} ref={docBodyRef}>
            {/* 그룹별 탭은 열 의미가 달라서 헤더 문구만 바꿉니다(같은 5열 그리드 재사용) */}
            <div className="list-row list-head doc-row">
              {activeTab === 'group' ? (
                <>
                  <span>그룹명</span>
                  <span>문서 수</span>
                  <span>최근 업로드</span>
                  <span />
                  <span />
                </>
              ) : (
                <>
                  <span>문서명</span>
                  <span>연결된 회의</span>
                  <span>업로드 날짜</span>
                  <span className={styles.uploaderCol}>올린 사람</span>
                  <span />
                </>
              )}
            </div>

            {activeTab === 'group' ? (
              // 저장 대기 파일은 그룹에 넣기 전이라 목록 맨 위에 두고, 그 아래는 그룹마다 한 행입니다.
              <>
              {pendingDocs.map((doc) => renderDocRow(doc))}
              {groupSections.map(({ group, docs: groupDocs, latest }) => {
                // 그룹 문서들의 첨부를 펼쳐서 셉니다. 배열째로 넘기면 파일이 하나도 없는 것으로 셉니다.
                const files = unionAttachments(...groupDocs.map((doc) => doc.attachments))
                  .sort((a, b) => (b.ts || 0) - (a.ts || 0));
                const fileCount = files.length;
                const empty = fileCount === 0;
                const collapsed = collapsedGroupIds.has(group.id);
                return (
                  <div className={styles.groupBlock} key={group.id}>
                    <div className="list-row doc-row">
                      <span className={styles.groupName}>
                        <span className={styles.groupBadge}>{group.name.slice(0, 1)}</span>
                        {group.name}
                      </span>
                      <span className={empty ? styles.groupCountEmpty : styles.groupCount}>
                        {empty ? '문서 없음' : `문서 ${fileCount}개`}
                      </span>
                      <span className={styles.uploaderCell}>{latest ? formatDocDate(latest) : '—'}</span>
                      <span />
                      <span className={styles.rowActions}>
                        {/* 문서가 없는 그룹은 펼칠 게 없어서 버튼을 비활성화 */}
                        <button
                          type="button"
                          className={`${styles.groupToggle}${collapsed ? '' : ` ${styles.groupToggleOpen}`}`}
                          aria-label={collapsed ? `${group.name} 펼치기` : `${group.name} 접기`}
                          aria-expanded={!collapsed}
                          disabled={empty}
                          onClick={() => {
                            setCollapsedGroupIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(group.id)) next.delete(group.id);
                              else next.add(group.id);
                              return next;
                            });
                          }}
                        >
                          <Icon name="chevron-down" />
                        </button>
                      </span>
                    </div>
                    {/* 펼치면 이 그룹에 올린 파일을 그룹 행 바로 아래에 나열합니다. */}
                    {!collapsed && !empty
                      ? renderInlineFiles(files, false, '이 그룹에 올린 파일이 없습니다.')
                      : null}
                  </div>
                );
              })}
              </>
            ) : (
              visibleDocs.map((doc) => {
                // 전체 문서는 파일을 이미 한 줄씩 나눠 두었습니다. 내가 올린 문서만 묶음을 펼칩니다.
                if (activeTab === 'all' || isPendingLink(doc)) return renderDocRow(doc);
                const expanded = expandedGroupIds.has(doc.id);
                // 이미 내가 올린 파일만 남겨 둔 행입니다. 다시 받으면 다른 사람 파일이 섞입니다.
                const listedFiles = unionAttachments(doc.attachments);
                const loadingThisDoc = false;
                return (
                  <div className={styles.groupBlock} key={doc.id}>
                    {renderDocRow(doc, {
                      expanded,
                      onToggle: () => {
                        setExpandedGroupIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(doc.id)) next.delete(doc.id);
                          else next.add(doc.id);
                          return next;
                        });
                      },
                    })}
                    {expanded
                      ? renderInlineFiles(listedFiles, loadingThisDoc, '이 문서에 저장된 첨부 파일이 없습니다.')
                      : null}
                  </div>
                );
              })
            )}
            </div>

            {/* 피그마 디자인의 "문서 N개 · 저장 대기 M개" 하단 요약 — 이 분기는 이미 filteredDocs가 비어있지 않을 때라 항상 보여줍니다 */}
            <div className={styles.listFooter}>
              {activeTab === 'group' ? `그룹 ${groupSections.length}개 · ` : ''}문서 {visibleDocs.length}개
              {pendingCount > 0 ? ` · 저장 대기 ${pendingCount}개` : ''}
            </div>
          </div>
        )}
      </div>

      {/* createPortal로 body에 직접 그립니다 — AppShell의 .app이 transform: scale()을 가져서 그 안의
          position: fixed 배경(.doc-attach-backdrop)이 화면이 아니라 .app 기준이 되어 화면을 다 못 덮었습니다. */}
      {openDoc ? createScaledPortal(
        <div
          className="doc-attach-backdrop"
          role="presentation"
          onClick={() => { setOpenDoc(null); setRenamingPath(null); }}
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
                onClick={() => { setOpenDoc(null); setRenamingPath(null); }}
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
                      {renamingPath === file.path ? (
                        <input
                          className={styles.renameInput}
                          value={renameDraft}
                          autoFocus
                          disabled={savingRename}
                          aria-label="첨부 파일 이름"
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void commitRename(file);
                            if (e.key === 'Escape') setRenamingPath(null);
                          }}
                        />
                      ) : (
                        <span className="doc-attach-name" title={displayFileName(file.name)}>
                          {displayFileName(file.name)}
                        </span>
                      )}
                      <span className="doc-attach-size">{formatChatFileSize(file.size)}</span>
                    </div>
                    {renamingPath === file.path ? (
                      <button
                        type="button"
                        className="doc-attach-download"
                        disabled={savingRename}
                        onClick={() => { void commitRename(file); }}
                      >
                        {savingRename ? '저장 중…' : '저장'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="doc-attach-download"
                        onClick={() => {
                          setRenamingPath(file.path);
                          setRenameDraft(displayFileName(file.name));
                        }}
                      >
                        이름 변경
                      </button>
                    )}
                    <button
                      type="button"
                      className="doc-attach-download"
                      disabled={downloadingPath === file.path || renamingPath === file.path}
                      onClick={() => { void handleDownload(file); }}
                    >
                      {downloadingPath === file.path ? '받는 중…' : '다운로드'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>,
      ) : null}
    </AppShell>
  );
}
