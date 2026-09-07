/* =========================================
   그룹 편집 모달
========================================= */

const groupEditModalOverlay = document.getElementById("groupEditModalOverlay");
const groupEditCloseButton = document.getElementById("groupEditCloseButton");
const groupEditCancelButton = document.getElementById("groupEditCancelButton");
const groupEditSaveButton = document.getElementById("groupEditSaveButton");

const groupEditAvatarPreview = document.getElementById("groupEditAvatarPreview");
const groupEditPhotoButton = document.getElementById("groupEditPhotoButton");
const groupEditPhotoInput = document.getElementById("groupEditPhotoInput");

const groupEditNameInput = document.getElementById("groupEditNameInput");
const groupEditMemoInput = document.getElementById("groupEditMemoInput");


let groupEditAvatarHtml = "D";


/* =========================================
   열기 / 닫기
========================================= */

function openGroupEditModal(group) {

    groupEditNameInput.value = group.name;
    groupEditMemoInput.value = group.memo;

    groupEditAvatarHtml = group.initial;
    groupEditAvatarPreview.innerHTML = group.initial;


    groupEditModalOverlay.hidden = false;

    if (typeof lucide !== "undefined") {
        lucide.createIcons();
    }

}

function closeGroupEditModal() {

    groupEditModalOverlay.hidden = true;

}


groupEditCloseButton.addEventListener("click", closeGroupEditModal);
groupEditCancelButton.addEventListener("click", closeGroupEditModal);

groupEditModalOverlay.addEventListener("click", (event) => {

    if (event.target === groupEditModalOverlay) {
        closeGroupEditModal();
    }

});

document.addEventListener("keydown", (event) => {

    if (event.key === "Escape" && !groupEditModalOverlay.hidden) {
        closeGroupEditModal();
    }

});


/* =========================================
   대표 이미지 변경
========================================= */

groupEditPhotoButton.addEventListener("click", () => {

    groupEditPhotoInput.click();

});

groupEditPhotoInput.addEventListener("change", () => {

    const file = groupEditPhotoInput.files[0];

    if (!file) {
        return;
    }

    const reader = new FileReader();

    reader.onload = () => {

        groupEditAvatarHtml = `<img src="${reader.result}" alt="그룹 대표 이미지">`;

        groupEditAvatarPreview.innerHTML = groupEditAvatarHtml;

    };

    reader.readAsDataURL(file);

});


/* =========================================
   저장하기

   TODO: 실제 백엔드 연결 시,
   그룹 정보/멤버 권한을 서버에 저장하는 요청으로 교체
========================================= */

groupEditSaveButton.addEventListener("click", () => {

    const name = groupEditNameInput.value.trim();

    if (name === "") {

        groupEditNameInput.focus();
        return;

    }

    const memo = groupEditMemoInput.value.trim();


    if (typeof updateGroupDetailDisplay === "function") {

        updateGroupDetailDisplay(name, groupEditAvatarHtml, memo);

    }


    closeGroupEditModal();

});
