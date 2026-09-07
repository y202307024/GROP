/* =========================================
   그룹 상세 페이지
========================================= */

let currentGroupDetail = {
    name: "디자인팀 그룹",
    initial: "D",
    memo: "매주 월요일 오후 2시 정기 회의가 있어요. 다들 화이팅!"
};


/* 메인 대시보드의 그룹 카드 클릭 시 호출 */

function openGroupDetailPage(groupName, groupInitial) {

    currentGroupDetail.name = groupName;
    currentGroupDetail.initial = groupInitial;

    loadPageFragment("pages/group-detail.html", initGroupDetailPage);

}


function initGroupDetailPage() {

    /* 그룹 이름/아바타/메모 반영 */

    document.getElementById("groupDetailName").textContent = currentGroupDetail.name;
    document.getElementById("groupDetailAvatar").innerHTML = currentGroupDetail.initial;
    document.getElementById("groupDetailMemo").textContent = "💬 " + currentGroupDetail.memo;


    /* 뒤로가기 -> 메인(내 그룹) 목록으로 */

    document.getElementById("groupDetailBackButton")
        .addEventListener("click", () => {

            menus.forEach(menu => {

                menu.classList.toggle(
                    "active",
                    menu.dataset.page === "main"
                );

            });

            showPage("main");

        });


    /* 초대코드 복사 */

    const copyButton = document.getElementById("groupDetailCopyButton");

    copyButton.addEventListener("click", () => {

        const inviteText =
            document.getElementById("groupDetailInviteCode").textContent;

        const code = inviteText.replace("초대코드", "").trim();


        if (navigator.clipboard && navigator.clipboard.writeText) {

            navigator.clipboard.writeText(code);

        }


        copyButton.classList.add("is-copied");

        setTimeout(() => {
            copyButton.classList.remove("is-copied");
        }, 1200);

    });


    /* 편집 아이콘 -> 그룹 편집 모달 */

    document.getElementById("groupDetailEditButton")
        .addEventListener("click", () => {

            if (typeof openGroupEditModal === "function") {
                openGroupEditModal(currentGroupDetail);
            }

        });


    /* 회의방으로 이동 */

    document.getElementById("groupDetailMeetingButton")
        .addEventListener("click", () => {

            window.location.href = "meeting.html";

        });

}


/* 편집 모달에서 저장 후 화면에 즉시 반영하기 위해 호출 */

function updateGroupDetailDisplay(name, initial, memo) {

    currentGroupDetail.name = name;
    currentGroupDetail.initial = initial;
    currentGroupDetail.memo = memo;

    const nameEl = document.getElementById("groupDetailName");
    const avatarEl = document.getElementById("groupDetailAvatar");
    const memoEl = document.getElementById("groupDetailMemo");

    if (nameEl) nameEl.textContent = name;
    if (avatarEl) avatarEl.innerHTML = initial;
    if (memoEl) memoEl.textContent = "💬 " + memo;

}
