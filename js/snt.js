// 사인 앤 트레이드: 우리 FA(지난 시즌 끝까지 우리 로스터)를 우리가 재계약시켜 바로 다른 팀으로 보내고 대가를 받음
// 규정: 3~4년(옵션 해 제외), 정규시즌 전, 받는 팀은 트레이드 뒤 에이프런(2017)·1차 에이프런(2023) 아래 + 그해 하드캡,
//       받는 팀이 그해 납세자 MLE를 썼으면 불가, 2023 협약은 2차 에이프런 위 팀 불가. 연봉 맞추기는 일반 트레이드와 같음
// 출처: Wikipedia "Sign-and-trade deal", SBC CBA 101(2023 협약 하드캡·2차 에이프런). 해마다 인상 5% 제한은 출처 확인 중(게임 설정)
// AI 대가: 그 팀이 보는 이 선수 잉여 가치의 일부 (그냥 캡 공간으로 데려올 수 있으면 15%, 사인 앤 트레이드로만 가능하면 40%)
import { state, writeSave } from './store.js';
import * as O from './offseason.js';
import * as F from './fa.js';
import * as PT from './ptrade.js';
import { perceivedValue } from './ai.js';
import { assetsOf, setOwner, stepienCheck, plainLabel } from './picks.js';
import { teamPayroll } from './rules.js';

const S = () => state.data.season;
const L = () => state.data.league;
const teamOf = (abbr) => state.data.teams.find((t) => t.abbr === abbr);
const seasonAfter = (s, k) => { const a = +s.slice(0, 4) + k; return `${a}-${String(a + 1).slice(2)}`; };
const apronKey = () => (L().first_apron ? 'first_apron' : 'apron');
export const RAISE = 0.05;

export function eligible(p) {
  const me = state.save.team, c = p.contract || {};
  if (c.rights_team !== me || c.renounced) return '권리를 가진 우리 FA만 가능해요';
  if (state.save.phase !== 'fa' || F.fa().done) return 'FA 기간에만 할 수 있어요';
  if (F.fa().step < F.steps().findIndex((x) => x.k === 'mor')) return '모라토리엄이 끝난 뒤(공식 서명 가능)부터 할 수 있어요';
  if (F.inSheet(p.player_id)) return '오퍼시트가 걸려 있어요';
  return null;
}
// 받는 팀 조건
function partnerError(ai, s1) {
  const l = L(), pay = teamPayroll(teamOf(ai), S());
  if (F.cba() === '2023' && l.second_apron && pay >= l.second_apron) return '2차 에이프런 위 팀은 사인 앤 트레이드로 선수를 받을 수 없어요';
  if ((state.save.log || []).some((e) => e.t === 'sign' && e.team === ai && e.tool === 'mle_tp')) return '그해 납세자 MLE를 쓴 팀은 받을 수 없어요';
  return null;
}
// 상대가 보내는 선수(연봉 맞추기용): 가치가 낮은 선수부터, 필요한 만큼
function fillers(ai, s1) {
  const t = teamOf(ai), out = [];
  const pool = t.roster.filter((q) => !PT.blocked(q)).sort((a, b) => PT.playerValue(ai, a) - PT.playerValue(ai, b));
  for (let i = 0; i < 4; i++) {
    const c = PT.checkSide(ai, out, [fake(s1)]);
    if (!c.errs.some((e) => e.includes('한도'))) return out;
    const nx = pool.find((q) => !out.includes(q)); if (!nx) return null;
    out.push(nx);
  }
  return PT.checkSide(ai, out, [fake(s1)]).errs.length ? null : out;
}
const fake = (s1) => ({ player_id: '_snt', contract: { years: [{ season: S(), salary: s1, cap_hit: s1 }] } });

// 우리 FA 한 명에 대한 사인 앤 트레이드 제안들 (최대 3개)
export function options(p) {
  if (eligible(p)) return [];
  const me = state.save.team, offers = F.offersFor(p.player_id).filter((o) => o.team !== me);
  const teams = [...new Set([...offers.map((o) => o.team), ...state.data.teams.map((t) => t.abbr).filter((a) => a !== me).sort((a, b) => F.fit(b, p).score - F.fit(a, p).score).slice(0, 4)])];
  const out = [];
  for (const ai of teams) {
    const theirs = offers.find((o) => o.team === ai);
    const yrs = Math.max(3, Math.min(4, theirs?.yrs || F.persona(p).want));
    const s1 = Math.round((theirs?.s1 || Math.min(F.ask(p), F.V(p))) / 1e5) * 1e5;
    const o = { tool: 'bird', s1, yrs, raise: RAISE, opt: 'none' };
    const pe = partnerError(ai, s1); if (pe) continue;
    // 선수 의향: 이 팀 조건이 다른 제안보다 크게 나쁘지 않아야 함
    const sc = F.score(p, ai, o), best = F.bestRival(p)?.sc || 0;
    if (sc < 0.9 || sc < best - 0.05) continue;
    const fl = fillers(ai, s1); if (!fl) continue;
    // 받는 팀 하드캡(에이프런 아래)
    const payAfter = teamPayroll(teamOf(ai), S()) - fl.reduce((a, q) => a + (q.contract.years.find((y) => y.season === S())?.salary || 0), 0) + s1;
    if (payAfter > L()[apronKey()]) continue;
    // 우리 쪽 검사 (우리가 받는 선수 연봉)
    const mine = PT.checkSide(me, [fake(s1)], fl); if (mine.errs.length) continue;
    // 대가: 그 팀이 보는 잉여 가치의 일부를 지명권으로
    const tmp = { ...p, contract: { ...p.contract, years: F.buildYears(p, o, S()) } };
    const surplus = PT.playerValue(ai, tmp) - fl.reduce((a, q) => a + PT.playerValue(ai, q), 0);
    const direct = theirs && !F.check(ai, p, theirs).errors.length;
    const budget = surplus * (direct ? 0.15 : 0.4);
    const picks = assetsOf(ai).filter((a) => a.tradable && a.kind === 'fut').map((a) => ({ a, v: perceivedValue(ai, a) })).sort((x, y) => y.v - x.v);
    const give = []; let left = budget;
    for (const x of picks) if (x.v <= left && give.length < 2) { give.push(x.a); left -= x.v; }
    if (!give.length && !fl.length) continue;
    if (give.length && stepienCheck(me, ai, [], give).length) continue;
    out.push({ ai, o, sal: F.salaries(p, o), fillers: fl, picks: give, direct, sc: Math.round(sc * 100) / 100 });
    if (out.length >= 3) break;
  }
  return out;
}
export function execute(p, d) {
  const me = state.save.team;
  F.sign(p, me, d.o, 'snt');
  d.picks.forEach((a) => setOwner(a, me));
  O.log({ t: 'ptrade', team: me, partner: d.ai, give: [p.player_id], get: d.fillers.map((q) => q.player_id), snt: true });
  O.log({ t: 'hardcap', team: d.ai, line: apronKey(), why: 'snt' });
  PT.pt().log.push({ partner: d.ai, gave: [`${p.name} (사인 앤 트레이드 ${d.o.yrs}년)`], got: [...d.fillers.map((q) => q.name), ...d.picks.map(plainLabel)], phase: 'fa', snt: true });
  F.news(`${teamOf(d.ai).name}, 사인 앤 트레이드로 ${p.name} 영입 (${d.o.yrs}년) · ${teamOf(me).name}은 ${[...d.fillers.map((q) => q.name), ...d.picks.map(plainLabel)].join(', ') || '없음'} 받음`, { mine: true, big: true });
  writeSave();
}
