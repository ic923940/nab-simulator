// 실제 역사와 비교 (게임이 끝난 뒤 = 개막 로스터 확정 뒤에만, 이용자가 열어 보기로 했을 때만)
// 자료: data/reveal_{연도}.json — 실제 지명·FA 계약·다음 시즌 팀 성적·선수 기록 (플레이 중에는 불러오지 않음)
import { esc, money, num } from '../util.js';
import { state, writeSave, teamBy } from '../store.js';
import { track } from '../analytics.js';
import { notice } from '../ui.js';
import * as ST from '../strength.js';
import * as RO from '../roster.js';
import * as F from '../fa.js';

const sign = (v, d = 1) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(d);
let rv = null;
export async function renderHistory(main) {
  const s = state.save;
  if (s.phase !== 'preseason') { main.innerHTML = '<h1>실제 역사와 비교</h1><p class="sub">개막 로스터를 확정해서 게임이 끝나면 열 수 있어요. 그 전에는 실제 결과를 보여 주지 않아요.</p>'; return; }
  if (!s.revealed) {
    main.innerHTML = `<h1>실제 역사와 비교</h1><p class="sub">이번 게임의 결정과 실제 ${s.year}년 오프시즌·다음 시즌 결과를 비교해요. 실제로 누가 어디로 갔는지, 우리가 뽑은 선수가 실제로 어떻게 컸는지가 나와요.</p>
      <p><button class="go" id="reveal-yes">실제 결과 보기</button></p>`;
    main.querySelector('#reveal-yes').onclick = () => notice('실제 결과를 공개할까요?', '이 연도의 실제 지명·FA 계약·다음 시즌 성적이 나와요. 같은 연도로 다시 플레이할 때 영향을 줄 수 있어요.', () => { s.revealed = true; writeSave(); track('history_reveal', { year: s.year }); renderHistory(main); }, { ok: '공개', cancel: true });
    return;
  }
  main.innerHTML = '<h1>실제 역사와 비교</h1><p class="sub">불러오는 중…</p>';
  if (!rv || rv.y !== s.year) rv = { y: s.year, d: await (await fetch(`data/reveal_${s.year}.json`)).json() };
  draw(main, rv.d);
}

function draw(main, R) {
  const s = state.save, me = s.team, N = R.player_next || {}, next = R.next_season?.teams || {};
  const proj = ST.leagueProjection(state.data.teams, (a) => (a === me ? RO.depth() : null));
  const mine = proj.find((x) => x.abbr === me), act = next[me];
  // 리그 예측 오차
  const pairs = proj.filter((x) => next[x.abbr]).map((x) => ({ x, a: next[x.abbr] }));
  const mae = pairs.length ? pairs.reduce((t, { x, a }) => t + Math.abs(x.wins - a.w), 0) / pairs.length : null;
  // 드래프트
  const picks = R.picks || [], byId = Object.fromEntries(picks.map((p) => [p.player_id, p])), bySlot = Object.fromEntries(picks.map((p) => [p.actual_pick, p]));
  const pool = Object.fromEntries(state.data.draft_pool.map((p) => [p.player_id, p]));
  const career = (p) => (p ? (p.nba_games || 0) * (p.ppg || 0) : 0);
  const myPicks = (s.draft?.made || []).filter((m) => m.team === me);
  // FA: 게임 결과 vs 실제
  const gameSign = Object.fromEntries(F.signedList().map((e) => [e.pid, e]));
  const realFA = (R.fa_actual || []).filter((x) => !x.two_way);
  const realTeam = (x) => (x.snt ? N[x.pid]?.team || x.team : x.team);
  const comp = realFA.filter((x) => gameSign[x.pid] && !x.ext).map((x) => ({ x, g: gameSign[x.pid], same: gameSign[x.pid].team === realTeam(x) }));
  const sameRate = comp.length ? comp.filter((c) => c.same).length / comp.length : null;
  // 우리 팀에 온 선수들의 실제 다음 시즌
  const ours = teamBy(me).roster.filter((p) => p.roster_role !== 'two_way');
  if (rv.tracked !== s.year) { rv.tracked = s.year; track('history_view', { year: s.year, team: me, proj_w: Math.round(mine.wins), act_w: act?.w ?? null, mae: mae ? Math.round(mae * 10) / 10 : null, same_team_rate: sameRate }); }
  main.innerHTML = `<h1>실제 역사와 비교</h1><p class="sub">${s.year}년 실제 결과 (${esc(R.next_season?.season || '')} 시즌까지). 게임 속 결과는 이번 플레이에서 나온 거예요.</p>
  <div class="stage"><div class="stage-grid">
    <div class="bignum">${act ? `${act.w}<span class="of">–${act.l}</span>` : '—'}<small>실제 ${esc(teamBy(me).name)} 성적</small></div>
    <div><h2>게임 예상 ${Math.round(mine.wins)}승 ${Math.round(82 - mine.wins)}패 · 실제 ${act ? `${act.w}승 ${act.l}패${act.playoffs ? ' (플레이오프 진출)' : ''}` : '기록 없음'}</h2>
      <p>${act ? `우리 단장 판단의 결과는 실제보다 ${sign(mine.wins - act.w)}승. ` : ''}리그 30팀 예상 승수와 실제 차이 평균 ${mae != null ? mae.toFixed(1) + '승' : '—'} (실제 팀은 다른 결정을 했으니 차이가 나는 게 당연해요)</p></div><div></div></div></div>

  <div class="grid2">
  <div class="panel"><h2>드래프트: 우리 선택 vs 실제</h2><div class="body scroll"><table class="t"><thead><tr><th class="n">순위</th><th>우리 선택</th><th>실제로는</th><th>그 자리 실제 지명</th></tr></thead><tbody>
    ${myPicks.length ? myPicks.map((m) => { const a = byId[m.id], at = bySlot[m.pick], line = (p) => p ? `${p.nba_games}경기 · ${num(p.ppg)}득점${p.all_star ? ` · 올스타 ${p.all_star}회` : ''}` : '';
      const better = at && at.player_id !== m.id ? (career(a) > career(at) ? '<span class="good">우리 선택이 더 좋았어요</span>' : career(a) < career(at) ? '<span class="bad">실제 선택이 더 좋았어요</span>' : '비슷') : '<span class="good">실제와 같은 선택</span>';
      return `<tr><td class="n">${m.pick}</td><td><b>${esc(m.name)}</b><div class="small muted">${a ? `실제 ${a.actual_pick ? `${a.actual_pick}순위 ${esc(a.actual_team)}` : '미지명'} · ${line(a)}` : (R.undrafted_ids || []).includes(m.id) ? '실제로는 미지명' : '기록 없음'}</div></td>
        <td>${better}</td><td>${at ? `${esc(pool[at.player_id]?.name || at.player_id)} <span class="small muted">${line(at)}</span>` : '—'}</td></tr>`; }).join('') : '<tr><td colspan="4" class="muted">이번 게임에서 지명하지 않았어요.</td></tr>'}
    </tbody></table><p class="small muted">통산 기록은 자료 기준일까지예요. 비교는 경기 수 × 득점으로 단순하게 했어요.</p></div></div>

  <div class="panel"><h2>우리 개막 로스터의 실제 다음 시즌</h2><div class="body scroll"><table class="t"><thead><tr><th>선수</th><th class="n">게임 예상 BPM</th><th class="n">실제 BPM</th><th class="n">실제 경기</th><th>실제 팀</th></tr></thead><tbody>
    ${ours.map((p) => { const id = p.prospect_id || p.player_id, n = N[id];
      return `<tr><td>${esc(p.name)}</td><td class="n">${sign(ST.bpmOf(p))}</td><td class="n ${n?.bpm != null ? (n.bpm > ST.bpmOf(p) + 1 ? 'good' : n.bpm < ST.bpmOf(p) - 1 ? 'bad' : '') : ''}">${n?.bpm != null ? sign(n.bpm) : '—'}</td><td class="n">${n ? n.g : '—'}</td><td>${n ? esc(n.teams.join('→')) : '<span class="muted">NBA 기록 없음</span>'}</td></tr>`; }).join('')}
    </tbody></table></div></div>
  </div>

  <div class="panel"><h2>FA: 게임 속 결과 vs 실제 <span class="muted small">${sameRate != null ? `실제와 같은 팀으로 간 비율 ${Math.round(sameRate * 100)}% (${comp.length}명 중)` : ''}</span></h2><div class="body scroll"><table class="t"><thead><tr><th>선수</th><th>실제 계약</th><th>게임 속 계약</th></tr></thead><tbody>
    ${realFA.slice(0, 25).map((x) => { const g = gameSign[x.pid], rt = realTeam(x);
      return `<tr class="${rt === me || g?.team === me ? 'mine' : ''}"><td>${esc(x.name)}</td><td>${esc(rt)}${x.snt ? ' <span class="small muted">(사인 앤 트레이드)</span>' : ''}${x.ext ? ' <span class="small muted">(연장 계약)</span>' : ''} · ${x.years}년 ${money(x.total, 1)}</td>
        <td>${g ? `${esc(g.team)} · ${g.years.length}년 ${money(g.years.reduce((a, y) => a + y.salary, 0), 1)} ${g.team === rt ? '<span class="good">같은 팀</span>' : ''}` : '<span class="muted">계약 없음 / 다른 경로</span>'}</td></tr>`; }).join('')}
    </tbody></table></div></div>

  <div class="panel"><h2>리그: 게임 예상 vs 실제 성적</h2><div class="body scroll"><table class="t"><thead><tr><th>팀</th><th class="n">게임 예상</th><th class="n">실제</th><th class="n">차이</th></tr></thead><tbody>
    ${pairs.sort((a, b) => b.a.w - a.a.w).map(({ x, a }) => `<tr class="${x.abbr === me ? 'mine' : ''}"><td>${esc(x.name)}</td><td class="n">${num(x.wins, 1)}</td><td class="n">${a.w}–${a.l}</td><td class="n">${sign(x.wins - a.w)}</td></tr>`).join('')}
    </tbody></table></div></div>`;
}
