// Records every change in what the renderer believes about each thread, every 100ms.
(() => {
  if (window.__rw) clearInterval(window.__rw.timer);
  const glyph = (t) => {
    const c = [...(t || '')][0] || '';
    if ('◐◓◑◒'.includes(c)) return 'BUSY';
    if (c === '✳') return 'IDLE';
    if ('▶✅⚠⏳⚙'.includes(c)) return 'HOOK:' + c;
    return 'plain';
  };
  const last = {};
  const rw = { t0: Date.now(), log: [] };
  rw.timer = setInterval(() => {
    for (let i = 1; i < 16; i++) {
      const id = 'tab-' + i;
      const t = window.__afterterm.tab(id);
      if (!t) continue;
      const key = [glyph(t.title), t.notification || '-', t.claudeSessionId ? 'id' : 'noid'].join(' | ');
      if (last[id] !== key) {
        last[id] = key;
        rw.log.push(`${((Date.now() - rw.t0) / 1000).toFixed(1).padStart(6)}s ${id}  title=${key}`);
      }
    }
  }, 100);
  window.__rw = rw;
  return 'sampler on';
})()
