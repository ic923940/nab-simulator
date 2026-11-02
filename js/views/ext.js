// 연장 계약 화면: 대상 선수 목록 → 에이전트와 연장 협상 (FA 협상 테이블과 같은 모양)
import { esc, money, num, lastSeason } from '../util.js';
import { capBug } from './capbug.js';
import { state, teamBy } from '../store.js';
import { track } from '../analytics.js';
import { term } from '../glossary.js';
import * as E from '../ext.js';
import * as F from '../fa.js';
import { bpmOf } from '../strength.js';

const S = () => state.data.season;
const ui = { sel: null, o: {} };
const KIND = { rookie: '신인 연장', veteran: '베테랑 연장' };
const initials = (n) => n.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const sign = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(1);

export function renderExt(main) {
  if (!E.windowOpen()) {
    main.innerHTML = `<h1>연장 계약</h1><p class="sub">${state.save.phase === 'preseason' ? '개막 로스터가 확정돼서 오프시즌 연장 협상은 끝났어요.' : '연장 계약은 FA 모라토리엄이 끝난 뒤(7월 6일 무렵)부터 개막 전까지 할 수 있어요.'}</p>${doneHTML()}`;
    return;
  }
  const list = E.eligible();
  main.innerHTML = `<h1>연장 계약</h1>
    <p class="sub">계약이 끝나기 전에 미리 재계약하는 거예요. 지금 연장하면 FA 시장에 나가지 않지만, 선수는 '나중에 FA로 받을 돈'과 비교해요.
      ${term('rookie_ext', '신인 연장')}은 신인 계약 마지막 해를 앞둔 1라운드 선수, ${term('vet_ext', '베테랑 연장')}은 3년 이상 계약의 2주년이 지난 선수가 대상이에요.</p>
    ${capBug()}
    <div class="ext-grid">
      <div class="panel"><h2>대상 선수 <span class="muted small">${list.length}명</span></h2><div class="body">${list.length ? list.map(row).join('') : '<p class="muted">지금 연장할 수 있는 선수가 없어요.</p>'}</div></div>
      <div id="ext-room"></div>
    </div>${doneHTML()}`;
  main.querySelectorAll('[data-ext]').forEach((b) => b.onclick = () => { ui.sel = b.dataset.ext; ui.o = {}; const p = find(ui.sel); E.talk(p); track('ext_select', { pid: p.player_id, kind: E.kind(p), v: Math.round(F.V(p)), ask: E.ask(p) }); renderExt(main); main.querySelector('#ext-room')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
  drawRoom(main);
}
const find = (pid) => teamBy(state.save.team).roster.find((p) => p.player_id === pid);
function row(p) {
  const fut = (p.contract?.years || []).filter((y) => y.season >= S()), tk = E.ex().talks[p.player_id];
  return `<button class="frow ${ui.sel === p.player_id ? 'on' : ''}" data-ext="${esc(p.player_id)}"><span class="fv">${money(F.V(p), 1)}</span>
    <span class="fn"><b>${esc(p.name)}</b><span class="sub2">${KIND[E.kind(p)]} · ${p.age ?? '?'}세 · ${fut.length}년 남음 (${money(fut[fut.length - 1]?.salary, 1)})</span></span>
    <span class="fs">${tk?.closed ? '<span class="bad">결렬</span>' : tk ? '협상 중' : ''}</span></button>`;
}
function drawRoom(main) {
  const el = main.querySelector('#ext-room'), p = ui.sel && find(ui.sel);
  if (p && !E.kind(p) && E.ex().talks[p.player_id]) {   // 연장 합의 뒤: 대화만 보여 줌
    const tk = E.ex().talks[p.player_id];
    el.innerHTML = `<div class="panel"><div class="body"><p><span class="signed">연장 합의</span> <b>${esc(p.name)}</b></p><div class="chat">${tk.log.map((m) => `<div class="bubble ${m.who}">${m.who === 'agent' ? '<b>에이전트</b>' : m.who === 'me' ? '<b>우리</b>' : ''}${esc(m.text)}</div>`).join('')}</div></div></div>`;
    return;
  }
  if (!p || !E.kind(p)) { el.innerHTML = '<div class="panel"><div class="body muted">대상 선수 목록에서 선수를 고르면 에이전트와 연장 협상을 시작해요.</div></div>'; return; }
  const tk = E.talk(p), lim = E.limits(p), ps = F.persona(p), h = lastSeason(p), fut = (p.contract?.years || []).filter((y) => y.season >= S());
  const o = ui.o;
  if (o.yrs == null) o.yrs = Math.min(lim.yrs, 3);
  if (o.s1 == null) o.s1 = Math.round(Math.min(lim.max, F.V(p)) / 1e5) * 1e5;   // 처음 값: 지금 시장 가치
  o.s1 = Math.min(o.s1, lim.max); o.yrs = Math.min(o.yrs, lim.yrs);
  if (o.raise == null) o.raise = 0.05; if (!o.opt || o.yrs === 1) o.opt = o.yrs === 1 ? 'none' : (o.opt || 'none');
  const sal = E.salaries(o), errs = E.check(p, o), last = fut[fut.length - 1];
  const s0 = +last.season.slice(0, 4) + 1;
  el.innerHTML = `<div class="panel"><div class="room-head"><div class="mono">${initials(p.name)}</div>
      <div class="who"><a href="#" class="nm" data-open="player:${esc(p.player_id)}">${esc(p.name)}</a>
        <div class="sub2">${esc(p.pos || '')} · ${p.age ?? '?'}세 · ${h ? `${esc(h.season)} ${h.g}경기 ${num(h.pts_per_game)}득점` : '지난 시즌 기록 없음'} · 예상 BPM ${sign(bpmOf(p))}</div>
        <div class="tags"><span class="tag team">${KIND[E.kind(p)]}</span> <span class="tag">지금 계약 ${esc(last.season)}까지 · 마지막 해 ${money(last.salary, 1)}</span></div></div>
      <div class="mv"><div class="k">${term('market_value', '예상 시장 가치')}</div><div class="v">${money(F.V(p), 1)}</div><div class="k">에이전트 ${F.STYLE_KO[ps.style]} · 인내심 ${'■'.repeat(Math.max(0, tk.pat))}</div></div></div>
    <div class="room-body"><div class="talkcol"><div class="chat">${tk.log.map((m) => `<div class="bubble ${m.who}">${m.who === 'agent' ? '<b>에이전트</b>' : m.who === 'me' ? '<b>우리</b>' : ''}${esc(m.text)}</div>`).join('')}</div>
      <div class="qs"><button class="chip" id="ext-q" ${tk.closed ? 'disabled' : ''}>원하는 조건은?${tk.asked ? ' ·' : ''}</button></div>
      <p class="small muted">한도: 연장 첫해 최대 ${money(lim.max, 1)}, 최대 ${lim.yrs}년 추가 · ${esc(lim.note)}</p></div>
    <div class="builder">
      <div class="k">추가 기간</div><div class="seg">${[1, 2, 3, 4, 5].map((y) => `<button data-es="yrs" data-v="${y}" class="${o.yrs === y ? 'on' : ''}" ${y > lim.yrs ? 'disabled' : ''}>${y}년</button>`).join('')}</div>
      <div class="k">연장 첫해(${s0}-${String(s0 + 1).slice(2)}) 연봉</div>
      <div class="salary-row"><button data-ea="-1000000">−1M</button><button data-ea="-100000">−0.1M</button><output>${money(o.s1, 2)}</output><button data-ea="100000">+0.1M</button><button data-ea="1000000">+1M</button></div>
      <div class="k">해마다 인상</div><div class="seg">${[0, 0.03, 0.05, 0.08].map((v) => `<button data-es="raise" data-v="${v}" class="${o.raise === v ? 'on' : ''}">${Math.round(v * 100)}%</button>`).join('')}</div>
      ${o.yrs > 1 ? `<div class="k">마지막 해 옵션</div><div class="seg">${[['none', '없음'], ['player', '선수 옵션'], ['team', '팀 옵션']].map(([v, l]) => `<button data-es="opt" data-v="${v}" class="${o.opt === v ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
      <div class="ystrip">${sal.map((v, i) => `<div><span>${s0 + i}-${String(s0 + i + 1).slice(2)}</span><b>${money(v, 1)}</b></div>`).join('')}</div>
      <div class="tot">연장 총액 <b>${money(sal.reduce((a, b) => a + b, 0), 1)}</b></div>
      ${errs.length ? `<ul class="errs">${errs.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
      <div class="acts"><button class="go" id="ext-send" ${errs.length || tk.closed ? 'disabled' : ''}>연장 제안</button>${tk.counter && !tk.closed ? ' <button class="go ghost" id="ext-ctr">역제안 조건으로 맞추기</button>' : ''}</div>
    </div></div></div>`;
  el.querySelectorAll('[data-es]').forEach((b) => b.onclick = () => { const k = b.dataset.es; o[k] = k === 'opt' ? b.dataset.v : +b.dataset.v; drawRoom(main); });
  el.querySelectorAll('[data-ea]').forEach((b) => b.onclick = () => { o.s1 = Math.max(0, Math.round((o.s1 + +b.dataset.ea) / 5e4) * 5e4); drawRoom(main); });
  el.querySelector('#ext-q')?.addEventListener('click', () => { E.question(p); track('ext_question', { pid: p.player_id, pat: tk.pat }); drawRoom(main); });
  el.querySelector('#ext-ctr')?.addEventListener('click', () => { Object.assign(o, tk.counter); drawRoom(main); });
  el.querySelector('#ext-send')?.addEventListener('click', () => {
    const r = E.propose(p, { ...o });
    track('ext_offer', { pid: p.player_id, kind: E.kind(p) || 'done', s1: o.s1, yrs: o.yrs, raise: o.raise, opt: o.opt, ask: E.ask(p), v: Math.round(F.V(p)), r: r.r, sc: r.sc ? Math.round(r.sc * 100) / 100 : null });
    renderExt(main);
  });
  const ch = el.querySelector('.chat'); if (ch) ch.scrollTop = ch.scrollHeight;
}
function doneHTML() {
  const d = E.ex().done.filter((x) => x.team === state.save.team);
  if (!d.length) return '';
  return `<div class="panel"><h2>이번 오프시즌 연장 계약</h2><div class="body"><ul class="news">${d.map((x) => { const p = find(x.pid); return `<li><b>${esc(p?.name || x.pid)}</b> · ${KIND[x.kind]} ${x.yrs}년 · 첫해 ${money(x.s1, 1)}</li>`; }).join('')}</ul></div></div>`;
}
