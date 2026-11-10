// Mechanical visual checks that run inside any page. No knowledge of the app. Returns plain findings (not verdicts):
// a human or critic decides whether each one matters.
export async function mechanicalChecks(page, { touch = false } = {}) {
  return page.evaluate(({ touch }) => {
    const out = { overflowX: false, offscreen: [], clipped: [], ellipsised: [], smallTargets: [], overlaps: [], tinyText: [], noName: [] };
    const vw = innerWidth, vh = innerHeight, min = touch ? 44 : 24;
    const sel = el => { const p = []; for (let e = el; e && e.nodeType === 1 && p.length < 4; e = e.parentElement) p.unshift(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.classList.length ? '.' + [...e.classList].slice(0, 2).join('.') : '')); return p.join(' > '); };
    const visible = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.02; };
    out.overflowX = document.documentElement.scrollWidth > vw + 1;
    const all = [...document.querySelectorAll('body *')].filter(visible);
    for (const el of all) {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      const fixedOrAbs = cs.position === 'fixed' || cs.position === 'absolute';
      if (r.right > vw + 2 || r.left < -2) { let scroller = false; for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (/(auto|scroll|hidden|clip)/.test(o) && p.scrollWidth > p.clientWidth) { scroller = true; break; } } if (!scroller && out.offscreen.length < 25) out.offscreen.push({ el: sel(el), left: Math.round(r.left), right: Math.round(r.right), vw }); }
      if (el.childNodes.length && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && el.scrollWidth > el.clientWidth + 1) {
        const hidden = /(hidden|clip)/.test(cs.overflowX);
        if (hidden && cs.textOverflow === 'ellipsis' && out.ellipsised.length < 40) out.ellipsised.push({ el: sel(el), text: el.textContent.trim().slice(0, 60), width: Math.round(r.width), needs: el.scrollWidth });
        else if (hidden && out.clipped.length < 40) out.clipped.push({ el: sel(el), text: el.textContent.trim().slice(0, 60), width: Math.round(r.width), needs: el.scrollWidth });
      }
      const fs = parseFloat(cs.fontSize);
      if (fs < 11 && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && out.tinyText.length < 25) out.tinyText.push({ el: sel(el), fontSize: fs, text: el.textContent.trim().slice(0, 40) });
      void fixedOrAbs;
    }
    const interactive = all.filter(el => el.matches('a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[tabindex]:not([tabindex="-1"])'));
    for (const el of interactive) {
      const r = el.getBoundingClientRect();
      if ((r.width < min || r.height < min) && !(el.matches('input[type=checkbox],input[type=radio]') && el.closest('label')) && out.smallTargets.length < 40) out.smallTargets.push({ el: sel(el), w: Math.round(r.width), h: Math.round(r.height), name: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim().slice(0, 30) });
      const name = (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.textContent || el.getAttribute('title') || el.getAttribute('placeholder') || (el.labels && el.labels.length) || '').toString().trim();
      if (!name && out.noName.length < 30) out.noName.push({ el: sel(el) });
    }
    for (let i = 0; i < interactive.length && out.overlaps.length < 20; i++) for (let j = i + 1; j < interactive.length; j++) {
      const a = interactive[i], b = interactive[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > 4 && h > 4 && (w * h) / Math.min(ra.width * ra.height, rb.width * rb.height) > 0.5) { out.overlaps.push({ a: sel(a), b: sel(b) }); if (out.overlaps.length >= 20) break; }
    }
    out.viewport = { vw, vh };
    return out;
  }, { touch });
}

/** Optional: run axe-core's contrast and target-size rules when its minified source is available. */
export async function axeContrast(page, axeSourcePath) {
  const fs = await import('node:fs');
  if (!axeSourcePath || !fs.existsSync(axeSourcePath)) return null;
  await page.addScriptTag({ content: fs.readFileSync(axeSourcePath, 'utf8') }).catch(() => {});
  return page.evaluate(async () => {
    if (!window.axe) return null;
    const r = await window.axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast', 'target-size', 'label', 'button-name', 'link-name', 'aria-valid-attr-value'] } });
    return r.violations.map(v => ({ id: v.id, impact: v.impact, count: v.nodes.length, sample: v.nodes.slice(0, 5).map(n => ({ target: n.target.join(' '), summary: n.failureSummary?.slice(0, 160) })) }));
  });
}
