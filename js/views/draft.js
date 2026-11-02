// 드래프트 화면 (B안): 다른 팀 지명은 자동으로 빠르게 흘러가고, 우리 차례에 멈춤
// - 원하면 '한 픽씩' 방식으로 바꿀 수 있음
// - 드래프트 전(로터리·트레이드 단계)에는 유망주 보드만 보여 줌 (관심 목록 담기 가능)
import { esc, num, pct, inches, table } from '../util.js';
import { state, writeSave, teamBy, myTeam } from '../store.js';
import { track } from '../analytics.js';
import { term } from '../glossary.js';
import { hooks, scoutReport } from './player.js';
import * as OF from '../offers.js';
import { assetLabel, baseValue } from '../picks.js';
import { order, draftState, available, nextSlot, isDone, aiChoose, record, rosterGroups, group, GROUP_KO, boardRank } from '../draft.js';

const ui = { filter: 'all', confirm: null, running: false, fast: false, turnAt: null, viewed: new Set(), startedAt: null };
let timer = null;
const name = (abbr) => teamBy(abbr)?.name || abbr;
const short = (abbr) => abbr;

// 유망주 최근 시즌 한 줄 (대학 > 해외 > G리그)
function lastLine(p) {
  const all = [...(p.college_seasons || []), ...(p.pro_seasons || []).filter((r) => r.competition !== 'national_team' && r.phase !== 'playoffs'), ...(p.gleague_seasons || []).filter((r) => r.phase === 'regular')]
    .filter((r) => r.pts_per_g !== null && r.pts_per_g !== undefined);
  return all.length ? all.reduce((a, b) => (b.season >= a.season ? b : a)) : null;
}

const myTurn = () => { const sl = nextSlot(); return state.save.phase === 'draft' && sl && sl.team === state.save.team; };
const myLeft = () => { const made = draftState().made.length; return order().slice(made).filter((o) => o.team === state.save.team); };

// 상세 창의 '지명' 버튼
hooks.prospectAction = (p) => {
  ui.viewed.add(p.player_id);
  if (!document.getElementById('draft-room')) return '';
  const D = draftState();
  if (D.made.some((m) => m.id === p.player_id)) { const m = D.made.find((x) => x.id === p.player_id); return `<p class="tag">${m.round}라운드 ${m.pick}순위 · ${esc(name(m.team))} 지명</p>`; }
  const w = D.watch.includes(p.player_id);
  return `<p><button class="go ghost" data-watch="${p.player_id}">${w ? '★ 관심 목록에서 빼기' : '☆ 관심 목록에 담기'}</button>
    ${myTurn() ? ` <button class="go" data-pickit="${p.player_id}">${nextSlot().pick}순위로 지명</button>` : ''}</p>`;
};

function poolTable() {
  const D = draftState(), mine = myTurn();
  let rows = available();
  if (ui.filter === 'watch') rows = rows.filter((p) => D.watch.includes(p.player_id));
  else if (ui.filter !== 'all') rows = rows.filter((p) => group(p.position) === ui.filter);
  const cols = [
    { k: 'w', label: '☆', get: (p) => (D.watch.includes(p.player_id) ? 1 : 0), fmt: (v, p) => `<button class="star${v ? ' on' : ''}" data-watch="${p.player_id}" aria-label="관심 목록">${v ? '★' : '☆'}</button>` },
    { k: 'rank', label: '예상 순위', tip: 'big_board', n: 1, get: (p) => p.pre_draft_rank?.rank ?? null, fmt: (v) => v ?? '<span class="muted">밖</span>' },
    { k: 'name', label: '이름', get: (p) => p.name, fmt: (v) => `<b>${esc(v)}</b>` },
    { k: 'pos', label: '포지션', get: (p) => p.position },
    { k: 'age', label: '나이', n: 1, get: (p) => p.age_at_draft },
    { k: 'from', label: '소속', get: (p) => p.pre_draft_team },
    { k: 'pts', label: '득점', n: 1, get: (p) => lastLine(p)?.pts_per_g ?? null, fmt: (v) => num(v) },
    { k: 'trb', label: '리바', n: 1, get: (p) => lastLine(p)?.trb_per_g ?? null, fmt: (v) => num(v) },
    { k: 'ast', label: '어시', n: 1, get: (p) => lastLine(p)?.ast_per_g ?? null, fmt: (v) => num(v) },
    { k: 'p3', label: '3점', n: 1, get: (p) => lastLine(p)?.fg3_pct ?? null, fmt: (v) => pct(v) },
    { k: 'ts', label: 'TS%', n: 1, get: (p) => lastLine(p)?.ts_pct ?? null, fmt: (v) => pct(v) },
    { k: 'ht', label: '키(맨발)', tip: 'barefoot', n: 1, get: (p) => p.combine?.height_barefoot ?? null, fmt: (v) => inches(v) },
    { k: 'ws', label: '윙스팬', tip: 'wingspan', n: 1, get: (p) => p.combine?.wingspan ?? null, fmt: (v) => inches(v) },
  ];
  if (mine) cols.unshift({ k: 'act', label: '', get: () => 0, fmt: (v, p) => `<button class="go small" data-pickit="${p.player_id}">지명</button>` });   // 표가 넓어도 바로 보이게 맨 앞
  return table('draftpool', rows, cols, { sortKey: 'rank', sortDir: 1, rowClick: (p) => `prospect:${p.player_id}` });
}

function ticker() {
  const D = draftState();
  if (!D.made.length) return '<p class="muted">아직 지명된 선수가 없어요.</p>';
  return `<ol class="ticker">${D.made.slice(-14).reverse().map((m) => `<li class="${m.team === state.save.team ? 'mine' : ''}">
    <span class="pk">${m.pick}</span> <b>${esc(short(m.team))}</b> ${esc(m.name)} <span class="muted">${esc(m.pos || '')}${m.rank ? ` · 예상 ${m.rank}위` : ' · 순위 밖'}</span>
    ${m.reason ? `<div class="muted small">${esc(m.reason)}</div>` : ''}</li>`).join('')}</ol>`;
}

function teamPanel() {
  const t = myTeam(), g = rosterGroups(t.abbr);
  const exp = t.roster.filter((p) => p.roster_role !== 'two_way' && p.contract?.years_remaining === 1).length;
  const left = myLeft();
  return `<dl class="kv">
    <dt>남은 우리 지명권</dt><dd>${left.length ? left.map((o) => `${o.round}R ${o.pick}순위`).join(', ') : '없음'}</dd>
    <dt>포지션별 선수</dt><dd>${Object.entries(g).map(([k, v]) => `${GROUP_KO[k]} ${v}명`).join(' · ')}</dd>
    <dt>${term('years_left', '이번 시즌 뒤 계약 끝')}</dt><dd>${exp}명</dd></dl>
    ${draftState().made.filter((m) => m.team === t.abbr).length ? `<p class="small"><b>우리가 뽑은 선수:</b> ${draftState().made.filter((m) => m.team === t.abbr).map((m) => `${m.pick}순위 ${esc(m.name)}`).join(', ')}</p>` : ''}`;
}

// 무대: 지금 누구 차례인지 크게. 우리 차례면 관심 선수 비교 카드까지
const SPEED = { normal: 1200, fast: 450 };
function stage() {
  const s = state.save, D = draftState(), all = order(), sl = nextSlot();
  if (s.phase === 'lottery' || s.phase === 'trade') {
    return `<div class="stage"><div class="stage-grid"><div class="bignum">D<small>드래프트 전</small></div>
      <div><h2>${s.year} NBA 드래프트</h2><p>지명은 ${s.phase === 'lottery' ? '로터리와 지명권 트레이드' : '지명권 트레이드'}를 마치면 시작돼요. 지금은 유망주를 살펴보고 ☆로 관심 목록에 담아 두세요.</p></div><div></div></div></div>`;
  }
  const left = myLeft(), mine = myTurn();
  const until = left.length && sl ? left[0].pick - sl.pick : null;
  const pct = Math.round((D.made.length / all.length) * 100);
  let btns = '';
  if (!D.started) btns = `<button class="go" id="start-draft">드래프트 시작</button>`;
  else if (!mine) {
    if (!left.length) btns = ui.running ? `<button class="go ghost" id="pause">일시 정지</button>` : `<button class="go" id="finish">남은 지명 모두 진행</button>`;
    else if (D.pace === 'step') btns = `<button class="go" id="step">다음 픽</button>`;
    else btns = ui.running ? `<button class="go ghost" id="pause">일시 정지</button>` : `<button class="go" id="resume">계속 진행</button>`;
  }
  const conf = ui.confirm ? (() => { const p = state.data.draft_pool.find((x) => x.player_id === ui.confirm);
    return `<p style="margin-top:12px"><b>${esc(p.name)}</b> (${esc(p.position || '')}, 예상 ${p.pre_draft_rank?.rank ? p.pre_draft_rank.rank + '위' : '순위 밖'})를 ${sl.pick}순위로 지명할까요?
      <button class="go" id="confirm-pick">지명 확정</button> <button class="go ghost" id="cancel-pick">다시 고르기</button></p>`; })() : '';
  const a = ui.announce && Date.now() < ui.announce.until ? ui.announce : null;
  const ann = a ? `<div class="announce" aria-live="polite"><div class="line1">${s.year} NBA 드래프트 ${a.pick}순위 · ${esc(name(a.team))}</div>
      <div class="who"><span>${esc(a.name)}</span></div><div class="line2">${esc(a.pos || '')}${a.rank ? ` · 전문가 예상 ${a.rank}위` : ''}${a.mine ? ' · 우리 선택' : ''}</div></div>` : '';
  const call = mine && !ui.confirm && D.started ? OF.draftCall(sl) : null;
  if (call && ui.callSeen !== call.id) { ui.callSeen = call.id; track('trade_offer_in', { id: call.id, partner: call.team, motive: call.motive, ratio: call.ratio, where: 'draft', pick: sl.pick }); }
  const head = !sl ? '' : mine
    ? `${call ? callHTML(call) : ''}<h2>우리 차례예요</h2><p>${sl.round}라운드 ${sl.pick}순위. 아래 관심 선수 카드나 목록의 [지명]으로 고르세요. 시간 제한은 없어요.</p>`
    : `<h2>${esc(name(sl.team))}</h2><p>${ui.running ? '지명 중…' : D.started ? '차례' : '드래프트를 시작하면 1순위부터 지명해요'}${until ? ` · 우리 차례까지 ${until}픽` : left.length ? '' : ' · 우리 지명은 모두 끝났어요'}</p>`;
  return `<div class="stage">${ann}
    <div class="stage-grid">
      <div class="bignum">${sl ? sl.pick : '—'}<small>${sl ? `${sl.round}라운드` : ''}</small></div>
      <div>${head}${conf}<p style="margin-top:12px">${btns}</p></div>
      <div class="clock-side"><div class="n">${D.made.length}<span style="opacity:.6">/${all.length}</span></div><div class="small">지명 완료</div>
        <div class="pace" style="margin-top:10px">
          <label><input type="radio" name="pace" value="auto" ${D.pace === 'auto' ? 'checked' : ''}> 우리 차례까지 자동</label><br>
          <label><input type="radio" name="pace" value="step" ${D.pace === 'step' ? 'checked' : ''}> 한 픽씩</label><br>
          <label><input type="checkbox" id="fast" ${D.speed === 'fast' ? 'checked' : ''}> 빠르게</label></div></div>
    </div>
    <div class="progress"><span style="width:${pct}%"></span></div></div>
    ${mine && !ui.confirm ? shortlist() : ''}`;
}

// 우리 차례에 걸려 온 전화: 이 지명권을 원하는 구단
function callHTML(o) {
  const x = OF.resolve(o); if (!x) return '';
  return `<div class="call"><div class="small">전화가 왔어요 · ${esc(name(o.team))}</div>
    <p>“${esc(o.msg)}”</p>
    <p><b>받는 것</b> ${x.give.map((a) => assetLabel(a)).join(', ')} ⇄ <b>주는 것</b> ${x.get.map((a) => assetLabel(a)).join(', ')}</p>
    <p><button class="go small" id="call-yes" data-call="${o.id}">수락하고 순위 넘기기</button> <button class="go small ghost" id="call-no" data-call="${o.id}">거절하고 지명</button></p></div>`;
}

// 우리 차례: 관심 목록(없으면 남은 선수 중 예상 순위 상위 4명)을 카드로 비교
function shortlist() {
  const D = draftState(), avail = available();
  let list = avail.filter((p) => D.watch.includes(p.player_id));
  const from = list.length ? '관심 선수' : '남은 선수 중 예상 순위 상위';
  if (!list.length) list = avail.slice().sort((a, b) => boardRank(a) - boardRank(b)).slice(0, 4);
  return `<p class="muted small" style="margin:14px 0 0">${from} · 카드를 누르면 자세히</p><div class="shortlist">${list.slice(0, 6).map((p) => { const L = lastLine(p), rep = scoutReport(p);
    return `<div class="pcard"><div class="top"><span class="rk">${p.pre_draft_rank?.rank ?? '–'}</span><span class="ln">${esc(p.position || '')} · ${p.age_at_draft ?? ''}세</span></div>
      <a href="#" class="nm" data-open="prospect:${p.player_id}">${esc(p.name)}</a>
      <div class="ln">${esc(p.pre_draft_team || '')}</div>
      <div class="ln">${L ? `${num(L.pts_per_g)}득점 ${num(L.trb_per_g)}리바 ${num(L.ast_per_g)}어시` : '경기 기록 없음'}</div>
      ${rep[0] ? `<div class="why">${esc(rep[0])}</div>` : ''}
      <button class="go small" data-pickit="${p.player_id}">지명</button></div>`; }).join('')}</div>`;
}

function summary() {
  const D = draftState(), me = state.save.team;
  const mine = D.made.filter((m) => m.team === me);
  return `<div class="panel"><h2>우리 드래프트 결과</h2><div class="body scroll">
    ${mine.length ? `<table class="t"><thead><tr><th class="n">순위</th><th>선수</th><th>포지션</th><th class="n">예상 순위</th><th>평가</th></tr></thead><tbody>
      ${mine.map((m) => { const gap = m.rank ? m.rank - m.pick : null;
        return `<tr class="click" data-open="prospect:${m.id}"><td class="n">${m.pick}</td><td><b>${esc(m.name)}</b></td><td>${esc(m.pos || '')}</td><td class="n">${m.rank ?? '밖'}</td>
        <td>${gap === null ? '빅보드 밖 선수를 지명' : gap > 0 ? `예상 ${m.rank}위를 ${m.pick}순위에 (${gap}계단 일찍)` : gap < 0 ? `예상 ${m.rank}위를 ${m.pick}순위에 (${-gap}계단 늦게 · 이득)` : '예상 순위 그대로'}</td></tr>`; }).join('')}
      </tbody></table>` : '<p class="muted">이번 드래프트에서 지명하지 않았어요.</p>'}
    <p class="muted small">실제 드래프트에서 누가 어디로 갔는지는 게임이 끝난 뒤 공개돼요.</p></div></div>
    <div class="panel"><h2>전체 지명 결과</h2><div class="body scroll">${table('draftresult', D.made, [
      { k: 'pick', label: '순위', n: 1, get: (m) => m.pick },
      { k: 'team', label: '팀', get: (m) => name(m.team) },
      { k: 'name', label: '선수', get: (m) => m.name },
      { k: 'pos', label: '포지션', get: (m) => m.pos },
      { k: 'rank', label: '예상 순위', n: 1, get: (m) => m.rank, fmt: (v) => v ?? '밖' },
      { k: 'why', label: '이유', get: (m) => (m.by === 'user' ? '우리 선택' : m.reason) },
    ], { sortKey: 'pick', sortDir: 1, rowClick: (m) => `prospect:${m.id}`, mine: (m) => m.team === me })}</div></div>`;
}

export function renderDraftRoom(main, go) {
  const s = state.save, D = draftState();
  if (s.phase === 'draft' && isDone()) finish();
  if (s.phase === 'draft_done') {
    main.innerHTML = `<div id="draft-room"><h1>${s.year} NBA 드래프트 결과</h1>${summary()}
      ${s.phase === 'draft_done' ? '<p><button class="go" id="to-off">다음 단계: 옵션·퀄리파잉 오퍼·신인 계약</button></p>' : ''}</div>`;
    main.querySelector('#to-off')?.addEventListener('click', () => document.getElementById('next')?.click());
    return;
  }
  const chips = [['all', '전체'], ['G', '가드'], ['F', '포워드'], ['C', '센터'], ['watch', `★ 관심 (${D.watch.length})`]];
  main.innerHTML = `<div id="draft-room">
    <h1>${s.year} NBA 드래프트</h1>
    ${stage()}
    <div class="draft-grid">
      <div class="panel"><h2>남은 유망주 <span class="muted small">${available().length}명 · 이름을 누르면 자세히</span></h2>
        <div class="body"><p class="chips">${chips.map(([k, l]) => `<button class="chip${ui.filter === k ? ' on' : ''}" data-filter="${k}">${l}</button>`).join('')}</p>${poolTable()}</div></div>
      <div class="side-col">
        <div class="panel"><h2>방금 지명</h2><div class="body">${ticker()}</div></div>
        <div class="panel"><h2>우리 팀 사정</h2><div class="body">${teamPanel()}</div></div>
      </div>
    </div></div>`;
  bind(main, go);
  if (myTurn() && !ui.turnAt) ui.turnAt = Date.now();
}

function bind(main, go) {
  const D = draftState(), s = state.save;
  const q = (id) => main.querySelector(id);
  q('#start-draft')?.addEventListener('click', () => { D.started = true; ui.startedAt = Date.now(); writeSave(); track('draft_start', { pace: D.pace, my_picks: myLeft().map((o) => o.pick) }); D.pace === 'step' ? renderDraftRoom(main, go) : run(main, go); });
  q('#resume')?.addEventListener('click', () => { track('draft_resume', { at: D.made.length }); run(main, go); });
  q('#step')?.addEventListener('click', () => { stepOnce(); renderDraftRoom(main, go); });
  q('#pause')?.addEventListener('click', () => { stop(); track('draft_pause', { at: D.made.length }); renderDraftRoom(main, go); });
  q('#finish')?.addEventListener('click', () => { ui.fast = true; track('draft_finish_auto', { at: D.made.length }); run(main, go); });
  q('#confirm-pick')?.addEventListener('click', () => pickUser(ui.confirm, main, go));
  const callReply = (yes) => {
    const o = OF.inbox().list.find((x) => x.id === +q('#call-yes').dataset.call), sl = nextSlot();
    const meta = { id: o.id, partner: o.team, motive: o.motive, ratio: o.ratio, give: o.get, get: o.give, where: 'draft', pick: sl?.pick, ms_on_clock: ui.turnAt ? Date.now() - ui.turnAt : null };
    if (!yes) { OF.decline(o); track('trade_offer_reply', { ...meta, reply: 'decline' }); return renderDraftRoom(main, go); }
    const r = OF.accept(o);
    track('trade_offer_reply', { ...meta, reply: r.err ? 'invalid' : 'accept' });
    if (!r.err) track('trade_done', { partner: o.team, gave: o.get, got: o.give, incoming: true, during_draft: true });
    ui.turnAt = null;
    if (D.pace === 'auto' && !r.err) return run(main, go);   // 순위를 넘겼으니 상대 구단 지명부터 이어서
    renderDraftRoom(main, go);
  };
  q('#call-yes')?.addEventListener('click', () => callReply(true));
  q('#call-no')?.addEventListener('click', () => callReply(false));
  q('#cancel-pick')?.addEventListener('click', () => { ui.confirm = null; renderDraftRoom(main, go); });
  q('#fast')?.addEventListener('change', (e) => { D.speed = e.target.checked ? 'fast' : 'normal'; writeSave(); track('draft_speed', { speed: D.speed }); });
  main.querySelectorAll('input[name=pace]').forEach((r) => r.onchange = () => { D.pace = r.value; writeSave(); track('draft_pace', { pace: r.value, at: D.made.length }); if (r.value === 'step') stop(); renderDraftRoom(main, go); });
}

// 표·상세 창 안 버튼(별·지명·필터)은 상세 창이 열리지 않게 먼저 가로챔 (한 번만 등록)
document.addEventListener('click', onClick, true);
function onClick(e) {
  const main = document.getElementById('main');
  if (!document.getElementById('draft-room')) return;
  const w = e.target.closest('[data-watch]'), pk = e.target.closest('[data-pickit]'), f = e.target.closest('[data-filter]');
  if (!w && !pk && !f) return;
  e.stopPropagation(); e.preventDefault();
  const D = draftState();
  if (w) {
    const id = w.dataset.watch, on = !D.watch.includes(id);
    D.watch = on ? [...D.watch, id] : D.watch.filter((x) => x !== id); writeSave();
    const p = state.data.draft_pool.find((x) => x.player_id === id);
    track('draft_watch', { id, on, rank: p?.pre_draft_rank?.rank ?? null, phase: state.save.phase });
  }
  if (f) { ui.filter = f.dataset.filter; track('draft_filter', { filter: ui.filter }); }
  if (pk && myTurn()) {
    ui.confirm = pk.dataset.pickit;
    document.getElementById('drawer')?.remove(); document.getElementById('drawer-bg')?.remove();
    scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (document.getElementById('drawer') && w) {   // 상세 창의 별 버튼: 창 내용만 다시
    const dr = document.getElementById('drawer'); const btn = dr.querySelector(`[data-watch="${w.dataset.watch}"]`);
    if (btn) btn.textContent = D.watch.includes(w.dataset.watch) ? '★ 관심 목록에서 빼기' : '☆ 관심 목록에 담기';
  }
  renderDraftRoom(main);
}

function stepOnce() {
  const sl = nextSlot(); if (!sl || sl.team === state.save.team) return false;
  const { p, reason } = aiChoose(sl.team, sl);
  record(sl, p, 'ai', reason);
  return true;
}
function stop() { clearTimeout(timer); timer = null; ui.running = false; }
function run(main, go) {
  stop(); ui.running = true;
  const tick = () => {
    if (!document.getElementById('draft-room')) return stop();       // 다른 화면으로 가면 멈춤
    if (isDone()) { stop(); finish(); return renderDraftRoom(document.getElementById('main'), go); }
    if (myTurn()) { stop(); ui.turnAt = Date.now(); return renderDraftRoom(document.getElementById('main'), go); }   // 고민 시간은 우리 차례가 뜬 순간부터
    const sl = nextSlot();
    stepOnce();
    const m = draftState().made[draftState().made.length - 1];
    const big = !ui.fast && sl && sl.pick <= 3;                      // 1~3순위는 발표 연출
    if (big) ui.announce = { pick: m.pick, team: m.team, name: m.name, pos: m.pos, rank: m.rank, until: Date.now() + 2200 };
    renderDraftRoom(document.getElementById('main'), go);
    timer = setTimeout(tick, ui.fast ? 40 : big ? 2400 : SPEED[draftState().speed || 'normal']);
  };
  tick();
}

function pickUser(id, main, go) {
  const sl = nextSlot(), p = state.data.draft_pool.find((x) => x.player_id === id);
  if (!sl || sl.team !== state.save.team || !p) return;
  const pool = available(), best = Math.min(...pool.map(boardRank));
  const D = draftState();
  track('draft_pick_user', { pick: sl.pick, round: sl.round, id, rank: p.pre_draft_rank?.rank ?? null, best_rank_available: best,
    rank_gap: (p.pre_draft_rank?.rank ?? boardRank(p)) - sl.pick, pos: p.position, watched: D.watch.includes(id), viewed_detail: ui.viewed.has(id),
    ms_on_clock: ui.turnAt ? Date.now() - ui.turnAt : null, filter: ui.filter });
  record(sl, p, 'user', null);
  ui.confirm = null; ui.turnAt = null;
  ui.announce = { pick: sl.pick, team: sl.team, name: p.name, pos: p.position, rank: p.pre_draft_rank?.rank ?? null, mine: true, until: Date.now() + 2600 };
  renderDraftRoom(main, go);
  setTimeout(() => {                                  // 우리 지명 발표를 보여 준 뒤 이어서 진행
    if (!document.getElementById('draft-room')) return;
    if (D.pace === 'auto' && myLeft().length) return run(document.getElementById('main'), go);
    renderDraftRoom(document.getElementById('main'), go);
  }, 2700);
}

function finish() {
  const s = state.save, D = draftState();
  if (s.phase !== 'draft') return;
  s.phase = 'draft_done'; writeSave();
  dispatchEvent(new Event('phasechange'));   // 위 막대 버튼 바꾸기
  track('draft_complete', { user_picks: D.made.filter((m) => m.team === s.team).map((m) => ({ pick: m.pick, rank: m.rank })),
    watch_size: D.watch.length, ms: ui.startedAt ? Date.now() - ui.startedAt : null });
}
