
        // --- [추가] 테마 초기화 로직 (새 시스템 연동) ---
        (function () {
            const savedTheme = localStorage.getItem('schoolAppsTheme');
            const systemPrefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            const theme = savedTheme ? savedTheme : (systemPrefersDark ? 'dark' : 'light');
            document.body.setAttribute('data-theme', theme);
            updateThemeButtonText(theme);
        })();

        // 페이지 로드 후 깜빡임 방지
        window.onload = function () {
            setTimeout(() => { document.body.classList.remove('preload'); }, 100);
        }

        const departments = ["1과", "2과", "3과", "4과"]; 
        let maxDays = 2; 
        let maxPeriods = 3; 
        let rawTeachers = [];

        let isDragging = false;
        let selectedCells = [];
        let dragStartInfo = null; 

        let lastAssignmentResults = null; // 가장 최근에 완료된 배정 결과 데이터
        let activeTeachersList = [];      // 배정 상태가 주입된 교사 목록


        // --- 1. 시간표 초기화 ---
        function initScheduleTable() {
            let html = `<table id="scheduleTable">`;
            html += `<thead><tr><th rowspan="2" style="width: 50px;">일차</th><th rowspan="2" style="width: 40px;">교시</th>`;
            html += `<th colspan="8" class="g1-header">1학년</th>`;
            html += `<th colspan="8" class="g2-header">2학년</th>`;
            html += `<th colspan="8" class="g3-header">3학년</th></tr><tr>`;
            
            for(let g=1; g<=3; g++) {
                for(let c=1; c<=8; c++) html += `<th>${c}반</th>`;
            }
            html += `</tr></thead><tbody>`;

            for(let d=1; d<=maxDays; d++) {
                for(let p=1; p<=maxPeriods; p++) {
                    let periodName = `${d}일차 ${p}교시`;
                    html += `<tr data-period="${periodName}">`;
                    if(p === 1) html += `<td rowspan="${maxPeriods}" style="font-weight:700; background:var(--bg-canvas); color:var(--text-secondary);">${d}일</td>`;
                    html += `<td style="color:var(--text-muted); background:var(--bg-app);">${p}</td>`;
                    
                    for(let g=1; g<=3; g++) {
                        for(let c=1; c<=8; c++) {
                            html += `<td class="exam-cell" data-grade="${g}" data-class="${c}" data-classes="${c}"></td>`;
                        }
                    }
                    html += `</tr>`;
                }
            }
            html += `</tbody></table>`;
            document.getElementById('scheduleTableContainer').innerHTML = html;
            attachDragEvents();

            // 설정값 변경 시 하단 출력 영역 초기화 및 전역 변수 리셋
            document.getElementById('mainOutput').innerHTML = `
                <div class="empty-state">
                    <svg class="empty-icon" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"></path>
                    </svg>
                    <h3>대기 중인 결과가 없습니다</h3>
                    <p>상단 패널의 절차에 따라 교사 명단을 업로드하고 배정 알고리즘을 가동하여 주십시오.</p>
                </div>
            `;
            lastAssignmentResults = null;
            activeTeachersList = [];
        }

        // --- 2. 1차원 보간(Interpolation) 드래그 및 모바일 터치 이벤트 바인딩 ---
        function attachDragEvents() {
            const table = document.getElementById('scheduleTable');

            // 마우스 이벤트 바인딩
            table.addEventListener('mousedown', (e) => {
                let cell = e.target.closest('.exam-cell');
                if(cell) {
                    isDragging = true;
                    const rowEle = cell.closest('tr');
                    const allCells = Array.from(rowEle.querySelectorAll('.exam-cell'));
                    dragStartInfo = {
                        rowEle: rowEle,
                        startX: allCells.indexOf(cell),
                        allCells: allCells
                    };
                    updateSelection(cell);
                }
            });

            table.addEventListener('mouseover', (e) => {
                if(!isDragging) return;
                let cell = e.target.closest('.exam-cell');
                if(cell) updateSelection(cell);
            });

            window.addEventListener('mouseup', () => {
                if(isDragging) {
                    isDragging = false;
                    if(selectedCells.length > 0) openModal();
                }
            });

            // [추가] 모바일 대응용 터치 제스처 이벤트 바인딩
            table.addEventListener('touchstart', (e) => {
                let touch = e.touches[0];
                let target = document.elementFromPoint(touch.clientX, touch.clientY);
                let cell = target ? target.closest('.exam-cell') : null;
                
                if(cell) {
                    // 터치 조작 시 브라우저 스크롤 바운스가 일어나는 것을 미연에 방지
                    e.preventDefault();
                    isDragging = true;
                    const rowEle = cell.closest('tr');
                    const allCells = Array.from(rowEle.querySelectorAll('.exam-cell'));
                    dragStartInfo = {
                        rowEle: rowEle,
                        startX: allCells.indexOf(cell),
                        allCells: allCells
                    };
                    updateSelection(cell);
                }
            }, { passive: false });

            table.addEventListener('touchmove', (e) => {
                if(!isDragging) return;
                e.preventDefault(); // 스크롤 무력화
                
                let touch = e.touches[0];
                let target = document.elementFromPoint(touch.clientX, touch.clientY);
                let cell = target ? target.closest('.exam-cell') : null;
                
                // 동일한 줄(Row) 범위 내에서 드래그 움직임 처리
                if(cell && dragStartInfo && cell.closest('tr') === dragStartInfo.rowEle) {
                    updateSelection(cell);
                }
            }, { passive: false });

            window.addEventListener('touchend', () => {
                if(isDragging) {
                    isDragging = false;
                    if(selectedCells.length > 0) openModal();
                }
            });
        }

        function updateSelection(currentHoverCell) {
            let currentRowCells = Array.from(currentHoverCell.closest('tr').querySelectorAll('.exam-cell'));
            let currentX = currentRowCells.indexOf(currentHoverCell);
            if (currentX === -1) return;

            const allCells = dragStartInfo.allCells;
            let minX = Math.min(dragStartInfo.startX, currentX);
            let maxX = Math.max(dragStartInfo.startX, currentX);

            let expanded = true;
            while(expanded) {
                expanded = false;
                for (let x = minX; x <= Math.min(maxX, allCells.length - 1); x++) {
                    let c = allCells[x];
                    if (c.style.display === 'none') {
                        let repX = x;
                        while(repX >= 0 && allCells[repX].style.display === 'none') repX--;
                        if (repX >= 0 && repX < minX) {
                            minX = repX;
                            expanded = true;
                        }
                    } else {
                        let classesLength = c.getAttribute('data-classes').split(',').length;
                        if (classesLength > 1) {
                            let cEndX = x + classesLength - 1;
                            if (cEndX > maxX) {
                                maxX = cEndX;
                                expanded = true;
                            }
                        }
                    }
                }
            }

            document.querySelectorAll('.exam-cell.selected').forEach(el => {
                el.classList.remove('selected', 'sel-left', 'sel-mid', 'sel-right', 'sel-single');
            });
            selectedCells = [];
            let visibleCells = [];

            for (let x = minX; x <= maxX; x++) {
                let c = allCells[x];
                selectedCells.push(c);
                if (c.style.display !== 'none') {
                    visibleCells.push(c);
                }
            }

            if (visibleCells.length === 1) {
                visibleCells[0].classList.add('selected', 'sel-single');
            } else if (visibleCells.length > 1) {
                visibleCells.forEach((c, idx) => {
                    c.classList.add('selected');
                    if (idx === 0) c.classList.add('sel-left');
                    else if (idx === visibleCells.length - 1) c.classList.add('sel-right');
                    else c.classList.add('sel-mid');
                });
            }
        }

        // --- 3. 모달 제어 ---
        function openModal() {
            const modal = document.getElementById('subjectModal');
            const input = document.getElementById('subjectInput');
            modal.classList.add('active');
            input.value = '';
            input.focus();
        }

        // --- 4. 셀 병합 및 분할 저장 ---
        function closeModal() {
            document.getElementById('subjectModal').classList.remove('active');
            document.querySelectorAll('.exam-cell.selected').forEach(el => {
                el.classList.remove('selected', 'sel-left', 'sel-mid', 'sel-right', 'sel-single');
            });
            selectedCells = [];
            dragStartInfo = null;
        }

        document.getElementById('subjectModal').addEventListener('mousedown', function(e) {
            if (e.target === this) closeModal();
        });

        document.getElementById('subjectInput').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') saveSubject(this.value);
        });

        function saveSubject(subjectValue) {
            let cleanSubject = subjectValue.trim();
            let targetRow = dragStartInfo.rowEle;
            
            let affectedCellsInfo = [];
            
            selectedCells.forEach(cell => {
                let g = cell.getAttribute('data-grade');
                let c = parseInt(cell.getAttribute('data-class'));
                affectedCellsInfo.push({ grade: g, classNum: c });
            });

            // Split (기존 병합 해제)
            affectedCellsInfo.forEach(info => {
                let cell = targetRow.querySelector(`.exam-cell[data-grade="${info.grade}"][data-class="${info.classNum}"]`);
                if(cell) {
                    cell.style.display = ''; 
                    cell.colSpan = 1;
                    cell.innerText = '';
                    cell.classList.remove('has-subject', 'selected', 'sel-left', 'sel-mid', 'sel-right', 'sel-single');
                    cell.setAttribute('data-classes', info.classNum); 
                }
            });

            // Merge (과목 입력 시 병합)
            if (cleanSubject) {
                let groupedByGrade = {};
                affectedCellsInfo.forEach(info => {
                    if(!groupedByGrade[info.grade]) groupedByGrade[info.grade] = [];
                    groupedByGrade[info.grade].push(info.classNum);
                });

                for (let g in groupedByGrade) {
                    let classes = [...new Set(groupedByGrade[g])].sort((a,b) => a - b);
                    let targetCells = classes.map(c => targetRow.querySelector(`.exam-cell[data-grade="${g}"][data-class="${c}"]`));
                    
                    let firstCell = targetCells[0];
                    firstCell.colSpan = targetCells.length;
                    firstCell.innerText = cleanSubject;
                    firstCell.classList.add('has-subject');
                    firstCell.setAttribute('data-classes', classes.join(','));

                    for (let i = 1; i < targetCells.length; i++) {
                        targetCells[i].style.display = 'none';
                    }
                }
            }

            closeModal();
        }

        // --- 5. 데이터 추출 ---
        function buildScheduleData() {
            let scheduleData = [];
            const rows = document.querySelectorAll('#scheduleTable tbody tr');
            
            rows.forEach(row => {
                let periodName = row.getAttribute('data-period');
                let periodExams = [];
                let subjectMap = {}; 

                const cells = row.querySelectorAll('.exam-cell.has-subject');
                cells.forEach(cell => {
                    if (cell.style.display !== 'none') {
                        let subject = cell.innerText.trim();
                        let grade = parseInt(cell.getAttribute('data-grade'));
                        let classes = cell.getAttribute('data-classes').split(',').map(Number); 
                        
                        let key = `${grade}_${subject}`;
                        if(!subjectMap[key]) subjectMap[key] = { grade: grade, subject: subject, classes: [] };
                        subjectMap[key].classes = subjectMap[key].classes.concat(classes);
                    }
                });

                for(let key in subjectMap) {
                    subjectMap[key].classes = [...new Set(subjectMap[key].classes)].sort((a,b)=>a-b);
                    periodExams.push(subjectMap[key]);
                }
                
                if(periodExams.length > 0) scheduleData.push({ periodName: periodName, exams: periodExams });
            });
            return scheduleData;
        }

        // --- 6. 엑셀 로드 ---
        document.getElementById('excelInput').addEventListener('change', function (e) {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function (e) {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });

                rawTeachers = jsonData.map(t => {
                    let cleanObj = {};
                    for (let key in t) cleanObj[key.trim()] = t[key];
                    
                    // 이름 결측치 예외 처리
                    let name = cleanObj["성명"] !== undefined && cleanObj["성명"] !== null ? String(cleanObj["성명"]).trim() : "";
                    
                    // 학년/반 파싱 시 NaN 예외 처리 방어 코드
                    let gradeParsed = cleanObj["담당학년"] ? parseInt(String(cleanObj["담당학년"]).replace(/[^0-9]/g, '')) : null;
                    let classParsed = cleanObj["담당반"] ? parseInt(String(cleanObj["담당반"]).replace(/[^0-9]/g, '')) : null;

                    return {
                        연번: cleanObj["연번"],
                        성명: name,
                        과목: String(cleanObj["과목"] || ""),
                        담당학년: isNaN(gradeParsed) ? null : gradeParsed,
                        담당반: isNaN(classParsed) ? null : classParsed
                    };
                }).filter(t => t.성명 !== ""); // 이름이 비어 있는 정체불명의 더미 행 필터링
                
                document.getElementById('statusIndicator').className = "status-dot active";
                document.getElementById('uploadStatus').innerHTML = `로스터 로드됨 (${rawTeachers.length}명)`;
                document.getElementById('runBtn').disabled = false;
            };
            reader.readAsArrayBuffer(file);
        });

        // --- 7. 알고리즘 실행 ---
        function runAssignment() {
            const panel = document.getElementById('controlPanel');
            const currentScheduleData = buildScheduleData();
            
            if(currentScheduleData.length === 0) {
                alert("일정 영역에 시험 과목이 정의되어 있지 않습니다.");
                return;
            }

            let teachers = rawTeachers.map(t => ({ ...t, totalCount: 0 }));
            let allResults = [];

            currentScheduleData.forEach(period => {
                let periodResult = { periodName: period.periodName, rooms: {}, hallway: [] };
                let activeSubjects = new Set();
                period.exams.forEach(ex => activeSubjects.add(ex.subject));

                // 과목명 정확히 일치 비교
                let availablePool = teachers.filter(t => {
                    let teacherSubjects = String(t.과목 || "").split(',').map(s => s.trim());
                    for (let examSubj of activeSubjects) {
                        if (teacherSubjects.includes(examSubj)) return false; 
                    }
                    return true;
                });

                for (let g = 1; g <= 3; g++) {
                    for (let c = 1; c <= 8; c++) {
                        let subject = null;
                        for(let ex of period.exams) {
                            if(ex.grade === g && ex.classes.includes(c)) subject = ex.subject;
                        }
                        if (!subject) continue; 

                        // 일관성 있는 랜덤 가중치 미리 할당
                        availablePool.forEach(t => t.rand = Math.random());
                        availablePool.sort((a, b) => {
                            if (a.totalCount === b.totalCount) return a.rand - b.rand;
                            return a.totalCount - b.totalCount;
                        });

                        let roomTeachers = [];
                        for (let i = 0; i < availablePool.length; i++) {
                            let candidate = availablePool[i];
                            
                            let candGrade = candidate.담당학년 !== null ? String(candidate.담당학년) : "";
                            let candClass = candidate.담당반 !== null ? String(candidate.담당반) : "";
                            if (candGrade === String(g) && candClass === String(c)) continue; 

                            roomTeachers.push(candidate);
                            candidate.totalCount += 1; 
                            
                            availablePool.splice(i, 1);
                            i--; 
                            if (roomTeachers.length === 2) break;
                        }
                        periodResult.rooms[`${g}-${c}`] = { subject: subject, teachers: roomTeachers };
                    }
                }

                for (let row = 0; row < 4; row++) {
                    let hasExamOnFloor = false;
                    for (let g = 1; g <= 3; g++) {
                        let c1 = row * 2 + 1;
                        let c2 = row * 2 + 2;
                        if (periodResult.rooms[`${g}-${c1}`] || periodResult.rooms[`${g}-${c2}`]) {
                            hasExamOnFloor = true; break;
                        }
                    }

                    if (hasExamOnFloor) {
                        // 복도 배정용 풀 역시 안전한 랜덤 가중치 부여 후 정렬
                        availablePool.forEach(t => t.rand = Math.random());
                        availablePool.sort((a, b) => {
                            if (a.totalCount === b.totalCount) return a.rand - b.rand;
                            return a.totalCount - b.totalCount;
                        });

                        if (availablePool.length > 0) {
                            let hwTeacher = availablePool.shift();
                            hwTeacher.totalCount += 1;
                            periodResult.hallway.push(hwTeacher);
                        } else {
                            periodResult.hallway.push("SHORTAGE"); 
                        }
                    } else {
                        periodResult.hallway.push("NO_EXAM"); 
                    }
                }
                allResults.push(periodResult);
            });

            // 연산 완료 후 데이터를 전역 변수에 기록
            lastAssignmentResults = allResults;
            activeTeachersList = teachers;

            renderDashboard(allResults);
        }

        // --- 8. UI 대시보드 렌더링 ---
        function renderDashboard(allResults) {
            const outputArea = document.getElementById('mainOutput');
            outputArea.innerHTML = ''; 

            allResults.forEach(period => {
                const block = document.createElement('div');
                block.className = 'period-block';
                
                const header = document.createElement('div');
                header.className = 'period-header';
                header.textContent = period.periodName;
                block.appendChild(header);

                const building = document.createElement('div');
                building.className = 'building';

                for (let row = 0; row < 4; row++) {
                    const floorRow = document.createElement('div');
                    floorRow.className = 'floor-row';

                    const label = document.createElement('div');
                    label.className = 'dept-label';
                    label.textContent = departments[row];
                    floorRow.appendChild(label);

                    for (let g = 1; g <= 3; g++) {
                        const classGroup = document.createElement('div');
                        classGroup.className = 'class-group';

                        const c1 = row * 2 + 1;
                        const c2 = row * 2 + 2;
                        
                        classGroup.appendChild(createClassCard(g, c1, period.rooms));
                        classGroup.appendChild(createClassCard(g, c2, period.rooms));
                        floorRow.appendChild(classGroup);

                        if (g < 3) {
                            const spacer = document.createElement('div');
                            spacer.className = 'spacer';
                            floorRow.appendChild(spacer);
                        }
                    }

                    const hwZone = document.createElement('div');
                    hwZone.className = 'hallway-zone';
                    const hwTeacher = period.hallway[row];
                    
                    if (hwTeacher === "NO_EXAM") {
                        hwZone.innerHTML = `<span style="color:var(--text-muted); font-size:10px;">미시행</span>`;
                    } else if (hwTeacher === "SHORTAGE") {
                        hwZone.classList.add('error');
                        hwZone.innerHTML = `<div class="hw-error">인원 부족</div>`;
                    } else if (hwTeacher) {
                        hwZone.classList.add('active');
                        hwZone.innerHTML = `
                            <div class="hw-label">복도</div>
                            <div class="hw-teacher">${hwTeacher.성명}</div>
                        `;
                    }
                    floorRow.appendChild(hwZone);
                    building.appendChild(floorRow);
                }
                
                block.appendChild(building);
                outputArea.appendChild(block);
            });

            if(allResults.length > 0) {
                // 교사별 배정 시간표 렌더링 함수 실행
                renderTeacherScheduleTable();
                document.getElementById('mainOutput').scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }

        // --- 교사별 배정 시간표를 생성하고 렌더링하는 함수 (가로폭 고정 레이아웃 반영) ---
        function renderTeacherScheduleTable() {
            if (!lastAssignmentResults || !activeTeachersList || activeTeachersList.length === 0) return;
            
            const selectEl = document.getElementById('scheduleFormatSelect');
            const formatType = selectEl ? selectEl.value : 'location';
            
            // 교사 성명(100px), 담당 교과(100px), 각 교시별(80px) 너비를 기준으로 최소 테이블 전체 폭 계산
            const nameColWidth = 100;
            const subjectColWidth = 100;
            const periodColWidth = 85; // 복도(1과) 등의 텍스트가 잘리지 않는 안정적인 최소 크기
            const totalPeriods = maxDays * maxPeriods;
            const minTableWidth = nameColWidth + subjectColWidth + (totalPeriods * periodColWidth);

            let html = `
                <div class="workspace-card" style="margin-top: 32px;">
                    <div class="workspace-header">
                        <h2 class="section-title">
                            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.109A11.386 11.386 0 0110.089 18a11.374 11.374 0 01-9.333-2.978m11.341-5.834a3 3 0 11-6 0 3 3 0 016 0zm0 0a3 3 0 116 0 3 3 0 01-6 0z" /></svg>
                            교사별 배정 현황
                        </h2>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span class="control-label" style="font-size:11px;">표시 형식:</span>
                            <select id="scheduleFormatSelect" onchange="renderTeacherScheduleTable()" style="padding: 4px 8px; font-size: 11px; border-radius: 5px; border: 1px solid var(--border-primary); background: var(--bg-canvas); color: var(--text-primary); cursor: pointer; outline: none;">
                                <option value="location" ${formatType === 'location' ? 'selected' : ''}>배정 위치 (학년-반 / 복도)</option>
                                <option value="symbol" ${formatType === 'symbol' ? 'selected' : ''}>체크 표시 (O)</option>
                            </select>
                        </div>
                    </div>
                    <div class="table-container" style="overflow-x: auto;">
                        <table style="table-layout: fixed; width: 100%; min-width: ${minTableWidth}px; border-collapse: collapse;">
                            <!-- colgroup을 이용하여 각 열의 폭을 강제로 고정합니다 -->
                            <colgroup>
                                <col style="width: ${nameColWidth}px;">
                                <col style="width: ${subjectColWidth}px;">
            `;
            
            // 각 교시 열에 동일한 고정 폭 분배
            for (let i = 0; i < totalPeriods; i++) {
                html += `<col style="width: ${periodColWidth}px;">`;
            }

            html += `
                            </colgroup>
                            <thead>
                                <tr>
                                    <th rowspan="2" style="background: var(--bg-app);">교사 성명</th>
                                    <th rowspan="2" style="background: var(--bg-app);">담당 교과</th>
            `;
            
            // 헤더 1차: 일차 구분
            for (let d = 1; d <= maxDays; d++) {
                html += `<th colspan="${maxPeriods}">${d}일차</th>`;
            }
            html += `</tr><tr>`;
            
            // 헤더 2차: 교시 구분
            for (let d = 1; d <= maxDays; d++) {
                for (let p = 1; p <= maxPeriods; p++) {
                    html += `<th style="font-size:10px;">${p}교시</th>`;
                }
            }
            html += `</tr></thead><tbody>`;

            // 교사명 기준 정렬
            const sortedTeachers = [...activeTeachersList].sort((a, b) => a.성명.localeCompare(b.성명, 'ko'));

            sortedTeachers.forEach(teacher => {
                html += `<tr>`;
                html += `<td style="font-weight: 700; background: var(--bg-canvas); color: var(--text-primary); text-align: center; height: 36px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${teacher.성명}</td>`;
                html += `<td style="color: var(--text-muted); font-size: 11px; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${teacher.과목 || "-"}</td>`;

                for (let d = 1; d <= maxDays; d++) {
                    for (let p = 1; p <= maxPeriods; p++) {
                        const periodName = `${d}일차 ${p}교시`;
                        const periodResult = lastAssignmentResults.find(r => r.periodName === periodName);
                        
                        let cellValue = '';
                        let cellClass = '';
                        let roomGrade = '';

                        if (periodResult) {
                            // 고실 배정 여부 검색
                            let foundRoomKey = null;
                            for (let key in periodResult.rooms) {
                                const rData = periodResult.rooms[key];
                                if (rData.teachers.some(t => t.성명 === teacher.성명)) {
                                    foundRoomKey = key; 
                                    break;
                                }
                            }

                            // 복도 배정 여부 검색
                            let foundHallway = false;
                            let hallwayFloor = -1;
                            periodResult.hallway.forEach((hw, idx) => {
                                if (hw && hw.성명 === teacher.성명) {
                                    foundHallway = true;
                                    hallwayFloor = idx;
                                }
                            });

                            if (foundRoomKey) {
                                roomGrade = foundRoomKey.split('-')[0];
                                if (formatType === 'symbol') {
                                    cellValue = 'O';
                                } else {
                                    cellValue = foundRoomKey; 
                                }
                                cellClass = 'room-cell';
                            } else if (foundHallway) {
                                if (formatType === 'symbol') {
                                    cellValue = 'O';
                                } else {
                                    cellValue = `복도(${departments[hallwayFloor]})`;
                                }
                                cellClass = 'hallway-cell';
                            }
                        }

                        let extraAttrs = '';
                        if (cellClass === 'room-cell') {
                            extraAttrs = `class="exam-cell has-subject" data-grade="${roomGrade}"`;
                        } else if (cellClass === 'hallway-cell') {
                            extraAttrs = `style="background: var(--hw-active-bg); color: var(--primary); font-weight: 700;"`;
                        }

                        // 가로 폭을 넘어서 흘러넘치는 현상을 방지하기 위해 최소한의 truncation 스타일을 입힙니다.
                        html += `<td ${extraAttrs} style="text-align: center; font-size: 11px; height: 36px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${cellValue}</td>`;
                    }
                }
                html += `</tr>`;
            });

            html += `</tbody></table></div></div>`;
            
            let targetDiv = document.getElementById('teacherScheduleSection');
            if (targetDiv) {
                targetDiv.innerHTML = html;
            } else {
                const newDiv = document.createElement('div');
                newDiv.id = 'teacherScheduleSection';
                newDiv.innerHTML = html;
                document.getElementById('mainOutput').appendChild(newDiv);
            }
        }

        function createClassCard(grade, classNum, roomsResult) {
            const card = document.createElement('div');
            const roomData = roomsResult[`${grade}-${classNum}`];

            if (roomData) {
                card.className = `class-card g${grade}`;
                let html = `
                    <div class="card-meta">${grade}학년 ${classNum}반</div>
                    <div class="card-subject">${roomData.subject}</div>
                    <div class="teacher-box">
                `;
                
                if (roomData.teachers.length === 2) {
                    html += `<div class="teacher-name">${roomData.teachers[0].성명}</div>`;
                    html += `<div class="teacher-name">${roomData.teachers[1].성명}</div>`;
                } else if (roomData.teachers.length === 1) {
                    html += `<div class="teacher-name">${roomData.teachers[0].성명}</div>`;
                    html += `<div class="teacher-name error">공석</div>`;
                } else {
                    html += `<div class="teacher-name error" style="flex:1;">배정오류</div>`;
                }
                html += `</div>`;
                card.innerHTML = html;
            } else {
                card.className = `class-card empty`;
                card.innerHTML = `<div class="card-meta" style="margin:auto 0;">${grade}-${classNum}</div>`;
            }
            return card;
        }

        // --- 9. 세팅 및 테마 제어 로직 ---
        function hasAnySubject() {
            return document.querySelectorAll('.exam-cell.has-subject').length > 0;
        }

        function changeDays(val) {
            const input = document.getElementById('daysInput');
            let current = parseInt(input.value);
            let next = current + val;
            if (next < 1 || next > 10) return;
            
            if (hasAnySubject()) {
                if (!confirm("시험 일수를 변경하면 현재 작성 중인 일정 데이터가 초기화됩니다. 계속하시겠습니까?")) return;
            }
            
            maxDays = next;
            input.value = next;
            initScheduleTable();
        }

        function changePeriods(val) {
            const input = document.getElementById('periodsInput');
            let current = parseInt(input.value);
            let next = current + val;
            if (next < 1 || next > 10) return;
            
            if (hasAnySubject()) {
                if (!confirm("최대 교시를 변경하면 현재 작성 중인 일정 데이터가 초기화됩니다. 계속하시겠습니까?")) return;
            }
            
            maxPeriods = next;
            input.value = next;
            initScheduleTable();
        }

        function toggleSettings() {
            const panel = document.getElementById('controlPanel');
            const overlay = document.getElementById('overlay');
            if (panel) panel.classList.toggle('active');
            if (overlay) overlay.classList.toggle('active');
        }

        function toggleTheme() {
            const body = document.body;
            const currentTheme = body.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

            body.setAttribute('data-theme', newTheme);
            localStorage.setItem('schoolAppsTheme', newTheme);
            updateThemeButtonText(newTheme);
        }

        function updateThemeButtonText(theme) {
            const themeText = document.getElementById('themeToggleText');
            if (themeText) {
                themeText.textContent = theme === 'dark' ? '라이트 테마 전환' : '다크 테마 전환';
            }
        }

        initScheduleTable();
    