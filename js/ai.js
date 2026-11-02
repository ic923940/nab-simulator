// 다른 구단 AI: 구단마다 단장 성향이 다르고, 확률로 판단함 (난이도 설정 없음)
// - 성향은 실제 데이터(지난 시즌 성적·전력, 최근 사치세 납부)와 게임마다 다른 무작위 값으로 정함
// - 같은 게임 안에서는 같은 성향을 유지 (저장된 seed 사용)
import { state } from './store.js';
import { chartValue, futureBaseValue, assetLabel } from './picks.js';
export { chartValue };

// 문자열 → 숫자 (같은 입력이면 같은 결과)
export function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function rng(seed) {             // 0~1 사이 난수 생성기 (mulberry32)
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (r, lo, hi) => lo + r() * (hi - lo);

// 구단 단장 성향
const cache = {};
export function gmProfile(abbr) {
  const key = `${state.save.seed}:${abbr}`;
  if (cache[key]) return cache[key];
  const t = state.data.teams.find((x) => x.abbr === abbr);
  const ps = t.prev_season, wp = ps.w / Math.max(1, ps.w + ps.l);
  const r = rng(hash(key));
  // 팀 상황: 지난 시즌 전력(SRS)과 승률
  const mode = ps.srs >= 2.5 || wp >= 0.6 ? 'contend' : (wp < 0.4 || ps.srs <= -4 ? 'rebuild' : 'middle');
  const taxYears = (t.tax_paid_last4 || []).length;
  const p = {
    abbr, mode,
    // 지명권을 얼마나 아끼는지 (리빌딩 팀일수록 큼)
    pickLove: between(r, 0.9, 1.1) * (mode === 'rebuild' ? 1.12 : mode === 'contend' ? 0.92 : 1),
    // 거래에서 얼마나 이득을 원하는지 (0.03 = 3% 이상 이득이면 수락)
    greed: between(r, 0.03, 0.14),
    // 가치를 얼마나 정확히 보는지 (작을수록 정확) — 판단 실수의 크기
    noise: between(r, 0.04, 0.16),
    // 아깝게 모자랄 때 역제안을 할 확률
    counterRate: between(r, 0.45, 0.9),
    // 돈 쓰는 성향 (최근 4시즌 사치세 낸 횟수 기반) — 나중 FA·재계약에서 사용
    spend: taxYears >= 3 ? 'big' : taxYears >= 1 ? 'normal' : 'thrifty',
  };
  p.label = [
    { contend: '우승 도전', middle: '중위권', rebuild: '리빌딩' }[mode],
    // 지명권 선호·협상 깐깐함·평가 정확도는 수락 여부의 힌트가 돼서 보여 주지 않음 (팀 방향·지출 성향만 공개)
    { big: '돈을 아끼지 않음', normal: null, thrifty: '지출에 신중함' }[p.spend],
  ].filter(Boolean);
  return (cache[key] = p);
}

// 이 구단이 보는 지명권 가치 (성향 + 판단 실수 포함)
// - 이번 드래프트 지명권: 순위별 가치 곡선
// - 미래 지명권: 원래 팀 전력으로 본 예상 순위 + 보호 조건 + 먼 해일수록 할인 (우승 도전 팀은 미래를 더 많이 깎고, 리빌딩 팀은 덜 깎음)
export function perceivedValue(abbr, a) {
  const g = gmProfile(abbr);
  const r = rng(hash(`${state.save.seed}:${abbr}:pick:${a.key}`));
  const disc = { contend: 0.85, middle: 0.92, rebuild: 0.97 }[g.mode];
  let v = (a.kind === 'cur' ? chartValue(a.pick) : futureBaseValue(a, disc)) * (1 + (r() * 2 - 1) * (g.noise + (a.kind === 'fut' ? 0.04 : 0))) * g.pickLove;
  if (a.round === 2 && g.mode === 'contend') v *= 0.75;          // 우승 도전 팀은 2라운드 신인 자리가 아까움
  if (a.round === 1 && g.mode === 'rebuild') v *= 1.05;
  return v;
}

// 지명권 묶음 평가: AI가 받는 것(get)과 주는 것(give)
// 결과: accept / counter / reject + 이유
export function evaluatePickTrade(abbr, give, get, userAssets) {
  const g = gmProfile(abbr);
  const sum = (ps) => ps.reduce((s, p) => s + perceivedValue(abbr, p), 0);
  let need = 1 + g.greed;
  if (give.some((p) => p.kind === 'cur' && p.pick <= 3)) need += 0.12;              // 최상위 지명권은 웃돈 없이는 안 내줌
  if (give.some((p) => p.kind === 'fut' && p.round === 1 && p.original === abbr && !p.protection)) need += 0.06;   // 자기 팀 미래 1라운드(보호 없음)는 위험해서 더 받아야 함
  if (give.length && get.length > give.length + 1) need += 0.05 * (get.length - give.length - 1); // 자잘한 지명권 여러 개보다 큰 것 하나
  const gv = sum(get), dv = sum(give);
  const ratio = dv ? gv / (dv * need) : (gv > 0 ? 9 : 0);
  if (!give.length && get.length) return { result: 'accept', ratio, reason: '대가 없이 지명권을 받는 거라 좋아요.' };
  if (ratio >= 1) return { result: 'accept', ratio, reason: '좋아요, 거래하죠.' };

  // 역제안: 아깝게 모자라면 우리(이용자) 지명권 하나를 더 달라고 함
  const r = rng(hash(`${state.save.seed}:${abbr}:counter:${give.map((p) => p.key)}:${get.map((p) => p.key)}`));
  if (ratio >= 0.7 && r() < g.counterRate) {
    const gap = dv * need - gv;
    const extra = userAssets
      .filter((p) => p.tradable && !get.some((x) => x.key === p.key))
      .map((p) => ({ p, v: perceivedValue(abbr, p) }))
      .filter((x) => x.v >= gap)
      .sort((a, b) => a.v - b.v)[0];
    if (extra) return { result: 'counter', ratio, add: extra.p, reason: `조금 모자라요. ${assetLabel(extra.p, { html: false })} 지명권까지 주면 할게요.` };
  }
  const why = ratio >= 0.7 ? '조금 모자라요. 이 조건으로는 어렵겠어요.'
    : g.mode === 'rebuild' && give.some((p) => p.round === 1) ? '저희는 리빌딩 중이라 1라운드 지명권을 쉽게 내줄 수 없어요.'
    : g.mode === 'contend' && get.some((p) => p.kind === 'fut') && !get.some((p) => p.kind === 'cur') ? '저희는 지금 우승을 노려서 먼 미래 지명권은 크게 쳐주지 않아요.'
    : '가치 차이가 너무 커요.';
  return { result: 'reject', ratio, reason: why };
}
