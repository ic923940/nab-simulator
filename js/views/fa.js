// FA 협상 화면: 위 = FA 시계(실제 일정) / 왼쪽 = 시장 / 가운데 = 협상 테이블(에이전트와 대화 + 계약서 만들기) / 오른쪽 = 속보
import { esc, money, num, lastSeason } from '../util.js';
import { state, writeSave, teamBy } from '../store.js';
import { track } from '../analytics.js';
import { term } from '../glossary.js';
import { notice } from '../ui.js';
import * as F from '../fa.js';
import * as CH from '../chat.js';
import { capSheet, faHold } from '../capsheet.js';
import { log as offLog } from '../offseason.js';
import * as SNT from '../snt.js';
import * as SL from '../summer.js';
import { plainLabel } from '../picks.js';
import { teamPayroll } from '../rules.js';
import { renderFA as renderFAList } from './league.js';

const ui = { sel: null, filter: 'mine', q: '', offer: {}, busy: false };
const tn = (a) => teamBy(a)?.name || a;
const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
const initials = (n) => n.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const typeKO = (p) => (F.isRFA(p) ? 'RFA' : p.contract?.fa_type === 'RFA 자격' ? 'RFA 자격' : 'UFA');
const BIRD = { full: '풀 버드', early: '얼리 버드', non: '논 버드' };
const OPT_KO = { none: '없음', player: '선수 옵션', team: '팀 옵션' };

export function renderFAView(main, go) {
  const s = state.save;
  if (!['fa', 'roster'].includes(s.phase)) return renderFAList(main);
  if (s.phase === 'fa') F.start();
  if (F.fa().done) return afterView(main, go);
  const st = F.curStep(), all = F.steps(), nx = all[st.i + 1];
  main.innerHTML = `
  <div class="stage fa-clock"><div class="stage-grid">
    <div class="bignum">${md(st.date)}<small>${s.year} FA · ${esc(st.t)}${st.est ? ' (날짜 추정)' : ''}</small></div>
    <div><h2>${esc(st.t)}</h2><p>${esc(st.note)}</p>
      <p class="small">${st.moratorium ? `${term('moratorium', '모라토리엄')} 기간: 지금 맺는 계약은 '합의'예요. ${F.dateKO(all.find((x) => x.k === 'mor').date)}에 공식 서명해요.` : '공식 서명이 가능한 기간이에요.'}</p>
      <ol class="fa-steps">${all.map((x) => `<li class="${x.i < st.i ? 'done' : x.i === st.i ? 'on' : ''}" title="${esc(x.t)}"><span>${md(x.date)}</span></li>`).join('')}</ol></div>
    <div class="clock-side">${nx ? `<div class="small">다음 날짜</div><div class="n">${md(nx.date)}</div><div class="small">${esc(nx.t)}</div>` : '<div class="small">마지막 날짜</div>'}
      <button class="go" id="fa-adv">${nx ? '시간 진행' : 'FA 마감'}</button></div>
  </div></div>
  <section class="panel board" id="board"></section>
  <div class="fa-grid">
    <section class="panel market stick"><h2>FA 시장</h2><div class="body" id="mk"></div></section>
    <section class="room" id="room"></section>
    <aside class="panel feed"><h2>속보 <span class="muted small">게임 속 소식</span></h2><div class="body" id="feed"></div></aside>
  </div>
  <div id="fa-cap"></div>`;
  drawBoard(main); drawMarket(main); drawRoom(main); drawFeed(main); drawCap(main);
  main.querySelector('#fa-adv').onclick = () => advance(main, go);
  if (F.pendingMySheets().length) sheetModal(main, go);
}


// ── 오늘의 브리핑 + 관심 선수판 ──
const PHASE_KO = { ours: '우리와 계약', gone: '다른 팀과 계약', sheet: '오퍼시트', closed: '협상 결렬', standing: '우리 제안 올려 둠', talking: '협상 중', none: '아직 연락 전' };
function drawBoard(main) {
  const el = main.querySelector('#board'); if (!el) return;
  const me = state.save.team, sh = capSheet(), t = teamBy(me), std = t.roster.filter((q) => q.roster_role !== 'two_way').length;
  const todo = F.todos(sh.room, std), list = F.watch().map(F.watchStatus).filter(Boolean);
  const tools = (() => { const any = F.marketRows().find((r) => !r.signed && r.p.contract?.rights_team !== me); return any ? F.toolsFor(me, any.p).filter((x) => !['min', 'two_way', 'ex10', 'bird'].includes(x.k)) : []; })();
  const card = (w) => { const p = w.p, sub = w.phase === 'ours' || w.phase === 'gone' ? `${esc(tn(w.e.team))} · ${w.e.years.length}년 ${money(w.e.years.reduce((a, y) => a + y.salary, 0), 1)}`
      : [w.n ? `소문으로는 제안 ${w.n}개` : '', w.standing ? `우리 제안 ${w.standing.yrs}년 ${money(F.salaries(p, w.standing)[0], 1)}` : ''].filter(Boolean).join(' · ');
    return `<div class="wcard st-${w.phase}" data-sel="${esc(w.pid)}" role="button" tabindex="0"><span class="x" data-star="${esc(w.pid)}" role="button" tabindex="0" aria-label="관심 선수에서 빼기">×</span>
      <div class="wn">${esc(p.name)}</div><div class="wv">${money(F.V(p), 1)}${w.told && !['ours', 'gone'].includes(w.phase) ? ` <span class="small muted">요구 ${money(w.told, 1)}</span>` : ''}</div>
      <div class="wp">${PHASE_KO[w.phase]}</div><div class="ws small">${sub}</div></div>`; };
  const sug = [];   // 추천은 판단 힌트가 돼서 보여 주지 않음
  el.innerHTML = `<div class="board-head"><h2>오늘의 브리핑 <span class="muted small">${F.dateKO(F.curStep().date)}</span></h2>
      <div class="facts small"><span>캡 여유 <b class="${sh.room > 0 ? 'good' : ''}">${sh.room >= 0 ? money(sh.room, 1) : '없음'}</b></span><span>정규 <b>${std}</b>/15명</span>
        <span>쓸 수 있는 예외 ${tools.length ? tools.map((x) => `<b>${esc(x.label)} ${money(x.max, 1)}</b>`).join(' · ') : '<b>없음</b>'}</span><a href="#" data-open="team:${esc(me)}">우리 로스터 보기</a></div></div>
    <div class="board-body">
      <div class="todo"><div class="k">오늘 할 일</div>${todo.length ? `<ol>${todo.map((x) => `<li${x.pid ? ` data-sel="${esc(x.pid)}" class="link"` : ''}>${esc(x.text)}</li>`).join('')}</ol>` : '<p class="muted small">급한 일은 없어요. 시간을 진행해도 돼요.</p>'}</div>
      <div class="wboard"><div class="k">관심 선수판 <span class="muted small">${list.length}명 · 카드를 누르면 협상 테이블로</span></div>
        <div class="wcards">${list.map(card).join('')}${sug.length ? `<div class="wsug"><div class="small muted">${list.length ? '이런 선수는 어때요?' : '추천: 우리가 닿을 만한 선수'}</div>${sug.map((p) => `<button class="chip" data-star="${esc(p.player_id)}">☆ ${esc(p.name)} <span class="muted">${money(F.V(p), 1)}</span></button>`).join('')}</div>` : ''}</div></div>
    </div>`;
  el.querySelectorAll('[data-sel]').forEach((b) => { const fn = () => { track('fa_board_click', { pid: b.dataset.sel }); select(main, b.dataset.sel); }; b.onclick = fn; b.onkeydown = (e) => { if (e.key === 'Enter') fn(); }; });
  bindStars(main, el);
}

// ── 시장 목록 ──
const FILTERS = [['watch', '☆ 관심'], ['mine', '우리 FA'], ['all', '전체'], ['hot', '관심 집중'], ['cheap', '최저·투웨이'], ['rfa', 'RFA'], ['talk', '협상 중'], ['done', '계약 완료']];
function drawMarket(main) {
  const el = main.querySelector('#mk'), me = state.save.team;
  let rows = F.marketRows();
  const f = ui.filter, q = ui.q.trim().toLowerCase();
  rows = rows.filter((r) => f === 'done' ? !!r.signed : !r.signed);
  if (f === 'mine') rows = rows.filter((r) => r.p.contract?.rights_team === me || r.p.contract?.renounced_by === me);
  if (f === 'hot') rows = rows.filter((r) => r.n >= 2);
  if (f === 'watch') rows = rows.filter((r) => F.isWatched(r.p.player_id));
  if (f === 'rfa') rows = rows.filter((r) => F.isRFA(r.p));
  if (f === 'cheap') rows = rows.filter((r) => { const c = F.cheapOK(r.p); return c.min || c.tw; });
  if (f === 'talk') rows = rows.filter((r) => r.tk && r.tk.log.length > 1);
  if (q) rows = rows.filter((r) => r.p.name.toLowerCase().includes(q));
  rows.sort((a, b) => b.v - a.v);
  const shown = rows.slice(0, 80);
  const cheapTime = ['m40', 'camp'].includes(F.curStep().k);
  if (cheapTime && ui.cheapAuto !== F.curStep().k) { ui.cheapAuto = F.curStep().k; if (f !== 'cheap') { ui.filter = 'cheap'; return drawMarket(main); } }   // 최저연봉·투웨이 시기엔 그 목록을 먼저
  el.innerHTML = `${cheapTime ? `<p class="hint small">지금은 <b>최저연봉·투웨이 시기</b>예요. 남은 선수 중 최저연봉이나 투웨이로 계약할 만한 선수를 모아 보여요. 고른 뒤 계약 수단에서 '최저연봉'이나 '투웨이'를 고르세요.</p>` : ''}<div class="chips">${FILTERS.map(([k, l]) => `<button class="chip ${f === k ? 'on' : ''}" data-mf="${k}">${l}</button>`).join('')}</div>
    <input class="search" id="mk-q" placeholder="이름 검색" value="${esc(ui.q)}" aria-label="선수 이름 검색">
    <div class="flist">${shown.length ? shown.map((r) => frow(r)).join('') : `<p class="muted small">${f === 'mine' ? '권리를 가진 FA가 없어요. "전체"에서 다른 팀 선수를 찾아보세요.' : f === 'watch' ? '관심 선수가 없어요. 선수 이름 옆 ☆를 눌러 추가하세요.' : '해당하는 선수가 없어요.'}</p>`}</div>
    ${rows.length > shown.length ? `<p class="muted small">가치 순 상위 ${shown.length}명만 보여요. 이름으로 찾아보세요.</p>` : ''}`;
  el.querySelectorAll('[data-mf]').forEach((b) => b.onclick = () => { ui.filter = b.dataset.mf; drawMarket(main); });
  const inp = el.querySelector('#mk-q');
  inp.oninput = () => { ui.q = inp.value; const pos = inp.selectionStart; drawMarket(main); const n = main.querySelector('#mk-q'); n.focus(); n.setSelectionRange(pos, pos); };
  el.querySelectorAll('[data-sel]').forEach((b) => b.onclick = () => select(main, b.dataset.sel));
  bindStars(main, el);
}
// 별: 관심 선수 넣고 빼기 (목록·협상 테이블·선수판 공통)
function bindStars(main, el) {
  el.querySelectorAll('[data-star]').forEach((b) => { const fn = (e) => { e.stopPropagation(); e.preventDefault(); const on = F.toggleWatch(b.dataset.star); track('fa_watch', { pid: b.dataset.star, on, step: F.fa().step }); drawBoard(main); drawMarket(main); drawRoom(main); };
    b.onclick = fn; b.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') fn(e); }; });
}
function frow(r) {
  const p = r.p, me = state.save.team, c = p.contract || {};
  const mine = c.rights_team === me;
  const stt = r.signed ? `<span class="${r.signed.team === me ? 'good' : 'muted'}">${esc(r.signed.team)} ${r.signed.how === 'qo' ? 'QO' : '계약'}</span>`
    : r.sheet ? '<span class="warn">오퍼시트</span>' : r.tk?.closed ? '<span class="bad">결렬</span>' : r.tk?.standing ? '<span class="good">제안 중</span>' : r.tk && r.tk.log.length > 1 ? '협상 중' : '';
  const heat = r.signed ? '' : `<span class="heat" title="다른 구단 제안 ${r.n}개">${[0, 1, 2].map((i) => `<i class="${r.n > i * 2 ? 'on' : ''}"></i>`).join('')}</span>`;
  return `<button class="frow ${ui.sel === p.player_id ? 'on' : ''} ${mine ? 'mine' : ''}" data-sel="${esc(p.player_id)}">
    <span class="fv">${money(r.v, 1)}</span><span class="fn"><b>${r.signed ? '' : `<span class="star ${F.isWatched(p.player_id) ? 'on' : ''}" data-star="${esc(p.player_id)}" role="button" tabindex="0" aria-label="관심 선수 ${F.isWatched(p.player_id) ? '빼기' : '추가'}">${F.isWatched(p.player_id) ? '★' : '☆'}</span>`}${esc(p.name)}</b><span class="sub2">${esc(p.pos || '')} · ${p.age ?? '?'}세 · ${typeKO(p)}${c.rights_team ? ` · ${esc(c.rights_team)}` : ''}</span></span>
    <span class="fs">${heat}${stt}${r.signed ? '' : (() => { const ch = F.cheapOK(p); return (ch.tw ? '<span class="ctag">투웨이</span>' : '') + (ch.min ? '<span class="ctag">최저</span>' : ''); })()}</span></button>`;
}
function select(main, pid) {
  ui.sel = pid; ui.offer = {};
  const r = F.marketRows().find((x) => x.p.player_id === pid);
  if (r && !r.signed) { F.talk(r.p); track('fa_select', { pid, v: Math.round(r.v), mine: r.p.contract?.rights_team === state.save.team, type: typeKO(r.p), step: F.fa().step }); }
  drawBoard(main); drawMarket(main); drawRoom(main);
  main.querySelector('#room')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ── 협상 테이블 ──
function drawRoom(main) {
  drawBoard(main);
  const el = main.querySelector('#room');
  const r = ui.sel && F.marketRows().find((x) => x.p.player_id === ui.sel);
  if (!r) {
    const sh = capSheet();
    el.innerHTML = `<div class="panel"><div class="body room-empty">
      <h2>협상 테이블</h2>
      <p>시장 목록에서 선수를 고르면 그 선수의 에이전트와 협상을 시작해요.</p>
      <ul class="report">
        <li>먼저 <b>우리 FA</b>부터 보세요. ${term('bird', '버드 권리')}가 있으면 캡을 넘어도 재계약할 수 있어요.</li>
        <li>에이전트에게 원하는 조건·중요하게 보는 것·다른 구단 제안을 물어볼 수 있어요. 같은 날 같은 질문을 또 하면 인내심이 줄어요.</li>
        <li>너무 낮은 제안은 인내심을 크게 깎고 선수 기분도 상하게 해요. 인내심이 바닥나면 협상이 중단돼요.</li>
        <li>지금 우리 캡 여유: <b>${sh.room >= 0 ? money(sh.room, 1) : '없음 (캡 초과)'}</b>. 캡 공간이 필요하면 ${'<a href="#/finance">재정</a>'}에서 쓰지 않을 FA의 권리를 포기하세요.</li>
      </ul></div></div>`;
    return;
  }
  const p = r.p, me = state.save.team, c = p.contract || {};
  const h = lastSeason(p), ps = F.persona(p);
  const head = `<div class="room-head">
    <div class="mono">${initials(p.name)}</div>
    <div class="who"><a href="#" class="nm" data-open="player:${esc(p.player_id)}">${esc(p.name)}</a>${r.signed ? '' : ` <button class="starbtn ${F.isWatched(p.player_id) ? 'on' : ''}" data-star="${esc(p.player_id)}">${F.isWatched(p.player_id) ? '★ 관심 선수' : '☆ 관심 선수로'}</button>`}
      <div class="sub2">${esc(p.pos || '')} · ${p.age ?? '?'}세 · 경력 ${F.svcOf(p)}년${h ? ` · ${esc(h.season)} ${h.g}경기 ${num(h.pts_per_game)}득점 ${num(h.trb_per_game)}리바 ${num(h.ast_per_game)}어시` : ''}</div>
      <div class="tags">${term(F.isRFA(p) ? 'rfa' : 'ufa', typeKO(p))}${c.rights_team ? ` <span class="tag ${c.rights_team === me ? 'team' : ''}">권리 ${esc(c.rights_team)}${c.bird ? ' · ' + BIRD[c.bird] : ''}${c.bird_estimated ? '(추정)' : ''}</span>` : ''}${F.isRFA(p) ? ` <span class="tag">QO ${money(c.qo, 2)}</span>` : ''}</div></div>
    <div class="mv"><div class="k">${term('market_value', '예상 시장 가치')}</div><div class="v">${money(r.v, 1)}</div>
      ${r.signed ? '' : `<div class="k">에이전트 ${F.STYLE_KO[ps.style]} · 인내심 ${pips(r.tk)}</div>`}
      ${!r.signed && c.rights_team === me ? `<button class="linkbtn" id="renounce">권리 포기 (캡 홀드 ${money(faHold(p), 1)} 제거)</button>` : ''}
      ${!r.signed && c.rights_team === me && !SNT.eligible(p) ? `<br><button class="linkbtn snt" id="snt">사인 앤 트레이드 알아보기</button>` : ''}</div></div>`;
  if (r.signed) {
    const e = r.signed, tot = e.years.reduce((a, y) => a + y.salary, 0);
    el.innerHTML = `<div class="panel">${head}<div class="body"><p><span class="signed">${e.team === me ? '계약' : '계약 완료'}</span> ${esc(tn(e.team))} · ${e.years.length}년 ${money(tot, 1)} (${F.TOOL_KO[e.tool]})</p>
      ${strip(e.years.map((y) => y.salary), e.years)}${chat(r.tk)}</div></div>`;
    return;
  }
  const tk = F.talk(p), tools = F.toolsFor(me, p);
  const o = offerState(p, tools), tool = tools.find((x) => x.k === o.tool) || tools[0];
  const sal = F.salaries(p, o), chk = F.check(me, p, o), sheet = r.sheet;
  const rev = tk.rev || {}, f = F.fit(me, p);
  el.innerHTML = `<div class="panel">${head}
   <div class="room-body">
    <div class="talkcol">
      ${chat(tk)}
      <div class="qs">${[['want', '원하는 조건은?'], ['prefs', '무엇을 중요하게 봐요?'], ['market', '다른 구단 제안은?'], ['us', '우리 팀은 어때요?']].map(([k, l]) => `<button class="chip" data-q="${k}" ${tk.closed || tk.cool || sheet ? 'disabled' : ''}>${l}${tk.asked?.[k] === F.fa().step ? ' ·' : ''}</button>`).join('')}</div>
      <form class="chatin" id="chatin"><input id="chat-text" autocomplete="off" maxlength="200" placeholder="에이전트에게 말하기 · 예: 3년 2천만 달러 어때요? / 원하는 조건이 뭐예요?" ${tk.closed || tk.cool || ui.busy ? 'disabled' : ''}><button class="go small" ${tk.closed || tk.cool || ui.busy ? 'disabled' : ''}>보내기</button></form>
      <p class="muted small chathint">금액·기간·인상률·옵션·계약 수단을 말로 써도 돼요. 우승·출전 시간·인연 얘기로 설득할 수도 있어요.</p>
      <div class="intel">
        <div><div class="k">요구 조건</div><div class="v2">${rev.want ? `${money(rev.want.s1, 1)} · ${rev.want.yrs}년${rev.want.step !== F.fa().step ? ' <span class="muted small">(예전에 들은 값)</span>' : ''}` : '<span class="muted">?</span>'}</div></div>
        <div><div class="k">테이블 위 다른 제안</div><div class="v2">${rev.market ? `${rev.market.n}개 · 최고 ${money(rev.market.s1, 1)}` : `<span class="muted">${r.n ? '소문으로는 ' + r.n + '개' : '?'}</span>`}</div></div>
        <div class="wide"><div class="k">선수가 보는 우리 팀</div>${fitBars(f, rev)}</div>
      </div>
    </div>
    <div class="builder">
      ${sheet ? '<p class="warn">오퍼시트가 걸려 있어요. 원소속팀 결정을 기다리는 중이에요.</p>' : ''}
      <div class="k">계약 수단</div>
      <div class="tools-seg">${tools.map((x) => `<button class="${x.k === o.tool ? 'on' : ''}" data-tool="${x.k}" title="${esc(x.note)}">${esc(x.label)}<small>${x.fixed ? money(x.max, 2) : '~' + money(x.max, 1)}</small></button>`).join('')}</div>
      <div class="muted small">${esc(tool?.note || '')}</div>
      ${tool?.fixed ? '' : `<div class="k">첫해 연봉</div>
      <div class="salary-row"><button data-adj="-1000000">−1M</button><button data-adj="-100000">−0.1M</button><output>${money(o.s1, 2)}</output><button data-adj="100000">+0.1M</button><button data-adj="1000000">+1M</button></div>
      <input type="range" id="s1" min="${Math.round(minOf(p))}" max="${Math.round(tool.max)}" step="50000" value="${Math.round(o.s1)}" aria-label="첫해 연봉">
      <div class="range-legend"><span>최저 ${money(minOf(p), 1)}</span>${rev.want ? `<span>요구 ${money(rev.want.s1, 1)}</span>` : ''}<span>한도 ${money(tool.max, 1)}</span></div>`}
      <div class="k">기간</div>${segBtns('yrs', [1, 2, 3, 4, 5].map((y) => [y, y + '년', y > (tool?.yrs || 1)]), o.yrs)}
      ${tool?.fixed ? '' : `<div class="k">해마다 연봉 인상 <span class="muted small">(첫해 연봉의 %)</span></div>${segBtns('raise', [0, 0.03, 0.05, 0.08].map((v) => [v, Math.round(v * 100) + '%', v > (tool?.raise || 0) + 1e-9]), o.raise)}`}
      ${o.yrs > 1 && !tool?.fixed ? `<div class="k">마지막 해 옵션</div>${segBtns('opt', [['none', '없음'], ['player', '선수 옵션'], ['team', '팀 옵션']].map(([v, l]) => [v, l, false]), o.opt)}` : ''}
      ${strip(sal)}
      <div class="tot">총액 <b>${money(sal.reduce((a, b) => a + b, 0), 1)}</b> · 평균 ${money(sal.reduce((a, b) => a + b, 0) / sal.length, 1)}</div>
      ${chk.errors.length ? `<ul class="errs">${chk.errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${chk.warns.length ? `<ul class="warns">${chk.warns.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <div class="acts">
        <button class="go" id="send" ${chk.errors.length || tk.closed || tk.cool || sheet || ui.busy ? 'disabled' : ''}>제안 보내기</button>
        ${tk.counter && !tk.closed ? `<button class="go ghost" id="take-counter">역제안 조건으로 맞추기</button>` : ''}
        ${tk.standing ? `<button class="go ghost" id="withdraw">올려 둔 제안 거두기</button>` : ''}
      </div>
      ${tk.standing ? `<p class="small good">테이블에 올려 둔 제안: ${tk.standing.yrs}년 첫해 ${money(F.salaries(p, tk.standing)[0], 1)} (${F.TOOL_KO[tk.standing.tool]}). 시간을 진행하면 선수가 다른 제안과 비교해 결정해요.</p>` : ''}
    </div>
   </div></div>`;
  bindRoom(main, p, tools);
  const ch = el.querySelector('.chat'); if (ch) ch.scrollTop = ch.scrollHeight;
}
const minOf = (p) => state.data.league.minimum[Math.min(F.svcOf(p), 10)];
function offerState(p, tools) {
  const o = ui.offer, rev = F.talk(p).rev || {};
  if (!o.tool || !tools.some((x) => x.k === o.tool)) o.tool = tools[0]?.k;
  const tool = tools.find((x) => x.k === o.tool);
  if (o.s1 == null) o.s1 = Math.round(Math.min(tool.max, Math.max(minOf(p), F.V(p))) / 1e5) * 1e5;
  if (tool.fixed) o.s1 = tool.max;
  o.s1 = Math.max(minOf(p), Math.min(o.s1, tool.max));
  if (!o.yrs) o.yrs = Math.min(tool.yrs, rev.want?.yrs || 2);
  o.yrs = Math.max(tool.minYrs || 1, Math.min(o.yrs, tool.yrs));
  if (o.raise == null || o.raise > tool.raise) o.raise = tool.fixed ? 0 : Math.min(0.05, tool.raise);
  if (!o.opt || o.yrs === 1 || tool.fixed) o.opt = o.yrs === 1 || tool.fixed ? 'none' : (o.opt || 'none');
  return o;
}
function segBtns(name, opts, cur) {
  return `<div class="seg" role="radiogroup">${opts.map(([v, l, dis]) => `<button type="button" role="radio" aria-checked="${cur === v}" class="${cur === v ? 'on' : ''}" data-seg="${name}" data-v="${v}" ${dis ? 'disabled' : ''}>${l}</button>`).join('')}</div>`;
}
function strip(sal, years) {
  const s0 = +state.data.season.slice(0, 4);
  return `<div class="ystrip">${sal.map((v, i) => `<div><span>${s0 + i}-${String(s0 + i + 1).slice(2)}</span><b>${money(v, 1)}</b>${years?.[i]?.option ? `<em>${years[i].option === 'team_option' ? '팀 옵션' : '선수 옵션'}</em>` : ''}</div>`).join('')}</div>`;
}
function pips(tk) {
  if (!tk) return '';
  if (tk.closed) return '<span class="bad">결렬</span>';
  return `<span class="pips" aria-label="인내심 ${Math.max(0, tk.pat)} / ${tk.pat0}">${Array.from({ length: tk.pat0 }, (_, i) => `<i class="${i < tk.pat ? 'on' : ''}"></i>`).join('')}</span>`;
}
function fitBars(f, rev) {
  const known = !!rev.us, w = rev.prefs ? Object.fromEntries(rev.prefs) : null;
  const bar = (k, label, v) => `<div class="fb"><span>${label}${w ? ` <em>중요도 ${Math.round(w[k] * 100)}%</em>` : ''}</span><span class="pbar"><span style="width:${known ? Math.round(v * 100) : 0}%"></span></span><span class="small">${known ? (v >= 0.66 ? '좋게 봄' : v >= 0.4 ? '보통' : '아쉬움') : '?'}</span></div>`;
  return `${bar('win', '우승 전력', f.win)}${bar('role', '출전 시간', f.role)}${bar('loyal', '원소속팀 인연', f.loyal)}
    ${w ? `<div class="fb"><span>돈 <em>중요도 ${Math.round(w.money * 100)}%</em></span></div>` : ''}
    ${known ? '' : '<div class="muted small">"우리 팀은 어때요?"라고 물어보면 알 수 있어요.</div>'}`;
}
function chat(tk) {
  if (!tk) return '';
  return `<div class="chat" aria-live="polite">${tk.log.map((m) => bubble(m)).join('')}</div>`;
}
const bubble = (m) => `<div class="bubble ${m.who}">${m.who === 'agent' ? '<b>에이전트</b>' : m.who === 'me' ? '<b>우리</b>' : ''}${esc(m.text)}</div>`;

function bindRoom(main, p, tools) {
  const el = main.querySelector('#room'), me = state.save.team;
  el.querySelector('#snt')?.addEventListener('click', () => sntModal(main, p));
  el.querySelector('#renounce')?.addEventListener('click', () => notice(`${p.name}의 권리를 포기할까요?`, `캡 홀드 ${money(faHold(p), 1)}가 사라져 캡 공간이 늘어나요. 대신 버드 권리${F.isRFA(p) ? '와 RFA 권리(매칭)' : ''}가 없어져서, 다시 데려오려면 캡 공간이나 예외 조항을 써야 해요. 되돌릴 수 없어요.`, () => {
    offLog({ t: 'renounce', pid: p.player_id, team: me }); track('renounce', { pid: p.player_id, from: 'fa', hold: faHold(p) }); ui.offer = {};
    drawRoom(main); drawMarket(main); drawCap(main);
  }, { ok: '권리 포기', cancel: true }));
  bindStars(main, el);
  el.querySelectorAll('[data-tool]').forEach((b) => b.onclick = () => { ui.offer.tool = b.dataset.tool; drawRoom(main); });
  el.querySelectorAll('[data-adj]').forEach((b) => b.onclick = () => { ui.offer.s1 = Math.round((ui.offer.s1 + +b.dataset.adj) / 5e4) * 5e4; drawRoom(main); });
  const rg = el.querySelector('#s1');
  if (rg) { rg.oninput = () => { ui.offer.s1 = +rg.value; el.querySelector('.salary-row output').textContent = money(+rg.value, 2); }; rg.onchange = () => drawRoom(main); }
  el.querySelectorAll('[data-seg]').forEach((b) => b.onclick = () => { const k = b.dataset.seg, v = b.dataset.v; ui.offer[k] = k === 'opt' ? v : +v; drawRoom(main); });
  el.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => {
    const before = F.talk(p).log.length;
    const tk = F.question(p, b.dataset.q);
    track('fa_question', { pid: p.player_id, kind: b.dataset.q, pat: tk.pat, step: F.fa().step });
    reveal(main, p, before);
  });
  if (ui.chatFocus && !ui.busy) { ui.chatFocus = false; el.querySelector('#chat-text')?.focus(); }
  el.querySelector('#chatin')?.addEventListener('submit', (e) => { e.preventDefault(); const inp = el.querySelector('#chat-text'), text = inp.value.trim(); if (!text || ui.busy) return; chatSubmit(main, p, text, tools); });
  el.querySelector('#send')?.addEventListener('click', () => {
    const o = { ...ui.offer }, before = F.talk(p).log.length, a = F.ask(p);
    const res = F.propose(p, o);
    if (res.r === 'invalid') { notice('제안할 수 없어요', res.errors.join(' / ')); return; }
    track('fa_offer', { pid: p.player_id, tool: o.tool, s1: F.salaries(p, o)[0], yrs: o.yrs, raise: o.raise, opt: o.opt, v: Math.round(F.V(p)), ask: a, r: res.r, sc: Math.round((res.sc || 0) * 100) / 100, rival: Math.round((res.rival || 0) * 100) / 100, n: res.tk.n, step: F.fa().step, pat: res.tk.pat });
    reveal(main, p, before, res.r);
  });
  el.querySelector('#take-counter')?.addEventListener('click', () => { const c = F.talk(p).counter; Object.assign(ui.offer, c); track('fa_take_counter', { pid: p.player_id }); drawRoom(main); });
  el.querySelector('#withdraw')?.addEventListener('click', () => { F.withdraw(p); track('fa_withdraw', { pid: p.player_id }); drawRoom(main); drawMarket(main); });
}

// 채팅 입력 처리: 문장 → 제안 / 질문 / 설득 / 잡담
const MAXC = () => (state.data.league?.salary_cap || 1.2e8) * 0.35;
function chatSubmit(main, p, text, tools) {
  const tk = F.talk(p), before = tk.log.length, ps = F.persona(p), x = CH.parse(text);
  ui.chatFocus = true;
  const done = (r) => { track('fa_chat', { pid: p.player_id, kind: x.kind, q: x.q, topic: x.topic, patch: x.patch, r: r || null, len: text.length, step: F.fa().step }); reveal(main, p, before, r); };
  if (x.kind === 'question') { F.question(p, x.q, text); return done(); }
  if (x.kind === 'pitch') { F.pitch(p, x.topic, text); return done(); }
  if (x.kind === 'withdraw') { if (tk.standing) { F.chatLine(p, text); F.withdraw(p); } else F.chatLine(p, text, '거둬들일 제안이 없어요.'); drawMarket(main); return done(); }
  if (x.kind === 'hello') { F.chatLine(p, text, ps.style === 'tough' ? '인사는 됐고, 조건 얘기를 하죠.' : '반가워요! 어떤 조건을 생각하고 계세요?'); return done(); }
  if (x.kind === 'thanks') { F.chatLine(p, text, '저야말로요. 좋은 제안 기다릴게요.'); return done(); }
  if (x.kind !== 'offer') { F.chatLine(p, text, '무슨 말씀인지 잘 모르겠어요. 예를 들면 "3년 첫해 2천만 달러", "원하는 조건이 뭐예요?", "우리 팀에선 주전이에요"처럼 말씀해 주세요.'); return done(); }
  // 제안 만들기: 지금 계약서 상태에서 시작해 말한 부분만 바꿈
  const o = { ...offerState(p, tools) }, P = x.patch;
  if (x.take) { if (!tk.counter) { F.chatLine(p, text, '아직 저희가 드린 역제안이 없어요. 원하는 조건을 말씀해 주세요.'); return done(); } Object.assign(o, tk.counter); }
  if (x.asWant) { o.s1 = tk.rev?.want?.s1 || F.ask(p); o.yrs = ps.want; }
  if (P.tool) {
    const k = P.tool === 'mle' ? ['mle_nt', 'mle_tp', 'mle_room'].find((m) => tools.some((t) => t.k === m)) : tools.some((t) => t.k === P.tool) ? P.tool : null;
    if (!k) { F.chatLine(p, text, null); tk.log.push({ who: 'sys', text: `지금 우리 팀은 ${{ mle: 'MLE', two_way: '투웨이', ex10: '캠프 계약', min: '최저연봉', bae: '격년 예외', bird: '버드 권리', room: '캡 공간' }[P.tool]}을(를) 이 선수에게 쓸 수 없어요. 쓸 수 있는 수단: ${tools.map((t) => t.label).join(', ')}`, step: F.fa().step }); writeSave(); return done(); }
    o.tool = k; const tl = tools.find((t) => t.k === k); if (P.s1 == null && P.total == null) o.s1 = tl.max;
  }
  if (P.yrs) o.yrs = P.yrs;
  if (P.raise != null) o.raise = P.raise;
  if (P.opt) o.opt = P.opt;
  let s1 = P.s1, total = P.total;
  if (s1 != null && s1 > MAXC() && (o.yrs || 1) > 1) { total = s1; s1 = null; }   // 한 해 연봉으로 너무 크면 총액으로 봄
  if (total != null) { const k = Array.from({ length: o.yrs }, (_, i) => 1 + (o.raise || 0) * i).reduce((a, b) => a + b, 0); s1 = total / k; }
  if (s1 != null) {
    o.s1 = Math.round(s1 / 5e4) * 5e4;
    if (!P.tool) { const cur = tools.find((t) => t.k === o.tool); if (!cur || cur.fixed || o.s1 > cur.max) { const fit = tools.filter((t) => !t.fixed && t.max >= o.s1).sort((a, b) => a.max - b.max)[0]; if (fit) o.tool = fit.k; } }
  }
  const tl = tools.find((t) => t.k === o.tool);
  if (tl) {
    if (tl.fixed) o.s1 = tl.max;
    const big = tools.filter((t) => !t.fixed).sort((a, b) => b.max - a.max)[0];
    const bad = o.s1 > tl.max + 1 ? (big && big.max > tl.max + 1 && !P.tool ? `그 금액은 어떤 수단으로도 안 돼요. 우리 팀이 이 선수에게 줄 수 있는 최대는 ${big.label} ${money(big.max, 1)}이에요.` : `${tl.label} 한도는 ${money(tl.max, 1)}이에요.${big && big.max > tl.max + 1 ? ` (${big.label}(으)로는 ${money(big.max, 1)}까지 가능)` : ' 지금 우리 팀이 이 선수에게 줄 수 있는 최대 금액이에요.'}`) : o.s1 < minOf(p) - 1 ? `최저연봉(${money(minOf(p), 2)})보다 낮게는 줄 수 없어요.` : o.yrs > tl.yrs ? `${tl.label}(으)로는 최대 ${tl.yrs}년까지예요.` : '';
    if (bad) { F.chatLine(p, text, null); tk.log.push({ who: 'sys', text: bad, step: F.fa().step }); writeSave(); return done(); }
    if (o.raise > tl.raise) o.raise = tl.raise;
    if (o.yrs === 1) o.opt = 'none';
  }
  ui.offer = o;
  const res = F.propose(p, o, text);
  if (res.r === 'invalid') { tk.log.push({ who: 'sys', text: '제안할 수 없어요: ' + res.errors.join(' / '), step: F.fa().step }); writeSave(); }
  else track('fa_offer', { pid: p.player_id, tool: o.tool, s1: F.salaries(p, o)[0], yrs: o.yrs, raise: o.raise, opt: o.opt, v: Math.round(F.V(p)), ask: F.ask(p), r: res.r, sc: Math.round((res.sc || 0) * 100) / 100, via: 'chat' });
  done(res.r);
}

// 에이전트 답이 '입력 중…' 뒤에 한 줄씩 나타남 (몰입 연출)
function reveal(main, p, before, result) {
  const tk = F.talk(p), fresh = tk.log.slice(before);
  const mine = fresh.filter((m) => m.who === 'me'), rest = fresh.filter((m) => m.who !== 'me');
  ui.busy = true;
  const el = main.querySelector('#room .chat');
  if (!el) { ui.busy = false; drawRoom(main); return; }
  el.innerHTML = tk.log.slice(0, before).map(bubble).join('') + mine.map(bubble).join('');
  el.scrollTop = el.scrollHeight;
  main.querySelectorAll('#room [data-q], #room #send, #room #chat-text, #room #chatin button').forEach((b) => (b.disabled = true));
  let i = 0;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const next = () => {
    if (i >= rest.length) {
      ui.busy = false;
      if (result === 'accept') stamp(main, p);
      drawRoom(main); drawMarket(main); drawFeed(main); drawCap(main);
      return;
    }
    const typing = document.createElement('div'); typing.className = 'bubble agent typing'; typing.innerHTML = '<i></i><i></i><i></i>';
    el.append(typing); el.scrollTop = el.scrollHeight;
    setTimeout(() => { typing.remove(); el.insertAdjacentHTML('beforeend', bubble(rest[i])); el.scrollTop = el.scrollHeight; i++; next(); }, reduce ? 50 : rest[i].who === 'sys' ? 350 : 650 + Math.min(700, rest[i].text.length * 12));
  };
  next();
}
function stamp(main, p) {
  const st = F.curStep();
  const d = document.createElement('div'); d.className = 'deal-stamp';
  d.innerHTML = `<div><div class="line1">${st.moratorium ? '합의 완료' : '계약 완료'}</div><div class="who"><span>${esc(p.name)}</span></div><div class="line2">${esc(tn(state.save.team))}</div></div>`;
  document.body.append(d);
  setTimeout(() => d.remove(), 2100);
  d.onclick = () => d.remove();
}

// ── 속보 ──
// 소식: 기본은 '주요·우리 팀'만 (우리 팀·우리 FA·우리가 협상하던 선수·대형 계약·일정). 날짜별로 묶음
const KEY_NEWS = (n) => n.mine || n.watch || n.big || n.sys;
const newsTag = (n) => n.mine ? '<span class="ntag mine">우리 팀</span>' : n.watch ? '<span class="ntag watch">관심</span>' : n.big ? '<span class="ntag big">대형</span>' : n.rumor ? '<span class="ntag">소문</span>' : n.sys ? '<span class="ntag">일정</span>' : '';
function drawFeed(main) {
  const el = main.querySelector('#feed'); if (!el) return;
  const all = F.fa().news, list = (ui.feedAll ? all : all.filter(KEY_NEWS)).slice().reverse().slice(0, 120);
  const byDate = []; for (const n of list) { const g = byDate[byDate.length - 1]; if (g && g.d === n.date) g.items.push(n); else byDate.push({ d: n.date, items: [n] }); }
  el.innerHTML = `<div class="chips"><button class="chip ${ui.feedAll ? '' : 'on'}" data-fd="0">주요·우리 팀</button><button class="chip ${ui.feedAll ? 'on' : ''}" data-fd="1">전체 ${all.length}</button></div>
    ${byDate.length ? byDate.map((g) => `<div class="nday"><div class="nd">${md(g.d)}</div><ul class="nlist">${g.items.map((n) => `<li class="${n.mine ? 'mine' : ''}">${newsTag(n)}${esc(n.text.replace(/^소문: /, ''))}</li>`).join('')}</ul></div>`).join('')
      : '<p class="muted small">아직 주요 소식이 없어요.</p>'}`;
  el.querySelectorAll('[data-fd]').forEach((b) => b.onclick = () => { ui.feedAll = b.dataset.fd === '1'; drawFeed(main); });
}
function drawCap(main) {
  const el = main.querySelector('#fa-cap'); if (!el) return;
  const sh = capSheet(), t = teamBy(state.save.team), pay = teamPayroll(t, state.data.season), hc = F.hardCap(state.save.team);
  const std = t.roster.filter((q) => q.roster_role !== 'two_way').length, tw = t.roster.length - std;
  el.innerHTML = `<div class="capstrip">
    <div><div class="k">${term('salary_cap', '캡')} 기준 총액 (홀드 포함)</div><div class="v">${money(sh.total, 1)}</div></div>
    <div><div class="k">캡 여유</div><div class="v ${sh.room >= 0 ? 'good' : ''}">${sh.room >= 0 ? money(sh.room, 1) : '−' + money(-sh.room, 1)}</div></div>
    <div><div class="k">실제 총연봉</div><div class="v">${money(pay, 1)}</div></div>
    <div><div class="k">로스터</div><div class="v">${std}<span class="small"> + 투웨이 ${tw}</span></div></div>
    ${hc ? `<div><div class="k">하드캡</div><div class="v warn">${money(hc.amount, 1)}</div></div>` : ''}
    <span class="spacer"></span><a href="#/finance" class="small">캡 상황판 · 권리 포기</a></div>`;
}

// ── 시간 진행 ──
function advance(main, go) {
  if (F.pendingMySheets().length) return sheetModal(main, go);
  const all = F.steps(), st = F.curStep(), nx = all[st.i + 1];
  const standing = Object.values(F.fa().talks).filter((t) => t.standing).length;
  const stNames = Object.entries(F.fa().talks).filter(([, t]) => t.standing).map(([id]) => state.data.free_agents.find((q) => q.player_id === id)?.name).filter(Boolean);
  notice(nx ? `${F.dateKO(nx.date)} · ${nx.t}(으)로 넘어갑니다` : 'FA 시장을 마감합니다', nx
    ? `${nx.note} ${stNames.length ? `우리가 올려 둔 제안(${stNames.slice(0, 3).join(', ')}${stNames.length > 3 ? ` 외 ${stNames.length - 3}명` : ''})은 그사이 선수가 다른 제안과 비교해 결정해요.` : '올려 둔 제안이 없어요. 원하는 선수가 있다면 넘어가기 전에 제안을 올려 두세요.'}`
    : '마지막 날짜예요. 남은 RFA는 퀄리파잉 오퍼를 받아들이고, 로스터가 모자란 구단은 남은 선수와 최저연봉 계약을 해요.', () => {
    const n0 = F.fa().news.length, my0 = F.signedList().filter((e) => e.team === state.save.team).length;
    const before = Object.fromEntries(F.watch().map((pid) => [pid, F.watchStatus(pid)]));
    const res = F.advance();
    const finish = () => {
      SL.maybeRun();   // 라스베이거스 서머리그가 끝난 날짜면 신인 결과 (게임 속)
      const fresh = F.fa().news.slice(n0);
      track('fa_advance', { from: st.i, to: F.fa().step, done: !!res.done, standing, watch: F.watch().length, my_signed: F.signedList().filter((e) => e.team === state.save.team).length - my0, league_news: fresh.length });
      if (res.done) track('fa_complete', summary());
      overnight(fresh, nx, watchChanges(before), () => { dispatchEvent(new Event('phasechange')); renderFAView(main, go); });   // 날짜가 바뀌면 위 막대·메뉴(트레이드 제안 수)도 갱신
    };
    if (SL.needPlan()) planModal(finish); else finish();   // 서머리그 날짜: 우리 신인 기용 방법부터
  }, { ok: nx ? '진행' : '마감', cancel: true });
}
// 밤사이 소식: 우리 팀 → 관심 선수 → 대형 계약 순으로 한 줄씩. 나머지는 '그 밖의 계약 N건'으로 접어 둠
// 서머리그 기용 방법 고르기 (우리 신인마다)
export function planModal(done) {
  document.getElementById('slplan')?.remove();
  const rk = SL.ourRookies(), plan = Object.fromEntries(rk.map((p) => [p.prospect_id || p.player_id, 'normal']));
  const el = document.createElement('div'); el.id = 'slplan'; el.className = 'notice-bg';
  const draw = () => {
    el.innerHTML = `<div class="notice wide" role="dialog" aria-modal="true"><h2>서머리그가 열려요</h2>
      <p>라스베이거스 서머리그에서 우리 신인들이 첫 무대를 치러요. 어떻게 기용할까요? <span class="muted small">결과는 게임 속에서 만들어져요 (실제 기록 아님)</span></p>
      <div class="slplan">${rk.map((p) => { const id = p.prospect_id || p.player_id;
        return `<div class="slrow"><div><b>${esc(p.name)}</b> <span class="muted small">${esc(p.pos || '')} · ${p.rookie?.pick ? p.rookie.pick + '순위' : '미지명'}</span></div>
          <div class="seg">${Object.entries(SL.PLAN).map(([k, v]) => `<button class="${plan[id] === k ? 'on' : ''}" data-pid="${esc(id)}" data-plan="${k}" title="${esc(v.note)}">${v.ko}</button>`).join('')}</div>
          <div class="small muted">${esc(SL.PLAN[plan[id]].note)}</div></div>`; }).join('')}</div>
      <p><button class="go" id="sl-go">서머리그 시작</button></p></div>`;
    el.querySelectorAll('[data-plan]').forEach((b) => b.onclick = () => { plan[b.dataset.pid] = b.dataset.plan; draw(); });
    el.querySelector('#sl-go').onclick = () => { SL.setPlan(plan); track('summer_plan', { plan }); el.remove(); done(); };
  };
  document.body.append(el); draw();
}
// 관심 선수 변화: 넘어가기 전과 비교
function watchChanges(before) {
  const out = [];
  for (const [pid, b] of Object.entries(before)) {
    const a = F.watchStatus(pid); if (!a || !b) continue; const nm = a.p.name;
    if (a.phase === 'ours' && b.phase !== 'ours') out.push({ good: true, text: `${nm}: 우리와 ${F.fa().step <= 2 ? '합의' : '계약'}! (${a.e.years.length}년 ${money(a.e.years.reduce((x, y) => x + y.salary, 0), 1)})` });
    else if (a.phase === 'gone' && b.phase !== 'gone') out.push({ bad: true, text: `${nm}: ${tn(a.e.team)}와 계약 (${a.e.years.length}년 ${money(a.e.years.reduce((x, y) => x + y.salary, 0), 1)}) · 놓쳤어요` });
    else if (a.phase === 'sheet' && b.phase !== 'sheet') out.push({ text: `${nm}: 오퍼시트를 받았어요` });
    else if (!['ours', 'gone'].includes(a.phase)) {
      const bits = [];
      if (a.n !== b.n) bits.push(`소문으로는 다른 구단 제안 ${b.n}→${a.n}개`);
      if (b.standing && !a.standing && a.phase !== 'ours') bits.push('우리 제안은 받아들여지지 않았어요');
      out.push({ text: `${nm}: ${bits.length ? bits.join(' · ') : '변화 없음 · 아직 시장에 있어요'}`, warn: a.n > b.n });
    }
  }
  return out;
}
function overnight(items, nx, changes, done) {
  document.getElementById('overnight')?.remove();
  const el = document.createElement('div'); el.id = 'overnight'; el.className = 'notice-bg';
  const rank = (n) => (n.mine ? 0 : n.watch ? 1 : n.big ? 2 : n.sys ? 3 : 4);
  const key = items.filter(KEY_NEWS).sort((a, b) => rank(a) - rank(b)), rest = items.filter((n) => !KEY_NEWS(n));
  const mineN = items.filter((n) => n.mine).length;
  el.innerHTML = `<div class="notice wide" role="dialog" aria-modal="true"><h2>${nx ? `${F.dateKO(nx.date)} · ${esc(nx.t)}` : 'FA 마감'}</h2>
    ${changes.length ? `<div class="wchg"><div class="k">관심 선수</div><ul>${changes.map((c) => `<li class="${c.good ? 'good' : c.bad ? 'bad' : c.warn ? 'warn' : ''}">${esc(c.text)}</li>`).join('')}</ul></div>` : F.watch().length ? '' : '<p class="small muted">관심 선수를 정해 두면 여기서 그 선수들 소식부터 보여 드려요.</p>'}
    <p class="muted small">그사이 계약·소식 ${items.length}건 · 우리 팀 관련 ${mineN}건</p>
    <ol class="ticker night"></ol>
    ${rest.length ? `<details class="small"><summary>그 밖의 소식 ${rest.length}건</summary><ul class="nlist">${rest.map((n) => `<li>${esc(n.text)}</li>`).join('')}</ul></details>` : ''}
    <p><button class="go" id="night-ok">계속</button></p></div>`;
  document.body.append(el);
  const ol = el.querySelector('ol'), reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let i = 0, timer = null;
  const add = () => { if (i >= key.length) return; const n = key[i++]; ol.insertAdjacentHTML('beforeend', `<li class="${n.mine ? 'mine' : ''} ${n.big ? 'big' : ''}">${newsTag(n)}${esc(n.text)}</li>`); ol.scrollTop = ol.scrollHeight; timer = setTimeout(add, reduce ? 0 : n.mine ? 600 : 300); };
  if (!key.length) ol.innerHTML = `<li class="muted">${rest.length ? '우리 팀과 관심 선수 쪽은 조용했어요.' : '조용한 하루였어요.'}</li>`;
  add();
  el.querySelector('#night-ok').onclick = () => { clearTimeout(timer); el.remove(); done(); };
  el.querySelector('#night-ok').focus();
}
function summary() {
  const me = state.save.team, mine = F.signedList().filter((e) => e.team === me);
  return { signed: mine.map((e) => ({ pid: e.pid, tool: e.tool, how: e.how, yrs: e.years.length, s1: e.years[0]?.salary })), room: Math.round(capSheet().room), talks: Object.keys(F.fa().talks).length, closed: Object.values(F.fa().talks).filter((t) => t.closed).length };
}

// ── 오퍼시트 매칭 결정 (우리 RFA) ──
function sheetModal(main, go) {
  const s = F.pendingMySheets()[0]; if (!s) return;
  const p = state.data.free_agents.find((x) => x.player_id === s.pid);
  const sal = F.salaries(p, s.offer), t = teamBy(state.save.team), pay = teamPayroll(t, state.data.season), L = state.data.league;
  document.getElementById('sheetm')?.remove();
  const el = document.createElement('div'); el.id = 'sheetm'; el.className = 'notice-bg';
  el.innerHTML = `<div class="notice wide" role="dialog" aria-modal="true">
    <div class="small muted">${term('offer_sheet', '오퍼시트')} 도착 · ${s.hours}시간 안에 결정</div>
    <h2>${esc(tn(s.from))}가 ${esc(p.name)}에게 오퍼시트를 냈어요</h2>
    ${strip(sal)}<p>총액 <b>${money(sal.reduce((a, b) => a + b, 0), 1)}</b> · 예상 시장 가치 ${money(F.V(p), 1)}</p>
    <p class="small">매칭하면 같은 조건으로 붙잡아요 (캡을 넘어도 가능). 그러면 실제 총연봉이 ${money(pay, 1)} → <b>${money(pay + sal[0], 1)}</b>${pay + sal[0] > L.tax_level ? ' <span class="warn">(사치세 기준선 초과)</span>' : ''}가 돼요. 포기하면 선수는 ${esc(tn(s.from))}로 가요.</p>
    <p><button class="go" id="sm-match">매칭해서 붙잡기</button> <button class="go ghost" id="sm-let">보내기</button></p></div>`;
  document.body.append(el);
  const fin = (match) => { el.remove(); F.decideSheet(s, match); track('fa_sheet_decision', { pid: p.player_id, match, s1: sal[0], yrs: sal.length, v: Math.round(F.V(p)) }); writeSave(); renderFAView(main, go); };
  el.querySelector('#sm-match').onclick = () => fin(true);
  el.querySelector('#sm-let').onclick = () => fin(false);
}

// ── 마감 ──
function doneView(main, go) {
  const me = state.save.team, mine = F.signedList().filter((e) => e.team === me);
  const pl = (e) => teamBy(e.team)?.roster.find((q) => q.player_id === e.pid);
  const top = F.signedList().map((e) => ({ e, p: pl(e) })).filter((x) => x.p).sort((a, b) => b.e.years.reduce((s, y) => s + y.salary, 0) - a.e.years.reduce((s, y) => s + y.salary, 0)).slice(0, 12);
  const sh = capSheet();
  main.innerHTML = `<h1>FA 결과</h1><p class="sub">${state.save.year}년 FA 시장이 마감됐어요.</p>
    <div class="grid2">
      <div class="panel"><h2>우리 팀 계약</h2><div class="body">${mine.length ? `<ul class="news">${mine.map((e) => { const p = pl(e); return `<li><b>${esc(p?.name || e.pid)}</b> · ${e.how === 'qo' ? 'QO 수락' : e.how === 'match' ? '매칭' : F.TOOL_KO[e.tool]} · ${e.years.length}년 ${money(e.years.reduce((s, y) => s + y.salary, 0), 1)}</li>`; }).join('')}</ul>` : '<p class="muted">이번 FA에서 계약한 선수가 없어요.</p>'}
        ${(() => { const lost = F.signedList().filter((e) => e.team !== me && pl(e)?.contract?.prev_team === me); return lost.length ? `<h3 class="small">떠난 우리 FA</h3><ul class="news">${lost.map((e) => `<li>${esc(pl(e).name)} → ${esc(tn(e.team))} · ${e.years.length}년 ${money(e.years.reduce((s, y) => s + y.salary, 0), 1)}</li>`).join('')}</ul>` : ''; })()}
        <p class="small">남은 캡 여유 ${sh.room >= 0 ? money(sh.room, 1) : '없음'} · 로스터 ${teamBy(me).roster.length}명</p></div></div>
      <div class="panel"><h2>리그 큰 계약 (게임 속 결과)</h2><div class="body"><ul class="news">${top.map(({ e, p }) => `<li>${esc(e.team)} · ${esc(p.name)} ${e.years.length}년 ${money(e.years.reduce((s, y) => s + y.salary, 0), 1)}${p.contract.prev_team && p.contract.prev_team !== e.team ? ` <span class="muted">(${esc(p.contract.prev_team)}에서)</span>` : ''}</li>`).join('')}</ul></div></div>
    </div>
    <div class="panel"><h2>속보 전체</h2><div class="body" id="feed"></div></div>`;
  drawFeed(main);
}

// FA 마감 뒤: 결과 요약(접기) + 남은 선수와 계속 협상 (시간 진행 없음)
function afterView(main, go) {
  const ph = state.save.phase;
  main.innerHTML = `<div class="row-between"><div><h1>남은 FA</h1><p class="sub">FA 시장은 마감됐지만 남은 선수와는 계속 계약할 수 있어요. 최저연봉급 선수는 ${term('exhibit10', '캠프 계약')}(비보장)도 돼요.</p></div>
    ${ph === 'roster' ? '<a class="go" href="#/cuts">로스터 정리로</a>' : ''}</div>
    <details class="panel fa-result"><summary>FA 결과 보기</summary><div class="body" id="fa-res"></div></details>
    <div class="fa-grid">
      <section class="panel market"><h2>남은 선수</h2><div class="body" id="mk"></div></section>
      <section class="room" id="room"></section>
      <aside class="panel feed"><h2>속보 <span class="muted small">게임 속 소식</span></h2><div class="body" id="feed"></div></aside>
    </div><div id="fa-cap"></div>`;
  if (ui.filter === 'mine' && !F.marketRows().some((r) => !r.signed && r.p.contract?.rights_team === state.save.team)) ui.filter = 'all';
  const tmp = document.createElement('div'); doneView(tmp, go);
  main.querySelector('#fa-res').innerHTML = tmp.querySelector('.grid2')?.outerHTML || '';
  if (ph !== 'roster') main.querySelectorAll('#room').forEach((x) => (x.innerHTML = '<div class="panel"><div class="body muted">개막 로스터가 확정돼서 더 계약할 수 없어요.</div></div>'));
  drawMarket(main); if (ph === 'roster') drawRoom(main); drawFeed(main); drawCap(main);
}

// 사인 앤 트레이드: 우리 FA를 재계약시켜 다른 팀으로 보내고 대가 받기
function sntModal(main, p) {
  const opts = SNT.options(p);
  track('snt_view', { pid: p.player_id, n: opts.length, teams: opts.map((d) => d.ai) });
  document.getElementById('sntm')?.remove();
  const el = document.createElement('div'); el.id = 'sntm'; el.className = 'notice-bg';
  el.innerHTML = `<div class="notice wide" role="dialog" aria-modal="true"><div class="small muted">${term('snt', '사인 앤 트레이드')} · ${esc(p.name)}</div>
    <h2>${opts.length ? '이 선수를 원하는 팀과 조건이에요' : '지금은 성사될 만한 사인 앤 트레이드가 없어요'}</h2>
    ${opts.length ? opts.map((d, i) => `<div class="offer"><b>${esc(teamBy(d.ai).name)}</b> <span class="muted small">${d.direct ? '캡 공간으로도 데려올 수 있어서 대가가 작아요' : '사인 앤 트레이드로만 데려올 수 있어요'}</span>
        <div class="small">계약: ${d.o.yrs}년 · 첫해 ${money(d.sal[0], 1)} · 총 ${money(d.sal.reduce((a, b) => a + b, 0), 1)} (해마다 5% 인상)</div>
        <div class="small">우리가 받는 것: ${[...d.fillers.map((q) => `${esc(q.name)} (${money(q.contract.years.find((y) => y.season === state.data.season)?.salary, 1)})`), ...d.picks.map((a) => esc(plainLabel(a)))].join(', ') || '없음'}</div>
        <p><button class="go small" data-snt="${i}">이 조건으로 진행</button></p></div>`).join('')
      : '<p class="muted small">선수가 원하는 팀이 없거나, 상대 팀이 에이프런·연봉 맞추기 규정에 막혀요. 받는 팀은 트레이드 뒤 에이프런 아래여야 하고 그해 하드캡이 걸려요.</p>'}
    <p class="muted small">계약은 3~4년, 선수가 그 팀으로 가는 데 동의해야 해요. 진행하면 되돌릴 수 없어요.</p>
    <p><button class="go ghost" id="snt-close">닫기</button></p></div>`;
  document.body.append(el);
  el.querySelector('#snt-close').onclick = () => el.remove();
  el.querySelectorAll('[data-snt]').forEach((b) => b.onclick = () => {
    const d = opts[+b.dataset.snt];
    SNT.execute(p, d);
    track('snt_done', { pid: p.player_id, partner: d.ai, yrs: d.o.yrs, s1: d.sal[0], got_players: d.fillers.map((q) => q.player_id), got_picks: d.picks.map((a) => a.key) });
    el.remove(); ui.sel = null; renderFAView(main);
  });
}
