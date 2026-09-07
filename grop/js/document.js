/* =========================================
   문서 페이지
   main.js가 pages/document.html을 #content에
   삽입한 뒤 initDocumentPage()를 호출합니다.
========================================= */

function initDocumentPage() {

    const newDocButton = document.querySelector(".page .primary-button");

    if (newDocButton) {

        newDocButton.addEventListener("click", () => {

            alert("새 문서 작성 기능은 준비 중입니다.");

        });

    }


    const openButtons = document.querySelectorAll(".doc-row .text-button");

    openButtons.forEach(button => {

        button.addEventListener("click", () => {

            alert("문서 상세 보기는 준비 중입니다.");

        });

    });

}
