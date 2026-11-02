// 서머리그 (게임 속 결과 — 실제 서머리그 기록이 아님)
// - 실제 서머리그는 드래프트 날 이후 정보라서 쓰지 않음. 대신 게임이 신인마다 '서머리그 활약'을 만들어 냄
// - 활약 = 지명 순위로 본 기대 실력(BPM) + 무작위(표준편차 2.6). 신인 예상 실력에 그 차이 일부만 반영 (몇 경기로 단정하지 않음)
// - 우리 신인은 이용자가 기용 방법을 고름 (많이 / 보통 / 쉬게):
//     많이 = 5경기, 반영 35%, 경험 +0.15, 가벼운 부상 5% / 보통 = 3~5경기, 반영 25% / 쉬게 = 0~1경기, 반영 10%, 부상 없음
// - 시점: 실제 일정의 라스베이거스 서머리그가 끝난 뒤 첫 FA 날짜. 2020년은 실제로 취소돼서 열리지 않음
import { state, writeSave } from './store.js';
import * as F from './fa.js';
import { rng, hash } from './ai.js';

const PJ = () => state.proj || { rookie: {}, repl: -2 };
export const sl = () => (state.save.sl ||= { done: false, rows: {} });
const cal = () => state.cal?.[String(state.save.year)]?.summer_league?.value;
export const cancelled = () => cal() === 'cancelled';
export function lvEnd() {
  const v = cal(); if (!Array.isArray(v) || !v.length) return null;
  const lv = v.find((x) => /Las Vegas/i.test(`${x.name} ${x.location}`)) || v[v.length - 1];
  return lv.end || lv.start;
}
const prior = (pick) => (pick && PJ().rookie[String(pick)] ? PJ().rookie[String(pick)].bpm : -2.6);
const gauss = (r) => { const u = Math.max(r(), 1e-9), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const POSG = (pos) => { const s = String(pos || ''); return /C/.test(s) ? 'C' : /PF|SF|F/.test(s) ? 'F' : 'G'; };
export const PLAN = {
  heavy: { ko: '많이 뛰게', g: [5, 5], w: 0.35, dev: 0.15, inj: 0.05, note: '5경기 모두 출전. 실력이 더 분명하게 드러나고(반영 35%) 경험도 쌓여요. 가벼운 부상 위험 5%' },
  normal: { ko: '보통', g: [3, 5], w: 0.25, dev: 0, inj: 0.02, note: '3~5경기. 활약의 25%를 예상 실력에 반영해요' },
  rest: { ko: '쉬게', g: [0, 1], w: 0.1, dev: 0, inj: 0, note: '0~1경기. 부상 걱정은 없지만 보여 줄 기회도 거의 없어요(반영 10%)' },
};
const isRookie = (p) => !!p.rookie || (p.experience_seasons === 0 && p.contract?.signed_with);
export const ourRookies = () => (state.data.teams.find((t) => t.abbr === state.save.team)?.roster || []).filter(isRookie);
// 서머리그를 치를 때가 됐는지
export function due() {
  const s = sl();
  if (s.done || cancelled() || (state.save.phase !== 'fa' && state.save.phase !== 'roster')) return false;
  const end = lvEnd(); if (!end) return false;
  const today = state.save.phase === 'roster' ? '9999' : F.curStep().date;
  return today >= end;
}
// 우리 신인 기용 방법을 아직 안 골랐으면 먼저 물어봄
export const needPlan = () => due() && !sl().plan && ourRookies().length > 0;
export function setPlan(plan) { sl().plan = plan; writeSave(); }

const SCOUT = {
  up: ['프로 무대에 빨리 적응했어요. 기대 이상이에요.', '자신감 있게 공격을 이끌었어요. 코치진이 놀랐대요.'],
  even: ['지명 순위만큼 해 줬어요. 무난한 첫 무대예요.', '좋은 날과 아쉬운 날이 섞였어요. 평범한 출발이에요.'],
  down: ['속도와 몸싸움에 적응이 더 필요해 보여요.', '슛 감각이 안 올라왔어요. 아직 판단은 이르지만 걱정되는 출발이에요.'],
};
function scoutLine(r, grp, line, d, rand) {
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const base = pick(d > 1.5 ? SCOUT.up : d < -1.5 ? SCOUT.down : SCOUT.even);
  const extra = line.fg >= 0.5 ? ' 슈팅 효율이 좋았어요.' : line.fg < 0.38 ? ' 야투율은 낮았어요.' : '';
  const role = grp === 'G' && line.ast >= 5 ? ' 경기 운영 시야가 돋보였어요.' : grp === 'C' && line.reb >= 9 ? ' 골밑 리바운드 장악력이 인상적이었어요.' : grp === 'F' && line.pts >= 16 ? ' 득점력이 눈에 띄었어요.' : '';
  return base + extra + role;
}

// 지금 날짜가 서머리그가 끝난 뒤면 결과 만들기 (한 번만). 우리 신인 기용을 안 골랐으면 기다림
export function maybeRun() {
  const s = sl();
  if (!due() || needPlan()) return false;
  const today = state.save.phase === 'roster' ? '9999' : F.curStep().date, me = state.save.team;
  for (const t of state.data.teams) for (const p of t.roster) {
    if (!isRookie(p)) continue;
    const id = p.prospect_id || p.player_id, r = rng(hash(`${state.save.seed}:sl:${id}`));
    const pick = p.rookie?.pick || null, pr = prior(pick), perf = pr + gauss(r) * 2.6;
    const planK = t.abbr === me ? (s.plan?.[id] || 'normal') : (pick && pick <= 5 && r() < 0.15 ? 'rest' : 'normal');   // 다른 팀 상위 지명자는 몸 관리로 빠지기도 함
    const pl = PLAN[planK], g = pl.g[0] + Math.floor(r() * (pl.g[1] - pl.g[0] + 1));
    const usage = !pick ? 8 : pick <= 5 ? 17 : pick <= 14 ? 14 : pick <= 30 ? 11 : 9, grp = POSG(p.pos), d = perf - pr;
    const games = Array.from({ length: g }, () => ({
      pts: Math.max(0, Math.round(usage * (planK === 'heavy' ? 1.1 : 1) + d * 1.4 + gauss(r) * 5)), reb: Math.max(0, Math.round({ C: 7.5, F: 5.5, G: 3.8 }[grp] + d * 0.35 + gauss(r) * 2.2)),
      ast: Math.max(0, Math.round({ C: 1.4, F: 2.2, G: 4.2 }[grp] + d * 0.3 + gauss(r) * 1.6)), fg: Math.min(0.75, Math.max(0.15, 0.44 + d * 0.012 + gauss(r) * 0.08)),
    }));
    const avg = (k) => games.reduce((a, x) => a + x[k], 0) / (g || 1);
    const line = g ? { g, pts: avg('pts'), reb: avg('reb'), ast: avg('ast'), fg: avg('fg'), games } : null;
    const inj = g && r() < pl.inj;
    s.rows[id] = { team: t.abbr, name: p.name, pick, prior: pr, perf: g ? perf : pr, rest: planK === 'rest', plan: planK, w: pl.w, dev: pl.dev, inj, line,
      scout: line ? scoutLine(null, grp, line, d, r) : '몸 관리로 거의 뛰지 않았어요.' };
  }
  s.done = true; s.date = today === '9999' ? null : today;
  // 속보: 우리 신인 + 눈에 띈 신인
  const list = Object.values(s.rows).filter((x) => x.line);
  const hot = list.slice().sort((a, b) => (b.perf - b.prior) - (a.perf - a.prior)).slice(0, 3);
  if (state.save.phase === 'fa') {
    F.news('서머리그가 끝났어요. 신인들의 첫 무대 성적이 나왔어요 (게임 속 결과).', { sys: true });
    for (const x of Object.values(s.rows).filter((y) => y.team === me)) F.news(`서머리그: 우리 ${x.pick ? x.pick + '순위 ' : ''}${x.name} ${x.line ? `${x.line.g}경기 평균 ${x.line.pts.toFixed(1)}득점 ${x.line.reb.toFixed(1)}리바` : '결장'}${x.inj ? ' · 가벼운 부상' : ''}`, { mine: true });
    for (const x of hot.filter((y) => y.team !== me)) F.news(`서머리그: ${x.name}(${x.team}) 평균 ${x.line.pts.toFixed(1)}득점 ${x.line.reb.toFixed(1)}리바 · 기대 이상`, {});
  }
  writeSave();
  return true;
}
// 신인 예상 실력 보정값 (strength.js 에서 사용): 활약 차이 × 반영 비율 + 경험
export function adjust(p) {
  const r = state.save?.sl?.rows?.[p.prospect_id || p.player_id];
  return r && r.line ? (r.perf - r.prior) * (r.w ?? 0.25) + (r.dev || 0) : 0;
}
// 서머리그 부상: 예상 출전 비율 −5%p (저장 기록에서 읽어서 다시 불러와도 유지)
export const injPenalty = (p) => (state.save?.sl?.rows?.[p.prospect_id || p.player_id]?.inj ? 0.05 : 0);
