// 연장 계약 (모라토리엄이 끝난 뒤 ~ 개막 로스터 확정 전)
// - 신인 연장: 신인 계약 마지막(4번째) 시즌을 앞둔 1라운드 선수. 2017 협약 4년(지정 선수 5년, 팀당 2명), 2023 협약 5년. 최고 연봉 25%
// - 베테랑 연장: 3년 이상 계약을 맺고 2주년(3~4년 계약)·3주년(5년 이상)이 지난 선수. 최대 4년 추가,
//   연장 첫해 연봉 ≤ 마지막 해 연봉 × 120%(2017)·140%(2023) 또는 평균 연봉 × 120% 중 큰 값
// - 선수는 '지금 연장'과 '나중에 FA로 받을 돈'을 비교: 요구액 = 그때 예상 시장 가치 × 에이전트 성격, 안정감만큼 조금 깎아 줌
// 규정 출처: data/rules.json extension
import { state, writeSave } from './store.js';
import * as O from './offseason.js';
import * as F from './fa.js';
import { bpmOf } from './strength.js';

const S = () => state.data.season;
const L = () => state.data.league;
const EX = () => state.rules?.extension || {};
const teamOf = (abbr) => state.data.teams.find((t) => t.abbr === abbr);
const seasonAfter = (s, k) => { const a = +s.slice(0, 4) + k; return `${a}-${String(a + 1).slice(2)}`; };
const round1 = (v) => Math.round(v / 1e5) * 1e5;
export const ex = () => (state.save.ext ||= { talks: {}, done: [] });
const future = (p) => (p.contract?.years || []).filter((y) => y.season >= S());
const lastYear = (p) => future(p).slice(-1)[0];
const extended = (p) => ex().done.some((d) => d.pid === p.player_id);

// 대상 여부
export function kind(p) {
  if (p.roster_role === 'two_way' || extended(p)) return null;
  const ys = future(p);
  if (!ys.length) return null;
  if (ys.length === 1 && ys[0].kind === 'rookie_scale' && (p.contract?.years || []).filter((y) => y.kind === 'rookie_scale').length <= 4) return 'rookie';
  const signed = ys[0].signed;
  if (!signed || ys[0].kind === 'rookie_scale' || ys[0].kind === 'two_way') return null;
  // 계약 길이 추정: 서명한 시즌부터 마지막 해까지 (지난 해 기록이 없는 경우가 있어서 날짜로 계산)
  const startY = +signed.slice(0, 4) - (+signed.slice(5, 7) >= 7 ? 0 : 1), total = (+S().slice(0, 4) - startY) + ys.length;
  if (total < (EX().veteran?.min_contract_years || 3)) return null;
  const ann = total >= 5 ? 3 : 2, d = new Date(signed); d.setFullYear(d.getFullYear() + ann);
  return d.toISOString().slice(0, 10) <= today() ? 'veteran' : null;
}
const today = () => (state.save.phase === 'fa' ? F.curStep().date : `${state.save.year}-09-25`);
export const eligible = (abbr = state.save.team) => teamOf(abbr).roster.filter((p) => kind(p));
export const windowOpen = () => state.save.phase === 'roster' || (state.save.phase === 'fa' && !F.fa().done && F.fa().step >= F.steps().findIndex((x) => x.k === 'mor'));

// 한도: 연장 첫해 연봉 최대, 추가 기간 최대
export function limits(p) {
  const k = kind(p), svcAt = F.svcOf(p) + future(p).length, max = O.maxSalary(svcAt), cba = F.cba();
  if (k === 'rookie') {
    const desig = (ex().done.filter((d) => d.team === state.save.team && d.kind === 'rookie' && d.yrs === 5).length) < (EX().rookie?.designated_max_per_team || 2);
    const yrs = cba === '2023' ? (EX().rookie?.years?.['2023'] || 5) : desig ? 5 : 4;
    return { max: Math.min(max, L().salary_cap * (EX().rookie?.max_pct || 0.25)), yrs, raise: EX().raise || 0.08, note: cba === '2023' ? '2023 협약: 누구나 5년까지' : yrs === 5 ? '5년은 지정 선수(팀당 2명)' : '지정 선수 자리가 없어서 4년까지' };
  }
  const pct = EX().veteran?.first_year_pct?.[cba] || 1.2;
  const lim = Math.max((lastYear(p)?.salary || 0) * pct, (L().eaps_hold || 0) * (EX().veteran?.eaps_pct || 1.2));
  return { max: Math.min(max, round1(lim)), yrs: Math.min(EX().veteran?.add_years || 4, 5 - future(p).length + 1), raise: EX().raise || 0.08, note: `연장 첫해는 마지막 해 연봉의 ${Math.round(pct * 100)}% 또는 평균 연봉의 120%까지` };
}

// 선수 요구: 계약이 끝날 때의 예상 시장 가치 (나이에 따라 오르내림) × 에이전트 성격 × 안정감 할인
export function ask(p) {
  const ps = F.persona(p), n = future(p).length, age = (p.age || 26) + n;
  const grow = (p.age || 26) <= 24 ? Math.pow(1.12, n) : (p.age || 26) <= 27 ? Math.pow(1.04, n) : Math.pow(0.93, n);
  // 시장 가치와 실력(예상 BPM) 기준 가치 중 큰 값 (부상으로 한 시즌 빠진 선수 등은 시장 가치가 낮게 나옴)
  const base = Math.max(F.V(p), Math.max(0, bpmOf(p) + 2) * L().salary_cap * 0.035);
  const v = base * grow * 1.05;                                          // 캡이 오르는 만큼 조금 더
  const security = age >= 30 ? 0.9 : 0.95;
  const cap = kind(p) === 'rookie' ? limits(p).max : limits(p).max * 1.3;   // 신인은 FA가 돼도 최고 연봉이 같아서 한도까지만 요구
  return Math.max(O.minSalary(Math.min(F.svcOf(p) + n, 10)), round1(Math.min(cap, v * ps.askMul * security)));
}
export const wantYears = (p) => Math.min(limits(p).yrs, kind(p) === 'rookie' ? 5 : (p.age || 28) >= 30 ? 2 : 3);

export function salaries(o) { return Array.from({ length: o.yrs }, (_, i) => Math.round(o.s1 * (1 + (o.raise || 0) * i))); }
export function check(p, o) {
  const lim = limits(p), e = [];
  if (o.s1 > lim.max + 1) e.push(`연장 첫해 연봉 한도는 ${(lim.max / 1e6).toFixed(1)}M이에요 (${lim.note})`);
  if (o.yrs > lim.yrs) e.push(`최대 ${lim.yrs}년까지 연장할 수 있어요`);
  if (o.raise > lim.raise + 1e-9) e.push('연봉 인상은 해마다 8%까지예요');
  if (o.s1 < O.minSalary(Math.min(F.svcOf(p) + future(p).length, 10))) e.push('최저연봉보다 적어요');
  return e;
}
// 선수 점수: 평균 연봉 ÷ 요구 + 기간 보정 + 우리 팀 매력(우승 전력·역할·원소속팀이라 의리 만점)
function score(p, o) {
  const a = ask(p), sal = salaries(o), avg = sal.reduce((x, y) => x + y, 0) / sal.length;
  const want = wantYears(p), age = p.age || 26;
  let sc = avg / (a * (1 + 0.04 * (want - 1) / 2));
  const d = sal.length - want;
  if (d < 0) sc -= 0.04 * -d; else if (d > 0) sc += d * (age >= 29 ? 0.03 : age <= 24 ? -0.02 : 0);
  if (o.opt === 'player') sc += 0.03; if (o.opt === 'team') sc -= 0.05;
  return sc * F.fit(state.save.team, p).mult;
}

const LN = {
  hello: { tough: '연장이요? 저희는 FA에서 더 받을 수 있다고 봐요. 들어는 보죠.', fair: '연장 얘기라면 환영이에요. 조건이 맞으면 좋겠네요.', friendly: '선수도 이 팀에 오래 있고 싶어해요. 좋은 조건 기대할게요!' },
  accept: { tough: '좋습니다. 이 조건이면 연장하죠.', fair: '선수가 받아들이겠대요. 연장 합의!', friendly: '최고예요! 바로 사인할게요.' },
  counter: { tough: '모자라요. {c}면 생각해 보죠.', fair: '조금만 더요. {c}면 맞출 수 있어요.', friendly: '{c} 정도면 바로 사인할 것 같아요!' },
  low: { tough: '그럴 거면 FA로 나가는 게 낫겠네요.', fair: '차이가 꽤 커요. 내년 시장 가치를 생각해 주세요.', friendly: '음… 기대보다 많이 낮아요.' },
  walk: { tough: '연장 얘기는 여기까지 하죠. 시즌 끝나고 FA에서 봐요.', fair: '이번엔 연장하지 않고 시즌을 치르기로 했어요.', friendly: '아쉽지만 이번엔 연장은 어렵겠어요.' },
};
const ln = (st, k, c = '') => LN[k][st].replace('{c}', c);
export function talk(p) {
  const t = ex().talks;
  if (!t[p.player_id]) { const ps = F.persona(p); t[p.player_id] = { pat: Math.max(2, ps.patience - 2), log: [{ who: 'agent', text: ln(ps.style, 'hello') }], closed: false, counter: null }; }
  return t[p.player_id];
}
export function question(p) {
  const tk = talk(p), ps = F.persona(p);
  if (tk.closed) return tk;
  tk.log.push({ who: 'me', text: '연장한다면 원하는 조건이 뭔가요?' });
  if (tk.asked) tk.pat -= 1;
  tk.asked = true;
  const a = ask(p), y = wantYears(p);
  tk.log.push({ who: 'agent', text: a > limits(p).max ? `솔직히 FA에서 첫해 ${(a / 1e6).toFixed(1)}M 이상은 받을 거라 봐요. 연장 한도로는 맞추기 어려워요.` : `연장 첫해 ${(a / 1e6).toFixed(1)}M, ${y}년이면 좋겠어요.${ps.style === 'friendly' ? ' 조금은 조정할 수 있어요.' : ''}` });
  if (tk.pat <= 0) { tk.closed = true; tk.log.push({ who: 'agent', text: ln(ps.style, 'walk') }); }
  writeSave();
  return tk;
}
export function propose(p, o) {
  const tk = talk(p), ps = F.persona(p);
  if (tk.closed) return { r: 'closed', tk };
  const e = check(p, o); if (e.length) return { r: 'invalid', errors: e, tk };
  const sal = salaries(o);
  tk.log.push({ who: 'me', text: `${o.yrs}년 연장 · 첫해 ${(sal[0] / 1e6).toFixed(1)}M${o.raise ? ` · 매년 ${Math.round(o.raise * 100)}% 인상` : ''}${o.opt !== 'none' && o.yrs > 1 ? ` · 마지막 해 ${o.opt === 'player' ? '선수' : '팀'} 옵션` : ''} 제안합니다.` });
  const sc = score(p, o);
  let r;
  if (sc >= 1) { r = 'accept'; tk.log.push({ who: 'agent', text: ln(ps.style, 'accept') }); sign(p, o); tk.closed = true; }
  else if (sc >= 0.88) { r = 'counter'; tk.pat -= 1; const need = Math.min(limits(p).max, round1(o.s1 / sc * 1.01 + 5e4)); tk.counter = { ...o, s1: need }; tk.log.push({ who: 'agent', text: need >= limits(p).max && o.s1 / sc > limits(p).max ? '규정 한도까지 줘도 모자라요. 기간이나 옵션을 바꿔 보시죠.' : ln(ps.style, 'counter', `${o.yrs}년 첫해 ${(need / 1e6).toFixed(1)}M`) }); }
  else { r = 'low'; tk.pat -= sc < 0.72 ? 2 : 1; tk.log.push({ who: 'agent', text: ln(ps.style, 'low') }); }
  if (tk.pat <= 0 && r !== 'accept') { tk.closed = true; tk.log.push({ who: 'agent', text: ln(ps.style, 'walk') }); tk.log.push({ who: 'sys', text: '연장 협상 결렬: 이번 오프시즌에는 다시 연장 얘기를 할 수 없어요. 계약이 끝나면 FA가 돼요.' }); r = 'walk'; }
  writeSave();
  return { r, sc, tk };
}
function sign(p, o) {
  const last = lastYear(p), k = kind(p), sal = salaries(o);
  const years = sal.map((s, i) => ({ season: seasonAfter(last.season, i + 1), salary: s, cap_hit: s, guaranteed: i === sal.length - 1 && o.opt === 'team' && sal.length > 1 ? 0 : s,
    kind: 'extension', option: i === sal.length - 1 && sal.length > 1 ? (o.opt === 'player' ? 'player_option' : o.opt === 'team' ? 'team_option' : null) : null, signed: today() }));
  O.log({ t: 'extend', pid: p.player_id, team: state.save.team, years, kind: k });
  ex().done.push({ pid: p.player_id, team: state.save.team, kind: k, yrs: o.yrs, s1: sal[0], raise_pct: (sal[0] / (last.salary || sal[0])) - 1 });
  writeSave();
}
// 연장 직후 트레이드 제한 (베테랑 연장 첫해 인상 5% 초과)
export function tradeBlock(p) {
  const d = ex().done.find((x) => x.pid === p.player_id);
  return d && d.kind === 'veteran' && d.raise_pct > 0.05 ? '연장 계약 직후라 6개월 동안 트레이드할 수 없어요' : null;
}
