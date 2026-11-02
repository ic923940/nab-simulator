// 선수 트레이드 화면: 우리 선수·미래 지명권 ↔ 상대 선수·미래 지명권
// 아래 요약: 양쪽 연봉 맞추기 결과, 총연봉·사치세 변화, 우리 예상 승수 변화
import { esc, money, num } from '../util.js';
import { capBug } from './capbug.js';
import { state, teamBy } from '../store.js';
import { track } from '../analytics.js';
import { term, tip } from '../glossary.js';
import { gmProfile } from '../ai.js';
import * as PT from '../ptrade.js';
import * as F from '../fa.js';
import { assetsOf, assetLabel, baseValue, plainLabel } from '../picks.js';
import { bpmOf, teamRating, autoDepth } from '../strength.js';

const S = () => state.data.season;
const ui = { partner: null, gp: new Set(), rp: new Set(), gk: new Set(), rk: new Set(), reply: null };
const sal = (p) => { const y = (p.contract?.years || []).find((x) => x.season === S()); return y ? (y.cap_hit ?? y.salary ?? 0) : 0; };
const yrsLeft = (p) => (p.contract?.years || []).filter((y) => y.season >= S()).length;
const sign = (v, d = 1) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(d);

export function renderPTrade(main) {
  if (!PT.windowOpen()) {
    main.innerHTML = `<h1>선수 트레이드</h1><p class="sub">${state.save.phase === 'preseason' ? '개막 로스터가 확정돼서 오프시즌 트레이드는 끝났어요.' : '선수 트레이드는 FA 모라토리엄이 끝난 뒤(7월 6일 무렵)부터 개막 로스터 확정 전까지 할 수 있어요.'}</p>${logHTML()}`;
    return;
  }
  const me = state.save.team, teams = state.data.teams.filter((t) => t.abbr !== me).sort((a, b) => a.name.localeCompare(b.name));
  PT.dayOffers();
  const sel = pick();
  const res = ui.partner && (sel.givePlayers.length || sel.getPlayers.length || sel.givePicks.length || sel.getPicks.length) ? PT.evaluate(ui.partner, sel) : null;
  main.innerHTML = `<h1>선수 트레이드</h1>
    <p class="sub">선수와 미래 지명권을 섞어서 거래할 수 있어요. ${term('salary_matching', '연봉 맞추기')} 규정과 하드캡·로스터 한도를 양쪽 팀 모두 지켜야 해요. 이번 오프시즌에 계약한 선수는 12월 15일 전에는 보낼 수 없어요.</p>
    ${capBug()}
    ${inboxHTML()}
    <div class="grid2 pt-cols">
      <div class="panel stick"><h2>우리 팀</h2><div class="body">${side(me, ui.gp, ui.gk, 'g')}</div></div>
      <div class="panel"><h2>상대 <select id="pt-partner"><option value="">구단 선택</option>${teams.map((t) => `<option value="${t.abbr}" ${t.abbr === ui.partner ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></h2>
        <div class="body">${ui.partner ? `<p class="muted small">단장 성향: ${esc(gmProfile(ui.partner).label.join(' · '))} · 오늘 남은 협상 ${PT.talksLeft(ui.partner)}번</p>${side(ui.partner, ui.rp, ui.rk, 'r')}` : '<p class="muted">거래할 구단을 고르세요.</p>'}</div></div>
    </div>
    ${summary(sel, res)}
    ${logHTML()}`;
  bind(main, sel, res);
}
function pick() {
  const me = state.save.team, T = (a) => teamBy(a);
  const ps = (a, set) => (a ? T(a).roster.filter((p) => set.has(p.player_id)) : []);
  const ks = (a, set) => (a ? assetsOf(a).filter((x) => set.has(x.key)) : []);
  return { givePlayers: ps(me, ui.gp), getPlayers: ps(ui.partner, ui.rp), givePicks: ks(me, ui.gk), getPicks: ks(ui.partner, ui.rk) };
}
function side(abbr, pset, kset, tag) {
  const t = teamBy(abbr), list = t.roster.slice().sort((a, b) => sal(b) - sal(a));
  const fut = assetsOf(abbr).filter((a) => a.kind === 'fut');
  return `<div class="scroll"><table class="t pt"><thead><tr><th></th><th>선수</th><th class="n">${esc(S())}</th><th class="n">남은 해</th></tr></thead><tbody>
    ${list.map((p) => { const b = PT.blocked(p); return `<tr class="${b ? 'locked' : ''}"><td><input type="checkbox" data-pp="${tag}:${esc(p.player_id)}" ${pset.has(p.player_id) ? 'checked' : ''} ${b ? 'disabled' : ''} aria-label="${esc(p.name)}"></td>
      <td><a href="#" data-open="player:${esc(p.player_id)}">${esc(p.name)}</a> <span class="muted small">${esc(p.pos || '')} · ${p.age ?? '?'}세</span>${b ? `<div class="muted small">${esc(b)}</div>` : ''}</td>
      <td class="n">${money(sal(p), 1)}</td><td class="n">${yrsLeft(p)}</td></tr>`; }).join('')}</tbody></table></div>
    ${fut.length ? `<div class="k small muted" style="margin-top:10px">미래 지명권</div><div class="fut">${fut.map((a) => `<label class="${a.tradable ? '' : 'locked'}"><input type="checkbox" data-pk="${tag}:${a.key}" ${kset.has(a.key) ? 'checked' : ''} ${a.tradable ? '' : 'disabled'}> ${assetLabel(a)}${a.tradable ? '' : ' <span class="muted small">거래 불가</span>'}</label>`).join('')}</div>` : ''}`;
}
// 우리 예상 승수 변화 (자동 뎁스 기준)
function winDelta(sel) {
  const t = teamBy(state.save.team), std = t.roster.filter((p) => p.roster_role !== 'two_way');
  const after = std.filter((p) => !sel.givePlayers.includes(p)).concat(sel.getPlayers.filter((p) => p.roster_role !== 'two_way'));
  return 2.7 * (teamRating(autoDepth(after)).net - teamRating(autoDepth(std)).net);
}
function sideBox(title, s) {
  return `<div><div class="k">${esc(title)}</div><div>보냄 ${money(s.outSal, 1)} · 받음 ${money(s.inSal, 1)}</div>
    <div class="small muted">${esc(s.rule || '연봉이 줄거나 같아요')}</div>
    <div class="small">총연봉 → ${money(s.payAfter, 1)}${s.taxAfter !== s.taxBefore ? ` · 사치세 ${money(s.taxBefore, 1)} → ${money(s.taxAfter, 1)}` : ''}</div></div>`;
}
function summary(sel, res) {
  const any = sel.givePlayers.length || sel.getPlayers.length || sel.givePicks.length || sel.getPicks.length;
  if (!ui.partner || !any) return '<div class="panel"><div class="body muted">양쪽에서 주고받을 선수나 지명권을 고르면 규정 검사 결과가 여기 나와요.</div></div>';
  const reply = ui.reply;
  return `<div class="panel pt-sum"><h2>거래 검토</h2><div class="body">
    <div class="pt-grid">
      <div><div class="k">우리가 보냄</div>${[...sel.givePlayers.map((p) => esc(p.name)), ...sel.givePicks.map((a) => esc(plainLabel(a)))].join('<br>') || '<span class="muted">없음</span>'}</div>
      <div><div class="k">우리가 받음</div>${[...sel.getPlayers.map((p) => esc(p.name)), ...sel.getPicks.map((a) => esc(plainLabel(a)))].join('<br>') || '<span class="muted">없음</span>'}</div>
      ${res?.sideMe ? sideBox('우리 팀 연봉', res.sideMe) : ''}${res?.sideAI ? sideBox(`${teamBy(ui.partner).name} 연봉`, res.sideAI) : ''}
    </div>
    ${res?.result === 'invalid' ? `<ul class="errs">${res.errs.map((e, i) => `<li>${res.why?.[i] ? tip(e, res.why[i]) : esc(e)}</li>`).join('')}</ul>` : ''}
    ${reply ? `<p class="${reply.result === 'accept' ? 'good' : reply.result === 'counter' ? 'warn' : 'bad'}"><b>${esc(teamBy(reply.team).name)}:</b> ${esc(reply.reason)}</p>` : ''}
    <p>${reply?.result === 'counter' ? `<button class="go" id="pt-take">역제안 받아들이기</button> <button class="go ghost" id="pt-drop">거절</button>` : `<button class="go" id="pt-send" ${res?.result === 'invalid' || PT.talksLeft(ui.partner) <= 0 ? 'disabled' : ''}>제안하기</button>`}</p>
  </div></div>`;
}
function logHTML() {
  const l = PT.pt().log; if (!l.length) return '';
  return `<div class="panel"><h2>이번 오프시즌 선수 트레이드</h2><div class="body"><ul class="news">${l.map((x) => `<li>${esc(teamBy(x.partner).name)}에 ${esc(x.gave.join(', ') || '없음')} 주고 ${esc(x.got.join(', ') || '없음')} 받음</li>`).join('')}</ul></div></div>`;
}
function bind(main, sel, res) {
  main.querySelectorAll('[data-po]').forEach((b) => b.onclick = () => {
    const o = PT.ib().list.find((x) => x.id === +b.dataset.po), act = b.dataset.act, m = PT.resolveOffer(o);
    const meta = { id: o.id, partner: o.team, motive: o.motive, give: o.give, get: o.get, get_picks: o.getPicks, win_delta: m ? Math.round(winDelta(m) * 10) / 10 : null, phase: state.save.phase };
    if (act === 'accept') {
      const r = PT.acceptOffer(o);
      track('ptrade_offer_reply', { ...meta, reply: r.err ? 'invalid' : 'accept' });
      ui.reply = r.err ? { result: 'reject', reason: r.err, team: o.team } : { result: 'accept', reason: '좋아요, 거래 성사!', team: o.team };
      if (!r.err) track('ptrade_done', { ...meta, incoming: true });
    } else if (act === 'decline') { PT.declineOffer(o); track('ptrade_offer_reply', { ...meta, reply: 'decline' }); }
    else if (act === 'edit' && m) {   // 조건 조정: 아래 만들기 칸으로 옮김 (보내면 그 구단과 협상 1번 사용)
      ui.partner = o.team; ui.gp = new Set(o.give); ui.rp = new Set(o.get); ui.gk = new Set(); ui.rk = new Set(o.getPicks); ui.reply = null; PT.declineOffer(o);
      track('ptrade_offer_reply', { ...meta, reply: 'edit' });
    }
    renderPTrade(main);
  });
  main.querySelector('#pt-partner').onchange = (e) => { ui.partner = e.target.value || null; ui.rp.clear(); ui.rk.clear(); ui.reply = null; if (ui.partner) track('ptrade_partner_view', { partner: ui.partner }); renderPTrade(main); };
  main.querySelectorAll('[data-pp]').forEach((c) => c.onchange = () => { const [tag, id] = c.dataset.pp.split(':'); const s = tag === 'g' ? ui.gp : ui.rp; c.checked ? s.add(id) : s.delete(id); ui.reply = null; renderPTrade(main); });
  main.querySelectorAll('[data-pk]').forEach((c) => c.onchange = () => { const i = c.dataset.pk.indexOf(':'), tag = c.dataset.pk.slice(0, i), k = c.dataset.pk.slice(i + 1); const s = tag === 'g' ? ui.gk : ui.rk; c.checked ? s.add(k) : s.delete(k); ui.reply = null; renderPTrade(main); });
  const meta = () => ({ partner: ui.partner, give: sel.givePlayers.map((p) => p.player_id), get: sel.getPlayers.map((p) => p.player_id), give_picks: sel.givePicks.map((a) => a.key), get_picks: sel.getPicks.map((a) => a.key), win_delta: Math.round(winDelta(sel) * 10) / 10, phase: state.save.phase });
  main.querySelector('#pt-send')?.addEventListener('click', () => {
    const r = PT.propose(ui.partner, sel);
    track('ptrade_propose', { ...meta(), result: r.result, net: r.net != null ? Math.round(r.net) : null });
    ui.reply = { ...r, team: ui.partner };
    if (r.result === 'accept') { track('ptrade_done', meta()); clearSel(); }
    renderPTrade(main);
  });
  main.querySelector('#pt-take')?.addEventListener('click', () => {
    const add = ui.reply.add, sel2 = { ...sel, givePicks: [...sel.givePicks, add] };
    const chk = PT.evaluate(ui.partner, sel2);
    if (chk.result === 'invalid') { ui.reply = { result: 'reject', reason: chk.errs[0], team: ui.partner }; return renderPTrade(main); }
    PT.execute(ui.partner, sel2);
    track('ptrade_counter', { ...meta(), accepted: true, add: add.key }); track('ptrade_done', { ...meta(), counter: true });
    ui.reply = { result: 'accept', reason: '좋아요, 거래 성사!', team: ui.partner }; clearSel(); renderPTrade(main);
  });
  main.querySelector('#pt-drop')?.addEventListener('click', () => { track('ptrade_counter', { ...meta(), accepted: false, add: ui.reply.add.key }); ui.reply = null; renderPTrade(main); });
}
// 들어온 선수 트레이드 제안
const MOT = { want: '우리 선수를 원함', dump: '연봉 정리' };
function inboxHTML() {
  const open = PT.ib().list.filter((o) => o.status === 'open'), past = PT.ib().list.filter((o) => o.status !== 'open');
  if (!open.length && !past.length) return '';
  const row = (p) => `${esc(p.name)} <span class="muted small">${money(sal(p), 1)} · ${yrsLeft(p)}년</span>`;
  return `<div class="panel inbox"><h2>들어온 제안 <span class="muted small">다른 구단이 먼저 연락했어요 · 오늘(이 날짜)까지만 유효해요</span></h2><div class="body">
    ${open.map((o) => { const m = PT.resolveOffer(o); if (!m) return '';
      return `<div class="offer"><div class="who"><b>${esc(teamBy(o.team).name)}</b> <span class="tag">${MOT[o.motive]}</span> <span class="muted small">${esc(gmProfile(o.team).label.join(' · '))}</span></div>
        <p class="quote">“${esc(o.msg)}”</p>
        <div class="swap"><div><div class="k">우리가 받는 것</div>${m.getPlayers.map((p) => `<div>${row(p)}</div>`).join('')}${m.getPicks.map((a) => `<div>${assetLabel(a)}</div>`).join('')}</div>
          <div class="arrow">⇄</div><div><div class="k">우리가 주는 것</div>${m.givePlayers.map((p) => `<div>${row(p)}</div>`).join('') || '<div class="muted">없음 (캡 공간으로 받기)</div>'}</div></div>
        <p class="small">이번 시즌 우리 연봉 ${(() => { const d = m.getPlayers.reduce((a, p) => a + sal(p), 0) - m.givePlayers.reduce((a, p) => a + sal(p), 0); return (d >= 0 ? '+' : '−') + money(Math.abs(d), 1); })()}</p>
        <p class="acts"><button class="go small" data-po="${o.id}" data-act="accept">수락</button> <button class="go small ghost" data-po="${o.id}" data-act="edit">조건 조정해서 다시 제안</button> <button class="go small ghost" data-po="${o.id}" data-act="decline">거절</button></p></div>`; }).join('') || '<p class="muted small">지금 열린 제안이 없어요.</p>'}
    ${past.length ? `<p class="muted small">지난 제안: ${past.map((o) => `${esc(teamBy(o.team).name)} ${({ accepted: '수락', declined: '거절', expired: '만료' })[o.status]}`).join(' · ')}</p>` : ''}</div></div>`;
}
function clearSel() { ui.gp.clear(); ui.rp.clear(); ui.gk.clear(); ui.rk.clear(); }
