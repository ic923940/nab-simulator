// 에이전트 채팅: 자유롭게 쓴 한국어 문장을 게임 행동(제안·질문·설득)으로 바꿈 (규칙 기반, 서버 없음)
// 예) "3년 2천만 달러 어때요?" → 제안 { yrs: 3, s1: 20,000,000 }
//     "총 6천만에 3년, 매년 5% 인상, 마지막 해 선수 옵션" → 제안 { total, yrs, raise, opt }
//     "다른 팀 제안은 받았어요?" → 질문 market
//     "우리 팀에 오면 우승할 수 있어요" → 설득 win

const UNIT = { 억: 1e8, 천만: 1e7, 백만: 1e6, 만: 1e4 };

// 금액 찾기: '2천만', '3500만', '1억 2천만', '20M', '$20.5M', '2000만 달러', '20밀리언'
export function money(text) {
  const t = text.replace(/,/g, '');
  const out = [];
  // 한국식 단위 (연속된 '1억 2천만' 은 합침)
  const re = /((?:\d+(?:\.\d+)?\s*(?:억|천만|백만|만)\s*)+)/g;
  let m;
  while ((m = re.exec(t))) {
    let v = 0; const part = /(\d+(?:\.\d+)?)\s*(억|천만|백만|만)/g; let q;
    while ((q = part.exec(m[1]))) v += parseFloat(q[1]) * UNIT[q[2]];
    out.push({ v, at: m.index, len: m[0].length });
  }
  // 영어식 단위
  const re2 = /\$?\s*(\d+(?:\.\d+)?)\s*(m\b|mil\b|million|밀리언|M)/gi;
  while ((m = re2.exec(t))) out.push({ v: parseFloat(m[1]) * 1e6, at: m.index, len: m[0].length });
  // '$20' 또는 '20 달러'(단위 없이) → 백만 달러로 봄 (1~60 사이일 때만)
  const re3 = /\$\s*(\d+(?:\.\d+)?)(?!\s*(?:억|천만|백만|만|m|mil|밀리언))|(\d+(?:\.\d+)?)\s*(?:달러|불)/gi;
  while ((m = re3.exec(t))) {
    const n = parseFloat(m[1] || m[2]);
    if (out.some((o) => m.index >= o.at && m.index < o.at + o.len)) continue;
    if (n >= 1 && n <= 60) out.push({ v: n * 1e6, at: m.index, len: m[0].length });
    else if (n >= 500000) out.push({ v: n, at: m.index, len: m[0].length });
  }
  return out.sort((a, b) => a.at - b.at);
}

const has = (t, re) => re.test(t);

export function parse(raw) {
  const t = raw.trim(), low = t.toLowerCase();
  if (!t) return { kind: 'empty' };
  const res = { kind: 'unknown', patch: {}, q: null, topic: null };
  const ms = money(t);
  // 기간
  const y = t.match(/([1-5])\s*년/) || t.match(/([1-5])\s*(?:years?|yrs?)\b/i) || (has(t, /단년|1년짜리/) ? [0, '1'] : null);
  if (y) res.patch.yrs = +y[1];
  // 인상률
  const r = t.match(/(\d+(?:\.\d+)?)\s*%/);
  if (r) res.patch.raise = Math.min(0.08, parseFloat(r[1]) / 100);
  else if (has(t, /인상\s*(없|없이)|동결|고정\s*연봉/)) res.patch.raise = 0;
  // 옵션
  if (has(t, /선수\s*옵션|플레이어\s*옵션|player\s*option/i)) res.patch.opt = 'player';
  else if (has(t, /팀\s*옵션|team\s*option/i)) res.patch.opt = 'team';
  else if (has(t, /옵션\s*(없|빼)/)) res.patch.opt = 'none';
  // 계약 수단
  const TOOLS = [[/투웨이|two.?way/i, 'two_way'], [/캠프\s*계약|exhibit|엑시비트|익시비트/i, 'ex10'], [/최저\s*(연봉)?|미니멈|minimum/i, 'min'], [/미드\s*레벨|mle/i, 'mle'], [/격년|bae/i, 'bae'], [/버드/i, 'bird'], [/캡\s*(스페이스|공간)|룸\s*으로/i, 'room']];
  for (const [re, k] of TOOLS) if (re.test(t)) { res.patch.tool = k; break; }
  // 금액: '총/총액' 바로 뒤 금액은 총액
  if (ms.length) {
    const first = ms[0], before = t.slice(Math.max(0, first.at - 6), first.at);
    if (/총\s*액?\s*$|합계\s*$|토탈\s*$/.test(before) || /총\s*액?\s*(?:으로|이|은)?\s*\d/.test(t) && ms.length === 1 && /총/.test(t.slice(0, first.at + 1))) res.patch.total = first.v;
    else res.patch.s1 = first.v;
  }
  // 상대 역제안/요구 그대로
  if (has(t, /역제안\s*(받|수락|좋)|그\s*조건(으로|이면)?\s*(할게|좋|갑시다|오케이|ok)|그걸로\s*(하|가)|콜/i)) res.take = true;
  if (has(t, /(원하는|요구(하신|한)?)\s*(대로|조건\s*그대로)|달라는\s*대로/)) res.asWant = true;
  if (has(t, /철회|거둬|취소할게|없던\s*걸로/)) res.withdraw = true;
  const offerish = Object.keys(res.patch).length > 0 || res.take || res.asWant;
  // 질문
  if (has(t, /다른\s*(구단|팀|데)|경쟁|오퍼\s*(받|있|들어)|제안\s*(받|들어|있|왔)|몇\s*(팀|구단)/)) res.q = 'market';
  else if (has(t, /원하(는|시는|세요|나요|냐)|요구(하|사항|액|조건)|얼마(를|면|나|정도)|희망\s*(연봉|조건)|조건(이|은)\s*(뭐|어떻)/)) res.q = 'want';
  else if (has(t, /중요(하게|한|시)|우선\s*순위|뭘\s*(제일|가장)|무엇을\s*(제일|가장)?|가치관|뭐\s*보고/)) res.q = 'prefs';
  else if (has(t, /우리\s*(팀|구단)?\s*(을|를|은|는|에\s*대해)?\s*(어때|어떻|생각)|우리\s*어때/)) res.q = 'us';
  // 설득 (금액이 없는 말일 때)
  if (has(t, /우승|컨텐더|챔피언|플레이오프|우승권|이기는\s*팀|강팀/)) res.topic = 'win';
  else if (has(t, /주전|선발|출전\s*시간|역할|많이\s*뛰|핵심|에이스|중심|롤/)) res.topic = 'role';
  else if (has(t, /의리|남아\s*(줘|주|달)|돌아와|가족|함께\s*(해|한)|고향|우리\s*선수|원클럽/)) res.topic = 'loyal';
  else if (has(t, /돈|최고\s*대우|맥스|많이\s*(줄|드릴)|대우/)) res.topic = 'money';
  if (res.withdraw) res.kind = 'withdraw';
  else if (offerish) res.kind = 'offer';
  else if (res.q) res.kind = 'question';
  else if (res.topic) res.kind = 'pitch';
  else if (has(low, /안녕|반가|하이|hello|\bhi\b|처음\s*뵙/)) res.kind = 'hello';
  else if (has(t, /고마|감사|땡큐|thank/i)) res.kind = 'thanks';
  return res;
}
