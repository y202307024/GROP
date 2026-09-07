/* =========================
   Lucide 아이콘
========================= */

lucide.createIcons();


/* =========================
   영상 탭
========================= */

const videoTabs = document.querySelectorAll(".video-tab");

videoTabs.forEach(tab => {

    tab.addEventListener("click", () => {

        videoTabs.forEach(item => {
            item.classList.remove("active");
        });

        tab.classList.add("active");

    });

});