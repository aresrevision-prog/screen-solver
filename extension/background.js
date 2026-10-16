const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const PREFERRED = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash'];

// Toolbar icon / Alt+S toggles the floating window
chrome.action.onClicked.addListener(async tab => {
  try { await chrome.tabs.sendMessage(tab.id, { type: 'toggle' }); }
  catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tab.id, { type: 'toggle' });
    } catch {} // chrome:// pages and the Web Store can't be used
  }
});

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  const reply = p => { p.then(r => respond(r), e => respond({ error: e.message, status: e.status })); return true; };
  if (msg.type === 'checkKey') return reply(findModels(msg.key).then(models => ({ models })));
  if (msg.type === 'capture') return reply(capture(sender.tab, msg.rect, msg.vw).then(b64 => ({ b64 })));
  if (msg.type === 'ask') return reply(ask(msg).then(text => ({ text })));
});

async function findModels(key) {
  const res = await fetch(`${API}?pageSize=200&key=${encodeURIComponent(key)}`);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error?.message || 'HTTP ' + res.status);
  const ok = (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace('models/', ''));
  const list = PREFERRED.filter(m => ok.includes(m));
  const extra = ok.filter(m => /flash/.test(m) && !/(tts|image|audio|live|embedding|thinking)/.test(m) && !list.includes(m));
  const all = [...list, ...extra];
  if (!all.length) throw new Error('No usable models on this key.');
  await chrome.storage.local.set({ key, models: all });
  return all;
}

async function capture(tab, rect, vw) {
  const url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  if (!rect) return url.split(',')[1];
  const bmp = await createImageBitmap(await (await fetch(url)).blob());
  const s = bmp.width / vw;
  const x = Math.round(rect.x * s), y = Math.round(rect.y * s);
  const w = Math.max(1, Math.min(Math.round(rect.w * s), bmp.width - x));
  const h = Math.max(1, Math.min(Math.round(rect.h * s), bmp.height - y));
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d').drawImage(bmp, x, y, w, h, 0, 0, w, h);
  const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
  let str = '';
  for (let i = 0; i < buf.length; i += 0x8000) str += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(str);
}

async function ask({ b64, pageText, mode, note }) {
  const { key, models } = await chrome.storage.local.get(['key', 'models']);
  if (!key) throw new Error('Add your API key first.');
  const task = mode === 'mark'
    ? "This shows a student's answers to questions. For each question: say whether the student's answer is correct (✓) or wrong (✗), " +
      'give the correct answer in bold if wrong, and one line of feedback on the mistake. Award marks fairly, including method marks. ' +
      'Finish with **Total: X / Y** and one line of overall feedback. Be concise.'
    : 'Find the question(s) or problem(s) and solve them. For each: number it, give the final answer first in bold, ' +
      'then short step-by-step working. Be concise.';
  const parts = [{ text:
    'You are given a screenshot of what is visible' + (pageText ? ', plus the full text of the web page (including parts not on screen)' : '') + '. ' +
    task + (note ? '\nExtra instruction: ' + note : '') +
    (pageText ? '\n\n--- PAGE TEXT ---\n' + pageText : '') }];
  if (b64) parts.push({ inline_data: { mime_type: 'image/png', data: b64 } });

  let lastErr;
  for (const m of (models && models.length ? models : PREFERRED)) {
    try {
      const res = await fetch(`${API}/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }] })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { const e = new Error(j.error?.message || 'HTTP ' + res.status); e.status = res.status; throw e; }
      const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
      if (text) return text;
      lastErr = new Error('No answer returned.');
    } catch (e) {
      lastErr = e;
      if (e.status === 400 && /api key/i.test(e.message)) break;
    }
  }
  if (lastErr.status === 400 || lastErr.status === 403) lastErr.message = 'Your API key was rejected. Press "Change key".';
  else if (!lastErr.status && /fetch/i.test(lastErr.message)) lastErr.message = "Couldn't reach Google AI. Check your internet connection.";
  else if (lastErr.status === 429) lastErr.message = 'Free limit hit for now. Wait a minute and try again.';
  throw lastErr;
}
