// 이용자 행동 기록 (이 프로젝트의 최우선 목표 = 이용자 데이터 분석)
// - 익명 아이디(무작위)만 쓰고 이름·이메일 등 개인정보는 모으지 않음
// - 지금은 브라우저에 쌓아 두고, 서버(데이터베이스)가 생기면 ENDPOINT 로 보냄
// - 이용자가 끄면(동의 해제) 아무것도 기록하지 않음
export const GAME_VERSION = '0.1.0';
const QUEUE_KEY = 'nbagm_events_v1';
const UID_KEY = 'nbagm_uid';
const CONSENT_KEY = 'nbagm_consent';
const ENDPOINT = null; // 서버 준비되면 주소 입력 (예: 'https://.../events')

const safe = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 */ } },
};
const rid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

let uid = safe.get(UID_KEY);
if (!uid) { uid = rid(); safe.set(UID_KEY, uid); }
const sid = rid();                      // 이번 접속(세션) 아이디
let ctx = {};                           // 모든 기록에 붙는 상황 정보 (연도, 팀, 모드)
let screen = null, screenAt = 0;        // 화면 머문 시간 계산용

export const consent = () => safe.get(CONSENT_KEY) !== 'no';
export function setConsent(on) {
  if (!on) track('consent_off');        // 끄기 직전 한 번만 기록
  safe.set(CONSENT_KEY, on ? 'yes' : 'no');
  if (on) track('consent_on');
}
export function setContext(c) { ctx = { ...ctx, ...c }; }

function queue() { try { return JSON.parse(safe.get(QUEUE_KEY) || '[]'); } catch { return []; } }

export function track(event, props = {}) {
  if (!consent() && event !== 'consent_off') return;
  const q = queue();
  q.push({ event, ts: new Date().toISOString(), uid, sid, v: GAME_VERSION, ...ctx, props });
  safe.set(QUEUE_KEY, JSON.stringify(q.slice(-5000)));
  if (ENDPOINT) flush();
}

// 화면 이동: 이전 화면에 머문 시간을 같이 기록
export function screenView(name) {
  const now = performance.now();
  if (screen) track('screen_leave', { screen, seconds: Math.round((now - screenAt) / 100) / 10 });
  screen = name; screenAt = now;
  track('screen_view', { screen });
}
addEventListener('pagehide', () => {
  if (screen) track('screen_leave', { screen, seconds: Math.round((performance.now() - screenAt) / 100) / 10, closed: true });
});

export async function flush() {
  if (!ENDPOINT) return;
  const q = queue();
  if (!q.length) return;
  try {
    const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(q) });
    if (r.ok) safe.set(QUEUE_KEY, '[]');
  } catch { /* 다음에 다시 보냄 */ }
}

export const events = () => queue();
export function clearEvents() { safe.set(QUEUE_KEY, '[]'); }
