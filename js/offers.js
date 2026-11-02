// 다른 구단이 먼저 거는 지명권 트레이드 제안
// - 동기(왜 제안하는지)가 있는 제안만 만듦:
//   up      : 우리 이번 지명권을 원함 (노리는 선수가 있음) → 자기 뒤쪽 지명권 + 덤
//   win_now : 우승 도전 팀이 미래 지명권을 주고 이번 지명권을 원함
//   future  : 리빌딩 팀이 우리 미래 1라운드를 원함 → 이번 지명권을 줌
//   down    : 앞 순위를 가진 팀이 내려가고 싶어함 → 우리 뒤 지명권 + 미래 지명권을 원함
// - 상대 AI가 실제로 받아들일 거래만 제안 (그 구단 눈으로 본 가치 기준), 우리 쪽 가치는 기준 곡선으로 0.85~1.2배
// - Stepien 규칙 검사, 다른 팀 권리가 걸린 지명권은 쓰지 않음
import { state, writeSave } from './store.js';
import { gmProfile, perceivedValue, rng, hash } from './ai.js';
import { assetsOf, baseValue, stepienCheck, setOwner, plainLabel } from './picks.js';

const R = (tag) => rng(hash(`${state.save.seed}:offer:${tag}`));
const sumB = (as) => as.reduce((v, a) => v + baseValue(a), 0);
const sumP = (abbr, as) => as.reduce((v, a) => v + perceivedValue(abbr, a), 0);
export const inbox = () => (state.save.offers ||= { list: [], n: 0 });
const teamName = (abbr) => state.data.teams.find((t) => t.abbr === abbr)?.name || abbr;

// AI가 덤으로 얹을 지명권 고르기: 부족한 만큼을 가장 작게 채우는 것
function sweeten(abbr, have, gap, exclude) {
  const pool = live(abbr).filter((a) => !exclude.has(a.key) && !have.some((h) => h.key === a.key))
    .map((a) => ({ a, v: baseValue(a) })).sort((x, y) => x.v - y.v);
  return (pool.find((x) => x.v >= gap) || pool[pool.length - 1])?.a || null;
}
function valid(ai, give, get) {
  const me = state.save.team;
  if (!give.length || !get.length) return false;
  if ([...give, ...get].some((a) => !a.tradable)) return false;
  return !stepienCheck(me, ai, get, give).length;   // 우리 입장: 주는 것 = get(AI가 받는 것)
}
// AI 입장에서 할 만한가 (eager: 노리는 선수가 있어서 조금 더 낼 수 있음)
const aiOk = (ai, give, get, eager = 0) => sumP(ai, get) * (1 + eager) >= sumP(ai, give) * (1 + gmProfile(ai).greed * 0.4);

// 드래프트 중이면 이미 쓴 이번 지명권은 거래 대상이 아님
const used = () => new Set((state.save.draft?.made || []).map((m) => m.pick));
const live = (abbr) => { const u = used(); return assetsOf(abbr).filter((a) => a.tradable && !(a.kind === 'cur' && u.has(a.pick))); };
function build(motive, ai, tag, target = null) {
  const me = state.save.team, mine = live(me), theirs = live(ai);
  const r = R(tag), want = 0.88 + r() * 0.3;      // 우리 쪽 기준 가치 비율 목표 (0.88~1.18)
  let give = [], get = [];
  const myCur = mine.filter((a) => a.kind === 'cur'), theirCur = theirs.filter((a) => a.kind === 'cur');
  if (motive === 'up' || motive === 'win_now') {
    const x = target || myCur.slice().sort((a, b) => a.pick - b.pick)[Math.floor(r() * Math.min(2, myCur.length))];
    if (!x) return null;
    get = [x];
    if (motive === 'up') {
      const later = theirCur.filter((a) => a.pick > x.pick).sort((a, b) => a.pick - b.pick)[0];
      if (!later) return null;
      give = [later];
    } else {
      const f1 = theirs.filter((a) => a.kind === 'fut' && a.round === 1).sort((a, b) => b.year - a.year)[0];
      if (!f1) return null;
      give = [f1];
    }
  } else if (motive === 'future') {
    const f = mine.filter((a) => a.kind === 'fut' && a.round === 1 && a.original === me).sort((a, b) => a.year - b.year)[Math.floor(r() * 2)]
      || mine.find((a) => a.kind === 'fut' && a.round === 1);
    if (!f) return null;
    get = [f];
    const c = theirCur.slice().sort((a, b) => Math.abs(baseValue(a) - baseValue(f)) - Math.abs(baseValue(b) - baseValue(f)))[0];
    if (!c) return null;
    give = [c];
  } else if (motive === 'down') {
    const top = theirCur.filter((a) => myCur.some((m) => m.pick > a.pick)).sort((a, b) => a.pick - b.pick)[0];
    if (!top) return null;
    const mine1 = myCur.filter((m) => m.pick > top.pick).sort((a, b) => a.pick - b.pick)[0];
    give = [top]; get = [mine1];
  }
  // 가치 맞추기: 우리 쪽 비율이 목표에 오도록 덤 추가 (up/win_now/future = AI가 덤, down = 우리가 덤)
  const ex = new Set();
  for (let i = 0; i < 2; i++) {
    const ratio = sumB(give) / Math.max(1e-6, sumB(get));
    if (motive === 'down') {
      if (ratio <= want + 0.05) break;
      const add = sweeten(me, get, sumB(give) / want - sumB(get), ex); if (!add) break; get.push(add);
    } else {
      if (ratio >= want - 0.05) break;
      const add = sweeten(ai, give, sumB(get) * want - sumB(give), ex); if (!add) break; give.push(add);
    }
  }
  const ratio = sumB(give) / Math.max(1e-6, sumB(get));
  if (ratio < 0.8 || ratio > 1.3) return null;
  if (!valid(ai, give, get)) return null;
  if (!aiOk(ai, give, get, motive === 'up' ? 0.06 + r() * 0.1 : motive === 'win_now' ? 0.05 : 0)) return null;
  return { motive, team: ai, give: give.map((a) => a.key), get: get.map((a) => a.key), ratio: +ratio.toFixed(3) };
}

const MSG = {
  up: (o, x) => `${x}순위에서 꼭 뽑고 싶은 선수가 있어요. 이 조건이면 어떠세요?`,
  win_now: (o, x) => `저희는 지금 우승을 노려요. 미래 지명권을 드릴 테니 ${x ? x + '순위' : '이번 지명권'}를 주세요.`,
  future: (o) => gmProfile(o.team).mode === 'rebuild' ? '리빌딩 중이라 미래 1라운드가 필요해요. 대신 이번 드래프트 지명권을 드릴게요.' : '미래 자산을 모아 두고 싶어요. 이번 드래프트 지명권과 미래 1라운드를 바꾸실래요?',
  down: (o, x) => `저희 ${x}순위에서 내려가고 싶어요. 더 높은 순위가 필요하면 연락 주세요.`,
};
// 후보 구단·동기 고르기
function candidates(where) {
  const me = state.save.team, out = [];
  for (const t of state.data.teams) {
    if (t.abbr === me) continue;
    const g = gmProfile(t.abbr);
    const ms = where === 'draft' ? ['up'] : g.mode === 'contend' ? ['up', 'win_now', 'down'] : g.mode === 'rebuild' ? ['future', 'down', 'up'] : ['up', 'down', 'future'];
    for (const m of ms) out.push({ ai: t.abbr, m, w: g.counterRate * (m === ms[0] ? 1.4 : 1) });
  }
  return out;
}
// 새 제안 하나 만들기 (조건: 같은 구단이 이미 열린 제안이 있으면 건너뜀)
export function newOffer(where = 'window', target = null) {
  const ib = inbox(), open = new Set(ib.list.filter((o) => o.status === 'open').map((o) => o.team));
  const c = candidates(where).filter((x) => !open.has(x.ai) && !ib.list.some((o) => o.team === x.ai && o.where === where && o.status === 'declined'));
  const r = R(`pick:${where}:${ib.n}:${target?.key || ''}`);
  const ordered = c.map((x) => ({ ...x, k: r() * x.w })).sort((a, b) => b.k - a.k);
  for (const x of ordered.slice(0, 25)) {
    const o = build(x.m, x.ai, `${where}:${ib.n}:${x.ai}:${x.m}`, target);
    if (!o) continue;
    // 같은 우리 지명권을 노리는 열린 제안이 이미 2개면 다른 제안을 찾음 (제안이 한 지명권에만 몰리지 않게)
    if (where === 'window' && o.get.some((k) => ib.list.filter((p) => p.status === 'open' && p.get.includes(k)).length >= 2)) continue;
    const myPick = (o.motive === 'down' ? o.give : o.get).map((k) => k.startsWith('c:') ? +k.slice(2) : null).find(Boolean);
    Object.assign(o, { id: ++ib.n, where, status: 'open', msg: MSG[o.motive](o, myPick), at: Date.now() });
    ib.list.push(o); writeSave();
    return o;
  }
  return null;
}
// 트레이드 구간 시작 때 2~4건
export function openWindow() {
  const ib = inbox(); if (ib.opened) return []; ib.opened = true;
  const n = 2 + Math.floor(R('n')() * 3), out = [];
  for (let i = 0; i < n; i++) { const o = newOffer('window'); if (o) out.push(o); }
  writeSave();
  return out;
}
// 우리가 무언가 할 때마다 가끔 새 전화 (30% 확률, 처음 제안 포함 최대 5건)
export function maybeMore() {
  const ib = inbox();
  if (ib.list.filter((o) => o.where === 'window').length >= 5) return null;
  return R(`more:${ib.n}:${state.save.tradesLeft}`)() < 0.3 ? newOffer('window') : null;
}
// 드래프트 우리 차례: 이 지명권을 노리는 전화 (픽마다 한 번만 계산)
export function draftCall(slot) {
  const ib = inbox(), key = `c:${slot.pick}`;
  const ex = ib.list.find((o) => o.where === 'draft' && o.slot === slot.pick);
  if (ex) return ex.status === 'open' ? ex : null;
  if ((ib.tried ||= []).includes(slot.pick)) return null;
  ib.tried.push(slot.pick); writeSave();
  if (R(`call:${slot.pick}`)() > (slot.round === 1 ? 0.45 : 0.3)) return null;
  const target = assetsOf(state.save.team).find((a) => a.key === key);
  const o = newOffer('draft', target);
  if (o) { o.slot = slot.pick; writeSave(); }
  return o;
}

// 제안 내용을 현재 지명권으로 풀기 (주인이 바뀌었으면 무효)
export function resolve(o) {
  const me = state.save.team;
  const mine = live(me), theirs = live(o.team);
  const give = o.give.map((k) => theirs.find((a) => a.key === k)), get = o.get.map((k) => mine.find((a) => a.key === k));
  if (give.some((a) => !a) || get.some((a) => !a)) return null;
  return { give, get };   // give = 우리가 받는 것, get = 우리가 주는 것
}
export function accept(o) {
  const x = resolve(o); if (!x) { o.status = 'expired'; writeSave(); return { err: '지명권 주인이 바뀌어서 이 제안은 무효가 됐어요.' }; }
  if (stepienCheck(state.save.team, o.team, x.get, x.give).length) { o.status = 'expired'; writeSave(); return { err: 'Stepien 규칙에 걸려서 받아들일 수 없어요.' }; }
  x.get.forEach((a) => setOwner(a, o.team));
  x.give.forEach((a) => setOwner(a, state.save.team));
  (state.save.trades ||= []).push({ partner: o.team, gave: x.get.map(plainLabel), got: x.give.map(plainLabel), gave_keys: o.get, got_keys: o.give, incoming: true, motive: o.motive });
  o.status = 'accepted';
  for (const p of inbox().list) if (p !== o && p.status === 'open' && !resolve(p)) p.status = 'expired';   // 같은 지명권이 걸린 다른 제안은 무효
  writeSave();
  return { ok: true };
}
export function decline(o) { o.status = 'declined'; writeSave(); }
export function expireWindow() { for (const o of inbox().list) if (o.where === 'window' && o.status === 'open') o.status = 'expired'; writeSave(); }
export const openOffers = (where) => inbox().list.filter((o) => o.status === 'open' && o.where === where && resolve(o));
export { teamName };
