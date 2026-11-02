// 캡 스코어보드: 지금 쓸 수 있는 돈을 중계 점수판처럼 한눈에 (FA·트레이드·연장·재정 화면 위)
// 막대 = 캡 기준 총액(계약 연봉 + 데드머니 + 홀드), 선 = 샐러리캡·사치세·에이프런
import { esc, money } from '../util.js';
import { state, teamBy } from '../store.js';
import { capSheet, tools as capTools } from '../capsheet.js';
import { teamPayroll } from '../rules.js';
import { term } from '../glossary.js';

const signed = (v) => (v >= 0 ? money(v, 1) : '−' + money(-v, 1));

// opts.tools: [{label, amount}] 화면에 맞춘 수단 목록 (없으면 캡 상황판 기준) / opts.hardcap: {amount}
export function capBug(opts = {}) {
  const me = state.save.team, l = state.data.league, t = teamBy(me);
  const sh = capSheet(me), pay = teamPayroll(t, state.data.season);
  const std = t.roster.filter((q) => q.roster_role !== 'two_way').length, tw = t.roster.length - std;
  const ap1 = l.first_apron || l.apron, ap2 = l.second_apron;
  // [키, 막대 위 짧은 이름, 아래 줄 이름, 금액, 위/아래]
  const lines = [['cap', '캡', '샐러리캡', l.salary_cap, 'up'], ['tax', '사치세', '사치세', l.tax_level, 'dn'],
    ['ap', l.first_apron ? '1차' : '에이프런', l.first_apron ? '1차 에이프런' : '에이프런', ap1, 'up'], ...(ap2 ? [['ap2', '2차', '2차 에이프런', ap2, 'dn']] : [])];
  const solid = sh.parts.salary + sh.parts.dead, holds = sh.total - solid;
  const top = Math.max(ap2 || ap1, sh.total, pay) * 1.12, w = (v) => Math.max(0, Math.min(100, (v / top) * 100));
  const list = (opts.tools || capTools(sh).filter((x) => x.k !== 'bird').map((x) => ({ label: x.name, amount: x.amount })));
  const room = sh.room, zone = pay >= (ap2 || Infinity) ? '2차 에이프런 위' : pay >= ap1 ? '에이프런 위' : pay >= l.tax_level ? '사치세 구간' : '';
  const sub = room > 0 ? '이 금액까지 어느 FA와도 계약할 수 있어요' : `캡 초과${zone ? ' · ' + zone : ''} · 버드 권리와 예외로 영입`;
  return `<section class="capbug" aria-label="캡 상황">
    <div class="big"><span class="k">${term('salary_cap', '캡')} 여유</span><b class="v ${room > 0 ? 'pos' : 'neg'}">${signed(room)}</b><span class="s">${sub}</span></div>
    <div class="rt">
      <div class="cb-bar" role="img" aria-label="캡 기준 총액 ${money(sh.total, 1)}, 샐러리캡 ${money(l.salary_cap, 1)}">
        <div class="f" style="width:${w(solid)}%"></div><div class="h" style="left:${w(solid)}%;width:${w(sh.total) - w(solid)}%"></div>
        ${lines.map(([k, n, , v, pos]) => `<div class="m ${k} ${pos}" style="left:${w(v)}%"><span>${n}</span></div>`).join('')}
      </div>
      <p class="cb-lines">${lines.map(([, , n, v]) => `${n} <b>${money(v, 1)}</b>`).join('<span>·</span>')}</p>
      <div class="cb-leg"><span>실제 총연봉<b>${money(pay, 1)}</b></span><span>캡 기준 총액 (홀드 포함)<b>${money(sh.total, 1)}</b></span>
        <span>로스터<b>${std}</b> + 투웨이 ${tw}</span>${opts.hardcap ? `<span>하드캡<b>${money(opts.hardcap.amount, 1)}</b></span>` : ''}
        <span class="cb-tools">쓸 수 있는 돈 ${list.length ? list.map((x) => `<i>${esc(x.label)}${x.amount ? ' ' + money(x.amount, 1) : ''}</i>`).join('') : '<i>없음</i>'}</span></div>
    </div></section>`;
}
