// 우리 팀 화면: 홈, 로스터, 재정
import { esc, money, num, table, lastSeason, OPTION_KO, ROLE_KO, inches } from '../util.js';
import { cardsHTML } from './scout.js';
import { capBug } from './capbug.js';
import { state, myTeam, picksOf } from '../store.js';
import { assetsOf } from '../picks.js';
import { capHit, teamPayroll, luxuryTax, capStatus, nextSeasons, capLines, twoWayMax } from '../rules.js';
import { term } from '../glossary.js';
import { capSheet, tools, BIRD_KO, faHold } from '../capsheet.js';
import * as O from '../offseason.js';
import { notice } from '../ui.js';
import { track } from '../analytics.js';

const ordinal = (o) => `${o.round}라운드 ${o.pick}순위`;

export function capBar(payroll) {
  const marks = capLines();
  const max = Math.max(marks[marks.length - 1][2] * 1.12, payroll * 1.05);
  const at = (v) => (v / max) * 100;
  const gap = (v) => {
    const d = v - payroll;
    return d >= 0 ? `<span class="good">${money(d)} 남음</span>` : `<span class="muted">${money(-d)} 넘음</span>`;
  };
  return `<div class="capbar" role="img" aria-label="총연봉 ${money(payroll)}">
    <div class="fill" style="width:${at(payroll)}%"></div>
    ${marks.map(([, n, v], i) => `<div class="mark${i % 2 ? ' low' : ''}" style="left:${at(v)}%" title="${n} ${money(v)}"><span>${n}</span></div>`).join('')}
  </div>
  <dl class="kv">${marks.map(([k, n, v]) => `<dt>${term(k, n)}</dt><dd>${money(v)} · ${gap(v)}</dd>`).join('')}</dl>`;
}

export function rosterTable(id, t, mine) {
  const season = state.data.season;
  return table(id, t.roster, [
    { k: 'name', label: '이름', get: (p) => p.name, fmt: (v, p) => `${esc(v)}${p.roster_role === 'two_way' ? ' <span class="tag">투웨이</span>' : p.roster_role === 'depth' ? ' <span class="tag">예비</span>' : ''}` },
    { k: 'pos', label: '포지션', get: (p) => p.pos },
    { k: 'age', label: '나이', n: 1, get: (p) => p.age },
    { k: 'exp', label: '경력', tip: 'experience', n: 1, get: (p) => p.experience_seasons, fmt: (v) => (v ? v + '년' : '신인') },
    { k: 'g', label: '경기', n: 1, get: (p) => lastSeason(p)?.g ?? null, fmt: (v) => v ?? '—' },
    { k: 'mp', label: '분', n: 1, get: (p) => lastSeason(p)?.mp_per_game ?? null, fmt: (v) => num(v) },
    { k: 'pts', label: '득점', n: 1, get: (p) => lastSeason(p)?.pts_per_game ?? null, fmt: (v) => num(v) },
    { k: 'trb', label: '리바운드', n: 1, get: (p) => lastSeason(p)?.trb_per_game ?? null, fmt: (v) => num(v) },
    { k: 'ast', label: '어시스트', n: 1, get: (p) => lastSeason(p)?.ast_per_game ?? null, fmt: (v) => num(v) },
    { k: 'cap', label: `${season} 연봉`, tip: 'cap_hit', n: 1, get: (p) => capHit(p, season), fmt: (v, p) => (p.roster_role === 'two_way' ? `${money((p.contract?.years || []).find((y) => y.season === season)?.salary)} <span class="muted small">캡 밖</span>` : money(v)) },
    { k: 'yrs', label: '남은 계약', tip: 'years_left', n: 1, get: (p) => p.contract?.years_remaining ?? null, fmt: (v, p) => (v ? `${v}년` : '—') + (p.contract?.years?.some((y) => y.option) ? ' ' + term('option', '옵션') : '') },
  ], { sortKey: 'cap', rowClick: (p) => `player:${p.player_id}`, mine });
}

export function renderHome(main) {
  const t = myTeam(), d = state.data, L = d.league;
  const season = d.season;
  const pay = teamPayroll(t, season), st = capStatus(pay);
  const picks = picksOf(t.abbr);
  const pending = t.roster.flatMap((p) => (p.contract?.years || []).filter((y) => y.season === season && y.option).map((y) => ({ p, y })));
  const myFA = d.free_agents.filter((p) => p.contract?.rights_team === t.abbr);
  const rfa = myFA.filter((p) => (p.contract.fa_type || '').startsWith('RFA'));
  const standard = t.roster.filter((p) => p.roster_role !== 'two_way').length;
  const tw = t.roster.length - standard;
  const ps = t.prev_season;

  const inbox = [
    `<b>오늘은 ${esc(d.contract_info.as_of)} 드래프트 날이에요.</b> ${state.save.phase === 'lottery' ? '먼저 <a href="#/lottery">드래프트 로터리</a>를 진행하세요.' : state.save.phase === 'trade' ? `<a href="#/trade">지명권 트레이드</a> 진행 중 (남은 제안 ${state.save.tradesLeft}번).` : ''} 우리 지명권: ${picks.length ? picks.map(ordinal).join(', ') : '없음'} · 미래 지명권 ${assetsOf(t.abbr).filter((a) => a.kind === 'fut').length}개`,
    pending.length ? `<b>옵션 결정이 남은 선수 ${pending.length}명</b> — ${pending.map(({ p, y }) => `${esc(p.name)} (${OPTION_KO[y.option] || y.option}, ${money(y.cap_hit ?? y.salary)})`).join(', ')}` : null,
    myFA.length ? `<b>우리가 ${term('rights_team', '권리')}를 가진 FA ${myFA.length}명</b>${rfa.length ? ` (${term('rfa', '제한적 FA')} ${rfa.length}명)` : ''} — ${myFA.slice(0, 6).map((p) => esc(p.name)).join(', ')}${myFA.length > 6 ? ' 외' : ''}` : null,
    `로스터 정규 계약 ${standard}명 / 15명, ${term('two_way', '투웨이')} ${tw}명 / ${twoWayMax()}명`,
  ].filter(Boolean);

  main.innerHTML = `
    <h1>${esc(t.name)}</h1>
    <p class="sub">${esc(season)} 시즌 준비 · 홈 구장 ${esc(t.arena)}</p>
    <div class="panel"><h2>할 일</h2><div class="body"><ul style="margin:0;padding-left:18px">${inbox.map((x) => `<li style="margin:4px 0">${x}</li>`).join('')}</ul></div></div>
    <div class="grid2">
      <div class="panel"><h2>지난 시즌</h2><div class="body"><dl class="kv">
        <dt>성적</dt><dd>${esc(ps.season)} ${ps.w}승 ${ps.l}패</dd>
        <dt>플레이오프</dt><dd>${ps.playoffs ? '진출' : '탈락'}</dd>
        <dt>${term('srs', '전력 지표(SRS)')}</dt><dd>${num(ps.srs, 2)}</dd>
        <dt>${term('tax_level', '최근 4시즌 사치세')}</dt><dd>${t.tax_paid_last4?.length ? esc(t.tax_paid_last4.join(', ')) : '없음'}${t.repeater_taxpayer ? ' ' + term('repeater', '반복 납부 팀') : ''}</dd>
      </dl></div></div>
      <div class="panel"><h2>${esc(season)} 샐러리</h2><div class="body">
        <dl class="kv"><dt>${term('payroll', '총연봉')}</dt><dd><b>${money(pay)}</b> <span class="${st.cls}">${st.t}</span></dd>
        <dt>${term('luxury_tax', '예상 사치세')}</dt><dd>${money(luxuryTax(pay, t.repeater_taxpayer))}</dd></dl>
        ${capBar(pay)}
      </div></div>
    </div>
    <div class="panel" style="margin-top:16px"><h2>주요 선수</h2>${rosterTable('home-roster', { roster: t.roster.filter((p) => p.roster_role === 'main').sort((a, b) => (capHit(b, season) || 0) - (capHit(a, season) || 0)).slice(0, 8) })}</div>`;
}

export function renderRoster(main) {
  const t = myTeam();
  const tag = (p) => (p.roster_role === 'two_way' ? '투웨이' : p.rookie ? `신인${p.rookie.pick ? ' ' + p.rookie.pick + '순위' : ''}` : '');
  const order = t.roster.slice().sort((a, b) => (capHit(b, state.data.season) || 0) - (capHit(a, state.data.season) || 0));
  main.innerHTML = `<h1>로스터</h1><p class="sub">${esc(t.roster_basis)} · 선수를 누르면 자세히 볼 수 있어요</p>
    <div class="panel">${rosterTable('roster', t)}</div>
    <h2 class="sec">선수 리포트 <span class="muted small">같은 포지션 선수들과 비교한 막대와 스카우트 한 줄 평 · 연봉 순</span></h2>
    ${cardsHTML(order.map((p) => ({ p, open: `player:${p.player_id}`, tag: tag(p) })))}`;
}

export function renderFinance(main) {
  const t = myTeam(), L = state.data.league;
  const seasons = nextSeasons(4);
  const rows = t.roster.map((p) => ({ p, hits: seasons.map((s) => capHit(p, s)), opts: seasons.map((s) => (p.contract?.years || []).find((y) => y.season === s)?.option) }));
  const cell = (v, o) => (v === null ? '<span class="muted">—</span>' : money(v) + (o ? ` <span class="tag" title="${esc(OPTION_KO[o] || o)}">${o === 'player_option' ? '선' : o === 'early_termination' ? '해' : '팀'}</span>` : ''));
  const pay = seasons.map((s) => teamPayroll(t, s));
  const dead = t.dead_money || [];
  main.innerHTML = `<h1>재정</h1><p class="sub">${esc(L.cba)} 기준. 우리 팀은 자금 제한이 없고, 리그 규정만 지키면 돼요. 사치세는 참고용으로 보여줘요.</p>
    ${capBug()}
    ${capSheetPanel()}
    <div class="panel"><h2>${esc(seasons[0])} 샐러리 위치</h2><div class="body">${capBar(pay[0])}
      <dl class="kv" style="margin-top:8px"><dt>${term('payroll', '총연봉')}</dt><dd><b>${money(pay[0])}</b></dd><dt>${term('min_team_salary', '최소 총연봉')}</dt><dd>${money(L.min_team_salary)}</dd>
      <dt>${term('luxury_tax', '예상 사치세')}</dt><dd>${money(luxuryTax(pay[0], t.repeater_taxpayer))}${t.repeater_taxpayer ? ' (' + term('repeater', '반복 납부') + ' 세율)' : ''}</dd></dl></div></div>
    <div class="panel"><h2>시즌별 계약 <span class="muted" style="font-weight:400">(선=${term('player_option', '선수 옵션')}, 팀=${term('team_option', '팀 옵션')}, 해=${term('early_termination', '조기 해지')})</span></h2><div class="scroll"><table class="t">
      <thead><tr><th>이름</th><th>${term('roster_role', '구분')}</th>${seasons.map((s) => `<th class="n">${s}</th>`).join('')}</tr></thead>
      <tbody>${rows.sort((a, b) => (b.hits[0] || 0) - (a.hits[0] || 0)).map(({ p, hits, opts }) => `<tr class="click" data-open="player:${esc(p.player_id)}"><td>${esc(p.name)}</td><td>${ROLE_KO[p.roster_role] || ''}</td>${hits.map((v, i) => `<td class="n">${cell(v, opts[i])}</td>`).join('')}</tr>`).join('')}
      ${dead.map((d) => `<tr><td>${esc(d.name || d.player || '데드머니')}</td><td class="muted">${term('dead_money', '데드머니')}</td>${seasons.map((s) => { const y = (d.years || []).find((x) => x.season === s); return `<td class="n">${y ? money(y.amount) : '<span class="muted">—</span>'}</td>`; }).join('')}</tr>`).join('')}
      <tr><td><b>${term('payroll', '합계 (투웨이 제외)')}</b></td><td></td>${pay.map((v) => `<td class="n"><b>${money(v)}</b></td>`).join('')}</tr>
      </tbody></table></div></div>`;
  bindCapSheet(main);
}

// ── 캡 상황판: 다가오는 시즌 캡에 잡히는 모든 것 + 권리 포기 ──
function capSheetPanel() {
  const sh = capSheet(), L = state.data.league, P = sh.parts;
  const lines = capLines();
  const max = Math.max(lines[lines.length - 1][2] * 1.08, sh.total * 1.04);
  const w = (v) => `${(Math.max(0, v) / max) * 100}%`;
  const segs = [['salary', '계약 연봉', P.salary], ['dead', '데드머니', P.dead], ['holds', 'FA 캡 홀드', P.holds], ['picks', '신인 홀드', P.picks], ['charge', '빈 자리 요금', P.charge]];
  const canRenounce = ['lottery', 'trade', 'draft', 'draft_done', 'offseason'].includes(state.save.phase);
  return `<div class="panel"><h2>${esc(state.data.season)} ${term('cap_sheet', '캡 상황판')}</h2><div class="body">
    <div class="cap-hero">
      <div><div class="k">홀드를 모두 포기하면 캡 여유</div><div class="v" style="font-size:40px">${money(L.salary_cap - P.salary - P.dead - P.picks - Math.max(0, 12 - sh.players.length - sh.pickHolds.length) * (L.roster_charge || 0), 1)}</div></div>
    </div>
    <div class="stack" role="img" aria-label="캡 구성">${segs.map(([k, n, v]) => v > 0 ? `<div class="seg2 c-${k}" style="width:${w(v)}" title="${n} ${money(v)}"></div>` : '').join('')}
      ${lines.map(([k, n, v], i) => `<div class="ln${i % 2 ? ' alt' : ''}" style="left:${w(v)}" title="${n} ${money(v)}"><span>${({ salary_cap: '캡', tax_level: '사치세', first_apron: '1차', second_apron: '2차', apron: '에이프런' })[k] || n}</span></div>`).join('')}</div>
    <div class="legend">${segs.map(([k, n, v]) => `<span><i class="c-${k}"></i>${n} ${money(v, 1)}</span>`).join('')}</div>
    <p class="muted small">기준선: ${lines.map(([, n, v]) => `${n} ${money(v, 1)}`).join(' · ')}</p>
    ${sh.ngTotal ? `<p class="muted small">비보장 연봉 ${money(sh.ngTotal, 1)}: 보장일 전에 방출하면 캡에서 빠져요.</p>` : ''}

    <h3>${term('cap_hold', 'FA 캡 홀드')} (우리가 권리를 가진 FA)</h3>
    ${sh.holds.length ? `<div class="scroll"><table class="t"><thead><tr><th>선수</th><th>권리</th><th class="n">지난 연봉</th><th class="n">캡 홀드</th><th class="n">예상 시장 가치</th><th></th></tr></thead><tbody>
      ${sh.holds.sort((a, b) => b.amount - a.amount).map((h) => `<tr><td><a href="#" data-open="player:${h.p.player_id}">${esc(h.p.name)}</a></td>
        <td>${esc(BIRD_KO[h.p.contract.bird] || '—')}${h.p.contract.fa_type === 'RFA' ? ' · RFA' : ''}</td><td class="n">${money(h.p.contract.last_salary, 2)}</td><td class="n"><b>${money(h.amount, 2)}</b></td><td class="n">${money(O.value(h.p), 2)}</td>
        <td>${canRenounce ? `<button class="go ghost small" data-renounce="${h.p.player_id}">권리 포기</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div><p class="muted small">권리를 포기하면 캡 홀드가 사라져 캡 공간이 생기지만, 그 선수를 버드 권리로 재계약할 수 없게 돼요. 되돌릴 수 없어요.</p>` : '<p class="muted">캡 홀드가 걸린 FA가 없어요.</p>'}
    ${sh.pickHolds.length ? `<h3>신인 홀드</h3><p>${sh.pickHolds.map((h) => `${esc(h.label)} ${money(h.amount, 2)}`).join(' · ')}</p>` : ''}
    ${sh.emptySpots ? `<p class="muted small">계약 선수 ${sh.count}명이라 12명까지 빈 자리 ${sh.emptySpots}개에 ${money(L.roster_charge, 2)}씩 잡혀요.</p>` : ''}

    <h3>지금 쓸 수 있는 계약 수단</h3>
    <div class="tools">${tools(sh).map((x) => `<div><span class="small muted">${esc(x.name)}</span><b>${x.amount ? money(x.amount, 1) : '—'}</b><span class="small muted">${esc(x.note)}</span></div>`).join('')}</div>
  </div></div>`;
}
function bindCapSheet(main) {
  main.querySelectorAll('[data-renounce]').forEach((b) => b.onclick = () => {
    const p = state.data.free_agents.find((x) => x.player_id === b.dataset.renounce);
    const hold = faHold(p);
    notice(`${p.name}의 권리를 포기할까요?`, `캡 홀드 ${money(hold, 2)}가 사라져 캡 공간이 생겨요. 대신 버드 권리가 없어져서, 다시 데려오려면 캡 공간이나 예외 조항을 써야 해요. 되돌릴 수 없어요.`, () => {
      O.log({ t: 'renounce', pid: p.player_id, team: state.save.team });
      track('renounce', { pid: p.player_id, hold, value: O.value(p), phase: state.save.phase });
      renderFinance(main);
    }, { cancel: true, ok: '권리 포기' });
  });
}
