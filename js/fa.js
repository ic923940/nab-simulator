// FA 협상 엔진
// ─ 시간: 실제 일정(협상 시작 → 모라토리엄 종료 → 7·8·9월)을 몇 단계로 나눠 진행. 모라토리엄 전에는 '합의', 끝나면 공식 서명
// ─ 선수: 성향(돈·우승·역할·의리 비중)과 에이전트 성격(강경·원칙·우호)이 게임마다 다름 (게임 설정, 실제 선수의 성격 아님)
// ─ 요구액: 시장 가치 모델 × 에이전트 성격. 결정할 때가 지나도 계약이 없으면 조금씩 내려감
// ─ 경쟁: 다른 29개 구단이 캡 상황(캡 공간·MLE·버드 권리·최저연봉)에 맞게 제안. 선수는 '돈 + 팀 매력'이 가장 좋은 곳과 계약
// ─ RFA: 다른 팀 오퍼시트 → 원소속팀 매칭(2017 협약 2일, 2023 협약 24시간). 끝까지 계약이 없으면 QO 수락
// 규정 수치: data/rules.json 의 fa (출처 포함)
import { state, writeSave } from './store.js';
import { gmProfile, rng, hash } from './ai.js';
import * as O from './offseason.js';
import { capSheet, faHold } from './capsheet.js';
import { teamPayroll } from './rules.js';

const L = () => state.data.league;
const S = () => state.data.season;
const FR = () => state.rules?.fa || {};
export const cba = () => ((L().cba || '').startsWith('2023') ? '2023' : '2017');
const EX = () => FR().exceptions?.[cba()] || {};
const teamOf = (abbr) => state.data.teams.find((t) => t.abbr === abbr);
export const svcOf = (p) => p.contract?.service_years ?? p.experience_seasons ?? 0;
const minSal = (svc) => O.minSalary(Math.min(svc, 10));
export const V = (p) => Math.max(O.value(p), minSal(svcOf(p)));
// 싼 계약 가능성 (시장 목록 표시용): 최저연봉이면 받을 선수 / 투웨이 받을 선수 (경력·실력 기준, score 와 같은 기준)
export function cheapOK(p) {
  const svc = svcOf(p), mn = minSal(svc), twMaxSvc = FR().two_way?.service_max ?? 3;
  return { min: V(p) <= mn * 1.15, tw: svc <= twMaxSvc && V(p) <= mn * 1.2 };
}
const R = (tag) => rng(hash(`${state.save.seed}:fa:${tag}`));
const seasonAfter = (s, k) => { const a = +s.slice(0, 4) + k; return `${a}-${String(a + 1).slice(2)}`; };
const round1 = (v) => Math.round(v / 1e5) * 1e5;
export const fa = () => (state.save.fa ||= { step: 0, talks: {}, offers: {}, sheets: [], news: [], gen: -1, started: false, done: false });

// ───────── 일정 ─────────
const dstr = (c) => { const v = c?.value; if (!v) return null; const s = typeof v === 'string' ? v : v.date; return s ? s.slice(0, 10) : null; };
const addDays = (d, k) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
export function steps() {
  const y = state.save.year, c = state.cal?.[String(y)] || {};
  const d0 = dstr(c.fa_negotiation_start) || `${y}-06-30`, mor = dstr(c.moratorium_end) || addDays(d0, 6), camp = dstr(c.training_camp_open) || `${y}-09-28`;
  const est = (k) => !!c[k]?.estimated;
  const out = [{ k: 'open', date: d0, t: '협상 시작', note: '18:00 (미국 동부) 다른 팀 선수와 협상이 열려요. 대형 FA는 첫 하루이틀 사이에 대부분 결정돼요.' }];
  if (addDays(d0, 1) < mor) out.push({ k: 'd1', date: addDays(d0, 1), t: '첫날', note: '첫 24시간. 큰 계약 소식이 쏟아지는 시간이에요.' });
  if (addDays(d0, 2) < mor) out.push({ k: 'd2', date: addDays(d0, 2), t: '둘째 날', note: '남은 대어와 중간급 선수들이 움직여요.' });
  out.push({ k: 'mor', date: mor, t: '모라토리엄 종료', note: '합의한 계약을 공식 서명해요. 오퍼시트 매칭 결정도 이 무렵이에요.' });
  for (const [k, t, note] of [[7, '7월 중순', '중간급·벤치 자원 시장이에요. 남은 선수의 요구액이 내려가기 시작해요.'], [20, '7월 말', '남은 FA가 눈높이를 낮춰요.'], [40, '8월', '최저연봉·투웨이 계약 시기예요.']]) {
    const d = addDays(mor, k); if (d < addDays(camp, -10)) out.push({ k: 'm' + k, date: d, t, note });
  }
  out.push({ k: 'camp', date: addDays(camp, -5), t: '캠프 직전', note: '마지막 기회. 이때까지 계약이 없으면 RFA는 QO를 받아들여요.' });
  out.forEach((s, i) => { s.i = i; s.moratorium = s.date < mor; s.est = est('fa_negotiation_start') || est('moratorium_end'); });
  return out;
}
export const curStep = () => steps()[Math.min(fa().step, steps().length - 1)];
export const dateKO = (d) => `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일`;
const moratoriumEnd = () => steps().find((s) => s.k === 'mor').date;

// ───────── 선수 성향 · 에이전트 ─────────
const pcache = {};
export function persona(p) {
  const key = `${state.save.seed}:${p.player_id}`;
  if (pcache[key]) return pcache[key];
  const r = R('p:' + p.player_id), age = p.age || 27, v = V(p), bird = p.contract?.bird;
  const w = { money: 0.4 + r() * 0.35, win: (age >= 31 ? 0.32 : age >= 28 ? 0.18 : 0.08) + r() * 0.2,
    role: (age <= 27 ? 0.22 : 0.1) + r() * 0.15, loyal: (bird === 'full' ? 0.12 : 0.04) + r() * 0.14 };
  const sum = w.money + w.win + w.role + w.loyal; for (const k in w) w[k] /= sum;
  const x = r(), style = x < 0.3 ? 'tough' : x < 0.75 ? 'fair' : 'friendly';
  const A = { tough: [1.2, 1.32, 4, 0.5], fair: [1.1, 1.2, 6, 0.15], friendly: [1.04, 1.12, 7, 0.03] }[style];
  const want = Math.max(1, Math.min(5, p.market_value?.years || (age >= 32 ? 1 : 2)));
  // 결정 시점: 대어는 첫날 밤, 중간급은 첫 주, 나머지는 천천히 (실제로 대형 계약은 6/30~7/1에 대부분 합의)
  const decide = v >= 20e6 ? (r() < 0.75 ? 0 : 1) : v >= 8e6 ? Math.floor(r() * 3) : 1 + Math.floor(r() * 5);
  return (pcache[key] = { w, style, askMul: A[0] + r() * (A[1] - A[0]), patience: A[2], bluff: A[3], want, decide, floor: 0.8 + r() * 0.15 });
}
export const STYLE_KO = { tough: '강경파', fair: '원칙파', friendly: '우호적' };
export const W_KO = { money: '돈(연봉 총액)', win: '우승 가능성', role: '출전 시간·역할', loyal: '원소속팀과의 인연' };

// 지금 요구하는 첫해 연봉
export function ask(p, step = fa().step) {
  const ps = persona(p), svc = svcOf(p), v = V(p);
  if (v <= minSal(svc) * 1.15) return minSal(svc);
  const late = Math.max(0, step - ps.decide);
  const mul = Math.max(ps.floor, ps.askMul * Math.pow(0.92, late));
  return Math.min(O.maxSalary(svc), Math.max(minSal(svc), round1(v * mul)));
}

// ───────── 팀 매력 (선수가 보는 팀) ─────────
const POSG = (pos) => { const s = String(pos || ''); return /C|PF/.test(s) && !/SF/.test(s) ? 'B' : /PG|SG/.test(s) && !/SF/.test(s) ? 'G' : 'W'; };
export function strength(abbr) {
  const all = state.data.teams.map((t) => { const top = t.roster.filter((q) => q.roster_role !== 'two_way').map(V).sort((a, b) => b - a).slice(0, 8);
    return { a: t.abbr, talent: top.reduce((s, x) => s + x, 0), srs: t.prev_season?.srs || 0 }; });
  const sorted = all.map((x) => x.talent).sort((a, b) => a - b), me = all.find((x) => x.a === abbr);
  const tRank = sorted.indexOf(me.talent) / Math.max(1, sorted.length - 1);
  const srsN = Math.max(0, Math.min(1, (me.srs + 10) / 20));
  return 0.5 * tRank + 0.5 * srsN;
}
export function roleAt(abbr, p) {
  const g = POSG(p.pos), v = V(p);
  const n = teamOf(abbr).roster.filter((q) => q.roster_role !== 'two_way' && POSG(q.pos) === g && V(q) >= v * 0.8).length;
  return n === 0 ? 1 : n === 1 ? 0.65 : n === 2 ? 0.35 : 0.12;
}
const loyalTo = (abbr, p) => (p.contract?.rights_team === abbr || p.contract?.renounced_by === abbr ? 1 : 0);
export function fit(abbr, p) {
  const ps = persona(p), f = { win: strength(abbr), role: roleAt(abbr, p), loyal: loyalTo(abbr, p) };
  const nm = ps.w.win + ps.w.role + ps.w.loyal;
  const score = (ps.w.win * f.win + ps.w.role * f.role + ps.w.loyal * f.loyal) / nm;
  let mult = 1 + (score - 0.4) * 0.5 * (1 - ps.w.money);
  if (abbr === state.save.team) mult += fa().talks[p.player_id]?.mood || 0;
  return { ...f, score, mult };
}

// ───────── 계약 만들기 · 평가 ─────────
// offer = { tool, s1, yrs, raise, opt: 'none'|'player'|'team' }
export function salaries(p, o) {
  const svc = svcOf(p);
  if (o.tool === 'min') return Array.from({ length: o.yrs }, (_, i) => minSal(svc + i));
  if (o.tool === 'ex10') return [minSal(svc)];
  if (o.tool === 'two_way') return Array.from({ length: o.yrs }, () => O.twoWaySalary());
  if (o.tool === 'qo') return [p.contract.qo];
  return Array.from({ length: o.yrs }, (_, i) => Math.round(o.s1 * (1 + (o.raise || 0) * i)));
}
export function buildYears(p, o, date) {
  const sal = salaries(p, o), svc = svcOf(p);
  return sal.map((s, i) => {
    const last = i === sal.length - 1;
    const option = last && sal.length > 1 && o.opt === 'player' ? 'player_option' : last && sal.length > 1 && o.opt === 'team' ? 'team_option' : null;
    let cap = s;
    if (o.tool === 'two_way') cap = 0;
    else if (o.tool === 'min' && sal.length === 1 && svc >= 3 && L().vet_min_cap_hit) cap = L().vet_min_cap_hit;   // 베테랑 1년 최저연봉: 캡에는 2년차 금액
    const ex = o.tool === 'ex10';
    return { season: seasonAfter(S(), i), salary: s, kind: o.tool === 'two_way' ? 'two_way' : ex ? 'exhibit10' : 'free_agent', option, signed: date, cap_hit: cap, guaranteed: option === 'team_option' || ex ? 0 : s };
  });
}
// 선수 입장 점수: 1.0 = 요구 조건과 같음
// = 평균 연봉 ÷ 요구 평균 연봉 + 기간 보정(원하는 것보다 짧으면 감점, 길면 나이 많을수록 가점) + 옵션 보정, × 팀 매력
export function score(p, abbr, o, step = fa().step) {
  const ps = persona(p), svc = svcOf(p), f = fit(abbr, p);
  if (o.tool === 'two_way') return (V(p) <= minSal(svc) * 1.2 && svc <= 3 ? 0.97 : 0.3) * f.mult;
  if (o.tool === 'ex10') return (V(p) <= minSal(svc) * 1.2 ? 0.96 : 0.3) * f.mult;
  const a = ask(p, step), want = ps.want, age = p.age || 27;
  const askAvg = a * (1 + 0.05 * (want - 1) / 2);
  const sal = salaries(p, o), avg = sal.reduce((x, y) => x + y, 0) / sal.length;
  let sc = avg / askAvg;
  const d = sal.length - want;
  if (d < 0) sc -= 0.05 * -d * (age >= 30 ? 1.2 : age <= 25 ? 0.6 : 0.9);
  else if (d > 0) sc += d * (age >= 31 ? 0.04 : age >= 28 ? 0.02 : -0.01);
  if (sal.length > 1 && o.opt === 'player') sc += 0.03;
  if (sal.length > 1 && o.opt === 'team') sc -= 0.04;
  return sc * f.mult;
}

// ───────── 쓸 수 있는 계약 수단 · 규정 검사 ─────────
export const TOOL_KO = { ex10: '캠프 계약', bird: '버드 권리', room: '캡 공간', mle_nt: '일반 MLE', mle_tp: '납세자 MLE', mle_room: '룸 MLE', bae: '격년 예외(BAE)', min: '최저연봉', two_way: '투웨이', qo: 'QO 수락' };
const signsBy = (abbr) => (state.save.log || []).filter((e) => e.t === 'sign' && e.team === abbr);
function used(abbr, tool) { return signsBy(abbr).filter((e) => e.tool === tool).reduce((a, e) => a + (e.years[0]?.salary || 0), 0); }
export function hardCap(abbr) {
  const lines = [...signsBy(abbr).map((e) => e.hardcap), ...(state.save.log || []).filter((e) => e.t === 'hardcap' && e.team === abbr).map((e) => e.line)].filter(Boolean);
  if (!lines.length) return null;
  const v = (k) => L()[k] || Infinity;
  const k = lines.sort((a, b) => v(a) - v(b))[0];
  return { k, amount: v(k) };
}
const apronKey = () => (L().first_apron ? 'first_apron' : 'apron');
const BIRD_LABEL = { full: '버드 권리', early: '얼리 버드', non: '논 버드' };
export const isRFA = (p) => p.contract?.fa_type === 'RFA' && p.contract?.qo && p.contract?.rights_team;

// 그 팀이 이 선수에게 쓸 수 있는 수단과 한도
export function toolsFor(abbr, p) {
  const t = teamOf(abbr), sh = capSheet(abbr), l = L(), ex = EX(), svc = svcOf(p), prev = p.contract?.last_salary || minSal(svc);
  const own = p.contract?.rights_team === abbr, bird = own ? (p.contract.bird || 'non') : null;
  const usedRoom = used(abbr, 'room') > 0, usedNT = used(abbr, 'mle_nt') > 0;
  const max = O.maxSalary(svc), out = [];
  const roomFor = sh.room + (own ? faHold(p) : 0);
  const fr = FR();
  if (own) {
    const lim = bird === 'full' ? max : bird === 'early' ? Math.max(prev * (fr.early_bird?.pct_prior || 1.75), (l.eaps_hold || prev) * (fr.early_bird?.pct_avg || 1.05))
      : Math.max(prev * (fr.non_bird?.pct_prior || 1.2), minSal(svc) * (fr.non_bird?.pct_min || 1.2), p.contract.qo || 0);
    out.push({ k: 'bird', label: BIRD_LABEL[bird], max: Math.min(max, Math.round(lim)), yrs: bird === 'full' ? (fr.max_years?.bird || 5) : 4, minYrs: bird === 'early' ? 2 : 1,
      raise: bird === 'non' ? 0.05 : 0.08, note: bird === 'full' ? '캡을 넘어도 최고 연봉까지 재계약할 수 있어요' : bird === 'early' ? '직전 연봉 175% 또는 평균 연봉 105% 중 큰 금액까지, 2년 이상' : '직전 연봉 120%까지' });
  }
  if (roomFor > minSal(svc) && !usedNT) out.push({ k: 'room', label: '캡 공간', max: Math.min(max, roomFor), yrs: 4, raise: 0.05, note: `남은 캡 공간 ${(roomFor / 1e6).toFixed(1)}M 안에서` });
  const over = sh.total >= l.salary_cap || roomFor <= minSal(svc);
  const nt = l.mle_non_taxpayer - used(abbr, 'mle_nt'), pay = teamPayroll(t, S());
  const apron = l[apronKey()];
  if (over && !usedRoom && nt > 0 && pay < apron) out.push({ k: 'mle_nt', label: '일반 MLE', max: Math.min(max, nt), yrs: ex.mle_nt?.years || ex.mle_non_taxpayer?.years || 4, raise: 0.05,
    note: cba() === '2023' ? '쓰면 1차 에이프런이 하드캡이 돼요 (첫해 납세자 MLE 금액 이하·2년 이하면 예외)' : '쓰면 에이프런이 하드캡이 돼요' });
  const tp = l.mle_taxpayer - used(abbr, 'mle_tp');
  if (over && !usedRoom && pay >= apron && tp > 0 && (!l.second_apron || pay < l.second_apron) && used(abbr, 'mle_nt') === 0)
    out.push({ k: 'mle_tp', label: '납세자 MLE', max: Math.min(max, tp), yrs: ex.mle_taxpayer?.years || 3, raise: 0.05, note: cba() === '2023' ? '쓰면 2차 에이프런이 하드캡이 돼요' : '에이프런 위 팀용' });
  const rm = (l.mle_room || 0) - used(abbr, 'mle_room');
  if (usedRoom && sh.room <= minSal(svc) && rm > 0) out.push({ k: 'mle_room', label: '룸 MLE', max: Math.min(max, rm), yrs: ex.mle_room?.years || 2, raise: 0.05, note: '캡 공간을 다 쓴 팀이 쓰는 예외' });
  const bae = (l.bae || 0) - used(abbr, 'bae');
  if (over && !usedRoom && bae > 0 && pay < apron) out.push({ k: 'bae', label: '격년 예외', max: Math.min(max, bae), yrs: ex.bae?.years || 2, raise: 0.05, note: '쓰면 에이프런이 하드캡이 돼요' });
  out.push({ k: 'min', label: '최저연봉', max: minSal(svc), yrs: fr.minimum?.max_years || 2, raise: 0, fixed: true, note: '언제든 쓸 수 있어요 (경력별 최저연봉)' });
  if (fa().step >= steps().findIndex((x) => x.k === 'mor')) out.push({ k: 'ex10', label: '캠프 계약', max: minSal(svc), yrs: 1, raise: 0, fixed: true, note: '1년 최저연봉 비보장(Exhibit 10). 개막 전 방출해도 부담이 거의 없고 투웨이로 바꿀 수 있어요' });
  if (svc <= (fr.two_way?.service_max ?? 3)) out.push({ k: 'two_way', label: '투웨이', max: O.twoWaySalary(), yrs: fr.two_way?.max_years || 2, raise: 0, fixed: true, note: '캡에 안 들어가요. 경력 3년 이하만' });
  return out;
}

// 제안 검사: 규정 위반이면 errors, 주의할 점은 warns
export function check(abbr, p, o) {
  const errors = [], warns = [], t = teamOf(abbr), svc = svcOf(p), l = L();
  const tool = toolsFor(abbr, p).find((x) => x.k === o.tool);
  if (!tool) return { errors: ['이 계약 수단은 지금 쓸 수 없어요'], warns, hardcap: null };
  const sheet = isRFA(p) && p.contract.rights_team !== abbr;
  const yMax = sheet ? Math.min(tool.yrs, FR().offer_sheet?.max_years || 4) : tool.yrs;
  const yMin = Math.max(tool.minYrs || 1, sheet ? (FR().offer_sheet?.min_years || 2) : 1);
  if (o.yrs > yMax) errors.push(`${tool.label}로는 최대 ${yMax}년까지예요`);
  if (o.yrs < yMin) errors.push(sheet ? '오퍼시트는 2년 이상이어야 해요' : `${tool.label}은 ${yMin}년 이상이어야 해요`);
  if (!tool.fixed) {
    if (o.s1 > tool.max) errors.push(`첫해 연봉 한도는 ${(tool.max / 1e6).toFixed(2)}M이에요`);
    if (o.s1 < minSal(svc)) errors.push('최저연봉보다 적게 줄 수 없어요');
    if ((o.raise || 0) > tool.raise + 1e-9) errors.push(`연봉 인상률은 해마다 첫해의 ${Math.round(tool.raise * 100)}%까지예요`);
    if (sheet && svc <= (FR().offer_sheet?.arenas_service_max ?? 2) && o.s1 > l.mle_non_taxpayer) errors.push('경력 1~2년 RFA 오퍼시트는 첫해 연봉이 일반 MLE 금액을 넘을 수 없어요 (아레나스 조항)');
  }
  const rosterN = t.roster.length;
  if (rosterN >= (FR().offseason_roster_max || 21)) errors.push('오프시즌 로스터가 꽉 찼어요 (21명)');
  if (o.tool === 'two_way' && t.roster.filter((q) => q.roster_role === 'two_way').length >= (cba() === '2023' ? 3 : 2)) errors.push('투웨이 자리가 꽉 찼어요');
  if (o.tool === 'ex10' && t.roster.filter((q) => q.contract?.signed_tool === 'ex10').length >= (state.rules?.roster?.exhibit10_max || 6)) errors.push('캠프 계약은 6명까지예요');
  const s1 = salaries(p, o)[0], pay = teamPayroll(t, S());
  const hc = hardCap(abbr);
  if (hc && o.tool !== 'two_way' && pay + s1 > hc.amount) errors.push(`하드캡(${hc.k === 'second_apron' ? '2차 에이프런' : '에이프런'}) ${(hc.amount / 1e6).toFixed(1)}M을 넘게 돼요`);
  let trig = null;
  if (o.tool === 'mle_nt') trig = cba() === '2023' ? ((s1 > l.mle_taxpayer || o.yrs >= 3) ? 'first_apron' : null) : 'apron';
  else if (o.tool === 'bae') trig = apronKey();
  else if (o.tool === 'mle_tp' && cba() === '2023') trig = 'second_apron';
  if (trig && pay + s1 > l[trig]) errors.push(`이 계약 후 총연봉이 하드캡 기준(${(l[trig] / 1e6).toFixed(1)}M)을 넘어요`);
  if (trig) warns.push(`이 계약을 하면 이번 시즌 총연봉이 ${(l[trig] / 1e6).toFixed(1)}M을 넘을 수 없어요 (하드캡)`);
  if (o.tool !== 'two_way' && pay + s1 > l.tax_level) warns.push('사치세 기준선을 넘게 돼요');
  if (sheet) warns.push(`${p.contract.rights_team}가 ${FR().offer_sheet?.match_hours?.[cba()] || 48}시간 안에 똑같은 조건으로 붙잡을(매칭) 수 있어요`);
  return { errors, warns, hardcap: trig };
}

// ───────── 서명 (기록에 남기고 바로 적용) ─────────
function signDate() { const st = curStep(); return st.date < moratoriumEnd() ? moratoriumEnd() : st.date; }
export function sign(p, abbr, o, how = 'fa') {
  const c = how === 'qo' ? { hardcap: null } : check(abbr, p, o);
  const years = buildYears(p, o, signDate());
  const ev = { t: 'sign', pid: p.player_id, team: abbr, tool: o.tool, years, how, hardcap: c.hardcap || null, step: fa().step, two_way: o.tool === 'two_way' };
  const v = V(p), st = curStep(), mine = abbr === state.save.team, total = years.reduce((a, y) => a + y.salary, 0);
  O.log(ev);
  delete fa().offers[p.player_id];
  const verb = st.moratorium && how !== 'qo' ? '합의' : '계약';
  const what = how === 'qo' ? (o.tool === 'two_way' ? '투웨이 퀄리파잉 오퍼 수락' : `퀄리파잉 오퍼 수락 (1년 ${m(total)})`) : how === 'match' ? `오퍼시트 매칭으로 잔류 (${years.length}년 ${m(total)})` : o.tool === 'two_way' ? `투웨이 ${verb}` : o.tool === 'ex10' ? '캠프 계약(비보장)' : `${years.length}년 ${m(total)} ${verb}`;
  const tk = fa().talks[p.player_id], left = !mine && (p.contract?.rights_team === state.save.team || p.contract?.prev_team === state.save.team);
  if (how !== 'snt') news(`${tname(abbr)}, ${p.name}와 ${what}${left ? ' (우리 팀을 떠남)' : tk && !mine ? ' (우리가 협상하던 선수)' : ''}`, { mine: mine || left, watch: !!tk, big: v >= 15e6 && how !== 'qo', v, pid: p.player_id, team: abbr });
 if (tk) tk.status = mine ? 'agreed' : 'lost';
  return ev;
}
const m = (v) => `$${(v / 1e6).toFixed(1)}M`;
const tname = (abbr) => teamOf(abbr)?.name || abbr;
export function news(text, extra = {}) { const st = curStep(); fa().news.push({ step: st.i, date: st.date, text, ...extra }); }

// ───────── 다른 구단 AI ─────────
export function aiPV(abbr, p) {   // 그 구단이 보는 이 선수의 가치
  const g = gmProfile(abbr), r = R(`pv:${abbr}:${p.player_id}`)(), age = p.age || 27;
  let k = 1 + (r * 2 - 1) * g.noise;
  if (g.mode === 'contend') k *= age >= 29 ? 1.06 : age <= 23 ? 0.9 : 1;
  if (g.mode === 'rebuild') k *= age >= 30 ? 0.72 : age <= 25 ? 1.08 : 0.95;
  k *= { big: 1.06, normal: 1, thrifty: 0.93 }[g.spend];
  return V(p) * k;
}
export const inSheet = (pid) => fa().sheets.some((x) => x.pid === pid && !x.done);
const unsigned = () => state.data.free_agents.filter((p) => !inSheet(p.player_id));
// 시작할 때: 다시 데려올 생각이 없는 자기 FA의 권리를 한꺼번에 포기 (그래야 캡 공간이 생기는 팀만)
// 핵심 FA(가치 800만 달러 이상이고 요구액의 90% 이상으로 보는 선수, 또는 QO를 낸 RFA)만 남기고 나머지 홀드는 정리
const aiKeeps = (abbr, p) => {
  const g = gmProfile(abbr), pv = aiPV(abbr, p);
  if (g.mode === 'rebuild' && (p.age || 27) >= 30) return false;
  if (isRFA(p)) return pv >= p.contract.qo;
  if (V(p) >= 18e6) return true;                         // 주전급 이상은 일단 권리 유지 (버드 권리로만 붙잡을 수 있는 경우가 많음)
  return V(p) >= 8e6 && pv >= ask(p, 0) * 0.75;
};
function aiRenounce() {
  for (const t of state.data.teams) {
    if (t.abbr === state.save.team) continue;
    const own = state.data.free_agents.filter((f) => f.contract?.rights_team === t.abbr && !f.contract.renounced);
    const drop = own.filter((p) => !aiKeeps(t.abbr, p));
    const freed = drop.reduce((a, p) => a + faHold(p), 0), room = capSheet(t.abbr).room;
    if (room + freed >= 10e6) for (const p of drop) O.log({ t: 'renounce', pid: p.player_id, team: t.abbr, ai: true });
  }
}
// 모라토리엄 무렵: 붙잡을 생각이 없는 RFA의 QO 철회 → UFA
function aiWithdrawQO() {
  for (const p of state.data.free_agents.filter((f) => isRFA(f) && f.contract.rights_team !== state.save.team && !inSheet(f.player_id))) {
    if (aiPV(p.contract.rights_team, p) < p.contract.qo * 0.95) {
      O.log({ t: 'qo_withdraw', pid: p.player_id, team: p.contract.rights_team });
      news(`${tname(p.contract.rights_team)}, ${p.name}에게 낸 퀄리파잉 오퍼 철회 → UFA`, { pid: p.player_id });
    }
  }
}
// 이번 단계 제안 만들기
const twMax = () => (cba() === '2023' ? 3 : 2);
function aiOffers() {
  const st = fa().step, all = steps(), last = st >= all.length - 1, post = st >= all.findIndex((x) => x.k === 'mor');
  const r0 = R('order:' + st);
  const teams = state.data.teams.filter((t) => t.abbr !== state.save.team).sort(() => r0() - 0.5);
  const pool = unsigned().slice().sort((a, b) => V(b) - V(a));
  const reach = post ? 0.62 : 0.75;   // 요구액의 이 비율도 못 맞추는 선수에게는 제안하지 않음
  for (const t of teams) {
    for (const pid in fa().offers) fa().offers[pid] = fa().offers[pid].filter((x) => x.team !== t.abbr);
    let commit = 0;   // 재계약하려는 자기 FA 연봉 (하드캡이 걸리는 예외를 쓸 때 미리 계산)
    const g = gmProfile(t.abbr), put = (p, o) => { const c = check(t.abbr, p, o); if (c.errors.length) return false;
      // 하드캡이 걸렸거나 걸릴 계약이면 로스터 14명을 채울 최저연봉 여유를 남김
      const line = c.hardcap ? L()[c.hardcap] : hardCap(t.abbr)?.amount;
      const room14 = Math.max(0, 14 - t.roster.filter((q) => q.roster_role !== 'two_way').length - 1) * minSal(0);
      if (line && o.tool !== 'two_way' && teamPayroll(t, S()) + commit + o.s1 + room14 > line) return false; (fa().offers[p.player_id] ||= []).push({ team: t.abbr, ...o }); return true; };
    // ① 자기 FA 재계약 (버드 권리)
    for (const p of pool.filter((x) => x.contract?.rights_team === t.abbr)) {
      const bird = toolsFor(t.abbr, p).find((x) => x.k === 'bird'); if (!bird) continue;
      const pv = aiPV(t.abbr, p), a = ask(p, st);
      if (pv < Math.min(a, bird.max) * 0.72 && !(isRFA(p) && pv >= p.contract.qo)) continue;
      const s1 = round1(Math.min(bird.max, pv >= a ? a : pv)), pay = teamPayroll(t, S());
      if (pay + s1 > L().tax_level && g.spend !== 'big' && pv < 15e6) continue;
      const yrs = Math.max(bird.minYrs || 1, Math.min(persona(p).want, (p.age || 27) >= 31 ? 2 : 5));
      if (put(p, { tool: 'bird', s1, yrs, raise: bird.raise, opt: 'none' })) commit += s1;
    }
    // ② 다른 팀 FA
    const std = t.roster.filter((q) => q.roster_role !== 'two_way').length;
    let need = Math.max(0, 14 - std), slots = last ? need + 1 : 3, roomLeft = capSheet(t.abbr).room;
    let tw = twMax() - t.roster.filter((q) => q.roster_role === 'two_way').length;
    for (const p of pool) {
      if (p.contract?.rights_team === t.abbr) continue;
      const v = V(p), pv = aiPV(t.abbr, p), svc = svcOf(p), mn = minSal(svc), a = ask(p, st);
      const young = svc <= 3 && (p.age || 27) <= 25;
      if (post && tw > 0 && young && v <= mn * 1.2 && R(`tw:${t.abbr}:${p.player_id}`)() < 0.25) { if (put(p, { tool: 'two_way', s1: O.twoWaySalary(), yrs: 1 + (R(`tw2:${p.player_id}`)() < 0.4 ? 1 : 0), raise: 0, opt: 'none' })) tw--; continue; }
      if (slots <= 0) continue;
      if (need <= 0 && pv < 6e6) continue;
      if (v <= mn * 1.2 && !post) continue;                // 최저연봉급 선수는 모라토리엄 뒤에
      if (isRFA(p) && pv < p.contract.qo * 1.3) continue;
      const tools = toolsFor(t.abbr, p), yrs = Math.max(1, Math.min(persona(p).want, (p.age || 27) >= 31 ? 2 : 4));
      let o = null;
      const room = tools.find((x) => x.k === 'room');
      if (room && pv > mn * 1.3) { const s1 = round1(Math.min(pv, roomLeft, room.max)); if (s1 >= a * reach) o = { tool: 'room', s1, yrs, raise: 0.05, opt: 'none' }; }
      for (const k of ['mle_nt', 'mle_room', 'mle_tp', 'bae']) {
        const x = tools.find((y) => y.k === k); if (o || !x || pv <= mn * 1.3) continue;
        const s1 = round1(Math.min(pv, x.max)); if (s1 >= a * reach) o = { tool: k, s1, yrs: Math.min(yrs, x.yrs), raise: 0.05, opt: 'none' };
      }
      if (!o && need > 0 && post && (pv <= mn * 1.6 || (last && pv <= mn * 3))) o = { tool: 'min', s1: mn, yrs: 1, raise: 0, opt: 'none' };
      if (!o) continue;
      if (isRFA(p)) o.yrs = Math.max(2, Math.min(4, o.yrs));
      if (!put(p, o)) continue;
      slots--; need--; if (o.tool === 'room') roomLeft -= o.s1;
    }
  }
  fa().gen = st;
}
export const offersFor = (pid) => (fa().offers[pid] || []);
// 지금 유효한 제안들 (구단 사정이 바뀌면 무효)
function liveOffers(p) {
  const out = offersFor(p.player_id).filter((o) => !check(o.team, p, o).errors.length);
  const tk = fa().talks[p.player_id];
  if (tk?.standing && !check(state.save.team, p, tk.standing).errors.length) out.push({ team: state.save.team, ...tk.standing, mine: true });
  return out.map((o) => ({ ...o, sc: score(p, o.team, o) })).sort((a, b) => b.sc - a.sc);
}
export function bestRival(p) { return liveOffers(p).filter((o) => !o.mine)[0] || null; }

// 오퍼시트: 원소속팀 결정 대기
function makeSheet(p, o) {
  const s = { pid: p.player_id, from: o.team, rights: p.contract.rights_team, offer: { tool: o.tool, s1: o.s1, yrs: o.yrs, raise: o.raise, opt: o.opt }, step: fa().step, hours: FR().offer_sheet?.match_hours?.[cba()] || 48 };
  fa().sheets.push(s);
  news(`${tname(o.team)}, RFA ${p.name}에게 오퍼시트 (${o.yrs}년 첫해 ${m(o.s1)}) · ${tname(s.rights)} ${s.hours}시간 안에 매칭 결정`, { mine: s.rights === state.save.team || o.team === state.save.team, big: V(p) >= 12e6 });
  delete fa().offers[p.player_id];
  if (fa().talks[p.player_id]) fa().talks[p.player_id].standing = null;
  return s;
}
export const pendingMySheets = () => fa().sheets.filter((s) => s.rights === state.save.team && !s.done);
export function decideSheet(s, match) {
  const p = state.data.free_agents.find((x) => x.player_id === s.pid);
  s.done = true;
  if (match) sign(p, s.rights, { ...s.offer, tool: 'bird' }, 'match');
  else { sign(p, s.from, s.offer, 'sheet'); news(`${tname(s.rights)}, ${p.name} 매칭 포기 → ${tname(s.from)} 이적`, { mine: s.rights === state.save.team || s.from === state.save.team, big: V(p) >= 15e6 }); }
  return match;
}
function aiMatch(s) {
  const p = state.data.free_agents.find((x) => x.player_id === s.pid), t = teamOf(s.rights), g = gmProfile(s.rights);
  const pv = aiPV(s.rights, p), pay = teamPayroll(t, S()), r = R(`match:${s.pid}`)();
  const young = (p.age || 27) <= 25, bar = young ? 0.8 : 0.9;   // 젊은 핵심 선수는 조금 비싸도 붙잡음
  return pv >= s.offer.s1 * bar && (pay + s.offer.s1 <= L().tax_level || g.spend !== 'thrifty' || young) && r < (young ? 0.93 : 0.85);
}

// 캠프 직전: 로스터가 13명이 안 되는 AI 구단은 남은 선수와 최저연봉 계약 (캠프 초청 성격)
function campFill() {
  for (const t of state.data.teams) {
    if (t.abbr === state.save.team) continue;
    let std = t.roster.filter((q) => q.roster_role !== 'two_way').length, guard = 0;
    while (std < 13 && guard++ < 10) {
      const cand = unsigned().filter((p) => !isRFA(p) && V(p) <= minSal(svcOf(p)) * 3).sort((a, b) => aiPV(t.abbr, b) - aiPV(t.abbr, a));
      const o = { tool: 'ex10', s1: 0, yrs: 1, raise: 0, opt: 'none' };
      let p = cand.find((x) => !check(t.abbr, x, o).errors.length);
      if (!p) { o.tool = 'min'; p = cand.find((x) => !check(t.abbr, x, o).errors.length); }
      if (!p) break;
      sign(p, t.abbr, { ...o, s1: minSal(svcOf(p)) }, 'fa'); std++;
    }
  }
}

// ───────── 시간 진행 ─────────
export function start() {
  const f = fa();
  if (f.started) { if (f.gen < f.step) aiOffers(); return; }
  f.started = true;
  aiRenounce();
  const st = curStep();
  news(`${dateKO(st.date)} 18:00 (동부) FA 협상이 시작됐어요${st.est ? ' (날짜 추정)' : ''}`, { sys: true });
  aiOffers();
  const top = unsigned().slice().sort((a, b) => V(b) - V(a)).slice(0, 6);
  for (const p of top) { const n = offersFor(p.player_id).length; if (n) news(`소문: ${p.name}에게 ${n}개 구단이 바로 연락했대요`, { rumor: true, pid: p.player_id }); }
  writeSave();
}
// 한 단계 진행: 오퍼시트 처리 → 선수들 결정 → 다음 날짜 → 새 제안
export function advance() {
  const f = fa(), all = steps(), st = f.step, last = st >= all.length - 1;
  for (const s of f.sheets.filter((x) => !x.done && x.rights !== state.save.team && x.step < st + 1)) {
    const ok = aiMatch(s); decideSheet(s, ok);
  }
  if (all[st].k === 'mor') aiWithdrawQO();
  const pool = unsigned().sort((a, b) => V(b) - V(a));
  for (const p of pool) {
    if (!state.data.free_agents.includes(p)) continue;
    const ps = persona(p), offers = liveOffers(p), best = offers[0];
    const late = st - ps.decide, rfa = isRFA(p);   // RFA는 협상력이 약해서 눈높이가 더 빨리 내려감
    const need = last ? 0.5 : late < 0 ? 1.12 : Math.max(rfa ? 0.55 : 0.62, 0.9 - (rfa ? 0.1 : 0.07) * late);
    if (best && best.sc >= need) {
      if (isRFA(p) && best.team !== p.contract.rights_team) { makeSheet(p, best); continue; }
      sign(p, best.team, best, 'fa');
    } else if (last && isRFA(p)) {   // 투웨이 출신은 투웨이 QO → 투웨이 계약 (자리가 없으면 그대로 FA)
      const tw = (p.contract.last_contract || '').startsWith('TWO-WAY'), rt = p.contract.rights_team;
      if (tw) { const o = { tool: 'two_way', s1: O.twoWaySalary(), yrs: 1, raise: 0, opt: 'none' }; if (!check(rt, p, o).errors.length) sign(p, rt, o, 'qo'); }
      else sign(p, rt, { tool: 'qo', s1: p.contract.qo, yrs: 1, raise: 0, opt: 'none' }, 'qo');
    }
  }
  // 우리 팀 오퍼시트를 받은 AI 팀은 다음 단계에서 결정 (위 반복문). 이번에 생긴 것도 마지막 단계면 바로 처리
  if (last) for (const s of f.sheets.filter((x) => !x.done && x.rights !== state.save.team)) decideSheet(s, aiMatch(s));
  for (const tk of Object.values(f.talks)) { tk.pat = Math.min(tk.pat0, tk.pat + 2); if (tk.walked === 1 && !tk.closed) tk.cool = false; tk.asked = {}; }
  if (last && pendingMySheets().length) { writeSave(); return { done: false, waitSheet: true }; }
  if (last) campFill();
  if (last) { f.done = true; state.save.phase = 'roster'; news('FA 시장이 사실상 마감됐어요. 남은 선수는 캠프 초청 정도만 가능해요.', { sys: true }); writeSave(); return { done: true }; }
  f.step = st + 1;
  aiOffers();
  writeSave();
  return { done: false };
}

// ───────── 협상 테이블 ─────────
export function talk(p) {
  const f = fa(), id = p.player_id;
  if (!f.talks[id]) {
    const ps = persona(p);
    f.talks[id] = { pat: ps.patience, pat0: ps.patience, mood: 0, walked: 0, closed: false, cool: false, log: [], asked: {}, rev: {}, standing: null, status: 'open', n: 0 };
    say(f.talks[id], 'agent', line(ps.style, 'hello', { name: p.name }));
  }
  return f.talks[id];
}
function say(tk, who, text) { tk.log.push({ who, text, step: fa().step }); if (tk.log.length > 60) tk.log.shift(); }
const pick = (arr, seed) => arr[Math.floor(R(seed)() * arr.length)];
const LINES = {
  hello: { tough: ['{name} 측입니다. 시간 많지 않아요. 진지한 제안만 받습니다.', '저희 선수는 시장 최고 대우를 기대하고 있어요. 들어보죠.'],
    fair: ['{name} 에이전트입니다. 서로 납득할 만한 조건이면 좋겠네요.', '연락 주셔서 감사해요. 선수도 여러 팀 얘기를 들어보는 중이에요.'],
    friendly: ['반가워요! {name}도 이 팀 얘기를 하면 표정이 밝아져요.', '좋은 소식을 기대하고 있었어요. 편하게 얘기해 봐요.'] },
  accept: { tough: ['좋습니다. 이 조건이면 사인하죠.', '이 정도면 됐어요. 합의합시다.'], fair: ['선수와 얘기했어요. 받아들이겠답니다!', '좋아요, 합의하죠. 축하드려요.'], friendly: ['최고예요! 선수가 정말 기뻐해요.', '바로 사인하겠대요. 잘 부탁드려요!'] },
  hold: { tough: ['나쁘지 않네요. 하지만 다른 팀 얘기를 다 듣고 결정할 겁니다.'], fair: ['좋은 제안이에요. 다른 구단과도 얘기를 끝내고 답할게요.'], friendly: ['고마워요. 선수가 조금만 더 생각해 보겠대요. 제안은 그대로 둘게요.'] },
  counter: { tough: ['그 금액으론 안 돼요. {c}면 생각해 보죠.', '모자라요. {c}. 그 아래는 없습니다.'], fair: ['조금만 더 올려 주시면 돼요. {c} 정도면 맞출 수 있어요.', '거의 다 왔어요. {c}면 선수를 설득할 수 있어요.'], friendly: ['조금만 더요! {c}면 바로 사인할 것 같아요.'] },
  low: { tough: ['이건 진지한 제안이 아니군요.', '시간 낭비하지 맙시다.'], fair: ['차이가 꽤 커요. 시장 가치를 다시 봐 주세요.'], friendly: ['음… 솔직히 기대보다 많이 낮아요.'] },
  insult: { tough: ['모욕적이네요. 이런 식이면 대화 못 합니다.'], fair: ['이 제안은 선수에게 전하기도 어렵네요.'], friendly: ['이건 좀… 선수가 서운해할 것 같아요.'] },
  rival: { tough: ['다른 팀 조건이 더 좋아요. 그걸 넘어야 해요.'], fair: ['솔직히 지금은 다른 구단 제안이 더 나아요.'], friendly: ['선수는 여기 오고 싶어하는데, 다른 팀 조건이 더 좋아서 고민이에요.'] },
  walk: { tough: ['더 얘기할 게 없네요. 다른 데랑 하겠습니다.'], fair: ['오늘은 여기까지 하죠. 한동안은 연락이 어려울 것 같아요.'], friendly: ['조금 쉬었다가 다시 얘기해요.'] },
  closed: { tough: ['이미 말했잖아요. 우리는 다른 팀과 얘기합니다.'], fair: ['죄송하지만 이번 FA에서는 협상을 이어가기 어렵겠어요.'], friendly: ['미안해요, 이번엔 인연이 아닌 것 같아요.'] },
};
const line = (style, k, vars = {}) => pick(LINES[k][style], `${k}:${style}:${Object.values(vars).join()}:${Math.random()}`).replace(/\{(\w+)\}/g, (_, x) => vars[x] ?? '');

// 질문하기 (단계마다 종류별 한 번은 인내심을 쓰지 않음)
export function question(p, kind, said = null) {
  const tk = talk(p), ps = persona(p), st = fa().step;
  if (tk.closed || tk.cool) return say(tk, 'agent', line(ps.style, 'closed')), tk;
  const Q = { want: '선수가 원하는 조건이 뭔가요?', prefs: '선수는 무엇을 가장 중요하게 보나요?', market: '다른 구단 제안은 어떤가요?', us: '우리 팀을 어떻게 보고 있나요?' };
  say(tk, 'me', said || Q[kind]);
  if (tk.asked[kind] === st) { tk.pat -= 1; }
  tk.asked[kind] = st;
  let a = '';
  if (kind === 'want') {
    const k = ask(p), yrs = ps.want;
    a = k <= minSal(svcOf(p)) ? '최저연봉이라도 좋으니 뛸 자리가 있으면 돼요.' : `첫해 ${m(k)}, ${yrs}년을 원해요.${ps.style === 'tough' ? ' 그 아래로는 얘기하기 어려워요.' : ps.style === 'friendly' ? ' 조금은 조정할 수 있어요.' : ''}`;
    tk.rev.want = { s1: k, yrs, step: st };
  } else if (kind === 'prefs') {
    const top = Object.entries(ps.w).sort((a, b) => b[1] - a[1]);
    a = `첫째는 ${W_KO[top[0][0]]}, 그다음은 ${W_KO[top[1][0]]}이에요.${top[3][0] === 'loyal' ? ' 원소속팀에 대한 미련은 크지 않아요.' : ''}`;
    tk.rev.prefs = top.map(([k, v]) => [k, v]);
  } else if (kind === 'market') {
    const offers = offersFor(p.player_id).filter((o) => o.team !== state.save.team);
    if (!offers.length) a = st === 0 ? '아직 공식 제안은 없지만 관심 보이는 팀은 있어요.' : '지금은 테이블 위에 다른 제안이 없어요.';
    else {
      const b = offers.slice().sort((x, y) => y.s1 - x.s1)[0], fuzz = 1 + R(`bluff:${p.player_id}:${st}`)() * 0.15 * (R(`bl2:${p.player_id}`)() < ps.bluff ? 1 : 0);
      a = `${offers.length}개 구단이 제안했어요. 가장 좋은 건 첫해 ${m(b.s1 * fuzz)}, ${b.yrs}년 정도예요.${ps.style === 'tough' ? ' 서두르셔야 할 거예요.' : ''}`;
      tk.rev.market = { n: offers.length, s1: b.s1 * fuzz, step: st };
    }
  } else if (kind === 'us') {
    const f = fit(state.save.team, p);
    const w = f.win >= 0.66 ? '우승을 노릴 수 있는 팀이라고 봐요' : f.win >= 0.4 ? '중간 정도 전력이라고 봐요' : '아직 우승 전력은 아니라고 봐요';
    const r = f.role >= 0.9 ? '주전 자리가 확실해 보여서 좋아해요' : f.role >= 0.5 ? '로테이션 자리는 있을 것 같대요' : '같은 포지션에 좋은 선수가 많아 출전 시간을 걱정해요';
    a = `${w}. ${r}.${f.loyal ? ' 이 팀에서 뛴 시간도 소중하게 생각해요.' : ''}`;
    tk.rev.us = { ...f, step: st };
  }
  say(tk, 'agent', a);
  if (tk.pat <= 0) walkAway(tk, ps);
  writeSave();
  return tk;
}
// 설득 (채팅): 선수가 중요하게 보는 것 + 우리 팀이 실제로 그걸 줄 수 있을 때만 기분이 조금 좋아짐 (같은 날 같은 말은 인내심만 깎음)
const PITCH_BAD = { win: '솔직히 지금 전력으로 우승 얘기는 선수가 믿기 어려워해요.', role: '같은 포지션에 좋은 선수가 많은데요? 출전 시간이 걱정이에요.', loyal: '이 팀과 특별한 인연은 없어서 와닿지 않네요.' };
export function pitch(p, topic, said) {
  const tk = talk(p), ps = persona(p), st = fa().step;
  if (tk.closed || tk.cool) return say(tk, 'agent', line(ps.style, 'closed')), tk;
  say(tk, 'me', said);
  if (topic === 'money') { say(tk, 'agent', '말보다는 숫자로 보여 주세요. 예를 들어 "3년 첫해 2천만 달러"처럼요.'); writeSave(); return tk; }
  const k = 'pitch_' + topic, again = tk.asked[k] === st; tk.asked[k] = st;
  const f = fit(state.save.team, p), w = ps.w[topic] || 0;
  const good = topic === 'win' ? f.win >= 0.55 : topic === 'role' ? f.role >= 0.7 : f.loyal > 0.3;
  if (again) { tk.pat -= 1; say(tk, 'agent', ps.style === 'tough' ? '같은 얘기 반복하지 마세요.' : '그 얘기는 아까 들었어요.'); }
  else if (!good) { tk.pat -= ps.style === 'tough' ? 1 : 0; say(tk, 'agent', PITCH_BAD[topic]); }
  else if (w >= 0.2 && (tk.pitchGain || 0) < 0.06) {
    tk.pitchGain = (tk.pitchGain || 0) + 0.02; tk.mood = Math.min(0.1, tk.mood + 0.02);
    say(tk, 'agent', { win: '그 얘기는 선수에게 와닿을 거예요. 이기는 팀에서 뛰고 싶어 하거든요.', role: '좋아요, 그 역할이라면 선수가 관심을 보일 거예요.', loyal: '선수도 이 팀에서의 시간을 소중하게 생각해요. 전해 둘게요.' }[topic]);
    say(tk, 'sys', '선수가 우리 팀을 조금 더 좋게 보게 됐어요.');
  } else say(tk, 'agent', '좋은 얘기지만, 선수가 가장 중요하게 보는 부분은 아니에요.');
  if (tk.pat <= 0) walkAway(tk, ps);
  writeSave(); return tk;
}
export function chatLine(p, said, reply) { const tk = talk(p); say(tk, 'me', said); if (reply) say(tk, 'agent', reply); writeSave(); return tk; }
function walkAway(tk, ps) {
  tk.walked += 1; tk.standing = null;
  if (tk.walked >= 2) { tk.closed = true; say(tk, 'agent', line(ps.style, 'closed')); say(tk, 'sys', '협상 결렬: 이번 FA 동안 이 선수와는 다시 협상할 수 없어요.'); }
  else { tk.cool = true; tk.pat = 2; say(tk, 'agent', line(ps.style, 'walk')); say(tk, 'sys', '협상 중단: 다음 날짜로 넘어가면 한 번 더 기회가 있어요.'); }
}

// 제안 보내기 → 결과: accept | hold | counter | low | insult | rival | walk | invalid | sheet
export function propose(p, o, said = null) {
  const tk = talk(p), ps = persona(p), me = state.save.team, st = fa().step;
  if (tk.closed || tk.cool) { say(tk, 'agent', line(ps.style, 'closed')); return { r: 'closed', tk }; }
  const c = check(me, p, o);
  if (c.errors.length) return { r: 'invalid', errors: c.errors, tk };
  tk.n += 1;
  const sal = salaries(p, o);
  if (said) say(tk, 'me', said);
  say(tk, said ? 'sys' : 'me', (said ? '→ ' : '') + `${o.tool === 'two_way' ? '투웨이 계약' : `${o.yrs}년 · 첫해 ${m(sal[0])}${o.raise ? ` · 매년 ${Math.round(o.raise * 100)}% 인상` : ''}${o.opt !== 'none' && o.yrs > 1 ? ` · 마지막 해 ${o.opt === 'player' ? '선수' : '팀'} 옵션` : ''}`} (${TOOL_KO[o.tool]}) 제안합니다.`);
  const sc = score(p, me, o), rival = bestRival(p), rv = rival?.sc || 0;
  let r;
  if (sc >= 1 && sc >= rv + 0.02) {
    if (st < ps.decide && sc < 1.12 && V(p) >= 8e6) { r = 'hold'; tk.standing = { ...o }; say(tk, 'agent', line(ps.style, 'hold')); say(tk, 'sys', `제안이 테이블에 올라갔어요. 선수는 ${dateKO(steps()[Math.min(ps.decide, steps().length - 1)].date)} 무렵 결정할 것 같아요. 조건을 더 올리면 바로 결정할 수도 있어요.`); }
    else if (isRFA(p) && p.contract.rights_team !== me) { r = 'sheet'; say(tk, 'agent', line(ps.style, 'accept')); makeSheet(p, { team: me, ...o }); say(tk, 'sys', `오퍼시트에 서명했어요. ${p.contract.rights_team}가 ${FR().offer_sheet?.match_hours?.[cba()] || 48}시간 안에 매칭할지 정해요 (다음 날짜로 넘어가면 결과가 나와요).`); }
    else { r = 'accept'; say(tk, 'agent', line(ps.style, 'accept')); sign(p, me, o, 'fa'); say(tk, 'sys', curStep().moratorium ? `합의 완료! ${dateKO(moratoriumEnd())} 모라토리엄이 끝나면 공식 서명해요.` : '계약 완료!'); }
  } else if (sc >= 1 && rv > sc - 0.02) {
    r = 'rival'; tk.pat -= 1; tk.standing = { ...o }; say(tk, 'agent', line(ps.style, 'rival'));
  } else if (sc >= 0.88) {
    r = 'counter'; tk.pat -= 1;
    const tool = toolsFor(me, p).find((x) => x.k === o.tool);
    let need = round1(o.s1 / sc * 1.01 + 5e4);
    if (rv > 1) need = Math.max(need, round1(o.s1 * (rv + 0.03) / sc));
    if (tool && !tool.fixed && need <= tool.max) { tk.counter = { ...o, s1: need }; say(tk, 'agent', line(ps.style, 'counter', { c: `${o.yrs}년 첫해 ${m(need)}` })); }
    else if (o.yrs < ps.want && (tool?.yrs || 1) >= ps.want) { tk.counter = { ...o, yrs: ps.want }; say(tk, 'agent', line(ps.style, 'counter', { c: `같은 금액에 ${ps.want}년` })); }
    else { tk.counter = null; say(tk, 'agent', '그 계약 수단으로는 저희가 원하는 금액이 안 나와요. 다른 방법이 있을까요?'); }
  } else if (sc >= 0.72) { r = 'low'; tk.pat -= 2; say(tk, 'agent', line(ps.style, 'low')); }
  else { r = 'insult'; tk.pat -= 3; tk.mood = Math.max(-0.12, tk.mood - 0.04); say(tk, 'agent', line(ps.style, 'insult')); }
  if (tk.pat <= 0 && !['accept', 'sheet'].includes(r)) { walkAway(tk, ps); r = 'walk'; }
  writeSave();
  return { r, sc, rival: rv, tk };
}
export function withdraw(p) { const tk = talk(p); if (tk.standing) { tk.standing = null; say(tk, 'sys', '제안을 거둬들였어요.'); writeSave(); } }

// 시장 목록용 요약
export function marketRows() {
  const me = state.save.team;
  const rows = state.data.free_agents.map((p) => ({ p, v: V(p), n: offersFor(p.player_id).filter((o) => o.team !== me).length, tk: fa().talks[p.player_id] || null, signed: null, sheet: inSheet(p.player_id) }));
  for (const e of signedList()) {
    const p = teamOf(e.team)?.roster.find((q) => q.player_id === e.pid);
    if (p) rows.push({ p, v: V(p), n: 0, tk: fa().talks[p.player_id] || null, signed: e, sheet: false });
  }
  return rows;
}
export const signedList = () => (state.save.log || []).filter((e) => e.t === 'sign');

// ───────── 관심 선수 · 브리핑 ─────────
export const watch = () => (fa().watch ||= []);
export const isWatched = (pid) => watch().includes(pid);
export function toggleWatch(pid) { const w = watch(), i = w.indexOf(pid); if (i >= 0) w.splice(i, 1); else w.push(pid); writeSave(); return i < 0; }
// 관심 선수 한 명의 지금 상황
export function watchStatus(pid) {
  const me = state.save.team, e = signedList().find((x) => x.pid === pid);
  if (e) { const p = teamOf(e.team)?.roster.find((q) => q.player_id === pid); return { pid, p, phase: e.team === me ? 'ours' : 'gone', e, n: 0 }; }
  const p = state.data.free_agents.find((x) => x.player_id === pid); if (!p) return null;
  const tk = fa().talks[pid], n = offersFor(pid).filter((o) => o.team !== me).length, ps = persona(p);
  const phase = inSheet(pid) ? 'sheet' : tk?.closed ? 'closed' : tk?.standing ? 'standing' : tk && tk.log.length > 1 ? 'talking' : 'none';
  return { pid, p, phase, n, told: tk?.rev?.want?.s1 || null, standing: tk?.standing || null, mine: p.contract?.rights_team === me };   // 요구액은 에이전트에게 물어서 들은 것만
}
// 관심 선수 추천: 우리 FA + 우리가 쓸 수 있는 수단으로 닿을 만한 선수 중 가치 높은 순
export function suggestions(k = 4) {
  const me = state.save.team, w = new Set(watch());
  const pool = unsigned().filter((p) => !w.has(p.player_id));
  const own = pool.filter((p) => p.contract?.rights_team === me && !p.contract.renounced && V(p) > minSal(svcOf(p)) * 1.3).sort((a, b) => V(b) - V(a)).slice(0, 2);
  const reach = (p) => { const best = Math.max(0, ...toolsFor(me, p).filter((t) => !['two_way', 'ex10'].includes(t.k)).map((t) => t.max)); return best >= ask(p) * 0.85; };
  const others = pool.filter((p) => !own.includes(p) && p.contract?.rights_team !== me && reach(p)).sort((a, b) => V(b) - V(a));
  return [...own, ...others].slice(0, k);
}
// 오늘 할 일 (최대 3개, 급한 순)
export function todos(capRoom, stdCount) {
  const me = state.save.team, out = [];
  for (const s of watch().map(watchStatus).filter(Boolean)) {
    if (['none', 'talking'].includes(s.phase) && s.n > 0) out.push({ pri: 1, pid: s.pid, text: `소문으로는 ${s.p.name}에게 다른 구단 제안이 ${s.n}개 있대요. 원하면 넘어가기 전에 제안을 올려 두세요.` });
    if (s.phase === 'sheet' && s.p.contract?.rights_team === me) out.push({ pri: 0, pid: s.pid, text: `${s.p.name}이(가) 오퍼시트를 받았어요. 매칭할지 정해야 해요.` });
  }
  const own = unsigned().filter((p) => p.contract?.rights_team === me && !p.contract.renounced && !(fa().talks[p.player_id]?.log.length > 1) && V(p) > minSal(svcOf(p)) * 1.3).sort((a, b) => V(b) - V(a));
  if (own.length) out.push({ pri: 1, pid: own[0].player_id, text: `우리 FA ${own[0].name}: 다시 계약할지, 권리를 포기해 캡 공간을 만들지 정하세요.${own.length > 1 ? ` (그 밖에 ${own.length - 1}명)` : ''}` });
  if (stdCount < 14) out.push({ pri: fa().step >= steps().length - 2 ? 0 : 3, text: `정규 로스터 ${stdCount}명이에요. 개막 전까지 최소 14명이 필요해요.` });
  if (capRoom >= 5e6) out.push({ pri: 2, text: `캡 여유 $${(capRoom / 1e6).toFixed(1)}M이 남아 있어요. 캡 공간으로 데려올 선수를 찾아보세요.` });
  if (!watch().length) out.push({ pri: 1, text: '관심 선수를 정해 두면 날짜가 바뀔 때마다 그 선수들 소식부터 알려 드려요. 시장 목록의 ☆를 누르세요.' });
  return out.sort((a, b) => a.pri - b.pri).slice(0, 3);
}
