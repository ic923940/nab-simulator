// 리그 평균 대비 백분위: 같은 무리 안에서 이 선수가 몇 % 위치인지
// - NBA 선수: 같은 시즌에 뛴 NBA 선수 중 같은 포지션(가드·포워드·센터), 20경기·평균 10분 이상
// - 대학 유망주: 같은 해 드래프트 후보 중 대학 선수, 같은 포지션
// - 해외·G리그 유망주: 같은 해 드래프트 후보 중 해외·G리그 선수 (포지션 구분 없음, 수가 적어서)
// 득점·리바·어시·스틸+블록은 36분당으로 맞춰 비교 (출전 시간 차이를 지움). 드래프트 당일까지 자료만 씀.
import { state } from './store.js';
import { poolOf } from './scout.js';

const grp = (pos) => { const s = String(pos || ''); return /C/.test(s) ? 'C' : /PF|SF|F/.test(s) ? 'F' : 'G'; };
export const GRP_KO = { G: '가드', F: '포워드', C: '센터' };
export const METRICS = [
  ['pts', '득점', 'per36'], ['trb', '리바운드', 'per36'], ['ast', '어시스트', 'per36'],
  ['def', '스틸+블록', 'per36'], ['fg3', '3점 성공률', 'pct'], ['ts', '슈팅 효율', 'pct'],
];

// 한 시즌 기록 → 같은 모양으로 (NBA·대학·해외·G리그 공통)
function norm(s) {
  if (!s) return null;
  const g = s.g || 0, pick = (k) => s[`${k}_per_g`] ?? s[`${k}_per_game`] ?? (g && s[k] != null ? s[k] / g : null);
  const mp = s.mp_per_g ?? s.mp_per_game ?? (g && s.mp ? s.mp / g : null);
  const p36 = (v) => (v != null && mp ? (v / mp) * 36 : null);
  const stl = pick('stl'), blk = pick('blk'), fg3a = s.fg3a_per_g ?? s.x3pa_per_game ?? (g && s.fg3a != null ? s.fg3a / g : null);
  let ts = s.ts_pct ?? s.ts_percent ?? null;
  if (ts == null && s.pts != null && s.fga != null && s.fta != null && (s.fga + 0.44 * s.fta) > 0) ts = s.pts / (2 * (s.fga + 0.44 * s.fta));
  const fg3 = s.fg3_pct ?? s.x3p_percent ?? null;
  return { g, mp, pts: p36(pick('pts')), trb: p36(pick('trb')), ast: p36(pick('ast')),
    def: stl != null && blk != null ? p36(stl + blk) : null,
    fg3: fg3 != null && fg3a != null && fg3a >= 1 ? fg3 : null, ts, raw: { pts: pick('pts'), trb: pick('trb'), ast: pick('ast'), def: stl != null && blk != null ? stl + blk : null } };
}

// 비교 대상 고르기
function nbaRow(p) { const h = p.nba_history || []; return h[h.length - 1] || null; }
function prospectBase(q) {
  const cs = q.college_seasons || [], ps = (q.pro_seasons || []).filter((r) => r.competition !== 'national_team'), gl = q.gleague_seasons || [];
  const last = cs[cs.length - 1], pro = ps[ps.length - 1], g = gl[gl.length - 1];
  if (last && (!pro || last.season >= (pro.season || ''))) return { kind: 'college', row: last };
  if (pro) return { kind: 'pro', row: pro };
  if (g) return { kind: 'pro', row: g };
  return null;
}

const cache = new Map();
function nbaPool(season, G) {
  const key = `${state.data.year}|nba|${season}|${G}`;
  if (cache.has(key)) return cache.get(key);
  const seen = new Set(), out = [];
  const all = [...state.data.teams.flatMap((t) => t.roster), ...state.data.free_agents];
  for (const p of all) {
    if (seen.has(p.player_id)) continue; seen.add(p.player_id);
    const r = (p.nba_history || []).find((x) => x.season === season);
    if (!r || (r.g || 0) < 20 || (r.mp_per_game || 0) < 10 || grp(r.pos) !== G) continue;
    out.push(norm(r));
  }
  cache.set(key, out); return out;
}
function prospectPool(kind, G) {
  const key = `${state.data.year}|pros|${kind}|${G}`;
  if (cache.has(key)) return cache.get(key);
  const out = [];
  for (const q of state.data.draft_pool || []) {
    const b = prospectBase(q); if (!b || b.kind !== kind) continue;
    if (kind === 'college' && grp(q.position) !== G) continue;
    const n = norm(b.row); if (!n || (n.mp != null && n.mp < 10)) continue;
    out.push(n);
  }
  cache.set(key, out); return out;
}
const rank = (vals, v) => { const xs = vals.filter((x) => x != null); if (xs.length < 8 || v == null) return null;
  let lo = 0, eq = 0; for (const x of xs) { if (x < v) lo++; else if (x === v) eq++; } return Math.round(((lo + eq / 2) / xs.length) * 100); };

// 결과: { label: 비교군 설명, n, small: 표본 적음, rows: [{k, name, pct, val}] } 또는 null
export function percentiles(p) {
  const q = poolOf(p);
  let me, pool, label;
  if (q) {
    const b = prospectBase(q); if (!b) return null;
    me = norm(b.row); const G = grp(q.position);
    pool = prospectPool(b.kind, G);
    label = b.kind === 'college' ? `${state.data.year} 드래프트 대학 ${GRP_KO[G]} 후보 ${pool.length}명과 비교` : `${state.data.year} 드래프트 해외·G리그 후보 ${pool.length}명과 비교`;
  } else {
    const r = nbaRow(p); if (!r) return null;
    me = norm(r); const G = grp(r.pos);
    pool = nbaPool(r.season, G);
    label = `${r.season} NBA ${GRP_KO[G]} ${pool.length}명과 비교`;
  }
  if (!me || pool.length < 8) return { label, n: pool.length, rows: [], few: true };
  const rows = METRICS.map(([k, name, kind]) => ({ k, name, kind, pct: rank(pool.map((x) => x[k]), me[k]), val: kind === 'per36' ? me.raw[k] : me[k] }));
  return { label, n: pool.length, small: (me.g && me.g < 15) || (me.mp != null && me.mp < 15), rows };
}
