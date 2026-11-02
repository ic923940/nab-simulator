// 시작 화면: 연도 → 팀 → 진행 모드 → 기록 동의 → 시작
import { esc, money, TEAM_COLORS, applyTeamColor } from '../util.js';
import { YEARS, loadYear, state, writeSave, loadSave, loadShared } from '../store.js';
import { replay } from '../offseason.js';
import { track, consent, setConsent, setContext } from '../analytics.js';

const pick = { year: null, team: null, mode: 'quick' };

export async function renderStart(root, go) {
  const save = loadSave();
  const DAY = ['일', '월', '화', '수', '목', '금', '토'];
  const dateOf = (y) => YEARS.find((x) => x.y === y)?.draft;
  root.innerHTML = `
  <div class="start2">
    <header class="s-hero"><div class="s-hero-in">
      <div class="s-brand"><h1><small>드래프트 당일로 돌아가는 단장 게임</small>NBA 단장</h1>
        <p>2020~2025년 드래프트 가운데 하루를 골라 한 팀의 단장이 됩니다. 그날까지 알려진 정보만으로 지명하고, 협상하고, 로스터를 꾸리세요.</p></div>
      <div class="s-board" id="s-board" aria-live="polite"></div>
    </div></header>
    <div class="s-body">
      ${save ? `<div class="s-resume"><button class="go" id="resume">이어하기</button><span><b>${esc(save.year)} 드래프트 · ${esc(save.team)}</b> 진행 중인 게임이 있어요.</span>${save.old ? '<p class="warn small">예전 버전에서 시작한 게임이에요. 그 뒤로 화면과 규칙이 많이 바뀌어서 일부가 맞지 않을 수 있어요. 새 게임을 추천해요.</p>' : ''}</div>` : ''}
      <section class="s-step"><h2><i>1</i>드래프트 고르기 <span>그해 드래프트 당일 아침으로 갑니다</span></h2><div class="s-years" id="years"></div></section>
      <section class="s-step"><h2><i>2</i>팀 고르기 <span>지난 시즌 성적과 지금 총연봉</span></h2><div id="teams"><p class="s-wait">드래프트를 먼저 고르면 그해 30개 팀이 나와요.</p></div></section>
      <section class="s-step" hidden><h2>진행 방식</h2><div class="choices" id="modes"></div></section>
    </div>
    <div class="s-go"><div class="s-go-in">
      <label><input type="checkbox" id="consent" ${consent() ? 'checked' : ''}>
        <span>게임 개선을 위해 익명 플레이 기록(고른 팀, 결정, 머문 화면 등)을 남깁니다. 이름·이메일 같은 개인정보는 모으지 않아요. 언제든 끌 수 있어요.</span></label>
      <button class="go" id="start" disabled>시작하기</button>
    </div></div>
  </div>`;

  const boardEl = root.querySelector('#s-board');
  const drawBoard = () => {
    const d = pick.year && dateOf(pick.year), t = pick.team && teamsCache.find((x) => x.abbr === pick.team);
    const [yy, mm, dd] = (d || '----.--.--').split(/[-.]/);
    boardEl.innerHTML = `<div class="k">${d ? `${pick.year} 드래프트 · ${+mm}월 ${+dd}일 (${DAY[new Date(d + 'T12:00:00').getDay()]})` : '드래프트 날짜'}</div>
      <div class="date${d ? '' : ' off'}">${d ? `${yy}.${mm}.${dd}` : '----.--.--'}</div>
      <div class="club${t ? '' : ' off'}">${t ? esc(t.name) + ' 단장' : pick.year ? '맡을 팀을 고르세요' : '드래프트를 고르세요'}</div>`;
  };
  let teamsCache = [];
  drawBoard();

  const yearsEl = root.querySelector('#years');
  const drawYears = () => {
    yearsEl.innerHTML = YEARS.map(({ y, draft }) => `
      <button class="s-year${pick.year === y ? ' on' : ''}" data-y="${y}" aria-pressed="${pick.year === y}">
        <b>${y}</b><small>${y}-${String(y + 1).slice(2)} 시즌<br>드래프트 ${+draft.slice(5, 7)}월 ${+draft.slice(8, 10)}일</small></button>`).join('');
  };
  drawYears();

  const modes = [
    { k: 'quick', t: '빠른 모드', d: '경기는 결과와 기록만 보여주고, 중요한 일이 생기면 멈춰요.' },
    { k: 'detail', t: '정밀 모드', d: '경기를 점수판으로 지켜봐요. 기본 16배속, 한 경기 약 3분.' },
  ];
  const modesEl = root.querySelector('#modes');
  const drawModes = () => {
    modesEl.innerHTML = modes.map((m) => `<button class="choice${pick.mode === m.k ? ' on' : ''}" data-m="${m.k}"><b>${m.t}</b><small>${m.d}</small></button>`).join('');
  };
  drawModes();

  const startBtn = root.querySelector('#start');
  const ready = () => { startBtn.disabled = !(pick.year && pick.team); };

  yearsEl.onclick = async (e) => {
    const b = e.target.closest('[data-y]'); if (!b) return;
    pick.year = +b.dataset.y; pick.team = null; teamsCache = []; drawYears(); drawBoard(); ready();
    track('start_year_select', { year: pick.year });
    const teamsEl = root.querySelector('#teams');
    teamsEl.innerHTML = '<p class="s-wait">불러오는 중…</p>';
    try {
      const d = await loadYear(pick.year);
      const rows = d.teams.slice().sort((a, b) => a.name.localeCompare(b.name));
      teamsCache = rows; drawBoard();
      teamsEl.innerHTML = `<div class="s-teams">${rows.map((t) => { const ps = t.prev_season; return `
        <button class="s-team" data-t="${t.abbr}" style="--c:${TEAM_COLORS[t.abbr]}" aria-pressed="false">
          <span class="ab">${t.abbr}</span><span class="nm">${esc(t.name)}</span>
          <span class="rec"><b>${ps.w}승 ${ps.l}패</b>${ps.playoffs ? ' · 플레이오프' : ''}</span><span class="pay">총연봉 ${money(t.cap_total_this_season)}</span>
        </button>`; }).join('')}</div>`;
    } catch (err) {
      teamsEl.innerHTML = `<p class="bad">${esc(err.message)}. 게임 폴더의 run_web.bat 으로 열었는지 확인하세요.</p>`;
    }
  };
  root.querySelector('#teams').onclick = (e) => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    pick.team = b.dataset.t;
    root.querySelectorAll('[data-t]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    applyTeamColor(pick.team); drawBoard(); ready();
    track('start_team_select', { year: pick.year, team: pick.team });
  };
  modesEl.onclick = (e) => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    pick.mode = b.dataset.m; drawModes();
    track('start_mode_select', { mode: pick.mode });
  };
  root.querySelector('#consent').onchange = (e) => setConsent(e.target.checked);

  startBtn.onclick = async () => {
    state.save = { year: pick.year, team: pick.team, mode: pick.mode, startedAt: new Date().toISOString(), phase: 'lottery',
      seed: Math.floor(Math.random() * 2 ** 31) };
    writeSave();
    state.data = await loadYear(pick.year);
    await loadShared();
    setContext({ year: pick.year, team: pick.team, mode: pick.mode });
    track('game_start', { year: pick.year, team: pick.team, mode: pick.mode });
    go('lottery');
  };
  const resume = root.querySelector('#resume');
  if (resume) resume.onclick = async () => {
    state.data = await loadYear(save.year);
    await loadShared();
    replay();
    setContext({ year: save.year, team: save.team, mode: save.mode });
    track('game_resume', { year: save.year, team: save.team });
    go('home');
  };
}
