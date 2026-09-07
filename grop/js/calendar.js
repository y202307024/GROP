/* =========================================
   캘린더 페이지
   main.js가 pages/calendar.html을 #content에
   삽입한 뒤 initCalendarPage()를 호출합니다.
========================================= */

let calendarViewDate = new Date();

/* 데모용 일정 (일 -> 회의 제목 배열) */
const calendarSampleEvents = {
    3: ["팀 주간 회의"],
    9: ["디자인 회의"],
    15: ["UI/UX 피드백 회의", "마케팅 회의"],
    22: ["프로젝트 킥오프"]
};


function initCalendarPage() {

    calendarViewDate = new Date();

    drawCalendarGrid();


    document.getElementById("calendarPrevButton")
        .addEventListener("click", () => {

            calendarViewDate.setMonth(calendarViewDate.getMonth() - 1);
            drawCalendarGrid();

        });

    document.getElementById("calendarNextButton")
        .addEventListener("click", () => {

            calendarViewDate.setMonth(calendarViewDate.getMonth() + 1);
            drawCalendarGrid();

        });

    document.getElementById("calendarTodayButton")
        .addEventListener("click", () => {

            calendarViewDate = new Date();
            drawCalendarGrid();

        });

}


function drawCalendarGrid() {

    const year = calendarViewDate.getFullYear();
    const month = calendarViewDate.getMonth();

    const today = new Date();

    const monthLabel = document.getElementById("calendarMonthLabel");
    const grid = document.getElementById("calendarGrid");

    if (!monthLabel || !grid) {
        return;
    }

    monthLabel.textContent = `${year}년 ${month + 1}월`;


    const weekdayNames = ["일", "월", "화", "수", "목", "금", "토"];

    let html = "";

    weekdayNames.forEach(name => {
        html += `<div class="calendar-weekday">${name}</div>`;
    });


    const firstDayOfMonth = new Date(year, month, 1);
    const startWeekday = firstDayOfMonth.getDay();

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const totalCells = 42;


    for (let i = 0; i < totalCells; i++) {

        const dayOffset = i - startWeekday + 1;

        let cellDate;
        let isOtherMonth = false;

        if (dayOffset < 1) {

            cellDate = daysInPrevMonth + dayOffset;
            isOtherMonth = true;

        } else if (dayOffset > daysInMonth) {

            cellDate = dayOffset - daysInMonth;
            isOtherMonth = true;

        } else {

            cellDate = dayOffset;

        }


        const isToday =
            !isOtherMonth &&
            cellDate === today.getDate() &&
            month === today.getMonth() &&
            year === today.getFullYear();


        const events =
            (!isOtherMonth && calendarSampleEvents[cellDate])
                ? calendarSampleEvents[cellDate]
                : [];


        const classes = [
            "calendar-day",
            isOtherMonth ? "is-other-month" : "",
            isToday ? "is-today" : ""
        ].filter(Boolean).join(" ");


        const eventsHtml = events
            .map(title => `<span class="calendar-event">${title}</span>`)
            .join("");


        html += `
            <div class="${classes}">
                <span class="day-number">${cellDate}</span>
                ${eventsHtml}
            </div>
        `;

    }


    grid.innerHTML = html;


    if (typeof lucide !== "undefined") {
        lucide.createIcons();
    }

}
