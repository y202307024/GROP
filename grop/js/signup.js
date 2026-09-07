/* =========================================
   회원가입 폼
========================================= */

const signupNameInput = document.getElementById("name");
const signupEmailInput = document.getElementById("email");
const signupPasswordInput = document.getElementById("password");
const signupPasswordConfirmInput = document.getElementById("password-confirm");
const signupAgreementInput = document.getElementById("agreement");

const signupPasswordHelp = document.getElementById("passwordHelp");
const signupMessage = document.getElementById("signupMessage");
const signupButton = document.getElementById("signupButton");


/* =========================================
   메시지 표시 helper
========================================= */

function showSignupMessage(text, type) {

    signupMessage.textContent = text;

    signupMessage.classList.remove("is-success");

    if (type === "success") {
        signupMessage.classList.add("is-success");
    }

}


/* =========================================
   실제 회원가입 요청 (데모)

   TODO: 백엔드(Supabase 등) 연결 시,
   아래 setTimeout 부분을
   supabase.auth.signUp({ email, password }) 호출로 교체하고,
   실패 시 .catch(err => showSignupMessage(translateAuthError(err), "error"))
   형태로 바꾸면 됩니다.
========================================= */

function mockSignupRequest(email, password) {

    return new Promise((resolve, reject) => {

        setTimeout(() => {

            // 데모 환경: 항상 성공 처리
            resolve({ email });

        }, 500);

    });

}


/* =========================================
   회원가입 버튼 클릭
========================================= */

signupButton.addEventListener("click", () => {

    const name = signupNameInput.value.trim();
    const email = signupEmailInput.value.trim();
    const password = signupPasswordInput.value;
    const passwordConfirm = signupPasswordConfirmInput.value;

    showSignupMessage("");
    signupPasswordHelp.classList.remove("is-error");


    /* 이름 검사 */

    if (name === "") {

        showSignupMessage("이름을 입력해주세요.");
        signupNameInput.focus();
        return;

    }


    /* 이메일 검사 */

    if (email === "") {

        showSignupMessage("이메일을 입력해주세요.");
        signupEmailInput.focus();
        return;

    }

    if (!isValidEmail(email)) {

        showSignupMessage("올바른 이메일 형식을 입력해주세요.");
        signupEmailInput.focus();
        return;

    }


    /* 비밀번호 검사 (6자 이상) */

    if (!isValidPassword(password)) {

        showSignupMessage("비밀번호는 6자 이상이어야 해요.");
        signupPasswordHelp.classList.add("is-error");
        signupPasswordInput.focus();
        return;

    }


    /* 비밀번호 확인 검사 */

    if (password !== passwordConfirm) {

        showSignupMessage("비밀번호가 일치하지 않아요.");
        signupPasswordConfirmInput.focus();
        return;

    }


    /* 약관 동의 검사 */

    if (!signupAgreementInput.checked) {

        showSignupMessage("서비스 이용약관 및 개인정보 처리방침에 동의해주세요.");
        return;

    }


    /* =====================================
       여기까지 통과하면 가입 요청 진행
    ====================================== */

    signupButton.disabled = true;
    signupButton.textContent = "가입 처리 중...";


    mockSignupRequest(email, password)
        .then(() => {

            /* 이메일 인증 안내 */

            showSignupMessage(
                `가입 신청이 완료됐어요! ${email}로 인증 메일을 보냈어요. 메일함을 확인해주세요.`,
                "success"
            );

            signupButton.textContent = "가입 완료";

        })
        .catch((error) => {

            showSignupMessage(translateAuthError(error));

            signupButton.disabled = false;
            signupButton.textContent = "회원가입 완료하기";

        });

});


/* =========================================
   소셜 회원가입 (준비 중)

   TODO: 실제 OAuth 앱(구글 클라이언트 ID, 깃허브 OAuth App)과
   Supabase 프로젝트 연결 후 리다이렉트 방식으로 교체.
   구글은 페이지 진입 시 One Tap 자동 팝업도 함께 붙일 예정.
========================================= */

document.getElementById("googleSignup")
    .addEventListener("click", () => {

        alert("Google 회원가입 기능은 준비 중입니다.");

    });

document.getElementById("githubSignup")
    .addEventListener("click", () => {

        alert("GitHub 회원가입 기능은 준비 중입니다.");

    });
