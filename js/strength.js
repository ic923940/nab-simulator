// 팀 전력 예측: 선수 예상 BPM × 예상 출전 시간 → 팀 순득실(100포제션당) → 예상 승수
// - 선수 BPM: data/{연도}.json 의 proj (league/proj_model.py, 드래프트 날까지 기록만 사용)
// - 신인: 1989~2019 드래프트 순위별 신인 시즌 BPM 평균 (data/proj.json)
// - 출전 시간: 뎁스 순서별 기본 시간 × 예상 출전 비율, 합 240분에 맞춤. 모자라면 대체 선수(BPM -2)가 채움
// - 승수: 41 + 2.7 × (팀 순득실 − 리그 평균). 리그 평균을 0으로 맞추므로 실제 결과를 쓰지 않음
import { state } from './store.js';
import { adjust as slAdjust, injPenalty } from './summer.js';

const SLOT = [34, 33, 32, 31, 30, 26, 22, 18, 15, 12, 8, 5, 3, 2, 1];
export const EAST = ['ATL', 'BOS', 'BRK', 'CHO', 'CHI', 'CLE', 'DET', 'IND', 'MIA', 'MIL', 'NYK', 'ORL', 'PHI', 'TOR', 'WAS'];
export const confOf = (abbr) => (EAST.includes(abbr) ? 'E' : 'W');
const PJ = () => state.proj || { rookie: {}, repl: -2, wins_per_net: 2.7 };

export function bpmOf(p) {
  if (p.proj?.bpm != null && (p.proj.n || 0) >= 150) return p.proj.bpm;
  const pick = p.rookie?.pick;
  if (pick && PJ().rookie[String(pick)]) return PJ().rookie[String(pick)].bpm + slAdjust(p);   // 신인: 순위별 기대값 + 서머리그 활약 일부
  if (p.proj?.bpm != null) return (p.proj.bpm * (p.proj.n || 0) + PJ().repl * (150 - (p.proj.n || 0))) / 150;   // 기록이 아주 적으면 대체 수준 쪽으로
  return PJ().repl;
}
export const availOf = (p) => Math.max(0.4, (p.proj?.avail ?? 0.85) - injPenalty(p));

// AI 구단 뎁스: 예상 BPM 순, 선발은 가드 2·포워드 2·센터 1
const POSG = (pos) => { const s = String(pos || ''); return /C/.test(s) ? 'C' : /PF|SF/.test(s) ? 'F' : 'G'; };
export function autoDepth(players) {
  const by = players.slice().sort((a, b) => bpmOf(b) - bpmOf(a)), pick = [], need = { G: 2, F: 2, C: 1 };
  for (const p of by) { const g = POSG(p.pos); if (need[g] > 0) { need[g]--; pick.push(p); } }
  for (const p of by) if (pick.length < 5 && !pick.includes(p)) pick.push(p);
  return [...pick, ...by.filter((p) => !pick.includes(p))];
}

// order: 뎁스 순서대로 선수 배열 (투웨이 제외)
export function teamRating(order) {
  const rows = order.map((p, i) => ({ p, bpm: bpmOf(p), min: (SLOT[i] ?? 0) * availOf(p) }));
  let tot = rows.reduce((a, r) => a + r.min, 0);
  if (tot > 240) { const k = 240 / tot; rows.forEach((r) => (r.min *= k)); tot = 240; }
  const repl = 240 - tot;
  const net = (rows.reduce((a, r) => a + r.min * r.bpm, 0) + repl * PJ().repl) / 48;
  return { net, rows, repl };
}
const stdPlayers = (t) => t.roster.filter((p) => p.roster_role !== 'two_way');

// 리그 전체 예상: depthFor(abbr) → 우리 팀 뎁스(없으면 자동)
export function leagueProjection(teams = state.data.teams, depthFor = null) {
  const list = teams.map((t) => {
    const order = (depthFor && depthFor(t.abbr)) || autoDepth(stdPlayers(t));
    return { abbr: t.abbr, name: t.name, ...teamRating(order) };
  });
  const mean = list.reduce((a, x) => a + x.net, 0) / list.length;
  for (const x of list) { x.adj = x.net - mean; x.wins = Math.max(12, Math.min(70, 41 + PJ().wins_per_net * x.adj)); x.conf = confOf(x.abbr); }
  odds(list);
  return list;
}

// 플레이오프 확률: 예상 승수 ± 표준편차 6.5승(검증 오차 수준)으로 2,000번 모의 → 콘퍼런스 6위 안(직행), 10위 안(플레이인 포함)
function odds(list) {
  let s = 12345;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const N = 2000; list.forEach((x) => { x.p6 = 0; x.p10 = 0; x.pBest = 0; });
  for (let i = 0; i < N; i++) {
    const sim = list.map((x) => ({ x, w: x.wins + gauss() * 6.5 }));
    for (const c of ['E', 'W']) sim.filter((y) => y.x.conf === c).sort((a, b) => b.w - a.w).forEach((y, k) => { if (k < 6) y.x.p6++; if (k < 10) y.x.p10++; });
    sim.sort((a, b) => b.w - a.w)[0].x.pBest++;
  }
  list.forEach((x) => { x.p6 /= N; x.p10 /= N; x.pBest /= N; });
}
export function confRank(list, abbr) {
  const me = list.find((x) => x.abbr === abbr);
  return list.filter((x) => x.conf === me.conf).sort((a, b) => b.wins - a.wins).findIndex((x) => x.abbr === abbr) + 1;
}
