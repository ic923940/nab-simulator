// 로스터 정리 엔진 (트레이닝 캠프 → 개막 전날)
// - 정규 계약 14~15명, 투웨이 한도(2017 협약 2명 / 2023 협약 3명), 캠프 계약(Exhibit 10) 최대 6명
// - 방출: 남은 '보장 금액'이 데드머니로 남음. 비보장 계약은 개막 전에 방출하면 부담 없음
// - 스트레치: 8월 31일이 지나서(캠프 기간) 방출하면 이번 시즌 금액은 그대로, 다음 시즌부터 남은 금액을 (남은 해 × 2 + 1)년에 나눔
//   2023 협약은 스트레치 금액 합계가 샐러리캡의 15% 이하
// - 웨이버(48시간): 다른 구단이 클레임하면 계약을 그대로 넘겨받아 우리 데드머니가 없어짐
// 규정 출처: data/rules.json roster
import { state, writeSave } from './store.js';
import * as O from './offseason.js';
import * as F from './fa.js';
import { gmProfile, rng, hash } from './ai.js';
import { capSheet } from './capsheet.js';
import { teamPayroll } from './rules.js';
import { bpmOf } from './strength.js';

const S = () => state.data.season;
const L = () => state.data.league;
const RR = () => state.rules?.roster || {};
const teamOf = (abbr) => state.data.teams.find((t) => t.abbr === abbr);
const R = (tag) => rng(hash(`${state.save.seed}:ro:${tag}`))();
const minSal = (svc) => O.minSalary(Math.min(svc, 10));
const seasonAfter = (s, k) => { const a = +s.slice(0, 4) + k; return `${a}-${String(a + 1).slice(2)}`; };
export const ro = () => (state.save.ro ||= { news: [], depth: null, done: false });

export const twMax = () => RR().two_way_max?.[F.cba()] ?? (F.cba() === '2023' ? 3 : 2);
export const STD_MAX = () => RR().standard_max || 15;
export const STD_MIN = () => RR().standard_min || 14;
export const EX10_MAX = () => RR().exhibit10_max || 6;
export const isTW = (p) => p.roster_role === 'two_way';
export const isEx10 = (p) => p.contract?.signed_tool === 'ex10' || (p.contract?.years || []).some((y) => y.season === S() && y.kind === 'exhibit10');
export const stdOf = (t) => t.roster.filter((p) => !isTW(p));
export const twOf = (t) => t.roster.filter(isTW);
export const ex10Of = (t) => t.roster.filter(isEx10);
export function counts(abbr = state.save.team) {
  const t = teamOf(abbr);
  return { std: stdOf(t).length, tw: twOf(t).length, ex10: ex10Of(t).length, all: t.roster.length };
}
const ex10Bonus = () => RR().exhibit10_bonus?.[String(state.save.year)]?.max || 0;

// 앞으로 줘야 하는 보장 금액 (시즌별)
export function guaranteedLeft(p) {
  if (isTW(p)) return [];
  return (p.contract?.years || []).filter((y) => y.season >= S()).map((y) => {
    let g;
    if (y.kind === 'exhibit10') g = 0;
    else if (y.option === 'team_option' && y.season > S()) g = 0;                 // 앞으로의 팀 옵션: 방출하면 실행 안 한 것
    else if (y.option === 'player_option') g = y.salary;                          // 선수 옵션 해는 선수가 받을 권리가 있는 돈
    else if (y.season === S() && y.option_status === 'exercised') g = y.salary;
    else g = y.guaranteed ?? y.salary;
    return { season: y.season, amount: Math.max(0, Math.round(g || 0)), salary: y.salary, fixed: !!y.guarantee_fixed };
  });
}
const stretchedNow = (t) => (t.dead_money || []).filter((d) => d.stretch).reduce((a, d) => a + ((d.years || []).find((y) => y.season === seasonAfter(S(), 1))?.amount || 0), 0);

// 방출 미리 보기
export function preview(p, stretch = false, abbr = state.save.team) {
  const t = teamOf(abbr), g = guaranteedLeft(p);
  const cur = g.find((x) => x.season === S())?.amount || 0, future = g.filter((x) => x.season > S() && x.amount > 0);
  const futureTotal = future.reduce((a, x) => a + x.amount, 0);
  const bonus = isEx10(p) ? ex10Bonus() : 0;
  const out = { cur: cur + bonus, bonus, future, futureTotal, total: cur + bonus + futureTotal, canStretch: future.length > 0, err: null, dead: [] };
  if (!stretch) { out.dead = [{ season: S(), amount: cur + bonus }, ...future.map((x) => ({ season: x.season, amount: x.amount }))].filter((x) => x.amount > 0); return out; }
  if (!future.length) { out.err = '다음 시즌 이후 보장 금액이 없어서 스트레치할 게 없어요'; return out; }
  const n = future.length * 2 + 1, per = Math.round(futureTotal / n);
  out.dead = [{ season: S(), amount: cur + bonus }, ...Array.from({ length: n }, (_, i) => ({ season: seasonAfter(S(), i + 1), amount: per }))].filter((x) => x.amount > 0);
  out.stretchYears = n; out.per = per;
  const lim = RR().stretch?.cap_pct_2023;
  if (F.cba() === '2023' && lim && stretchedNow(t) + per > L().salary_cap * lim) out.err = `스트레치 금액 합계가 샐러리캡의 ${Math.round(lim * 100)}%를 넘어요 (2023 협약)`;
  return out;
}

// 웨이버 클레임: 지난 시즌 성적이 나쁜 팀부터, 계약이 그 팀이 보는 가치보다 싸고 받을 여유가 있으면
function claimer(p, from) {
  const sal = (p.contract?.years || []).find((y) => y.season === S())?.salary || 0;
  if (!sal || isEx10(p) || isTW(p)) return null;
  const rest = (p.contract.years || []).filter((y) => y.season >= S()).map((y) => y.salary);
  const avg = rest.reduce((a, b) => a + b, 0) / rest.length;
  const order = state.data.teams.filter((t) => t.abbr !== from && t.abbr !== state.save.team)
    .sort((a, b) => a.prev_season.w / (a.prev_season.w + a.prev_season.l) - b.prev_season.w / (b.prev_season.w + b.prev_season.l));
  for (const t of order) {
    if (stdOf(t).length >= STD_MAX()) continue;
    const pv = F.aiPV(t.abbr, p), svc = F.svcOf(p);
    const fits = capSheet(t.abbr).room >= sal || sal <= minSal(svc) * 1.05;
    if (fits && pv >= avg * 1.15 && R(`claim:${t.abbr}:${p.player_id}`) < 0.7) return t.abbr;
  }
  return null;
}

export function waive(p, stretch = false, abbr = state.save.team) {
  const pv = preview(p, stretch, abbr);
  if (pv.err) return { err: pv.err };
  const claim = claimer(p, abbr);
  const last = (p.contract?.years || []).find((y) => y.season === S())?.salary || null;
  O.log({ t: 'waive', pid: p.player_id, team: abbr, stretch: !!stretch, dead: claim ? [] : pv.dead, claim, last_salary: last });
  const mine = abbr === state.save.team, nm = teamOf(abbr).name;
  if (claim) news(`${teamOf(claim).name}, 웨이버로 ${p.name} 클레임 (${nm}에서 방출) · 계약을 그대로 넘겨받아요`, { mine, big: true });
  else news(`${nm}, ${p.name} 방출${stretch ? ' (스트레치)' : ''}${pv.total ? ` · 데드머니 총 $${(pv.total / 1e6).toFixed(1)}M` : ' · 비보장이라 부담 없음'}`, { mine });
  if (mine) dropDepth(p.player_id);
  writeSave();
  return { claim, pv };
}

// 투웨이 → 정규 계약 전환 (1년 최저연봉, 캡에 들어감)
export function canToStandard(p, abbr = state.save.team) {
  if (!isTW(p)) return '투웨이 선수가 아니에요';
  const t = teamOf(abbr), hc = F.hardCap(abbr), sal = minSal(F.svcOf(p));
  if (hc && teamPayroll(t, S()) + sal > hc.amount) return '하드캡을 넘게 돼요';
  return null;
}
export function toStandard(p, abbr = state.save.team) {
  const e = canToStandard(p, abbr); if (e) return { err: e };
  const sal = minSal(F.svcOf(p));
  O.log({ t: 'convert', pid: p.player_id, team: abbr, to: 'standard', years: [{ season: S(), salary: sal, cap_hit: sal, guaranteed: sal, kind: 'converted', option: null }] });
  news(`${teamOf(abbr).name}, ${p.name} 투웨이 → 정규 계약 전환`, { mine: abbr === state.save.team });
  writeSave(); return {};
}
// 캠프 계약(Exhibit 10) → 투웨이 전환
export function canToTwoWay(p, abbr = state.save.team) {
  if (!isEx10(p)) return '캠프 계약(Exhibit 10) 선수만 투웨이로 바꿀 수 있어요';
  if (F.svcOf(p) > (state.rules?.fa?.two_way?.service_max ?? 3)) return '경력 4년 이상은 투웨이 계약을 할 수 없어요';
  if (twOf(teamOf(abbr)).length >= twMax()) return `투웨이 자리가 꽉 찼어요 (${twMax()}명)`;
  return null;
}
export function toTwoWay(p, abbr = state.save.team) {
  const e = canToTwoWay(p, abbr); if (e) return { err: e };
  O.log({ t: 'convert', pid: p.player_id, team: abbr, to: 'two_way', years: [{ season: S(), salary: O.twoWaySalary(), cap_hit: 0, guaranteed: 0, kind: 'two_way', option: null }] });
  news(`${teamOf(abbr).name}, ${p.name} 캠프 계약 → 투웨이 전환`, { mine: abbr === state.save.team });
  writeSave(); return {};
}

// 캠프 계약: 남은 FA와 1년 최저연봉 비보장 (최저연봉급 선수만 받아들임)
export const campCandidates = () => state.data.free_agents.slice().sort((a, b) => F.V(b) - F.V(a));
export const acceptsCamp = (p) => F.V(p) <= minSal(F.svcOf(p)) * 1.2;   // 보장 계약을 받을 만한 선수는 캠프 계약을 거절
export function campError(p, abbr = state.save.team) {
  const c = counts(abbr);
  if (c.all >= (RR().offseason_max || 21)) return '로스터가 꽉 찼어요 (21명)';
  if (c.ex10 >= EX10_MAX()) return `캠프 계약은 ${EX10_MAX()}명까지예요`;
  if (!acceptsCamp(p)) return '보장 계약을 원해요 (FA 협상으로)';
  return null;
}
export function signCamp(p, abbr = state.save.team) {
  const e = campError(p, abbr); if (e) return { err: e };
  F.sign(p, abbr, { tool: 'ex10', s1: minSal(F.svcOf(p)), yrs: 1, raise: 0, opt: 'none' }, 'camp');
  writeSave(); return {};
}

// ── 뎁스 차트 (우리 팀): 선발 5명 + 벤치 순서 ──
const POSG = (pos) => { const s = String(pos || ''); return /C/.test(s) ? 'C' : /PF/.test(s) ? 'F' : /SF/.test(s) ? 'F' : 'G'; };
export function depth() {
  const t = teamOf(state.save.team), std = stdOf(t), ids = new Set(std.map((p) => p.player_id));
  let d = (ro().depth || []).filter((id) => ids.has(id));
  const rest = std.filter((p) => !d.includes(p.player_id)).sort((a, b) => bpmOf(b) - bpmOf(a)).map((p) => p.player_id);   // 처음 순서: 예상 실력(BPM) 순
  if (!ro().depth) {   // 처음: 가치 순으로 가드 2·포워드 2·센터 1을 맞춰 선발
    const by = rest.map((id) => std.find((p) => p.player_id === id)), pick = [], need = { G: 2, F: 2, C: 1 };
    for (const p of by) { const g = POSG(p.pos); if (need[g] > 0) { need[g]--; pick.push(p.player_id); } }
    for (const p of by) if (pick.length < 5 && !pick.includes(p.player_id)) pick.push(p.player_id);
    d = [...pick, ...rest.filter((id) => !pick.includes(id))];
  } else d = [...d, ...rest];
  ro().depth = d;
  return d.map((id) => std.find((p) => p.player_id === id));
}
export function moveDepth(pid, dir) { const d = ro().depth, i = d.indexOf(pid), j = i + dir; if (i < 0 || j < 0 || j >= d.length) return; [d[i], d[j]] = [d[j], d[i]]; writeSave(); }
function dropDepth(pid) { if (ro().depth) ro().depth = ro().depth.filter((x) => x !== pid); }
export function depthWarnings(list) {
  const st = list.slice(0, 5).map((p) => POSG(p.pos)), w = [];
  if (!st.includes('C') && !list.slice(0, 5).some((p) => /PF/.test(p.pos || ''))) w.push('선발에 센터·파워포워드가 없어요');
  if (st.filter((g) => g === 'G').length === 0) w.push('선발에 가드가 없어요');
  if (st.filter((g) => g === 'C').length >= 3) w.push('선발에 센터가 너무 많아요');
  return w;
}

// ── 개막 로스터 확정 ──
export function readyErrors(abbr = state.save.team) {
  const c = counts(abbr), e = [], t = teamOf(abbr), hc = F.hardCap(abbr);
  if (c.std > STD_MAX()) e.push(`정규 계약이 ${c.std}명이에요. ${STD_MAX()}명 이하로 줄여야 해요`);
  if (c.std < STD_MIN()) e.push(`정규 계약이 ${c.std}명이에요. 최소 ${STD_MIN()}명이 필요해요 (캠프 계약이나 남은 FA로 채우기)`);
  if (c.tw > twMax()) e.push(`투웨이가 ${c.tw}명이에요. ${twMax()}명 이하로 줄여야 해요`);
  if (hc && teamPayroll(t, S()) > hc.amount) e.push(`하드캡 ${(hc.amount / 1e6).toFixed(1)}M을 넘었어요`);
  return e;
}
// AI 구단 정리: 캠프 선수 투웨이 전환 → 정규 15명·투웨이 한도로 방출 → 14명 미만이면 최저연봉으로 채움
function aiCutdown() {
  const ai = state.data.teams.filter((t) => t.abbr !== state.save.team);
  const cost = (p) => guaranteedLeft(p).reduce((a, y) => a + y.amount, 0);
  for (const t of ai) {   // 1) 정리 (클레임으로 다른 팀 인원이 늘 수 있어서 채우기는 따로)
    for (const p of ex10Of(t).filter((x) => !canToTwoWay(x, t.abbr) && (x.age || 30) <= 25).sort((a, b) => F.V(b) - F.V(a))) if (twOf(t).length < twMax()) toTwoWay(p, t.abbr);
    let guard = 0;
    while (stdOf(t).length > STD_MAX() && guard++ < 12) {
      const p = stdOf(t).slice().sort((a, b) => (F.aiPV(t.abbr, a) + 0.8 * cost(a)) - (F.aiPV(t.abbr, b) + 0.8 * cost(b)))[0];
      waive(p, false, t.abbr);
    }
    guard = 0;
    while (twOf(t).length > twMax() && guard++ < 6) waive(twOf(t).sort((a, b) => F.aiPV(t.abbr, a) - F.aiPV(t.abbr, b))[0], false, t.abbr);
  }
  for (const t of ai) {   // 2) 넘친 팀 다시 정리, 모자란 팀은 최저연봉으로 채움 (하드캡에 막히면 13명으로 시작 — 규정상 최대 14일 허용)
    let guard = 0;
    while (stdOf(t).length > STD_MAX() && guard++ < 6) waive(stdOf(t).slice().sort((a, b) => (F.aiPV(t.abbr, a) + 0.8 * cost(a)) - (F.aiPV(t.abbr, b) + 0.8 * cost(b)))[0], false, t.abbr);
    guard = 0;
    while (stdOf(t).length < STD_MIN() && guard++ < 6) {
      const p = state.data.free_agents.filter((x) => !F.isRFA(x)).sort((a, b) => F.aiPV(t.abbr, b) - F.aiPV(t.abbr, a))
        .find((x) => !F.check(t.abbr, x, { tool: 'min', s1: 0, yrs: 1, raise: 0, opt: 'none' }).errors.length);
      if (!p) break;
      F.sign(p, t.abbr, { tool: 'min', s1: minSal(F.svcOf(p)), yrs: 1, raise: 0, opt: 'none' }, 'fa');
    }
  }
}
export function finalize() {
  const e = readyErrors(); if (e.length) return { errors: e };
  aiCutdown();
  ro().done = true; state.save.phase = 'preseason';
  news('개막 로스터가 확정됐어요.', { sys: true });
  writeSave();
  return {};
}
export function news(text, extra = {}) { ro().news.push({ text, ...extra }); }
