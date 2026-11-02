// 캡 상황판 계산 (다가오는 시즌 기준)
// 캡에 잡히는 것: ① 계약 연봉(옵션 미정 포함) ② 데드머니 ③ 우리 FA 캡 홀드(권리 포기 전까지) ④ 1라운드 신인 홀드(계약 전까지) ⑤ 빈 로스터 자리 요금(12명 미만)
// 규정 출처: 2017·2023 노사협약 (league/rules/rules.json), 검증: 드래프트 전 보도 44건과 차이 중앙값 140만 달러
import { state } from './store.js';
import { capHit, teamPayroll } from './rules.js';

const L = () => state.data.league;
const S = () => state.data.season;
const minSal = (svc) => L().minimum[Math.min(svc || 0, L().minimum.length - 1)];
const maxSal = (svc) => (svc >= 10 ? L().max_10 : svc >= 7 ? L().max_7_9 : L().max_0_6);

// FA 캡 홀드
export function faHold(fa) {
  const c = fa.contract, svc = c.service_years || 0;
  const prev = c.last_salary || minSal(svc);
  if ((c.last_contract || '').startsWith('TWO-WAY')) return minSal(0);
  const eaps = L().eaps_hold || prev;
  let pct;
  if (c.bird === 'full') pct = fa.rookie_scale_pick ? (prev >= eaps ? 2.5 : 3.0) : (prev >= eaps ? 1.5 : 1.9);
  else if (c.bird === 'early') pct = 1.3;
  else pct = 1.2;
  let h = Math.min(Math.max(prev * pct, minSal(svc)), maxSal(svc));
  if (c.fa_type === 'RFA' && c.qo) h = Math.max(h, c.qo);
  return Math.round(h);
}
export const BIRD_KO = { full: '풀 버드', early: '얼리 버드', non: '논 버드' };

// 1라운드 신인 홀드: 지명했지만 아직 계약 안 한 선수 / 드래프트 전이면 가진 1라운드 지명권
function pickHolds(abbr) {
  const s = state.save, scale = state.rules?.rookie_scale?.[String(s.year)] || {};
  const amt = (pick) => Math.round((scale[String(pick)]?.y1 || L().rookie_scale_100pct?.[String(pick)]?.y1 || 0) * 1.2);
  const signed = new Set((s.log || []).filter((e) => e.t === 'rookie').map((e) => e.pid));
  if (s.draft?.made?.length) {
    return s.draft.made.filter((m) => m.team === abbr && m.round === 1 && !signed.has(m.id)).map((m) => ({ label: `${m.pick}순위 ${m.name}`, amount: amt(m.pick) }));
  }
  const picks = (s.picks || state.data.draft_order).filter((o) => o.team === abbr && o.round === 1);
  return picks.map((o) => ({ label: `${o.pick}순위 지명권`, amount: amt(o.pick) }));
}

export function capSheet(abbr = state.save.team) {
  const t = state.data.teams.find((x) => x.abbr === abbr), season = S();
  const players = [], pending = [];
  for (const p of t.roster) {
    if (p.roster_role === 'two_way') continue;
    const y = (p.contract?.years || []).find((x) => x.season === season);
    if (!y) continue;
    const hit = capHit(p, season) || 0;
    const row = { p, hit, guaranteed: y.guaranteed ?? hit, option: y.option && !y.option_status ? y.option : null };
    players.push(row);
  }
  const salary = players.reduce((a, r) => a + r.hit, 0);
  const dead = teamPayroll(t, season) - salary;   // teamPayroll = 계약 연봉 + 데드머니
  const holds = state.data.free_agents.filter((f) => f.contract?.rights_team === abbr && !f.contract.renounced)
    .map((f) => ({ p: f, amount: faHold(f) }));
  const ph = pickHolds(abbr);
  const count = players.length + ph.length;
  const emptySpots = Math.max(0, 12 - count);
  const charge = emptySpots * (L().roster_charge || minSal(0));
  const parts = { salary, dead, holds: holds.reduce((a, h) => a + h.amount, 0), picks: ph.reduce((a, h) => a + h.amount, 0), charge };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  const cap = L().salary_cap;
  return { team: t, players, holds, pickHolds: ph, parts, total, room: cap - total, emptySpots, count,
    ngTotal: players.reduce((a, r) => a + Math.max(0, r.hit - r.guaranteed), 0) };
}

// 지금 쓸 수 있는 계약 수단 (간단판: 캡 여유가 있으면 캡 공간 + 룸 MLE, 아니면 MLE 종류는 에이프런 위치로)
export function tools(sheet) {
  const l = L(), out = [];
  const payroll = sheet.total - sheet.parts.holds - sheet.parts.picks - sheet.parts.charge;
  if (sheet.room > 0) {
    out.push({ k: 'room', name: '캡 공간', amount: sheet.room, note: '이 금액까지 어느 FA와도 계약할 수 있어요' });
    out.push({ k: 'mle_room', name: '룸 MLE', amount: l.mle_room, note: '캡 공간을 다 쓴 뒤에 쓰는 예외' });
  } else {
    const apron = l.first_apron || l.apron;
    if (payroll < apron) out.push({ k: 'mle_non_taxpayer', name: '일반 MLE', amount: l.mle_non_taxpayer, note: `계약 후 총연봉이 ${l.first_apron ? '1차 ' : ''}에이프런을 넘으면 못 써요` });
    else out.push({ k: 'mle_taxpayer', name: '납세자 MLE', amount: l.mle_taxpayer, note: '에이프런 위 팀이 쓰는 작은 MLE' });
    if (payroll < apron) out.push({ k: 'bae', name: '격년 예외(BAE)', amount: l.bae, note: '2년에 한 번 쓸 수 있어요' });
  }
  out.push({ k: 'bird', name: '버드 권리 재계약', amount: null, note: '우리 FA는 캡을 넘어도 재계약 가능 (권리 포기 전까지)' });
  out.push({ k: 'min', name: '최저연봉 계약', amount: minSal(0), note: '언제든, 몇 명이든' });
  return out;
}
