// 로스터 정리 화면: 개막 전날까지 정규 14~15명·투웨이 한도 맞추기
// 위 = 개막 시계 / 왼쪽 = 정규·투웨이·캠프 계약 목록(방출·전환) / 오른쪽 = 뎁스 차트, 캠프 초청 후보, 소식
import { esc, money } from '../util.js';
import { state, teamBy } from '../store.js';
import { track } from '../analytics.js';
import { term } from '../glossary.js';
import { notice } from '../ui.js';
import * as RO from '../roster.js';
import * as F from '../fa.js';
import { capSheet } from '../capsheet.js';
import { teamPayroll } from '../rules.js';

const S = () => state.data.season;
const ui = { stretch: false };
const sum = (a) => a.reduce((x, y) => x + y, 0);
const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
const POS = (p) => esc(p.pos || '');
function openingDay() {
  const c = state.cal?.[String(state.save.year)]?.regular_season_start, v = c?.value;
  const d = typeof v === 'string' ? v.slice(0, 10) : v?.date;
  return d ? { d, est: !!c.estimated } : null;
}

export function renderCuts(main, go) {
  const ph = state.save.phase;
  if (!['roster', 'preseason'].includes(ph)) { main.innerHTML = '<h1>로스터 정리</h1><p class="sub">FA 시장이 끝난 뒤에 열려요.</p>'; return; }
  if (ph === 'preseason') return doneView(main);
  const c = RO.counts(), od = openingDay(), errs = RO.readyErrors(), t = teamBy(state.save.team);
  const okStd = c.std >= RO.STD_MIN() && c.std <= RO.STD_MAX(), okTw = c.tw <= RO.twMax();
  main.innerHTML = `
  <div class="stage cut-stage"><div class="stage-grid">
    <div class="bignum">${c.std}<span class="of">/${RO.STD_MAX()}</span><small>정규 계약 (최소 ${RO.STD_MIN()}명)</small></div>
    <div><h2>개막 로스터 정하기</h2>
      <p>${od ? `${state.save.year}-${String(state.save.year + 1).slice(2)} 시즌 개막 ${md(od.d)}${od.est ? ' (추정)' : ''} 전날까지` : '개막 전날까지'} 정규 계약 ${RO.STD_MAX()}명 이하, 투웨이 ${RO.twMax()}명 이하로 맞춰야 해요.</p>
      <div class="cut-chips"><span class="${okStd ? 'ok' : 'no'}">정규 ${c.std}</span><span class="${okTw ? 'ok' : 'no'}">${term('two_way', '투웨이')} ${c.tw}/${RO.twMax()}</span><span>${term('exhibit10', '캠프 계약')} ${c.ex10}/${RO.EX10_MAX()}</span><span>전체 ${c.all}/21</span></div></div>
    <div class="clock-side"><button class="go" id="cut-final" ${errs.length ? 'disabled' : ''}>개막 로스터 확정</button>
      <div class="small">${errs.length ? esc(errs[0]) : '조건을 모두 맞췄어요'}</div></div>
  </div></div>
  <div class="cut-grid">
    <div>
      <div class="panel"><h2>정규 계약 <span class="muted small">방출하면 남은 ${term('guaranteed', '보장 금액')}이 데드머니로 남아요</span></h2><div class="body scroll">${table(RO.stdOf(t), 'std')}</div></div>
      <div class="panel"><h2>투웨이</h2><div class="body scroll">${RO.twOf(t).length ? table(RO.twOf(t), 'tw') : '<p class="muted small">투웨이 선수가 없어요.</p>'}</div></div>
    </div>
    <div class="side-col">
      <div class="panel"><h2>뎁스 차트 <span class="muted small">선발 5명 + 벤치 순서</span></h2><div class="body" id="depth"></div></div>
      <div class="panel"><h2>캠프 초청 후보 <span class="muted small">남은 FA</span></h2><div class="body" id="camp"></div></div>
      <div class="panel"><h2>소식</h2><div class="body" id="cut-news"></div></div>
    </div>
  </div>
  <div id="cut-cap"></div>`;
  drawDepth(main); drawCamp(main); drawNews(main); drawCap(main);
  bind(main, go);
}

function tags(p) {
  const out = [], y = (p.contract?.years || []).find((x) => x.season === S()), g = RO.guaranteedLeft(p).find((x) => x.season === S());
  if (RO.isEx10(p)) out.push('<span class="tag warn">캠프 계약</span>');
  else if (y && g && g.amount === 0 && !RO.isTW(p)) out.push('<span class="tag warn">비보장</span>');
  else if (y && g && g.amount < (y.salary || 0) && !RO.isTW(p)) out.push(`<span class="tag warn">부분 보장 ${money(g.amount, 2)}</span>`);
  if (p.rookie) out.push(`<span class="tag">신인 ${p.rookie.pick}순위</span>`);
  if (p.contract?.signed_with) out.push('<span class="tag team">새 계약</span>');
  if ((p.contract?.years || []).some((x) => x.option === 'player_option' && x.season > S())) out.push('<span class="tag">선수 옵션</span>');
  return out.join(' ');
}
function table(list, kind) {
  const rows = list.slice().sort((a, b) => (b.contract?.years?.find((y) => y.season === S())?.salary || 0) - (a.contract?.years?.find((y) => y.season === S())?.salary || 0));
  return `<table class="t cut-t"><thead><tr><th>선수</th><th class="n">가치</th><th class="n">${esc(S())} 연봉</th><th class="n">남은 보장</th><th class="n">계약</th><th></th></tr></thead><tbody>
  ${rows.map((p) => {
    const y = (p.contract?.years || []).find((x) => x.season === S()), left = sum(RO.guaranteedLeft(p).map((x) => x.amount));
    const yrs = (p.contract?.years || []).filter((x) => x.season >= S()).length;
    const acts = kind === 'tw'
      ? `<button class="go small ghost" data-std="${esc(p.player_id)}" ${RO.canToStandard(p) ? `disabled title="${esc(RO.canToStandard(p))}"` : ''}>정규 전환</button> <button class="go small ghost" data-waive="${esc(p.player_id)}">방출</button>`
      : `${RO.isEx10(p) ? `<button class="go small ghost" data-tw="${esc(p.player_id)}" ${RO.canToTwoWay(p) ? `disabled title="${esc(RO.canToTwoWay(p))}"` : ''}>투웨이 전환</button> ` : ''}<button class="go small ghost" data-waive="${esc(p.player_id)}">방출</button>`;
    return `<tr><td><a href="#" data-open="player:${esc(p.player_id)}" class="nm">${esc(p.name)}</a> <span class="muted small">${POS(p)} · ${p.age ?? '?'}세</span><div>${tags(p)}</div></td>
      <td class="n">${money(F.V(p), 1)}</td><td class="n">${money(y?.salary, 2)}</td><td class="n">${kind === 'tw' ? '<span class="muted">캡 밖</span>' : left ? money(left, 1) : '<span class="good">0</span>'}</td><td class="n">${yrs}년</td><td class="acts-cell">${acts}</td></tr>`;
  }).join('')}</tbody></table>`;
}

function drawDepth(main) {
  const el = main.querySelector('#depth'), list = RO.depth(), w = RO.depthWarnings(list);
  el.innerHTML = `<ol class="depth">${list.map((p, i) => `${i === 5 ? '<li class="sep">벤치</li>' : ''}<li class="${i < 5 ? 'st' : ''}"><span class="no">${i + 1}</span><span class="dn">${esc(p.name)} <span class="muted small">${POS(p)}</span></span>
    <span class="mv"><button data-dm="${esc(p.player_id)}:-1" ${i === 0 ? 'disabled' : ''} aria-label="위로">▲</button><button data-dm="${esc(p.player_id)}:1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="아래로">▼</button></span></li>`).join('')}</ol>
    ${w.length ? `<ul class="warns">${w.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}<p class="muted small">뎁스 차트는 다음 단계(시즌 전망)의 출전 시간 계산에 쓰여요.</p>`;
  el.querySelectorAll('[data-dm]').forEach((b) => b.onclick = () => { const [pid, d] = b.dataset.dm.split(':'); RO.moveDepth(pid, +d); track('cut_depth_move', { pid, dir: +d }); drawDepth(main); });
}
function drawCamp(main) {
  const el = main.querySelector('#camp');
  const list = RO.campCandidates().slice(0, 14);
  el.innerHTML = `<p class="muted small">${term('exhibit10', '캠프 계약')}: 1년 최저연봉 비보장. 개막 전에 방출하면 보너스 정도만 남고, 투웨이로 바꿀 수도 있어요. 더 좋은 선수는 <a href="#/fa">FA 협상</a>에서 보장 계약으로.</p>
    <ul class="camp">${list.map((p) => { const e = RO.campError(p); return `<li><span><a href="#" data-open="player:${esc(p.player_id)}">${esc(p.name)}</a> <span class="muted small">${POS(p)} · ${p.age ?? '?'}세 · ${money(F.V(p), 1)}</span></span>
      ${e && e.includes('FA 협상') ? '<a class="small" href="#/fa">FA 협상</a>' : `<button class="go small ghost" data-camp="${esc(p.player_id)}" ${e ? `disabled title="${esc(e)}"` : ''}>캠프 계약</button>`}</li>`; }).join('')}</ul>`;
}
function drawNews(main) {
  const el = main.querySelector('#cut-news'), n = RO.ro().news.slice().reverse().slice(0, 30);
  el.innerHTML = n.length ? `<ol class="ticker">${n.map((x) => `<li class="${x.mine ? 'mine' : ''} ${x.big ? 'big' : ''}">${esc(x.text)}</li>`).join('')}</ol>` : '<p class="muted small">아직 소식이 없어요.</p>';
}
function drawCap(main) {
  const sh = capSheet(), t = teamBy(state.save.team), pay = teamPayroll(t, S()), hc = F.hardCap(state.save.team), L = state.data.league;
  main.querySelector('#cut-cap').innerHTML = `<div class="capstrip">
    <div><div class="k">실제 총연봉 (데드머니 포함)</div><div class="v">${money(pay, 1)}</div></div>
    <div><div class="k">데드머니</div><div class="v">${money(sh.parts.dead, 1)}</div></div>
    <div><div class="k">${term('tax_level', '사치세 기준선')}까지</div><div class="v ${pay < L.tax_level ? 'good' : 'warn'}">${pay < L.tax_level ? money(L.tax_level - pay, 1) : '−' + money(pay - L.tax_level, 1)}</div></div>
    ${hc ? `<div><div class="k">하드캡까지</div><div class="v warn">${money(hc.amount - pay, 1)}</div></div>` : ''}
    <span class="spacer"></span><a href="#/finance" class="small">캡 상황판</a></div>`;
}

function bind(main, go) {
  const find = (pid) => teamBy(state.save.team).roster.find((p) => p.player_id === pid);
  main.querySelectorAll('[data-waive]').forEach((b) => b.onclick = () => waiveModal(main, go, find(b.dataset.waive)));
  main.querySelectorAll('[data-std]').forEach((b) => b.onclick = () => { const p = find(b.dataset.std); notice(`${p.name}을 정규 계약으로 바꿀까요?`, `1년 최저연봉(${money(state.data.league.minimum[Math.min(F.svcOf(p), 10)], 2)}) 정규 계약이 되고 캡에 들어가요. 정규 로스터 한 자리를 차지해요.`, () => { const r = RO.toStandard(p); track('cut_convert', { pid: p.player_id, to: 'standard', ok: !r.err }); renderCuts(main, go); }, { ok: '전환', cancel: true }); });
  main.querySelectorAll('[data-tw]').forEach((b) => b.onclick = () => { const p = find(b.dataset.tw); const r = RO.toTwoWay(p); track('cut_convert', { pid: p.player_id, to: 'two_way', ok: !r.err }); if (r.err) notice('전환할 수 없어요', r.err); renderCuts(main, go); });
  main.querySelectorAll('[data-camp]').forEach((b) => b.onclick = () => { const p = state.data.free_agents.find((x) => x.player_id === b.dataset.camp); const r = RO.signCamp(p); track('cut_camp', { pid: p.player_id, v: Math.round(F.V(p)), ok: !r.err }); if (r.err) notice('계약할 수 없어요', r.err); renderCuts(main, go); });
  main.querySelector('#cut-final').onclick = () => {
    const c = RO.counts(), dead = capSheet().parts.dead;
    notice('개막 로스터를 확정할까요?', `정규 ${c.std}명 · 투웨이 ${c.tw}명으로 시즌을 시작해요. 다른 29개 구단도 로스터를 정리해요. 확정한 뒤에는 이번 오프시즌 계약·방출을 되돌릴 수 없어요.`, () => {
      const r = RO.finalize();
      if (r.errors) { notice('아직 확정할 수 없어요', r.errors.join(' / ')); return; }
      track('cut_finalize', { std: c.std, tw: c.tw, dead: Math.round(dead), payroll: Math.round(teamPayroll(teamBy(state.save.team), S())), depth: RO.ro().depth?.slice(0, 5) });
      dispatchEvent(new Event('phasechange')); renderCuts(main, go);
    }, { ok: '확정', cancel: true });
  };
}

// 방출 창: 일반 방출 vs 스트레치, 시즌별 데드머니와 캡 영향
function waiveModal(main, go, p) {
  ui.stretch = false;
  const draw = () => {
    const pv = RO.preview(p, ui.stretch), y = (p.contract?.years || []).find((x) => x.season === S());
    const sh = capSheet(), saveNow = (y?.cap_hit ?? y?.salary ?? 0) - (pv.dead.find((x) => x.season === S())?.amount || 0);
    const tw = RO.isTW(p);
    el.innerHTML = `<div class="notice wide" role="dialog" aria-modal="true">
      <div class="small muted">방출 · 웨이버 48시간</div><h2>${esc(p.name)}을 방출할까요?</h2>
      ${!tw && pv.canStretch ? `<div class="seg" role="radiogroup"><button class="${!ui.stretch ? 'on' : ''}" data-st="0">일반 방출</button><button class="${ui.stretch ? 'on' : ''}" data-st="1">${term('stretch', '스트레치')}</button></div>` : ''}
      ${tw ? '<p>투웨이 계약은 캡에 들어가지 않아서 캡 부담이 없어요.</p>' : pv.dead.length ? `<div class="ystrip">${pv.dead.map((d) => `<div><span>${esc(d.season)}</span><b>${money(d.amount, 2)}</b></div>`).join('')}</div>
        <p class="small">데드머니 총 <b>${money(sum(pv.dead.map((d) => d.amount)), 1)}</b>${pv.bonus ? ` (캠프 계약 보너스 ${money(pv.bonus, 2)} 포함)` : ''}${ui.stretch ? ` · 다음 시즌부터 ${pv.stretchYears}년 동안 해마다 ${money(pv.per, 2)}` : ''}</p>` : '<p class="good">남은 보장 금액이 없어서 데드머니가 생기지 않아요.</p>'}
      ${!tw ? `<p class="small">이번 시즌 캡에서 <b>${saveNow >= 0 ? money(saveNow, 1) + ' 줄어요' : money(-saveNow, 1) + ' 늘어요'}</b> (캡 여유 ${money(sh.room, 1)} → ${money(sh.room + saveNow, 1)})</p>` : ''}
      ${pv.err ? `<p class="bad small">${esc(pv.err)}</p>` : ''}
      <p class="muted small">48시간 동안 다른 구단이 웨이버로 데려갈(클레임) 수 있어요. 클레임되면 그 팀이 계약을 넘겨받아 우리 데드머니가 없어져요. 방출한 선수는 같은 계약 기간 동안 다시 데려오기 어려워요.</p>
      <p><button class="go" id="wv-ok" ${pv.err ? 'disabled' : ''}>방출</button> <button class="go ghost" id="wv-no">취소</button></p></div>`;
    el.querySelectorAll('[data-st]').forEach((b) => b.onclick = () => { ui.stretch = b.dataset.st === '1'; draw(); });
    el.querySelector('#wv-no').onclick = () => el.remove();
    el.querySelector('#wv-ok').onclick = () => {
      const r = RO.waive(p, ui.stretch);
      el.remove();
      track('cut_waive', { pid: p.player_id, stretch: ui.stretch, cur: pv.cur, total: pv.total, v: Math.round(F.V(p)), claim: r.claim || null, two_way: tw });
      if (r.err) return notice('방출할 수 없어요', r.err);
      if (r.claim) notice('웨이버 클레임!', `${teamBy(r.claim).name}이 ${p.name}을 클레임했어요. 계약을 그쪽이 넘겨받아서 우리 팀 데드머니는 없어요.`);
      renderCuts(main, go);
    };
  };
  document.getElementById('wvm')?.remove();
  const el = document.createElement('div'); el.id = 'wvm'; el.className = 'notice-bg';
  document.body.append(el); draw();
}

function doneView(main) {
  const t = teamBy(state.save.team), list = RO.depth(), tw = RO.twOf(t), pay = teamPayroll(t, S());
  const n = RO.ro().news.filter((x) => !x.mine && !x.sys);
  main.innerHTML = `<h1>개막 로스터</h1><div class="row-between"><p class="sub">로스터 정리가 끝났어요.</p><a class="go" href="#/outlook">시즌 전망·오프시즌 성적표 보기</a></div>
    <div class="grid2">
      <div class="panel"><h2>우리 팀 (뎁스 순서)</h2><div class="body"><ol class="depth done">${list.map((p, i) => `${i === 5 ? '<li class="sep">벤치</li>' : ''}<li class="${i < 5 ? 'st' : ''}"><span class="no">${i + 1}</span><span class="dn">${esc(p.name)} <span class="muted small">${POS(p)} · ${money(F.V(p), 1)}</span></span></li>`).join('')}</ol>
        ${tw.length ? `<p class="small">투웨이: ${tw.map((p) => esc(p.name)).join(', ')}</p>` : ''}<p class="small">총연봉 ${money(pay, 1)} · 데드머니 ${money(capSheet().parts.dead, 1)}</p></div></div>
      <div class="panel"><h2>리그 로스터 정리 소식 (게임 속 결과)</h2><div class="body"><ol class="ticker">${n.slice(-40).reverse().map((x) => `<li class="${x.big ? 'big' : ''}">${esc(x.text)}</li>`).join('') || '<li class="muted">소식 없음</li>'}</ol></div></div>
    </div>`;
}
