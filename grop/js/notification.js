/* =========================================
   알림 드롭다운
========================================= */

const notificationButton = document.getElementById("notificationButton");
const notificationDropdown = document.getElementById("notificationDropdown");


function toggleNotificationDropdown() {

    notificationDropdown.hidden = !notificationDropdown.hidden;

}

function closeNotificationDropdown() {

    notificationDropdown.hidden = true;

}


notificationButton.addEventListener("click", (event) => {

    event.stopPropagation();

    toggleNotificationDropdown();

});


/* 드롭다운 안쪽 클릭은 닫히지 않도록 */

notificationDropdown.addEventListener("click", (event) => {

    event.stopPropagation();

});


/* 바깥 클릭 시 닫기 */

document.addEventListener("click", () => {

    closeNotificationDropdown();

});


/* ESC 키로 닫기 */

document.addEventListener("keydown", (event) => {

    if (event.key === "Escape" && !notificationDropdown.hidden) {
        closeNotificationDropdown();
    }

});
