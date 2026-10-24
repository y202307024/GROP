import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import styles from './MeetingDetailView.module.css';
import a from './MeetingDetailAi.module.css';
import { supabase } from '../services/supabaseClient';
import { getApiBase } from '../utils/apiBase';
import { chatLogForSummary } from '../utils/liveMeeting';
import {
  deleteMeetingRecord,
  formatStorageBytes,
  meetingHasStoredVideo,
  meetingVideoStatusLabel,
  primeWebmSeeking,
  resolveMeetingVideoUrl,
} from '../utils/meetingVideo';
import {
  findActiveChapterIndex,
  formatTimestamp,
  normalizeChapters,
  parseTimestamp,
  type MeetingChapter,
} from '../utils/meetingChapters';
import { notifyGroupMembers } from '../utils/notifications';

type Meeting = {
  id: string;
  title: string;
  date: string;
  summary: string | null;
  video_url: string | null;
  /** R2 객체 키. 있으면 재생·요약은 이 키를 쓰고, 없으면 video_url(예전 디스크)을 씁니다. */
  video_key?: string | null;
  /** pending_upload | uploaded | backed_up | failed */
  video_status?: string | null;
  /** 이 회의 영상 파일 크기(바이트). 없으면 용량 칸은 — 로 둡니다. */
  video_size_bytes?: number | null;
  group_id: string;
  created_at?: string | null;
  chapters?: unknown;
  transcript?: string | null; // [MM:SS] 붙은 전체 녹취록 (현재 UI에서는 표시 안 함, DB엔 계속 저장)
  topics?: unknown; // 주제별 요약 [{ topic, detail }] (현재 UI에서는 표시 안 함, DB엔 계속 저장)
  speakers?: unknown; // 발언자별요약: [{ speaker, summary }] (AI 추정)
  chat_log?: unknown; // 회의 중 채팅 [{ from, name, text, ts }] — 마이크 없이 진행한 회의의 요약 재료
  started_at?: string | null; // 회의방을 연 시각
  ended_at?: string | null; // 회의방을 닫은 시각
  attendees?: unknown; // 참석자 user id 또는 닉네임
  created_by?: string | null;
  topic_line?: string | null; // AI가 쓴 회의 주제 한 줄
  recording_seconds?: number | null; // 녹화 길이(초)
};

/** 선택된 회의가 없을 때(AI 요약 탭에 회의록이 하나도 없을 때) 쓰는 빈 회의 placeholder */
const EMPTY_MEETING: Meeting = {
  id: '',
  title: '',
  date: '',
  summary: null,
  video_url: null,
  group_id: '',
};

/** 카드에 넣을 한 줄. 배열·빈 값은 버립니다. */
function cleanLine(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

/** 사람 이름만 남깁니다. 빈 값·익명·"화자 1" 같은 추정 라벨은 참석자로 쓰지 않습니다. */
function personNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  for (const item of raw) {
    const name = typeof item === 'string' ? item.trim() : '';
    if (!name || names.includes(name)) continue;
    if (name === '익명' || name === '참여자' || name === '나') continue;
    if (/^화자\s*\d+$/.test(name)) continue;
    names.push(name);
  }
  return names;
}

/** meetings.chat_log에 실제 메시지가 있는지(요약 재료로 쓸 수 있는지)만 가볍게 확인 */
function hasUsableChatLog(raw: unknown): boolean {
  return Array.isArray(raw) && raw.some((m) => m && typeof (m as { text?: unknown }).text === 'string' && (m as { text: string }).text.trim());
}

type ChatLogMessage = { name: string; text: string; ts: number };

/** meetings.chat_log(신뢰 못 할 형태) → 시간순 메시지 배열 */
function normalizeChatLog(raw: unknown): ChatLogMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m) => {
      const rec = m as Record<string, unknown>;
      const name = typeof rec?.name === 'string' && rec.name.trim() ? rec.name.trim() : '참여자';
      const text = typeof rec?.text === 'string' ? rec.text.trim() : '';
      const ts = Number(rec?.ts) || 0;
      return { name, text, ts };
    })
    .filter((m) => m.text)
    .sort((a, b) => a.ts - b.ts);
}

/** 채팅 메시지를 보낸 사람별로 모아, 그 사람이 한 말 전체를 이어 붙입니다(요약 아님). */
function groupChatBySpeaker(messages: ChatLogMessage[]): { speaker: string; text: string }[] {
  const order: string[] = [];
  const byName = new Map<string, string[]>();
  for (const m of messages) {
    if (!byName.has(m.name)) {
      byName.set(m.name, []);
      order.push(m.name);
    }
    byName.get(m.name)!.push(m.text);
  }
  return order.map((name) => ({ speaker: name, text: byName.get(name)!.join('\n') }));
}

/** 채팅 메시지 전송 시각(ms) → "HH:MM" */
function formatClockTime(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** meetings.speakers → { speaker, summary }[] 로 정규화 */
function normalizeSpeakers(raw: unknown): { speaker: string; summary: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => {
      const rec = s as Record<string, unknown>;
      const speaker = typeof rec?.speaker === 'string' ? rec.speaker.trim() : '';
      const summary = typeof rec?.summary === 'string' ? rec.summary.trim() : '';
      return { speaker, summary };
    })
    .filter((s) => s.speaker && s.summary);
}

const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 참석자 칸에 넣을 닉네임.
 * 기록된 user id는 그룹 닉네임으로 바꾸고, 기록이 없으면 그룹 멤버 닉네임을 그대로 씁니다.
 */
function nicknamesForMeeting(meeting: Meeting, byId: Map<string, string>): string[] {
  const picked: string[] = [];
  const addNick = (userId: string) => {
    const nick = byId.get(userId)?.trim();
    if (nick && !picked.includes(nick)) picked.push(nick);
  };
  const addText = (raw: string) => {
    const name = raw.trim();
    if (!name || name.includes('@') || USER_ID_RE.test(name)) return;
    if (name === '익명' || name === '참여자' || name === '나' || /^화자\s*\d+$/.test(name)) return;
    if (!picked.includes(name)) picked.push(name);
  };

  if (Array.isArray(meeting.attendees)) {
    for (const item of meeting.attendees) {
      if (typeof item !== 'string') continue;
      const value = item.trim();
      if (USER_ID_RE.test(value)) addNick(value);
      else addText(value);
    }
  }
  if (Array.isArray(meeting.chat_log)) {
    for (const msg of meeting.chat_log) {
      const from = (msg as { from?: unknown }).from;
      if (typeof from === 'string' && USER_ID_RE.test(from)) addNick(from);
    }
  }
  if (picked.length > 0) return picked;
  return [...byId.values()].filter((nick) => nick.trim());
}

/** 저장된 참석자 → 채팅을 친 사람 → 발언자 순으로 이름을 고릅니다. */
function attendeeNames(meeting: Meeting): string[] {
  const saved = personNames(meeting.attendees);
  if (saved.length > 0) return saved;
  const fromChat = personNames(normalizeChatLog(meeting.chat_log).map((m) => m.name));
  if (fromChat.length > 0) return fromChat;
  return personNames(normalizeSpeakers(meeting.speakers).map((s) => s.speaker));
}

function topicNames(raw: unknown): string[] {
  return normalizeTopics(raw).map((t) => t.topic);
}

/** meetings.topics → { topic, detail }[]. PDF 본문은 시간 대신 이 주제 설명을 씁니다. */
function normalizeTopics(raw: unknown): { topic: string; detail: string }[] {
  if (!Array.isArray(raw)) return [];
  const list: { topic: string; detail: string }[] = [];
  for (const item of raw) {
    const rec = item as { topic?: unknown; detail?: unknown };
    const topic = typeof rec?.topic === 'string' ? rec.topic.replace(/\s+/g, ' ').trim() : '';
    const detail = typeof rec?.detail === 'string' ? rec.detail.replace(/\s+/g, ' ').trim() : '';
    if (!topic || list.some((t) => t.topic === topic)) continue;
    list.push({ topic, detail });
  }
  return list;
}

/**
 * 회의가 열린 시각과 닫힌 시각.
 * 방에 들어오고 나간 시각이 있으면 그걸 쓰고, 예전 회의는 채팅 시각이나 녹화 길이로 추정합니다.
 */
function sessionBounds(meeting: Meeting, videoSec: number): { startMs: number; endMs: number } | null {
  const startSaved = meeting.started_at ? Date.parse(meeting.started_at) : NaN;
  const endSaved = meeting.ended_at ? Date.parse(meeting.ended_at) : NaN;
  if (Number.isFinite(startSaved) && Number.isFinite(endSaved) && endSaved >= startSaved) {
    return { startMs: startSaved, endMs: endSaved };
  }
  // 채팅 한 통은 회의 길이로 보기 어렵습니다. 녹화 길이와 비교해 더 긴 쪽을 씁니다.
  const candidates: { startMs: number; endMs: number }[] = [];
  const stamps = normalizeChatLog(meeting.chat_log).map((m) => m.ts).filter((ts) => ts > 0);
  if (stamps.length > 0) {
    const startMs = Math.min(...stamps);
    const endMs = Math.max(...stamps);
    if (endMs > startMs) candidates.push({ startMs, endMs });
  }
  const anchor = Date.parse(meeting.created_at || meeting.date || '');
  if (videoSec > 0 && Number.isFinite(anchor)) {
    candidates.push({ startMs: anchor - videoSec * 1000, endMs: anchor });
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((best, cur) => (
    cur.endMs - cur.startMs > best.endMs - best.startMs ? cur : best
  ));
}

/** "32분 동안", "1시간 12분 동안". 30초보다 짧으면 분으로 올리기 전에 짧게 표시합니다. */
function formatMinutesDuring(ms: number): string {
  if (!Number.isFinite(ms) || ms < 30_000) return '1분 미만';
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}분 동안`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hours}시간 ${rest}분 동안` : `${hours}시간 동안`;
}

function formatClockMs(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 생성 시간: 회의방을 연 시각부터 닫은 시각까지. */
function formatSessionRange(bounds: { startMs: number; endMs: number } | null, createdAt?: string | null): string {
  if (!bounds) {
    if (!createdAt) return '—';
    const ms = Date.parse(createdAt);
    return Number.isFinite(ms) ? formatClockMs(ms) : '—';
  }
  const start = new Date(bounds.startMs);
  const end = new Date(bounds.endMs);
  if (start.toDateString() === end.toDateString()) {
    return `${formatClockMs(bounds.startMs)} ~ ${formatClockMs(bounds.endMs)}`;
  }
  const day = (d: Date) => `${d.getMonth() + 1}/${d.getDate()} ${formatClockMs(d.getTime())}`;
  return `${day(start)} ~ ${day(end)}`;
}

/** PostgREST/Postgres가 "없는 컬럼"이라고 할 때만 그 컬럼 이름을 돌려줍니다. */
function missingMeetingsColumn(message: string): string | null {
  const postgrest = message.match(/Could not find the '([^']+)' column/);
  if (postgrest?.[1]) return postgrest[1];
  const pg = message.match(/column "([^"]+)" of relation "meetings" does not exist/);
  if (pg?.[1]) return pg[1];
  return null;
}

type Props = {
  /** 보여 줄 회의 id. null이면 (선택된 회의가 없으면) 빈 상태 레이아웃을 보여줍니다. */
  meetingId: string | null;
  /** 뒤로가기 버튼 동작. 넘기지 않으면 버튼을 숨깁니다(임베드 상황). */
  onBack?: () => void;
  /** 뒤로가기 버튼 라벨 */
  backLabel?: string;
  /**
   * 렌더링 형태
   * - 'page'  : 단독 회의록 상세 페이지(기본 카드 레이아웃)
   * - 'ai'    : AI 요약 탭 왼쪽 열 (grop/css/ai.css 목업 레이아웃, 같은 데이터·핸들러 재사용)
   */
  variant?: 'page' | 'ai';
};

/** 요약 본문 안의 [MM:SS] 를 클릭 가능한 버튼으로 바꿔서 렌더링 */
function SummaryWithTimestamps({
  text,
  onSeek,
}: {
  text: string;
  onSeek: (seconds: number) => void;
}) {
  // [00:00] 또는 [1:02:03] 패턴으로 쪼갭니다.
  const parts = text.split(/(\[\d{1,2}(?::\d{2}){1,2}\])/g);

  return (
    <>
      {parts.map((part, i) => {
        const match = /^\[(\d{1,2}(?::\d{2}){1,2})\]$/.exec(part);
        if (!match) return <span key={i}>{part}</span>;

        const seconds = parseTimestamp(match[1]);
        if (seconds === null) return <span key={i}>{part}</span>;

        return (
          <button
            key={i}
            type="button"
            onClick={() => onSeek(seconds)}
            title={`${match[1]} 지점으로 이동`}
            style={{
              background: '#E1F5EE',
              color: '#085041',
              border: 'none',
              borderRadius: 4,
              padding: '1px 6px',
              margin: '0 2px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {match[1]}
          </button>
        );
      })}
    </>
  );
}

/**
 * meetings.summary 텍스트를 '핵심 요약'과 '타임라인'으로 나눕니다.
 * 서버(buildSummaryText)가 만드는 형식:
 *   📋 회의 핵심 요약 / 개요 ... / (빈 줄) / 🕘 타임라인 / [MM:SS] 제목 / "    설명" / (빈 줄) / ✅ ... / ⚡ ...
 *
 * @returns core - 타임라인 블록을 뺀 나머지(핵심 요약 + 결정/할 일)
 * @returns timeline - chapters 배열이 있으면 그대로, 없으면 요약 텍스트에서 파싱한 구간
 */
function splitSummary(rawSummary: string | null, chapters: MeetingChapter[]): {
  core: string;
  timeline: MeetingChapter[];
} {
  const text = rawSummary ?? '';
  const lines = text.split('\n');
  // '🕘 타임라인' 처럼 '타임라인'만 있는 짧은 헤더 줄을 찾습니다.
  const start = lines.findIndex((l) => l.trim().length <= 20 && l.includes('타임라인'));

  const parsed: MeetingChapter[] = [];
  let core = text;

  if (start !== -1) {
    // 타임라인 끝 = 다음 빈 줄 / 다음 섹션(✅·⚡) / 문서 끝
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t === '' || t.startsWith('✅') || t.startsWith('⚡')) { end = i; break; }
    }
    for (let i = start + 1; i < end; i++) {
      const m = /^\[(\d{1,2}(?::\d{2}){1,2})\]\s*(.*)$/.exec(lines[i].trim());
      if (m) {
        parsed.push({ time: parseTimestamp(m[1]) ?? 0, title: m[2], summary: undefined });
      } else if (parsed.length > 0 && lines[i].trim()) {
        // 들여쓴 설명 줄은 직전 구간에 붙입니다.
        const last = parsed[parsed.length - 1];
        last.summary = last.summary ? `${last.summary} ${lines[i].trim()}` : lines[i].trim();
      }
    }
    // 왼쪽에 보여줄 텍스트에서는 타임라인 블록(헤더~end)을 들어냅니다.
    core = [...lines.slice(0, start), ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  return { core, timeline: chapters.length > 0 ? chapters : parsed };
}

/** PDF 섹션 헤더. '📋 회의 핵심 요약'처럼 짧은 줄만 헤더로 봅니다. */
function isPdfSectionHeader(line: string, keyword: string) {
  const text = line.trim();
  return text.length > 0 && text.length <= 24 && text.includes(keyword);
}

/**
 * PDF용으로 요약 텍스트를 나눕니다.
 * 핵심 요약 문단, 결정 목록, 논의 내용만 꺼내고 타임라인·다음 할 일은 버립니다.
 */
function parseSummaryForPdf(raw: string | null): {
  overview: string;
  decisions: string[];
  discussion: { title: string; body: string }[];
} {
  const lines = (raw ?? '').split('\n');
  let section: 'none' | 'overview' | 'discussion' | 'decisions' | 'skip' = 'none';
  const overviewLines: string[] = [];
  const decisions: string[] = [];
  const discussionLines: string[] = [];

  for (const line of lines) {
    const text = line.trim();
    if (isPdfSectionHeader(text, '핵심 요약')) { section = 'overview'; continue; }
    if (isPdfSectionHeader(text, '타임라인')) { section = 'skip'; continue; }
    if (isPdfSectionHeader(text, '논의 내용')) { section = 'discussion'; continue; }
    if (isPdfSectionHeader(text, '결정')) { section = 'decisions'; continue; }
    if (isPdfSectionHeader(text, '다음 할 일') || isPdfSectionHeader(text, '할 일')) { section = 'skip'; continue; }

    if (section === 'overview') overviewLines.push(line);
    else if (section === 'decisions') {
      const item = text.replace(/^[-*•]\s*/, '').trim();
      if (item) decisions.push(item);
    } else if (section === 'discussion') discussionLines.push(line);
  }

  // 논의 내용은 '제목 / 본문 / 빈 줄'로 저장됩니다.
  const discussion: { title: string; body: string }[] = [];
  let title = '';
  let body: string[] = [];
  const flush = () => {
    if (!title && body.length === 0) return;
    discussion.push({ title, body: body.join(' ').trim() });
    title = '';
    body = [];
  };
  for (const line of discussionLines) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (!title) title = line.trim();
    else body.push(line.trim());
  }
  flush();

  return {
    overview: overviewLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    decisions,
    discussion: discussion.filter((item) => item.title || item.body),
  };
}

/**
 * 회의록 상세 본문 (영상 녹화 + AI 회의록)
 * - 단독 페이지(MeetingDetail)와 AI 요약 탭의 왼쪽 열에서 함께 씁니다.
 * - meetingId 가 바뀌면 해당 회의 데이터로 다시 불러옵니다.
 */
export default function MeetingDetailView({ meetingId, onBack, backLabel = '회의록 목록', variant = 'page' }: Props) {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [removingVideo, setRemovingVideo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryInput, setSummaryInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStep, setAiStep] = useState('');
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState('');
  const [groupName, setGroupName] = useState('');
  const [nicknames, setNicknames] = useState<string[]>([]);
  // ai 목업 레이아웃 전용 상태 (탭 하이라이트 / 대화록 더보기)
  // 큰 탭(요약 생성 / 회의 영상), 영상 탭의 대화내역 탭(타임라인 / 채팅), 요약 미리보기 탭(핵심 / 시간대별)
  const [mainTab, setMainTab] = useState<'summary' | 'video'>('summary');
  const [chatTab, setChatTab] = useState<'timeline' | 'chat' | 'speaker'>('timeline');
  const [summaryTab, setSummaryTab] = useState<'core' | 'timeline'>('core');
  // 요약 탭에서 [MM:SS]/구간을 눌렀을 때: 영상 탭으로 넘어간 뒤 영상이 준비되면 그 시점으로 이동하려고 기억해 둡니다
  const pendingSeekRef = useRef<number | null>(null);

  // 챕터 타임라인 관련
  const [chapters, setChapters] = useState<MeetingChapter[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const seekPrimedRef = useRef(false);

  const activeIndex = findActiveChapterIndex(chapters, currentTime);

  useEffect(() => {
    // 회의가 바뀌면 이전 회의 상태가 남지 않도록 초기화하고 다시 불러옵니다.
    seekPrimedRef.current = false;
    setEditingSummary(false);
    setCurrentTime(0);
    setDuration(0);
    setLoading(true);
    fetchMeeting();
  }, [meetingId]);

  useEffect(() => {
    const groupId = meeting?.group_id;
    if (!groupId) {
      setGroupName('');
      return;
    }
    let cancelled = false;
    void supabase
      .from('groups')
      .select('name')
      .eq('id', groupId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setGroupName(data?.name?.trim() || '—');
      });
    return () => { cancelled = true; };
  }, [meeting?.group_id]);

  useEffect(() => {
    const groupId = meeting?.group_id;
    if (!groupId || !meeting) {
      setNicknames([]);
      return;
    }
    let cancelled = false;
    // 팀원 목록과 같은 프로필 닉네임을 가져옵니다. 본인 행만 보이는 테이블을 직접 읽지 않습니다.
    void supabase.rpc('get_group_members_with_profiles', { p_group_id: groupId }).then(({ data }) => {
      if (cancelled) return;
      const byId = new Map<string, string>();
      for (const row of (data as { user_id?: string; nickname?: string }[]) || []) {
        const nick = row.nickname?.trim();
        if (row.user_id && nick) byId.set(row.user_id, nick);
      }
      setNicknames(nicknamesForMeeting(meeting, byId));
    });
    return () => { cancelled = true; };
  }, [meeting]);

  useEffect(() => {
    const videoKey = meeting?.video_key?.trim() || '';
    const videoUrl = meeting?.video_url?.trim() || '';
    // R2 키가 있으면 재생 주소를 다시 받고, 없으면 예전 /videos 경로를 그대로 씁니다.
    if (!videoKey && !videoUrl) {
      setPlaybackUrl(null);
      setPlaybackError('');
      return;
    }
    let mounted = true;
    void resolveMeetingVideoUrl(videoUrl, videoKey).then((url) => {
      if (!mounted) return;
      setPlaybackUrl(url || null);
      setPlaybackError(url ? '' : '녹화 파일을 불러올 수 없습니다.');
    }).catch((err: unknown) => {
      if (!mounted) return;
      setPlaybackError(err instanceof Error ? err.message : '녹화 파일을 불러올 수 없습니다.');
    });
    return () => { mounted = false; };
  }, [meeting?.video_url, meeting?.video_key]);

  const fetchMeeting = async () => {
    // 선택된 회의가 없으면(id가 null) 서버 조회 없이 바로 빈 상태로 둡니다.
    if (!meetingId) {
      setMeeting(null);
      setSummaryInput('');
      setChapters([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .single();
    if (data) {
      setMeeting(data);
      setSummaryInput(data.summary || '');
      setChapters(normalizeChapters(data.chapters));
    } else {
      setMeeting(null);
    }
    setLoading(false);
  };

  /** 용량 옆 제거. 이 회의 탭(요약·영상·기록)을 통째로 지우고 목록으로 돌아갑니다. */
  const removeRecording = async () => {
    if (!meeting || removingVideo) return;
    if (!window.confirm('이 회의를 삭제할까요? 요약, 영상, 회의 기록이 함께 지워집니다.')) return;
    setRemovingVideo(true);
    const result = await deleteMeetingRecord(meeting);
    if (!result.ok) {
      setRemovingVideo(false);
      window.alert(result.error);
      return;
    }
    onBack?.();
  };

  const saveSummary = async () => {
    await supabase
      .from('meetings')
      .update({ summary: summaryInput })
      .eq('id', meetingId);
    setEditingSummary(false);
    fetchMeeting();
  };

  /**
   * MediaRecorder webm은 길이 정보가 없어 seek이 막힙니다.
   * 메타데이터가 잡히는 시점에 한 번 보정해 둡니다.
   */
  const handleLoadedMetadata = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (!seekPrimedRef.current) {
      seekPrimedRef.current = true;
      const resolved = await primeWebmSeeking(video);
      setDuration(resolved);
    }
    // 요약 탭에서 시점을 눌러 넘어온 경우 — 영상이 준비된 지금 그 시점으로 이동합니다
    if (pendingSeekRef.current !== null) {
      const target = pendingSeekRef.current;
      pendingSeekRef.current = null;
      video.currentTime = target;
      setCurrentTime(target);
      void video.play().catch(() => {});
    }
  };

  // 영상 탭을 벗어나면 <video>가 사라지므로, 다시 돌아와 새로 생기는 영상은 처음부터 다시 보정해야 합니다
  useEffect(() => {
    if (mainTab !== 'video') seekPrimedRef.current = false;
  }, [mainTab]);

  /** 요약 탭의 시점 클릭 → 영상 탭으로 이동한 뒤 그 시점으로 */
  const goToVideoAt = (seconds: number) => {
    if (mainTab === 'video') {
      void seekTo(seconds);
      return;
    }
    pendingSeekRef.current = seconds;
    setMainTab('video');
  };

  /** 챕터/타임스탬프 클릭 → 해당 시점으로 점프 후 재생 */
  const seekTo = async (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;

    if (!seekPrimedRef.current) {
      seekPrimedRef.current = true;
      const resolved = await primeWebmSeeking(video);
      setDuration(resolved);
    }

    video.currentTime = seconds;
    setCurrentTime(seconds);
    void video.play().catch(() => {
      // 자동재생이 막혀도 이동 자체는 됐으므로 무시
    });
    video.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // AI 요약 생성 (챕터 포함)
  const generateAiSummary = async () => {
    if (!meeting) return;
    const chatAvailable = hasUsableChatLog(meeting.chat_log);
    const hasVideo = meetingHasStoredVideo(meeting);
    if (!hasVideo && !chatAvailable) {
      alert('녹화 파일도, 채팅 기록도 없어요!');
      return;
    }

    setAiLoading(true);

    try {
      setAiStep(hasVideo ? '🎙️ 음성 변환 중...' : '💬 채팅 기록 정리 중...');
      // R2 영상이면 videoKey만 넘깁니다. 서버가 원본을 내려받아 음성만 추출합니다.
      // 예전 영상은 video_url을 그대로 넘기고, 서버가 디스크에서 읽습니다.
      // 마이크 음성이 없는 회의(no-mic)에 대비해 채팅 기록도 함께 보내면,
      // 서버가 음성에서 텍스트를 못 뽑았을 때 채팅으로 대신 요약합니다.
      const videoKey = meeting.video_key?.trim();
      const res = await fetch(`${getApiBase()}/api/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(videoKey ? { videoKey } : { videoUrl: meeting.video_url }),
          chatLog: chatLogForSummary(meeting.chat_log),
          // 모델이 날짜를 지어내지 않도록, 화면에 쓰는 것과 같은 날짜 문구를 넘깁니다.
          meetingDateLabel: formatDate(meeting.date),
        })
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error((errBody as { error?: string }).error || `서버 오류 (${res.status})`);
      }

      setAiStep('📝 요약·타임라인 생성 중...');
      const data = await res.json();
      const nextChapters = normalizeChapters(data.chapters, data.duration);

      setAiStep('💾 저장 중...');
      // 없는 컬럼만 빼면서 저장합니다. 요약 본문까지 통째로 버리지 않기 위해서입니다.
      const topicLine = cleanLine(data.topicLine);
      const payload: Record<string, unknown> = {
        summary: data.summary,
        chapters: nextChapters,
        transcript: data.transcript ?? null,
        topics: data.topics ?? null,
        speakers: data.speakers ?? null,
        ...(topicLine ? { topic_line: topicLine } : {}),
        ...(Number(data.duration) > 0 ? { recording_seconds: Math.round(Number(data.duration)) } : {}),
      };
      const dropped: string[] = [];
      let error: { message: string } | null = null;
      for (let i = 0; i < 8; i += 1) {
        const result = await supabase.from('meetings').update(payload).eq('id', meetingId);
        if (!result.error) {
          error = null;
          break;
        }
        error = result.error;
        const col = missingMeetingsColumn(result.error.message);
        if (!col || !(col in payload)) break;
        delete payload[col];
        dropped.push(col);
        if (Object.keys(payload).length === 0) break;
      }
      if (!error && dropped.length > 0) {
        alert(
          '요약은 저장했어요. 아래 항목은 DB에 컬럼이 없어 빠졌습니다.\n' +
          `${dropped.join(', ')}\n` +
          'supabase/14_회의정보.sql 을 적용하면 날짜·주제 한 줄도 남습니다.'
        );
      }
      if (error) throw new Error(error.message);

      await fetchMeeting();
      if (meeting?.group_id) {
        await notifyGroupMembers({
          groupId: meeting.group_id,
          type: 'ai_summary',
          title: `${meeting.title || '회의'} AI 요약이 완료됐어요`,
          body: 'AI 요약이 준비되었습니다.',
          link: `/ai?meeting=${meeting.id}`,
          excludeSelf: false,
        });
      }
      alert(
        nextChapters.length > 0
          ? `AI 요약 완성! 타임라인 ${nextChapters.length}개가 만들어졌어요 🎉`
          : 'AI 요약이 완성됐어요! 🎉'
      );

    } catch (err) {
      console.error('AI 요약 실패:', err);
      const msg = err instanceof Error ? err.message : '알 수 없는 오류';
      alert(`AI 요약 실패: ${msg}`);
    }

    setAiLoading(false);
    setAiStep('');
  };

  /**
   * 회의록 PDF(인쇄).
   * 맨 위는 결정 사항, 그 다음 회의 핵심 요약 문단만, 이어서 논의 내용입니다.
   * 타임라인과 다음 할 일은 인쇄하지 않습니다.
   */
  const downloadSummary = () => {
    if (!meeting?.summary && normalizeTopics(meeting?.topics).length === 0) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    // 사용자가 수정할 수 있는 값이라 반드시 이스케이프합니다.
    const escapeHtml = (s: string) =>
      s.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const parsed = parseSummaryForPdf(meeting?.summary ?? null);
    const { timeline } = splitSummary(meeting?.summary ?? null, chapters);
    const topics = normalizeTopics(meeting?.topics);
    // 본문에 논의 내용이 있으면 그걸 쓰고, 예전 요약은 주제 표나 구간 설명으로 채웁니다.
    const sections = parsed.discussion.length > 0
      ? parsed.discussion
      : topics.length > 0
        ? topics.map((t) => ({ title: t.topic, body: t.detail }))
        : timeline
            .filter((c) => c.title || c.summary)
            .map((c) => ({ title: c.title, body: c.summary ?? '' }));

    const decisionHtml = parsed.decisions.length > 0
      ? `<h2 class="section-title">✅ 결정 사항</h2><ul class="decisions">${parsed.decisions
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join('')}</ul>`
      : '';
    const overviewHtml = parsed.overview
      ? `<h2 class="section-title">📋 회의 핵심 요약</h2><div class="content">${escapeHtml(parsed.overview)}</div>`
      : '';
    const sectionHtml = sections.length > 0
      ? `<h2 class="section-title">📝 논의 내용</h2>${sections
          .map((s) => `<section class="block"><h3>${escapeHtml(s.title)}</h3>${
            s.body ? `<p>${escapeHtml(s.body)}</p>` : ''
          }</section>`)
          .join('')}`
      : '';

    printWindow.document.write(`
      <html>
        <head>
          <meta charset="utf-8">
          <title>${escapeHtml(meeting?.title ?? '회의록')}_회의록</title>
          <style>
            body { font-family: 'Malgun Gothic', sans-serif; padding: 40px; line-height: 1.8; color: #333; }
            h1 { font-size: 22px; margin-bottom: 6px; color: #111; }
            h2.section-title { font-size: 16px; margin: 28px 0 12px; color: #111; }
            h2.section-title:first-of-type { margin-top: 0; }
            h3 { font-size: 15px; margin: 0 0 6px; color: #085041; }
            .date { color: #888; font-size: 13px; margin-bottom: 28px; }
            hr { border: none; border-top: 1px solid #eee; margin-bottom: 24px; }
            .content { font-size: 14px; white-space: pre-wrap; line-height: 2; }
            .decisions { margin: 0; padding-left: 1.2em; font-size: 14px; line-height: 1.9; }
            .block { margin: 0 0 18px; }
            .block p { margin: 0; font-size: 14px; line-height: 1.9; }
          </style>
        </head>
        <body>
          <h1>${escapeHtml(meeting?.title ?? '회의록')}</h1>
          <div class="date">📅 ${formatDate(meeting?.date ?? '')} · 🕐 ${formatTime(meeting?.date ?? '')}</div>
          <hr />
          ${decisionHtml}
          ${overviewHtml}
          ${sectionHtml}
          <script>window.onload = () => { window.print(); }</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  if (loading) return <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#888' }}>불러오는 중...</div>;
  // 'ai' 탭은 선택된 회의가 없어도(meeting === null) 레이아웃은 그대로 두고
  // 데이터가 들어가는 자리만 비워서 보여줘야 해서, 여기서 바로 끊지 않습니다.
  if (!meeting && variant !== 'ai') return <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#888' }}>회의록을 찾을 수 없어요</div>;

  /* =====================================================================
     AI 요약 탭 레이아웃 — grop/css/ai.css 목업 구조에 실제 회의 데이터를 채웁니다.
     상태·핸들러(seekTo, generateAiSummary, downloadSummary 등)는 아래 페이지
     레이아웃과 완전히 동일한 것을 공유합니다.
  ===================================================================== */
  if (variant === 'ai') {
    // 선택된 회의가 없으면 빈 placeholder로 채워서, 레이아웃 자체는 항상 같은 모습으로 보여줍니다.
    const m = meeting ?? EMPTY_MEETING;
    const hasSummary = !!m.summary;
    // 요약 본문은 '핵심 요약'과 '시간대별(타임라인)'로 나눠 탭마다 보여줍니다.
    const { core: coreSummary, timeline } = splitSummary(m.summary, chapters);
    const hasTranscript = !!m.transcript?.trim();
    const memberNames = nicknames.length > 0 ? nicknames : attendeeNames(m);
    const videoStatusLabel = meetingVideoStatusLabel(m.video_status);
    // R2 녹화는 video_url 없이 video_key만 있습니다. 둘 중 하나만 있어도 재생합니다.
    const hasVideoFile = meetingHasStoredVideo(m);
    // 회의 시간은 방 체류 시간이 아니라 녹화 길이입니다.
    const recordingSec = duration > 0 ? duration : Number(m.recording_seconds) || 0;
    const durationLabel = recordingSec > 0 ? formatMinutesDuring(recordingSec * 1000) : '—';
    const sessionLabel = formatSessionRange(sessionBounds(m, 0), m.created_at);

    /** '2026.09.06 11:30 AM' — 제목 아래 줄에 쓰는 날짜 */
    const metaDate = (() => {
      if (!m.date) return '—';
      const d = new Date(m.date);
      let h = d.getHours();
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(h).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
    })();

    /**
     * 회의 주제 — AI 요약(핵심 요약)의 첫 문장을 그대로 씁니다. 별도 "주제" 컬럼이 없고,
     * 요약 맨 윗줄의 "📋 회의 핵심 요약" 같은 제목 줄은 건너뜁니다.
     */
    const topic = cleanLine(m.topic_line) || topicNames(m.topics).join(', ') || (() => {
      const line = coreSummary
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l && !(l.length <= 20 && l.includes('요약')));
      if (!line) return '';
      const first = line.split(/(?<=[.!?。])\s/)[0];
      return first.length > 90 ? `${first.slice(0, 90)}…` : first;
    })();

    /** 텍스트를 .txt 파일로 내려받습니다 */
    const downloadText = (filename: string, text: string) => {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    };
    // 회의 채팅 기록 — meetings.chat_log(마이크 없이 진행한 회의도 요약 재료로 쓰는 그 기록)를 그대로 보여줍니다.
    const rawChatMessages = normalizeChatLog(m.chat_log);
    const chatMessages = rawChatMessages.map((msg, i) => ({
      id: `${msg.ts}-${i}`,
      sender: msg.name,
      time: formatClockTime(msg.ts),
      text: msg.text,
    }));
    const hasChat = chatMessages.length > 0;
    // 발언자별 탭: 채팅 기록이 있으면 그 사람이 실제로 쓴 메시지를 모아 보여주고,
    // 없으면(음성만 있는 회의) AI가 추정한 화자별 요약으로 대신합니다.
    const chatBySpeaker = groupChatBySpeaker(rawChatMessages);
    const speakers = normalizeSpeakers(m.speakers);
    const baseName = (m.title || '회의').replace(/[\\/:*?"<>|]/g, '_');
    const downloadTranscript = () => hasTranscript && downloadText(`${baseName}_음성텍스트.txt`, m.transcript ?? '');
    const downloadChat = () =>
      hasChat &&
      downloadText(`${baseName}_채팅기록.txt`, chatMessages.map((c) => `[${c.time}] ${c.sender}: ${c.text}`).join('\n'));
    /** 받을 수 있는 파일(요약·채팅·음성 텍스트)을 모두 내려받습니다 */
    const downloadAll = () => {
      if (hasChat) downloadChat();
      if (hasSummary) downloadText(`${baseName}_AI요약.txt`, m.summary ?? '');
      if (hasTranscript) downloadTranscript();
    };

    /** AI 파일 생성 카드 3개 — 상태/버튼 동작이 서로 달라 데이터로 정리해 둡니다 */
    const fileCards = [
      {
        key: 'summary',
        title: 'AI 회의 요약',
        desc: '핵심 내용과 결정 사항을 정리해요.',
        done: hasSummary,
        statusText: hasSummary ? '생성 완료' : '아직 만들지 않았어요',
        canRegenerate: true,
        onDownload: downloadSummary, // PDF(인쇄) 형태
      },
      {
        key: 'chat',
        title: '채팅 기록',
        desc: '회의 중 주고받은 채팅을 저장해요.',
        // 저장된 채팅이 생기면(chatMessages) 자동으로 "생성 완료"가 되고 다운로드가 켜집니다
        done: hasChat,
        statusText: hasChat ? '저장 완료' : '저장된 기록이 없어요',
        canRegenerate: false,
        onDownload: hasChat ? downloadChat : undefined,
      },
      {
        key: 'voice',
        title: '음성 텍스트',
        desc: '회의 음성을 텍스트로 정리해요.',
        done: hasTranscript,
        statusText: hasTranscript ? '생성 완료' : '아직 만들지 않았어요',
        // 음성 텍스트는 AI 요약을 만들 때 함께 생성됩니다
        canRegenerate: true,
        onDownload: hasTranscript ? downloadTranscript : undefined,
      },
    ];

    return (
      <>
        {/* ---------- 큰 탭: 요약 생성 / 회의 영상 (뒤로가기는 오른쪽 끝) ---------- */}
        <div className={a.tabRow}>
          <div className={a.tabs}>
            <button
              type="button"
              className={`${a.tab}${mainTab === 'summary' ? ` ${a.tabActive}` : ''}`}
              onClick={() => setMainTab('summary')}
            >
              요약 생성
            </button>
            <button
              type="button"
              className={`${a.tab}${mainTab === 'video' ? ` ${a.tabActive}` : ''}`}
              onClick={() => setMainTab('video')}
            >
              회의 영상
            </button>
          </div>
          {onBack && (
            <button type="button" className={a.backButton} aria-label={backLabel} title={backLabel} onClick={onBack}>
              <Icon name="chevron-left" />
            </button>
          )}
        </div>

        {/* ---------- 회의 제목 + 날짜/참석자 (두 탭 공통) ---------- */}
        <div className={a.head}>
          <h1 className={a.headTitle}>{m.title?.trim() || (meeting ? '회의' : '선택된 회의가 없어요')}</h1>
          <div className={a.headMeta}>
            <span className={a.metaItem}>
              <Icon name="users" />
              {groupName || '—'}
            </span>
            <span className={a.metaDivider} />
            <span className={a.metaItem}>
              <Icon name="calendar" />
              {metaDate}
            </span>
            <span className={a.metaDivider} />
            <span className={a.metaItem}>
              <Icon name="users" />
              참석자 {memberNames.length > 0 ? memberNames.join(', ') : '—'}
            </span>
            <span className={a.metaDivider} />
            <span className={a.metaItem}>
              <Icon name="clock" />
              {durationLabel} ({sessionLabel})
            </span>
            {/* 날짜 줄 오른쪽 끝 — 이 회의 영상 용량. 그 옆 제거는 회의 전체를 지웁니다. */}
            <span className={a.storageStat}>
              <span>
                {Number(m.video_size_bytes) > 0
                  ? formatStorageBytes(Number(m.video_size_bytes))
                  : '—'}
              </span>
              {meeting && (
                <button
                  type="button"
                  className={a.removeVideo}
                  onClick={() => { void removeRecording(); }}
                  disabled={removingVideo}
                >
                  {removingVideo ? '제거 중...' : '제거'}
                </button>
              )}
            </span>
          </div>
        </div>

        {mainTab === 'summary' ? (
          /* =============== 요약 생성 탭 =============== */
          <div className={`${a.grid} ${a.gridSummary}`}>
            {/* 패널 위 제목은 두지 않습니다 */}
            <section className={a.col}>
              <div className={a.panel}>
                <div className={a.fileCards}>
                  {fileCards.map((f) => (
                    <div className={a.fileCard} key={f.key}>
                      <span className={a.fileIcon}>
                        <Icon name="file-text" />
                      </span>
                      <div className={a.fileText}>
                        <div className={a.fileTitle}>{f.title}</div>
                        <div className={a.fileDesc}>{f.desc}</div>
                        <div className={`${a.fileStatus}${f.done ? '' : ` ${a.fileStatusOff}`}`}>
                          {f.done && <Icon name="check-circle" />}
                          {f.statusText}
                        </div>
                      </div>
                      <button
                        type="button"
                        className={a.regenButton}
                        onClick={generateAiSummary}
                        disabled={!f.canRegenerate || aiLoading || editingSummary || !meeting}
                      >
                        {aiLoading && f.canRegenerate ? '만드는 중...' : f.done ? '다시 생성' : '생성'}
                      </button>
                      <button type="button" className={a.downloadButton} onClick={f.onDownload} disabled={!f.onDownload}>
                        <Icon name="download" />
                        다운로드
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className={a.downloadAll}
                  onClick={downloadAll}
                  disabled={!hasSummary && !hasTranscript}
                >
                  <Icon name="download" />
                  전체 파일 다운로드
                </button>
              </div>
            </section>

            <section className={a.col}>
              <div className={a.panel}>
                {/* 두 탭이 패널 폭을 반반 나눠 갖고 글자는 각 탭 가운데 */}
                <div className={a.previewTabs}>
                  <button
                    type="button"
                    className={`${styles.videoTab}${summaryTab === 'core' ? ` ${styles.videoTabActive}` : ''}`}
                    onClick={() => setSummaryTab('core')}
                  >
                    핵심 요약
                  </button>
                  <button
                    type="button"
                    className={`${styles.videoTab}${summaryTab === 'timeline' ? ` ${styles.videoTabActive}` : ''}`}
                    onClick={() => setSummaryTab('timeline')}
                  >
                    시간대별 요약
                  </button>
                </div>

                <div className={a.previewBody}>
                  {aiLoading ? (
                    <p className={a.paragraph}>AI가 회의록을 작성하고 있어요 — {aiStep}</p>
                  ) : editingSummary ? (
                    <textarea
                      className={a.editArea}
                      value={summaryInput}
                      onChange={(e) => setSummaryInput(e.target.value)}
                      placeholder="회의 내용을 입력하세요"
                    />
                  ) : hasSummary ? (
                    summaryTab === 'timeline' ? (
                      timeline.length > 0 ? (
                        timeline.map((c, i) => {
                          const end = timeline[i + 1]?.time ?? (duration > 0 ? duration : null);
                          return (
                            <button type="button" key={`${c.time}-${i}`} className={a.rangeItem} onClick={() => goToVideoAt(c.time)}>
                              <span className={a.rangeTime}>
                                {formatTimestamp(c.time)} {end !== null ? `~ ${formatTimestamp(end)}` : '~'}
                              </span>
                              <span className={a.paragraph}>
                                <strong>{c.title}</strong>
                                {c.summary ? ` - ${c.summary}` : ''}
                              </span>
                            </button>
                          );
                        })
                      ) : (
                        <p className={`${a.paragraph} ${a.muted}`}>
                          아직 시간대별 요약이 없어요. 왼쪽에서 AI 회의 요약을 다시 생성해 주세요.
                        </p>
                      )
                    ) : (
                      <p className={a.paragraph} style={{ whiteSpace: 'pre-wrap' }}>
                        <SummaryWithTimestamps text={coreSummary} onSeek={goToVideoAt} />
                      </p>
                    )
                  ) : (
                    <p className={`${a.paragraph} ${a.muted}`}>
                      아무 내용이 없습니다.{hasVideoFile ? ' 왼쪽 “AI 회의 요약”에서 생성을 누르면 요약이 만들어져요.' : ''}
                    </p>
                  )}
                </div>

                {/* 요약 수정 — 요약이 있을 때만. 편집 중에는 취소/저장 */}
                <div className={a.previewFooter}>
                  {editingSummary ? (
                    <>
                      <button type="button" className={a.textButton} onClick={() => { setSummaryInput(m.summary ?? ''); setEditingSummary(false); }}>
                        취소
                      </button>
                      <button type="button" className={`${a.textButton} ${a.textButtonPrimary}`} onClick={saveSummary}>
                        저장
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={a.textButton}
                      onClick={() => setEditingSummary(true)}
                      disabled={!hasSummary || aiLoading}
                    >
                      수정
                    </button>
                  )}
                </div>
              </div>
            </section>
          </div>
        ) : (
          /* =============== 회의 영상 탭 =============== */
          <div className={`${a.grid} ${a.gridVideo}`}>
            <section className={`${a.panel} ${a.videoPanel}`}>
              {hasVideoFile && playbackUrl ? (
                <video
                  ref={videoRef}
                  key={playbackUrl}
                  src={playbackUrl}
                  controls
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={handleLoadedMetadata}
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  className={a.video}
                />
              ) : (
                <div className={`${a.video} ${a.videoEmpty}`}>
                  {hasVideoFile ? playbackError || videoStatusLabel || '녹화 파일 불러오는 중...' : '녹화 파일이 없어요'}
                </div>
              )}

              {/* 회의 주제만 — 날짜·참석자 등은 제목 아래 줄에 이미 있습니다 */}
              <div className={a.topicCard}>
                <div className={a.topicLabel}>
                  <Icon name="clipboard-list" />
                  회의 주제
                </div>
                <p className={`${a.topicText}${topic ? '' : ` ${a.muted}`}`}>
                  {topic || 'AI 요약을 생성하면 회의 주제가 여기에 표시돼요.'}
                </p>
              </div>
            </section>

            {/* 대화내역 — 제목 없이 탭(타임라인/채팅)부터. 탭 모양은 기존 AI 요약 페이지의 것을 그대로 씁니다 */}
            <section className={a.panel}>
              <div className={a.previewTabs}>
                <button
                  type="button"
                  className={`${styles.videoTab}${chatTab === 'timeline' ? ` ${styles.videoTabActive}` : ''}`}
                  onClick={() => setChatTab('timeline')}
                >
                  타임라인
                </button>
                <button
                  type="button"
                  className={`${styles.videoTab}${chatTab === 'chat' ? ` ${styles.videoTabActive}` : ''}`}
                  onClick={() => setChatTab('chat')}
                >
                  채팅
                </button>
                <button
                  type="button"
                  className={`${styles.videoTab}${chatTab === 'speaker' ? ` ${styles.videoTabActive}` : ''}`}
                  onClick={() => setChatTab('speaker')}
                >
                  발언자별
                </button>
              </div>

              <div className={a.previewBody}>
                {chatTab === 'timeline' ? (
                  timeline.length > 0 ? (
                    timeline.map((c, i) => (
                      <button
                        type="button"
                        key={`${c.time}-${i}`}
                        className={`${a.timelineItem}${i === activeIndex ? ` ${a.timelineItemActive}` : ''}`}
                        onClick={() => void seekTo(c.time)}
                      >
                        <span className={a.timelineHead}>
                          <Icon name="clock" />
                          <span className={a.timelineTime}>{formatTimestamp(c.time)}</span>
                          <span className={a.timelineTitle}>{c.title}</span>
                        </span>
                        {c.summary && <span className={a.timelineDesc}>{c.summary}</span>}
                      </button>
                    ))
                  ) : (
                    <p className={`${a.paragraph} ${a.muted}`}>
                      {hasSummary
                        ? '이 회의에는 타임라인이 없어요.'
                        : '아직 타임라인이 없어요. AI 요약을 생성하면 구간별 내용이 여기에 표시됩니다.'}
                    </p>
                  )
                ) : chatTab === 'chat' ? (
                  hasChat ? (
                    chatMessages.map((c) => (
                      <div key={c.id} className={a.chatItem}>
                        <div className={a.chatMeta}>
                          <span className={a.chatSender}>{c.sender}</span>
                          <span className={a.chatTime}>{c.time}</span>
                        </div>
                        <p className={a.chatBubble}>{c.text}</p>
                      </div>
                    ))
                  ) : (
                    <p className={`${a.paragraph} ${a.muted}`}>저장된 채팅 기록이 없어요.</p>
                  )
                ) : (
                  chatBySpeaker.length > 0 ? (
                    chatBySpeaker.map((s, i) => (
                      <div key={i} className={a.chatItem}>
                        <div className={a.chatMeta}>
                          <span className={a.chatSender}>{s.speaker}</span>
                        </div>
                        <p className={a.chatBubble} style={{ whiteSpace: 'pre-wrap' }}>{s.text}</p>
                      </div>
                    ))
                  ) : speakers.length > 0 ? (
                    speakers.map((s, i) => (
                      <div key={i} className={a.chatItem}>
                        <div className={a.chatMeta}>
                          <span className={a.chatSender}>{s.speaker}</span>
                        </div>
                        <p className={a.chatBubble}>{s.summary}</p>
                      </div>
                    ))
                  ) : (
                    <p className={`${a.paragraph} ${a.muted}`}>
                      {hasSummary
                        ? '발언자별로 보여줄 채팅이나 화자 구분 정보가 없어요.'
                        : 'AI 요약을 생성하면 발언자별 내용이 여기에 표시됩니다.'}
                    </p>
                  )
                )}
              </div>
            </section>
          </div>
        )}
      </>
    );
  }
  // 위에서 'ai' 레이아웃은 회의가 없어도 그렸고, 단독 페이지는 회의가 있어야만 그립니다
  if (!meeting) return null;
  const videoStatusLabel = meetingVideoStatusLabel(meeting.video_status);

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', fontFamily: 'sans-serif', padding: '0 20px' }}>

      {/* 헤더 */}
      <div style={{ marginBottom: 24 }}>
        {onBack && (
          <button onClick={onBack}
            style={{ background: 'none', border: 'none', color: '#888', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 10 }}>
            ← {backLabel}
          </button>
        )}
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{meeting.title}</h2>
        <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
          📅 {formatDate(meeting.date)} · 🕐 {formatTime(meeting.date)}
        </div>
      </div>

      {/* 영상 섹션 */}
      <div style={{ background: '#fff', border: '0.5px solid #eee', borderRadius: 12, padding: 24, marginBottom: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
          🎬 회의 녹화
          {/* 업로드 대기 / 저장 완료. 예전 디스크 영상은 상태가 없어 이 글이 없습니다. */}
          {videoStatusLabel ? (
            <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: '#888' }}>{videoStatusLabel}</span>
          ) : null}
        </div>
        {meetingHasStoredVideo(meeting) ? (
          playbackUrl ? (
            <video
              ref={videoRef}
              key={playbackUrl}
              src={playbackUrl}
              controls
              playsInline
              preload="metadata"
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              style={{ width: '100%', borderRadius: 8, background: '#000', maxHeight: 400 }}
            />
          ) : (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#888', fontSize: 13 }}>
              {playbackError || videoStatusLabel || '녹화 파일 불러오는 중...'}
            </div>
          )
        ) : (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#aaa' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>🎬</div>
            <div style={{ fontSize: 14, color: '#555' }}>녹화 파일이 없어요</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>회의가 끝나면 자동으로 저장돼요</div>
          </div>
        )}

        {/* 챕터 타임라인 — 누르면 해당 지점으로 점프 */}
        {chapters.length > 0 && (
          <div style={{ marginTop: 20, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>🕘 타임라인</div>
              <div style={{ fontSize: 11, color: '#aaa' }}>
                {duration > 0 ? `총 ${formatTimestamp(duration)}` : `${chapters.length}개 구간`}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {chapters.map((c, i) => {
                const isActive = i === activeIndex;
                return (
                  <button
                    key={`${c.time}-${i}`}
                    type="button"
                    onClick={() => void seekTo(c.time)}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 10px',
                      border: 'none',
                      borderRadius: 8,
                      borderLeft: isActive ? '3px solid #1D9E75' : '3px solid transparent',
                      background: isActive ? '#F2FBF7' : 'transparent',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                    }}
                  >
                    <span style={{
                      flexShrink: 0,
                      minWidth: 46,
                      fontSize: 12,
                      fontWeight: 600,
                      color: isActive ? '#085041' : '#1D9E75',
                      fontVariantNumeric: 'tabular-nums',
                      paddingTop: 1,
                    }}>
                      {formatTimestamp(c.time)}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{
                        display: 'block',
                        fontSize: 13,
                        fontWeight: isActive ? 600 : 500,
                        color: '#333',
                      }}>
                        {c.title}
                      </span>
                      {c.summary && (
                        <span style={{ display: 'block', fontSize: 12, color: '#999', marginTop: 2, lineHeight: 1.5 }}>
                          {c.summary}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* AI 요약 섹션 */}
      <div style={{ background: '#fff', border: '0.5px solid #eee', borderRadius: 12, padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>🤖 AI 회의록</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {meetingHasStoredVideo(meeting) && !aiLoading && (
              <button onClick={generateAiSummary}
                style={{ fontSize: 12, padding: '5px 12px', background: '#1D9E75', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                ✨ AI 요약 생성
              </button>
            )}
            {meeting.summary && !editingSummary && !aiLoading && (
              <button onClick={downloadSummary}
                style={{ fontSize: 12, padding: '5px 12px', background: '#E1F5EE', color: '#085041', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                ⬇️ 다운로드
              </button>
            )}
            {!aiLoading && (
              <button onClick={() => setEditingSummary(!editingSummary)}
                style={{ fontSize: 12, padding: '5px 12px', background: '#f0f0f0', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                {editingSummary ? '취소' : '✏️ 수정'}
              </button>
            )}
          </div>
        </div>

        {/* AI 로딩 중 */}
        {aiLoading && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🤖</div>
            <div style={{ fontSize: 15, fontWeight: 500, color: '#333', marginBottom: 6 }}>AI가 회의록을 작성하고 있어요</div>
            <div style={{ fontSize: 13, color: '#1D9E75' }}>{aiStep}</div>
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 8 }}>회의 길이에 따라 1~3분 걸릴 수 있어요</div>
          </div>
        )}

        {/* 수정 모드 */}
        {!aiLoading && editingSummary && (
          <div>
            <textarea
              value={summaryInput}
              onChange={e => setSummaryInput(e.target.value)}
              rows={10}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #eee', borderRadius: 8, fontSize: 13, lineHeight: 1.6, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'sans-serif' }}
              placeholder="회의 내용을 입력하세요"
            />
            <button onClick={saveSummary}
              style={{ marginTop: 10, padding: '8px 20px', background: '#1D9E75', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
              저장
            </button>
          </div>
        )}

        {/* 요약 내용 표시 — [MM:SS] 는 눌러서 이동 가능 */}
        {!aiLoading && !editingSummary && meeting.summary && (
          <div style={{ fontSize: 13, lineHeight: 1.9, color: '#333', background: '#f9f9f9', padding: '16px 18px', borderRadius: 8, borderLeft: '3px solid #1D9E75', whiteSpace: 'pre-wrap' }}>
            <SummaryWithTimestamps text={meeting.summary} onSeek={(s) => void seekTo(s)} />
          </div>
        )}

        {/* 요약 없을 때 */}
        {!aiLoading && !editingSummary && !meeting.summary && (
          <div style={{ textAlign: 'center', padding: '30px 0', color: '#aaa' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🤖</div>
            <div style={{ fontSize: 14 }}>아무 내용이 없습니다</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              {meetingHasStoredVideo(meeting)
                ? '✨ AI 요약 생성 버튼을 누르면 요약이 만들어집니다.'
                : '파일만 올린 문서이거나, 아직 녹화가 없어요.'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
