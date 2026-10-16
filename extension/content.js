(() => {
  if (window.top !== window || window.__ssLoaded) return;
  window.__ssLoaded = true;

  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:16px;bottom:16px;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    * { box-sizing: border-box; font: 13px/1.45 system-ui, sans-serif; }
    #bubble { width: 44px; height: 44px; border-radius: 50%; border: 0; background: #4f8cff; color: #fff; font-size: 20px; font-weight: 700;
      cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.35); }
    #panel { width: 340px; max-height: 70vh; display: flex; flex-direction: column; background: #14161b; color: #e8eaf0;
      border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,.45); overflow: hidden; }
    #bar { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: #1d2028; cursor: move; user-select: none; }
    #bar b { font-weight: 700; }
    #body { padding: 10px; overflow: auto; }
    .row { display: flex; gap: 6px; margin-bottom: 6px; }
    button { flex: 1; padding: 8px; border: 0; border-radius: 8px; background: #4f8cff; color: #fff; font-weight: 600; cursor: pointer; }
    button.alt { background: #2a2e38; }
    button:disabled { opacity: .5; cursor: default; }
    #bar button { flex: 0; padding: 2px 9px; background: transparent; font-size: 16px; }
    input { width: 100%; background: #1d2028; color: inherit; border: 1px solid #333846; border-radius: 8px; padding: 7px; margin-bottom: 6px; }
    #status { color: #9aa3b5; min-height: 18px; margin: 4px 0; }
    #status.err { color: #ff7a7a; }
    #out { background: #1d2028; border-radius: 8px; padding: 10px; word-wrap: break-word; }
    #out:empty { display: none; }
    code { background: #2a2e38; padding: 0 4px; border-radius: 4px; }
    a { color: #7aa7ff; cursor: pointer; }
    [hidden] { display: none !important; }
  </style>
  <button id="bubble" title="screen-solver (Alt+S)">?</button>
  <div id="panel" hidden>
    <div id="bar"><b>screen-solver</b><span><button id="min" title="Minimise">–</button></span></div>
    <div id="body">
      <div id="setup" hidden>
        <p>Paste your free Gemini API key to start. Get one at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>.</p>
        <input id="key" type="password" placeholder="Paste key here" autocomplete="off">
        <div class="row"><button id="start">Start</button></div>
        <div id="setupMsg" style="color:#9aa3b5"></div>
      </div>
      <div id="main" hidden>
        <div class="row"><button id="mSolve">Solve</button><button id="mMark" class="alt">Mark</button></div>
        <div class="row"><button id="go">Read whole tab</button><button id="area" class="alt">Select area</button></div>
        <input id="note" placeholder="Optional: e.g. 'only Q3' or 'explain simply'">
        <div id="status"></div>
        <div id="out"></div>
        <div class="row" style="margin-top:6px;align-items:center"><button id="copy" class="alt" hidden>Copy</button><a id="chg" style="flex:0;white-space:nowrap;margin-left:auto">Change key</a></div>
      </div>
    </div>
  </div>`;
  document.documentElement.appendChild(host);

  const $ = id => root.getElementById(id);
  const store = chrome.storage.local;
  let mode = 'solve', lastText = '', busyNow = false;

  // Stop the page's keyboard shortcuts stealing typing in our boxes
  ['keydown', 'keyup', 'keypress'].forEach(t => host.addEventListener(t, e => e.stopPropagation()));

  const setStatus = (t, err) => { $('status').textContent = t; $('status').className = err ? 'err' : ''; };
  const busy = b => { busyNow = b; ['go', 'area'].forEach(id => $(id).disabled = b); };
  const send = msg => new Promise(r => chrome.runtime.sendMessage(msg, res => r(res || { error: chrome.runtime.lastError?.message || 'No response' })));

  function render(text) {
    lastText = text;
    $('out').innerHTML = text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^#+\s*(.+)$/gm, '<b>$1</b>').replace(/\n/g, '<br>');
    $('copy').hidden = false;
  }

  // Open / close
  function open() {
    $('bubble').hidden = true; $('panel').hidden = false;
    store.get(['key', 'pos']).then(({ key, pos }) => {
      $('setup').hidden = !!key; $('main').hidden = !key;
      if (pos) place(pos.x, pos.y);
    });
  }
  function close() {
    $('panel').hidden = true; $('bubble').hidden = false;
    Object.assign(host.style, { left: 'auto', top: 'auto', right: '16px', bottom: '16px' });
  }
  $('bubble').onclick = open;
  $('min').onclick = close;
  chrome.runtime.onMessage.addListener(m => { if (m.type === 'toggle') $('panel').hidden ? open() : close(); });

  // Drag the window by its title bar
  let drag = null;
  function place(x, y) {
    x = Math.max(0, Math.min(innerWidth - 120, x)); y = Math.max(0, Math.min(innerHeight - 40, y));
    Object.assign(host.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' });
  }
  $('bar').onpointerdown = e => {
    if (e.target.closest('button')) return;
    const r = host.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    $('bar').setPointerCapture(e.pointerId);
  };
  $('bar').onpointermove = e => drag && place(e.clientX - drag.dx, e.clientY - drag.dy);
  $('bar').onpointerup = () => {
    if (!drag) return; drag = null;
    const r = host.getBoundingClientRect(); store.set({ pos: { x: r.left, y: r.top } });
  };

  // Key setup
  $('start').onclick = async () => {
    const key = $('key').value.replace(/\s/g, '');
    if (!key) return $('setupMsg').textContent = 'Paste your key first.';
    $('start').disabled = true; $('setupMsg').textContent = 'Checking key…';
    const r = await send({ type: 'checkKey', key });
    $('start').disabled = false;
    if (r.error) return $('setupMsg').textContent = "That key didn't work: " + r.error;
    $('setupMsg').textContent = ''; $('setup').hidden = true; $('main').hidden = false;
    setStatus('Ready. Press "Read whole tab".');
  };
  $('key').onkeydown = e => { if (e.key === 'Enter') $('start').click(); };
  $('chg').onclick = () => { $('main').hidden = true; $('setup').hidden = false; $('key').value = ''; $('key').focus(); };

  // Mode
  function setMode(m) {
    mode = m; store.set({ mode: m });
    $('mSolve').className = m === 'solve' ? '' : 'alt'; $('mMark').className = m === 'mark' ? '' : 'alt';
    $('go').textContent = m === 'mark' ? 'Mark whole tab' : 'Read whole tab';
  }
  $('mSolve').onclick = () => setMode('solve');
  $('mMark').onclick = () => setMode('mark');

  // Read all page text, plus anything typed into boxes (for marking)
  function pageText() {
    let t = (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n');
    const typed = [...document.querySelectorAll('input:not([type=hidden]):not([type=password]), textarea, select')]
      .filter(el => el.value && el.type !== 'submit' && el.type !== 'button' && ((el.type !== 'checkbox' && el.type !== 'radio') || el.checked))
      .map((el, i) => {
        const label = el.labels?.[0]?.innerText || el.getAttribute('aria-label') || el.placeholder || el.name || 'box ' + (i + 1);
        return `- ${label.trim().slice(0, 80)}: ${String(el.value).slice(0, 500)}`;
      });
    if (typed.length) t += '\n\n--- TYPED INTO BOXES ---\n' + typed.join('\n');
    return t.slice(0, 60000);
  }

  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60))));

  async function run(rect) {
    if (busyNow) return;
    busy(true); setStatus('Reading tab…');
    host.style.visibility = 'hidden'; await frame();
    const cap = await send({ type: 'capture', rect, vw: innerWidth });
    host.style.visibility = 'visible';
    if (cap.error) { busy(false); return setStatus("Couldn't read this tab: " + cap.error, true); }
    setStatus(mode === 'mark' ? 'Marking…' : 'Solving…');
    const r = await send({ type: 'ask', b64: cap.b64, pageText: rect ? '' : pageText(), mode, note: $('note').value.trim() });
    busy(false);
    if (r.error) return setStatus(r.error, true);
    render(r.text); store.set({ last: r.text }); setStatus('Done.');
  }
  $('go').onclick = () => run(null);

  // Drag a box around one question
  $('area').onclick = () => {
    if (busyNow) return;
    host.style.visibility = 'hidden';
    const o = document.createElement('div');
    o.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,.25);touch-action:none';
    const box = document.createElement('div');
    box.style.cssText = 'all:initial;position:fixed;border:2px solid #4f8cff;background:rgba(79,140,255,.15);display:none;pointer-events:none';
    const tip = document.createElement('div');
    tip.textContent = 'Drag around the question · Esc to cancel';
    tip.style.cssText = 'all:initial;position:fixed;top:12px;left:50%;transform:translateX(-50%);background:#111;color:#fff;font:14px system-ui,sans-serif;padding:6px 12px;border-radius:6px;pointer-events:none';
    o.append(box, tip); document.documentElement.appendChild(o);
    let sx, sy, d = false;
    const rect = e => ({ x: Math.min(sx, e.clientX), y: Math.min(sy, e.clientY), w: Math.abs(e.clientX - sx), h: Math.abs(e.clientY - sy) });
    const upd = e => { const r = rect(e); Object.assign(box.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' }); };
    const done = () => { o.remove(); removeEventListener('keydown', esc, true); host.style.visibility = 'visible'; };
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); done(); setStatus('Cancelled.'); } };
    addEventListener('keydown', esc, true);
    o.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; d = true; box.style.display = 'block'; upd(e); o.setPointerCapture(e.pointerId); e.preventDefault(); });
    o.addEventListener('pointermove', e => d && upd(e));
    o.addEventListener('pointerup', e => {
      if (!d) return; d = false;
      const r = rect(e); done();
      if (r.w < 5 || r.h < 5) return setStatus('Cancelled.');
      run(r);
    });
  };

  $('copy').onclick = () => navigator.clipboard.writeText(lastText).then(() => setStatus('Copied.'), () => setStatus('Copy blocked on this page.', true));

  store.get(['mode', 'last']).then(({ mode: m, last }) => { setMode(m || 'solve'); if (last) render(last); });
})();
