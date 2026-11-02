// 시작 화면: 연도 → 팀 → 진행 모드 → 기록 동의 → 시작
import { esc, money, TEAM_COLORS, applyTeamColor } from '../util.js';
import { YEARS, loadYear, state, writeSave, loadSave, loadShared } from '../store.js';
import { replay } from '../offseason.js';
import { track, consent, setConsent, setContext } from '../analytics.js';

const pick = { year: null, team: null, mode: 'quick' };

export async function renderStart(root, go) {
  const save = loadSave();
  root.innerHTML = `
  <div class="start">
    <h1>NBA 단장</h1>
    <p class="lead">드래프트 당일로 돌아가 한 팀의 단장이 됩니다. 그날까지 알려진 정보만으로 결정하세요.</p>
    ${save ? `<div class="step"><button class="go" id="resume">이어하기: ${esc(save.year)} ${esc(save.team)}</button>${save.old ? '<p class="warn small">예전 버전에서 시작한 게임이에요. 그 뒤로 화면과 규칙이 많이 바뀌어서 일부가 맞지 않을 수 있어요. 새 게임을 추천해요.</p>' : ''}</div>` : ''}
    <section class="step"><h2>1. 시작할 드래프트</h2><div class="choices" id="years"></div></section>
    <section class="step"><h2>2. 맡을 팀</h2><div id="teams"><p class="muted">드래프트 연도를 먼저 고르세요.</p></div></section>
    <section class="step" hidden><h2>3. 진행 방식</h2><div class="choices" id="modes"></div></section>
    <section class="step">
      <label class="consent"><input type="checkbox" id="consent" ${consent() ? 'checked' : ''}>
        <span>게임 개선을 위해 익명 플레이 기록(고른 팀, 결정, 머문 화면 등)을 남깁니다. 이름·이메일 같은 개인정보는 모으지 않아요. 언제든 끌 수 있어요.</span></label>
      <button class="go" id="start" disabled>시작하기</button>
    </section>
  </div>`;

  const yearsEl = root.querySelector('#years');
  const drawYears = () => {
    yearsEl.innerHTML = YEARS.map(({ y, draft }) => `
      <button class="choice${pick.year === y ? ' on' : ''}" data-y="${y}">
        <b>${y} 드래프트</b><small>${y}-${String(y + 1).slice(2)} 시즌<br>드래프트 ${draft}</small></button>`).join('');
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
    pick.year = +b.dataset.y; pick.team = null; drawYears(); ready();
    track('start_year_select', { year: pick.year });
    const teamsEl = root.querySelector('#teams');
    teamsEl.innerHTML = '<p class="muted">불러오는 중…</p>';
    try {
      const d = await loadYear(pick.year);
      const rows = d.teams.slice().sort((a, b) => a.name.localeCompare(b.name));
      teamsEl.innerHTML = `<div class="choices teams">${rows.map((t) => `
        <button class="choice" data-t="${t.abbr}">
          <b><span class="swatch" style="background:${TEAM_COLORS[t.abbr]}"></span>${esc(t.name)}</b>
          <small>${esc(t.prev_season.season)} ${t.prev_season.w}승 ${t.prev_season.l}패${t.prev_season.playoffs ? ' · 플레이오프' : ''} · 총연봉 ${money(t.cap_total_this_season)}</small>
        </button>`).join('')}</div>`;
    } catch (err) {
      teamsEl.innerHTML = `<p class="bad">${esc(err.message)}. 게임 폴더의 run_web.bat 으로 열었는지 확인하세요.</p>`;
    }
  };
  root.querySelector('#teams').onclick = (e) => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    pick.team = b.dataset.t;
    root.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('on', x === b));
    applyTeamColor(pick.team); ready();
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
