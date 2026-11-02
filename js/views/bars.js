// 리그 평균 대비 막대: 가운데 선 = 비교군의 중간, 막대 끝 = 이 선수의 위치(백분위)
import { esc } from '../util.js';
import { percentiles } from '../pctl.js';

const fmt = (r) => (r.val == null ? '' : r.kind === 'pct' ? `${(r.val * 100).toFixed(1)}%` : (+r.val).toFixed(1));
const word = (x) => (x >= 50 ? `상위 ${Math.max(1, 100 - x)}%` : `하위 ${Math.max(1, x)}%`);
export function barsHTML(p, opts = {}) {
  const r = percentiles(p);
  if (!r) return opts.quiet ? '' : '<p class="muted small">비교할 기록이 없어요.</p>';
  if (r.few) return `<p class="muted small">${esc(r.label)}: 비교할 선수가 적어서 막대는 보여 주지 않아요.</p>`;
  return `<div class="pbars${opts.compact ? ' compact' : ''}" role="group" aria-label="${esc(r.label)}">
    <div class="pb-h"><span>${esc(r.label)}</span><span class="muted">가운데 선 = 중간</span></div>
    ${r.rows.map((x) => x.pct == null
      ? `<div class="pb"><span class="l">${x.name}</span><span class="track none"></span><span class="w muted">기록 없음</span></div>`
      : `<div class="pb ${x.pct >= 70 ? 'hi' : x.pct <= 30 ? 'lo' : ''}" title="${x.name} ${fmt(x)} · ${word(x.pct)}"><span class="l">${x.name}</span>
        <span class="track"><i style="width:${Math.max(3, x.pct)}%"></i></span><span class="w"><b>${fmt(x)}</b> ${word(x.pct)}</span></div>`).join('')}
    ${opts.compact ? (r.small ? '<p class="pb-f muted">출전이 적어서 참고만 하세요.</p>' : '') : `<p class="pb-f muted">${r.rows.some((x) => x.kind === 'per36') ? '득점·리바운드·어시스트·스틸+블록은 경기당 기록이고, 순위는 36분 기준으로 맞춰 매겼어요.' : ''}${r.small ? ' 출전이 적어서 참고만 하세요.' : ''}</p>`}
  </div>`;
}
