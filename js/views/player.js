// 선수·유망주·팀 상세 창
import { esc, money, num, pct, inches, cm, OPTION_KO, lastSeason } from '../util.js';
import { state, teamBy } from '../store.js';
import { rosterTable } from './team.js';
import { term } from '../glossary.js';
import { report } from '../scout.js';
import { percentile } from '../draft.js';

// 드래프트 화면이 상세 창에 '지명' 버튼을 붙일 때 씀
export const hooks = { prospectAction: null };

const BIRD_KO = { full: '풀 버드', early: '얼리 버드', non: '논 버드' };
const KIND = () => state.data.contract_info.kinds || {};

export function findPlayer(id) {
  for (const t of state.data.teams) {
    const p = t.roster.find((x) => x.player_id === id);
    if (p) return { p, team: t };
  }
  const fa = state.data.free_agents.find((x) => x.player_id === id);
  return fa ? { p: fa, team: null } : null;
}

const scout3 = (p) => { const ls = report(p); return ls.length ? `<ol class="scout3" aria-label="스카우트 리포트">${ls.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>` : ''; };
export function playerHTML(id) {
  const f = findPlayer(id); if (!f) return '<p>선수를 찾지 못했어요.</p>';
  const { p, team } = f, c = p.contract || {};
  const ls = lastSeason(p);
  const contract = c.status === 'free_agent'
    ? `<p>FA (계약 없음) · ${c.rights_team ? `${term('rights_team', '권리 팀')} ${esc(c.rights_team)} · ${(c.fa_type || '').startsWith('RFA') ? term('rfa', c.fa_type) : term('ufa', c.fa_type || '')}${c.bird ? ` · ${term('bird', '버드 권리')}(${esc(BIRD_KO[c.bird] || c.bird)})` : ''}` : term('rights_team', '권리 팀 없음')}</p>`
    : `<div class="scroll"><table class="t"><thead><tr><th>시즌</th><th class="n">${term('salary', '연봉')}</th><th class="n">${term('cap_hit', '캡 반영액')}</th><th>옵션</th><th>계약 종류</th></tr></thead><tbody>
      ${(c.years || []).map((y) => `<tr><td>${esc(y.season)}</td><td class="n">${money(y.salary, 2)}</td><td class="n">${money(y.cap_hit ?? y.salary, 2)}</td><td>${y.option ? term(y.option, OPTION_KO[y.option] || y.option) : ''}</td><td>${esc(KIND()[y.kind] || y.kind || '')}</td></tr>`).join('')}
      </tbody></table></div><p class="muted">계약 끝나면 ${c.fa_after === 'RFA' ? term('rfa', 'RFA') : c.fa_after === 'UFA' ? term('ufa', 'UFA') : esc(c.fa_after || '—')}${c.notes ? ' · ' + esc([].concat(c.notes).join(' ')) : ''}</p>`;
  const hist = (p.nba_history || []).slice().reverse();
  return `
    <h2>${esc(p.name)}</h2>
    <p class="muted">${esc(p.pos)} · ${p.age}세 · ${inches(p.height_in)} (${cm(p.height_in)}) · ${p.weight_lb ? Math.round(p.weight_lb) + 'lb' : ''} · ${team ? esc(team.name) : 'FA'}${p.colleges ? ' · ' + esc(p.colleges) : ''}</p>
    ${p.honors?.length ? `<p>${p.honors.map((h) => `<span class="tag">${esc(h.season)} ${esc(h.honor)}</span>`).join(' ')}</p>` : ''}
    ${scout3(p)}
    <h3>계약</h3>${contract}
    <h3>NBA 기록 (정규시즌 경기당)</h3>
    ${hist.length ? `<div class="scroll"><table class="t"><thead><tr><th>시즌</th><th>팀</th><th class="n">경기</th><th class="n">분</th><th class="n">득점</th><th class="n">리바</th><th class="n">어시</th><th class="n">스틸</th><th class="n">블록</th><th class="n">야투</th><th class="n">3점</th><th class="n">자유투</th></tr></thead><tbody>
      ${hist.map((h) => `<tr><td>${esc(h.season)}</td><td>${esc((h.teams || []).join('/'))}</td><td class="n">${h.g ?? '—'}</td><td class="n">${num(h.mp_per_game)}</td><td class="n">${num(h.pts_per_game)}</td><td class="n">${num(h.trb_per_game)}</td><td class="n">${num(h.ast_per_game)}</td><td class="n">${num(h.stl_per_game)}</td><td class="n">${num(h.blk_per_game)}</td><td class="n">${pct(h.fg_percent)}</td><td class="n">${pct(h.x3p_percent)}</td><td class="n">${pct(h.ft_percent)}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">NBA 경기 기록 없음</p>'}`;
}

const PHASE_KO = { regular: '정규', playoffs: '플레이오프', combined: '정규+플레이오프', showcase: '쇼케이스' };
function statRows(title, rows, teamKey) {
  if (!rows?.length) return '';
  return `<h3>${title}</h3><div class="scroll"><table class="t"><thead><tr><th>시즌</th><th>소속</th><th>구분</th><th class="n">경기</th><th class="n">분</th><th class="n">득점</th><th class="n">리바</th><th class="n">어시</th><th class="n">야투</th><th class="n">3점</th><th class="n">자유투</th><th>출처</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${esc(r.season)}</td><td>${esc(r[teamKey] || r.team || r.college_id || '')}${r.league ? ' <span class="muted">' + esc(r.league) + '</span>' : ''}</td><td>${r.phase === 'combined' ? term('phase_combined', PHASE_KO.combined) : esc(PHASE_KO[r.phase] || (r.competition === 'national_team' ? '국가대표' : '정규'))}</td>
      <td class="n">${r.g ?? '—'}</td><td class="n">${num(r.mp_per_g)}</td><td class="n">${num(r.pts_per_g)}</td><td class="n">${num(r.trb_per_g)}</td><td class="n">${num(r.ast_per_g)}</td><td class="n">${pct(r.fg_pct)}</td><td class="n">${pct(r.fg3_pct)}</td><td class="n">${pct(r.ft_pct)}</td>
      <td>${r.source_url ? `<a href="${esc(r.source_url)}" target="_blank" rel="noopener">${r.source_kind === 'secondary' ? '보조' : '공식'}</a>${r.source_kind === 'secondary' ? ' ' + term('source_secondary', 'ⓘ') : ''}` : ''}</td></tr>`).join('')}
  </tbody></table></div>`;
}

// 측정값 한 줄 + 올해 유망주 중 위치 막대
function measureRow(label, val, key) {
  const pc = key === 'weight' || typeof val !== 'number' ? null : percentile(key, val, key === 'ws_diff' ? wsDiff : null);
  return `<dt>${label}</dt><dd>${val === null || val === undefined ? '—' : fmtMeasure(key, val)}${pc === null ? '' : `
    <span class="pbar"><span style="width:${Math.max(3, pc)}%"></span></span><span class="muted small">${rankText(pc)}</span>`}</dd>`;
}
// 위치 문구: 절반보다 위면 '상위 N%', 아래면 '하위 N%'
const rankText = (pc) => (pc >= 50 ? `상위 ${Math.max(1, 100 - pc)}%` : `하위 ${Math.max(1, pc + 1)}%`);
const wsDiff = (p) => (p.combine?.wingspan && p.combine?.height_barefoot ? p.combine.wingspan - p.combine.height_barefoot : null);
function fmtMeasure(key, v) {
  if (key === 'height_barefoot' || key === 'wingspan') return `${inches(v)} (${cm(v)})`;
  if (key === 'standing_reach') return inches(v);
  if (key === 'ws_diff') return `${v > 0 ? '+' : ''}${num(v, 1)}인치`;
  if (key === 'max_vertical' || key === 'standing_vertical') return `${num(v)}인치`;
  if (key === 'lane_agility' || key === 'three_quarter_sprint') return `${num(v, 2)}초`;
  if (key === 'weight') return `${num(v)} lb`;
  return num(v);
}

// 데이터로 만든 스카우트 리포트 (실제 스카우트 글이 아니라 기록·측정값을 문장으로 옮긴 것)
function lastLine(p) {
  const all = [...(p.college_seasons || []), ...(p.pro_seasons || []).filter((r) => r.competition !== 'national_team' && r.phase !== 'playoffs'), ...(p.gleague_seasons || []).filter((r) => r.phase === 'regular')]
    .filter((r) => r.pts_per_g !== null && r.pts_per_g !== undefined);
  return all.length ? all.reduce((a, b) => (b.season >= a.season ? b : a)) : null;
}
export function scoutReport(p) {
  const out = [], cb = p.combine || {}, L = lastLine(p);
  const d = wsDiff(p), pd = d === null ? null : percentile('ws_diff', d, wsDiff);
  if (d !== null && d >= 4) out.push(`윙스팬이 키보다 ${num(d, 1)}인치(약 ${Math.round(d * 2.54)}cm) 길어 수비 범위가 넓어요${pd !== null ? ` (올해 상위 ${Math.max(1, 100 - pd)}%)` : ''}.`);
  else if (d !== null && d <= 0.5) out.push('윙스팬이 키와 비슷해 팔 길이의 이점은 크지 않아요.');
  const pv = percentile('max_vertical', cb.max_vertical);
  if (pv !== null && pv >= 80) out.push(`도움닫기 점프 ${num(cb.max_vertical)}인치로 운동능력이 올해 상위 ${Math.max(1, 100 - pv)}%예요.`);
  const pa = percentile('lane_agility', cb.lane_agility);
  if (pa !== null && pa >= 80) out.push(`레인 어질리티 ${num(cb.lane_agility, 2)}초로 좌우 움직임이 빨라요.`);
  if (pa !== null && pa <= 15) out.push('민첩성 측정은 올해 하위권이에요.');
  if (L) {
    const a3 = L.fg3a ?? (L.fg3a_per_g && L.g ? L.fg3a_per_g * L.g : null), p3 = L.fg3_pct, ft = L.ft_pct, fta = L.fta ?? (L.fta_per_g && L.g ? L.fta_per_g * L.g : null);
    if (p3 !== null && p3 !== undefined && a3 !== null) {
      if (p3 >= 0.37 && a3 >= 100) out.push(`3점슛 ${Math.round(a3)}개 시도에 ${num(p3 * 100, 1)}% 성공: 슈터 자질이 보여요.`);
      else if (p3 >= 0.37 && a3 < 60) out.push(`3점 성공률(${num(p3 * 100, 1)}%)은 좋지만 시도가 ${Math.round(a3)}개뿐이라 표본이 작아요.`);
      else if (p3 < 0.3 && a3 >= 60) out.push(`3점 성공률 ${num(p3 * 100, 1)}%로 외곽슛은 보완이 필요해요.`);
    }
    if (ft !== null && ft !== undefined && (fta === null || fta >= 40)) {
      if (ft >= 0.8) out.push(`자유투 ${num(ft * 100, 1)}%: 슛 터치가 좋다는 신호예요.`);
      else if (ft < 0.65) out.push(`자유투 ${num(ft * 100, 1)}%로 슛 정확도는 물음표예요.`);
    }
    if (L.ts_pct >= 0.6) out.push(`트루 슈팅 ${num(L.ts_pct * 100, 1)}%로 효율적인 득점원이었어요.`);
    if (L.usg_pct >= 28) out.push(`공격 점유율 ${num(L.usg_pct, 1)}%로 팀 공격의 중심이었어요.`);
    if (L.ast_per_g >= 5) out.push(`경기당 어시스트 ${num(L.ast_per_g)}개: 경기 운영 능력이 있어요.`);
    if (L.trb_per_g >= 9) out.push(`경기당 리바운드 ${num(L.trb_per_g)}개로 골밑 장악력이 있어요.`);
    if (L.blk_per_g >= 2) out.push(`경기당 블록 ${num(L.blk_per_g)}개: 림 보호 능력이 있어요.`);
    if (L.stl_per_g >= 2) out.push(`경기당 스틸 ${num(L.stl_per_g)}개로 손질이 좋아요.`);
    if (L.mp_per_g !== null && L.mp_per_g < 15) out.push(`출전 시간이 경기당 ${num(L.mp_per_g)}분으로 적어서 기록만으로 판단하기 어려워요.`);
  }
  if (p.age_at_draft && p.age_at_draft <= 19) out.push(`드래프트 당시 ${p.age_at_draft}세로 어린 편이라 성장 여지가 커요.`);
  if (p.age_at_draft && p.age_at_draft >= 23) out.push(`드래프트 당시 ${p.age_at_draft}세: 바로 쓸 수 있는 대신 성장 폭은 작을 수 있어요.`);
  if (cb.skipped) out.push('컴바인 측정에 참가하지 않아 신체 정보가 부족해요.');
  return out;
}

export function prospectHTML(id) {
  const p = state.data.draft_pool.find((x) => x.player_id === id); if (!p) return '<p>유망주를 찾지 못했어요.</p>';
  const r = p.pre_draft_rank || {}, cb = p.combine;
  const combine = cb && !cb.skipped ? `<dl class="kv measure">
      ${measureRow(term('barefoot', '키 (맨발)'), cb.height_barefoot, 'height_barefoot')}
      ${measureRow(term('wingspan', '윙스팬'), cb.wingspan, 'wingspan')}
      ${measureRow('윙스팬 − 키', wsDiff(p), 'ws_diff')}
      ${measureRow(term('standing_reach', '서서 손 닿는 높이'), cb.standing_reach, 'standing_reach')}
      ${measureRow(term('vertical', '도움닫기 점프'), cb.max_vertical, 'max_vertical')}
      ${measureRow(term('lane_agility', '레인 어질리티'), cb.lane_agility, 'lane_agility')}
      ${measureRow(term('sprint', '3/4 코트 질주'), cb.three_quarter_sprint, 'three_quarter_sprint')}
      ${measureRow('몸무게', cb.weight, 'weight')}</dl>
      <p class="muted small">막대: 올해 유망주(측정 참가자) 중 위치 · 오른쪽 끝이 1등</p>` : '<p class="muted">컴바인 측정 기록 없음 (불참)</p>';
  const rep = scoutReport(p);
  const act = hooks.prospectAction ? hooks.prospectAction(p) : '';
  return `
    <h2>${esc(p.name)}</h2>
    <p class="muted">${esc(p.position || '')} · 드래프트 당시 ${p.age_at_draft ?? '—'}세 · ${esc(p.pre_draft_team || '')} · ${esc(p.nationality || '')} · ${esc(p.height_listed || '')} ${p.weight_listed ? p.weight_listed + 'lb' : ''}</p>
    ${scout3(p)}
    ${act}
    <p>${term('big_board', '전문가 예상 순위')}: ${r.rank ? `<b>${r.rank}위</b> <span class="muted">(${esc(r.source || '')}, ${esc(r.as_of || '')} 기준)</span>` : '<span class="muted">순위 밖 (빅보드에 없음)</span>'}</p>
    <h3>스카우트 리포트 <span class="muted small">기록·측정값으로 자동 작성</span></h3>
    ${rep.length ? `<ul class="report">${rep.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">눈에 띄는 특징을 찾지 못했어요.</p>'}
    <h3>컴바인 측정</h3>${combine}
    ${statRows('대학 기록', p.college_seasons, 'college_id')}
    ${statRows('해외 리그 기록', p.pro_seasons)}
    ${statRows('G리그 기록', p.gleague_seasons, 'team_id')}
    ${statRows('그 밖의 기록', p.other_seasons)}
    ${!p.college_seasons?.length && !p.pro_seasons?.length && !p.gleague_seasons?.length && !p.other_seasons?.length ? '<p class="muted">드래프트 전 경기 기록 없음</p>' : ''}
    ${p.flags?.length ? `<p class="muted">참고: ${p.flags.map(esc).join(' / ')}</p>` : ''}`;
}

export function teamHTML(abbr) {
  const t = teamBy(abbr); if (!t) return '';
  return `<h2>${esc(t.name)}</h2><p class="muted">${esc(t.prev_season.season)} ${t.prev_season.w}승 ${t.prev_season.l}패 · 총연봉 ${money(t.cap_total_this_season)}</p>
    ${rosterTable('team-' + abbr, t)}`;
}
