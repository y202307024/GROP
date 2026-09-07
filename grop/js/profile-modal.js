/* =========================================
   프로필 편집 모달
========================================= */

const profileModalOverlay = document.getElementById("profileModalOverlay");
const profileModalCloseButton = document.getElementById("profileModalCloseButton");
const profileCancelButton = document.getElementById("profileCancelButton");
const profileSaveButton = document.getElementById("profileSaveButton");

const profilePhotoPreview = document.getElementById("profilePhotoPreview");
const profileUploadButton = document.getElementById("profileUploadButton");
const profileRemoveButton = document.getElementById("profileRemoveButton");
const profilePhotoInput = document.getElementById("profilePhotoInput");

const avatarGrid = document.getElementById("avatarGrid");
const profileNicknameInput = document.getElementById("profileNicknameInput");

const topProfileButton = document.getElementById("topProfileButton");
const topProfileAvatar = document.getElementById("topProfileAvatar");


let hasUploadedPhoto = false;
let selectedAvatar = "🙂";


/* =========================================
   열기 / 닫기
========================================= */

function openProfileModal() {

    profileModalOverlay.hidden = false;

    if (typeof lucide !== "undefined") {
        lucide.createIcons();
    }

}

function closeProfileModal() {

    profileModalOverlay.hidden = true;

}


if (topProfileButton) {

    topProfileButton.addEventListener("click", openProfileModal);

}

profileModalCloseButton.addEventListener("click", closeProfileModal);
profileCancelButton.addEventListener("click", closeProfileModal);


/* 배경(오버레이) 클릭 시 닫기 */

profileModalOverlay.addEventListener("click", (event) => {

    if (event.target === profileModalOverlay) {
        closeProfileModal();
    }

});


/* ESC 키로 닫기 */

document.addEventListener("keydown", (event) => {

    if (event.key === "Escape" && !profileModalOverlay.hidden) {
        closeProfileModal();
    }

});


/* =========================================
   아바타 선택
========================================= */

avatarGrid.querySelectorAll(".avatar-option").forEach(button => {

    button.addEventListener("click", () => {

        avatarGrid.querySelectorAll(".avatar-option").forEach(item => {
            item.classList.remove("is-selected");
        });

        button.classList.add("is-selected");

        selectedAvatar = button.dataset.avatar;


        /* 아바타를 고르면 업로드된 사진 대신 아바타를 미리보기에 표시 */

        hasUploadedPhoto = false;

        profilePhotoPreview.innerHTML = selectedAvatar;

        profileRemoveButton.hidden = true;

    });

});


/* =========================================
   사진 업로드
========================================= */

profileUploadButton.addEventListener("click", () => {

    profilePhotoInput.click();

});

profilePhotoInput.addEventListener("change", () => {

    const file = profilePhotoInput.files[0];

    if (!file) {
        return;
    }

    const reader = new FileReader();

    reader.onload = () => {

        profilePhotoPreview.innerHTML =
            `<img src="${reader.result}" alt="프로필 사진">`;

        hasUploadedPhoto = true;

        profileRemoveButton.hidden = false;

    };

    reader.readAsDataURL(file);

});


/* =========================================
   사진 제거
========================================= */

profileRemoveButton.addEventListener("click", () => {

    hasUploadedPhoto = false;

    profilePhotoPreview.innerHTML = selectedAvatar;

    profileRemoveButton.hidden = true;

    profilePhotoInput.value = "";

});


/* =========================================
   저장하기

   TODO: 실제 백엔드 연결 시 이 부분에서
   프로필 정보를 서버에 저장하는 요청으로 교체
========================================= */

profileSaveButton.addEventListener("click", () => {

    const nickname = profileNicknameInput.value.trim();

    if (nickname === "") {

        profileNicknameInput.focus();
        return;

    }


    /* 사이드바 + 상단 프로필 아이콘에 즉시 반영 (데모) */

    const sidebarAvatar = document.getElementById("sidebarAvatar");
    const sidebarNickname = document.getElementById("sidebarNickname");

    const currentAvatarHtml =
        hasUploadedPhoto
            ? profilePhotoPreview.innerHTML
            : selectedAvatar;

    if (sidebarAvatar) {

        sidebarAvatar.innerHTML = currentAvatarHtml;

    }

    if (sidebarNickname) {

        sidebarNickname.textContent = nickname;

    }

    if (topProfileAvatar) {

        topProfileAvatar.innerHTML = currentAvatarHtml;

    }


    closeProfileModal();

});
