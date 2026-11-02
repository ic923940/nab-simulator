// 로터리 화면: 실제 결과 그대로 / 다시 추첨 → (우리 팀 관련이면) 14위부터 하나씩 공개
import { esc } from '../util.js';
import { state, writeSave, teamBy, picksOf } from '../store.js';
import { notice } from '../ui.js';
import { track } from '../analytics.js';
import { rng, hash } from '../ai.js';
import { lotteryInfo, drawLottery, actualOrder, picksFromLotteryOrder, myTeamInLottery } from '../lottery.js';
import { term } from '../glossary.js';

const name = (abbr) => teamBy(abbr)?.name || abbr;
const md = (d) => `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일`;
const pickText = (ps) => (ps.length ? ps.map((o) => `${o.round}라운드 ${o.pick}순위`).join(', ') : '없음');

export function renderLottery(main, go) {
  const L = lotteryInfo(), s = state.save, me = s.team;
  const seeds = L.seeds.slice().sort((a, b) => a.seed - b.seed);
  const involved = myTeamInLottery();

  if (!s.lottery) {
    main.innerHTML = `<h1>${s.year} 드래프트 로터리</h1>
      <p class="sub">실제 추첨일 ${esc(L.lottery_date)} · 성적 하위 14팀 중 1~4순위를 추첨하고, 5~14순위는 남은 팀 성적 역순이에요.</p>
      <div class="panel"><h2>추첨 전 순서와 1순위 확률</h2><div class="scroll"><table class="t">
        <thead><tr><th class="n">추첨 전</th><th>팀</th><th>성적</th><th class="n">1순위 확률</th><th>지명권 주인 / ${term('protection', '보호 조건')}</th></tr></thead>
        <tbody>${seeds.map((x) => `<tr class="${x.team === me || x.owner_at_lottery === me ? 'mine' : ''}"><td class="n">${x.seed}</td><td>${esc(name(x.team))}</td><td>${esc(x.record || '')}</td>
          <td class="n">${(x.combinations / 10).toFixed(1)}%</td>
          <td>${x.owner_at_lottery !== x.team ? esc(name(x.owner_at_lottery)) + ' 소유' : ''}${x.rules && x.rules.length > 1 ? ` <span class="muted">${esc(x.rules.map(([lo, hi, o]) => `${lo}~${Math.min(hi, 14)}위면 ${o}`).join(', '))}</span>` : ''}${x.special ? ' <span class="muted">' + esc(L.swap_2021.note) + '</span>' : ''}</td></tr>`).join('')}
        </tbody></table></div></div>
      <p>${involved ? '<b>우리 팀 지명권이 추첨에 걸려 있어요.</b> ' : '우리 팀은 이번 추첨과 관계가 없어요. 결과만 보여드릴게요. '}어떻게 진행할까요?</p>
      <p><button class="go" data-lot="real">실제 추첨 결과 보기 (${esc(md(L.lottery_date))})</button> <button class="go" data-lot="redraw">추첨 다시 하기</button></p>
      <p class="muted small">실제 결과: 그날 실제로 뽑힌 순서 그대로 진행해요 (추첨이라 추첨 전 순서와는 달라요). 다시 하기: 같은 확률로 게임이 새로 추첨해요.</p>`;
    main.querySelectorAll('[data-lot]').forEach((b) => b.onclick = () => {
      const mode = b.dataset.lot;
      const order = mode === 'real' ? actualOrder() : drawLottery(rng(hash(`${s.seed}:lottery`)));
      const before = picksOf(me).map((o) => o.pick);
      s.picks = picksFromLotteryOrder(order);
      // 하나씩 공개하는 연출은 '다시 추첨'일 때만. 실제 결과는 바로 전체를 보여줌
      s.lottery = { mode, order, revealed: involved && mode === 'redraw' ? 0 : 14 };
      writeSave();
      track('lottery_mode', { mode, involved });
      track('lottery_result', { mode, order: order.slice(0, 4), my_picks_before: before, my_picks_after: picksOf(me).map((o) => o.pick) });
      renderLottery(main, go);
    });
    return;
  }

  // 결과 공개: 14위 → 1위
  const lt = s.lottery, order = lt.order;
  if (lt.mode === 'real' && lt.revealed < 14) { lt.revealed = 14; writeSave(); }   // 예전 저장 파일 정리
  const shown = lt.revealed;                         // 공개된 개수 (아래 순위부터)
  const seedOf = Object.fromEntries(seeds.map((x) => [x.team, x.seed]));
  const rows = order.map((team, i) => ({ slot: i + 1, team, owner: s.picks[i].team, seed: seedOf[team] }));
  const visible = rows.filter((r) => r.slot > 14 - shown);
  const done = shown >= 14;
  main.innerHTML = `<h1>${s.year} 드래프트 로터리 결과</h1>
    <p class="sub">${lt.mode === 'real' ? `${esc(md(L.lottery_date))} 실제 추첨 결과예요. 추첨으로 뽑힌 1~4위 때문에 추첨 전 순서와 달라졌어요.` : '게임이 새로 추첨한 결과예요.'}${done ? '' : ' · 14위부터 공개해요'} <span class="muted">▲▼ = 추첨 전 순서와 비교</span></p>
    <div class="panel"><div class="scroll"><table class="t">
      <thead><tr><th class="n">순위</th><th>팀 (원래 성적 기준)</th><th>지명권 주인</th><th class="n">추첨 전</th><th>변화</th></tr></thead>
      <tbody>${rows.slice().reverse().map((r) => {
        const v = r.slot > 14 - shown;
        const move = r.seed - r.slot;
        return `<tr class="${v && (r.owner === me || r.team === me) ? 'mine' : ''}"><td class="n"><b>${r.slot}</b>${r.slot <= 4 && v ? ' <span class="tag">추첨</span>' : ''}</td>
          <td>${v ? esc(name(r.team)) : '<span class="muted">?</span>'}</td><td>${v ? (r.owner !== r.team ? esc(name(r.owner)) : '') : ''}</td>
          <td class="n">${v ? r.seed : ''}</td><td>${v ? (move > 0 ? `<span class="good">▲ ${move}</span>` : move < 0 ? `<span class="bad">▼ ${-move}</span>` : '<span class="muted">—</span>') : ''}</td></tr>`;
      }).join('')}</tbody></table></div></div>
    ${done ? `<div class="panel"><h2>우리 지명권</h2><div class="body">${pickText(picksOf(me))}</div></div>
      <p><button class="go" id="to-trade">지명권 트레이드로</button></p>`
      : `<p><button class="go" id="reveal">다음 공개</button> <button class="go ghost" id="reveal-all">모두 공개</button></p>`}`;
  const step = (n) => { lt.revealed = Math.min(14, lt.revealed + n); writeSave(); renderLottery(main, go); };
  main.querySelector('#reveal')?.addEventListener('click', () => step(lt.revealed >= 10 ? 1 : 10 - lt.revealed || 1));
  main.querySelector('#reveal-all')?.addEventListener('click', () => { track('lottery_reveal_all', { at: lt.revealed }); step(14); });
  main.querySelector('#to-trade')?.addEventListener('click', () => {
    if (s.phase !== 'lottery') return go('trade');
    notice('이제 지명권 트레이드로 넘어갑니다', '로터리로 이번 드래프트 순서가 정해졌어요. 드래프트 전에 다른 구단과 지명권을 주고받을 수 있어요. 우리 제안은 5번까지이고, 다른 구단이 먼저 연락해 오기도 해요.', () => {
      s.phase = 'trade'; s.tradesLeft = 5; s.trades = []; writeSave(); go('trade');
    });
  });
}
