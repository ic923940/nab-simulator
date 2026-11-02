// 드래프트 로터리 (2019년부터의 방식)
// - 추첨 전 하위 14팀, 1000개 조합 중 팀별 조합 수만큼 당첨 확률
// - 1~4순위만 추첨 (이미 뽑힌 팀이 또 나오면 다시 뽑음 = 남은 팀끼리 조합 비율대로)
// - 5~14순위는 남은 팀을 추첨 전 순서대로
// - 보호 조건: 새 순위에 따라 지명권 주인이 바뀜
import { state } from './store.js';

export const lotteryInfo = () => state.lot[String(state.save.year)];

// 보호 규칙으로 주인 정하기
function ruleOwner(seed, slot) {
  if (!seed.rules) return seed.owner_at_lottery;
  const r = seed.rules.find(([lo, hi]) => slot >= lo && slot <= hi);
  return r ? r[2] : seed.owner_at_lottery;
}

// 추첨 결과(original team 순서) → 1~60순위 지명권 주인 목록
export function picksFromLotteryOrder(teamsInOrder) {
  const L = lotteryInfo();
  const base = state.data.draft_order.map((o) => ({ ...o }));
  const actualSlot = Object.fromEntries(L.actual_result.map((r) => [r.team, r.pick]));
  const out = base.map((o) => ({ ...o }));
  let swap = null;
  teamsInOrder.forEach((team, i) => {
    const slot = i + 1, seed = L.seeds.find((s) => s.team === team);
    let owner;
    if (seed.special === 'swap_2021_okc') {
      owner = 'HOU';
      if (slot >= L.swap_2021.if_range[0]) { owner = L.swap_2021.hou_pick_to; swap = L.swap_2021.hou_gets_pick; }
    } else {
      owner = ruleOwner(seed, slot);
      // 추첨 뒤 실제로 거래된 지명권: 규칙상 주인이 넘긴 것이면 받은 팀으로
      const aSlot = actualSlot[team];
      const ruleAtActual = ruleOwner(seed, aSlot);
      const actualOwner = base.find((o) => o.pick === aSlot).team;
      if (actualOwner !== ruleAtActual && owner === ruleAtActual) owner = actualOwner;
    }
    out[slot - 1] = { pick: slot, round: 1, team: owner, original_team: team };
  });
  if (swap) out[swap - 1] = { ...out[swap - 1], team: 'HOU', note: 'OKC 교환권 행사' };
  return out;
}

// 새로 추첨: 1~4순위 당첨 팀 순서 → 전체 14팀 순서
export function drawLottery(rand) {
  const seeds = lotteryInfo().seeds.slice().sort((a, b) => a.seed - b.seed);
  const pool = seeds.map((s) => ({ team: s.team, w: s.combinations }));
  const winners = [];
  for (let k = 0; k < 4; k++) {
    const total = pool.reduce((s, x) => s + x.w, 0);
    let x = rand() * total;
    const i = pool.findIndex((p) => (x -= p.w) < 0);
    winners.push(pool[i === -1 ? pool.length - 1 : i].team);
    pool.splice(i === -1 ? pool.length - 1 : i, 1);
  }
  return [...winners, ...seeds.map((s) => s.team).filter((t) => !winners.includes(t))];
}

export const actualOrder = () => lotteryInfo().actual_result.slice().sort((a, b) => a.pick - b.pick).map((r) => r.team);

// 우리 팀이 로터리와 관련 있는지 (원래 팀·추첨 때 주인·보호 조건상 받을 수 있는 팀)
export function myTeamInLottery() {
  const me = state.save.team, L = lotteryInfo();
  return L.seeds.some((s) => s.team === me || s.owner_at_lottery === me || (s.rules || []).some((r) => r[2] === me))
    || state.data.draft_order.slice(0, 14).some((o) => o.team === me);
}
