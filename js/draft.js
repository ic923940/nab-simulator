// 드래프트 진행 엔진: 지명 순서, 다른 구단 AI의 지명, 유망주 비교용 계산
// - AI는 그날 알 수 있던 정보만 씀: 전문가 예상 순위, 팀 로스터(포지션), 단장 성향, 무작위
// - 실제로 누가 지명됐는지는 전혀 쓰지 않음
import { state, currentPicks, writeSave } from './store.js';
import { gmProfile, rng, hash } from './ai.js';
import { chartValue } from './picks.js';

export const order = () => currentPicks().slice().sort((a, b) => a.pick - b.pick);

export function draftState() {
  const s = state.save;
  if (!s.draft) s.draft = { made: [], watch: [], pace: 'auto', started: false };
  return s.draft;
}
export const takenIds = () => new Set(draftState().made.map((m) => m.id));
export const available = () => { const t = takenIds(); return state.data.draft_pool.filter((p) => !t.has(p.player_id)); };
export const nextSlot = () => order()[draftState().made.length] || null;
export const isDone = () => draftState().made.length >= order().length;

// 포지션 묶음: 가드 / 포워드 / 센터
export function group(pos) {
  const toks = String(pos || '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (!toks.length) return null;
  const t0 = toks[0];
  if (t0 === 'C' || t0 === 'CENTER') return 'C';
  if (['PG', 'SG', 'G', 'GUARD'].includes(t0) || (toks[1] === 'GUARD')) return 'G';
  if (['WING', 'COMBO', 'SCORING'].includes(t0) && toks.includes('G')) return 'G';
  return 'F';
}
export const GROUP_KO = { G: '가드', F: '포워드', C: '센터' };

// 팀 로스터 포지션 수 (정규·예비 로스터, 투웨이 제외)
export function rosterGroups(abbr) {
  const t = state.data.teams.find((x) => x.abbr === abbr);
  const c = { G: 0, F: 0, C: 0 };
  for (const p of t.roster) if (p.roster_role !== 'two_way') { const g = group(p.pos); if (g) c[g]++; }
  // 이번 드래프트에서 이미 뽑은 선수도 셈
  for (const m of draftState().made) if (m.team === abbr) { const g = group(m.pos); if (g) c[g]++; }
  return c;
}
const WANT = { G: 5, F: 5, C: 3 };

// 예상 순위 (빅보드 밖 선수는 보드 크기 뒤쪽으로)
export function boardRank(p) {
  if (p.pre_draft_rank?.rank) return p.pre_draft_rank.rank;
  const size = p.pre_draft_rank?.board_size || state.data.draft_pool.find((x) => x.pre_draft_rank?.board_size)?.pre_draft_rank.board_size || 60;
  return size + 8 + (hash(p.player_id) % 30);
}
const rankValue = (r) => (r <= 60 ? chartValue(r) : chartValue(60) * Math.pow(0.97, r - 60));

function gauss(r) { const u = Math.max(r(), 1e-9), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// 다른 구단 AI 한 번 지명
export function aiChoose(abbr, slot) {
  const g = gmProfile(abbr), r = rng(hash(`${state.save.seed}:draft:${slot.pick}:${abbr}`));
  const have = rosterGroups(abbr), pool = available();
  const best = Math.min(...pool.map(boardRank));
  let top = null;
  for (const p of pool) {
    const rk = boardRank(p), grp = group(p.position);
    const need = grp ? Math.max(0, WANT[grp] - have[grp]) / WANT[grp] : 0;
    let v = rankValue(rk) * (1 + 0.12 * need);
    let why = null;
    if (g.mode === 'rebuild' && p.age_at_draft && p.age_at_draft <= 20) { v *= 1.06; why = 'young'; }
    if (g.mode === 'contend' && p.age_at_draft && p.age_at_draft >= 22) { v *= 1.05; why = 'ready'; }
    // 판단 흔들림: 최상위 유망주일수록 작게 (1순위 후보는 구단들 평가가 거의 같음)
    v *= Math.exp(gauss(r) * (0.10 + g.noise) * Math.min(1.8, 0.35 + rk / 15));   // 2라운드 후보로 갈수록 평가가 더 갈림
    if (!top || v > top.v) top = { p, v, need, why, rk };
  }
  const p = top.p, grp = group(p.position);
  const reason = top.rk === best ? '남은 선수 중 전문가 예상 순위가 가장 높아요'
    : top.need >= 0.4 && grp ? `${GROUP_KO[grp]}가 부족해서 보강`
    : top.why === 'young' ? '리빌딩 중이라 어린 선수의 성장 가능성을 봤어요'
    : top.why === 'ready' ? '우승 도전 중이라 바로 뛸 수 있는 선수를 골랐어요'
    : top.rk > best + 12 ? '구단 자체 평가로 깜짝 지명'
    : '구단 평가로 선택';
  return { p, reason };
}

export function record(slot, p, by, reason) {
  const d = draftState();
  d.made.push({ pick: slot.pick, round: slot.round, team: slot.team, id: p.player_id, name: p.name, pos: p.position,
    rank: p.pre_draft_rank?.rank ?? null, by, reason: reason || null });
  writeSave();
}

// ── 유망주 비교: 그해 유망주 중 상위 몇 % ──
const LOWER_BETTER = new Set(['lane_agility', 'three_quarter_sprint']);
export function percentile(key, value, getter) {
  if (value === null || value === undefined) return null;
  const vals = state.data.draft_pool.map(getter || ((p) => p.combine?.[key])).filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  if (vals.length < 5) return null;
  const better = vals.filter((v) => (LOWER_BETTER.has(key) ? v > value : v < value)).length;
  return Math.round((better / (vals.length - 1 || 1)) * 100);   // 100 = 올해 최고
}
