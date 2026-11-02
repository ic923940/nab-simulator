// 스카우트 리포트 화면: 선수마다 3줄 보고서 카드 (우리 팀 / 드래프트 유망주 / FA / 다른 팀)
import { esc, money } from '../util.js';
import { state, teamBy } from '../store.js';
import { track } from '../analytics.js';
import { report } from '../scout.js';

const ui = { tab: null, team: null, q: '' };
const TABS = [['mine', '우리 팀'], ['pool', '드래프트 유망주'], ['fa', 'FA'], ['team', '다른 팀']];
const preDraft = () => ['lottery', 'trade', 'draft'].includes(state.save.phase);
const defaultTab = () => (preDraft() ? 'pool' : state.save.phase === 'fa' ? 'fa' : 'mine');

function list() {
  const s = state.save, me = s.team;
  if (ui.tab === 'mine') return teamBy(me).roster.map((p) => ({ p, open: `player:${p.player_id}`, tag: p.roster_role === 'two_way' ? '투웨이' : p.rookie ? `신인 ${p.rookie.pick ? p.rookie.pick + '순위' : ''}` : '' }));
  if (ui.tab === 'pool') {
    const made = Object.fromEntries((s.draft?.made || []).map((m) => [m.id, m]));
    return state.data.draft_pool.slice().sort((a, b) => (a.pre_draft_rank?.rank ?? 999) - (b.pre_draft_rank?.rank ?? 999))
      .map((p) => ({ p, open: `prospect:${p.player_id}`, tag: made[p.player_id] ? `${made[p.player_id].pick}순위 ${made[p.player_id].team}` : p.pre_draft_rank?.rank ? `빅보드 ${p.pre_draft_rank.rank}위` : '' }));
  }
  if (ui.tab === 'fa') return state.data.free_agents.slice().sort((a, b) => (b.market_value?.salary || 0) - (a.market_value?.salary || 0))
    .map((p) => ({ p, open: `player:${p.player_id}`, tag: `${p.contract?.fa_type || 'FA'}${p.contract?.rights_team ? ' · ' + p.contract.rights_team : ''}` }));
  const t = teamBy(ui.team || state.data.teams.find((x) => x.abbr !== me).abbr);
  return t.roster.map((p) => ({ p, open: `player:${p.player_id}`, tag: p.roster_role === 'two_way' ? '투웨이' : '' }));
}

export function renderScout(main) {
  if (!ui.tab) ui.tab = defaultTab();
  const me = state.save.team, q = ui.q.trim().toLowerCase();
  let rows = list();
  if (q) rows = rows.filter((r) => r.p.name.toLowerCase().includes(q));
  const shown = rows.slice(0, 60);
  const others = state.data.teams.filter((t) => t.abbr !== me).sort((a, b) => a.name.localeCompare(b.name));
  main.innerHTML = `<h1>스카우트 리포트</h1>
    <p class="sub">스카우트가 선수마다 세 줄로 정리한 보고서예요. 어디서 어떻게 뛰었는지, 기록으로 본 강점과 약점, 몸과 나이를 담았어요. 드래프트 날까지의 자료로만 써요. 이름을 누르면 자세한 기록이 열려요.</p>
    <div class="scout-bar"><div class="chips">${TABS.map(([k, l]) => `<button class="chip ${ui.tab === k ? 'on' : ''}" data-st="${k}">${l}</button>`).join('')}</div>
      ${ui.tab === 'team' ? `<select id="sc-team" aria-label="구단">${others.map((t) => `<option value="${t.abbr}" ${t.abbr === (ui.team || others[0].abbr) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>` : ''}
      <input class="search" id="sc-q" placeholder="이름 검색" value="${esc(ui.q)}" aria-label="선수 이름 검색"></div>
    <div class="scards">${shown.map(({ p, open, tag }) => { const ls = report(p), pos = p.pos || p.position || '', age = p.age ?? p.age_at_draft;
      return `<article class="scard"><header><a href="#" data-open="${esc(open)}" class="nm">${esc(p.name)}</a> <span class="muted small">${esc(pos)}${age ? ` · ${age}세` : ''}${tag ? ` · ${esc(tag)}` : ''}</span>${p.market_value?.salary ? `<span class="mv small">${money(p.market_value.salary, 1)}</span>` : ''}</header>
        <ol>${ls.map((l) => `<li>${esc(l)}</li>`).join('')}</ol></article>`; }).join('') || '<p class="muted">해당하는 선수가 없어요.</p>'}</div>
    ${rows.length > shown.length ? `<p class="muted small">${shown.length}명까지 보여요 (전체 ${rows.length}명). 이름으로 찾아보세요.</p>` : ''}`;
  main.querySelectorAll('[data-st]').forEach((b) => b.onclick = () => { ui.tab = b.dataset.st; track('scout_tab', { tab: ui.tab }); renderScout(main); });
  main.querySelector('#sc-team')?.addEventListener('change', (e) => { ui.team = e.target.value; track('scout_team', { team: ui.team }); renderScout(main); });
  const inp = main.querySelector('#sc-q');
  inp.oninput = () => { ui.q = inp.value; const pos = inp.selectionStart; renderScout(main); const n = main.querySelector('#sc-q'); n.focus(); n.setSelectionRange(pos, pos); };
}
