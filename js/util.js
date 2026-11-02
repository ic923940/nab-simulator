// 공용 도구: 글자 안전 처리, 금액·비율 표시, 팀 색
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function money(v, digits = 1) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  const m = v / 1e6;
  return (m < 0 ? '-$' : '$') + Math.abs(m).toFixed(digits) + 'M';
}
export const pct = (v) => (v === null || v === undefined || isNaN(v) ? '—' : (v * 100).toFixed(1) + '%');
export const num = (v, d = 1) => (v === null || v === undefined || v === '' || isNaN(v) ? '—' : Number(v).toFixed(d));
export const inches = (v) => {
  if (!v) return '—';
  const ft = Math.floor(v / 12), inch = Math.round((v - ft * 12) * 10) / 10;
  return `${ft}'${inch}"`;
};
export const cm = (v) => (v ? Math.round(v * 2.54) + 'cm' : '—');

// 팀 대표색 (로고는 쓰지 않고 색만 사용)
export const TEAM_COLORS = {
  ATL: '#C8102E', BOS: '#007A33', BRK: '#000000', CHI: '#CE1141', CHO: '#1D1160', CLE: '#860038',
  DAL: '#00538C', DEN: '#0E2240', DET: '#C8102E', GSW: '#1D428A', HOU: '#CE1141', IND: '#002D62',
  LAC: '#C8102E', LAL: '#552583', MEM: '#5D76A9', MIA: '#98002E', MIL: '#00471B', MIN: '#0C2340',
  NOP: '#0C2340', NYK: '#006BB6', OKC: '#007AC1', ORL: '#0077C0', PHI: '#006BB6', PHO: '#1D1160',
  POR: '#C8102E', SAC: '#5A2D81', SAS: '#2B2B2B', TOR: '#CE1141', UTA: '#002B5C', WAS: '#002B5C',
};
export function applyTeamColor(abbr) {
  document.documentElement.style.setProperty('--team', TEAM_COLORS[abbr] || '#2b4c7e');
}

export const OPTION_KO = {
  player_option: '선수 옵션', team_option: '팀 옵션', team_option_pending: '팀 옵션(신인)',
  early_termination: '조기 해지 옵션',
};
export const ROLE_KO = { main: '정규', depth: '예비', two_way: '투웨이' };

// 마지막 NBA 시즌 기록
export const lastSeason = (p) => (p.nba_history && p.nba_history.length ? p.nba_history[p.nba_history.length - 1] : null);

// 정렬 가능한 표: cols = [{k, label, n(숫자열), get(row), fmt(v,row)}]
export function table(id, rows, cols, opts = {}) {
  const st = (table._sort[id] ||= { k: opts.sortKey || null, dir: opts.sortDir || -1 });
  let data = rows.slice();
  if (st.k) {
    const c = cols.find((c) => c.k === st.k);
    if (c) data.sort((a, b) => {
      const x = c.get(a), y = c.get(b);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x > y ? 1 : -1) * st.dir;
    });
  }
  const head = cols.map((c) => `<th class="${c.n ? 'n ' : ''}sort${st.k === c.k ? ' on' : ''}" data-sort="${id}:${c.k}">${c.tip && table.term ? table.term(c.tip, c.label) : esc(c.label)}${st.k === c.k ? (st.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
  const body = data.map((r) => {
    const cls = [opts.rowClick ? 'click' : '', opts.mine && opts.mine(r) ? 'mine' : ''].join(' ');
    const attr = opts.rowClick ? ` data-open="${esc(opts.rowClick(r))}"` : '';
    return `<tr class="${cls}"${attr}>` + cols.map((c) => {
      const v = c.get(r);
      return `<td class="${c.n ? 'n' : ''}">${c.fmt ? c.fmt(v, r) : esc(v ?? '—')}</td>`;
    }).join('') + '</tr>';
  }).join('');
  return `<div class="scroll"><table class="t"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
table._sort = {};
export function toggleSort(spec) {
  const [id, k] = spec.split(':');
  const st = (table._sort[id] ||= { k: null, dir: -1 });
  if (st.k === k) st.dir *= -1; else { st.k = k; st.dir = -1; }
}
