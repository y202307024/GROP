/* =========================================
   기본 요소
========================================= */

const content = document.getElementById("content");

const menus = document.querySelectorAll(".menu");


/* =========================================
   페이지 출력
========================================= */

function showPage(page) {

    /* -----------------------------
       메인 페이지
    ----------------------------- */

    if (page === "main") {

        content.innerHTML = `

            <div class="group-carousel">

                <span class="chevron prev-button" aria-label="이전 그룹">
                    <i data-lucide="chevron-left"></i>
                </span>

                <div class="group-cards">

                    <div class="group-card" data-action="open-group-detail" data-group-name="디자인팀 그룹" data-group-initial="D">
                        <div class="badge">D</div>
                        <div class="name">디자인팀 그룹</div>
                    </div>

                    <div class="group-card" data-action="open-group-detail" data-group-name="마케팅팀 그룹" data-group-initial="M">
                        <div class="badge">M</div>
                        <div class="name">마케팅팀 그룹</div>
                    </div>

                    <div class="group-card" data-action="open-group-detail" data-group-name="개발팀 그룹" data-group-initial="개">
                        <div class="badge">개</div>
                        <div class="name">개발팀 그룹</div>
                    </div>

                    <div class="group-card" data-action="open-group-detail" data-group-name="기획팀 그룹" data-group-initial="기">
                        <div class="badge">기</div>
                        <div class="name">기획팀 그룹</div>
                    </div>

                </div>

                <span class="chevron next-button" aria-label="다음 그룹">
                    <i data-lucide="chevron-right"></i>
                </span>

            </div>


            <div class="row-2col">

                <!-- 회의 목록 -->
                <section class="panel meeting-table">
                    <div class="section-head"><h2>회의 목록</h2><a class="see-all" href="#">전체 보기 &gt;</a></div>
                    <div class="cols">
                        <span>회의 제목</span><span>진행 상태</span><span>날짜</span><span>참석자</span><span>AI 요약</span>
                    </div>
                    <hr>

                    <div class="meeting-row">
                        <span class="title">10월 스프린트 리뷰</span>
                        <span class="status-pill progress">진행중</span>
                        <span class="date">2026.09.06 10:00AM</span>
                        <span class="attendees">
                            <i data-lucide="circle-user"></i>
                            <i data-lucide="circle-user"></i>
                            <i data-lucide="circle-user"></i>
                            +2
                        </span>
                        <span class="ai-icon"><span class="progress-ring"></span></span>
                    </div>

                    <div class="meeting-row">
                        <span class="title">백엔드 DB 설계 리뷰</span>
                        <span class="status-pill done">완료</span>
                        <span class="date">2026.09.06 14:00PM</span>
                        <span class="attendees">
                            <i data-lucide="circle-user"></i>
                            <i data-lucide="circle-user"></i>
                            <i data-lucide="circle-user"></i>
                            +1
                        </span>
                        <span class="ai-icon"><i data-lucide="check-circle"></i></span>
                    </div>

                    <div class="meeting-row">
                        <span class="title">UI/UX 피드백 회의</span>
                        <span class="status-pill done">완료</span>
                        <span class="date">2026.09.02 11:30AM</span>
                        <span class="attendees">
                            <i data-lucide="circle-user"></i>
                            <i data-lucide="circle-user"></i>
                            <i data-lucide="circle-user"></i>
                            +2
                        </span>
                        <span class="ai-icon"><i data-lucide="check-circle"></i></span>
                    </div>

                    <div class="meeting-row">
                        <span class="title">중간 통합 테스트 계획</span>
                        <span class="status-pill done">완료</span>
                        <span class="date">2026.08.29 10:30AM</span>
                        <span class="attendees">
                            <i data-lucide="circle-user"></i>
                            <i data-lucide="circle-user"></i>
                            <i data-lucide="circle-user"></i>
                            +2
                        </span>
                        <span class="ai-icon"><i data-lucide="check-circle"></i></span>
                    </div>
                </section>

                <!-- 최근 AI 요약 -->
                <section class="panel">
                    <div class="section-head"><h2>최근 AI 요약</h2><a class="see-all" data-page="ai" href="#">전체 보기 &gt;</a></div>
                    <div class="summary-list">
                        <div class="summary-item">
                            <i data-lucide="file-text" class="doc-icon"></i>
                            <div class="content">
                                <div class="top-row">
                                    <span class="title">백엔드 DB 설계 리뷰</span>
                                    <span class="status-pill done">완료</span>
                                    <span class="date">2026.09.06 14:00PM</span>
                                </div>
                                <p class="desc">데이터베이스 구조와 인덱싱 전략에 대해 논의했습니다. 성능 최적화를 위해...</p>
                            </div>
                        </div>
                        <div class="summary-item">
                            <i data-lucide="file-text" class="doc-icon"></i>
                            <div class="content">
                                <div class="top-row">
                                    <span class="title">UI/UX 피드백 회의</span>
                                    <span class="status-pill done">완료</span>
                                    <span class="date">2026.09.02 11:30AM</span>
                                </div>
                                <p class="desc">메인 화면의 UI 개선안과 사용자 경험(UX) 관련 피드백 공유를 하며 다음 스...</p>
                            </div>
                        </div>
                        <div class="summary-item">
                            <i data-lucide="file-text" class="doc-icon"></i>
                            <div class="content">
                                <div class="top-row">
                                    <span class="title">중간 통합 테스트 계획</span>
                                    <span class="status-pill done">완료</span>
                                    <span class="date">2026.08.29 10:30AM</span>
                                </div>
                                <p class="desc">서비스 방향성과 주요 기능 우선 순위에 대해 논의하고 다음 단계의 기획안을...</p>
                            </div>
                        </div>
                    </div>
                </section>

            </div>


            <div class="row-2col">

                <!-- 빠른 작업 -->
                <section>
                    <div class="section-head"><h2>빠른 작업</h2></div>
                    <div class="quick-actions">
                        <button class="qa-card" data-action="open-group-modal">
                            <i data-lucide="folder-plus"></i>
                            <span>그룹 추가</span>
                        </button>
                        <button class="qa-card" data-page="ai">
                            <i data-lucide="sparkles"></i>
                            <span>AI 요약</span>
                        </button>
                        <button class="qa-card" data-page="document">
                            <i data-lucide="file-text"></i>
                            <span>문서 작성</span>
                        </button>
                        <button class="qa-card" data-page="member">
                            <i data-lucide="users"></i>
                            <span>멤버 관리</span>
                        </button>
                    </div>
                </section>

                <!-- 캘린더 -->
                <section>
                    <div class="section-head"><h2>캘린더</h2><a class="see-all" data-page="calendar" href="#">전체 보기 &gt;</a></div>
                    <div class="calendar-panel">
                        <div class="calendar-date">9월 6일</div>
                        <div class="mini-week" id="miniWeek"></div>
                        <p class="calendar-empty">예정 되어있는 회의가 없습니다.</p>
                    </div>
                </section>

            </div>

        `;


        /* 그룹 캐러셀 좌우 스크롤 */

        initSlider();


        /* 미니 캘린더 */

        initMiniCalendar();


        /* 그룹 추가 모달로 새로 생긴 그룹 카드 복원 */

        renderAddedGroupCards();


        /* Lucide 아이콘 생성 */

        if (typeof lucide !== "undefined") {
            lucide.createIcons();
        }

    }


    /* -----------------------------
       다른 페이지
    ----------------------------- */

    else if (page === "meeting") {

        /*
         * 사이드바 '회의' 버튼
         * 화이트보드 + 채팅 + 음성통화가 있는
         * 회의방 페이지로 바로 이동합니다.
         */

        window.location.href = "meeting.html";

    }


    else if (page === "document") {

        loadPageFragment("pages/document.html", initDocumentPage);

    }




    else if (page === "ai") {

        content.innerHTML = `

            <div class="ai-page">

                <div class="ai-main-column">

                    <!-- 회의 영상 + 대화록 -->

                    <section class="panel ai-video-section">

                        <div class="ai-video-header">

                            <span>회의 영상</span>

                            <div class="ai-video-tabs">

                                <button class="video-tab active">
                                    전체 채팅
                                </button>

                                <button class="video-tab">
                                    발언자별
                                </button>

                            </div>

                        </div>


                        <div class="ai-video-body">

                            <div class="ai-video-placeholder"></div>

                            <div class="ai-transcript-list">

                                <div class="ai-transcript-item">
                                    <div class="ai-transcript-meta">
                                        <span class="ai-transcript-time">00:02:15</span>
                                        <span class="ai-transcript-speaker">김소연</span>
                                    </div>
                                    <p class="ai-transcript-text">
                                        오늘 메인 화면의 정보 구조와 사용자 여정에 대해 이야기 하려고 하는데 여기 보시면 사용자의 여정을 단순화 시키는 게 우선이라는 생각이 들어서
                                    </p>
                                </div>

                                <div class="ai-transcript-item">
                                    <div class="ai-transcript-meta">
                                        <span class="ai-transcript-time">00:03:03</span>
                                        <span class="ai-transcript-speaker">안정민</span>
                                    </div>
                                    <p class="ai-transcript-text">
                                        사용자의 여정을 단순화 하고 접근성을 높이는 방향으로 하는 게 좋겠다는 생각이 들어요.
                                    </p>
                                </div>

                                <div class="ai-transcript-item">
                                    <div class="ai-transcript-meta">
                                        <span class="ai-transcript-time">00:03:36</span>
                                        <span class="ai-transcript-speaker">김지민</span>
                                    </div>
                                    <p class="ai-transcript-text">
                                        메인화면에서 사용자가 조금 더 쉽게 AI요약 정리와 회의를 진행 할 수 있게끔 제작하면 될 거 같아요.
                                    </p>
                                </div>

                                <div class="ai-transcript-item">
                                    <div class="ai-transcript-meta">
                                        <span class="ai-transcript-time">00:04:30</span>
                                        <span class="ai-transcript-speaker">이규빈</span>
                                    </div>
                                    <p class="ai-transcript-text">
                                        메인화면 구성을 디자인적으로 다시 확인해서 말씀하신대로 수정한 후에 공유드릴게요.
                                    </p>
                                </div>

                            </div>

                        </div>


                        <button class="ai-transcript-more-button">
                            전체 채팅 보기
                        </button>

                    </section>


                    <!-- AI 요약 결과 -->

                    <section class="panel ai-summary-section">

                        <div class="ai-summary-title">
                            AI 요약 결과
                        </div>

                        <div class="ai-summary-tabs">
                            <button class="ai-summary-tab active" data-tab="core">핵심요약</button>
                            <button class="ai-summary-tab" data-tab="detail">상세요약</button>
                            <button class="ai-summary-tab" data-tab="topic">주제별요약</button>
                        </div>


                        <div class="ai-summary-body">

                            <div class="ai-summary-left">

                                <p class="ai-summary-paragraph">
                                    이번 회의에서는 메인 화면의 UI/UX 개선 방향과 정보 구조 재설계에 대해 논의했습니다. 사용자의 여정을 단순화하고 핵심기능 및 접근성을 높이는 것을 목표로 하며, 디자인 시스템 정리와 사용자 테스트 계획도 함께 진행하기로 하였습니다.
                                </p>

                                <div class="ai-checklist-title">주요 논의 사항</div>

                                <ul class="ai-checklist">
                                    <li><i data-lucide="check"></i>정보 구조를 명확하게 재정의</li>
                                    <li><i data-lucide="check"></i>사용자 여정 단순화를 통한 사용성 개선</li>
                                    <li><i data-lucide="check"></i>핵심 기능의 접근성 향상 및 우선순위 재배치</li>
                                    <li><i data-lucide="check"></i>디자인 시스템 정리 및 일관성 유지</li>
                                    <li><i data-lucide="check"></i>사용자 테스트 계획 수립</li>
                                </ul>

                                <div class="ai-action-buttons">

                                    <button class="ai-action-button">
                                        <i data-lucide="copy"></i>
                                        복사
                                    </button>

                                    <button class="ai-action-button">
                                        <i data-lucide="download"></i>
                                        PDF 다운로드
                                    </button>

                                    <button class="ai-action-button">
                                        <i data-lucide="file-text"></i>
                                        요약 문서로 변환
                                    </button>

                                    <button class="ai-action-button ai-action-button-primary">
                                        <i data-lucide="share-2"></i>
                                        공유하기
                                    </button>

                                </div>

                            </div>


                            <aside class="meeting-info">

                                <div class="meeting-info-title">
                                    회의 정보
                                </div>

                                <div class="meeting-info-item">
                                    <i data-lucide="key-round"></i>
                                    <span>회의명</span>
                                    <span class="meeting-info-value">UI/UX 피드백 회의</span>
                                </div>

                                <div class="meeting-info-item">
                                    <i data-lucide="clipboard-list"></i>
                                    <span>회의 주제</span>
                                    <span class="meeting-info-value">메인화면의 정보 구조와 사용자 여정</span>
                                </div>

                                <div class="meeting-info-item">
                                    <i data-lucide="users"></i>
                                    <span>참석자</span>
                                    <span class="meeting-info-avatars">
                                        <i data-lucide="circle-user"></i>
                                        <i data-lucide="circle-user"></i>
                                        <i data-lucide="circle-user"></i>
                                    </span>
                                </div>

                                <div class="meeting-info-item">
                                    <i data-lucide="play-circle"></i>
                                    <span>회의 시간</span>
                                    <span class="meeting-info-value">2026.09.06 · 11:30 AM ~ 13:00PM</span>
                                </div>

                                <div class="meeting-info-item">
                                    <i data-lucide="clock"></i>
                                    <span>생성 시간</span>
                                    <span class="meeting-info-value">11:25AM</span>
                                </div>

                            </aside>

                        </div>

                    </section>

                </div>


                <!-- 회의 목록 -->

                <aside class="panel ai-meeting-list-panel">

                    <div class="section-head"><h2>회의 목록</h2></div>

                    <div class="ai-meeting-list">

                        <div class="meeting-card-row">
                            <div class="meeting-card-row-top">
                                <span class="title">10월 스프린트 리뷰</span>
                                <span class="status-pill progress">진행중</span>
                            </div>
                            <div class="meeting-card-row-bottom">
                                <span class="date">2026.09.06 10:00AM</span>
                                <span class="attendees">
                                    <i data-lucide="circle-user"></i>
                                    <i data-lucide="circle-user"></i>
                                    <i data-lucide="circle-user"></i>
                                    +2
                                </span>
                                <span class="ai-icon"><span class="progress-ring"></span></span>
                            </div>
                        </div>

                        <div class="meeting-card-row">
                            <div class="meeting-card-row-top">
                                <span class="title">10월 스프린트 리뷰</span>
                                <span class="status-pill done">완료</span>
                            </div>
                            <div class="meeting-card-row-bottom">
                                <span class="date">2026.09.06 10:00AM</span>
                                <span class="attendees">
                                    <i data-lucide="circle-user"></i>
                                    <i data-lucide="circle-user"></i>
                                    <i data-lucide="circle-user"></i>
                                    +2
                                </span>
                                <span class="ai-icon"><i data-lucide="check-circle"></i></span>
                            </div>
                        </div>

                        <div class="meeting-card-row">
                            <div class="meeting-card-row-top">
                                <span class="title">10월 스프린트 리뷰</span>
                                <span class="status-pill done">완료</span>
                            </div>
                            <div class="meeting-card-row-bottom">
                                <span class="date">2026.09.06 10:00AM</span>
                                <span class="attendees">
                                    <i data-lucide="circle-user"></i>
                                    <i data-lucide="circle-user"></i>
                                    <i data-lucide="circle-user"></i>
                                    +2
                                </span>
                                <span class="ai-icon"><i data-lucide="check-circle"></i></span>
                            </div>
                        </div>

                        <div class="meeting-card-row">
                            <div class="meeting-card-row-top">
                                <span class="title">10월 스프린트 리뷰</span>
                                <span class="status-pill progress">진행중</span>
                            </div>
                            <div class="meeting-card-row-bottom">
                                <span class="date">2026.09.06 10:00AM</span>
                                <span class="attendees">
                                    <i data-lucide="circle-user"></i>
                                    <i data-lucide="circle-user"></i>
                                    <i data-lucide="circle-user"></i>
                                    +2
                                </span>
                                <span class="ai-icon"><span class="progress-ring"></span></span>
                            </div>
                        </div>

                        <div class="meeting-card-row">
                            <div class="meeting-card-row-top">
                                <span class="title">10월 스프린트 리뷰</span>
                                <span class="status-pill progress">진행중</span>
                            </div>
                            <div class="meeting-card-row-bottom">
                                <span class="date">2026.09.06 10:00AM</span>
                                <span class="attendees">
                                    <i data-lucide="circle-user"></i>
                                    <i data-lucide="circle-user"></i>
                                    <i data-lucide="circle-user"></i>
                                    +2
                                </span>
                                <span class="ai-icon"><span class="progress-ring"></span></span>
                            </div>
                        </div>

                        <div class="meeting-card-row">
                            <div class="meeting-card-row-top">
                                <span class="title">10월 스프린트 리뷰</span>
                                <span class="status-pill done">완료</span>
                            </div>
                            <div class="meeting-card-row-bottom">
                                <span class="date">2026.09.06 10:00AM</span>
                                <span class="attendees">
                                    <i data-lucide="circle-user"></i>
                                    <i data-lucide="circle-user"></i>
                                    <i data-lucide="circle-user"></i>
                                    +2
                                </span>
                                <span class="ai-icon"><i data-lucide="check-circle"></i></span>
                            </div>
                        </div>

                    </div>

                </aside>

            </div>

        `;


        /* 영상 탭 전환 */

        initAiTabs();


        /* 요약 결과 탭 전환 */

        initAiSummaryTabs();


        /* 신규 액션 버튼 (데모) */

        const transcriptMoreButton = document.querySelector(".ai-transcript-more-button");

        if (transcriptMoreButton) {

            transcriptMoreButton.addEventListener("click", () => {
                alert("전체 채팅 보기 기능은 준비 중입니다.");
            });

        }

        document.querySelectorAll(".ai-action-button").forEach(button => {

            button.addEventListener("click", () => {

                const label = button.textContent.trim();
                alert(`"${label}" 기능은 준비 중입니다.`);

            });

        });


        /* Lucide 아이콘 생성 */

        if (typeof lucide !== "undefined") {
            lucide.createIcons();
        }

    }


    else if (page === "calendar") {

        loadPageFragment("pages/calendar.html", initCalendarPage);

    }


    else if (page === "member") {

        loadPageFragment("pages/member.html", initMemberPage);

    }




    else if (page === "setting") {

        loadPageFragment("pages/setting.html", initSettingPage);

    }

}


/* =========================================
   그룹 추가 모달로 새로 생긴 그룹

   TODO: 실제 백엔드 연결 시,
   서버에서 내 그룹 목록을 받아와 렌더링하는 방식으로 교체.
   지금은 새로고침하면 사라지는 데모 상태(메모리)입니다.
========================================= */

let addedGroups = [];


function buildGroupCardHtml(name, initial) {

    return `
        <div class="group-card" data-action="open-group-detail" data-group-name="${name}" data-group-initial="${initial}">
            <div class="badge">${initial}</div>
            <div class="name">${name}</div>
        </div>
    `;

}


/* 그룹 추가 모달에서 생성/참여 성공 시 호출 */

function addGroupCard(name, initial) {

    addedGroups.push({ name: name, initial: initial });


    const track = document.querySelector(".group-cards");

    if (track) {

        track.insertAdjacentHTML("afterbegin", buildGroupCardHtml(name, initial));

        if (typeof lucide !== "undefined") {
            lucide.createIcons();
        }

    }

}


/* 메인 페이지를 다시 그릴 때, 이미 추가했던 그룹 카드들을 복원 */

function renderAddedGroupCards() {

    const track = document.querySelector(".group-cards");

    if (!track) {
        return;
    }

    addedGroups.forEach(group => {

        track.insertAdjacentHTML(
            "afterbegin",
            buildGroupCardHtml(group.name, group.initial)
        );

    });

}


/* =========================================
   그룹 캐러셀 좌우 스크롤
========================================= */

function initSlider() {

    const track =
        document.querySelector(".group-cards");

    const prevButton =
        document.querySelector(".prev-button");

    const nextButton =
        document.querySelector(".next-button");


    if (!track || !prevButton || !nextButton) {
        return;
    }


    /* 이전 */

    prevButton.addEventListener("click", () => {

        track.scrollBy({
            left: -420,
            behavior: "smooth"
        });

    });


    /* 다음 */

    nextButton.addEventListener("click", () => {

        track.scrollBy({
            left: 420,
            behavior: "smooth"
        });

    });

}


/* =========================================
   미니 캘린더 (일주일 보기)
========================================= */

function initMiniCalendar() {

    const container = document.getElementById("miniWeek");

    if (!container) {
        return;
    }

    const weeks = [
        { label: "Sun", dates: [30, 6, 13, 20, 27], disabled: [true, false, false, false, false] },
        { label: "Mon", dates: [31, 7, 14, 21, 28], disabled: [true, false, false, false, false] },
        { label: "Tue", dates: [1, 8, 15, 22, 29], disabled: [false, false, false, false, false] },
        { label: "Wed", dates: [2, 9, 16, 23, 30], disabled: [false, false, false, false, false] },
        { label: "Thu", dates: [3, 10, 17, 24, 1], disabled: [false, false, false, false, true] },
        { label: "Fri", dates: [4, 11, 18, 25, 2], disabled: [false, false, false, false, true] },
        { label: "Sat", dates: [5, 12, 19, 26, 3], disabled: [false, false, false, false, true] }
    ];

    weeks.forEach(col => {

        const colEl = document.createElement("div");
        colEl.className = "day-col";

        const label = document.createElement("div");
        label.className = "day-label";
        label.textContent = col.label;
        colEl.appendChild(label);

        col.dates.forEach((d, i) => {

            const num = document.createElement("div");
            num.className = "date-num" + (col.disabled[i] ? " disabled" : "");

            if (col.label === "Sun" && d === 6) {
                num.classList.add("today");
            }

            num.textContent = d;
            colEl.appendChild(num);

        });

        container.appendChild(colEl);

    });

}


/* =========================================
   AI 요약 - 요약 결과 탭 전환
========================================= */

const aiSummaryContents = {

    core: "이번 회의에서는 메인 화면의 UI/UX 개선 방향과 정보 구조 재설계에 대해 논의했습니다. 사용자의 여정을 단순화하고 핵심기능 및 접근성을 높이는 것을 목표로 하며, 디자인 시스템 정리와 사용자 테스트 계획도 함께 진행하기로 하였습니다.",

    detail: "김소연 님이 메인 화면의 정보 구조와 사용자 여정 문제를 제기했고, 안정민 님은 접근성 향상 방향에 공감했습니다. 김지민 님은 AI 요약 진입 흐름을 더 쉽게 만들자고 제안했으며, 이규빈 님이 디자인 수정 후 공유하기로 했습니다.",

    topic: "① 정보 구조: 메인 화면 계층 재정의 · ② 사용자 여정: 핵심 흐름 단순화 · ③ 접근성: 주요 기능 우선순위 재배치 · ④ 디자인 시스템: 컴포넌트 일관성 정리 · ⑤ QA: 사용자 테스트 계획 수립"

};

function initAiSummaryTabs() {

    const summaryTabs =
        document.querySelectorAll(".ai-summary-tab");

    const summaryParagraph =
        document.querySelector(".ai-summary-paragraph");

    summaryTabs.forEach(tab => {

        tab.addEventListener("click", () => {

            summaryTabs.forEach(item => {
                item.classList.remove("active");
            });

            tab.classList.add("active");

            if (summaryParagraph) {

                summaryParagraph.textContent =
                    aiSummaryContents[tab.dataset.tab] || aiSummaryContents.core;

            }

        });

    });

}


/* =========================================
   AI 요약 - 영상 탭 전환
========================================= */

function initAiTabs() {

    const videoTabs =
        document.querySelectorAll(".video-tab");

    videoTabs.forEach(tab => {

        tab.addEventListener("click", () => {

            videoTabs.forEach(item => {
                item.classList.remove("active");
            });

            tab.classList.add("active");

        });

    });

}


/* =========================================
   fetch 기반 페이지 로더
   (문서 / 캘린더 / 팀원 / 설정 공통)
========================================= */

function loadPageFragment(url, afterInit) {

    fetch(url)
        .then(response => response.text())
        .then(html => {

            content.innerHTML = html;

            if (typeof lucide !== "undefined") {
                lucide.createIcons();
            }

            if (typeof afterInit === "function") {
                afterInit();
            }

        })
        .catch(error => {

            content.innerHTML = `
                <div class="page">
                    <div class="page-header">
                        <h1>페이지를 불러오지 못했어요.</h1>
                    </div>
                </div>
            `;

            console.error("페이지 로드 실패:", url, error);

        });

}




/* =========================================
   왼쪽 메뉴 클릭
========================================= */

menus.forEach(menu => {

    menu.addEventListener("click", () => {

        const page = menu.dataset.page;


        /* 현재 메뉴 표시 */

        menus.forEach(item => {
            item.classList.remove("active");
        });


        menu.classList.add("active");


        /* 페이지 변경 */

        showPage(page);

    });

});


/* =========================================
   메인 내부 버튼 클릭
========================================= */

content.addEventListener("click", event => {

    /* 그룹 추가 모달 트리거 */

    const actionButton =
        event.target.closest("[data-action]");

    if (actionButton && actionButton.dataset.action === "open-group-modal") {

        if (typeof openGroupModal === "function") {
            openGroupModal();
        }

        return;

    }


    /* 그룹 카드 클릭 -> 그룹 상세 페이지 */

    if (actionButton && actionButton.dataset.action === "open-group-detail") {

        const groupName = actionButton.dataset.groupName || "그룹";
        const groupInitial = actionButton.dataset.groupInitial || groupName.charAt(0);

        if (typeof openGroupDetailPage === "function") {
            openGroupDetailPage(groupName, groupInitial);
        }

        return;

    }


    const button =
        event.target.closest("[data-page]");


    if (!button) {
        return;
    }


    event.preventDefault();


    const page =
        button.dataset.page;


    /* 왼쪽 메뉴 상태 변경 */

    menus.forEach(menu => {

        menu.classList.remove("active");


        if (menu.dataset.page === page) {

            menu.classList.add("active");

        }

    });


    /* 페이지 이동 */

    showPage(page);

});


/* =========================================
   처음 페이지
========================================= */

showPage("main");