// 선수 트레이드 (오프시즌: 모라토리엄이 끝난 뒤 ~ 개막 로스터 확정 전)
// - 선수 + 미래 지명권 묶음. 양쪽 팀 모두 규정 검사:
//   연봉 맞추기(2017·2023 협약), 캡 공간 팀은 캡 + 여유 금액까지 흡수, 하드캡, 오프시즌 로스터 21명, Stepien
//   이번 오프시즌에 계약한 FA는 트레이드 불가(12월 15일·3개월 규정), 신인은 계약 30일 뒤(로스터 정리 단계)부터
// - AI 평가: 남은 계약 해마다 (시장 가치 − 연봉) 잉여 가치 + 팀 상황(우승 도전·리빌딩) + 사치세 부담 → 지명권 가치 단위로 환산
// 규정 출처: data/rules.json trade
import { state, writeSave } from './store.js';
import * as O from './offseason.js';
import * as F from './fa.js';
import { gmProfile, perceivedValue, rng, hash } from './ai.js';
import { assetsOf, baseValue, setOwner, stepienCheck, plainLabel } from './picks.js';
import { capSheet } from './capsheet.js';
import { teamPayroll, luxuryTax } from './rules.js';
import { bpmOf } from './strength.js';
import { tradeBlock } from './ext.js';

const S = () => state.data.season;
const L = () => state.data.league;
const TR = () => state.rules?.trade || {};
const teamOf = (abbr) => state.data.teams.find((t) => t.abbr === abbr);
const seasonAfter = (s, k) => { const a = +s.slice(0, 4) + k; return `${a}-${String(a + 1).slice(2)}`; };
const R = (tag) => rng(hash(`${state.save.seed}:pt:${tag}`))();
export const PTS_PER_M = 2;            // 지명권 가치 1점 ≈ 잉여 가치 50만 달러 (1순위 100점 ≈ 5천만 달러)
export const pt = () => (state.save.pt ||= { log: [], talks: {} });

// ── 트레이드 가능 여부 ──
const signedThisSummer = (p) => (state.save.log || []).some((e) => e.t === 'sign' && e.pid === p.player_id);
export function blocked(p) {
  if (p.roster_role === 'two_way') return '투웨이 선수는 이 게임에서 트레이드하지 않아요';
  if (signedThisSummer(p)) return '이번 오프시즌에 계약해서 12월 15일 전에는 트레이드할 수 없어요';
  if (p.rookie && state.save.phase !== 'roster') return '신인은 계약 30일 뒤(로스터 정리 단계)부터 트레이드할 수 있어요';
  return tradeBlock(p);
}
export function windowOpen() {
  const ph = state.save.phase;
  if (ph === 'roster') return true;
  if (ph !== 'fa' || F.fa().done) return false;
  return F.fa().step >= F.steps().findIndex((x) => x.k === 'mor');
}
const curSalary = (p) => { const y = (p.contract?.years || []).find((x) => x.season === S()); return y ? (y.cap_hit ?? y.salary ?? 0) : 0; };
const isMin = (p) => { const y = (p.contract?.years || []).filter((x) => x.season >= S()); return y.length && y.length <= 2 && curSalary(p) <= O.minSalary(Math.min(F.svcOf(p), 10)) * 1.01; };

// ── 연봉 맞추기: 이 팀이 받을 수 있는 최대 연봉 ──
function maxIncoming(abbr, outSal, payAfter, outCount) {
  const l = L(), cba = F.cba();
  if (cba === '2023') {
    const r = TR()['2023'];
    if (l.second_apron && payAfter > l.second_apron && outCount > 1) return { max: -1, rule: '2차 에이프런 위 팀은 여러 선수 연봉을 합쳐서 맞출 수 없어요' };
    if (l.first_apron && payAfter > l.first_apron) { const p = state.save.year === 2023 ? r.first_apron_pct['2023'] : r.first_apron_pct.later; return { max: outSal * p, rule: `1차 에이프런 위: 보낸 연봉의 ${Math.round(p * 100)}%까지` }; }
    for (const t of r.below_first) if (!t.upto || outSal <= t.upto) return { max: t.flat ? outSal + t.flat : outSal * t.pct + t.plus, rule: t.flat ? `보낸 연봉 + ${(t.flat / 1e6).toFixed(1)}M까지` : `보낸 연봉의 ${Math.round(t.pct * 100)}% + ${(t.plus / 1e3).toFixed(0)}K까지` };
  }
  const r = TR()['2017'];
  if (payAfter > l.tax_level) return { max: outSal * r.taxpayer.pct + r.taxpayer.plus, rule: '사치세 팀: 보낸 연봉의 125% + 100K까지' };
  for (const t of r.nontax) if (!t.upto || outSal <= t.upto) return { max: t.flat ? outSal + t.flat : outSal * t.pct + t.plus, rule: t.flat ? `보낸 연봉 + ${(t.flat / 1e6).toFixed(1)}M까지` : `보낸 연봉의 ${Math.round(t.pct * 100)}% + 100K까지` };
  return { max: outSal, rule: '' };
}

// 한 팀 입장 검사: out = 보내는 선수, inn = 받는 선수
export function checkSide(abbr, out, inn) {
  const errs = [], why = [], t = teamOf(abbr), l = L();
  const M = (v) => `$${(v / 1e6).toFixed(1)}M`;
  const outSal = out.reduce((a, p) => a + curSalary(p), 0), inSal = inn.reduce((a, p) => a + curSalary(p), 0);
  const pay = teamPayroll(t, S()), payAfter = pay - outSal + inSal;
  const sh = capSheet(abbr), totalAfter = sh.total - outSal + inSal;
  const cushion = TR()[F.cba()]?.room_cushion || 100000;
  let rule = '';
  if (inSal > outSal && totalAfter > l.salary_cap + cushion) {
    const minIn = inn.filter(isMin).reduce((a, p) => a + curSalary(p), 0);   // 최저연봉 선수는 최저연봉 예외로 받음
    const m = maxIncoming(abbr, outSal, payAfter, out.length);
    rule = m.rule;
    if (m.max < 0) { errs.push(m.rule); why.push(`트레이드 뒤 총연봉이 2차 에이프런(${M(l.second_apron)})을 넘는 팀은 선수 한 명의 연봉으로만 맞춰야 해요. 보내는 선수를 한 명으로 줄여 보세요.`); }
    else if (inSal - minIn > m.max + 1) {
      errs.push(`받는 연봉 ${(inSal / 1e6).toFixed(1)}M이 한도 ${(m.max / 1e6).toFixed(1)}M을 넘어요 (${m.rule})`);
      // 얼마나 더 보내야 하는지 거꾸로 계산
      let need = null; for (let x = outSal; x <= outSal + 80e6; x += 1e5) { if (maxIncoming(abbr, x, payAfter + (outSal - x), out.length || 1).max + 1 >= inSal - minIn) { need = x; break; } }
      why.push(`이 팀은 트레이드 뒤 캡(${M(l.salary_cap)})을 넘어서, 받는 연봉을 보내는 연봉에 맞춰야 해요(연봉 맞추기 규정). 지금 보내는 연봉 ${M(outSal)}로는 최대 ${M(Math.max(0, m.max))}까지만 받을 수 있는데 ${M(inSal - minIn)}을 받게 돼요.${need != null ? ` 이 팀이 연봉을 ${M(need)} 이상 보내면 돼요 (지금보다 ${M(need - outSal)} 더).` : ''} 최저연봉 선수는 예외로 계산에서 빠져요.`);
    }
  } else if (inSal > outSal) rule = '캡 공간 안에서 받음';
  const hc = F.hardCap(abbr);
  if (hc && payAfter > hc.amount) { errs.push(`하드캡 ${(hc.amount / 1e6).toFixed(1)}M을 넘게 돼요`); why.push(`이번 오프시즌에 ${hc.why || '하드캡이 걸리는 방법'}을 써서 총연봉 ${M(hc.amount)}을 절대 넘을 수 없어요. 트레이드 뒤 ${M(payAfter)} → ${M(payAfter - hc.amount)} 줄여야 해요.`); }
  if (t.roster.length - out.length + inn.length > (state.rules?.roster?.offseason_max || 21)) { errs.push('로스터가 21명을 넘게 돼요'); why.push(`오프시즌 로스터는 최대 21명(투웨이 포함)이에요. 지금 ${t.roster.length}명 → 트레이드 뒤 ${t.roster.length - out.length + inn.length}명. 받는 선수를 줄이거나 먼저 방출하세요.`); }
  return { errs, why, outSal, inSal, payAfter, rule, taxBefore: luxuryTax(pay), taxAfter: luxuryTax(payAfter) };
}

// ── AI 눈으로 본 선수 가치 (지명권 점수 단위) ──
// 나이에 따른 가치 변화: 25세까지 해마다 +10% 성장, 29세까지 유지, 그 뒤 해마다 −10%
const ageMult = (age, k) => { let m = 1; for (let i = 1; i <= k; i++) { const a = age + i; m *= a <= 25 ? 1.1 : a <= 29 ? 1 : 0.9; } return m; };
const NEUTRAL = { mode: 'middle', noise: 0 };
// neutral = 팀 상황·판단 실수 없이 본 가치 (AI가 먼저 거는 제안이 우리에게도 말이 되는지 볼 때)
export function playerValue(abbr, p, neutral = false) {
  // 선수 가치: 시장 가치와 실력(예상 BPM) 기준 가치 중 큰 값 (최고 연봉 한도 때문에 시장 가치는 스타를 낮게 봄)
  const g = neutral ? NEUTRAL : gmProfile(abbr), age = p.age || 27, cap = L().salary_cap;
  const upside = age <= 22 ? 1 + 0.08 * (23 - age) : 1;                     // 어린 선수는 아직 보여 준 것보다 잠재력이 큼
  // 실력 기준 가치는 위로 갈수록 가파름 (슈퍼스타 한 명이 평범한 선수 여럿보다 훨씬 귀함): BPM 3 넘는 1점마다 +8%
  const b = bpmOf(p), byBpm = Math.max(0, b + 2) * (1 + Math.max(0, b - 3) * 0.08) * cap * 0.035;
  const v = Math.max(F.V(p), byBpm) * upside;
  const ys = (p.contract?.years || []).filter((y) => y.season >= S());
  let tot = 0;
  ys.forEach((y, k) => {
    let worth = v * ageMult(age, k);
    if (g.mode === 'rebuild') worth *= age + k >= 29 ? 0.7 : age <= 24 ? 1.15 : 1;
    if (g.mode === 'contend' && k === 0) worth += Math.max(0, bpmOf(p)) * 1.5e6;   // 지금 이기는 데 쓸 선수
    let sur = worth - (y.salary || 0);
    if (y.option === 'team_option') sur = Math.max(0, sur);          // 팀 옵션: 손해면 거절하면 됨
    if (y.option === 'player_option') sur = Math.min(sur, worth * 0.15);   // 선수 옵션: 잘하면 나가고 못하면 남음
    if (sur < 0) sur *= 0.4;                                          // 비싼 계약이라도 뛰는 선수라 손해는 일부만 봄
    tot += sur * Math.pow(0.88, k);
  });
  // 권리 보유 가치: 신인 계약 선수는 끝나도 RFA로 붙잡을 수 있어서 2년 더 시장가보다 싸게 쓸 수 있다고 봄 (가치의 20%)
  if (ys.length && ys[ys.length - 1].kind === 'rookie_scale') for (let k = ys.length; k < ys.length + 2; k++) tot += v * ageMult(age, k) * 0.2 * Math.pow(0.88, k);
  const noise = 1 + (R(`pv:${abbr}:${p.player_id}`) * 2 - 1) * g.noise;
  return (tot / 1e6) * PTS_PER_M * (tot > 0 ? noise : 1 / noise);
}
// 사치세가 늘어나는 부담 (지출 성향에 따라)
function taxCost(abbr, side) {
  const g = gmProfile(abbr), d = side.taxAfter - side.taxBefore;
  if (d <= 0) return -(side.taxBefore - side.taxAfter) / 1e6 * PTS_PER_M * 0.3;   // 사치세를 줄이면 약간 이득
  return (d / 1e6) * PTS_PER_M * ({ big: 0.25, normal: 0.6, thrifty: 1 }[g.spend]);
}

// 제안 평가: AI 입장 give = AI가 주는 것, get = AI가 받는 것 (players, picks)
export function evaluate(ai, mine) {
  const me = state.save.team;
  const aiOut = mine.getPlayers, aiIn = mine.givePlayers;    // mine.getPlayers = 우리가 받는 선수 = AI가 보내는 선수
  const sideAI = checkSide(ai, aiOut, aiIn), sideMe = checkSide(me, aiIn, aiOut);
  const errs = [...sideMe.errs.map((e) => `우리 팀: ${e}`), ...sideAI.errs.map((e) => `${teamOf(ai).name}: ${e}`)], why = [...sideMe.why, ...sideAI.why];
  const st = stepienCheck(me, ai, mine.givePicks, mine.getPicks);
  if (st.length) { errs.push('Stepien 규칙에 걸려요 (1라운드 지명권이 2년 연속 없어짐)'); why.push('어느 팀도 미래에 1라운드 지명권이 2년 연속으로 하나도 없게 만들 수 없어요. 다른 해 지명권으로 바꿔 보세요.'); }
  if (!aiOut.length && !aiIn.length && !mine.givePicks.length && !mine.getPicks.length) { errs.push('주고받을 것을 고르세요'); why.push(''); }
  if (errs.length) return { result: 'invalid', errs, why, sideMe, sideAI };
  const g = gmProfile(ai);
  const vIn = aiIn.reduce((a, p) => a + playerValue(ai, p), 0) + mine.givePicks.reduce((a, x) => a + perceivedValue(ai, x), 0);
  const vOut = aiOut.reduce((a, p) => a + playerValue(ai, p), 0) + mine.getPicks.reduce((a, x) => a + perceivedValue(ai, x), 0);
  const tc = taxCost(ai, sideAI);
  // 로스터 사정: 자리가 모자라면 받는 사람이 많을수록 부담
  const net = vIn - vOut - tc, need = Math.max(4, Math.abs(vOut) * g.greed + 3);
  const ratio = net / need;
  const out = { sideMe, sideAI, vIn, vOut, tc, net };
  if (net >= need) return { ...out, result: 'accept', reason: reasonOk(ai) };
  const tk = (pt().talks[ai] ||= { n: 0 });
  if (net >= -Math.max(15, Math.abs(vOut) * 0.4) && R(`ctr:${ai}:${tk.n}`) < g.counterRate) {
    const gap = need - net;
    const add = assetsOf(me).filter((a) => a.tradable && a.kind === 'fut' && !mine.givePicks.some((x) => x.key === a.key))
      .map((a) => ({ a, v: perceivedValue(ai, a) })).filter((x) => x.v >= gap).sort((a, b) => a.v - b.v)[0];
    if (add && !stepienCheck(me, ai, [...mine.givePicks, add.a], mine.getPicks).length) return { ...out, result: 'counter', add: add.a, reason: `조금 모자라요. ${plainLabel(add.a)} 지명권까지 주면 할게요.` };
  }
  return { ...out, result: 'reject', reason: reasonNo(ai, mine, net, sideAI) };
}
const reasonOk = (ai) => ({ contend: '좋아요. 이 선수면 올해 우승 경쟁에 도움이 돼요. 거래하죠.', rebuild: '좋아요. 미래를 생각하면 괜찮은 거래예요.', middle: '좋아요, 거래하죠.' })[gmProfile(ai).mode];
function reasonNo(ai, mine, net, sideAI) {
  const g = gmProfile(ai);
  if (sideAI.taxAfter > sideAI.taxBefore && g.spend !== 'big') return '연봉이 늘어서 사치세 부담이 커져요. 이 조건으로는 어려워요.';
  if (g.mode === 'rebuild' && mine.givePlayers.some((p) => (p.age || 27) >= 30)) return '저희는 리빌딩 중이라 나이 많은 선수는 크게 쳐주지 않아요.';
  if (g.mode === 'contend' && mine.getPlayers.some((p) => bpmOf(p) > 2)) return '그 선수는 저희 우승 계획에 꼭 필요해요.';
  return net < -20 ? '가치 차이가 너무 커요.' : '조금 모자라요. 이 조건으로는 어렵겠어요.';
}

// 같은 날짜에 한 구단과는 3번까지 (그 뒤엔 다음 날짜에)
export function talksLeft(ai) {
  const key = state.save.phase === 'fa' ? `fa${F.fa().step}` : state.save.phase;
  const tk = (pt().talks[ai] ||= { n: 0 });
  if (tk.key !== key) { tk.key = key; tk.used = 0; }
  return 3 - tk.used;
}
export function propose(ai, mine) {
  if (talksLeft(ai) <= 0) return { result: 'closed', reason: '오늘은 더 얘기하기 어렵겠어요. 다음에 다시 연락 주세요.' };
  const r = evaluate(ai, mine);
  if (r.result !== 'invalid') { pt().talks[ai].used += 1; pt().talks[ai].n += 1; }
  if (r.result === 'accept') execute(ai, mine);
  writeSave();
  return r;
}
export function execute(ai, mine) {
  const me = state.save.team;
  mine.givePicks.forEach((a) => setOwner(a, ai)); mine.getPicks.forEach((a) => setOwner(a, me));
  O.log({ t: 'ptrade', team: me, partner: ai, give: mine.givePlayers.map((p) => p.player_id), get: mine.getPlayers.map((p) => p.player_id) });
  pt().log.push({ partner: ai, gave: [...mine.givePlayers.map((p) => p.name), ...mine.givePicks.map(plainLabel)], got: [...mine.getPlayers.map((p) => p.name), ...mine.getPicks.map(plainLabel)], phase: state.save.phase });
  writeSave();
}

// ───────── 다른 구단이 먼저 거는 선수 트레이드 제안 ─────────
// - 날짜(FA 단계·로스터 정리)마다 한 번: 45% 확률로 1건, 그중 15%는 1건 더. 오프시즌 전체 최대 5건, 다음 날짜가 되면 지난 제안은 만료
// - want: 우리 선수가 그 구단 눈에 가치가 커서 데려오고 싶음 → 연봉 맞추기용 선수 + (여유가 있으면) 지명권
// - dump: 사치세를 넘은 구단이 비싼 계약을 넘기고 싶음 → 그 선수 + 지명권 (우리가 캡 공간으로 받을 수 있을 때만)
// - 만든 제안은 그 구단 평가(evaluate)로 '수락'이 나오는 것만 보냄
const dayKey = () => (state.save.phase === 'fa' ? `fa${F.fa().step}` : state.save.phase);
export const ib = () => (pt().inbox ||= { list: [], day: null, n: 0 });
const sideOK = (ai, give, get) => !checkSide(state.save.team, give, get).errs.length && !checkSide(ai, get, give).errs.length;
function tradablePlayers(abbr) { return teamOf(abbr).roster.filter((p) => !blocked(p) && p.roster_role !== 'two_way'); }
// 우리 쪽 공정 가치 비율: 받는 것 ÷ 주는 것 (중립 가치, 지명권은 기준 곡선)
export function fairRatio(m) {
  const pv = (ps) => ps.reduce((a, p) => a + playerValue(null, p, true), 0), kv = (as) => as.reduce((a, x) => a + baseValue(x), 0);
  const get = pv(m.getPlayers) + kv(m.getPicks), give = pv(m.givePlayers) + kv(m.givePicks);
  return give <= 0 ? (get >= give ? 9 : 0) : get / give;
}
// 그 구단이 '수락'을 유지하는 선에서 미래 지명권을 얹어 우리 쪽 비율을 목표(want)까지 (최대 3개, 큰 것부터 필요한 만큼)
function sweetenAI(ai, mine, want) {
  const picks = assetsOf(ai).filter((a) => a.tradable && a.kind === 'fut').sort((x, y) => baseValue(y) - baseValue(x));
  for (let i = 0; i < 3 && fairRatio(mine) < want; i++) {
    const ok = picks.filter((a) => !mine.getPicks.includes(a)).find((a) => { const t = { ...mine, getPicks: [...mine.getPicks, a] }; return evaluate(ai, t).result === 'accept' && !stepienCheck(state.save.team, ai, [], t.getPicks).length; });
    if (!ok) break;
    mine.getPicks.push(ok);
  }
  return fairRatio(mine) >= want;
}
function buildWant(ai, tag) {
  const me = state.save.team;
  const asked = new Set(ib().list.filter((o) => o.team === ai).flatMap((o) => o.give));   // 같은 구단이 같은 선수를 또 요청하지 않음
  const mine0 = tradablePlayers(me).filter((p) => !asked.has(p.player_id)).map((p) => ({ p, v: playerValue(ai, p) })).filter((x) => x.v > 8).sort((a, b) => b.v - a.v).slice(0, 4);
  if (!mine0.length) return null;
  const target = mine0[Math.floor(R(`t:${tag}`) * mine0.length)].p;
  const pool = tradablePlayers(ai).map((p) => ({ p, v: playerValue(ai, p) })).sort((a, b) => a.v - b.v).map((x) => x.p);
  const fill = [];
  for (let i = 0; i < 4 && !sideOK(ai, [target], fill); i++) { const nx = pool.find((q) => !fill.includes(q)); if (!nx) break; fill.push(nx); }
  if (!sideOK(ai, [target], fill)) return null;
  const mine = { givePlayers: [target], getPlayers: fill, givePicks: [], getPicks: [] };
  if (evaluate(ai, mine).result !== 'accept') return null;
  if (!sweetenAI(ai, mine, 0.9 + R(`w:${tag}`) * 0.2)) return null;     // 우리 쪽도 공정 가치 90~110%가 돼야 보냄
  return { motive: 'want', mine };
}
function buildDump(ai) {
  const t = teamOf(ai), l = L();
  if (teamPayroll(t, S()) <= l.tax_level) return null;
  const bad = tradablePlayers(ai).filter((p) => curSalary(p) >= 5e6).map((p) => ({ p, v: playerValue(ai, p) })).filter((x) => x.v < -5).sort((a, b) => a.v - b.v)[0];
  if (!bad || !sideOK(ai, [], [bad.p])) return null;
  const mine = { givePlayers: [], getPlayers: [bad.p], givePicks: [], getPicks: [] };
  if (evaluate(ai, mine).result !== 'accept') return null;
  sweetenAI(ai, mine, 1.0);
  if (!mine.getPicks.length || playerValue(null, bad.p, true) + mine.getPicks.reduce((a, x) => a + baseValue(x), 0) < 3) return null;   // 덤이 부담을 덮을 때만
  return { motive: 'dump', mine };
}
const MSG = {
  want: (ai, m) => ({ contend: `우승을 노리려면 ${m.givePlayers[0].name} 선수가 필요해요. 이 조건 어떠세요?`, rebuild: `${m.givePlayers[0].name} 선수는 저희 미래 계획에 잘 맞아요. 이렇게 하면 어떨까요?`, middle: `${m.givePlayers[0].name} 선수를 데려오고 싶어요. 조건을 맞춰 봤어요.` })[gmProfile(ai).mode],
  dump: (ai, m) => `사치세 부담을 줄이고 싶어요. ${m.getPlayers[0].name} 선수를 받아 주시면 지명권을 얹어 드릴게요.`,
};
export function dayOffers() {
  if (!windowOpen()) return [];
  const box = ib(), key = dayKey();
  if (box.day === key) return box.list.filter((o) => o.status === 'open');
  for (const o of box.list) if (o.status === 'open') o.status = 'expired';
  box.day = key;
  const made = [], total = box.list.length;
  const tries = R(`day:${key}`) < 0.45 ? (R(`day2:${key}`) < 0.15 ? 2 : 1) : 0;
  const teams = state.data.teams.filter((t) => t.abbr !== state.save.team).map((t) => ({ a: t.abbr, k: R(`ord:${key}:${t.abbr}`) })).sort((x, y) => x.k - y.k).map((x) => x.a);
  for (const ai of teams) {
    if (made.length >= tries || total + made.length >= 5) break;
    const b = (R(`m:${key}:${ai}`) < 0.3 ? buildDump(ai) : null) || buildWant(ai, `${key}:${ai}`);
    if (!b) continue;
    const o = { id: ++box.n, day: key, team: ai, motive: b.motive, status: 'open', msg: MSG[b.motive](ai, b.mine),
      give: b.mine.givePlayers.map((p) => p.player_id), get: b.mine.getPlayers.map((p) => p.player_id), getPicks: b.mine.getPicks.map((a) => a.key) };
    box.list.push(o); made.push(o);
  }
  writeSave();
  return box.list.filter((o) => o.status === 'open');
}
// 제안을 지금 선수·지명권으로 풀기 (바뀌었으면 null)
export function resolveOffer(o) {
  const me = teamOf(state.save.team), them = teamOf(o.team);
  const givePlayers = o.give.map((id) => me.roster.find((p) => p.player_id === id)), getPlayers = o.get.map((id) => them.roster.find((p) => p.player_id === id));
  const getPicks = o.getPicks.map((k) => assetsOf(o.team).find((a) => a.key === k));
  if ([...givePlayers, ...getPlayers, ...getPicks].some((x) => !x)) return null;
  return { givePlayers, getPlayers, givePicks: [], getPicks };
}
export function acceptOffer(o) {
  const m = resolveOffer(o);
  if (!m) { o.status = 'expired'; writeSave(); return { err: '선수나 지명권이 바뀌어서 이 제안은 무효가 됐어요.' }; }
  const r = evaluate(o.team, m);
  if (r.result !== 'accept') { o.status = 'expired'; writeSave(); return { err: r.errs?.[0] || '상황이 바뀌어서 상대 구단이 제안을 거둬들였어요.' }; }
  execute(o.team, m); o.status = 'accepted';
  for (const x of ib().list) if (x !== o && x.status === 'open' && !resolveOffer(x)) x.status = 'expired';
  writeSave(); return { ok: true };
}
export function declineOffer(o) { o.status = 'declined'; writeSave(); }
