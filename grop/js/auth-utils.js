/* =========================================
   GROP 인증 공통 유틸
   signup.js / login.js 가 함께 사용합니다.
========================================= */


/* 이메일 형식 검증 */

function isValidEmail(email) {

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    return emailPattern.test(email);

}


/* 비밀번호 길이 검증 (6자 이상) */

function isValidPassword(password) {

    return password.length >= 6;

}


/* =========================================
   Supabase 인증 에러 코드 -> 한글 안내 문구

   실제 Supabase 연동 전이라 지금은 쓰이지 않지만,
   나중에 supabase.auth.signUp() / signInWithPassword()
   호출의 .catch(err => showMessage(translateAuthError(err)))
   자리에 그대로 꽂아 쓸 수 있도록 미리 만들어둔 매핑표입니다.
========================================= */

const AUTH_ERROR_MESSAGES = {

    "invalid_credentials": "이메일 또는 비밀번호가 올바르지 않습니다.",
    "user_already_exists": "이미 가입된 이메일이에요. 로그인을 시도해보세요.",
    "email_not_confirmed": "이메일 인증이 아직 완료되지 않았어요. 메일함을 확인해주세요.",
    "weak_password": "비밀번호가 너무 간단해요. 6자 이상으로 설정해주세요.",
    "over_email_send_rate_limit": "인증 메일을 너무 많이 요청했어요. 잠시 후 다시 시도해주세요.",
    "network_error": "네트워크 연결을 확인해주세요."

};


function translateAuthError(error) {

    const code =
        (error && (error.code || error.error_code || error.message)) || "";

    const lowerCode = String(code).toLowerCase();

    for (const key in AUTH_ERROR_MESSAGES) {

        if (lowerCode.includes(key)) {

            return AUTH_ERROR_MESSAGES[key];

        }

    }

    return "알 수 없는 오류가 발생했어요. 잠시 후 다시 시도해주세요.";

}


/* =========================================
   로그인 성공 후 "원래 가려던 페이지"로 복귀

   보호된 페이지(main.html 등)에서
   비로그인 상태를 감지했을 때
   login.html?redirect=main.html 처럼 이동시키고,
   로그인 성공 시 이 값을 읽어 그 경로로 돌려보냅니다.
========================================= */

function getRedirectTarget(fallback) {

    const params = new URLSearchParams(window.location.search);

    const target = params.get("redirect");

    return target || fallback || "main.html";

}


/* =========================================
   데모용 로그인 상태 플래그

   실제 세션/쿠키가 없는 프론트엔드 전용 데모라서,
   localStorage에 최소한의 로그인 여부만 표시합니다.
   (실제 서비스에서는 Supabase 세션으로 대체됩니다)
========================================= */

function setDemoLoggedIn() {

    localStorage.setItem("gropDemoLoggedIn", "true");

}

function isDemoLoggedIn() {

    return localStorage.getItem("gropDemoLoggedIn") === "true";

}

function clearDemoLoggedIn() {

    localStorage.removeItem("gropDemoLoggedIn");

}
