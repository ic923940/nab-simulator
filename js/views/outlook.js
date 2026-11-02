// 시즌 전망 + 오프시즌 성적표
// - 예상 성적: 개막 로스터와 뎁스 차트로 계산한 예상 승수, 콘퍼런스 순위, 플레이오프 확률
// - 성적표: '드래프트 당일 모두 데려갔다면'(계약 선수 + 우리 FA 전원 + 우리 지명권 신인) 대비 바뀐 점
//   전력 변화 · 드래프트 · FA 영입 · 재계약과 이탈 · 캡 관리 → 종합 등급
import { esc, money, num } from '../util.js';
import { state, loadYear, teamBy } from '../store.js';
import { track } from '../analytics.js';
import { term } from '../glossary.js';
import * as ST from '../strength.js';
import * as RO from '../roster.js';
import * as F from '../fa.js';
import { capSheet } from '../capsheet.js';
import { teamPayroll, luxuryTax } from '../rules.js';

const S = () => state.data.season;
const GP = { 'A+': 4.3, A: 4, 'B+': 3.3, B: 3, 'C+': 2.3, C: 2, D: 1, F: 0 };
const gradeOf = (pts) => (pts >= 4.15 ? 'A+' : pts >= 3.65 ? 'A' : pts >= 3.15 ? 'B+' : pts >= 2.65 ? 'B' : pts >= 2.15 ? 'C+' : pts >= 1.5 ? 'C' : pts >= 0.5 ? 'D' : 'F');
const sign = (v, d = 1) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(d);
const pct = (v) => `${Math.round(v * 100)}%`;
let cache = null;

export async function renderOutlook(main) {
  if (state.save.phase !== 'preseason') { main.innerHTML = '<h1>시즌 전망</h1><p class="sub">개막 로스터를 확정한 뒤에 열려요.</p>'; return; }
  main.innerHTML = '<h1>시즌 전망</h1><p class="sub">계산 중…</p>';
  const key = `${state.save.seed}:${(state.save.log || []).length}:${(RO.ro().depth || []).join()}`;
  let fresh = false;
  if (!cache || cache.key !== key) { cache = { key, ...(await compute()) }; fresh = true; }
  draw(main, cache, fresh);
}

// 드래프트 당일 기준 (계약 선수 + 우리 FA 전원 + 지명권 신인)
async function baseline() {
  const d0 = await loadYear(state.save.year);
  const teams = d0.teams.map((t) => {
    const ros = t.roster.filter((p) => p.roster_role !== 'two_way');
    const fas = d0.free_agents.filter((f) => f.contract?.rights_team === t.abbr && !(f.contract?.last_contract || '').startsWith('TWO-WAY'));
    const picks = d0.draft_order.filter((o) => o.team === t.abbr && o.round === 1).map((o) => ({ player_id: 'pick' + o.pick, name: `${o.pick}순위 신인`, pos: '', rookie: { pick: o.pick } }));
    return { abbr: t.abbr, name: t.name, roster: [...ros, ...fas, ...picks] };
  });
  return ST.leagueProjection(teams);
}

async function compute() {
  const me = state.save.team;
  const now = ST.leagueProjection(state.data.teams, (abbr) => (abbr === me ? RO.depth() : null));
  const base = await baseline();
  for (const x of now) { const b = base.find((y) => y.abbr === x.abbr); x.base = b.wins; x.delta = x.wins - b.wins; }
  const mine = now.find((x) => x.abbr === me);
  return { now, mine, cards: cards(now, mine) };
}

// ── 부문별 평가 ──
function cards(now, mine) {
  const me = state.save.team, cap = state.data.league.salary_cap, out = [];
  // 1) 전력 변화: 리그 30팀 중 위치
  const ds = now.map((x) => x.delta).sort((a, b) => a - b), rk = ds.filter((v) => v <= mine.delta).length / ds.length;
  out.push({ k: 'power', t: '전력 변화', w: 0.4, pts: 0.8 + rk * 3.5, big: `${sign(mine.delta)}승`,
    lines: [`드래프트 당일 모두 데려갔다면 ${num(mine.base, 1)}승 → 지금 ${num(mine.wins, 1)}승`, `리그 30팀 중 ${now.slice().sort((a, b) => b.delta - a.delta).findIndex((x) => x.abbr === me) + 1}번째로 좋아졌어요`] });
  // 2) 드래프트: 전문가 예상 순위보다 늦게 뽑았으면 '이득'
  const made = (state.save.draft?.made || []).filter((m) => m.team === me);
  if (made.length) {
    const rows = made.map((m) => { const pr = state.data.draft_pool.find((x) => x.player_id === m.id), r = pr?.pre_draft_rank?.rank; return { m, r, gain: r ? m.pick - r : null }; });
    const g = rows.filter((x) => x.gain != null), avg = g.length ? g.reduce((a, x) => a + x.gain, 0) / g.length : 0;
    out.push({ k: 'draft', t: '드래프트', w: 0.15, pts: Math.max(0.5, Math.min(4.3, 3 + avg / 4)), big: `${made.length}명`,
      lines: rows.map((x) => `${x.m.pick}순위 ${x.m.name}${x.r ? ` · 전문가 예상 ${x.r}위 (${x.gain > 0 ? `${x.gain}순위 늦게 뽑음 → 이득` : x.gain < 0 ? `${-x.gain}순위 일찍 뽑음` : '예상대로'})` : ' · 전문가 순위 기록 없음'}`) });
  } else out.push({ k: 'draft', t: '드래프트', w: 0, pts: null, big: '—', lines: ['이번 드래프트에서 뽑은 선수가 없어요.'] });
  // 3) FA 영입 (다른 팀 출신): 시장 가치 대비 첫해 연봉
  const signs = F.signedList().filter((e) => e.team === me);
  const pl = (e) => teamBy(me).roster.find((p) => p.player_id === e.pid);
  const ext = signs.filter((e) => pl(e) && pl(e).contract?.prev_team !== me && e.tool !== 'ex10' && e.tool !== 'two_way');
  if (ext.length) {
    const sur = ext.reduce((a, e) => a + (F.V(pl(e)) - e.years[0].salary), 0);
    out.push({ k: 'fa', t: 'FA 영입', w: 0.2, pts: Math.max(0.5, Math.min(4.3, 3 + (sur / cap) * 12)), big: `${ext.length}명`,
      lines: [...ext.slice(0, 5).map((e) => { const p = pl(e); return `${p.name} · ${e.years.length}년 첫해 ${money(e.years[0].salary, 1)} (시장 가치 ${money(F.V(p), 1)}, 예상 BPM ${sign(ST.bpmOf(p))})`; }), `시장 가치보다 ${sur >= 0 ? `${money(sur, 1)} 싸게` : `${money(-sur, 1)} 비싸게`} 데려왔어요`] });
  } else out.push({ k: 'fa', t: 'FA 영입', w: 0, pts: null, big: '—', lines: ['다른 팀에서 데려온 FA가 없어요.'] });
  // 4) 재계약과 이탈
  const kept = signs.filter((e) => pl(e) && pl(e).contract?.prev_team === me);
  const lost = F.signedList().filter((e) => e.team !== me && teamBy(e.team).roster.find((q) => q.player_id === e.pid)?.contract?.prev_team === me)
    .map((e) => teamBy(e.team).roster.find((q) => q.player_id === e.pid));
  const keptSur = kept.reduce((a, e) => a + (F.V(pl(e)) - e.years[0].salary), 0), lostGood = lost.filter((p) => ST.bpmOf(p) > 0);
  if (kept.length || lost.length) {
    out.push({ k: 'keep', t: '재계약·이탈', w: 0.1, pts: Math.max(0.5, Math.min(4.3, 3 + (keptSur / cap) * 10 - lostGood.length * 0.5)), big: `${kept.length}잔류 · ${lost.length}이탈`,
      lines: [...kept.slice(0, 4).map((e) => `잔류: ${pl(e).name} · ${e.years.length}년 첫해 ${money(e.years[0].salary, 1)} (시장 가치 ${money(F.V(pl(e)), 1)})`),
        ...lost.slice(0, 4).map((p) => `이탈: ${p.name} → ${p.contract.team} (예상 BPM ${sign(ST.bpmOf(p))})`)] });
  } else out.push({ k: 'keep', t: '재계약·이탈', w: 0, pts: null, big: '—', lines: ['재계약하거나 떠난 FA가 없어요.'] });
  // 5) 캡 관리: 사치세·에이프런 위치, 데드머니, 다음 시즌 확정 연봉
  const t = teamBy(me), L = state.data.league, pay = teamPayroll(t, S()), dead = capSheet().parts.dead;
  const next = `${+S().slice(0, 4) + 1}-${String(+S().slice(0, 4) + 2).slice(2)}`, nextPay = teamPayroll(t, next);
  const tax = luxuryTax(pay, (t.tax_paid_last4 || []).length >= 3);
  let cp = pay < L.salary_cap ? 3.6 : pay < L.tax_level ? 3.4 : (L.first_apron || L.apron) && pay < (L.first_apron || L.apron) ? 2.6 : L.second_apron && pay < L.second_apron ? 1.9 : 1.2;
  cp -= Math.min(1, (dead / L.salary_cap) * 8);
  out.push({ k: 'cap', t: '캡 관리', w: 0.15, pts: Math.max(0, cp), big: money(pay, 0),
    lines: [`총연봉 ${money(pay, 1)}${tax ? ` · 예상 ${term('luxury_tax', '사치세')} ${money(tax, 1)}` : ' · 사치세 없음'}`, `데드머니 ${money(dead, 1)} · 다음 시즌 확정 연봉 ${money(nextPay, 1)}`] });
  const used = out.filter((c) => c.pts != null && c.w > 0), W = used.reduce((a, c) => a + c.w, 0);
  const total = used.reduce((a, c) => a + c.pts * c.w, 0) / W;
  out.forEach((c) => { c.g = c.pts == null ? '—' : gradeOf(c.pts); });
  out.total = { pts: total, g: gradeOf(total) };
  return out;
}

function draw(main, c, fresh) {
  const { now, mine, cards } = c, me = state.save.team, L = Math.round(82 - mine.wins), W = Math.round(mine.wins);
  const cr = ST.confRank(now, me), conf = mine.conf === 'E' ? '동부' : '서부';
  const rows = ST.teamRating(RO.depth()).rows;
  if (fresh) track('outlook_view', { wins: Math.round(mine.wins * 10) / 10, delta: Math.round(mine.delta * 10) / 10, conf_rank: cr, p6: mine.p6, grade: cards.total.g, grades: Object.fromEntries(cards.map((x) => [x.k, x.g])) });
  main.innerHTML = `
  <div class="stage outlook-stage"><div class="stage-grid">
    <div class="bignum">${W}<span class="of">–${L}</span><small>예상 성적 (${esc(S())})</small></div>
    <div><h2>${conf} ${cr}위 예상</h2>
      <p>플레이오프 직행(6위 안) ${pct(mine.p6)} · 플레이인 포함(10위 안) ${pct(mine.p10)} · 리그 최고 승률 ${pct(mine.pBest)}</p>
      <p class="small">예상은 선수들의 지난 3시즌 기록과 나이로 만든 실력 지표(${term('bpm', 'BPM')})와 뎁스 차트의 출전 시간으로 계산했어요. 실제 시즌은 부상·트레이드·성장으로 달라져요 (검증 오차 평균 약 6승).</p></div>
    <div class="clock-side"><div class="small">오프시즌 종합</div><div class="grade-big">${cards.total.g}</div><div class="small">전력 ${sign(mine.delta)}승</div></div>
  </div></div>
  <h2 class="sec">오프시즌 성적표</h2>
  <div class="cards">${cards.map((x) => `<div class="card"><div class="row-between"><b>${esc(x.t)}</b><span class="grade g-${x.g.replace('+', 'p').replace('—', 'na')}">${x.g}</span></div>
    <div class="cbig">${esc(x.big)}</div><ul>${x.lines.map((l) => `<li>${l.includes('<') ? l : esc(l)}</li>`).join('')}</ul></div>`).join('')}</div>
  <div class="grid2">
    <div class="panel"><h2>로테이션 예상 <span class="muted small">뎁스 차트 순서 · 경기당 출전 시간</span></h2><div class="body scroll"><table class="t"><thead><tr><th>#</th><th>선수</th><th class="n">예상 BPM</th><th class="n">출전 시간</th><th class="n">기여</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr class="${i < 5 ? 'st' : ''}"><td>${i + 1}</td><td><a href="#" data-open="player:${esc(r.p.player_id)}">${esc(r.p.name)}</a> <span class="muted small">${esc(r.p.pos || '')}${r.p.rookie ? ' · 신인' : ''}</span></td><td class="n">${sign(r.bpm)}</td><td class="n">${num(r.min, 1)}분</td><td class="n">${sign(r.min * r.bpm / 48, 2)}</td></tr>`).join('')}
    </tbody></table><p class="small muted">순서는 <a href="#/cuts">로스터 정리</a>의 뎁스 차트예요. ${rows.length < 10 ? '선수가 적어서 남는 시간은 대체 선수 수준으로 계산했어요.' : ''}</p></div></div>
    <div class="panel"><h2>오프시즌 전력 변화 순위 <span class="muted small">드래프트 당일 대비</span></h2><div class="body">${deltaList(now)}</div></div>
  </div>
  <div class="grid2">${['E', 'W'].map((cf) => `<div class="panel"><h2>${cf === 'E' ? '동부' : '서부'} 예상 순위</h2><div class="body scroll">${standings(now, cf)}</div></div>`).join('')}</div>
  <p><a class="go" href="#/history">실제 역사와 비교하기</a> <span class="muted small">이 연도의 실제 결과가 공개돼요</span></p>`;
}
function standings(now, cf) {
  const me = state.save.team, list = now.filter((x) => x.conf === cf).sort((a, b) => b.wins - a.wins);
  return `<table class="t"><thead><tr><th>#</th><th>팀</th><th class="n">예상 승</th><th class="n">변화</th><th class="n">6위 안</th><th class="n">10위 안</th></tr></thead><tbody>
    ${list.map((x, i) => `<tr class="${x.abbr === me ? 'mine' : ''} ${i === 5 || i === 9 ? 'cut' : ''}"><td>${i + 1}</td><td><a href="#" data-open="team:${x.abbr}">${esc(x.name)}</a></td><td class="n">${num(x.wins, 1)}</td><td class="n ${x.delta > 0.5 ? 'good' : x.delta < -0.5 ? 'bad' : ''}">${sign(x.delta)}</td><td class="n">${pct(x.p6)}</td><td class="n">${pct(x.p10)}</td></tr>`).join('')}</tbody></table>`;
}
function deltaList(now) {
  const me = state.save.team, s = now.slice().sort((a, b) => b.delta - a.delta);
  const row = (x, i) => `<li class="${x.abbr === me ? 'mine' : ''}"><span class="pk">${i + 1}</span>${esc(x.name)} <b class="${x.delta >= 0 ? 'good' : 'bad'}">${sign(x.delta)}승</b></li>`;
  const myI = s.findIndex((x) => x.abbr === me);
  return `<ol class="ticker">${s.slice(0, 5).map(row).join('')}${myI >= 5 && myI < 25 ? `<li class="sep">…</li>${row(s[myI], myI)}` : ''}<li class="sep">…</li>${s.slice(25).map((x, k) => row(x, 25 + k)).join('')}</ol>`;
}
