// 드래프트 유망주, 리그(다른 팀), FA 시장, 기록 보기(개발용)
import { esc, money, num, table, lastSeason, inches } from '../util.js';
import { state, myTeam, picksOf } from '../store.js';
import { teamPayroll, capStatus } from '../rules.js';
import { events, clearEvents, GAME_VERSION } from '../analytics.js';
import '../glossary.js';

// 유망주의 드래프트 직전 시즌 기록 한 줄 (대학 > 해외 > G리그 > 기타, 정규시즌 우선)
function latestLine(p) {
  const lines = [
    ...(p.college_seasons || []).map((r) => ({ ...r, src: r.college_id })),
    ...(p.pro_seasons || []).filter((r) => r.competition !== 'national_team').map((r) => ({ ...r, src: r.league })),
    ...(p.gleague_seasons || []).filter((r) => r.phase === 'regular').map((r) => ({ ...r, src: 'G리그' })),
    ...(p.other_seasons || []).map((r) => ({ ...r, src: r.league })),
  ].filter((r) => r.pts_per_g !== null && r.pts_per_g !== undefined);
  if (!lines.length) return null;
  const top = lines.reduce((a, b) => (b.season > a.season ? b : a)).season;
  const same = lines.filter((r) => r.season === top);
  return same.find((r) => r.phase !== 'playoffs') || same[0];
}

export function renderDraft(main) {
  const d = state.data, t = myTeam();
  const picks = picksOf(t.abbr);
  main.innerHTML = `<h1>드래프트 유망주</h1>
    <p class="sub">우리 지명권: ${picks.length ? picks.map((o) => `${o.round}라운드 ${o.pick}순위`).join(', ') : '없음'} · 지명은 다음 단계에서 열려요. 유망주를 누르면 자세히 볼 수 있어요.</p>
    <div class="panel">${table('draft', d.draft_pool, [
      { k: 'rank', label: '예상 순위', tip: 'big_board', n: 1, get: (p) => p.pre_draft_rank?.rank ?? null, fmt: (v, p) => (v ?? `<span class="muted">${esc(p.pre_draft_rank?.note || '—')}</span>`) },
      { k: 'name', label: '이름', get: (p) => p.name },
      { k: 'pos', label: '포지션', get: (p) => p.position },
      { k: 'age', label: '나이', n: 1, get: (p) => p.age_at_draft },
      { k: 'from', label: '소속', get: (p) => p.pre_draft_team },
      { k: 'pts', label: '득점', n: 1, get: (p) => latestLine(p)?.pts_per_g ?? null, fmt: (v) => num(v) },
      { k: 'trb', label: '리바운드', n: 1, get: (p) => latestLine(p)?.trb_per_g ?? null, fmt: (v) => num(v) },
      { k: 'ast', label: '어시스트', n: 1, get: (p) => latestLine(p)?.ast_per_g ?? null, fmt: (v) => num(v) },
      { k: 'ht', label: '키(맨발)', tip: 'barefoot', n: 1, get: (p) => p.combine?.height_barefoot ?? null, fmt: (v) => inches(v) },
      { k: 'ws', label: '윙스팬', tip: 'wingspan', n: 1, get: (p) => p.combine?.wingspan ?? null, fmt: (v) => inches(v) },
    ], { sortKey: 'rank', sortDir: 1, rowClick: (p) => `prospect:${p.player_id}` })}</div>`;
}

export function renderLeague(main) {
  const d = state.data, season = d.season, mine = state.save.team;
  main.innerHTML = `<h1>리그</h1><p class="sub">${esc(season)} 시즌 준비 중인 30개 팀 · 팀을 누르면 로스터를 볼 수 있어요</p>
    <div class="panel">${table('league', d.teams, [
      { k: 'name', label: '팀', get: (t) => t.name },
      { k: 'w', label: '지난 시즌 승', n: 1, get: (t) => t.prev_season.w },
      { k: 'l', label: '패', n: 1, get: (t) => t.prev_season.l },
      { k: 'srs', label: 'SRS', tip: 'srs', n: 1, get: (t) => t.prev_season.srs, fmt: (v) => num(v, 2) },
      { k: 'pay', label: '총연봉', tip: 'payroll', n: 1, get: (t) => teamPayroll(t, season), fmt: (v) => money(v) },
      { k: 'st', label: '샐러리 위치', get: (t) => capStatus(teamPayroll(t, season)).t },
      { k: 'n', label: '선수', n: 1, get: (t) => t.roster.length },
    ], { sortKey: 'w', rowClick: (t) => `team:${t.abbr}`, mine: (t) => t.abbr === mine })}</div>`;
}

export function renderFA(main) {
  const d = state.data, mine = state.save.team;
  main.innerHTML = `<h1>FA 시장</h1><p class="sub">드래프트 당일 계약이 없는 선수 ${d.free_agents.length}명 · FA 협상은 다음 단계에서 열려요</p>
    <div class="panel">${table('fa', d.free_agents, [
      { k: 'name', label: '이름', get: (p) => p.name },
      { k: 'pos', label: '포지션', get: (p) => p.pos },
      { k: 'age', label: '나이', n: 1, get: (p) => p.age },
      { k: 'pts', label: '득점', n: 1, get: (p) => lastSeason(p)?.pts_per_game ?? null, fmt: (v) => num(v) },
      { k: 'trb', label: '리바운드', n: 1, get: (p) => lastSeason(p)?.trb_per_game ?? null, fmt: (v) => num(v) },
      { k: 'ast', label: '어시스트', n: 1, get: (p) => lastSeason(p)?.ast_per_game ?? null, fmt: (v) => num(v) },
      { k: 'rights', label: '권리 팀', tip: 'rights_team', get: (p) => p.contract?.rights_team ?? null },
      { k: 'type', label: '유형', tip: 'fa_type', get: (p) => p.contract?.fa_type ?? null },
    ], { sortKey: 'pts', rowClick: (p) => `player:${p.player_id}`, mine: (p) => p.contract?.rights_team === mine })}</div>`;
}

export function renderDebug(main) {
  const ev = events();
  main.innerHTML = `<h1>플레이 기록 (개발용)</h1><p class="sub">게임 버전 ${GAME_VERSION} · 이 브라우저에 쌓인 기록 ${ev.length}건. 서버가 생기면 자동으로 보내요.</p>
    <p><button class="go" id="dl">기록 내려받기 (JSON)</button> <button class="go ghost" id="clr">기록 지우기</button></p>
    ${(() => { let fb = []; try { fb = JSON.parse(localStorage.getItem('nbagm_feedback') || '[]'); } catch { /* 없음 */ }
      return fb.length ? `<div class="panel"><h2>보낸 의견 ${fb.length}건</h2><div class="body"><ul>${fb.slice().reverse().map((f) => `<li><span class="muted small">${esc(new Date(f.ts).toLocaleString('ko-KR'))} · ${esc(f.year ?? '')} ${esc(f.team ?? '')} · ${esc(f.view ?? '')}</span><br>${esc(f.text)}</li>`).join('')}</ul></div></div>` : ''; })()}
    <div class="panel"><div class="scroll"><table class="t"><thead><tr><th>시각</th><th>행동</th><th>연도</th><th>팀</th><th>내용</th></tr></thead><tbody>
    ${ev.slice(-60).reverse().map((e) => `<tr><td>${esc(new Date(e.ts).toLocaleString('ko-KR'))}</td><td>${esc(e.event)}</td><td>${esc(e.year ?? '')}</td><td>${esc(e.team ?? '')}</td><td>${esc(JSON.stringify(e.props))}</td></tr>`).join('')}
    </tbody></table></div></div>`;
  main.querySelector('#dl').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(events(), null, 1)], { type: 'application/json' }));
    a.download = 'nbagm_events.json'; a.click();
  };
  main.querySelector('#clr').onclick = () => { clearEvents(); renderDebug(main); };
}
