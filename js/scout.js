// 스카우트 리포트: 선수마다 3줄 (게임이 자료로 직접 쓰는 문장)
// 1줄 = 어디서 어떻게 뛰었나 (대학·해외·G리그 / NBA 지난 시즌)
// 2줄 = 기록으로 본 강점과 약점
// 3줄 = 몸·나이·평가 (컴바인, 빅보드, 수상, 출전 경기)
// 드래프트 날까지의 자료만 씀 (그 뒤 기록은 자료에 없음)
import { state } from './store.js';
import { bpmOf } from './strength.js';

const n0 = (v) => (v == null || isNaN(v) ? '?' : Math.round(v));
const f1 = (v) => (v == null || isNaN(v) ? '?' : (+v).toFixed(1));
const pc = (v) => (v == null || isNaN(v) ? '?' : `${(v * 100).toFixed(1)}%`);
const POWER = new Set(['ACC', 'B10', 'SEC', 'P12', 'BE', 'B12']);
const ftIn = (inch) => `${Math.floor(inch / 12)}피트 ${Math.round(inch % 12)}인치`;
const grp = (pos) => { const s = String(pos || ''); return /C/.test(s) ? 'C' : /PF|SF|F/.test(s) ? 'F' : 'G'; };
const LEAGUE_KO = { 'NBA G League': 'G리그', 'Overtime Elite': '오버타임 엘리트(고교 리그)', NBL: '호주 NBL', 'Liga ACB': '스페인 ACB', 'Liga ACB (Spain)': '스페인 ACB', LBA: '이탈리아 LBA', 'LNB Pro A': '프랑스 리그', ABA: '아드리아틱 리그', 'LEB Oro (Spain)': '스페인 2부 리그', 'NBB (Brazil)': '브라질 NBB' };

export const poolOf = (p) => (state.data?.draft_pool || []).find((x) => x.player_id === (p.prospect_id || p.player_id));

// 기록 한 시즌(대학·해외·G리그 공통 형식)으로 강점·약점 뽑기
function traits(s, pos, nba = false) {
  const g = s.g || 0, per = (k) => (s[`${k}_per_g`] ?? s[`${k}_per_game`] ?? (g && s[k] != null ? s[k] / g : null));
  const pts = per('pts'), reb = per('trb'), ast = per('ast'), stl = per('stl'), blk = per('blk');
  const fg3 = s.fg3_pct ?? s.x3p_percent, fg3a = s.fg3a_per_g ?? s.x3pa_per_game ?? (g && s.fg3a != null ? s.fg3a / g : null);
  const ft = s.ft_pct ?? s.ft_percent, ts = s.ts_pct ?? s.ts_percent, usg = s.usg_pct ?? s.usg_percent;
  const good = [], bad = [], G = grp(pos);
  // 출전 시간이 적으면 리바·어시·블록·스틸 기준을 시간에 맞춰 낮춤 (30분 기준)
  const mp = s.mp_per_g ?? s.mp_per_game ?? (g && s.mp ? s.mp / g : null), k = mp ? Math.min(1, Math.max(0.55, mp / 30)) : 1;
  if (fg3 != null && fg3a >= 3 && fg3 >= 0.375) good.push([3, `3점슛 ${pc(fg3)}(경기당 ${f1(fg3a)}개 시도)로 슈터 역할이 가능해요`]);
  if (ts != null && ts >= (nba ? 0.6 : 0.6)) good.push([2.5, `야투 효율(TS ${pc(ts)})이 아주 좋아요`]);
  if (ast >= (G === 'G' ? 5 : 3.5) * k) good.push([2.4, `경기당 ${f1(ast)}어시스트로 패스 시야가 좋아요`]);
  if (reb >= (G === 'C' ? 9 : G === 'F' ? 7.5 : 6) * k) good.push([2.2, `경기당 ${f1(reb)}리바운드로 리바운드 경쟁력이 있어요`]);
  if (blk >= (nba ? 1.3 : 1.8) * k) good.push([2.3, `경기당 ${f1(blk)}블록으로 골밑을 지켜요`]);
  if (stl >= (nba ? 1.3 : 1.7) * k) good.push([1.8, `경기당 ${f1(stl)}스틸로 손질이 좋아요`]);
  if (usg >= 28 && pts >= (nba ? 20 : 17)) good.push([2.6, `공격의 중심(점유율 ${f1(usg)}%)으로 경기당 ${f1(pts)}점을 책임졌어요`]);
  if (pts >= (nba ? 15 : 15) && !(usg >= 28 && pts >= (nba ? 20 : 17))) good.push([2.1, `경기당 ${f1(pts)}점을 올린 믿을 만한 득점원이에요`]);
  if (ft != null && ft >= 0.85 && !(fg3 >= 0.375)) good.push([1.5, `자유투 ${pc(ft)}로 슛 감각이 좋아요`]);
  if (fg3 != null && (fg3a ?? 2) >= 2 && fg3 > 0 && fg3 < 0.31) bad.push([2.5, `3점슛(${pc(fg3)})은 아직 불안해요`]);
  if (ft != null && ft < 0.66 && (s.fta || s.fta_per_game || 1) > 0) bad.push([2.2, `자유투(${pc(ft)})가 약점이에요`]);
  if (ts != null && ts < (nba ? 0.52 : 0.5)) bad.push([2, `야투 효율(TS ${pc(ts)})이 낮아요`]);
  if (G === 'G' && ast != null && ast < 2 * k && !nba) bad.push([1.2, '가드치고 패스로 만드는 공격은 적어요']);
  if (G === 'C' && reb != null && reb < 6 * k) bad.push([1.4, `빅맨치고 리바운드(${f1(reb)}개)가 적어요`]);
  good.sort((a, b) => b[0] - a[0]); bad.sort((a, b) => b[0] - a[0]);
  return { good: good.map((x) => x[1]), bad: bad.map((x) => x[1]), mp };
}
const sentence = (t) => {
  const g = t.good.slice(0, 2), b = t.bad[0];
  if (!g.length && !b) return t.mp != null && t.mp < 16 ? `평균 ${f1(t.mp)}분으로 출전 시간이 적어서 기록만으로 판단하기 어려워요. 연습과 영상으로 더 봐야 해요.` : '기록에서 크게 튀는 강점이나 약점은 보이지 않아요. 고르게 하는 유형이에요.';
  return [g.length ? g.join('. ') + '.' : '기록으로 두드러진 강점은 아직 없어요.', b ? `다만 ${b}.` : ''].join(' ').trim();
};

// ── 유망주 (드래프트 대상 / 올해 신인) ──
function prospect(q) {
  const lines = [], cs = q.college_seasons || [], ps = q.pro_seasons || [], gl = q.gleague_seasons || [];
  const last = cs[cs.length - 1], prev = cs[cs.length - 2], pro = ps[ps.length - 1], g = gl[gl.length - 1];
  let base = null;
  if (last && (!pro || (last.season >= (pro.season || '')))) {
    base = last;
    const trend = prev && (prev.g || 0) >= 10 && prev.pts_per_g != null && last.pts_per_g != null && Math.abs(last.pts_per_g - prev.pts_per_g) >= 3 ? ` 전 시즌보다 득점이 ${f1(Math.abs(last.pts_per_g - prev.pts_per_g))}점 ${last.pts_per_g > prev.pts_per_g ? '늘었어요' : '줄었어요'}.` : '';
    lines.push(`${q.college || last.college_id}${last.conf ? `(${last.conf}${POWER.has(last.conf) ? '·상위권 리그' : '·중소 리그'})` : ''} ${q.class_at_draft || cs.length + '년 차'}: ${last.season} ${n0(last.g)}경기 평균 ${f1(last.pts_per_g)}득점 ${f1(last.trb_per_g)}리바 ${f1(last.ast_per_g)}어시 (야투 ${pc(last.fg_pct)}, 3점 ${pc(last.fg3_pct)}).${trend}`);
  } else if (pro) {
    base = pro;
    lines.push(`${LEAGUE_KO[pro.league] || pro.league || '해외 리그'} ${pro.team || ''}에서 ${pro.season} 평균 ${f1(pro.mp_per_g)}분 ${f1(pro.pts_per_g)}득점 ${f1(pro.trb_per_g)}리바 ${f1(pro.ast_per_g)}어시${pro.fg3_pct ? ` (3점 ${pc(pro.fg3_pct)})` : ''}. 성인 무대 경험이 있다는 게 장점이에요.`);
  } else if (g) {
    base = g;
    lines.push(`G리그${g.team_id === 'GLI' ? ' 이그나이트(유망주 육성팀)' : ''}에서 ${g.season} ${n0(g.g)}경기 평균 ${f1(g.pts_per_g)}득점 ${f1(g.trb_per_g)}리바 ${f1(g.ast_per_g)}어시 (야투 ${pc(g.fg_pct)}, 3점 ${pc(g.fg3_pct)}).`);
  } else lines.push(`${q.pre_draft_team || '소속 정보 없음'}. 이 선수의 경기 기록은 자료에 없어요 (기록 없음).`);
  lines.push(base ? sentence(traits(base, q.position)) : '기록이 없어서 강점·약점을 판단하기 어려워요. 영상 스카우팅이 더 필요해요.');
  // 3줄: 몸 + 평가
  const c = q.combine || {}, bits = [];
  if (!c.skipped && c.height_shoes) {
    const span = c.wingspan && c.height_shoes ? c.wingspan - c.height_shoes : null;
    bits.push(`신발 신고 ${ftIn(c.height_shoes)}${span != null ? `, 윙스팬이 키보다 ${span >= 0 ? f1(span) + '인치 길어요' : f1(-span) + '인치 짧아요'}` : ''}`);
    if (c.max_vertical >= 38) bits.push(`최고 점프 ${f1(c.max_vertical)}인치로 탄력이 뛰어나요`);
    else if (c.max_vertical != null && c.max_vertical < 30) bits.push(`점프(${f1(c.max_vertical)}인치)는 낮은 편이에요`);
  } else bits.push('컴바인 측정에는 참가하지 않았어요');
  const age = q.age_at_draft, r = q.pre_draft_rank;
  bits.push(`드래프트 때 ${age}세${age <= 19 ? '로 어려서 성장 여지가 커요' : age >= 22 ? '로 많은 편이라 완성형에 가까워요' : ''}`);
  if (r?.rank) bits.push(`종합 빅보드 ${r.rank}위`);
  lines.push(bits.join(' · ') + '.');
  return lines;
}

// ── NBA 선수 ──
function veteran(p) {
  const h = p.nba_history || [], last = h[h.length - 1], prev = h[h.length - 2];
  if (!last) return ['NBA 경기 기록이 자료에 없어요 (기록 없음).', '기록이 없어서 강점·약점을 판단하기 어려워요.', `${p.age ?? '?'}세 · 경력 ${p.experience_seasons ?? 0}시즌.`];
  const tm = (last.teams || []).join('→');
  const role = last.gs != null && last.g ? (last.gs / last.g >= 0.6 ? '주전' : last.gs / last.g >= 0.2 ? '주전과 벤치를 오가며' : '벤치에서') : '';
  const trend = prev && prev.pts_per_game != null && Math.abs(last.pts_per_game - prev.pts_per_game) >= 3 ? ` 전 시즌보다 득점이 ${last.pts_per_game > prev.pts_per_game ? '늘었어요' : '줄었어요'}(${f1(prev.pts_per_game)}→${f1(last.pts_per_game)}).` : '';
  const l1 = `${last.season} ${tm} ${role} ${last.g}경기, ${f1(last.mp_per_game)}분 평균 ${f1(last.pts_per_game)}득점 ${f1(last.trb_per_game)}리바 ${f1(last.ast_per_game)}어시.${trend}`;
  const l2 = sentence(traits({ ...last, g: last.g }, p.pos, true));
  const bits = [], age = p.age;
  bits.push(`${age}세${age <= 24 ? ', 아직 성장하는 나이' : age <= 29 ? ', 전성기 나이' : age <= 32 ? ', 하락이 시작될 수 있는 나이' : ', 하락 구간이라 단기 계약이 안전해요'}`);
  const recent = h.slice(-3), gAvg = recent.reduce((a, x) => a + (x.g || 0), 0) / recent.length;
  if (recent.length >= 2) bits.push(gAvg < 50 ? `최근 ${recent.length}시즌 평균 ${f1(gAvg)}경기 출전으로 결장이 잦아요` : gAvg >= 70 ? `최근 ${recent.length}시즌 평균 ${f1(gAvg)}경기로 꾸준히 뛰었어요` : `최근 ${recent.length}시즌 평균 ${f1(gAvg)}경기 출전`);
  const as = (p.honors || []).filter((x) => /올스타/.test(x.honor)).length, an = (p.honors || []).filter((x) => /올-NBA/.test(x.honor)).length;
  if (as || an) bits.push([as ? `올스타 ${as}회` : '', an ? `올-NBA ${an}회` : ''].filter(Boolean).join(' · '));
  const b = bpmOf(p);
  bits.push(`게임 예상: ${b >= 4 ? '팀의 핵심' : b >= 1.5 ? '확실한 주전급' : b >= -0.5 ? '주전·로테이션 경계' : b >= -2 ? '로테이션 선수' : '벤치 끝 자원'}`);
  return [l1, l2, bits.join(' · ') + '.'];
}

export function report(p) {
  if (!p) return [];
  if (p.college_seasons || p.pre_draft_rank || p.combine) return prospect(p);   // 드래프트 대상
  const q = (p.rookie || p.prospect_id) ? poolOf(p) : null;
  if (q && !(p.nba_history || []).length) return prospect(q);                   // 올해 신인
  return veteran(p);
}
