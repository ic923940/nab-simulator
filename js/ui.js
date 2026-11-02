// 단계가 바뀔 때 띄우는 안내 창 (확인을 눌러야 넘어감)
import { esc } from './util.js';
export function notice(title, text, onOk, opt = {}) {
  document.getElementById('notice')?.remove();
  const el = document.createElement('div');
  el.id = 'notice'; el.className = 'notice-bg';
  el.innerHTML = `<div class="notice" role="dialog" aria-modal="true"><h2>${esc(title)}</h2><p>${esc(text)}</p><p><button class="go" id="notice-ok">${esc(opt.ok || '확인')}</button>${opt.cancel ? ' <button class="go ghost" id="notice-cancel">취소</button>' : ''}</p></div>`;
  document.body.append(el);
  const ok = el.querySelector('#notice-ok'); ok.focus();
  ok.onclick = () => { el.remove(); onOk && onOk(); };
  el.querySelector('#notice-cancel')?.addEventListener('click', () => el.remove());
}
