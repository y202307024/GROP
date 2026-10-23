import { useEffect, useMemo, useState, useRef } from 'react';
import { createScaledPortal } from '../components/AppScaleLayer';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import FileTypeIcon from '../components/FileTypeIcon';
import moreVerticalIcon from '../assets/action-icons/more-vertical.svg';
import checkIcon from '../assets/action-icons/check.svg';
import closeIcon from '../assets/action-icons/close.svg';
import saveFloppyIcon from '../assets/action-icons/save-floppy-disk.svg';
import shareExportIcon from '../assets/action-icons/share-export.svg';
import trashIcon from '../assets/action-icons/trash.svg';
import styles from './DocumentList.module.css';
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

/**
 * 문서명 아래에 보여줄 "형식 · 크기" 문구.
 * 형식은 첫 파일의 확장자(대문자), 크기는 전체 합계이고, 파일이 여럿이면 "PDF 외 2개 · 3.4MB"로 줄여 씁니다.
 * 첨부가 없는 문서(회의록만 있는 경우)는 null을 돌려 그 줄을 숨깁니다.
 */
function fileSummary(files: MeetingAttachment[]): string | null {
  if (files.length === 0) return null;
  const dot = files[0].name.lastIndexOf('.');
  const ext = dot > 0 && dot < files[0].name.length - 1 ? files[0].name.slice(dot + 1).toUpperCase() : '파일';
  const total = files.reduce((sum, f) => sum + (f.size || 0), 0);
  const kind = files.length > 1 ? `${ext} 외 ${files.length - 1}개` : ext;
  return `${kind} · ${formatChatFileSize(total)}`;
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
      buckets.set(key, {
        ...doc,
        attachments: normalizeAttachments(doc.attachments),
        creator_ids: doc.created_by ? [doc.created_by] : [],
      });
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
  /**
   * 상단 탭("전체 문서" / "내가 올린 문서"). 파일마다 올린 사람을 저장하진 않아서, "내가 올린 문서"는
   * 그 문서(회의록 행)를 만든 사람(meetings.created_by)이 나인 문서로 판단합니다.
   * 같은 날 다른 사람이 이어서 올린 파일은 파일 단위로 구분되지 않는 한계가 있습니다.
   */
  const [activeTab, setActiveTab] = useState<'all' | 'mine' | 'group'>('all');
  /** 「그룹별 문서」 탭에서 펼쳐 둔 그룹 id — 여러 그룹을 동시에 펼칠 수 있고, 새로고침하면 접힌 상태로 돌아갑니다 */
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
   * 아래 3가지는 전부 화면에서만 쓰는 상태라 새로고침하면 초기화됩니다.
   * (북마크/연결 확정을 서버에 저장하는 기능은 아직 없어서, 디자인/동작만 먼저 반영합니다.)
   */
  /** 북마크 토글한 문서 id 모음 */
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set());
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

  /** 연결된 회의: 화면에서 확정한 값 → 그룹명 → 기존 회의 제목 순으로 표시 */
  const linkedMeetingLabel = (doc: MeetingDoc) => {
    const override = linkOverrides[doc.id];
    if (override) return override;
    const group = doc.group_name?.trim();
    if (group) return group;
    return doc.title?.trim() || `${formatDocDate(doc.date)} 회의`;
  };

  /**
   * "저장 대기" 상태: 그룹명을 못 찾아 연결된 회의가 비어 있는 문서.
   * 지금은 모든 문서가 group_id로 이미 그룹에 묶여 있어 실제로는 거의 발생하지 않지만,
   * 나중에 회의와 분리된 업로드를 지원할 때를 대비해 드롭다운/확정 UI를 먼저 만들어 둡니다.
   */
  const isPendingLink = (doc: MeetingDoc) => !linkOverrides[doc.id] && !doc.group_name?.trim();

  /** 체크(✓) — 드롭다운에서 고른 그룹을 연결된 회의로 확정합니다(화면에서만, 저장 X) */
  const confirmPendingLink = (doc: MeetingDoc) => {
    const groupId = pendingLinkDraft[doc.id];
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    setLinkOverrides((prev) => ({ ...prev, [doc.id]: group.name }));
    setPendingLinkDraft((prev) => {
      const next = { ...prev };
      delete next[doc.id];
      return next;
    });
  };

  /** 닫기(×) — 드롭다운에서 고른 값을 버리고 "연결할 회의를 선택하세요" 상태로 되돌립니다 */
  const cancelPendingLink = (docId: string) => {
    setPendingLinkDraft((prev) => {
      const next = { ...prev };
      delete next[docId];
      return next;
    });
  };

  /** 북마크 아이콘 클릭 — bookmark ↔ bookmark-fill 토글 (화면에서만) */
  const toggleBookmark = (docId: string) => {
    setBookmarkedIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
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

  /** 그룹 행의 화살표 — 펼침 ↔ 접힘 토글 */
  const toggleGroup = (groupId: string) => {
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const meetingName = openDoc
    ? [
        openDoc.group_name?.trim(),
        openDoc.title?.trim() || `${formatDocDate(openDoc.date)} 회의`,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  /** 검색창 입력값으로 문서명/연결된 회의명을 좁힙니다. */
  const filteredDocs = useMemo(() => {
    const q = query.trim().toLowerCase();
    // 「내가 올린 문서」 탭이면 내가 만든 문서만 남기고, 그 안에서 검색어로 한 번 더 좁힙니다
    const base =
      activeTab === 'mine'
        ? docs.filter((doc) => !!myUserId && (doc.creator_ids ?? []).includes(myUserId))
        : docs;
    const matched = !q
      ? base
      : base.filter((doc) => {
          const title = documentTitle(doc.title, doc.date).toLowerCase();
          const linked = linkedMeetingLabel(doc).toLowerCase();
          return title.includes(q) || linked.includes(q);
        });
    // 별표한 문서는 맨 위로 — 정렬은 안정적이라 같은 쪽끼리는 기존(최신 날짜순)이 그대로 유지됩니다.
    // 그룹별 탭의 각 그룹 안에서도 이 순서가 그대로 쓰입니다.
    return [...matched].sort(
      (a, b) => Number(bookmarkedIds.has(b.id)) - Number(bookmarkedIds.has(a.id)),
    );
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

  /** 하단 "문서 N개 · 저장 대기 M개" 요약에 쓰는 저장 대기 문서 수 */
  const pendingCount = useMemo(
    () => filteredDocs.filter((doc) => isPendingLink(doc)).length,
    [filteredDocs, isPendingLink],
  );

  /** 문서 한 행 — 「전체/내가 올린 문서」 목록과 「그룹별 문서」의 펼친 그룹 안에서 똑같이 씁니다 */
  const renderDocRow = (doc: MeetingDoc) => {
          const attachments = normalizeAttachments(doc.attachments);
          const pending = isPendingLink(doc);
          const bookmarked = bookmarkedIds.has(doc.id);
          const menuOpen = openMenuDocId === doc.id;
          // 대표 아이콘은 첫 첨부 파일의 확장자를 따라갑니다. 첨부가 없으면 기본 문서 아이콘.
          return (
            <div className="list-row doc-row" key={doc.id}>
              {/* "열기" 버튼 대신 문서명 자체를 눌러서 열도록 합니다(피그마 디자인엔 별도 열기 버튼이 없음) */}
              {editingDocId === doc.id ? (
                // 수정 중: 문서명 자리에 입력창 (Enter = 저장, Esc = 취소)
                <input
                  className={styles.titleInput}
                  value={editTitle}
                  autoFocus
                  disabled={savingTitle}
                  placeholder="문서명"
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={() => { void commitEditTitle(doc); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commitEditTitle(doc);
                    if (e.key === 'Escape') setEditingDocId(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className={styles.titleCell}
                  onClick={() => { void handleOpen(doc); }}
                >
                  <FileTypeIcon fileName={attachments[0]?.name} className={styles.fileIcon} />
                  <span className={styles.titleText}>
                    <span className={styles.titleName}>{documentTitle(doc.title, doc.date)}</span>
                    {/* 문서명 아래 "형식 · 크기" — 첨부가 없으면 줄 자체를 안 그립니다 */}
                    {fileSummary(attachments) ? (
                      <span className={styles.fileMeta}>{fileSummary(attachments)}</span>
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

              <span>{formatDocDate(doc.date)}</span>

              {/* 올린 사람 — 피그마 기준 저장 대기 행도 이 칸엔 업로더가 그대로 보입니다
                  (체크/닫기는 오른쪽 액션 칸으로). 내가 아니면 만든 사람(created_by)의 닉네임을, 모르면 "—"를 보여줍니다.
                  저장 대기 행은 방금 내가 올려서 연결을 고르는 중인 경우라 "나"로 둡니다. */}
              <span className={styles.uploaderCol}>
                {pending || (!!myUserId && (doc.creator_ids ?? []).includes(myUserId))
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
                      aria-label="연결 저장"
                      disabled={!pendingLinkDraft[doc.id]}
                      onClick={() => confirmPendingLink(doc)}
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
                      {/* 그룹 목록의 즐겨찾기와 같은 별 모양: 꺼짐 = 윤곽선, 켜짐 = 채움 */}
                    <svg
                      className={`${styles.starIcon}${bookmarked ? ` ${styles.starIconOn}` : ''}`}
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path d="M12 3.2l2.67 5.66 6.2.74-4.58 4.24 1.2 6.13L12 17.1l-5.49 2.87 1.2-6.13L3.13 9.6l6.2-.74L12 3.2z" />
                    </svg>
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
                              onClick={() => setOpenMenuDocId(null)}
                            >
                              <img src={saveFloppyIcon} alt="" />
                              저장
                            </button>
                            {/* 수정은 문서 주인(만든 사람)에게만 보입니다 */}
                            {isDocOwner(doc) ? (
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
                            <button
                              type="button"
                              className={styles.moreMenuItem}
                              role="menuitem"
                              onClick={() => setOpenMenuDocId(null)}
                            >
                              <img src={shareExportIcon} alt="" />
                              내보내기
                            </button>
                            <button
                              type="button"
                              className={`${styles.moreMenuItem} ${styles.moreMenuItemDanger}`}
                              role="menuitem"
                              onClick={() => setOpenMenuDocId(null)}
                            >
                              <img src={trashIcon} alt="" />
                              삭제
                            </button>
                          </div>
                        </>
                      ) : null}
                    </span>
                  </>
                )}
              </span>
            </div>
          );
  };

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
            <button type="button" className={styles.uploadButton} onClick={handleCreate}>
              <Icon name="plus" />
              문서 업로드
            </button>
          </div>
        </div>

        {loading ? (
          <div>불러오는 중...</div>
        ) : (activeTab === 'group' ? groupSections.length === 0 : filteredDocs.length === 0) ? (
          // MeetingList와 같은 패턴: 문서가 하나도 없을 땐 목록 카드(헤더 포함)를 아예 안 띄우고
          // 빈 상태 문구만 보여줍니다. (전엔 헤더 행이 .list-card 안에 항상 떠 있어서, 그 행이
          // ":last-child"가 되는 바람에 구분선도 사라지고 화면에 빈 테이블처럼 남아있었습니다.)
          <div className={styles.empty}>
            {activeTab === 'group'
              ? query.trim()
                ? '검색 결과가 없어요.'
                : '아직 속한 그룹이 없어요.'
              : docs.length === 0
              ? '아직 문서가 없어요. 회의방에서 파일을 올리거나 녹화를 저장하면 이 목록에 나타납니다.'
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
              // 그룹별 문서: 그룹마다 한 행, 오른쪽 화살표를 누르면 그 그룹의 문서가 아래로 펼쳐집니다
              groupSections.map(({ group, docs: groupDocs, latest }) => {
                const expanded = expandedGroupIds.has(group.id);
                const empty = groupDocs.length === 0;
                return (
                  <div className={styles.groupBlock} key={group.id}>
                    <div className="list-row doc-row">
                      <span className={styles.groupName}>
                        <span className={styles.groupBadge}>{group.name.slice(0, 1)}</span>
                        {group.name}
                      </span>
                      <span className={empty ? styles.groupCountEmpty : styles.groupCount}>
                        {empty ? '문서 없음' : `문서 ${groupDocs.length}개`}
                      </span>
                      <span className={styles.uploaderCell}>{latest ? formatDocDate(latest) : '—'}</span>
                      <span />
                      <span className={styles.rowActions}>
                        {/* 문서가 없는 그룹은 펼칠 게 없어서 버튼을 비활성화 */}
                        <button
                          type="button"
                          className={`${styles.groupToggle}${expanded ? ` ${styles.groupToggleOpen}` : ''}`}
                          aria-label={expanded ? `${group.name} 접기` : `${group.name} 펼치기`}
                          aria-expanded={expanded}
                          disabled={empty}
                          onClick={() => toggleGroup(group.id)}
                        >
                          <Icon name="chevron-down" />
                        </button>
                      </span>
                    </div>
                    {expanded && !empty ? (
                      <div className={styles.groupDocs}>{groupDocs.map((doc) => renderDocRow(doc))}</div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              filteredDocs.map((doc) => renderDocRow(doc))
            )}
            </div>

            {/* 피그마 디자인의 "문서 N개 · 저장 대기 M개" 하단 요약 — 이 분기는 이미 filteredDocs가 비어있지 않을 때라 항상 보여줍니다 */}
            <div className={styles.listFooter}>
              {activeTab === 'group' ? `그룹 ${groupSections.length}개 · ` : ''}문서 {filteredDocs.length}개
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
        </div>,
      ) : null}
    </AppShell>
  );
}
