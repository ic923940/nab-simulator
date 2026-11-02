// 게임 상태와 데이터 불러오기
// - 연도별 데이터(data/2024.json 등)는 그해 드래프트 당일까지의 정보만 담음
// - 실제 결과(reveal_*.json)는 게임이 끝난 뒤에만 불러옴 (플레이 중 사용 금지)
const SAVE_KEY = 'nbagm_save_v1';
export const SAVE_VERSION = 2;   // 2 = FA·로스터 정리·트레이드·시즌 전망까지 들어간 구조 (2026-10)

export const state = {
  save: null,     // { year, team, mode, startedAt }
  data: null,     // 선택한 연도의 데이터
  lot: null,      // 로터리 자료 (lottery.json)
  pv: null,       // 지명권 가치 곡선 (pick_value.json)
  fp: null,       // 미래 지명권 (future_picks.json, 시작 연도별)
  rules: null,    // CBA 수치 (rules.json)
  cal: null,      // 연도별 실제 일정 (calendar.json)
  proj: null,     // 실력 예측 공용 자료 (proj.json: 신인 순위별 BPM)
};

// 게임 공용 자료 (한 번만 불러옴)
export async function loadShared() {
  if (!state.lot) state.lot = await (await fetch('data/lottery.json')).json();
  if (!state.pv) state.pv = await (await fetch('data/pick_value.json')).json();
  if (!state.fp) state.fp = await (await fetch('data/future_picks.json')).json();
  if (!state.rules) state.rules = await fetch('data/rules.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  if (!state.proj) state.proj = await fetch('data/proj.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!state.protKo) state.protKo = await fetch('data/protection_ko.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  if (!state.cal) state.cal = await fetch('data/calendar.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
}

// 지금 지명권 주인 목록 (로터리·트레이드 결과 반영, 아직이면 실제 드래프트 시작 시점)
export const currentPicks = () => state.save?.picks || state.data.draft_order;
export const picksOf = (abbr) => currentPicks().filter((o) => o.team === abbr);

export function loadSave() {
  try { state.save = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { state.save = null; }
  if (state.save) {   // 예전 저장 파일 맞추기
    if (!state.save.seed) state.save.seed = Math.floor(Math.random() * 2 ** 31);
    if (!state.save.phase || state.save.phase === 'draft_day') state.save.phase = 'lottery';
    if (!state.save.futOwners) state.save.futOwners = {};
    state.save.old = (state.save.v || 1) < SAVE_VERSION;   // 예전 구조 저장 파일 (시작 화면에서 안내)
  }
  return state.save;
}
export function writeSave() {
  if (state.save && !state.save.v) state.save.v = state.save.old ? 1 : SAVE_VERSION;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state.save)); } catch { /* 저장 불가 */ }
}
export function clearSave() {
  state.save = null; state.data = null;
  try { localStorage.removeItem(SAVE_KEY); } catch { /* */ }
}

const cache = {};
export async function loadYear(y) {
  if (!cache[y]) {
    const r = await fetch(`data/${y}.json`);
    if (!r.ok) throw new Error(`${y}년 데이터를 불러오지 못했어요 (${r.status})`);
    cache[y] = await r.json();
  }
  return structuredClone(cache[y]);   // 게임 중 바뀌는 내용(계약 결정 등)이 원본에 섞이지 않게 복사본
}

export const YEARS = [
  { y: 2020, draft: '2020-11-18' }, { y: 2021, draft: '2021-07-29' }, { y: 2022, draft: '2022-06-23' },
  { y: 2023, draft: '2023-06-22' }, { y: 2024, draft: '2024-06-26' }, { y: 2025, draft: '2025-06-25' },
];

export const myTeam = () => state.data.teams.find((t) => t.abbr === state.save.team);
export const teamBy = (abbr) => state.data.teams.find((t) => t.abbr === abbr);
