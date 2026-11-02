// 앱 시작점: 화면 틀(위 막대 + 왼쪽 메뉴), 화면 이동, 상세 창
import { esc, applyTeamColor, toggleSort } from './util.js';
import { state, loadSave, loadYear, myTeam, clearSave, loadShared, writeSave } from './store.js';
import { track, screenView, setContext } from './analytics.js';
import { resetTermLog } from './glossary.js';
import { notice } from './ui.js';
import { renderStart } from './views/start.js';
import { renderHome, renderRoster, renderFinance } from './views/team.js';
import { renderDraft, renderLeague, renderFA, renderDebug } from './views/league.js';
import { playerHTML, prospectHTML, teamHTML } from './views/player.js';
import { renderLottery } from './views/lottery.js';
import { renderTrade } from './views/trade.js';
import { renderDraftRoom } from './views/draft.js';
import { renderOffseason } from './views/offseason.js';
import { renderFAView } from './views/fa.js';
import { renderCuts } from './views/cuts.js';
import { renderOutlook } from './views/outlook.js';
import { renderPTrade } from './views/ptrade.js';
import { renderExt } from './views/ext.js';
import { dayOffers } from './ptrade.js';
import { renderSummer } from './views/summer.js';
import { renderHistory } from './views/history.js';
import { renderScout } from './views/scout.js';
import { curStep } from './fa.js';
import { replay } from './offseason.js';

const root = document.getElementById('root');
const VIEWS = {
  home: ['홈', renderHome], roster: ['로스터', renderRoster], finance: ['재정', renderFinance],
  lottery: ['로터리', renderLottery], trade: ['지명권 트레이드', renderTrade],
  draft: ['드래프트', renderDraftRoom], offseason: ['계약 정리', renderOffseason], fa: ['FA 협상', renderFAView], cuts: ['로스터 정리', renderCuts], ptrade: ['선수 트레이드', renderPTrade], ext: ['연장 계약', renderExt], summer: ['서머리그', renderSummer], history: ['실제 역사와 비교', renderHistory], outlook: ['시즌 전망', renderOutlook], league: ['리그', renderLeague],
  debug: ['플레이 기록', renderDebug], scout: ['스카우트 리포트', renderScout],
};
// 왼쪽 메뉴는 '우리 팀'만. 단계 화면은 메뉴에 없고 위 막대 버튼과 화면 위 탭으로 감 (주소로는 열림)
const MENU = ['roster', 'finance', 'scout'];
// 단계마다: 위 막대 버튼 [글자, 화면] + 그 단계에서 함께 열리는 화면(탭)
const PHASE_BTN = { lottery: ['로터리', 'lottery'], trade: ['지명권 트레이드', 'trade'], draft: ['드래프트', 'draft'], draft_done: ['드래프트 결과', 'draft'], offseason: ['계약 정리', 'offseason'], fa: ['FA 협상', 'fa'], roster: ['로스터 정리', 'cuts'], preseason: ['시즌 전망', 'outlook'] };
export const STAGE_TABS = { fa: ['fa', 'ptrade', 'ext', 'summer'], roster: ['cuts', 'ptrade', 'ext', 'summer'], preseason: ['outlook', 'history'] };
const stageViews = () => { const ph = state.save?.phase, b = PHASE_BTN[ph]; return STAGE_TABS[ph] || (b ? [b[1]] : []); };
// 받침에 맞춘 '로/으로'
const ro = (w) => { const c = w.charCodeAt(w.length - 1) - 0xac00; if (c < 0 || c > 11171) return '로'; const j = c % 28; return j === 0 || j === 8 ? '로' : '으로'; };
const go = (v) => { location.hash = '#/' + v; };

let current = null;

function shell() {
  const t = myTeam(), d = state.data;
  applyTeamColor(t.abbr);
  root.innerHTML = `
  <div class="app">
    <header class="topbar">
      <a class="team-name" href="#/home" title="홈">${esc(t.name)}</a>
      <span class="when" id="when"></span>
      <span class="spacer"></span>
      <button class="next" id="next"></button>
    </header>
    <nav class="side" aria-label="메뉴">
      <div class="group">우리 팀</div>
      ${MENU.map((k) => `<a href="#/${k}" data-v="${k}">${VIEWS[k][0]}</a>`).join('')}
      <a href="#" class="fb-link" id="fb-open">의견 보내기</a>
      <form class="fbk" id="fb-form"><label for="fb-text">의견 보내기</label>
        <textarea id="fb-text" rows="3" maxlength="1000" placeholder="불편한 점, 헷갈린 점, 아이디어를 적어 주세요"></textarea>
        <button class="go small" type="submit">보내기</button><span class="small" id="fb-ok" role="status"></span></form>
      <a href="#/new" data-v="new" class="newgame">새 게임</a>
    </nav>
    <div class="mainwrap"><nav class="stagetabs" id="stagetabs" aria-label="이 단계에서 할 수 있는 것"></nav><main class="main" id="main"></main></div>
  </div>`;
  bindFeedback();
}

// 의견 보내기: 지금 보던 화면·단계와 함께 저장 (서버가 생기면 함께 보냄)
function sendFeedback(text) {
  text = text.trim(); if (!text) return false;
  const s = state.save || {}, item = { text, view: current, year: s.year, team: s.team, phase: s.phase, ts: new Date().toISOString() };
  try { const k = 'nbagm_feedback', a = JSON.parse(localStorage.getItem(k) || '[]'); a.push(item); localStorage.setItem(k, JSON.stringify(a.slice(-200))); } catch { /* 저장 불가 */ }
  track('feedback', { text, view: current });
  return true;
}
function bindFeedback() {
  const f = root.querySelector('#fb-form'); if (!f) return;
  f.onsubmit = (e) => { e.preventDefault(); const t = f.querySelector('#fb-text'); if (sendFeedback(t.value)) { t.value = ''; f.querySelector('#fb-ok').textContent = '고마워요! 저장했어요.'; setTimeout(() => (f.querySelector('#fb-ok').textContent = ''), 3000); } };
  root.querySelector('#fb-open').onclick = (e) => {   // 휴대폰: 메뉴 대신 창으로
    e.preventDefault(); document.getElementById('fb-modal')?.remove();
    const el = document.createElement('div'); el.id = 'fb-modal'; el.className = 'notice-bg';
    el.innerHTML = `<div class="notice" role="dialog" aria-modal="true"><h2>의견 보내기</h2><textarea id="fbm-text" rows="5" maxlength="1000" placeholder="불편한 점, 헷갈린 점, 아이디어를 적어 주세요" style="width:100%"></textarea>
      <p><button class="go" id="fbm-send">보내기</button> <button class="go ghost" id="fbm-close">닫기</button></p></div>`;
    document.body.append(el); el.querySelector('textarea').focus();
    el.querySelector('#fbm-close').onclick = () => el.remove();
    el.querySelector('#fbm-send').onclick = () => { if (sendFeedback(el.querySelector('textarea').value)) { el.remove(); notice('고마워요!', '의견을 저장했어요. 다음 업데이트에 참고할게요.'); } };
  };
}
// 메뉴 '선수 트레이드' 옆에 열린 제안 수 표시 (날짜가 바뀌면 새 제안이 올 수 있음)
const offersN = () => { try { return ['fa', 'roster'].includes(state.save.phase) ? dayOffers().length : 0; } catch { return 0; } };
function offerBadge() {
  const a = root.querySelector('#stagetabs a[data-v="ptrade"]'); if (!a) return;
  const n = offersN();
  a.innerHTML = `선수 트레이드${n ? ` <span class="badge">${n}</span>` : ''}`;
}
// 화면 위 탭: 지금 단계에서 함께 할 수 있는 화면들 (단계 화면에 있을 때만)
function stageTabs(view) {
  const el = document.getElementById('stagetabs'); if (!el) return;
  const vs = stageViews();
  if (vs.length < 2 || !vs.includes(view)) { el.innerHTML = ''; el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = vs.map((k) => `<a href="#/${k}" data-v="${k}" class="${k === view ? 'on' : ''}">${VIEWS[k][0]}</a>`).join('');
}
function show(view) {
  const tb = root.querySelector('.topbar'); if (tb) document.documentElement.style.setProperty('--tb', tb.offsetHeight + 'px');   // 위 막대 높이 (고정 메뉴 위치 계산용)
  if (!VIEWS[view]) view = 'home';
  current = view;
  root.querySelectorAll('.side a').forEach((a) => a.classList.toggle('on', a.dataset.v === view));
  stageTabs(view);
  const on = root.querySelector('.side a.on'); if (on && innerWidth <= 760) on.scrollIntoView({ block: 'nearest', inline: 'center' });   // 휴대폰: 가로 메뉴에서 지금 화면이 보이게
  const mainEl = document.getElementById('main');
  mainEl.classList.add('enter'); clearTimeout(show.t); show.t = setTimeout(() => mainEl.classList.remove('enter'), 260);   // 메뉴를 바꿀 때만 짧게 떠오르기
  VIEWS[view][1](mainEl, go);
  phaseButton();
  offerBadge();
  document.title = `${VIEWS[view][0]} · NBA 단장`;
  resetTermLog();
  screenView(view);
}

// 상세 창 (선수 / 유망주 / 팀)
let drawerSpec = null;
function openDrawer(spec, quiet = false) {
  const [kind, id] = spec.split(':');
  drawerSpec = spec;
  const html = kind === 'player' ? playerHTML(id) : kind === 'prospect' ? prospectHTML(id) : teamHTML(id);
  closeDrawer();
  const bg = document.createElement('div'); bg.className = 'drawer-bg'; bg.id = 'drawer-bg';
  const dr = document.createElement('aside'); dr.className = 'drawer'; dr.id = 'drawer'; dr.setAttribute('role', 'dialog');
  dr.innerHTML = `<button class="close" id="drawer-close">닫기</button>${html}`;
  document.body.append(bg, dr);
  bg.onclick = closeDrawer; dr.querySelector('#drawer-close').onclick = closeDrawer;
  dr.querySelector('#drawer-close').focus();
  if (!quiet) track(kind + '_open', { id, from: current });
}
function closeDrawer() { document.getElementById('drawer')?.remove(); document.getElementById('drawer-bg')?.remove(); }
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

// 표 정렬·행 클릭은 한 곳에서 처리
document.addEventListener('click', (e) => {
  if (e.target.closest('.term')) return;   // 용어 설명을 누른 건 정렬·열기가 아님
  const s = e.target.closest('[data-sort]');
  if (s) {
    toggleSort(s.dataset.sort);
    track('table_sort', { table: s.dataset.sort });
    if (s.closest('#drawer')) openDrawer(drawerSpec, true);
    else VIEWS[current][1](document.getElementById('main'), go);
    return;
  }
  const o = e.target.closest('[data-open]');
  if (o) { e.preventDefault(); openDrawer(o.dataset.open); }   // href="#" 때문에 홈으로 넘어가지 않게
});

// 위 막대 버튼: 지금 단계로 이동
function phaseButton() {
  const w = document.getElementById('when');
  if (w) w.textContent = state.save.phase === 'fa' ? `${state.data.season} 오프시즌 · FA ${+curStep().date.slice(5, 7)}월 ${+curStep().date.slice(8, 10)}일` : state.save.phase === 'roster' ? `${state.data.season} 트레이닝 캠프 · 로스터 정리` : state.save.phase === 'preseason' ? `${state.data.season} 개막 로스터 확정` : `${state.data.season} 오프시즌 · ${state.data.contract_info.as_of} 드래프트 당일`;
  const b = document.getElementById('next'); if (!b) return;
  const [txt, to] = PHASE_BTN[state.save.phase] || PHASE_BTN.draft_done, here = stageViews().includes(current), n = offersN();
  // 단계 화면 밖이면 '지금 단계로 가기', 단계 화면 안이면 지금 단계 이름만 (드래프트가 끝났으면 다음 단계로)
  const nextStep = state.save.phase === 'draft_done' && here;
  b.innerHTML = nextStep ? '옵션·QO·신인 계약으로 →' : here ? `지금: ${esc(txt)}` : `${esc(txt)}${ro(txt)} 가기 →${n ? ` <span class="badge">${n}</span>` : ''}`;
  b.classList.toggle('here', here && !nextStep);
  b.title = here && !nextStep ? '지금 단계 화면이에요. 화면 안의 진행 버튼으로 다음으로 넘어가요.' : '';
  b.onclick = () => {
    if (here && !nextStep) return;
    if (state.save.phase === 'draft_done' && here) { notice('이제 오프시즌 계약 정리로 넘어갑니다', '드래프트가 끝났어요. 실제 NBA처럼 옵션 결정 → 퀄리파잉 오퍼 → 신인 계약 순서로 진행해요.', () => { state.save.phase = 'offseason'; writeSave(); phaseButton(); go('offseason'); }); return; }
    go(to);
  };
}

async function route() {
  const view = (location.hash.replace('#/', '') || 'home');
  if (view === 'new') {
    if (state.save) track('game_abandon', { year: state.save.year, team: state.save.team });
    clearSave(); location.hash = ''; return boot();
  }
  if (!state.save || !state.data) return boot();
  if (!document.getElementById('main')) shell();
  closeDrawer();
  show(view);
}

async function boot() {
  const save = loadSave();
  if (save && location.hash) {
    try {
      state.data = await loadYear(save.year);
      await loadShared();
      replay();
      setContext({ year: save.year, team: save.team, mode: save.mode });
      shell(); return show(location.hash.replace('#/', '') || 'home');
    } catch { /* 시작 화면으로 */ }
  }
  state.data = null;
  applyTeamColor(null);
  screenView('start');
  renderStart(root, (v) => {
    if (location.hash === '#/' + v) { shell(); show(v); } else location.hash = '#/' + v;
  });
}

addEventListener('hashchange', route);
addEventListener('phasechange', () => { stageTabs(current); phaseButton(); offerBadge(); });
track('app_open', { ua_mobile: matchMedia('(max-width: 760px)').matches });
boot();
