// 지명권 공통: 이번 드래프트 지명권 + 미래 지명권(시작 연도 +1 ~ 최대 +4년, 2026년까지 검증된 자료)
// - 미래 지명권 자료: data/future_picks.json (그해 드래프트 시작 전 기준, 그 뒤 결과는 들어 있지 않음)
// - 트레이드로 바뀐 주인은 저장 파일의 futOwners에 기록
import { state, picksOf } from './store.js';
import { esc } from './util.js';

export const chartValue = (pick) => state.pv.value[Math.min(pick, state.pv.value.length) - 1] ?? 1;

const fut = () => state.fp?.[String(state.save.year)] || { picks: [], years: [] };
export const futureYears = () => fut().years;
export const fkey = (p) => `f:${p.year}:${p.round}:${p.original}`;
const ownerOf = (p) => state.save.futOwners?.[fkey(p)] ?? p.owner;

// 한 구단이 가진 지명권 전체 (이번 드래프트 + 미래)
export function assetsOf(abbr) {
  const cur = picksOf(abbr).map((o) => ({ kind: 'cur', key: `c:${o.pick}`, year: state.save.year, round: o.round, pick: o.pick,
    original: o.original_team || o.team, holder: abbr, tradable: true }));
  // 자기 팀 지명권을 자기가 들고 있으면 보호 조건은 의미 없음 (예전에 걸렸던 조건 문구가 남은 경우)
  const f = fut().picks.filter((p) => ownerOf(p) === abbr).map((p) => ({ kind: 'fut', key: fkey(p), year: p.year, round: p.round,
    original: p.original, protection: p.original === abbr ? null : p.protection, range: p.original === abbr ? null : p.protected_range, claims: p.claims || [], holder: abbr, tradable: p.tradable }));
  return [...cur, ...f.sort((a, b) => a.year - b.year || a.round - b.round || a.original.localeCompare(b.original))];
}
// 원래 우리 팀 지명권인데 지금 다른 팀이 가진 것 (실제 이전 트레이드 결과. 참고 표시용)
export function awayOf(abbr) {
  const y = state.save.year, curOwn = picksOf(abbr).filter((o) => (o.original_team || o.team) === abbr);
  const cur = [1, 2].filter((r) => !curOwn.some((o) => o.round === r)).map((r) => {
    const o = (state.save.picks || []).find((x) => x.round === r && x.original_team === abbr);
    return { year: y, round: r, owner: o ? o.team : null, pick: o?.pick };
  });
  const f = fut().picks.filter((p) => p.original === abbr && !p.forfeited && ownerOf(p) !== abbr).map((p) => ({ year: p.year, round: p.round, owner: ownerOf(p), protection: p.protection }));
  return [...cur, ...f];
}
// 징계로 없어진 지명권 (참고 표시용)
export const forfeitedOf = (abbr) => fut().picks.filter((p) => p.forfeited && p.original === abbr);

export function setOwner(asset, abbr) {
  if (asset.kind === 'cur') { const o = state.save.picks.find((x) => x.pick === asset.pick); if (o) o.team = abbr; return; }
  (state.save.futOwners ||= {})[asset.key] = abbr;
}

// 보호 조건 설명 (한국어: data/protection_ko.json, 없으면 짧은 표시만)
export const protKO = (a) => (a.protection ? state.protKo?.[a.protection] || '보호 조건이 있어요 (세부 조건 번역 준비 중).' : '');
// 보호 조건 짧은 표시
export function protLabel(a) {
  if (a.kind === 'cur' || !a.protection) return '';
  if (a.range) {
    const [lo, hi] = a.range, base = a.round === 2 ? 30 : 0;
    const L = lo + (a.round === 2 && lo <= 30 ? base : 0), H = hi + (a.round === 2 && hi <= 30 ? base : 0);
    return L <= 1 || L === 31 ? `${H}위까지 보호` : `${L}~${H}위 보호`;
  }
  return '보호 조건 있음';
}

export function assetLabel(a, { html = true } = {}) {
  if (a.kind === 'cur') return `${a.year} ${a.round}R ${a.pick}순위${a.original && a.original !== a.holder && html ? ` <span class="muted">(${esc(a.original)} 원래)</span>` : ''}`;
  return `${a.year} ${a.round}R ${html ? `<b>${esc(a.original)}</b>` : a.original}`;
}
export const plainLabel = (a) => a.kind === 'cur' ? `${a.year} ${a.round}R ${a.pick}순위` : `${a.year} ${a.round}R(${a.original})`;

// ── 미래 지명권 예상 가치 ──
// 원래 팀의 지난 시즌 전력(SRS) 순위로 예상 순위를 잡고, 먼 해일수록 리그 평균(15.5위) 쪽으로 당기고 불확실성을 키움
let rankCache = null;
function nowSlot(abbr) {
  if (!rankCache || rankCache.y !== state.save.year) {
    const ts = state.data.teams.slice().sort((a, b) => a.prev_season.srs - b.prev_season.srs);
    rankCache = { y: state.save.year, m: Object.fromEntries(ts.map((t, i) => [t.abbr, i + 1])) };
  }
  return rankCache.m[abbr] || 15.5;
}
function slotDist(abbr, n) {
  const m = 15.5 + (nowSlot(abbr) - 15.5) * Math.pow(0.6, n), sd = 4 + 2.5 * n;
  const w = Array.from({ length: 30 }, (_, i) => Math.exp(-(((i + 1 - m) / sd) ** 2) / 2));
  const s = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / s);
}
// 받는 쪽 입장 가치 (보호 구간이면 이번 해엔 못 받음 → 미뤄지거나 2라운드로 바뀌는 몫만 조금 인정)
export function futureBaseValue(a, disc = 0.92) {
  const n = Math.max(1, a.year - state.save.year);
  const d = slotDist(a.original, n);
  const base = a.round === 2 ? 30 : 0;
  let v = 0;
  for (let i = 0; i < 30; i++) {
    const slot = i + 1 + base;
    const prot = a.range && slot >= (a.range[0] + (a.round === 2 && a.range[0] <= 30 ? base : 0)) && slot <= (a.range[1] + (a.round === 2 && a.range[1] <= 30 ? base : 0));
    v += d[i] * chartValue(slot) * (prot ? 0.3 : 1);
  }
  if (a.protection && !a.range) v *= 0.8;          // 조건을 읽지 못한 보호: 보수적으로
  return v * Math.pow(disc, n);
}
export const baseValue = (a) => (a.kind === 'cur' ? chartValue(a.pick) : futureBaseValue(a));

// ── Stepien 규칙: 1라운드 지명권이 2년 연속 '확실히 없는' 상태가 되면 안 됨 ──
// 확실히 있다 = 그해 1라운드 지명권을 보호 조건 없이 가지고 있음 (보호 붙은 건 못 받을 수도 있어서 안 셈)
function sureFirsts(abbr, y, moved) {
  const s = state.save;
  const own = (a, o) => (moved.has(a) ? moved.get(a) : o);
  if (y === s.year) return s.picks.filter((o) => o.round === 1 && own(`c:${o.pick}`, o.team) === abbr).length;
  return fut().picks.filter((p) => p.year === y && p.round === 1 && !p.forfeited && own(fkey(p), ownerOf(p)) === abbr && (!p.protection || p.original === abbr)).length;
}
function stepienBad(abbr, moved) {
  const ys = [state.save.year, ...futureYears()], bad = [];
  for (let i = 0; i + 1 < ys.length; i++) if (!sureFirsts(abbr, ys[i], moved) && !sureFirsts(abbr, ys[i + 1], moved)) bad.push(`${ys[i]}·${ys[i + 1]}`);
  return bad;
}
// 거래 뒤 새로 규칙을 어기는 구단이 있으면 그 내용을 돌려줌 (원래부터 그런 상태는 막지 않음)
export function stepienCheck(me, partner, give, get) {
  const moved = new Map([...give.map((a) => [a.key, partner]), ...get.map((a) => [a.key, me])]);
  const out = [];
  for (const t of [me, partner]) {
    const before = new Set(stepienBad(t, new Map())), after = stepienBad(t, moved).filter((x) => !before.has(x));
    if (after.length) out.push({ team: t, years: after });
  }
  return out;
}
