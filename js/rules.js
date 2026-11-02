// NBA 규정 계산 (그해 노사협약 기준 숫자는 data.league 에 있음)
import { state } from './store.js';

export const seasonOf = (y) => `${y}-${String(y + 1).slice(2)}`;
export const nextSeasons = (n = 4) => {
  const y0 = +state.data.season.slice(0, 4);
  return Array.from({ length: n }, (_, i) => seasonOf(y0 + i));
};

// 선수의 그 시즌 캡 반영액 (없으면 연봉)
export function capHit(p, season) {
  const y = (p.contract?.years || []).find((x) => x.season === season);
  if (!y) return null;
  return y.cap_hit ?? y.salary ?? null;
}

// 팀 총연봉 (투웨이 제외) + 데드머니
export function teamPayroll(t, season) {
  let sum = 0;
  for (const p of t.roster) {
    if (p.roster_role === 'two_way') continue;
    sum += capHit(p, season) || 0;
  }
  for (const d of t.dead_money || []) for (const y of d.years || []) if (y.season === season) sum += y.amount || 0;
  return sum;
}

// 사치세 (넘은 금액을 구간으로 나눠 구간별 세율 적용)
export function luxuryTax(payroll, repeater = false) {
  const L = state.data.league, lt = L.luxury_tax;
  let over = payroll - L.tax_level;
  if (over <= 0) return 0;
  let tax = 0, i = 0;
  while (over > 0) {
    const part = Math.min(over, lt.bracket_size);
    let rate = i < lt.rates_first4.length ? lt.rates_first4[i] : lt.rates_first4[lt.rates_first4.length - 1] + lt.increment_after * (i - lt.rates_first4.length + 1);
    if (repeater) rate += lt.repeater_add;
    tax += part * rate; over -= part; i++;
  }
  return tax;
}

// 그해 노사협약의 기준선들 (2017 협약: 에이프런 1개 / 2023 협약: 1차·2차 에이프런)
export function capLines() {
  const L = state.data.league;
  const out = [['salary_cap', '샐러리캡', L.salary_cap], ['tax_level', '사치세 기준선', L.tax_level]];
  if (L.first_apron) out.push(['first_apron', '1차 에이프런', L.first_apron], ['second_apron', '2차 에이프런', L.second_apron]);
  else if (L.apron) out.push(['apron', '에이프런', L.apron]);
  return out.filter(([, , v]) => v);
}

// 총연봉이 어느 선 사이에 있는지
export function capStatus(payroll) {
  const L = state.data.league;
  if (L.second_apron && payroll >= L.second_apron) return { k: 'apron2', t: '2차 에이프런 초과', cls: 'bad' };
  if (L.first_apron && payroll >= L.first_apron) return { k: 'apron1', t: '1차 에이프런 초과', cls: 'bad' };
  if (L.apron && payroll >= L.apron) return { k: 'apron', t: '에이프런 초과', cls: 'bad' };
  if (payroll >= L.tax_level) return { k: 'tax', t: '사치세 구간', cls: 'warn' };
  if (payroll >= L.salary_cap) return { k: 'over', t: '캡 초과 (사치세 아래)', cls: '' };
  return { k: 'room', t: '캡 여유', cls: 'good' };
}

export const twoWayMax = () => ((state.data.league.cba || '').startsWith('2023') ? 3 : 2);
