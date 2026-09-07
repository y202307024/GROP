/* =========================================
   Lucide 아이콘
========================================= */

if (typeof lucide !== "undefined") {
    lucide.createIcons();
}


/* =========================================
   로그인 폼
========================================= */

const loginForm = document.getElementById("loginForm");

const emailInput = document.getElementById("email");

const passwordInput = document.getElementById("password");

const loginMessage = document.getElementById("loginMessage");



/* =========================================
   로그인
========================================= */

loginForm.addEventListener("submit", (event) => {

    event.preventDefault();


    const email =
        emailInput.value.trim();

    const password =
        passwordInput.value.trim();


    /* 기존 메시지 초기화 */

    loginMessage.textContent = "";



    /* 이메일 검사 */

    if (email === "") {

        loginMessage.textContent =
            "이메일을 입력해주세요.";

        emailInput.focus();

        return;
    }


    /* 이메일 형식 검사 */

    if (!isValidEmail(email)) {

        loginMessage.textContent =
            "올바른 이메일 형식을 입력해주세요.";

        emailInput.focus();

        return;
    }


    /* 비밀번호 검사 */

    if (password === "") {

        loginMessage.textContent =
            "비밀번호를 입력해주세요.";

        passwordInput.focus();

        return;
    }


    /* =====================================
       현재는 실제 서버 로그인 대신
       데모 로그인 처리 후,
       원래 가려던 페이지(또는 메인)로 이동
    ====================================== */

    const remember =
        document.getElementById("remember").checked;


    if (remember) {

        localStorage.setItem(
            "gropRememberEmail",
            email
        );

    } else {

        localStorage.removeItem(
            "gropRememberEmail"
        );

    }


    /* 데모용 로그인 상태 표시 (실서비스에서는 Supabase 세션으로 대체) */
    setDemoLoggedIn();


    window.location.href = getRedirectTarget("main.html");

});



/* =========================================
   저장된 이메일 불러오기
========================================= */

const savedEmail =
    localStorage.getItem("gropRememberEmail");


if (savedEmail) {

    emailInput.value = savedEmail;

    document.getElementById("remember").checked = true;

}



/* =========================================
   비밀번호 찾기
========================================= */

const findPassword =
    document.getElementById("findPassword");


findPassword.addEventListener("click", (event) => {

    event.preventDefault();

    alert(
        "비밀번호 찾기 기능은 준비 중입니다."
    );

});



/* =========================================
   Google 로그인
========================================= */

const googleLogin =
    document.getElementById("googleLogin");


googleLogin.addEventListener("click", () => {

    alert(
        "Google 로그인 기능은 준비 중입니다."
    );

});



/* =========================================
   GitHub 로그인
========================================= */

const githubLogin =
    document.getElementById("githubLogin");


githubLogin.addEventListener("click", () => {

    alert(
        "GitHub 로그인 기능은 준비 중입니다."
    );

});



/* =========================================
   회원가입
   (signup.html로 바로 이동하는 링크라
   별도 JS 처리가 필요 없습니다)
========================================= */