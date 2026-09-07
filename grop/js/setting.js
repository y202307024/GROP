/* =========================================
   설정 페이지
   main.js가 pages/setting.html을 #content에
   삽입한 뒤 initSettingPage()를 호출합니다.
========================================= */

function initSettingPage() {

    const logoutButton = document.getElementById("settingsLogoutButton");

    if (logoutButton) {

        logoutButton.addEventListener("click", () => {

            window.location.href = "login.html";

        });

    }

}
