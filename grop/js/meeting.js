/* =========================
   Lucide 아이콘
========================= */

if (typeof lucide !== "undefined") {
    lucide.createIcons();
}


/* =========================
   채팅
========================= */

const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatMessages = document.getElementById("chatMessages");


chatForm.addEventListener("submit", function (event) {

    event.preventDefault();

    const message = chatInput.value.trim();

    // 아무것도 입력하지 않았으면 전송하지 않음
    if (message === "") {
        return;
    }


    // 메시지 생성
    // (지금 전송하는 사람은 항상 '나'이므로 own-message로 오른쪽 정렬.
    //  나중에 서버 연동 시, 다른 참가자 메시지는 이 클래스 없이 추가하면 왼쪽에 표시됩니다)
    const messageElement = document.createElement("div");

    messageElement.classList.add("chat-message", "own-message");

    messageElement.textContent = message;


    // 채팅창에 추가
    chatMessages.appendChild(messageElement);


    // 입력창 비우기
    chatInput.value = "";


    // 가장 최근 메시지가 보이도록 스크롤
    chatMessages.scrollTop = chatMessages.scrollHeight;


    // 다시 입력창에 포커스
    chatInput.focus();

});


/* =========================
   그리기 도구 선택
========================= */

const toolButtons = document.querySelectorAll(".tool-button");

toolButtons.forEach(button => {

    button.addEventListener("click", () => {

        toolButtons.forEach(item => {
            item.classList.remove("active");
        });

        button.classList.add("active");

    });

});


/* =========================
   마이크 켜기/끄기
========================= */

const micButton = document.getElementById("micButton");

if (micButton) {

    micButton.addEventListener("click", () => {

        micButton.classList.toggle("active");

    });

}


/* =========================
   회의 경과 시간

   TODO: 실제 회의 시작 시점을 서버에서 받아오면
   그 시각을 기준으로 계산하도록 교체
========================= */

const meetingTimerEl = document.getElementById("meetingTimer");

let elapsedSeconds = 0;

function formatElapsedTime(totalSeconds) {

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${minutes}:${String(seconds).padStart(2, "0")}`;

}

if (meetingTimerEl) {

    setInterval(() => {

        elapsedSeconds++;

        meetingTimerEl.textContent = "· " + formatElapsedTime(elapsedSeconds);

    }, 1000);

}


/* =========================
   채팅 접기 / 펼치기
========================= */

const chatPanel = document.getElementById("chatPanel");
const chatCollapseTab = document.getElementById("chatCollapseTab");

if (chatPanel && chatCollapseTab) {

    chatCollapseTab.addEventListener("click", () => {

        const isCollapsed = chatPanel.classList.toggle("is-collapsed");

        chatCollapseTab.textContent = isCollapsed ? "«" : "»";

    });

}


/* =========================
   녹화 시작 / 종료
========================= */

const recordButton = document.getElementById("recordButton");

if (recordButton) {

    recordButton.addEventListener("click", () => {

        recordButton.classList.toggle("is-recording");

    });

}


/* =========================
   나가기
========================= */

const leaveButton = document.getElementById("leaveButton");

if (leaveButton) {

    leaveButton.addEventListener("click", () => {

        window.location.href = "main.html";

    });

}