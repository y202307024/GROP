import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';

/**
 * AI 요약 페이지
 * grop/css/ai.css 의 클래스 구조를 그대로 옮긴 화면입니다.
 * 아직 데이터 소스가 없어 대화록·요약·회의 정보는 시안(정적) 내용으로 채워 두었고,
 * 회의 목록 연동 등 실제 DB 연결은 이후 작업으로 남겨 둡니다.
 */

// 상단 대화록(시안) — 발언 시각/발언자/내용
const TRANSCRIPT = [
  {
    time: '00:02:15',
    speaker: '김소연',
    text: '오늘 메인 화면의 정보 구조와 사용자 여정에 대해 이야기 하려고 하는데 여기 보시면 사용자의 여정을 단순화 시키는 게 우선이라는 생각이 들어서',
  },
  {
    time: '00:03:03',
    speaker: '안정민',
    text: '사용자의 여정을 단순화 하고 접근성을 높이는 방향으로 하는 게 좋겠다는 생각이 들어요.',
  },
  {
    time: '00:03:36',
    speaker: '김지민',
    text: '메인화면에서 사용자가 조금 더 쉽게 AI요약 정리와 회의를 진행 할 수 있게끔 제작하면 될 거 같아요.',
  },
  {
    time: '00:04:30',
    speaker: '이규빈',
    text: '메인화면 구성을 디자인적으로 다시 확인해서 말씀하신대로 수정한 후에 공유드릴게요.',
  },
];

// 요약 결과 - 주요 논의 사항 체크리스트(시안)
const CHECKLIST = [
  '사용자 여정 단순화를 통한 사용성 개선',
  '정보 구조를 명확하게 재정의',
  '핵심 기능의 접근성 향상 및 우선순위 재배치',
  '디자인 시스템 정리 및 일관성 유지',
  '사용자 테스트 계획 수립',
];

// 우측 회의 목록(시안) — done: AI 요약 완료 여부
const MEETINGS = [
  { id: 1, done: false },
  { id: 2, done: true },
  { id: 3, done: true },
  { id: 4, done: false },
  { id: 5, done: false },
  { id: 6, done: true },
  { id: 7, done: false },
  { id: 8, done: true },
  { id: 9, done: false },
];

export default function AiSummaryPage() {
  const navigate = useNavigate();
  // 상단 영상 영역 탭 / 요약 결과 탭은 화면 전환만 하는 로컬 상태입니다.
  const [videoTab, setVideoTab] = useState<'chat' | 'speaker'>('chat');
  const [summaryTab, setSummaryTab] = useState<'core' | 'detail' | 'topic'>('core');

  return (
    <AppShell activePage="ai">
      <div className="ai-page">
        {/* 좌측: 회의 영상 + AI 요약 결과 */}
        <div className="ai-main-column">
          {/* ============ 회의 영상 ============ */}
          <section className="panel ai-video-section">
            <div className="ai-video-header">
              <span>회의 영상</span>
              <div className="ai-video-tabs">
                <button
                  type="button"
                  className={`video-tab${videoTab === 'chat' ? ' active' : ''}`}
                  onClick={() => setVideoTab('chat')}
                >
                  전체 채팅
                </button>
                <button
                  type="button"
                  className={`video-tab${videoTab === 'speaker' ? ' active' : ''}`}
                  onClick={() => setVideoTab('speaker')}
                >
                  발언자별
                </button>
              </div>
            </div>

            <div className="ai-video-body">
              {/* 실제 영상 플레이어가 들어갈 자리 */}
              <div className="ai-video-placeholder" />

              {/* 대화록 리스트 */}
              <div className="ai-transcript-list">
                {TRANSCRIPT.map((t, i) => (
                  <div className="ai-transcript-item" key={`${t.time}-${i}`}>
                    <div className="ai-transcript-meta">
                      <Icon name="clock" />
                      <span className="ai-transcript-time">{t.time}</span>
                      <span className="ai-transcript-speaker">{t.speaker}</span>
                    </div>
                    <p className="ai-transcript-text">{t.text}</p>
                  </div>
                ))}
              </div>
            </div>

            <button type="button" className="ai-transcript-more-button">
              전체 채팅 보기
            </button>
          </section>

          {/* ============ AI 요약 결과 ============ */}
          <section className="panel ai-summary-section">
            <div className="ai-summary-title">AI 요약 결과</div>

            <div className="ai-summary-tabs">
              <button
                type="button"
                className={`ai-summary-tab${summaryTab === 'core' ? ' active' : ''}`}
                onClick={() => setSummaryTab('core')}
              >
                핵심요약
              </button>
              <button
                type="button"
                className={`ai-summary-tab${summaryTab === 'detail' ? ' active' : ''}`}
                onClick={() => setSummaryTab('detail')}
              >
                상세요약
              </button>
              <button
                type="button"
                className={`ai-summary-tab${summaryTab === 'topic' ? ' active' : ''}`}
                onClick={() => setSummaryTab('topic')}
              >
                주제별요약
              </button>
            </div>

            <div className="ai-summary-body">
              <div className="ai-summary-left">
                <p className="ai-summary-paragraph">
                  이번 회의에서는 메인 화면의 UI/UX 개선 방향과 정보 구조 재설계에 대해
                  논의했습니다. 사용자의 여정을 단순화하고 핵심기능 및 접근성을 높이는 것을
                  목표로 하며, 디자인 시스템 정리와 사용자 테스트 계획도 함께 진행하기로
                  하였습니다.
                </p>

                <div className="ai-checklist-title">주요 논의 사항</div>
                <ul className="ai-checklist">
                  {CHECKLIST.map((item) => (
                    <li key={item}>
                      <Icon name="check-circle" />
                      {item}
                    </li>
                  ))}
                </ul>

                <div className="ai-action-buttons">
                  <button type="button" className="ai-action-button">
                    <Icon name="copy" />
                    복사
                  </button>
                  <button type="button" className="ai-action-button">
                    <Icon name="download" />
                    PDF 다운로드
                  </button>
                  <button type="button" className="ai-action-button">
                    <Icon name="file-text" />
                    요약 문서로 변환
                  </button>
                  <button
                    type="button"
                    className="ai-action-button ai-action-button-primary"
                  >
                    <Icon name="share-2" />
                    공유하기
                  </button>
                </div>
              </div>

              {/* 회의 정보 카드 */}
              <aside className="meeting-info">
                <div className="meeting-info-title">회의 정보</div>

                <div className="meeting-info-item">
                  <Icon name="users" />
                  <span>회의명</span>
                  <span className="meeting-info-value">UI/UX 피드백 회의</span>
                </div>

                <div className="meeting-info-item">
                  <Icon name="clipboard-list" />
                  <span>회의 주제</span>
                  <span className="meeting-info-value">
                    메인화면의 정보 구조와 사용자 여정
                  </span>
                </div>

                <div className="meeting-info-item">
                  <Icon name="circle-user" />
                  <span>참석자</span>
                  <span className="meeting-info-avatars">
                    <Icon name="circle-user" />
                    <Icon name="circle-user" />
                    <Icon name="circle-user" />
                  </span>
                </div>

                <div className="meeting-info-item">
                  <Icon name="clock" />
                  <span>회의 시간</span>
                  <span className="meeting-info-value">
                    2026.09.06 11:30 AM ~ 13:00PM
                  </span>
                </div>

                <div className="meeting-info-item">
                  <Icon name="clock" />
                  <span>생성 시간</span>
                  <span className="meeting-info-value">11:25AM</span>
                </div>
              </aside>
            </div>
          </section>
        </div>

        {/* 우측: 회의 목록 패널 */}
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
            {MEETINGS.map((m) => (
              <div
                className="meeting-card-row"
                key={m.id}
                onClick={() => navigate('/main')}
              >
                <div className="meeting-card-row-top">
                  <span className="title">10월 스프린트 리뷰</span>
                  <span className={`status-pill ${m.done ? 'done' : 'progress'}`}>
                    {m.done ? '완료' : '진행중'}
                  </span>
                </div>
                <div className="meeting-card-row-bottom">
                  <span>2026.09.06 10:00AM</span>
                  <span className="attendees">
                    <Icon name="circle-user" />
                    <Icon name="circle-user" />
                    <Icon name="circle-user" />
                  </span>
                  <span className="ai-icon">
                    {m.done ? <Icon name="check-circle" /> : <Icon name="minus-circle" />}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
