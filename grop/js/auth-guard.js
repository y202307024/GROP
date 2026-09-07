/* =========================================
   보호된 페이지 접근 가드 (데모)

   실제 세션이 없는 프론트엔드 프로토타입이라
   localStorage의 데모 로그인 플래그로만 판단합니다.
   (실서비스에서는 Supabase 세션 체크로 대체)

   비로그인 상태면 로그인 페이지로 보내면서
   "지금 가려던 페이지" 경로를 ?redirect= 로 남기고,
   로그인 성공 후 login.js가 이 값을 읽어 되돌려보냅니다.
========================================= */

(function () {

    if (typeof isDemoLoggedIn !== "function" || isDemoLoggedIn()) {
        return;
    }

    const currentPath =
        window.location.pathname.split("/").pop() || "main.html";

    window.location.href =
        "login.html?redirect=" + encodeURIComponent(currentPath);

})();
