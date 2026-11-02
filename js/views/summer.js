// 서머리그 리포트 (게임 속 결과): 위 = 우리 신인 경기별 기록·스카우트 평 / 아래 = 전체 신인 표
import { esc, num } from '../util.js';
import { state, teamBy } from '../store.js';
import { track } from '../analytics.js';
import * as SL from '../summer.js';
import { bpmOf } from '../strength.js';

const ui = { mine: false };
const sign = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(1);
const pct = (v) => (v * 100).toFixed(1) + '%';
export function renderSummer(main) {
  const s = SL.sl(), me = state.save.team;
  if (SL.cancelled()) { main.innerHTML = '<h1>서머리그</h1><p class="sub">2020년 서머리그는 코로나19로 실제로 취소됐어요. 이번 게임에서도 열리지 않아요.</p>'; return; }
  if (!s.done) {
    const e = SL.lvEnd(), rk = SL.ourRookies();
    main.innerHTML = `<h1>서머리그</h1><p class="sub">라스베이거스 서머리그${e ? `(실제 일정 ${e.slice(5).replace('-', '/')} 종료)` : ''}가 끝난 뒤 FA 날짜로 넘어가면, 우리 신인을 어떻게 기용할지 고르고 첫 무대 결과를 봐요.</p>
      ${rk.length ? `<div class="panel"><h2>서머리그에 나갈 우리 신인 ${rk.length}명</h2><div class="body"><ul>${rk.map((p) => `<li><a href="#" data-open="player:${esc(p.player_id)}">${esc(p.name)}</a> <span class="muted small">${esc(p.pos || '')} · ${p.rookie?.pick ? p.rookie.pick + '순위' : '미지명'} · 지금 예상 BPM ${sign(bpmOf(p))}</span></li>`).join('')}</ul></div></div>` : '<p class="muted">서머리그에 나갈 우리 신인이 없어요. 드래프트 지명 선수나 신인 FA를 데려오면 여기서 볼 수 있어요.</p>'}`;
    return;
  }
  const rows = Object.entries(s.rows).map(([id, r]) => ({ id, ...r, d: r.perf - r.prior })).filter((r) => !ui.mine || r.team === me)
    .sort((a, b) => (a.line ? 0 : 1) - (b.line ? 0 : 1) || b.d - a.d);
  const ours = Object.entries(s.rows).filter(([, r]) => r.team === me);
  if (!ui.tracked) { ui.tracked = true; track('summer_view', { mine: ours.map(([, r]) => ({ pick: r.pick, plan: r.plan, d: Math.round((r.perf - r.prior) * 10) / 10 })) }); }
  const pOf = (r, id) => teamBy(r.team)?.roster.find((q) => (q.prospect_id || q.player_id) === id);
  const card = ([id, r]) => {
    const p = pOf(r, id), L = r.line, d = r.perf - r.prior;
    const verdict = !L ? '<span class="muted">결장</span>' : d > 1.5 ? '<span class="good">기대 이상</span>' : d < -1.5 ? '<span class="bad">기대 이하</span>' : '기대만큼';
    return `<div class="panel slcard"><div class="body">
      <div class="slhead"><div><b>${p ? `<a href="#" data-open="player:${esc(p.player_id)}">${esc(r.name)}</a>` : esc(r.name)}</b> <span class="muted small">${r.pick ? r.pick + '순위' : '미지명'} · 기용: ${SL.PLAN[r.plan || 'normal'].ko}</span></div><div class="slv">${verdict}</div></div>
      ${L ? `<div class="slavg"><span><b>${num(L.pts)}</b>득점</span><span><b>${num(L.reb)}</b>리바</span><span><b>${num(L.ast)}</b>어시</span><span><b>${pct(L.fg)}</b>야투</span><span class="muted">${L.g}경기 평균</span></div>
        ${L.games ? `<table class="t small"><thead><tr><th>경기</th><th class="n">득점</th><th class="n">리바</th><th class="n">어시</th><th class="n">야투율</th></tr></thead><tbody>${L.games.map((g, i) => `<tr><td>${i + 1}</td><td class="n">${g.pts}</td><td class="n">${g.reb}</td><td class="n">${g.ast}</td><td class="n">${pct(g.fg)}</td></tr>`).join('')}</tbody></table>` : ''}` : ''}
      <p class="quote">“${esc(r.scout || '')}”${r.inj ? ' <span class="warn small">가벼운 부상 · 시즌 예상 출전 −5%p</span>' : ''}</p>
      ${p ? `<p class="small">예상 BPM ${sign(r.prior)} → <b>${sign(bpmOf(p))}</b> <span class="muted">(활약 차이 ${sign(d)} 중 ${Math.round((r.w ?? 0.25) * 100)}% 반영${r.dev ? ` + 경험 ${sign(r.dev)}` : ''})</span></p>` : ''}
    </div></div>`;
  };
  main.innerHTML = `<h1>서머리그 리포트</h1>
    <p class="sub">게임 속 결과예요 (실제 서머리그 기록이 아니에요). 지명 순위로 본 기대치와 비교한 활약을 보여 주고, 신인 예상 실력에는 그 차이 일부만 반영해요. 몇 경기로 선수를 단정하지 않으니까요.</p>
    ${ours.length ? `<h2 class="sec">우리 신인</h2><div class="slgrid">${ours.map(card).join('')}</div>` : ''}
    <h2 class="sec">전체 신인</h2>
    <p class="chips"><button class="chip ${!ui.mine ? 'on' : ''}" data-m="0">전체 신인</button><button class="chip ${ui.mine ? 'on' : ''}" data-m="1">우리 팀</button></p>
    <div class="panel"><div class="body scroll"><table class="t"><thead><tr><th>팀</th><th>선수</th><th class="n">순위</th><th class="n">경기</th><th class="n">득점</th><th class="n">리바</th><th class="n">어시</th><th class="n">야투율</th><th>평가</th><th class="n">예상 BPM</th></tr></thead><tbody>
    ${rows.map((r) => { const p = pOf(r, r.id);
      const v = !r.line ? '<span class="muted">결장 (몸 관리)</span>' : r.d > 1.5 ? '<span class="good">기대 이상</span>' : r.d < -1.5 ? '<span class="bad">기대 이하</span>' : '기대만큼';
      return `<tr class="${r.team === me ? 'mine' : ''}"><td>${esc(r.team)}</td><td>${p ? `<a href="#" data-open="player:${esc(p.player_id)}">${esc(r.name)}</a>` : esc(r.name)}</td><td class="n">${r.pick ?? '미지명'}</td>
        <td class="n">${r.line?.g ?? 0}</td><td class="n">${r.line ? num(r.line.pts) : '—'}</td><td class="n">${r.line ? num(r.line.reb) : '—'}</td><td class="n">${r.line ? num(r.line.ast) : '—'}</td><td class="n">${r.line ? pct(r.line.fg) : '—'}</td>
        <td>${v}</td><td class="n">${p ? sign(bpmOf(p)) : '—'}</td></tr>`; }).join('')}</tbody></table></div></div>`;
  main.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { ui.mine = b.dataset.m === '1'; renderSummer(main); });
}
