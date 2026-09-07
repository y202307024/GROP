/* =========================================
   팀원 페이지
   main.js가 pages/member.html을 #content에
   삽입한 뒤 initMemberPage()를 호출합니다.
========================================= */

function initMemberPage() {

    const inviteButton = document.querySelector(".page .primary-button");

    if (inviteButton) {

        inviteButton.addEventListener("click", () => {

            alert("멤버 초대 기능은 준비 중입니다.");

        });

    }


    const roleButtons = document.querySelectorAll(".member-row .text-button");

    roleButtons.forEach(button => {

        button.addEventListener("click", () => {

            alert("권한 변경 기능은 준비 중입니다.");

        });

    });

}
