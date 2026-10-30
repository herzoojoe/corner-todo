// =========================================
// Corner Todo — 화면의 두뇌 (동작)
// v1 (1~6단계): 추가·체크·삭제·수정·필터·진행률·날짜·단축키·되돌리기
// v2 9단계: 구글 로그인 + Firebase 공용 사물함(Firestore) 저장 + 실시간 연동
// v2 10단계: 예전(v1) 할 일 옮기기 + 오프라인 저장
// v2 11단계: 폰 다듬기(길게 눌러 수정) + 앱 설치(서비스 워커)
// =========================================

// ---- Firebase 도구 불러오기 (설치 없이 인터넷 주소에서 바로 가져옴) ----
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, query, orderBy, onSnapshot,
  setDoc, updateDoc, deleteDoc, writeBatch,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

// ---- Firebase 연결 ----
const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);               // 신분증 확인 담당 (구글 로그인)
// 인터넷 공용 사물함 + 기기 안 임시 보관함 (F-45, F-46)
// 임시 보관함 덕분에 인터넷이 끊겨도 마지막 목록이 보이고, 바꾼 내용은 연결되면 자동으로 올라감
let db;
try {
  db = initializeFirestore(fbApp, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (err) {
  console.warn('임시 보관함을 쓸 수 없어 기본 방식으로 연결합니다.', err);
  db = getFirestore(fbApp);
}
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' }); // 계정 고르는 화면 항상 보여주기

// ---- 카테고리 이름표 (영어 코드 → 화면에 보일 한글) ----
const CATEGORY_LABELS = {
  work: '업무',
  personal: '개인',
  study: '공부',
};

// ---- 이 기기에만 저장하는 설정 (F-53: 기기마다 따로 기억) ----
const SETTINGS_KEY = 'cornerTodo.settings';

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

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('설정을 저장하지 못했습니다.', err);
  }
}

// =========================================
// 상태 (앱이 지금 기억하고 있는 것들)
// =========================================
let todos = [];                 // 공용 사물함이 알려 준 최신 할 일 목록
let settings = loadSettings();
let editingId = null;           // 지금 수정 중인 할 일 id
let lastDeleted = null;         // 되돌리기용: 방금 지운 할 일
let toastTimer = null;
const UNDO_SECONDS = 5;

let todosCol = null;            // 내 사물함 칸: users/{내 계정}/todos
let unsubscribeTodos = null;    // 실시간 구독 끊는 스위치
let hasPendingWrites = false;   // 아직 공용 사물함에 올라가는 중인 변경이 있는지
let fromCache = true;           // 화면이 공용 사물함이 아닌 기기 임시 보관본 기준인지
let writeError = null;          // 저장 실패 안내 문구

// ---- 화면 요소 찾아 두기 ----
const $ = (id) => document.getElementById(id);
const loadingView = $('loadingView');
const loginView = $('loginView');
const appView = $('appView');
const loginBtn = $('loginBtn');
const loginError = $('loginError');
const syncStatus = $('syncStatus');
const accountBtn = $('accountBtn');
const accountName = $('accountName');
const accountMenu = $('accountMenu');
const logoutBtn = $('logoutBtn');
const addForm = $('addForm');
const addInput = $('addInput');
const catSelect = $('catSelect');
const todoList = $('todoList');
const emptyMsg = $('emptyMsg');
const remaining = $('remaining');
const clearDoneBtn = $('clearDone');
const filterBtns = document.querySelectorAll('.filter');
const progressSection = document.querySelector('.progress');
const progressBar = $('progressBar');
const progressFill = $('progressFill');
const progressText = $('progressText');
const progressCats = $('progressCats');
const celebrate = $('celebrate');
const todayEl = $('today');
const toast = $('toast');
const toastMsg = $('toastMsg');
const undoBtn = $('undoBtn');

// =========================================
// 화면 전환: 불러오는 중 / 로그인 / 앱
// =========================================
function showView(name) {
  loadingView.hidden = name !== 'loading';
  loginView.hidden = name !== 'login';
  appView.hidden = name !== 'app';
}

function showLoginError(message) {
  loginError.textContent = message;
  loginError.hidden = !message;
}

// =========================================
// 공용 사물함에 쓰기
// 원칙(v2): 데이터를 사물함에 쓰기만 한다.
//   화면은 사물함이 "바뀌었어요" 하고 알려 줄 때(실시간 구독) 다시 그린다.
//   → 내 기기에서 바꾼 것도, 다른 기기에서 바꾼 것도 같은 길로 화면에 들어옴
// =========================================

const nowISO = () => new Date().toISOString();
const todoRef = (id) => doc(todosCol, id);

// 쓰기 요청을 보내고, 실패하면 상태 표시줄에 알림
// (인터넷이 끊겨도 화면에는 바로 반영되고, 연결되면 자동으로 올라감)
function runWrite(promise) {
  promise.catch((err) => {
    console.error('저장 실패:', err);
    writeError = err && err.code === 'permission-denied'
      ? '⚠️ 저장 권한이 없어요'
      : '⚠️ 저장 실패 · 새로고침해 주세요';
    renderStatus();
  });
}

// 할 일 카드 한 장 만들기
function makeTodo(text, category) {
  const now = nowISO();
  return {
    id: String(Date.now()) + Math.random().toString(36).slice(2, 6), // 고유 번호
    text: text,
    category: category,
    done: false,
    createdAt: now,
    doneAt: null,
    updatedAt: now,
  };
}

// 할 일 추가 (F-01 ~ F-06)
function addTodo(text, category) {
  const trimmed = text.trim();
  if (trimmed === '' || !todosCol) return false;   // 빈 칸·공백만 있으면 추가 안 함 (F-03)
  const todo = makeTodo(trimmed.slice(0, 100), category); // 최대 100자 (F-04)
  runWrite(setDoc(todoRef(todo.id), todo));
  return true;
}

// 완료 ↔ 미완료 바꾸기 (F-14)
function toggleTodo(id) {
  const todo = todos.find((t) => t.id === id);
  if (!todo) return;
  const done = !todo.done;
  const now = nowISO();
  runWrite(updateDoc(todoRef(id), { done: done, doneAt: done ? now : null, updatedAt: now }));
}

// 할 일 하나 삭제 + 5초 되돌리기 (F-11, F-12)
function deleteTodo(id) {
  const todo = todos.find((t) => t.id === id);
  if (!todo) return;
  lastDeleted = { ...todo };                       // 되돌리기용으로 통째로 기억
  runWrite(deleteDoc(todoRef(id)));
  showUndoToast(`"${todo.text}" 삭제됨`);
}

// 되돌리기: 지운 카드를 그대로 다시 넣기
// (목록은 만든 시각 순서라, 원래 자리로 돌아감)
function undoDelete() {
  if (!lastDeleted || !todosCol) return;
  const todo = { ...lastDeleted, updatedAt: nowISO() };
  lastDeleted = null;
  hideToast();
  runWrite(setDoc(todoRef(todo.id), todo));
}

function showUndoToast(message) {
  toastMsg.textContent = message;
  undoBtn.hidden = false;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    lastDeleted = null;                     // 5초가 지나면 되돌리기 불가
    hideToast();
  }, UNDO_SECONDS * 1000);
}

// 알림만 보여 주는 안내 (되돌리기 버튼 없음)
function showInfoToast(message) {
  lastDeleted = null;
  toastMsg.textContent = message;
  undoBtn.hidden = true;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, UNDO_SECONDS * 1000);
}

function hideToast() {
  clearTimeout(toastTimer);
  toast.hidden = true;
}

// 완료 항목 한꺼번에 지우기 (F-13) — 한 번에 묶어서 처리
function clearDone() {
  const doneTodos = todos.filter((t) => t.done);
  if (doneTodos.length === 0) return;
  if (!confirm(`완료한 할 일 ${doneTodos.length}개를 지울까요?`)) return;
  const batch = writeBatch(db);
  doneTodos.forEach((t) => batch.delete(todoRef(t.id)));
  runWrite(batch.commit());
}

// 수정 시작 (F-07)
function startEdit(id) {
  if (editingId === id) return;
  editingId = id;
  render();
  const input = todoList.querySelector('.edit-input');
  if (input) {
    input.focus();
    input.select();
  }
}

// 수정 끝내기: save가 true면 저장, false면 취소 (F-08 ~ F-10)
function finishEdit(save) {
  if (editingId === null) return;
  const li = todoList.querySelector('.todo.editing');
  const todo = todos.find((t) => t.id === editingId);
  editingId = null;

  if (save && li && todo) {
    const newText = li.querySelector('.edit-input').value.trim().slice(0, 100);
    const newCategory = li.querySelector('.edit-select').value;
    const changed = newText !== todo.text || newCategory !== todo.category;
    // 내용을 다 지우면 실수로 보고 취소 (F-09), 바뀐 게 없으면 저장 생략
    if (newText !== '' && changed) {
      runWrite(updateDoc(todoRef(todo.id), {
        text: newText, category: newCategory, updatedAt: nowISO(),
      }));
    }
  }
  render();   // 수정하는 동안 다른 기기에서 들어온 변경도 이때 함께 반영
}

// 필터 탭 바꾸기 (F-20, F-21) — 이 기기에만 기억
function setFilter(filter) {
  settings.filter = filter;
  if (filter !== 'all') {
    settings.lastCategory = filter;
    catSelect.value = filter;
  }
  saveSettings();
  render();
}

// =========================================
// 예전(v1) 할 일 옮기기 (F-47, F-48)
// migrate.html(이사 도우미)이 주소 뒤에 #import=... 로 할 일을 담아 보내 줌
// =========================================
const IMPORT_KEY = 'cornerTodo.pendingImport';
let importing = false;

// 주소에 실려 온 할 일을 잠시 보관하고, 주소는 깨끗하게 되돌림
function captureImportFromHash() {
  const m = location.hash.match(/^#import=([A-Za-z0-9_-]+)$/);
  if (!m) return;
  try { sessionStorage.setItem(IMPORT_KEY, m[1]); } catch (err) { /* 보관 실패 시 옮기기 생략 */ }
  history.replaceState(null, '', location.pathname + location.search);
}

// base64 글자 → 할 일 목록
function decodeImport(code) {
  try {
    const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    const list = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(list)) return [];
    return list.filter(isValidTodo).map((t) => ({
      id: t.id,
      text: String(t.text).slice(0, 100),
      category: t.category,
      done: t.done,
      createdAt: t.createdAt || nowISO(),
      doneAt: t.done ? (t.doneAt || nowISO()) : null,
      updatedAt: nowISO(),
    }));
  } catch (err) {
    console.warn('옮길 할 일을 읽지 못했습니다.', err);
    return [];
  }
}

// 로그인 후 공용 사물함 목록을 처음 받은 뒤에 한 번 실행
function maybeImport() {
  if (importing || !todosCol) return;
  let code = null;
  try { code = sessionStorage.getItem(IMPORT_KEY); } catch (err) { code = null; }
  if (!code) return;
  importing = true;
  try { sessionStorage.removeItem(IMPORT_KEY); } catch (err) { /* 무시 */ }

  const items = decodeImport(code);
  const existing = new Set(todos.map((t) => t.id));
  const fresh = items.filter((t) => !existing.has(t.id));   // 이미 옮긴 것은 건너뜀

  if (fresh.length === 0) {
    showInfoToast(items.length ? '이미 모두 옮겨져 있어요' : '옮길 할 일을 찾지 못했어요');
  } else if (confirm(`예전 할 일 ${fresh.length}개를 공용 사물함으로 옮길까요?`)) {
    const batch = writeBatch(db);
    fresh.forEach((t) => batch.set(todoRef(t.id), t));
    runWrite(batch.commit());
    showInfoToast(`📦 예전 할 일 ${fresh.length}개를 옮겼어요`);
  }
  importing = false;
}

// =========================================
// 실시간 구독: 공용 사물함 지켜보기 (F-40 ~ F-44)
// =========================================

function isValidTodo(t) {
  return t && typeof t.id === 'string' && typeof t.text === 'string' &&
    CATEGORY_LABELS[t.category] && typeof t.done === 'boolean';
}

function subscribeTodos(uid) {
  todosCol = collection(db, 'users', uid, 'todos');   // 내 칸
  const q = query(todosCol, orderBy('createdAt'));    // 만든 순서대로

  unsubscribeTodos = onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    todos = snap.docs.map((d) => ({ ...d.data(), id: d.id })).filter(isValidTodo);
    hasPendingWrites = snap.metadata.hasPendingWrites;
    fromCache = snap.metadata.fromCache;
    if (!hasPendingWrites && !fromCache) writeError = null;   // 모두 올라갔으면 오류 안내 지우기
    renderStatus();

    // 수정 중이면 입력하던 글자가 지워지지 않게 목록은 그대로 두고,
    // 진행률·남은 개수만 먼저 바꿔 둠 (F-44). 목록은 수정이 끝날 때 다시 그림
    if (editingId !== null) renderSummary();
    else render();

    // 공용 사물함의 최신 목록을 받은 뒤에 옮기기 (중복 확인을 위해)
    if (!fromCache) maybeImport();
  }, (err) => {
    console.error('구독 오류:', err);
    if (err.code === 'permission-denied') {
      // 보안 규칙에서 허용하지 않은 계정 (본인 Gmail이 아님)
      showLoginError('이 구글 계정으로는 사물함을 열 수 없어요. 등록한 Gmail 계정으로 다시 로그인해 주세요.');
      signOut(auth);
    } else {
      writeError = '⚠️ 연결 오류 · 새로고침해 주세요';
      renderStatus();
    }
  });
}

function stopSubscription() {
  if (unsubscribeTodos) unsubscribeTodos();
  unsubscribeTodos = null;
  todosCol = null;
  todos = [];
  editingId = null;
  lastDeleted = null;
  hideToast();
}

// =========================================
// 화면 그리기
// =========================================

// 동기화 상태 표시 (F-42)
function renderStatus() {
  let text;
  let state;
  if (writeError) { text = writeError; state = 'error'; }
  else if (!navigator.onLine) { text = '📴 오프라인 · 연결되면 자동 저장'; state = 'offline'; }
  else if (hasPendingWrites) { text = '⏳ 저장 중…'; state = 'saving'; }
  else if (fromCache) { text = '🔄 연결 중…'; state = 'saving'; }
  else { text = '☁️ 동기화됨'; state = 'synced'; }
  syncStatus.textContent = text;
  syncStatus.dataset.state = state;
}

// 오늘 날짜 표시: "10월 30일 (금요일)" (F-30)
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
function renderToday() {
  const now = new Date();
  todayEl.textContent = `${now.getMonth() + 1}월 ${now.getDate()}일 (${WEEKDAYS[now.getDay()]}요일)`;
}

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
  text.textContent = todo.text;              // 입력한 글자는 textContent로 안전하게
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

// 퍼센트 계산 (할 일이 0개면 0%) (F-25)
function percent(done, total) {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

// 진행률 그리기 (F-22 ~ F-26) — 필터와 상관없이 전체 기준
function renderProgress() {
  const total = todos.length;
  const done = todos.filter((t) => t.done).length;
  const pct = percent(done, total);

  progressFill.style.width = pct + '%';
  progressBar.setAttribute('aria-valuenow', pct);
  progressText.textContent = `${done}/${total} (${pct}%)`;

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

  const allDone = total > 0 && done === total;
  progressSection.classList.toggle('complete', allDone);
  celebrate.hidden = !allDone;
}

// 진행률 + 하단 개수 (목록 말고 요약 부분)
function renderSummary() {
  renderProgress();
  const left = todos.filter((t) => !t.done).length;
  remaining.textContent = `남은 일 ${left}개`;
  clearDoneBtn.disabled = !todos.some((t) => t.done);
}

// 전체 다시 그리기
function render() {
  // 미완료가 위, 완료가 아래 (F-16). 같은 그룹 안에서는 만든 순서
  const sorted = [
    ...todos.filter((t) => !t.done),
    ...todos.filter((t) => t.done),
  ];
  const visible = settings.filter === 'all'
    ? sorted
    : sorted.filter((t) => t.category === settings.filter);

  todoList.replaceChildren(...visible.map(createTodoItem));

  filterBtns.forEach((btn) => {
    const isActive = btn.dataset.filter === settings.filter;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive);
  });

  emptyMsg.textContent = todos.length === 0
    ? '할 일을 추가해 보세요 ✍️'
    : `${CATEGORY_LABELS[settings.filter]} 할 일이 없어요`;
  emptyMsg.hidden = visible.length > 0;

  renderSummary();
}

// =========================================
// 로그인 · 로그아웃 (F-36 ~ F-39)
// =========================================

const LOGIN_ERRORS = {
  'auth/popup-blocked': '로그인 창이 차단됐어요. 주소창 오른쪽의 팝업 차단 아이콘을 눌러 허용한 뒤 다시 눌러 주세요.',
  'auth/unauthorized-domain': '이 주소는 Firebase에 등록되지 않았어요. Authentication → 승인된 도메인을 확인해 주세요.',
  'auth/network-request-failed': '인터넷 연결을 확인해 주세요.',
  'auth/operation-not-allowed': 'Firebase에서 Google 로그인이 꺼져 있어요. Authentication → 로그인 방법을 확인해 주세요.',
};

loginBtn.addEventListener('click', async () => {
  showLoginError('');
  loginBtn.disabled = true;
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    // 사용자가 로그인 창을 그냥 닫은 경우는 조용히 넘어감
    if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
      showLoginError(LOGIN_ERRORS[err.code] || `로그인하지 못했어요. (${err.code || err.message})`);
    }
  } finally {
    loginBtn.disabled = false;
  }
});

// 계정 이름 누르면 로그아웃 메뉴 열고 닫기
accountBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = accountMenu.hidden;
  accountMenu.hidden = !open;
  accountBtn.setAttribute('aria-expanded', open);
});
document.addEventListener('click', () => {
  accountMenu.hidden = true;
  accountBtn.setAttribute('aria-expanded', false);
});

logoutBtn.addEventListener('click', () => {
  if (confirm('로그아웃할까요?\n(할 일은 공용 사물함에 그대로 남아 있어요)')) signOut(auth);
});

// 로그인 상태가 바뀔 때마다 (처음 열 때 포함) 자동으로 불림
// 한 번 로그인하면 이 기기에서는 계속 유지됨 (F-37)
onAuthStateChanged(auth, (user) => {
  stopSubscription();
  if (user) {
    accountName.textContent = user.displayName || (user.email || '').split('@')[0] || '내 계정';
    accountBtn.title = user.email || '';
    showView('app');
    hasPendingWrites = false;
    fromCache = true;
    writeError = null;
    renderStatus();
    render();
    subscribeTodos(user.uid);
    addInput.focus();
  } else {
    showView('login');
  }
});

// =========================================
// 사용자 행동 연결 (이벤트) — v1과 같음
// =========================================

addForm.addEventListener('submit', (e) => {
  e.preventDefault();
  addTodo(addInput.value, catSelect.value);
  addInput.value = '';
  addInput.focus();
});

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

todoList.addEventListener('dblclick', (e) => {
  if (!e.target.classList.contains('text')) return;
  startEdit(e.target.closest('.todo').dataset.id);
});

// 폰: 할 일 글자를 길게(0.5초) 누르면 수정 시작 (F-52)
// 손가락을 뗄 때 수정을 시작해야 폰 키보드가 바로 올라옴
const LONG_PRESS_MS = 500;
let press = null;   // { id, x, y, time, el }

todoList.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  const text = e.target.closest('.text');
  if (!text) return;
  press = { id: text.closest('.todo').dataset.id, x: e.clientX, y: e.clientY, time: Date.now(), el: text };
  text.classList.add('pressing');
});
todoList.addEventListener('pointermove', (e) => {
  if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelPress();  // 스크롤하면 취소
});
todoList.addEventListener('pointerup', (e) => {
  if (!press) return;
  const { id, time } = press;
  cancelPress();
  if (Date.now() - time >= LONG_PRESS_MS) {
    e.preventDefault();
    startEdit(id);
  }
});
todoList.addEventListener('pointercancel', cancelPress);
todoList.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.text')) e.preventDefault();   // 길게 누를 때 뜨는 복사 메뉴 막기
});
function cancelPress() {
  if (press && press.el) press.el.classList.remove('pressing');
  press = null;
}

todoList.addEventListener('keydown', (e) => {
  if (!e.target.closest('.todo.editing')) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    finishEdit(true);
  } else if (e.key === 'Escape') {
    finishEdit(false);
  }
});

todoList.addEventListener('focusout', (e) => {
  const li = e.target.closest('.todo.editing');
  if (!li) return;
  if (e.relatedTarget && li.contains(e.relatedTarget)) return;
  finishEdit(true);
});

clearDoneBtn.addEventListener('click', clearDone);
undoBtn.addEventListener('click', undoDelete);

catSelect.addEventListener('change', () => {
  settings.lastCategory = catSelect.value;
  saveSettings();
});

filterBtns.forEach((btn) => {
  btn.addEventListener('click', () => setFilter(btn.dataset.filter));
});

// 단축키: / 또는 N → 입력창 (F-32). 앱 화면이 보일 때만
document.addEventListener('keydown', (e) => {
  if (appView.hidden) return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (e.code === 'Slash' || e.code === 'KeyN') {
    e.preventDefault();
    addInput.focus();
  }
});

// 인터넷 연결이 끊기거나 다시 잡히면 상태 표시 바꾸기
window.addEventListener('online', renderStatus);
window.addEventListener('offline', renderStatus);

// ---- 앱 설치·오프라인용 서비스 워커 등록 (11단계) ----
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('서비스 워커 등록 실패', err));
}

// ---- 시작 ----
captureImportFromHash();
catSelect.value = settings.lastCategory;
renderToday();
setInterval(renderToday, 60 * 1000);
showView('loading');
