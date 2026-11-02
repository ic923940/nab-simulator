// 지명권 트레이드 구간 (드래프트 직전)
// - 이번 드래프트 지명권 + 미래 지명권(최대 4년 뒤, 검증된 2026년까지)
// - 제안 5번까지. 상대 구단 AI가 성향대로 수락 / 거절 / 역제안
// - 다른 팀 권리가 걸린 지명권, 징계로 없어진 지명권은 참고로만 보여 주고 거래 불가
// - Stepien 규칙(1라운드 2년 연속 없음 금지) 검사
import { esc } from '../util.js';
import { state, writeSave, teamBy } from '../store.js';
import { track } from '../analytics.js';
import { gmProfile, evaluatePickTrade } from '../ai.js';
import { assetsOf, awayOf, forfeitedOf, setOwner, protLabel, protKO, assetLabel, plainLabel, baseValue, futureYears, stepienCheck } from '../picks.js';
import { term, tip } from '../glossary.js';
import * as OF from '../offers.js';
import { notice } from '../ui.js';

const ui = { partner: null, give: new Set(), get: new Set(), reply: null, warn: null, tab: null };
const KIND = { swap_right: '교환권', conditional: '조건부 권리' };
const name = (abbr) => teamBy(abbr)?.name || abbr;

function tags(a) {
  const out = [];
  if (a.kind === 'fut' && a.protection) out.push(tip(protLabel(a), protKO(a)));
  if (a.kind === 'fut' && a.claims.length)
    out.push(tip('다른 팀 권리', `${a.claims.map((c) => `${c.team} ${KIND[c.kind] || '권리'} (${c.date} 거래)`).join(' / ')}. 이런 지명권은 게임에서 트레이드할 수 없어요.`));
  return out.length ? ` <span class="tags">${out.join(' ')}</span>` : '';
}

// 우리 지명권 한눈에: 이번 드래프트(순위·원래 팀) + 미래 지명권(보호 조건)
function myPicksHTML(me) {
  const all = assetsOf(me), y = state.save.year, cur = all.filter((a) => a.kind === 'cur'), fut = all.filter((a) => a.kind === 'fut');
  const chip = (a) => `<div class="mp ${a.round === 1 ? 'r1' : 'r2'} ${a.tradable ? '' : 'off'}"><div class="mpn">${a.kind === 'cur' ? `${a.pick}<small>순위</small>` : `${a.round}<small>라운드</small>`}</div>
    <div class="mpt">${a.kind === 'cur' ? `${a.round}라운드` : `${a.year}년`}<br><span class="small">${a.original && a.original !== me ? `${esc(name(a.original))} 것` : '우리 것'}</span>${a.protection ? `<br>${tip(protLabel(a) || '보호 조건', protKO(a))}` : ''}${a.tradable ? '' : '<br><span class="small muted">거래 불가</span>'}</div></div>`;
  return `<div class="panel mypicks"><h2>우리가 가진 지명권</h2><div class="body">
    <div class="k">${y} 드래프트 (이번)</div><div class="mprow">${cur.length ? cur.map(chip).join('') : '<p class="muted">이번 드래프트 지명권이 없어요.</p>'}</div>
    <div class="k">미래 지명권</div><div class="mprow">${fut.length ? fut.map(chip).join('') : '<p class="muted">미래 지명권이 없어요.</p>'}</div>
  </div></div>`;
}
function pickList(abbr, set, side) {
  const all = assetsOf(abbr), gone = forfeitedOf(abbr);
  if (!all.length && !gone.length) return '<p class="muted">지명권이 없어요.</p>';
  const years = [...new Set(all.map((a) => a.year))];
  const rows = years.map((y) => {
    const ys = all.filter((a) => a.year === y);
    return `<tr class="yr"><td colspan="2">${y}${y === state.save.year ? ' (이번 드래프트)' : ''}</td></tr>` + ys.map((a) => `<tr class="${a.tradable ? '' : 'locked'}"><td><label>
      <input type="checkbox" data-side="${side}" data-key="${a.key}" ${set.has(a.key) ? 'checked' : ''} ${a.tradable ? '' : 'disabled'}> ${assetLabel(a)}</label>${tags(a)}</td></tr>`).join('');
  }).join('');
  const lost = gone.length ? `<p class="muted small">${term('forfeited', '박탈')}: ${gone.map((p) => `${p.year} ${p.round}R`).join(', ')}</p>` : '';
  return `${side === 'give' ? awayHTML(abbr) : ''}<table class="t picks"><tbody>${rows}</tbody></table>${lost}`;
}
// 실제로 이미 다른 팀에 넘어간 우리 지명권: '왜 없지?' 의문이 들지 않게 먼저 보여 줌
function awayHTML(abbr) {
  const y = state.save.year, away = awayOf(abbr), cur = away.filter((a) => a.year === y), fut = away.filter((a) => a.year > y);
  if (!away.length) return '';
  const who = (a) => a.owner ? `${esc(name(a.owner))}${a.pick ? ` (${a.pick}순위)` : ''}` : '다른 팀';
  return `<div class="away">${cur.length ? `<p><b>${y} 드래프트: ${cur.length === 2 ? '우리 팀은 실제로 이번 드래프트 지명권이 하나도 없었어요.' : `${cur[0].round}라운드 지명권은 실제로 이미 넘어간 상태였어요.`}</b>
      ${cur.map((a) => `${a.round}라운드 → ${who(a)}`).join(' · ')}. 지명하고 싶다면 미래 지명권을 주고 이번 지명권을 사 올 수 있어요.</p>` : ''}
    ${fut.length ? `<p class="small muted">이미 넘어간 미래 지명권: ${fut.map((a) => `${a.year} ${a.round}R → ${esc(name(a.owner))}`).join(' · ')}</p>` : ''}</div>`;
}

export function renderTrade(main, go) {
  const s = state.save, me = s.team;
  if (s.phase !== 'trade') {
    main.innerHTML = `<h1>지명권 트레이드</h1><p class="sub">${s.phase === 'lottery' ? '로터리를 먼저 진행하세요.' : '트레이드 구간이 끝났어요.'}</p>${tradeLog(s)}`;
    return;
  }
  const teams = state.data.teams.filter((t) => t.abbr !== me).sort((a, b) => a.name.localeCompare(b.name));
  const mine = assetsOf(me);
  const theirs = ui.partner ? assetsOf(ui.partner) : [];
  const give = mine.filter((a) => ui.give.has(a.key)), get = theirs.filter((a) => ui.get.has(a.key));
  const sum = (ps) => ps.reduce((v, a) => v + baseValue(a), 0);
  const prof = ui.partner ? gmProfile(ui.partner) : null;
  const fy = futureYears();
  for (const o of OF.openWindow()) track('trade_offer_in', { id: o.id, partner: o.team, motive: o.motive, ratio: o.ratio, where: 'window' });
  const openN = OF.openOffers('window').length;
  if (!ui.tab) ui.tab = openN ? 'in' : 'out';
  const tab = ui.tab;

  main.innerHTML = `<h1>지명권 트레이드</h1>
    <p class="sub">이번 드래프트 지명권과 ${term('future_pick', '미래 지명권')}(${fy.length ? `${fy[0]}~${fy[fy.length - 1]}년` : '없음'})을 거래할 수 있어요. 남은 제안 <b>${s.tradesLeft}번</b>.
      ${term('stepien', 'Stepien 규칙')}이 적용돼요.</p>
    ${myPicksHTML(me)}
    ${fy.length && fy[fy.length - 1] < s.year + 4 ? `<p class="muted small">${fy[fy.length - 1] + 1}년 이후 지명권은 아직 자료 검증 중이라 거래할 수 없어요.</p>` : ''}
    <div class="ttabs" role="tablist">
      <button role="tab" data-tt="in" aria-selected="${tab === 'in'}" class="${tab === 'in' ? 'on' : ''}">받은 제안${openN ? ` <span class="badge">${openN}</span>` : ''}<small>다른 구단이 먼저 연락한 것</small></button>
      <button role="tab" data-tt="out" aria-selected="${tab === 'out'}" class="${tab === 'out' ? 'on' : ''}">우리가 제안하기<small>남은 제안 ${s.tradesLeft}번</small></button>
    </div>
    ${tab === 'in' ? inboxHTML() : `
    <div class="grid2">
      <div class="panel"><h2>우리가 줄 지명권</h2><div class="body">${pickList(me, ui.give, 'give')}</div></div>
      <div class="panel"><h2>상대 구단 <select id="partner"><option value="">구단 선택</option>${teams.map((t) => `<option value="${t.abbr}" ${t.abbr === ui.partner ? 'selected' : ''}>${esc(t.name)} (${assetsOf(t.abbr).length})</option>`).join('')}</select></h2>
        <div class="body">${ui.partner ? `<p class="muted">단장 성향: ${esc(prof.label.join(' · '))}</p>${pickList(ui.partner, ui.get, 'get')}` : '<p class="muted">거래할 구단을 고르세요.</p>'}</div></div>
    </div>
    <div class="panel" style="margin-top:16px"><div class="body">
      <p><b>주는 것</b> ${give.length ? give.map((a) => esc(plainLabel(a))).join(', ') : '<span class="muted">없음</span>'} ⇄ <b>받는 것</b> ${get.length ? get.map((a) => esc(plainLabel(a))).join(', ') : '<span class="muted">없음</span>'}</p>
      ${ui.warn ? `<p class="bad">${esc(ui.warn)}</p>` : ''}
      ${ui.reply ? `<p class="${ui.reply.result === 'accept' ? 'good' : ui.reply.result === 'counter' ? 'warn' : 'bad'}"><b>${esc(name(ui.reply.team))}:</b> ${esc(ui.reply.reason)}</p>` : ''}
      ${ui.reply?.result === 'counter' ? `<p><button class="go" id="take-counter">역제안 받아들이기</button> <button class="go ghost" id="drop-counter">거절</button></p>` : ''}
      <p><button class="go" id="propose" ${!ui.partner || (!give.length && !get.length) || s.tradesLeft <= 0 || ui.reply?.result === 'counter' ? 'disabled' : ''}>제안하기</button></p>
    </div></div>`}
    ${tab === 'in' && ui.warn ? `<p class="bad">${esc(ui.warn)}</p>` : ''}${tab === 'in' && ui.reply ? `<p class="good"><b>${esc(name(ui.reply.team))}:</b> ${esc(ui.reply.reason)}</p>` : ''}
    <div class="tclose"><span class="muted small">거래를 다 했으면 드래프트로 넘어가요. 열려 있는 제안은 사라져요.</span><button class="go ghost" id="close-window">트레이드 마감하고 드래프트로</button></div>
    ${tradeLog(s)}`;

  main.querySelectorAll('[data-tt]').forEach((b) => b.onclick = () => { ui.tab = b.dataset.tt; ui.warn = null; if (ui.reply?.result !== 'counter') ui.reply = null; track('trade_tab', { tab: ui.tab, open: openN }); renderTrade(main, go); });
  main.querySelector('[data-goto-out]')?.addEventListener('click', () => { ui.tab = 'out'; renderTrade(main, go); });
  const partnerSel = main.querySelector('#partner');
  if (partnerSel) partnerSel.onchange = (e) => {
    ui.partner = e.target.value || null; ui.get.clear(); ui.reply = null; ui.warn = null;
    if (ui.partner) track('trade_partner_view', { partner: ui.partner, gm: gmProfile(ui.partner).label });
    renderTrade(main, go);
  };
  main.querySelectorAll('[data-side]').forEach((c) => c.onchange = () => {
    const set = c.dataset.side === 'give' ? ui.give : ui.get;
    c.checked ? set.add(c.dataset.key) : set.delete(c.dataset.key);
    ui.reply = null; ui.warn = null; renderTrade(main, go);
  });
  const proposeBtn = main.querySelector('#propose');
  if (proposeBtn) proposeBtn.onclick = () => {
    // Stepien 규칙 먼저 (제안 횟수는 쓰지 않음)
    const st = stepienCheck(me, ui.partner, give, get);
    if (st.length) {
      ui.warn = st.map((x) => `${x.team === me ? '우리 팀' : name(x.team)}이 ${x.years.join(', ')}년에 1라운드 지명권이 연속으로 없어져서 Stepien 규칙에 걸려요.`).join(' ');
      track('trade_blocked', { rule: 'stepien', partner: ui.partner, give: give.map((a) => a.key), get: get.map((a) => a.key), teams: st.map((x) => x.team) });
      renderTrade(main, go); return;
    }
    // AI 입장: 받는 것 = 우리가 주는 것, 주는 것 = 우리가 받는 것
    const r = evaluatePickTrade(ui.partner, get, give, mine);
    s.tradesLeft -= 1;
    ui.reply = { ...r, team: ui.partner, give, get };
    track('trade_propose', { partner: ui.partner, give: give.map((a) => a.key), get: get.map((a) => a.key),
      n_future: give.concat(get).filter((a) => a.kind === 'fut').length,
      chart_give: +sum(give).toFixed(1), chart_get: +sum(get).toFixed(1), result: r.result, ai_ratio: +r.ratio.toFixed(3), counter_add: r.add?.key ?? null });
    if (r.result === 'accept') doTrade(give, get);
    ping(); writeSave(); renderTrade(main, go);
  };
  main.querySelector('#take-counter')?.addEventListener('click', () => {
    const r = ui.reply, give2 = [...r.give, r.add];
    const st = stepienCheck(me, r.team, give2, r.get);
    if (st.length) {
      ui.warn = '역제안대로 하면 Stepien 규칙에 걸려서 받아들일 수 없어요.'; ui.reply = null;
      track('trade_blocked', { rule: 'stepien', partner: r.team, counter: true }); renderTrade(main, go); return;
    }
    track('trade_counter', { partner: r.team, accepted: true, add: r.add.key });
    doTrade(give2, r.get);
    ui.reply = { result: 'accept', reason: '좋아요, 거래하죠.', team: r.team };
    writeSave(); renderTrade(main, go);
  });
  main.querySelector('#drop-counter')?.addEventListener('click', () => {
    track('trade_counter', { partner: ui.reply.team, accepted: false, add: ui.reply.add.key });
    ui.reply = null; renderTrade(main, go);
  });
  main.querySelectorAll('[data-offer]').forEach((b) => b.onclick = () => {
    const o = OF.inbox().list.find((x) => x.id === +b.dataset.offer), act = b.dataset.act, x = OF.resolve(o);
    const meta = { id: o.id, partner: o.team, motive: o.motive, ratio: o.ratio, give: o.get, get: o.give, where: 'window' };
    if (act === 'accept') {
      const r = OF.accept(o);
      track('trade_offer_reply', { ...meta, reply: r.err ? 'invalid' : 'accept' });
      if (r.err) ui.warn = r.err; else { track('trade_done', { partner: o.team, gave: o.get, got: o.give, incoming: true }); ui.reply = { result: 'accept', reason: '좋아요, 거래 성사!', team: o.team }; }
    } else if (act === 'decline') { OF.decline(o); track('trade_offer_reply', { ...meta, reply: 'decline' }); }
    else if (act === 'edit' && x) {   // 조건 조정: 제안 내용을 아래 만들기 칸에 옮김 (보내면 제안 1번 사용)
      ui.partner = o.team; ui.give = new Set(o.get); ui.get = new Set(o.give); ui.reply = null; ui.warn = null; ui.tab = 'out'; OF.decline(o);
      track('trade_offer_reply', { ...meta, reply: 'edit' });
    }
    ping(); renderTrade(main, go);
    if (act === 'edit') main.querySelector('#partner')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  main.querySelector('#close-window').onclick = () => notice('이제 드래프트로 넘어갑니다', `지명권 트레이드를 마감해요${OF.openOffers('window').length ? ' (열려 있는 제안은 사라져요)' : ''}. 드래프트에서는 다른 구단이 차례대로 지명하고, 우리 차례가 오면 멈춰요. 그 자리를 원하는 구단이 전화할 수도 있어요.`, () => {
    OF.expireWindow();
    track('trade_window_close', { trades_done: s.trades.length, proposals_used: 5 - s.tradesLeft });
    s.phase = 'draft'; writeSave(); go('draft');
  }, { ok: '드래프트로', cancel: true });
}

// 우리가 무언가 하면 가끔 다른 구단 전화가 새로 옴
function ping() { const o = OF.maybeMore(); if (o) { ui.ring = o.id; track('trade_offer_in', { id: o.id, partner: o.team, motive: o.motive, ratio: o.ratio, where: 'window' }); } }

const MOTIVE_KO = { up: '순위 올리기', win_now: '우승 도전', future: '미래 지명권', down: '순위 내리기' };
function inboxHTML() {
  const all = OF.inbox().list.filter((o) => o.where === 'window'), open = OF.openOffers('window');
  if (!all.length) return `<div class="panel inbox"><div class="body"><p>아직 들어온 제안이 없어요. 우리가 먼저 제안을 주고받다 보면 다른 구단이 연락해 오기도 해요.</p><p><button class="go" data-goto-out>우리가 먼저 제안하기</button></p></div></div>`;
  return `<div class="panel inbox"><h2>들어온 제안 <span class="muted small">수락해도 우리 제안 횟수는 줄지 않아요</span></h2><div class="body">
    ${open.length ? open.map((o) => { const x = OF.resolve(o);
      return `<div class="offer ${ui.ring === o.id ? 'ring' : ''}"><div class="who"><b>${esc(name(o.team))}</b> <span class="tag">${MOTIVE_KO[o.motive]}</span> <span class="muted small">${esc(gmProfile(o.team).label.join(' · '))}</span></div>
        <p class="quote">“${esc(o.msg)}”</p>
        <div class="swap"><div><div class="k">우리가 받는 것</div>${x.give.map((a) => `<div>${assetLabel(a)}${tags(a)}</div>`).join('')}</div>
          <div class="arrow">⇄</div>
          <div><div class="k">우리가 주는 것</div>${x.get.map((a) => `<div>${assetLabel(a)}${tags(a)}</div>`).join('')}</div></div>
        <p class="acts"><button class="go small" data-offer="${o.id}" data-act="accept">수락</button> <button class="go small ghost" data-offer="${o.id}" data-act="edit">조건 조정해서 다시 제안</button> <button class="go small ghost" data-offer="${o.id}" data-act="decline">거절</button></p></div>`; }).join('')
      : '<p class="muted small">지금 열린 제안이 없어요. 우리가 제안을 주고받다 보면 새 연락이 올 수 있어요.</p>'}
    ${all.filter((o) => o.status !== 'open').length ? `<p class="muted small">지난 제안: ${all.filter((o) => o.status !== 'open').map((o) => `${esc(name(o.team))} ${({ accepted: '수락', declined: '거절', expired: '무효' })[o.status]}`).join(' · ')}</p>` : ''}
  </div></div>`;
}

function doTrade(give, get) {
  const s = state.save, partner = ui.partner;
  give.forEach((a) => setOwner(a, partner));
  get.forEach((a) => setOwner(a, s.team));
  s.trades.push({ partner, gave: give.map(plainLabel), got: get.map(plainLabel), gave_keys: give.map((a) => a.key), got_keys: get.map((a) => a.key) });
  track('trade_done', { partner, gave: give.map((a) => a.key), got: get.map((a) => a.key) });
  ui.give.clear(); ui.get.clear();
}

function tradeLog(s) {
  if (!s.trades?.length) return '';
  const lab = (x) => (typeof x === 'number' ? `${x}순위` : x);
  return `<div class="panel"><h2>이번 드래프트 전에 한 거래</h2><div class="body"><ul style="margin:0;padding-left:18px">${s.trades.map((t) =>
    `<li>${esc(name(t.partner))}에 ${t.gave.map(lab).join(', ') || '없음'} 주고 ${t.got.map(lab).join(', ') || '없음'} 받음</li>`).join('')}</ul></div></div>`;
}
