// =========================================
// Corner Todo — 화면의 두뇌 (동작)
// 2단계: 할 일 추가 · 완료 체크 · 삭제
// 3단계: localStorage 저장 · 불러오기
// 4단계: 수정 · 카테고리 필터
// 5단계: 진행률 (전체 + 카테고리별)
// 6단계: 오늘 날짜 · 단축키 · 삭제 되돌리기
// =========================================

// ---- 카테고리 이름표 (영어 코드 → 화면에 보일 한글) ----
const CATEGORY_LABELS = {
  work: '업무',
  personal: '개인',
  study: '공부',
};

// ---- localStorage 사물함 이름표 (PRD 5장) ----
const STORAGE_KEY = 'cornerTodo.todos';        // 할 일 목록
const SETTINGS_KEY = 'cornerTodo.settings';    // 마지막 선택 카테고리 등

// =========================================
// 저장 · 불러오기 (F-27 ~ F-29)
// localStorage = 브라우저 안의 개인 사물함.
// 글자(문자열)만 넣을 수 있어서 JSON 글자로 바꿔서 넣고, 꺼낼 때 다시 되돌린다.
// =========================================

// 사물함에서 할 일 목록 꺼내기
function loadTodos() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];                         // 처음 실행: 빈 목록
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];         // 모양이 이상하면 빈 목록
    // 필요한 정보가 제대로 있는 카드만 골라 쓰기 (깨진 카드는 건너뜀)
    return data.filter((t) =>
      t && typeof t.id === 'string' && typeof t.text === 'string' &&
      CATEGORY_LABELS[t.category] && typeof t.done === 'boolean'
    );
  } catch (err) {
    // 데이터가 깨져 있어도 앱이 멈추지 않고 빈 목록으로 시작 (F-29)
    console.warn('저장된 할 일을 읽지 못해 빈 목록으로 시작합니다.', err);
    return [];
  }
}

// 사물함에 할 일 목록 넣기
function saveTodos() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
  } catch (err) {
    console.warn('할 일을 저장하지 못했습니다.', err);
  }
}

// 설정 꺼내기 (마지막에 고른 카테고리, 마지막 필터 탭)
function loadSettings() {
  const defaults = { lastCategory: 'work', filter: 'all' };
  try {
    const data = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    return {
      lastCategory: CATEGORY_LABELS[data.lastCategory] ? data.lastCategory : defaults.lastCategory,
      filter: data.filter === 'all' || CATEGORY_LABELS[data.filter] ? data.filter : defaults.filter,
    };
  } catch (err) {
    return defaults;
  }
}

// 설정 넣기
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('설정을 저장하지 못했습니다.', err);
  }
}

// ---- 할 일 목록 데이터: 시작할 때 사물함에서 꺼내 옴 ----
let todos = loadTodos();
let settings = loadSettings();

// 지금 수정 중인 할 일의 id (수정 중이 아니면 null)
let editingId = null;

// 방금 삭제한 할 일 (되돌리기용): { todo, index }
let lastDeleted = null;
let toastTimer = null;
const UNDO_SECONDS = 5;

// ---- 화면 요소 찾아 두기 ----
const addForm = document.getElementById('addForm');
const addInput = document.getElementById('addInput');
const catSelect = document.getElementById('catSelect');
const todoList = document.getElementById('todoList');
const emptyMsg = document.getElementById('emptyMsg');
const remaining = document.getElementById('remaining');
const clearDoneBtn = document.getElementById('clearDone');
const filterBtns = document.querySelectorAll('.filter');
const progressSection = document.querySelector('.progress');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const progressCats = document.getElementById('progressCats');
const celebrate = document.getElementById('celebrate');
const todayEl = document.getElementById('today');
const toast = document.getElementById('toast');
const toastMsg = document.getElementById('toastMsg');
const undoBtn = document.getElementById('undoBtn');

// =========================================
// 데이터 다루기 함수
// 원칙: 데이터 바꾸기 → 저장(saveTodos) → 화면 다시 그리기(render)
// =========================================

// 할 일 카드 한 장 만들기
function makeTodo(text, category) {
  return {
    id: String(Date.now()) + Math.random().toString(36).slice(2, 6), // 고유 번호
    text: text,
    category: category,
    done: false,
    createdAt: new Date().toISOString(),
    doneAt: null,
  };
}

// 할 일 추가 (F-01 ~ F-06)
function addTodo(text, category) {
  const trimmed = text.trim();
  if (trimmed === '') return false;          // 빈 칸·공백만 있으면 추가 안 함 (F-03)
  todos.push(makeTodo(trimmed.slice(0, 100), category)); // 최대 100자 (F-04)
  saveTodos();
  render();
  return true;
}

// 완료 ↔ 미완료 바꾸기 (F-14)
function toggleTodo(id) {
  const todo = todos.find((t) => t.id === id);
  if (!todo) return;
  todo.done = !todo.done;
  todo.doneAt = todo.done ? new Date().toISOString() : null;
  saveTodos();
  render();
}

// 할 일 하나 삭제 (F-11, F-12)
// 확인 창 없이 바로 지우고, 5초 동안 '되돌리기' 기회를 줌
function deleteTodo(id) {
  const index = todos.findIndex((t) => t.id === id);
  if (index === -1) return;
  lastDeleted = { todo: todos[index], index: index };  // 되돌리기용으로 기억
  todos.splice(index, 1);
  saveTodos();
  render();
  showUndoToast(`"${lastDeleted.todo.text}" 삭제됨`);
}

// 되돌리기: 방금 지운 할 일을 원래 자리에 다시 넣기
function undoDelete() {
  if (!lastDeleted) return;
  const { todo, index } = lastDeleted;
  todos.splice(Math.min(index, todos.length), 0, todo);
  lastDeleted = null;
  hideToast();
  saveTodos();
  render();
}

// 되돌리기 안내 띄우기 (5초 뒤 자동으로 사라짐)
function showUndoToast(message) {
  toastMsg.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);                 // 이전 안내의 타이머는 취소
  toastTimer = setTimeout(() => {
    lastDeleted = null;                     // 5초가 지나면 되돌리기 불가
    hideToast();
  }, UNDO_SECONDS * 1000);
}

function hideToast() {
  clearTimeout(toastTimer);
  toast.hidden = true;
}

// 완료 항목 한꺼번에 지우기 (F-13)
function clearDone() {
  const doneCount = todos.filter((t) => t.done).length;
  if (doneCount === 0) return;   // 버튼이 흐리게 꺼져 있으므로 실제로는 거의 오지 않음
  if (!confirm(`완료한 할 일 ${doneCount}개를 지울까요?`)) return;
  todos = todos.filter((t) => !t.done);
  saveTodos();
  render();
}

// 수정 시작: 그 줄을 입력창으로 바꾸기 (F-07)
function startEdit(id) {
  if (editingId === id) return;
  editingId = id;
  render();
  const input = todoList.querySelector('.edit-input');
  if (input) {
    input.focus();
    input.select();   // 글자 전체 선택 → 바로 고쳐 쓰기 편하게
  }
}

// 수정 끝내기: save가 true면 저장, false면 취소 (F-08 ~ F-10)
function finishEdit(save) {
  if (editingId === null) return;          // 이미 끝났으면 무시 (두 번 실행 방지)
  const li = todoList.querySelector('.todo.editing');
  const todo = todos.find((t) => t.id === editingId);
  editingId = null;

  if (save && li && todo) {
    const newText = li.querySelector('.edit-input').value.trim();
    const newCategory = li.querySelector('.edit-select').value;
    // 내용을 다 지우고 저장하면 실수로 보고 변경 취소 (F-09)
    if (newText !== '') {
      todo.text = newText.slice(0, 100);
      todo.category = newCategory;
      saveTodos();
    }
  }
  render();
}

// 필터 탭 바꾸기 (F-20, F-21)
function setFilter(filter) {
  settings.filter = filter;
  // 업무/개인/공부 탭을 고르면 입력 카테고리도 같이 맞춤
  // → 추가한 할 일이 지금 보는 탭에서 바로 보이도록
  if (filter !== 'all') {
    settings.lastCategory = filter;
    catSelect.value = filter;
  }
  saveSettings();
  render();
}

// =========================================
// 화면 그리기
// =========================================

// 수정 중인 한 줄 만들기: 카테고리 선택 + 입력창
function createEditItem(todo) {
  const li = document.createElement('li');
  li.className = `todo ${todo.category} editing`;
  li.dataset.id = todo.id;

  const select = document.createElement('select');
  select.className = 'edit-select';
  select.setAttribute('aria-label', '카테고리 수정');
  for (const [value, label] of Object.entries(CATEGORY_LABELS)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  select.value = todo.category;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'edit-input';
  input.maxLength = 100;
  input.value = todo.text;
  input.setAttribute('aria-label', '할 일 수정 (Enter 저장, Esc 취소)');
  input.title = 'Enter 저장 · Esc 취소';

  li.append(select, input);
  return li;
}

// 할 일 한 줄(li) 만들기
function createTodoItem(todo) {
  if (todo.id === editingId) return createEditItem(todo);

  const li = document.createElement('li');
  li.className = `todo ${todo.category}` + (todo.done ? ' done' : '');
  li.dataset.id = todo.id;

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'check';
  check.checked = todo.done;
  check.setAttribute('aria-label', '완료');
  check.dataset.action = 'toggle';

  const tag = document.createElement('span');
  tag.className = 'cat-tag';
  tag.textContent = CATEGORY_LABELS[todo.category];

  const text = document.createElement('span');
  text.className = 'text';
  text.textContent = todo.text; // 입력한 글자는 textContent로 안전하게
  text.title = '더블클릭하여 수정';

  const editBtn = document.createElement('button');
  editBtn.className = 'icon-btn';
  editBtn.textContent = '✏️';
  editBtn.setAttribute('aria-label', '수정');
  editBtn.title = '수정';
  editBtn.dataset.action = 'edit';

  const delBtn = document.createElement('button');
  delBtn.className = 'icon-btn';
  delBtn.textContent = '🗑';
  delBtn.setAttribute('aria-label', '삭제');
  delBtn.title = '삭제';
  delBtn.dataset.action = 'delete';

  li.append(check, tag, text, editBtn, delBtn);
  return li;
}

// 오늘 날짜 표시: "10월 30일 (금요일)" (F-30)
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
function renderToday() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const date = now.getDate();
  const weekday = WEEKDAYS[now.getDay()];
  todayEl.textContent = `${month}월 ${date}일 (${weekday}요일)`;
}

// 퍼센트 계산 (할 일이 0개면 0으로 나누지 않고 0%) (F-25)
function percent(done, total) {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

// 진행률 그리기 (F-22 ~ F-26)
// 필터 탭과 상관없이 항상 '오늘 전체' 기준으로 계산
function renderProgress() {
  const total = todos.length;
  const done = todos.filter((t) => t.done).length;
  const pct = percent(done, total);

  // ② 전체 진행률: 막대 + "완료/전체 (퍼센트)"
  progressFill.style.width = pct + '%';
  progressBar.setAttribute('aria-valuenow', pct);
  progressText.textContent = `${done}/${total} (${pct}%)`;

  // ③ 카테고리별 진행률: "업무 3/5 · 개인 2/3 · 공부 3/4"
  const items = Object.entries(CATEGORY_LABELS).map(([cat, label]) => {
    const inCat = todos.filter((t) => t.category === cat);
    const doneInCat = inCat.filter((t) => t.done).length;

    const li = document.createElement('li');
    if (inCat.length === 0) li.className = 'zero';
    const dot = document.createElement('span');
    dot.className = `dot ${cat}`;
    li.append(dot, `${label} ${doneInCat}/${inCat.length}`);
    li.title = `${label} ${percent(doneInCat, inCat.length)}% 완료`;
    return li;
  });
  progressCats.replaceChildren(...items);

  // 100% 달성 축하 (F-26)
  const allDone = total > 0 && done === total;
  progressSection.classList.toggle('complete', allDone);
  celebrate.hidden = !allDone;
}

// 전체 목록 다시 그리기
function render() {
  // 미완료가 위, 완료가 아래 (F-16). 같은 그룹 안에서는 추가한 순서 유지
  const sorted = [
    ...todos.filter((t) => !t.done),
    ...todos.filter((t) => t.done),
  ];

  // 지금 고른 필터 탭에 맞는 것만 보여주기
  const visible = settings.filter === 'all'
    ? sorted
    : sorted.filter((t) => t.category === settings.filter);

  todoList.replaceChildren(...visible.map(createTodoItem));

  // 필터 탭 모양 (선택된 탭 강조)
  filterBtns.forEach((btn) => {
    const isActive = btn.dataset.filter === settings.filter;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive);
  });

  // 보여줄 할 일이 없을 때 안내 문구
  if (todos.length === 0) {
    emptyMsg.textContent = '할 일을 추가해 보세요 ✍️';
  } else {
    emptyMsg.textContent = `${CATEGORY_LABELS[settings.filter]} 할 일이 없어요`;
  }
  emptyMsg.hidden = visible.length > 0;

  // 진행률 다시 계산 (F-24: 바뀔 때마다 즉시)
  renderProgress();

  // 하단 '남은 일' 개수
  const left = todos.filter((t) => !t.done).length;
  remaining.textContent = `남은 일 ${left}개`;

  // 완료 항목이 없으면 [완료 항목 지우기] 버튼을 끔
  clearDoneBtn.disabled = !todos.some((t) => t.done);
}

// =========================================
// 사용자 행동 연결 (이벤트)
// =========================================

// Enter 키 또는 + 버튼 → 추가
addForm.addEventListener('submit', (e) => {
  e.preventDefault();               // 페이지가 새로고침되지 않게 막기
  addTodo(addInput.value, catSelect.value);
  addInput.value = '';              // 입력창 비우기 (F-05)
  addInput.focus();                 // 커서는 그대로 → 연속 입력
});

// 목록 안의 체크박스·버튼 클릭 (목록 전체에서 한 번에 받기)
todoList.addEventListener('click', (e) => {
  const action = e.target.dataset.action;
  if (!action) return;
  const li = e.target.closest('.todo');
  if (!li) return;
  const id = li.dataset.id;

  if (action === 'toggle') toggleTodo(id);
  else if (action === 'delete') deleteTodo(id);
  else if (action === 'edit') startEdit(id);
});

// 할 일 글자를 더블클릭 → 수정 시작 (F-07)
todoList.addEventListener('dblclick', (e) => {
  if (!e.target.classList.contains('text')) return;
  startEdit(e.target.closest('.todo').dataset.id);
});

// 수정 중 키보드: Enter = 저장, Esc = 취소 (F-08)
todoList.addEventListener('keydown', (e) => {
  if (!e.target.closest('.todo.editing')) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    finishEdit(true);
  } else if (e.key === 'Escape') {
    finishEdit(false);
  }
});

// 수정 중 입력창 밖을 클릭 → 저장 (F-08)
// 단, 같은 줄 안의 카테고리 선택 상자로 옮겨 가는 것은 '밖'이 아님
todoList.addEventListener('focusout', (e) => {
  const li = e.target.closest('.todo.editing');
  if (!li) return;
  if (e.relatedTarget && li.contains(e.relatedTarget)) return;
  finishEdit(true);
});

// 되돌리기 버튼
undoBtn.addEventListener('click', undoDelete);

// 단축키: / 또는 N 키 → 입력창으로 이동 (F-32)
// 한글 입력 상태(ㅜ)에서도 되도록 '눌린 키의 위치'(e.code)로 판단
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return; // 글자 입력 중이면 무시
  if (e.code === 'Slash' || e.code === 'KeyN') {
    e.preventDefault();            // '/' 글자가 입력창에 찍히지 않게
    addInput.focus();
  }
});

// 필터 탭 클릭
filterBtns.forEach((btn) => {
  btn.addEventListener('click', () => setFilter(btn.dataset.filter));
});

// 완료 항목 지우기
clearDoneBtn.addEventListener('click', clearDone);

// 카테고리를 바꾸면 기억해 두기 → 다음에 열 때도 그 카테고리가 기본값 (F-02)
catSelect.addEventListener('change', () => {
  settings.lastCategory = catSelect.value;
  saveSettings();
});

// ---- 시작할 때 한 번 그리기 ----
catSelect.value = settings.lastCategory;
renderToday();
setInterval(renderToday, 60 * 1000);   // 1분마다 확인 → 밤새 켜 두어도 자정이 지나면 날짜가 바뀜
render();
addInput.focus();
