// 드래프트 다음 단계: ① 옵션 결정 ② 퀄리파잉 오퍼 ③ 신인 계약
// - 이용자 팀은 직접 결정, 다른 구단·선수는 AI가 결정 (시장 가치 모델 + 구단 성향 + 무작위)
// - 결정은 save.log에 쌓고, 게임을 다시 열 때 원본 데이터에 차례로 다시 적용함 (replay)
import { state, writeSave } from './store.js';
import { gmProfile, rng, hash } from './ai.js';

const S = () => state.data.season;                       // 다가오는 시즌 (예: '2024-25')
const L = () => state.data.league;
const R = () => state.rules;                             // data/rules.json (CBA 수치)
export const minSalary = (svc = 0) => L().minimum[Math.min(svc, L().minimum.length - 1)];
const seasonAfter = (s, k) => { const a = +s.slice(0, 4) + k; return `${a}-${String(a + 1).slice(2)}`; };
const teamOf = (abbr) => state.data.teams.find((t) => t.abbr === abbr);
export const mv = (p) => p.market_value?.salary ?? minSalary(p.contract?.service_years || 0);
// 최고 연봉 한도 (경력 0~6년 25%, 7~9년 30%, 10년+ 35%)
export function maxSalary(svc) { const l = L(); return svc >= 10 ? l.max_10 : svc >= 7 ? l.max_7_9 : l.max_0_6; }
export const value = (p) => Math.min(mv(p), maxSalary(p.contract?.service_years || p.experience_seasons || 0));

// ───────── ① 옵션 ─────────
export function pendingOptions(abbr) {
  const out = [];
  for (const t of state.data.teams) {
    if (abbr && t.abbr !== abbr) continue;
    for (const p of t.roster) {
      const y = (p.contract?.years || []).find((x) => x.season === S() && x.option && !x.option_status);
      if (y) out.push({ p, team: t.abbr, y, kind: y.option });
    }
  }
  return out;
}
const R0 = (tag) => rng(hash(`${state.save.seed}:${tag}`));
// AI 팀 옵션: 시장 가치가 옵션 연봉보다 낮으면 거절 (우승 도전 팀은 조금 더 너그러움)
export function aiTeamOption(o) {
  const g = gmProfile(o.team), r = R0(`topt:${o.p.player_id}`)();
  const ratio = value(o.p) / Math.max(1, o.y.salary) * (0.9 + r * 0.2);
  const need = g.mode === 'contend' ? 0.85 : g.mode === 'rebuild' ? 1.0 : 0.93;
  const cheap = o.y.salary <= minSalary(o.p.contract?.service_years || 0) * 1.15;   // 최저연봉 근처면 대개 실행
  return ratio >= need || (cheap && ratio >= 0.6);
}
// AI 선수 옵션: 시장에서 더 받을 수 있으면 거절(=FA), 나이가 많을수록 안전하게 남음
export function aiPlayerOption(o) {
  const r = R0(`popt:${o.p.player_id}`)();
  const age = o.p.age || 28, m = o.p.market_value?.years || 1;
  const want = (age >= 33 ? 1.35 : age >= 30 ? 1.2 : 1.1) - Math.min(0.08, (m - 1) * 0.03);   // 장기 계약이 예상되면 나갈 유인 큼
  return !(value(o.p) * (0.9 + r * 0.2) >= o.y.salary * want);   // true = 실행(남음)
}

// ───────── ② 퀄리파잉 오퍼 ─────────
export const rfaCandidates = (abbr) => state.data.free_agents.filter((p) => (p.contract?.fa_type || '').startsWith('RFA') && (!abbr || p.contract.rights_team === abbr) && !p.contract.qo_decided);
// QO 금액 (2017·2023 노사협약, data/rules.json)
// - 신인 계약을 마친 1라운드: 4년차 연봉 × (1 + 순위별 비율). 비율은 그 신인 계약이 맺어진 협약 기준 (2022년 클래스까지 30~50%, 2023년부터 40~60%)
// - 선발 기준(직전 시즌 41경기 선발 또는 2,000분, 또는 직전 2시즌 평균)에 따라 조정:
//     10~30순위가 기준 충족 → 9순위 QO 금액 / 1~14순위가 기준 미달 → 자기 QO와 15순위 QO 중 작은 값
//     2라운드·미지명(경력 2~3년)이 기준 충족 → 21순위 금액(100% 기준)이 더 크면 그 금액
// - 그 밖: 직전 연봉 125%(2023-24 이후 맺은 계약은 135%)와 최저연봉+20만 달러 중 큰 값
export function starterMet(p) {
  const st = p.starter_stats || {}, a = st.last || {}, b = st.prev || {};
  const ok = (x) => (x.gs || 0) >= 41 || (x.mp || 0) >= 2000;
  return ok(a) || ((((a.gs || 0) + (b.gs || 0)) / 2) >= 41) || ((((a.mp || 0) + (b.mp || 0)) / 2) >= 2000);
}
const qoPct = (cls, pick) => { const t = R()?.qo_pct?.[cls >= 2023 ? '2023' : '2017']; return (t?.[String(pick)] ?? 40) / 100; };
const y4 = (cls, pick, pct = 1.2) => { const v = R()?.rookie_scale?.[String(cls)]?.[String(pick)]?.y4; return v ? v * pct : null; };
export function qoAmount(p) {
  const q = R()?.qo || { pct_prior_2017: 1.25, pct_prior_2023: 1.35, min_plus: 200000 };
  const svc = p.contract?.service_years || 0, prev = lastSalary(p);
  const pctPrior = (p.contract?.last_signed || '') >= '2023-07-01' ? q.pct_prior_2023 : q.pct_prior_2017;
  const general = Math.max(Math.round(prev * pctPrior), minSalary(svc) + q.min_plus);
  const met = starterMet(p);
  if (p.rookie_scale_pick) {
    const cls = p.rookie_scale_class, pick = p.rookie_scale_pick;
    // 실제 4년차 연봉(직전 연봉)을 우선, 없으면 규정 120%
    const own = Math.round((p.contract?.last_salary || y4(cls, pick) || 0) * (1 + qoPct(cls, pick)));
    const at = (k) => (y4(cls, k) ? Math.round(y4(cls, k) * (1 + qoPct(cls, k))) : null);
    if (pick >= 10 && met && at(9)) return Math.max(own, at(9));
    if (pick <= 14 && !met && at(15)) return Math.min(own, at(15));
    return own;
  }
  if (met && svc >= 2 && svc <= 3) {
    const cls = state.save.year - 4, a21 = y4(cls, 21, 1.0);
    if (a21) { const v = Math.round(a21 * (1 + qoPct(cls, 21))); if (v > general) return v; }
  }
  return general;
}
function lastSalary(p) {
  if (p.contract?.last_salary) return p.contract.last_salary;
  const hist = (p.contract?.years || []).filter((y) => y.season < S());
  return hist.length ? hist[hist.length - 1].salary : minSalary(p.contract?.service_years || 0);
}
export function aiQO(p) {
  const team = p.contract.rights_team, g = gmProfile(team), r = R0(`qo:${p.player_id}`)();
  const amt = qoAmount(p), v = value(p) * (0.85 + r * 0.3);
  const young = (p.age || 25) <= 24;
  return v >= amt * (g.mode === 'rebuild' ? 0.7 : 0.8) || (young && v >= amt * 0.6);
}

// ───────── ③ 신인 계약 ─────────
export function draftees(abbr) {
  const made = state.save.draft?.made || [];
  return made.filter((m) => (!abbr || m.team === abbr) && !(state.save.log || []).some((e) => e.t === 'rookie' && e.pid === m.id));
}
export function firstRoundYears(pick) {
  const rs = R()?.rookie_scale?.[String(state.save.year)]?.[String(pick)] || L().rookie_scale_100pct?.[String(pick)] || {};
  const pct = 1.2;   // 거의 모든 1라운드 신인이 규정 최대(120%)로 계약
  return ['y1', 'y2', 'y3', 'y4'].map((k, i) => ({ season: seasonAfter(S(), i), salary: rs[k] ? Math.round(rs[k] * pct) : null,
    kind: 'rookie_scale', option: i >= 2 ? 'team_option' : null, cap_hit: rs[k] ? Math.round(rs[k] * pct) : null }));
}
export function secondRoundYears() {
  if (state.save.year >= 2023) {   // 2023 협약: 2라운드 예외 (2년 + 3년차 팀 옵션, 첫해 경력 1년차 최저연봉까지)
    return [minSalary(1), minSalary(1), minSalary(2)].map((v, i) => ({ season: seasonAfter(S(), i), salary: v, kind: 'second_round_exception', option: i === 2 ? 'team_option' : null, cap_hit: v }));
  }
  return [0, 1].map((k, i) => ({ season: seasonAfter(S(), i), salary: minSalary(k), kind: 'contract', option: null, cap_hit: minSalary(k) }));   // 2017 협약: 최저연봉 2년
}
export const twoWaySalary = () => R()?.two_way?.[String(state.save.year)]?.salary ?? Math.round(minSalary(0) / 2);
export function aiSecondRound(m) {
  const p = state.data.draft_pool.find((x) => x.player_id === m.id), r = R0(`r2:${m.id}`)();
  const intl = p && !(p.college_seasons || []).length && (p.age_at_draft || 22) <= 21;
  if (intl && r < 0.45) return 'stash';                  // 어린 해외 선수는 해외에 남겨 두는 경우가 많음
  if (m.pick <= 45) return r < 0.55 ? 'standard' : 'two_way';
  return r < 0.3 ? 'standard' : r < 0.9 ? 'two_way' : 'stash';
}

// ───────── 기록 적용 ─────────
export function log(ev) { (state.save.log ||= []).push(ev); applyEvent(ev); writeSave(); }
export function replay() { for (const ev of state.save?.log || []) applyEvent(ev); }

function toFA(p, team, why) {
  const t = teamOf(team); t.roster = t.roster.filter((x) => x !== p);
  const svc = p.contract?.service_years ?? p.experience_seasons ?? 0;
  const prevYears = (p.contract?.years || []).filter((y) => y.season < S());
  // 버드 권리 추정: 계약 기록상 이 팀에서 보낸 시즌 수 (트레이드로 와도 권리는 따라옴) 3시즌 이상 풀 버드, 2시즌 얼리 버드
  const n = prevYears.length;
  p.contract = { status: 'free_agent', team: null, rights_team: team, fa_type: 'UFA', service_years: svc, years_remaining: 0,
    years: prevYears, last_salary: n ? prevYears[n - 1].salary : null, became_fa: why, bird: n >= 3 ? 'full' : n === 2 ? 'early' : 'non', bird_estimated: true };
  state.data.free_agents.push(p);
}

export function applyEvent(ev) {
  const d = state.data;
  if (ev.t === 'opt') {
    const t = teamOf(ev.team), p = t?.roster.find((x) => x.player_id === ev.pid);
    if (!p) return;
    const y = p.contract.years.find((x) => x.season === S());
    if (!y) return;
    y.option_status = ev.exercised ? 'exercised' : 'declined';
    if (!ev.exercised) {
      p.contract.years = p.contract.years.filter((x) => x.season < S());
      toFA(p, ev.team, ev.kind === 'team_option' ? '팀 옵션 거절' : '선수 옵션 거절');
    }
  } else if (ev.t === 'qo') {
    const p = d.free_agents.find((x) => x.player_id === ev.pid);
    if (!p) return;
    p.contract.qo_decided = true;
    if (ev.offered) { p.contract.fa_type = 'RFA'; p.contract.qo = ev.amount; }
    else p.contract.fa_type = 'UFA';
  } else if (ev.t === 'qo_withdraw') {   // QO 철회: UFA가 되지만 버드 권리(캡 홀드)는 남음
    const p = d.free_agents.find((x) => x.player_id === ev.pid);
    if (p) Object.assign(p.contract, { fa_type: 'UFA', qo: null, qo_withdrawn: true });
  } else if (ev.t === 'renounce') {   // 권리 포기: 캡 홀드가 사라지는 대신 버드 권리·RFA 권리도 사라짐 (되돌릴 수 없음)
    const p = d.free_agents.find((x) => x.player_id === ev.pid);
    if (!p) return;
    Object.assign(p.contract, { renounced: true, renounced_by: ev.team, rights_team: null, fa_type: 'UFA', bird: null, qo: null });
  } else if (ev.t === 'sign') {   // FA 계약 (재계약·이적·오퍼시트·QO 수락·투웨이)
    const i = d.free_agents.findIndex((x) => x.player_id === ev.pid), t = teamOf(ev.team);
    if (i < 0 || !t) return;
    const p = d.free_agents[i], prev = p.contract || {};
    d.free_agents.splice(i, 1);
    p.contract = { status: 'under_contract', team: t.abbr, years: [...(prev.years || []).filter((y) => y.season < S()), ...ev.years], years_remaining: ev.years.length,
      contract_kind: ev.two_way ? 'two_way' : 'free_agent', salary_this_season: ev.years[0]?.salary, cap_hit_this_season: ev.years[0]?.cap_hit,
      service_years: prev.service_years ?? p.experience_seasons ?? 0, signed_with: t.abbr, signed_how: ev.how, signed_tool: ev.tool,
      prev_team: prev.rights_team || prev.renounced_by || prev.team || null, last_salary: prev.last_salary, contract_end: ev.years[ev.years.length - 1]?.season,
      fa_after: ev.two_way || ev.how === 'qo' ? (ev.how === 'qo' ? 'UFA' : 'RFA') : 'UFA' };
    p.roster_role = ev.two_way ? 'two_way' : 'main';
    t.roster.push(p);
  } else if (ev.t === 'waive') {   // 방출: 웨이버 클레임이면 그 팀으로, 아니면 보장 금액을 데드머니로 남기고 FA로
    const t = teamOf(ev.team), p = t?.roster.find((x) => x.player_id === ev.pid);
    if (!p) return;
    t.roster = t.roster.filter((x) => x !== p);
    if (ev.claim) { const c = teamOf(ev.claim); p.contract.team = c.abbr; p.contract.claimed_from = ev.team; c.roster.push(p); return; }
    if (ev.dead?.length) (t.dead_money ||= []).push({ player_id: p.player_id, name: p.name, waived: true, stretch: !!ev.stretch, years: ev.dead });
    const svc = p.contract?.service_years ?? p.experience_seasons ?? 0;
    p.contract = { status: 'free_agent', team: null, rights_team: null, fa_type: 'UFA', service_years: svc, years_remaining: 0, years: [], last_salary: ev.last_salary, waived_by: ev.team };
    delete p.roster_role;
    d.free_agents.push(p);
  } else if (ev.t === 'convert') {   // 투웨이 ↔ 정규 / 캠프 계약 → 투웨이
    const t = teamOf(ev.team), p = t?.roster.find((x) => x.player_id === ev.pid);
    if (!p) return;
    p.contract.years = [...(p.contract.years || []).filter((y) => y.season < S()), ...ev.years];
    p.roster_role = ev.to === 'two_way' ? 'two_way' : 'main';
    p.contract.signed_tool = ev.to === 'two_way' ? 'two_way' : 'converted';
    p.contract.cap_hit_this_season = ev.years[0]?.cap_hit; p.contract.salary_this_season = ev.years[0]?.salary;
  } else if (ev.t === 'ptrade') {   // 선수 트레이드: 양쪽 선수를 맞바꿈 (지명권 주인은 저장 파일에 따로 기록)
    const a = teamOf(ev.team), b = teamOf(ev.partner);
    if (!a || !b) return;
    const mv = (from, to, ids) => { for (const id of ids) { const p = from.roster.find((x) => x.player_id === id); if (!p) continue; from.roster = from.roster.filter((x) => x !== p); p.contract.team = to.abbr; p.contract.traded_from = from.abbr; to.roster.push(p); } };
    mv(a, b, ev.give || []); mv(b, a, ev.get || []);
  } else if (ev.t === 'extend') {   // 연장 계약: 지금 계약 뒤에 해를 붙임
    const t = teamOf(ev.team), p = t?.roster.find((x) => x.player_id === ev.pid);
    if (p) { p.contract.years = [...(p.contract.years || []), ...ev.years]; p.contract.extended = ev.kind; p.contract.contract_end = ev.years[ev.years.length - 1].season; }
  } else if (ev.t === 'rookie') {
    const pr = d.draft_pool.find((x) => x.player_id === ev.pid), t = teamOf(ev.team);
    if (!pr || !t) return;
    if (ev.kind === 'stash') { (t.draft_rights ||= []).push({ player_id: pr.player_id, name: pr.name, pick: ev.pick, season: S() }); return; }
    const ht = pr.combine?.height_barefoot ?? (pr.height_listed ? (() => { const [f, i] = pr.height_listed.split('-').map(Number); return f * 12 + (i || 0); })() : null);
    t.roster.push({ player_id: 'r_' + pr.player_id, prospect_id: pr.player_id, name: pr.name, pos: pr.position, age: pr.age_at_draft,
      experience_seasons: 0, height_in: ht, weight_lb: pr.weight_listed || pr.combine?.weight || null, birth_date: pr.birth_date,
      colleges: pr.college || null, honors: [], nba_history: [], rookie: { pick: ev.pick, round: ev.round },
      roster_role: ev.kind === 'two_way' ? 'two_way' : 'main',
      contract: { status: 'under_contract', team: t.abbr, years: ev.years, years_remaining: ev.years.length, contract_kind: ev.kind === 'scale' ? 'rookie_scale' : ev.kind,
        salary_this_season: ev.years[0]?.salary, cap_hit_this_season: ev.kind === 'two_way' ? 0 : ev.years[0]?.salary, service_years: 0,
        fa_after: ev.kind === 'scale' ? 'RFA' : 'RFA', contract_end: ev.years[ev.years.length - 1]?.season } });
  }
}
