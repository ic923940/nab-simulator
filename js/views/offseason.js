// 드래프트 다음 단계 화면: ① 옵션 → ② 퀄리파잉 오퍼 → ③ 신인 계약 (순서대로)
import { esc, money, num } from '../util.js';
import { state, writeSave, teamBy } from '../store.js';
import { track } from '../analytics.js';
import { term } from '../glossary.js';
import { notice } from '../ui.js';
import * as O from '../offseason.js';
import { capSheet } from '../capsheet.js';

const STEPS = [['options', '① 옵션 결정'], ['qo', '② 퀄리파잉 오퍼'], ['rookies', '③ 신인 계약']];
const name = (abbr) => teamBy(abbr)?.name || abbr;
const KIND_KO = { team_option: '팀 옵션', player_option: '선수 옵션', early_termination: '조기 해지 옵션' };
const ui = { choice: {} };

function off() { return (state.save.off ||= { step: 'options', news: {} }); }
const deadline = (k) => { const c = state.cal?.[String(state.save.year)]?.[k]; return c?.value ? (typeof c.value === 'string' ? c.value : c.value.date || '') + (c.estimated ? ' (추정)' : '') : ''; };

export function renderOffseason(main, go) {
  const s = state.save, o = off();
  if (!['offseason', 'fa'].includes(s.phase)) {
    main.innerHTML = `<h1>오프시즌 계약 정리</h1><p class="sub">드래프트를 마친 뒤에 열려요.</p>`; return;
  }
  const stepIdx = STEPS.findIndex(([k]) => k === o.step);
  main.innerHTML = `<h1>오프시즌 계약 정리</h1>
    <p class="sub">${s.year}년 드래프트 다음 · 실제 일정: 옵션·퀄리파잉 오퍼 마감 ${esc(deadline('qualifying_offer_deadline') || deadline('player_team_option_deadline_typical') || '6월 말')}</p>
    <ol class="steps">${STEPS.map(([k, l], i) => `<li class="${i < stepIdx || o.step === 'done' ? 'done' : i === stepIdx ? 'on' : ''}">${l}</li>`).join('')}</ol>
    <div id="off-body"></div>`;
  const body = main.querySelector('#off-body');
  if (o.step === 'options') stepOptions(body, main, go);
  else if (o.step === 'qo') stepQO(body, main, go);
  else if (o.step === 'rookies') stepRookies(body, main, go);
  else doneView(body);
}

// ── 공통 조각: 계약 테이블 카드 ──
const initials = (n) => n.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
function lastLineNBA(p) { const h = (p.nba_history || []).slice(-1)[0]; return h ? `${h.season} ${h.g}경기 · ${num(h.pts_per_game)}득점 ${num(h.trb_per_game)}리바 ${num(h.ast_per_game)}어시` : '지난 시즌 NBA 기록 없음'; }
// 금액 비교 막대: 시장 가치(채움) vs 기준 금액(세로선)
function meter(value, mark, markLabel) {
  const max = Math.max(value, mark) * 1.25 || 1;
  return `<div class="meter"><div class="val" style="width:${(value / max) * 100}%"></div><div class="tick" style="left:${(mark / max) * 100}%"><b>${esc(markLabel)} ${money(mark, 1)}</b></div></div>
    <div class="meter-legend"><span>예상 시장 가치 ${money(value, 1)}</span></div>`;
}
function seg(name, opts, cur) {
  return `<div class="seg" role="radiogroup">${opts.map(([v, l]) => `<button type="button" role="radio" aria-checked="${cur === v}" class="${cur === v ? 'on' : ''}" data-seg="${name}" data-v="${v}">${l}</button>`).join('')}</div>`;
}
function bindSeg(body, cb) {
  body.querySelectorAll('[data-seg]').forEach((b) => b.onclick = () => { cb(b.dataset.seg, b.dataset.v); });
}
// 화면 아래 캡 영향 띠
function capstrip(extra) {
  const sh = capSheet();
  return `<div class="capstrip"><div><div class="k">${term('salary_cap', '캡')} 기준 지금 총액 (홀드 포함)</div><div class="v">${money(sh.total, 1)}</div></div>
    <div><div class="k">캡 여유</div><div class="v ${sh.room >= 0 ? 'good' : ''}">${sh.room >= 0 ? money(sh.room, 1) : '−' + money(-sh.room, 1)}</div></div>
    ${extra || ''}<span class="spacer"></span><a href="#/finance" class="small">캡 상황판 자세히</a></div>`;
}

// ① 옵션
function stepOptions(body, main, go) {
  const me = state.save.team, mine = O.pendingOptions(me);
  const teamOpts = mine.filter((x) => x.kind === 'team_option'), playerOpts = mine.filter((x) => x.kind !== 'team_option');
  const draw = () => {
    const declined = teamOpts.filter((x) => ui.choice[x.p.player_id] === false).reduce((a, x) => a + x.y.salary, 0);
    body.innerHTML = `
    <div class="panel"><h2>${term('team_option', '팀 옵션')}: 우리가 결정해요</h2><div class="body">
      ${teamOpts.length ? teamOpts.map((x) => { const keep = ui.choice[x.p.player_id] !== false, v = O.value(x.p);
        return `<div class="deal"><div class="mono">${initials(x.p.name)}</div>
          <div><a href="#" class="nm" data-open="player:${x.p.player_id}">${esc(x.p.name)}</a> <span class="sub2">${esc(x.p.pos || '')} · ${x.p.age ?? ''}세</span>
            <div class="sub2">${lastLineNBA(x.p)}</div>${meter(v, x.y.salary, `${state.data.season} 옵션 연봉`)}</div>
          <div>${seg('t_' + x.p.player_id, [['1', '실행해서 남기기'], ['0', '거절해서 FA로']], keep ? '1' : '0')}
            <div class="verdict muted">${keep ? `${money(x.y.salary, 2)}에 1년 더` : '권리는 남아서 다시 협상할 수 있어요 (캡 홀드 발생)'}</div></div></div>`; }).join('')
        : '<p class="muted">결정할 팀 옵션이 없어요.</p>'}</div></div>
    <div class="panel"><h2>${term('player_option', '선수 옵션')}: 선수가 결정해요</h2><div class="body">
      ${playerOpts.length ? playerOpts.map((x) => `<div class="deal"><div class="mono">${initials(x.p.name)}</div>
          <div><a href="#" class="nm" data-open="player:${x.p.player_id}">${esc(x.p.name)}</a> <span class="sub2">${KIND_KO[x.kind]} · ${x.p.age ?? ''}세</span>${meter(O.value(x.p), x.y.salary, '옵션 연봉')}</div>
          <div class="muted small">확정하면 선수의 결정이 나와요.</div></div>`).join('')
        : '<p class="muted">우리 팀에 선수 옵션이 걸린 선수가 없어요.</p>'}</div></div>
    <p><button class="go" id="ok">옵션 결정 확정</button> <span class="muted small">다른 29개 구단과 선수들도 동시에 결정해요.</span></p>
    ${capstrip(declined ? `<div><div class="k">거절하는 옵션 연봉</div><div class="v">−${money(declined, 1)}</div></div>` : '')}`;
    bindSeg(body, (n, v) => { ui.choice[n.slice(2)] = v === '1'; draw(); });
    body.querySelector('#ok').onclick = confirmOptions;
  };
  const confirmOptions = () => {
    const news = [];
    for (const x of O.pendingOptions()) {
      let ex;
      if (x.team === me && x.kind === 'team_option') ex = ui.choice[x.p.player_id] !== false;
      else ex = x.kind === 'team_option' ? O.aiTeamOption(x) : O.aiPlayerOption(x);
      news.push({ team: x.team, name: x.p.name, kind: x.kind, salary: x.y.salary, ex, mine: x.team === me, value: O.value(x.p) });
      O.log({ t: 'opt', pid: x.p.player_id, team: x.team, kind: x.kind, exercised: ex });
    }
    off().news.options = news;
    track('offseason_options', { mine: news.filter((n) => n.mine).map((n) => ({ kind: n.kind, ex: n.ex, salary: n.salary, value: n.value })), league_declined: news.filter((n) => !n.ex).length });
    ui.choice = {};
    showNews(main, go, '옵션 결정 결과', news.map((n) => `${n.mine ? '<b>' : ''}${esc(name(n.team))} · ${esc(n.name)}: ${KIND_KO[n.kind]} ${n.ex ? '실행 (남음)' : n.kind === 'team_option' ? '<span class="bad">거절 → FA</span>' : '<span class="bad">거절 → FA 선언</span>'} <span class="muted">${money(n.salary, 2)}</span>${n.mine ? '</b>' : ''}`),
      'qo', '이제 퀄리파잉 오퍼 단계로 넘어갑니다', '계약이 끝난 젊은 선수에게 1년짜리 퀄리파잉 오퍼를 내면, 그 선수는 제한적 FA(RFA)가 되어 다른 팀 제안을 우리가 똑같이 맞춰 붙잡을 수 있어요.');
  };
  draw();
}

// ② 퀄리파잉 오퍼
function stepQO(body, main, go) {
  const me = state.save.team, mine = O.rfaCandidates(me);
  for (const p of mine) if (ui.choice[p.player_id] === undefined) ui.choice[p.player_id] = true;   // 기본값: 제시 (판단 힌트가 되지 않게 모두 같은 기본값)
  const draw = () => {
    body.innerHTML = `
    <div class="panel"><h2>${term('qualifying_offer', '퀄리파잉 오퍼')}: 계약이 끝난 우리 팀 ${term('rfa', 'RFA')} 자격 선수</h2><div class="body">
      ${mine.length ? mine.map((p) => { const q = O.qoAmount(p), on = ui.choice[p.player_id];
        return `<div class="deal"><div class="mono">${initials(p.name)}</div>
          <div><a href="#" class="nm" data-open="player:${p.player_id}">${esc(p.name)}</a> <span class="sub2">${p.age ?? ''}세${p.rookie_scale_pick ? ` · ${p.rookie_scale_class} 드래프트 ${p.rookie_scale_pick}순위` : ''}${O.starterMet(p) ? ' · 선발 기준 충족' : ''}</span>
            <div class="sub2">지난 시즌 연봉 ${money(p.contract.last_salary, 2)} · ${lastLineNBA(p)}</div>${meter(O.value(p), q, 'QO')}</div>
          <div>${seg('q_' + p.player_id, [['1', 'QO 제시 (RFA)'], ['0', '안 함 (UFA)']], on ? '1' : '0')}
            <div class="verdict muted">${on ? `다른 팀 제안을 맞춰서 붙잡을 수 있어요. 선수가 ${money(q, 2)}에 1년 계약을 받아들일 수도 있어요.` : '누구와도 자유롭게 계약할 수 있어요. 버드 권리는 남아요.'}</div></div></div>`; }).join('')
        : '<p class="muted">퀄리파잉 오퍼를 낼 수 있는 선수가 없어요.</p>'}</div></div>
    <p><button class="go" id="ok">퀄리파잉 오퍼 확정</button></p>
    ${capstrip()}`;
    bindSeg(body, (n, v) => { ui.choice[n.slice(2)] = v === '1'; draw(); });
    body.querySelector('#ok').onclick = confirmQO;
  };
  const confirmQO = () => {
    const news = [];
    for (const p of O.rfaCandidates()) {
      const team = p.contract.rights_team, amount = O.qoAmount(p);
      const offered = team === me ? !!ui.choice[p.player_id] : O.aiQO(p);
      news.push({ team, name: p.name, amount, offered, mine: team === me, value: O.value(p) });
      O.log({ t: 'qo', pid: p.player_id, team, offered, amount });
    }
    off().news.qo = news;
    track('offseason_qo', { mine: news.filter((n) => n.mine).map((n) => ({ offered: n.offered, amount: n.amount, value: n.value })), league_offered: news.filter((n) => n.offered).length, league_total: news.length });
    ui.choice = {};
    showNews(main, go, '퀄리파잉 오퍼 결과', news.filter((n) => n.offered || n.mine).map((n) => `${n.mine ? '<b>' : ''}${esc(name(n.team))} · ${esc(n.name)}: ${n.offered ? `QO 제시 ${money(n.amount, 2)} → RFA` : '<span class="muted">QO 안 함 → UFA</span>'}${n.mine ? '</b>' : ''}`),
      'rookies', '이제 신인 계약 단계로 넘어갑니다', '1라운드 신인은 순위별로 정해진 연봉(신인 계약)으로 4년(3·4년차는 팀 옵션) 계약해요. 2라운드 신인은 일반 계약, 투웨이 계약, 또는 권리만 갖고 해외에 두는 방법 중에서 골라요.');
  };
  draw();
}

// ③ 신인 계약
function stepRookies(body, main, go) {
  const me = state.save.team, mine = O.draftees(me);
  const r1 = mine.filter((m) => m.round === 1), r2 = mine.filter((m) => m.round === 2);
  const draw = () => {
    body.innerHTML = `
    <div class="panel"><h2>1라운드: ${term('rookie_scale', '신인 계약')}</h2><div class="body">
      ${r1.length ? r1.map((m) => { const ys = O.firstRoundYears(m.pick);
        return `<div class="deal"><div class="mono">${m.pick}</div>
          <div><a href="#" class="nm" data-open="prospect:${m.id}">${esc(m.name)}</a> <span class="sub2">${esc(m.pos || '')} · ${m.pick}순위 · 4년 총 ${money(ys.reduce((a, y) => a + (y.salary || 0), 0), 1)}</span>
            <div class="strip4">${ys.map((y) => `<div>${esc(y.season)}<b>${money(y.salary, 2)}</b>${y.option ? '팀 옵션' : '보장'}</div>`).join('')}</div></div>
          <div class="muted small">규정 금액의 120%로 서명해요. 실제로 거의 모든 1라운드 신인이 최대치로 계약해요.</div></div>`; }).join('')
        : '<p class="muted">1라운드 신인이 없어요.</p>'}</div></div>
    <div class="panel"><h2>2라운드: 계약 방식을 골라요</h2><div class="body">
      ${r2.length ? r2.map((m) => { const c = ui.choice[m.id] || 'two_way', std = O.secondRoundYears();
        return `<div class="deal"><div class="mono">${m.pick}</div>
          <div><a href="#" class="nm" data-open="prospect:${m.id}">${esc(m.name)}</a> <span class="sub2">${esc(m.pos || '')} · ${m.pick}순위</span>
            <div class="sub2">${c === 'standard' ? `${std.length}년${state.save.year >= 2023 ? '(마지막 해 팀 옵션)' : ''} · 첫해 ${money(std[0].salary, 2)} · 정규 로스터 15명 안에 들어가요` : c === 'two_way' ? `${money(O.twoWaySalary(), 2)} · 캡에 안 들어가고 G리그와 오가요 (NBA 출전 경기 제한)` : '계약하지 않고 권리만 가져요. 해외에서 뛰다가 나중에 데려올 수 있어요'}</div></div>
          <div>${seg('r_' + m.id, [['standard', '일반 계약'], ['two_way', '투웨이'], ['stash', '권리만 보유']], c)}</div></div>`; }).join('')
        : '<p class="muted">2라운드 신인이 없어요.</p>'}</div></div>
    <p><button class="go" id="ok">신인 계약 서명</button></p>
    ${capstrip()}`;
    bindSeg(body, (n, v) => { ui.choice[n.slice(2)] = v; draw(); });
    body.querySelector('#ok').onclick = confirmRookies;
  };
  const confirmRookies = () => {
    const news = [];
    for (const m of O.draftees()) {
      let kind;
      if (m.round === 1) kind = 'scale';
      else kind = m.team === me ? (ui.choice[m.id] || 'two_way') : O.aiSecondRound(m);
      const years = kind === 'scale' ? O.firstRoundYears(m.pick) : kind === 'standard' ? O.secondRoundYears()
        : kind === 'two_way' ? [{ season: state.data.season, salary: O.twoWaySalary(), kind: 'two_way', option: null, cap_hit: 0 }] : [];
      O.log({ t: 'rookie', pid: m.id, team: m.team, pick: m.pick, round: m.round, kind, years });
      news.push({ team: m.team, name: m.name, pick: m.pick, kind, mine: m.team === me });
    }
    off().news.rookies = news;
    track('offseason_rookies', { mine: news.filter((n) => n.mine).map((n) => ({ pick: n.pick, kind: n.kind })) });
    ui.choice = {};
    const K = { scale: '신인 계약', standard: '일반 계약', two_way: '투웨이', stash: '권리만 보유' };
    showNews(main, go, '신인 계약 결과', news.filter((n) => n.mine || n.kind !== 'scale').map((n) => `${n.mine ? `<span class="signed">서명</span> <b>` : ''}${n.pick}순위 ${esc(name(n.team))} · ${esc(n.name)}: ${K[n.kind]}${n.mine ? '</b>' : ''}`),
      'done', '오프시즌 계약 정리가 끝났어요', '다음은 FA 협상이에요. 협상 시작일 18시(미국 동부)부터 다른 팀 선수와도 협상할 수 있어요. 대형 FA는 첫날 밤에 대부분 결정돼요.');
  };
  draw();
}

function showNews(main, go, title, lines, nextStep, nTitle, nText) {
  const body = main.querySelector('#off-body');
  body.innerHTML = `<div class="panel"><h2>${title}</h2><div class="body">${lines.length ? `<ul class="news">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>` : '<p class="muted">변동 없음</p>'}</div></div>
    <p><button class="go" id="off-next">다음</button></p>`;
  writeSave();
  body.querySelector('#off-next').onclick = () => notice(nTitle, nText, () => {
    off().step = nextStep;
    if (nextStep === 'done') { state.save.phase = 'fa'; dispatchEvent(new Event('phasechange')); }
    writeSave(); renderOffseason(main, go);
  });
}

function doneView(body) {
  const o = off(), me = state.save.team;
  const mine = (k) => (o.news[k] || []).filter((n) => n.mine);
  body.innerHTML = `<div class="panel"><h2>정리 결과 (우리 팀)</h2><div class="body"><ul class="news">
    ${mine('options').map((n) => `<li>${esc(n.name)}: ${KIND_KO[n.kind]} ${n.ex ? '실행' : '거절'}</li>`).join('')}
    ${mine('qo').map((n) => `<li>${esc(n.name)}: ${n.offered ? 'QO 제시 → RFA' : 'QO 안 함 → UFA'}</li>`).join('')}
    ${mine('rookies').map((n) => `<li>${n.pick}순위 ${esc(n.name)}: ${({ scale: '신인 계약', standard: '일반 계약', two_way: '투웨이', stash: '권리만 보유' })[n.kind]}</li>`).join('') || ''}
    </ul><p><a class="go" href="#/fa" id="to-fa">FA 협상 시작</a></p></div></div>`;
}
