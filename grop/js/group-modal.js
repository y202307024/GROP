/* =========================================
   그룹 추가 모달
========================================= */

const groupModalOverlay = document.getElementById("groupModalOverlay");
const groupModalCloseButton = document.getElementById("groupModalCloseButton");

const groupTabCreate = document.getElementById("groupTabCreate");
const groupTabJoin = document.getElementById("groupTabJoin");

const groupPanelCreate = document.getElementById("groupPanelCreate");
const groupPanelJoin = document.getElementById("groupPanelJoin");

const groupNameInput = document.getElementById("groupNameInput");
const groupCreateButton = document.getElementById("groupCreateButton");
const groupCreateMessage = document.getElementById("groupCreateMessage");

const inviteCodeInput = document.getElementById("inviteCodeInput");
const groupJoinButton = document.getElementById("groupJoinButton");
const groupJoinMessage = document.getElementById("groupJoinMessage");


/* =========================================
   열기 / 닫기
========================================= */

function openGroupModal() {

    groupModalOverlay.hidden = false;

    /* 매번 열 때마다 첫 번째 탭(그룹 만들기)으로 초기화 */

    switchGroupTab("create");

    groupNameInput.value = "";
    inviteCodeInput.value = "";

    showGroupMessage(groupCreateMessage, "");
    showGroupMessage(groupJoinMessage, "");


    if (typeof lucide !== "undefined") {
        lucide.createIcons();
    }

}

function closeGroupModal() {

    groupModalOverlay.hidden = true;

}

groupModalCloseButton.addEventListener("click", closeGroupModal);

groupModalOverlay.addEventListener("click", (event) => {

    if (event.target === groupModalOverlay) {
        closeGroupModal();
    }

});

document.addEventListener("keydown", (event) => {

    if (event.key === "Escape" && !groupModalOverlay.hidden) {
        closeGroupModal();
    }

});


/* =========================================
   탭 전환
========================================= */

function switchGroupTab(tab) {

    const isCreate = tab === "create";

    groupTabCreate.classList.toggle("is-active", isCreate);
    groupTabJoin.classList.toggle("is-active", !isCreate);

    groupPanelCreate.hidden = !isCreate;
    groupPanelJoin.hidden = isCreate;

}

groupTabCreate.addEventListener("click", () => switchGroupTab("create"));
groupTabJoin.addEventListener("click", () => switchGroupTab("join"));


/* =========================================
   메시지 표시 helper
========================================= */

function showGroupMessage(element, text, type) {

    element.textContent = text;

    element.classList.remove("is-success");

    if (type === "success") {
        element.classList.add("is-success");
    }

}


/* =========================================
   초대코드 입력 - 자동 대문자 변환
========================================= */

inviteCodeInput.addEventListener("input", () => {

    const cursorPosition = inviteCodeInput.selectionStart;

    inviteCodeInput.value = inviteCodeInput.value.toUpperCase();

    inviteCodeInput.setSelectionRange(cursorPosition, cursorPosition);

});


/* =========================================
   그룹 생성하기 (데모)

   TODO: 실제 백엔드 연결 시,
   그룹을 서버에 생성하는 요청으로 교체
========================================= */

groupCreateButton.addEventListener("click", () => {

    const groupName = groupNameInput.value.trim();

    if (groupName === "") {

        showGroupMessage(groupCreateMessage, "그룹 이름을 입력해주세요.");
        groupNameInput.focus();
        return;

    }


    showGroupMessage(
        groupCreateMessage,
        `"${groupName}" 그룹을 생성했어요!`,
        "success"
    );


    /* 메인 슬라이더에 새 그룹 카드 추가 */

    if (typeof addGroupCard === "function") {

        addGroupCard(groupName, groupName.charAt(0));

    }


    groupCreateButton.disabled = true;

    setTimeout(() => {

        groupCreateButton.disabled = false;
        closeGroupModal();

    }, 900);

});


/* =========================================
   초대코드로 참여하기 (데모)

   TODO: 실제 백엔드 연결 시,
   초대코드를 서버에서 검증하는 요청으로 교체.
   지금은 6자 이상이면 성공으로 처리하는 데모입니다.
========================================= */

groupJoinButton.addEventListener("click", () => {

    const code = inviteCodeInput.value.trim();

    if (code === "") {

        showGroupMessage(groupJoinMessage, "초대코드를 입력해주세요.");
        inviteCodeInput.focus();
        return;

    }

    if (code.length < 6) {

        showGroupMessage(groupJoinMessage, "초대코드는 6자 이상이어야 해요.");
        inviteCodeInput.focus();
        return;

    }


    /* 데모: 특정 코드는 실패 케이스로 보여줌 */

    if (code === "INVALID") {

        showGroupMessage(groupJoinMessage, "존재하지 않는 초대코드예요. 다시 확인해주세요.");
        return;

    }


    showGroupMessage(
        groupJoinMessage,
        `그룹에 참여했어요! (초대코드: ${code})`,
        "success"
    );


    /* 메인 슬라이더에 새 그룹 카드 추가
       (실제 백엔드 연결 시 초대코드로 조회한 진짜 그룹명으로 교체) */

    if (typeof addGroupCard === "function") {

        addGroupCard(`참여한 그룹 (${code})`, code.charAt(0));

    }


    groupJoinButton.disabled = true;

    setTimeout(() => {

        groupJoinButton.disabled = false;
        closeGroupModal();

    }, 900);

});
