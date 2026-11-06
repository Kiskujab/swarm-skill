#!/usr/bin/env node
/*
 * verify.cjs — records and checks the swarm-rebuild effect on a page with Playwright.
 *
 *   node verify.cjs --url http://localhost:5500/ [--mode scroll|fast|tour] [--speed 6] [--out ./swarm-check]
 *                   [--device desktop|mobile] [--viewport 1440x900] [--fps 10]
 *                   [--checks all|record|extra|product|protect|fixed|visible|text|motion|manual (comma list)]
 *                   [--interact "<selector>"] [--consent "<selector>"] [--color-scheme dark|light] [--settle "<js>"]
 *                   [--min-fps 50] [--timeout 400] [--video ref.mp4 --crop 930:500:90:690]
 *
 * --mode / --speed   the recorded run. scroll and fast are what visitors get (no control bar, the page follows
 *                    their scrolling, simulated here by reading down with the mouse wheel). tour is the debug
 *                    auto-scroll (?rebuild-debug=1); "--mode tour --speed 6" is the old "fast" baseline.
 * --checks
 *   record   one recorded run: timeline, final state, fps, console errors, instant elements
 *   extra    reduced motion, ✕ and Replay of the debug bar, no-JS
 *   product  what visitors get: no control bar / no auto-scroll without the flag, the flag shows the bar,
 *            default mode is scroll, scroll keys only scroll (the build follows), Esc / Tab / Enter / any other key /
 *            click / tap show the finished page at once without
 *            layout shift, a click on unfinished content does not navigate, a click on finished content works
 *   protect  the page is never left half hidden: everything scrolled above the view is final; an exception
 *            in a task, a stuck task, an exception in the frame loop, a dead script (CSS dead-man switch),
 *            a resize and a background tab all end with the whole page visible
 *   fixed    the overlay never draws over position:fixed elements (and finished sticky ones): pixel test
 *            at many moments of a visitor run (overlay shown vs. hidden, the module paused)
 *   visible  scroll mode builds only what is in view: every part starts with at least the start share (60 %) of
 *            it in view, no working agent is ever outside the view, no task runs out of view, and after fast
 *            scrolls (wheel bursts, Page Down, End) the view is filled within ~1-2 s; contact sheet sheet-visible.jpg
 *   text     typing in any language: every frame of a visitor run, the typed part of every text ends on a character
 *            boundary (grapheme cluster: accents, emoji ZWJ sequences, flags, Arabic marks, CJK), and the caret sits
 *            after the last typed character in its writing direction (left of it in Arabic / Hebrew)
 *   a11y     search engines and accessibility: a search-engine crawler (Googlebot, Bingbot) gets the finished page at
 *            once (no hiding, DOM identical); during the build the overlay is aria-hidden with nothing focusable in it,
 *            screen readers get a short status message in the page's language, the first Tab ends the effect and
 *            focus lands where it would without the effect; the message is gone afterwards
 *   motion   the motion (debug add-on measurements): opening swarms around the focus element with changing speed,
 *            the finale's spring-like pull (overshoot) and slow circling, mouse play (dodge, follow shorter when the
 *            pointer leaves faster, never closer than 36 px, desktop only), gravity sag of horizontal moves (none for
 *            vertical ones), task difficulty (bigger = longer, at most ~4x); contact sheets of the opening and finale
 *   manual   the visitor takes over: a debug tour interrupted by wheel scrolling, then a scroll-mode run
 *   all      record,extra,product,protect,fixed,visible,text,a11y,motion
 *
 * --answer   a consent dialog that holds the page until it is answered: clicked in the recorded run and on the reference
 * --consent  the accept button of a cookie / consent banner (also one a script adds later): clicked during the build,
 *            it must work at the first click (the banner goes away) and the effect ends
 * --color-scheme  emulate the system's dark or light mode
 * --dom-volatile  attributes the page changes by itself over time (e.g. "class,style,aria-current" for a carousel or
 *            scroll-reveal classes): left out of the "DOM identical" comparisons. The reference page (effect off) is
 *            always scrolled once to the bottom and back first, so lazy images and scroll-reveal parts are loaded
 * --settle   JavaScript run in the page before the "looks identical" screenshots (e.g. stop a carousel); videos are
 *            always paused at their first frame for those screenshots
 *
 * Frame rate is measured in a separate run without screenshots. It depends on the machine: a cloud
 * container without a GPU reaches ~46-55 fps with the demo where a normal laptop reaches ~59, so lower
 * --min-fps there and compare with the same machine's earlier numbers instead.
 *
 * Needs the `playwright` package (resolved from the script dir, the cwd, NODE_PATH or a global install)
 * and a Chromium for it. ffmpeg is optional (contact sheets).
 *
 * Every run has a hard time limit (--timeout seconds, default 400): the script exits with code 3
 * and the browser is closed, so nothing keeps running in the background.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createRequire } = require('module');

function loadPlaywright() {
  const tries = [__filename, path.join(process.cwd(), 'index.js')];
  for (const t of tries) { try { return createRequire(t)('playwright'); } catch (e) { /* next */ } }
  try { return require('playwright'); } catch (e) { /* next */ }
  try {
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return createRequire(path.join(root, 'index.js'))('playwright');
  } catch (e) { /* fall through */ }
  console.error('Cannot find the "playwright" package. Install it: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const args = {};
process.argv.slice(2).forEach((a, i, arr) => { if (a.startsWith('--')) args[a.slice(2)] = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true; });
if (!args.url) { console.error('usage: node verify.cjs --url <page url> [--mode scroll|fast|tour] [--speed n] [--device desktop|mobile] [--checks all|record|extra|product|protect|fixed|manual] [--out dir]'); process.exit(2); }
const MODE = args.mode || 'scroll';
const SPEED = args.speed ? String(args.speed) : null;
const OUT = path.resolve(args.out || 'swarm-check');
const MOBILE = args.device === 'mobile';
const [VW, VH] = String(args.viewport || (MOBILE ? '390x844' : '1440x900')).split('x').map(Number);
const FPS = Number(args.fps || 10);
const CHECKS = new Set(String(args.checks || 'all').split(','));
if (CHECKS.has('all')) ['record', 'extra', 'product', 'interact', 'protect', 'fixed', 'visible', 'text', 'a11y', 'motion'].forEach((c) => CHECKS.add(c));
const TIMEOUT_S = Number(args.timeout || 400);
const MIN_FPS = Number(args['min-fps'] || 50);
fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });

let browser = null;
const watchdog = setTimeout(async () => {
  console.error('FAIL verify.cjs hit its time limit (' + TIMEOUT_S + ' s), stopping');
  try { if (browser) await browser.close(); } catch (e) { /* ignore */ }
  process.exit(3);
}, TIMEOUT_S * 1000);

function withParams(url, extra) {
  const u = new URL(url);
  Object.entries(extra).forEach(([k, v]) => { if (v != null) u.searchParams.set(k, v); });
  return u.toString();
}
// the effect forced on (?rebuild=1), in a mode, optionally with the debug add-on and test parameters
function effectUrl(mode, o = {}) {
  const debug = o.debug || mode === 'tour';
  return withParams(args.url, Object.assign({ rebuild: '1', 'rebuild-mode': mode, 'rebuild-debug': debug ? '1' : null }, o.params || {}));
}
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); }
function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++; // bounded: stops at the shorter string
  return i;
}
const VOLATILE = args['dom-volatile'] && args['dom-volatile'] !== true ? new RegExp('\\s(?:' + String(args['dom-volatile']).split(',').map((a) => a.trim().replace(/[^\w-]/g, '')).join('|') + ')="[^"]*"', 'g') : null;
const normDom = (d) => (VOLATILE && d ? d.replace(VOLATILE, '') : d);
function domSame(dom, baseDom) { return normDom(dom) === normDom(baseDom); }
function domCheck(name, dom, baseDom) {
  const same = domSame(dom, baseDom);
  const di = same ? 0 : firstDiff(normDom(baseDom), normDom(dom));
  dom = normDom(dom);
  check(name, same, same ? '' : 'first difference: …' + JSON.stringify(dom.slice(Math.max(0, di - 60), di + 40)));
}

async function pixelDiff(page, a, b) {
  return page.evaluate(async ([a, b]) => {
    const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.drawImage(ia, 0, 0); const da = x.getImageData(0, 0, w, h).data;
    x.clearRect(0, 0, w, h); x.drawImage(ib, 0, 0); const db = x.getImageData(0, 0, w, h).data;
    let diff = 0;
    for (let i = 0; i < da.length; i += 4) {
      if (Math.abs(da[i] - db[i]) > 24 || Math.abs(da[i + 1] - db[i + 1]) > 24 || Math.abs(da[i + 2] - db[i + 2]) > 24) diff++;
    }
    return { ratio: diff / (w * h), sizeA: [ia.width, ia.height], sizeB: [ib.width, ib.height] };
  }, [a, b]);
}
const b64 = (buf) => 'data:image/png;base64,' + buf.toString('base64');

const CLS_INIT = () => {
  window.__cls = 0;
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch (e) { /* ignore */ }
};

// collects page errors, console errors and hydration warnings
function watchConsole(page, bag) {
  page.on('pageerror', (e) => bag.push('pageerror: ' + (e.message || e)));
  page.on('console', (m) => {
    const t = m.text();
    if (/favicon\.ico/.test(t) || /favicon\.ico/.test((m.location() || {}).url || '')) return;
    if (m.type() === 'error' || /hydrat/i.test(t)) bag.push(m.type() + ': ' + t.slice(0, 200));
    // the module's own safety nets report with a warning: in a normal run they must never be needed
    else if (/\[swarm-rebuild\]/.test(t) && bag.fallbacks) bag.fallbacks.push(t.slice(0, 200));
  });
}
const STATE = () => window.SwarmRebuild ? window.SwarmRebuild.state() : { phase: 'not-loaded' };
const gone = () => ({ root: !!document.getElementById('swarm-rebuild-root'), hide: !!document.getElementById('swarm-rebuild-hide'), reveal: !!document.getElementById('swarm-rebuild-reveal'), dom: document.body.outerHTML, s: window.SwarmRebuild ? window.SwarmRebuild.state() : null, cls: window.__cls });
const isFinished = (g, baseDom) => !g.root && !g.hide && !g.reveal && domSame(g.dom, baseDom);
// per-element visibility, in document order (the page loaded with the effect off is the reference)
// in the page: a spot in view that is no control of the page (no link, button, field, dialog, fixed bar): a double click there ends the effect
const EMPTY_SPOT = () => {
  const ACT = 'a[href],area[href],button,input,select,textarea,label,summary,details,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="switch"],[onclick],[tabindex],[contenteditable],dialog,[role="dialog"],[role="alertdialog"],[aria-modal="true"],[role="menu"],[role="listbox"],[aria-expanded="true"]';
  const vw = document.documentElement.clientWidth, vh = innerHeight;
  const root = document.getElementById('swarm-rebuild-root');
  if (root) root.style.display = 'none';
  try {
    for (let y = Math.round(vh * 0.3); y < vh * 0.9; y += 37) for (let x = 24; x < vw - 24; x += 41) {
      const el = document.elementFromPoint(x, y);
      if (!el || el.closest(ACT)) continue;
      let fixed = false;
      for (let p = el; p && p !== document.body; p = p.parentElement) if (getComputedStyle(p).position === 'fixed') { fixed = true; break; }
      if (fixed) continue;
      // no text right there (a double click on text selects a word: normal use)
      const r = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
      if (r && r.startContainer.nodeType === 3 && /\S/.test(r.startContainer.data)) { const rr = r.getBoundingClientRect(); if (Math.abs(rr.top - y) < 30 && Math.abs(rr.left - x) < 30) continue; }
      return { x, y, what: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '') };
    }
  } finally { if (root) root.style.display = ''; }
  return null;
};
const VIS_MAP = () => Array.from(document.body.querySelectorAll('*')).map((e) => getComputedStyle(e).visibility.charAt(0)).join('');

// in the page: which visible obstacles does the control bar overlap right now?
function hudOverlapProbe() {
  const root = document.getElementById('swarm-rebuild-root');
  const hud = root && root.querySelector('.sr-hud');
  if (!hud) return null;
  const h = hud.getBoundingClientRect();
  const cw = document.documentElement.clientWidth, vh = innerHeight;
  const mobile = hud.hasAttribute('data-mobile');
  const alphaOf = (c) => { if (!c || c === 'transparent') return 0; const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return 1; const p = m[1].split(/[\s,/]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; };
  const cand = new Set();
  for (const el of document.body.querySelectorAll('*')) { if (getComputedStyle(el).position === 'fixed') cand.add(el); }
  if (mobile) {
    document.body.querySelectorAll('a[href^="tel:"],a[href^="mailto:"],button,[role="button"],input,select,textarea,[data-swarm-avoid],[data-swarm-instant]').forEach((e) => cand.add(e));
    document.body.querySelectorAll('a[href]').forEach((a) => {
      const cs = getComputedStyle(a);
      if (alphaOf(cs.backgroundColor) > 0.1 || (parseFloat(cs.borderTopWidth) > 0 && parseFloat(cs.paddingLeft) >= 6)) cand.add(a);
    });
  }
  const hits = [];
  cand.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= cw) return;
    if (r.width * r.height > cw * vh * 0.5) return; // full-screen fixed backgrounds are not obstacles
    if (getComputedStyle(el).display === 'none') return;
    if (h.left < r.right && h.right > r.left && h.top < r.bottom && h.bottom > r.top) {
      hits.push(el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : '') + ' "' + (el.textContent || '').trim().slice(0, 24) + '"');
    }
  });
  const inside = h.left >= -1 && h.top >= -1 && h.right <= cw + 1 && h.bottom <= vh + 1;
  return { hits, inside, rect: [Math.round(h.left), Math.round(h.top), Math.round(h.width), Math.round(h.height)], collapsed: hud.classList.contains('sr-collapsed') };
}

// in the page: fixed elements (and stuck, finished sticky ones) currently on screen, as clip rects
function fixedTargets() {
  const out = [], cw = document.documentElement.clientWidth, vh = innerHeight;
  for (const el of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    if (cs.display === 'none' || cs.visibility !== 'visible') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= cw) continue;
    if (r.width * r.height > cw * vh * 0.5) continue;
    if (cs.position === 'sticky') {
      // only when stuck to the viewport and completely built
      const top = parseFloat(cs.top);
      if (isNaN(top) || Math.abs(r.top - top) > 1) continue;
      // (wrappers that paint nothing stay hidden until the end; only what paints counts)
      const paints = (d) => {
        const c = getComputedStyle(d);
        if (c.display === 'none') return false;
        if (/^(img|svg|video|canvas|picture|iframe|input|select|textarea)$/i.test(d.tagName)) return true;
        for (const n of d.childNodes) if (n.nodeType === 3 && /\S/.test(n.data)) return true;
        return !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(c.backgroundColor) || parseFloat(c.borderTopWidth) > 0 || parseFloat(c.borderBottomWidth) > 0;
      };
      if (Array.from(el.querySelectorAll('*')).some((d) => paints(d) && getComputedStyle(d).visibility !== 'visible')) continue;
    }
    const x = Math.max(0, Math.floor(r.left)), y = Math.max(0, Math.floor(r.top));
    out.push({ name: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : '') + (cs.position === 'sticky' ? ' (sticky)' : ''), clip: { x, y, width: Math.min(cw, Math.ceil(r.right)) - x, height: Math.min(vh, Math.ceil(r.bottom)) - y } });
  }
  return out;
}

(async () => {
  const { chromium } = loadPlaywright();
  browser = await chromium.launch();
  const newCtx = (o = {}) => browser.newContext(Object.assign(
    { viewport: { width: VW, height: VH }, deviceScaleFactor: 1 }, args['color-scheme'] ? { colorScheme: String(args['color-scheme']) } : {},
    MOBILE ? { isMobile: true, hasTouch: true } : {}, o));
  const report = { url: args.url, mode: MODE, speed: SPEED, device: MOBILE ? 'mobile' : 'desktop', viewport: [VW, VH], checks: [...CHECKS] };
  // opens a page with the effect; waits until the build runs (or the given phase)
  async function openEffect(mode, o = {}) {
    const ctx = await newCtx(o.ctx || {});
    await ctx.addInitScript(CLS_INIT);
    // --module <file>: the page gets this module file instead of its own (to measure an older version the same way)
    if (args.module && args.module !== true) { const body = fs.readFileSync(path.resolve(String(args.module))); await ctx.route(/swarm-rebuild(\.min)?\.js(\?|$)/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body })); }
    const page = await ctx.newPage();
    const bag = [];
    bag.fallbacks = [];
    watchConsole(page, bag);
    await page.goto(effectUrl(mode, o), { waitUntil: o.waitUntil || 'domcontentloaded' });
    if (o.waitBuild !== false) {
      // (a consent wall at load holds the opening: waiting for it counts as started)
      await page.waitForFunction(() => { const s = window.SwarmRebuild && window.SwarmRebuild.state(); return s && (s.phase === 'build' || s.modal); }, null, { timeout: 20000 }).catch(() => {});
      if (o.after) await page.waitForTimeout(o.after * 1000);
    }
    return { ctx, page, bag, st: () => page.evaluate(STATE).catch(() => ({ phase: 'err' })) };
  }
  // reads down the page like a visitor until the effect is over (or the time is up)
  async function readDown(page, step = 0.5, pause = 450, maxMs = 60000, each) {
    const tEnd = Date.now() + maxMs;
    let s = await page.evaluate(STATE), steps = 0;
    while ((s.phase === 'build' || s.phase === 'scan') && Date.now() < tEnd) {
      const atBottom = await page.evaluate(() => scrollY >= document.documentElement.scrollHeight - innerHeight - 2);
      if (!atBottom && steps < 120) { await page.mouse.wheel(0, Math.round(VH * step)); steps++; }
      await page.waitForTimeout(pause);
      if (each) await each(steps);
      s = await page.evaluate(STATE).catch(() => ({ phase: 'err' }));
    }
    return { s, steps };
  }
  async function untilIdle(page, ms) {
    await page.waitForFunction(() => window.SwarmRebuild && window.SwarmRebuild.state().phase === 'idle', null, { timeout: ms }).catch(() => {});
  }

  // the page's own moving parts are stopped for the "looks identical" screenshots: videos at their first frame,
  // plus whatever --settle does (e.g. a carousel back to its first slide)
  async function stillPage(page) {
    await page.evaluate(async (settle) => {
      const vids = Array.from(document.querySelectorAll('video'));
      await Promise.all(vids.map((v) => new Promise((res) => { try { v.pause(); if (v.currentTime === 0) return res(); v.addEventListener('seeked', res, { once: true }); v.currentTime = 0; setTimeout(res, 1500); } catch (e) { res(); } })));
      if (settle) { try { (0, eval)(settle); } catch (e) { /* ignore */ } }
    }, args.settle && args.settle !== true ? String(args.settle) : null).catch(() => {});
    if (args.settle) await page.waitForTimeout(900);
  }
  // ---------- baseline (effect disabled)
  const base = await newCtx();
  const bp = await base.newPage();
  await bp.goto(withParams(args.url, { rebuild: '0' }), { waitUntil: 'load' });
  await bp.waitForTimeout(400);
  // --answer: a consent dialog that holds the page is answered, as the visitor does in the recorded run
  if (args.answer && args.answer !== true) { await bp.waitForSelector(String(args.answer), { state: 'visible', timeout: 9000 }).catch(() => {}); await bp.click(String(args.answer)).catch(() => {}); }
  // read the page once like a visitor (lazy images, scroll-reveal parts), then back to the top
  await bp.evaluate(async () => { const st = Math.max(200, innerHeight * 0.8); for (let y = 0; y < document.documentElement.scrollHeight; y += st) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 70)); } scrollTo(0, 0); });
  await bp.waitForTimeout(700);
  // what the page adds later by itself (a chat widget, a consent manager) is part of the reference: wait until the DOM
  // has not changed for 1.5 s (at most 8 s)
  await bp.evaluate(async () => { let last = document.body.outerHTML, quiet = 0; for (let t = 0; t < 8000 && quiet < 1500; t += 250) { await new Promise((r) => setTimeout(r, 250)); const d = document.body.outerHTML; if (d === last) quiet += 250; else { quiet = 0; last = d; } } });
  const baseDom = await bp.evaluate(() => document.body.outerHTML);
  const baseVis = await bp.evaluate(VIS_MAP);
  await stillPage(bp);
  const baseShot = await bp.screenshot({ fullPage: true, caret: 'initial' });
  fs.writeFileSync(path.join(OUT, 'baseline.png'), baseShot);
  const docInfo = await bp.evaluate(() => ({ h: document.documentElement.scrollHeight, vh: innerHeight }));
  report.pageViewportHeights = +(docInfo.h / docInfo.vh).toFixed(2);
  await base.close();

  let timeline = [];
  if (CHECKS.has('record')) {
    // ---------- recorded run
    const DEBUG = MODE === 'tour';
    const ctx = await newCtx();
    await ctx.addInitScript(CLS_INIT);
    const page = await ctx.newPage();
    const consoleBag = [];
    consoleBag.fallbacks = [];
    watchConsole(page, consoleBag);
    const t0 = Date.now();
    await page.goto(effectUrl(MODE, { params: { 'rebuild-speed': SPEED } }), { waitUntil: 'domcontentloaded' });
    let doneAt = null, i = 0, instantChecked = false, answered = false;
    const maxMs = (MODE === 'tour' && !SPEED ? 120 : 75) * 1000;
    while (Date.now() - t0 < maxMs) {
      const tick = Date.now();
      const s = await page.evaluate(STATE).catch(() => ({ phase: 'err' }));
      s.wall = (tick - t0) / 1000;
      const f = path.join(OUT, 'frames', 'f' + String(++i).padStart(4, '0') + '.jpg');
      await page.screenshot({ path: f, type: 'jpeg', quality: 70, caret: 'initial' }).catch(() => {});
      s.frame = path.basename(f);
      timeline.push(s);
      if (args.answer && args.answer !== true && s.modal && !answered) { answered = true; await page.click(String(args.answer)).catch(() => {}); }
      if (s.phase === 'build' && !instantChecked && s.buildT > 0.3) {
        instantChecked = true;
        const inst = await page.evaluate(() => {
          const out = { checked: 0, hidden: [] };
          const els = new Set(document.body.querySelectorAll('a[href^="tel:"],[data-swarm-instant]'));
          for (const el of document.body.querySelectorAll('*')) if (getComputedStyle(el).position === 'fixed') els.add(el);
          els.forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1 || getComputedStyle(el).display === 'none') return;
            out.checked++;
            if (getComputedStyle(el).visibility !== 'visible') out.hidden.push(el.tagName.toLowerCase() + ' "' + (el.textContent || '').trim().slice(0, 30) + '"');
          });
          return out;
        });
        check('phone links and fixed elements visible during the build', inst.hidden.length === 0, inst.checked + ' checked' + (inst.hidden.length ? ', hidden: ' + inst.hidden.join(', ') : ''));
      }
      // scroll / fast follow the visitor: simulate someone reading down the page
      if (MODE !== 'tour' && s.phase === 'build' && i % Math.max(1, Math.round(FPS / 2)) === 0) await page.mouse.wheel(0, Math.round(VH * 0.35));
      if (s.phase === 'done' && doneAt == null) doneAt = Date.now();
      if (doneAt && Date.now() - doneAt > 3500) break;
      if (s.phase === 'idle' && timeline.length > 5) break;
      const wait = 1000 / FPS - (Date.now() - tick);
      if (wait > 0) await page.waitForTimeout(wait);
    }
    fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify(timeline, null, 1));
    const doneState = timeline.find((s) => s.phase === 'done');
    check('effect ran to the end', !!doneState, doneState ? (doneState.hud || 'done after ' + (doneState.elapsed || 0).toFixed(1) + ' s') : 'last phase: ' + (timeline[timeline.length - 1] || {}).phase);
    if (doneState) {
      report.elapsed = doneState.elapsed;
      report.layers = doneState.layersTotal;
      report.agentsEnd = doneState.agents;
      if (DEBUG) check('debug bar final text', /Rebuilt by \d+ agents in [\d.]+s/.test(doneState.hud) && /Go live/.test(doneState.hud) && /Replay/.test(doneState.hud), doneState.hud);
    }
    const firstBuild = timeline.find((s) => s.phase === 'build');
    if (DEBUG) {
      const scanStates = timeline.filter((s) => s.phase === 'scan');
      check('debug bar: scan phase with "Scanning page…"', scanStates.some((s) => /Scanning page/.test(s.hud)), scanStates.length + ' samples');
      if (firstBuild) check('debug bar shows agents + layers', /\d+ agents/.test(firstBuild.hud) && /\d+ \/ \d+ layers/.test(firstBuild.hud), firstBuild.hud);
    } else {
      check('no control bar for visitors', timeline.every((s) => !s.debug && !s.hud), (firstBuild && firstBuild.mode) || '');
    }
    let mono = true, prev = -1;
    timeline.forEach((s) => { if (s.layersDone != null) { if (s.layersDone < prev) mono = false; prev = s.layersDone; } });
    check('layer counter never decreases', mono);
    if (MODE === 'tour') {
      const b = timeline.filter((s) => s.phase === 'build' || s.phase === 'done');
      const T = doneState ? doneState.elapsed : 1;
      const pts = [0.08, 0.2, 0.4, 0.6, 0.8, 0.98].map((f) => {
        const s = b.find((x) => x.buildT >= f * T) || b[b.length - 1];
        return { at: f, progress: s ? +s.scrollProgress.toFixed(2) : null };
      });
      report.scrollCurve = pts;
      const last = timeline.filter((s) => s.scrollProgress != null).pop();
      const scrollable = report.pageViewportHeights > 1.02;
      check('auto-scroll ends at the bottom', !scrollable || (last && last.scrollProgress > 0.98), scrollable ? 'progress ' + (last && last.scrollProgress.toFixed(3)) : 'page fits in one viewport');
      const increasing = pts.every((p, k) => k === 0 || p.progress >= pts[k - 1].progress - 0.01);
      check('auto-scroll progress is monotonic', increasing, JSON.stringify(pts));
    }
    report.fpsWhileRecording = await page.evaluate(() => window.SwarmRebuild.stats());

    // ---------- final state after the effect
    const live = await page.$('#swarm-rebuild-root .sr-live');
    if (live && await live.isVisible()) await live.click(); else await page.evaluate(() => window.SwarmRebuild.goLive());
    await page.waitForTimeout(300);
    const after = await page.evaluate(gone);
    domCheck('DOM identical to original after the effect', after.dom, baseDom);
    check('overlay and styles removed', !after.root && !after.hide && !after.reveal);
    report.cls = after.cls;
    check('no layout shift (CLS < 0.01)', after.cls < 0.01, 'CLS ' + after.cls.toFixed(4));
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(200);
    await stillPage(page);
    const afterShot = await page.screenshot({ fullPage: true, caret: 'initial' });
    fs.writeFileSync(path.join(OUT, 'after.png'), afterShot);
    const d1 = await pixelDiff(page, b64(baseShot), b64(afterShot));
    report.pixelDiff = d1.ratio;
    check('looks identical to original (< 0.5 % pixels differ)', d1.ratio < 0.005 && d1.sizeA[1] === d1.sizeB[1], (d1.ratio * 100).toFixed(3) + ' %');
    if (args.interact) {
      const sel = String(args.interact);
      const before = await page.textContent(sel, { timeout: 3000 }).catch(() => null);
      await page.click(sel, { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(200);
      const now = await page.textContent(sel, { timeout: 3000 }).catch(() => null);
      check('page is interactive after the effect (' + sel + ')', before != null && now != null && before !== now, JSON.stringify(before) + ' -> ' + JSON.stringify(now));
    }
    check('no page errors, console errors or hydration warnings', consoleBag.length === 0, consoleBag.slice(0, 3).join(' | '));
    const lastS = timeline.filter((s) => s.aborts != null).pop() || {};
    check('no safety fallback was needed (no task errors, no watchdog)', consoleBag.fallbacks.length === 0 && !lastS.aborts && !lastS.errors, consoleBag.fallbacks.slice(0, 2).join(' | '));
    await ctx.close();

    // ---------- frame rate: a separate run without screenshots (taking frames costs fps by itself)
    const fc = await newCtx();
    const fp = await fc.newPage();
    await fp.goto(effectUrl(MODE, { params: { 'rebuild-speed': SPEED } }), { waitUntil: 'domcontentloaded' });
    const fEnd = Date.now() + maxMs;
    let fs2 = { phase: 'scan' }, wheel = 0;
    while (Date.now() < fEnd) {
      fs2 = await fp.evaluate(STATE).catch(() => ({ phase: 'err' }));
      if (fs2.phase === 'done' || (fs2.phase === 'idle' && wheel > 5)) break;
      if (MODE !== 'tour' && fs2.phase === 'build') { await fp.mouse.wheel(0, Math.round(VH * 0.35)); wheel++; }
      await fp.waitForTimeout(500);
    }
    report.fps = await fp.evaluate(() => window.SwarmRebuild.stats()).catch(() => null);
    report.fpsRunElapsed = fs2.elapsed || null;
    check('frame rate >= ' + MIN_FPS + ' fps (module-measured during build, no screenshots)', report.fps && report.fps.avgFps >= MIN_FPS, JSON.stringify(report.fps));
    await fc.close();
  }

  if (CHECKS.has('extra')) {
    // ---------- reduced motion
    const rc = await newCtx({ reducedMotion: 'reduce' });
    const rp = await rc.newPage();
    await rp.goto(args.url, { waitUntil: 'load' });
    await rp.waitForTimeout(500);
    const r = await rp.evaluate(() => ({ root: !!document.getElementById('swarm-rebuild-root'), hide: !!document.getElementById('swarm-rebuild-hide'), vis: getComputedStyle(document.querySelector('h1,h2,p') || document.body).visibility }));
    check('prefers-reduced-motion: no effect at all', !r.root && !r.hide && r.vis === 'visible');
    await rc.close();

    // ---------- ✕ of the debug bar
    {
      const { ctx, page } = await openEffect('tour', { after: 1.5 });
      // the bar may start collapsed (narrow gutter / mobile): open it first
      const tab = await page.$('#swarm-rebuild-root .sr-hud.sr-collapsed .sr-tab');
      if (tab) { await tab.click(); await page.waitForTimeout(150); }
      const st0 = await page.evaluate(STATE);
      await page.click('#swarm-rebuild-root .sr-close', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(150);
      const g = await page.evaluate(gone);
      check('debug bar ✕ shows the finished page immediately', st0.phase === 'build' && isFinished(g, baseDom), 'was ' + st0.phase + ', exit: ' + (g.s && g.s.lastExit));
      await ctx.close();
    }
    // ---------- Replay of the debug bar
    {
      const { ctx, page } = await openEffect('tour', { params: { 'rebuild-speed': '6' }, waitBuild: false });
      await page.waitForFunction(() => window.SwarmRebuild && window.SwarmRebuild.state().phase === 'done', null, { timeout: 60000 }).catch(() => {});
      const tab2 = await page.$('#swarm-rebuild-root .sr-hud.sr-collapsed .sr-tab');
      if (tab2) { await tab2.click(); await page.waitForTimeout(150); }
      await page.click('#swarm-rebuild-root .sr-replay', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(80);
      const rs = await page.evaluate(() => ({ s: window.SwarmRebuild.state(), y: scrollY }));
      check('debug bar Replay restarts from the top with a new scan', rs.s.phase === 'scan' && rs.y === 0 && /Scanning page/.test(rs.s.hud), rs.s.phase + ' y=' + rs.y);
      await ctx.close();
    }
    // ---------- no JavaScript
    const nc = await newCtx({ javaScriptEnabled: false });
    const np = await nc.newPage();
    await np.goto(args.url, { waitUntil: 'load' });
    await np.waitForTimeout(400);
    await np.evaluate(() => document.querySelectorAll('video').forEach((v) => { try { v.pause(); v.currentTime = 0; } catch (e) { /* ignore */ } })).catch(() => {});
    await np.waitForTimeout(300);
    const noJsShot = await np.screenshot({ fullPage: true, caret: 'initial' });
    fs.writeFileSync(path.join(OUT, 'nojs.png'), noJsShot);
    const nj = await np.evaluate(() => ({ dom: document.body.outerHTML, traces: !!document.getElementById('swarm-rebuild-hide') || !!document.getElementById('swarm-rebuild-root') })).catch(() => ({ dom: '', traces: false }));
    await nc.close();
    const cc = await newCtx();
    const cmp = await cc.newPage();
    const d2 = await pixelDiff(cmp, b64(baseShot), b64(noJsShot));
    if (domSame(nj.dom, baseDom) || d2.ratio < 0.02) check('page visible without JavaScript', d2.ratio < 0.02 && !nj.traces, (d2.ratio * 100).toFixed(2) + ' % differs from the JS baseline');
    else check('page visible without JavaScript (the page renders its content with JavaScript itself: nothing of the effect may hide it)', !nj.traces, 'without JavaScript the page has other content (' + (d2.ratio * 100).toFixed(0) + ' % differs, e.g. a single-page app); hiding style / overlay present: ' + nj.traces);
    await cc.close();
  }

  if (CHECKS.has('product')) {
    report.product = {};
    // ---------- visitors never get a control bar or an automatic scroll
    for (const m of ['scroll', 'fast', 'tour']) {
      const ctx = await newCtx();
      const page = await ctx.newPage();
      await page.goto(withParams(args.url, { rebuild: '1', 'rebuild-mode': m }), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      const x = await page.evaluate(() => ({ s: window.SwarmRebuild.state(), hud: !!document.querySelector('#swarm-rebuild-root .sr-hud'), dbg: typeof window.SwarmRebuildDebug, y: scrollY }));
      check('product (' + m + ' without the flag): no control bar, no auto-scroll, debug add-on not loaded', !x.hud && x.y === 0 && x.dbg === 'undefined' && !x.s.touring && x.s.phase === 'build',
        'phase ' + x.s.phase + ', mode ' + x.s.mode + ', bar ' + x.hud + ', scrollY ' + x.y + ', add-on ' + x.dbg);
      await ctx.close();
    }
    {
      const { ctx, page } = await openEffect('scroll', { debug: true, after: 0.5 });
      const x = await page.evaluate(() => ({ hud: !!document.querySelector('#swarm-rebuild-root .sr-hud'), dbg: typeof window.SwarmRebuildDebug, def: window.SwarmRebuild.defaults.mode }));
      check('product: ?rebuild-debug=1 loads the add-on and shows the control bar', x.hud && x.dbg === 'function', 'bar ' + x.hud + ', add-on ' + x.dbg);
      check('product: default mode is scroll', x.def === 'scroll', x.def);
      await ctx.close();
    }
    // ---------- scroll keys (Space, arrows, Page Down / Up, End / Home) only scroll: the build follows, like with the wheel
    {
      const { ctx, page } = await openEffect('scroll', { after: 1.2 });
      const s0 = await page.evaluate(STATE);
      const y0 = await page.evaluate(() => scrollY);
      const seq = ['PageDown', 'ArrowDown', 'ArrowDown', 'Space', 'Shift+Space', 'PageDown', 'End', 'Home', 'PageDown'];
      const trail = [];
      let alive = true;
      for (const k of seq) {
        await page.keyboard.press(k);
        await page.waitForTimeout(450);
        const x = await page.evaluate(() => ({ s: window.SwarmRebuild.state(), y: Math.round(scrollY) }));
        trail.push(k + '→' + x.y);
        // (a short page may be finished by scrolling to its end: then it ends by itself, never because of the key)
        if (x.s.phase === 'idle' ? x.s.lastExit !== 'auto' : x.s.phase !== 'build' && x.s.phase !== 'done') alive = false;
      }
      await page.waitForTimeout(1500);
      const s1 = await page.evaluate(STATE);
      const moved = trail.some((t) => +t.split('→')[1] > y0 + 100);
      check('product: scroll keys (Space, arrows, Page Up/Down, Home/End) scroll and drive the build, they do not end it',
        s0.phase === 'build' && alive && moved && (s1.phase === 'idle' ? s1.lastExit === 'auto' : s1.layersDone > s0.layersDone),
        trail.join(', ') + '; layers ' + s0.layersDone + ' -> ' + (s1.phase === 'idle' ? 'all (finished, exit ' + s1.lastExit + ')' : s1.layersDone + ', ' + s1.phase));
      await ctx.close();
    }
    // ---------- only Esc (and a double click / tap on an empty spot, see interact) ends the effect; the page's own keys do not
    {
      const { ctx, page } = await openEffect('scroll', { after: 1.2 });
      const s0 = await page.evaluate(STATE);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(120);
      const g = await page.evaluate(gone);
      check('product: Esc shows the finished page at once, without layout shift', s0.phase === 'build' && isFinished(g, baseDom) && g.cls < 0.01, 'exit ' + (g.s && g.s.lastExit) + ', CLS ' + (g.cls || 0).toFixed(4));
      await ctx.close();
    }
    {
      const { ctx, page } = await openEffect('scroll', { after: 1.2 });
      const s0 = await page.evaluate(STATE);
      const keys = ['Shift', 'a', 'Tab', 'Enter', 'Control+ArrowDown', 'Shift+Tab', 'Tab'];
      for (const k of keys) { await page.keyboard.press(k); await page.waitForTimeout(150); }
      await page.waitForTimeout(1200);
      let s1 = await page.evaluate(STATE);
      // (in scroll mode the view may be complete already: read on a little, the build must follow)
      for (let k = 0; k < 4 && s1.phase === 'build' && s1.layersDone <= s0.layersDone; k++) { await page.mouse.wheel(0, Math.round(VH * 0.6)); await page.waitForTimeout(800); s1 = await page.evaluate(STATE); }
      check('product: the page\'s own keys (letters, Tab, Enter, Ctrl + arrow, a lone Shift) do not end the effect, the build goes on',
        // (Enter on a focused link of a single-page app opens another route: the new page is shown, exit "route")
        s0.phase === 'build' && (s1.phase === 'build' ? s1.layersDone > s0.layersDone : s1.phase === 'done' || s1.lastExit === 'auto' || s1.lastExit === 'route'),
        keys.join(', ') + '; ' + s0.phase + ' ' + s0.layersDone + ' -> ' + s1.phase + ' ' + (s1.layersDone != null ? s1.layersDone : '') + (s1.lastExit ? ' (exit ' + s1.lastExit + ')' : ''));
      await ctx.close();
    }
    {
      // click (or tap) on content that is still hidden: no navigation, no action, and the effect goes on
      const { ctx, page } = await openEffect('scroll', { after: 0.6 });
      const urlBefore = page.url();
      const pt = await page.evaluate(() => {
        const vh = innerHeight, vw = document.documentElement.clientWidth;
        const cand = Array.from(document.body.querySelectorAll('a[href],button'));
        for (const el of cand) {
          const r = el.getBoundingClientRect();
          if (r.width < 4 || r.height < 4 || r.top < 0 || r.bottom > vh || r.left < 0 || r.right > vw) continue;
          if (getComputedStyle(el).visibility === 'visible') continue;
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, what: el.tagName.toLowerCase() + ' "' + (el.textContent || '').trim().slice(0, 30) + '"' };
        }
        return null;
      });
      let popup = false;
      page.on('popup', () => { popup = true; });
      const s0 = await page.evaluate(STATE);
      if (pt) { if (MOBILE) await page.touchscreen.tap(pt.x, pt.y); else await page.mouse.click(pt.x, pt.y); }
      else { if (MOBILE) await page.touchscreen.tap(VW / 2, VH / 2); else await page.mouse.click(VW / 2, VH / 2); }
      await page.waitForTimeout(900);
      const s1 = await page.evaluate(STATE).catch(() => ({ phase: 'err' }));
      const sameUrl = page.url() === urlBefore;
      check('product: ' + (MOBILE ? 'a tap' : 'a click') + ' on unfinished content does nothing (no navigation) and the effect goes on', sameUrl && !popup && (s1.phase === 'build' || s1.phase === 'done') && (s1.layersDone || 0) >= (s0.layersDone || 0),
        (pt ? 'hit the spot of hidden ' + pt.what : 'no hidden link in view, clicked the middle') + ', url ' + (sameUrl ? 'unchanged' : 'changed to ' + page.url()) + ', effect ' + s1.phase + (s1.lastExit ? ' (' + s1.lastExit + ')' : ''));
      await ctx.close();
    }
    if (args.consent) {
      // a cookie / consent banner: its button works at the first click during the build, and the build goes on
      const sel = String(args.consent);
      const { ctx, page } = await openEffect('scroll', { after: 0.3 });
      const seen = await page.waitForFunction((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && getComputedStyle(e).visibility === 'visible'; }, sel, { timeout: 8000 }).then(() => true).catch(() => false);
      const s0 = await page.evaluate(STATE);
      const box = seen ? await (await page.$(sel)).boundingBox() : null;
      const urlBefore = page.url();
      if (box) { if (MOBILE) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); }
      await page.waitForTimeout(400);
      const r = await page.evaluate((s) => { const e = document.querySelector(s); const vis = !!e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none' && !!e.offsetParent; return { vis, st: window.SwarmRebuild.state(), cls: window.__cls }; }, sel);
      check('product: the consent banner works at the first ' + (MOBILE ? 'tap' : 'click') + ' during the build (' + sel + ') and the effect goes on',
        seen && s0.phase === 'build' && !r.vis && (r.st.phase === 'build' || r.st.phase === 'done') && page.url() === urlBefore && (r.cls || 0) < 0.01,
        (seen ? 'button visible during the build' : 'button never visible') + ', was ' + s0.phase + ', banner ' + (r.vis ? 'still there' : 'gone') + ', effect ' + r.st.phase + (r.st.lastExit ? ' (' + r.st.lastExit + ')' : ''));
      await ctx.close();
    }
    if (args.interact) {
      // click on content that is already finished: the click goes through, the effect goes on
      const sel = String(args.interact);
      const { ctx, page } = await openEffect('scroll', { after: 0.2 });
      const ok = await page.waitForFunction((s) => { const e = document.querySelector(s); return e && getComputedStyle(e).visibility === 'visible'; }, sel, { timeout: 20000 }).then(() => true).catch(() => false);
      await page.waitForTimeout(250);
      const s0 = await page.evaluate(STATE);
      const before = await page.textContent(sel).catch(() => null);
      const box = await (await page.$(sel)).boundingBox();
      if (MOBILE) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(300);
      const now = await page.textContent(sel).catch(() => null);
      const s1 = await page.evaluate(STATE);
      check('product: a click on finished content works and the effect goes on (' + sel + ')', ok && s0.phase === 'build' && before !== now && (s1.phase === 'build' || s1.phase === 'done'), JSON.stringify(before) + ' -> ' + JSON.stringify(now) + ', effect ' + s0.phase + ' -> ' + s1.phase);
      await ctx.close();
    }
  }

  if (CHECKS.has('interact')) {
    // ---------- the visitor uses the page while it builds: the effect goes on; only Esc / a double click or tap on an
    // empty spot end it. Click on desktop, tap on mobile, and the keyboard.
    report.interact = {};
    // one part that cannot run (an element missing, a timeout) fails as a check instead of stopping the whole run
    const guard = async (name, fn) => { try { await fn(); } catch (e) { check('interact: ' + name + ' could not run', false, String(e && e.message || e).split('\n')[0].slice(0, 200)); } };
    const tapAt = async (page, x, y) => { if (MOBILE) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); };
    const visibleSel = (s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility === 'visible' && cs.display !== 'none' && r.bottom > 0 && r.top < innerHeight; };
    const store = () => { let l = ''; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); l += k + '=' + localStorage.getItem(k) + ';'; } } catch (e) { /* ignore */ } return l + '|' + document.cookie; };
    const running = (s) => s.phase === 'scan' || s.phase === 'build' || s.phase === 'done' || (s.phase === 'idle' && s.lastExit === 'auto');
    // after an action: the effect is still on and makes progress (or finished by itself)
    async function goesOn(page, s0, ms = 1600) {
      let s = s0, worked = false;
      const tEnd = Date.now() + ms;
      while (Date.now() < tEnd) {
        await page.waitForTimeout(200);
        s = await page.evaluate(STATE).catch(() => ({ phase: 'err' }));
        if (!running(s)) return { ok: false, s, why: 'effect ' + s.phase + (s.lastExit ? ' (exit ' + s.lastExit + ')' : '') };
        if (s.phase !== 'build' || s.layersDone > s0.layersDone || s.activeTasks > 0) worked = true;
        if (s.phase === 'build' && s.layersDone > s0.layersDone) break;
      }
      // (everything in view may be finished already: read on a little)
      for (let k = 0; k < 6 && !worked && running(s); k++) { await page.mouse.wheel(0, Math.round(VH * 0.6)); await page.waitForTimeout(700); s = await page.evaluate(STATE); worked = running(s) && (s.phase !== 'build' || s.layersDone > s0.layersDone); }
      return { ok: worked && running(s), s, why: s.phase + ' ' + (s.layersDone != null ? s.layersDone + '/' + s.layersTotal : '') + (s.activeTasks ? ', ' + s.activeTasks + ' tasks' : '') };
    }
    // read on to the end; the finished page must be complete (nothing left hidden) and nothing may have jumped
    async function toEnd(page, bag, refDom) {
      const r = await readDown(page, 0.5, 400, 70000);
      await untilIdle(page, 12000);
      const g = await page.evaluate(gone);
      const hiddenLeft = await page.evaluate(() => Array.from(document.body.querySelectorAll('*')).filter((e) => { const c = getComputedStyle(e); return c.visibility === 'hidden' && c.display !== 'none' && e.getBoundingClientRect().width > 0; }).length);
      return { g, hiddenLeft, steps: r.steps, ok: !g.root && !g.hide && !g.reveal && (refDom == null || domSame(g.dom, refDom)) && (g.cls || 0) < 0.01 && !bag.length, natural: g.s && g.s.lastExit === 'auto' };
    }
    // the reference page after the same action without the effect (to compare the final DOM)
    async function refAfter(fn) {
      const c = await newCtx(); const p = await c.newPage();
      await p.goto(withParams(args.url, { rebuild: '0' }), { waitUntil: 'load' });
      await p.waitForTimeout(300);
      try { await fn(p); } catch (e) { /* ignore */ }
      await p.waitForTimeout(500);
      await p.evaluate(async () => { const st = Math.max(200, innerHeight * 0.8); for (let y = 0; y < document.documentElement.scrollHeight; y += st) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } });
      await p.waitForTimeout(3000); // (what the page adds later by itself, e.g. a chat widget, is there too)
      const d = await p.evaluate(() => document.body.outerHTML);
      await c.close();
      return d;
    }
    const lateWait = args.late ? 9000 : 6000;
    if (args.consent) await guard('consent', async () => {
      const sel = String(args.consent);
      const ref = await refAfter(async (p) => { await p.waitForFunction(visibleSel, sel, { timeout: lateWait }); await p.click(sel); });
      report.interact.consent = {};
      for (const when of ['0.5', '2', 'mid']) {
        const { ctx, page, bag } = await openEffect('scroll', { after: when === 'mid' ? 0.2 : +when });
        if (when === 'mid' && (await page.evaluate(STATE)).modal) { console.log('   (middle of the build: not applicable, the consent dialog holds the build until it is answered)'); await ctx.close(); continue; }
        if (when === 'mid') { // half of the build, read like a visitor
          const tEnd = Date.now() + 40000;
          for (;;) { const s = await page.evaluate(STATE); if (s.phase !== 'build' || s.layersDone >= s.layersTotal * 0.45 || Date.now() > tEnd) break; await page.mouse.wheel(0, Math.round(VH * 0.3)); await page.waitForTimeout(350); }
          if (!(await page.evaluate(visibleSel, sel))) { await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await page.waitForTimeout(400); }
        }
        const seen = await page.waitForFunction(visibleSel, sel, { timeout: lateWait }).then(() => true).catch(() => false);
        const s0 = await page.evaluate(STATE), st0 = await page.evaluate(store);
        const box = seen ? await (await page.$(sel)).boundingBox() : null;
        if (box) await tapAt(page, box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(450);
        const after = await page.evaluate(([s, f]) => ({ vis: (new Function('return ' + f))()(s), store: '' }), [sel, visibleSel.toString()]);
        const st1 = await page.evaluate(store);
        const go = await goesOn(page, s0);
        const label = (MOBILE ? 'tap' : 'click') + ' on the consent button at ' + (when === 'mid' ? 'the middle of the build' : when + ' s');
        check('interact: ' + label + ' — works at once (banner closed, choice stored), the effect goes on',
          seen && (s0.phase === 'build' || s0.modal) && !after.vis && st1 !== st0 && go.ok,
          (seen ? '' : 'button never visible; ') + 'banner ' + (after.vis ? 'still open' : 'closed') + ', storage ' + (st1 !== st0 ? 'changed' : 'unchanged') + ', at ' + s0.layersDone + '/' + s0.layersTotal + ' layers -> ' + go.why);
        const end = await toEnd(page, bag, ref);
        if (!domSame(end.g.dom, ref)) { const a = normDom(ref), d = normDom(end.g.dom), i = firstDiff(a, d); console.log('   (DOM difference: ref …' + JSON.stringify(a.slice(Math.max(0, i - 80), i + 60)) + ' / effect …' + JSON.stringify(d.slice(Math.max(0, i - 80), i + 60)) + ')'); }
        check('interact: ' + label + ' — then the build runs to its end; the finished page equals the page after the same click without the effect, no layout shift, no errors',
          end.ok && end.natural, 'exit ' + (end.g.s && end.g.s.lastExit) + ', DOM ' + (domSame(end.g.dom, ref) ? 'identical' : 'differs') + ', CLS ' + (end.g.cls || 0).toFixed(4) + ', hidden elements ' + end.hiddenLeft + (bag.length ? ', errors: ' + bag.slice(0, 2).join(' | ') : ''));
        report.interact.consent[when] = { atLayers: s0.layersDone, total: s0.layersTotal, seenShare: end.natural ? 1 : +(s0.layersDone / Math.max(1, s0.layersTotal)).toFixed(3), exit: end.g.s && end.g.s.lastExit };
        await ctx.close();
      }
      // keyboard: Tab to the button, then Enter (and Space)
      for (const key of ['Enter', 'Space']) {
        const { ctx, page, bag } = await openEffect('scroll', { after: 0.4 });
        await page.waitForFunction(visibleSel, sel, { timeout: lateWait }).catch(() => {});
        let hit = false, tabs = 0, hiddenFocus = 0;
        for (; tabs < 80 && !hit; tabs++) {
          await page.keyboard.press('Tab');
          await page.waitForTimeout(40);
          const f = await page.evaluate((s) => { const e = document.activeElement; return { hit: !!(e && e.matches && e.matches(s)), vis: e && e !== document.body ? getComputedStyle(e).visibility : 'visible' }; }, sel);
          hit = f.hit; if (f.vis !== 'visible') hiddenFocus++;
        }
        const s0 = await page.evaluate(STATE), st0 = await page.evaluate(store);
        if (hit) await page.keyboard.press(key);
        await page.waitForTimeout(450);
        const vis = await page.evaluate(visibleSel, sel), st1 = await page.evaluate(store);
        const go = await goesOn(page, s0);
        check('interact: keyboard — Tab to the consent button (' + tabs + ' Tabs, every focused element visible), ' + key + ' works, the effect goes on',
          hit && hiddenFocus === 0 && !vis && st1 !== st0 && go.ok && !bag.length, (hit ? '' : 'button never focused; ') + 'hidden focus ' + hiddenFocus + ', banner ' + (vis ? 'still open' : 'closed') + ', ' + go.why + (s0.interact ? ', parts built at once for the focus ' + s0.interact.focusBuilds : ''));
        await ctx.close();
      }
    });
    // menus (drop-down, hamburger), fields, a pop-up, an in-page link, a client-side route
    const pair = (v) => String(v).split('|');
    const menuArg = MOBILE ? (args['menu-mobile'] || args.menu) : args.menu;
    if (menuArg && menuArg !== true) await guard('menu', async () => {
      const [tog, panel] = pair(menuArg);
      const { ctx, page, bag } = await openEffect('scroll', { after: 0.4 });
      const ok0 = await page.waitForFunction(visibleSel, tog, { timeout: 8000 }).then(() => true).catch(() => false);
      const s0 = await page.evaluate(STATE);
      const b = ok0 ? await (await page.$(tog)).boundingBox() : null;
      if (b) await tapAt(page, b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(400);
      const open = await page.evaluate(visibleSel, panel);
      const go = await goesOn(page, s0, 1200);
      if (b) await tapAt(page, b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(400);
      const closed = !(await page.evaluate(visibleSel, panel));
      const s2 = await page.evaluate(STATE);
      const end = await toEnd(page, bag, null);
      check('interact: ' + (MOBILE ? 'hamburger' : 'drop-down') + ' menu opens and closes during the build (' + tog + '), the effect goes on and ends complete',
        ok0 && open && closed && go.ok && running(s2) && end.ok, 'toggle ' + (ok0 ? 'visible' : 'never visible') + ', panel ' + (open ? 'opened' : 'did not open') + ' / ' + (closed ? 'closed' : 'still open') + ', ' + go.why + ', relayouts ' + ((s2.interact || {}).relayouts || 0) + ', end: exit ' + (end.g.s && end.g.s.lastExit) + ', CLS ' + (end.g.cls || 0).toFixed(4) + ', hidden ' + end.hiddenLeft);
      await ctx.close();
    });
    if (args.field && args.field !== true) await guard('field', async () => {
      const sel = String(args.field), text = 'Kovács Éva 😀';
      const { ctx, page, bag } = await openEffect('scroll', { after: 0.6 });
      await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center', behavior: 'instant' }), sel);
      const ok0 = await page.waitForFunction(visibleSel, sel, { timeout: 8000 }).then(() => true).catch(() => false);
      const s0 = await page.evaluate(STATE);
      const b = await (await page.$(sel)).boundingBox();
      await tapAt(page, b.x + b.width / 2, b.y + b.height / 2);
      await page.keyboard.type(text, { delay: 35 });
      const v = await page.$eval(sel, (e) => e.value);
      const go = await goesOn(page, s0, 1200);
      check('interact: typing into a form field during the build (' + sel + ') works (Space and letters too), the effect goes on',
        ok0 && v === text && go.ok && !bag.length, 'value ' + JSON.stringify(v) + ', ' + go.why);
      await ctx.close();
    });
    if (args.popup && args.popup !== true) await guard('popup', async () => {
      const [opener, closer] = pair(args.popup);
      const { ctx, page, bag } = await openEffect('scroll', { after: 0.8 });
      const ok0 = await page.waitForFunction(visibleSel, opener, { timeout: 8000 }).then(() => true).catch(() => false);
      const s0 = await page.evaluate(STATE);
      let b = await (await page.$(opener)).boundingBox();
      await tapAt(page, b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(700);
      const m1 = await page.evaluate(() => ({ s: window.SwarmRebuild.state(), ov: getComputedStyle(document.querySelector('#swarm-rebuild-root .sr-deco')).visibility }));
      await page.waitForTimeout(800);
      const m2 = await page.evaluate(STATE);
      const closeVis = await page.evaluate(visibleSel, closer);
      // Esc belongs to the pop-up: it closes it, the effect goes on
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      const afterEsc = await page.evaluate(([c, f]) => ({ open: (new Function('return ' + f))()(c), s: window.SwarmRebuild.state() }), [closer, visibleSel.toString()]);
      check('interact: a pop-up with a backdrop opens during the build, the build waits under it (overlay hidden), Esc closes the pop-up and not the effect',
        ok0 && m1.s.modal && m1.ov === 'hidden' && closeVis && m2.layersDone === m1.s.layersDone && !afterEsc.open && running(afterEsc.s) && afterEsc.s.phase !== 'idle',
        'modal ' + m1.s.modal + ', overlay ' + m1.ov + ', layers while open ' + m1.s.layersDone + ' -> ' + m2.layersDone + ', after Esc: pop-up ' + (afterEsc.open ? 'open' : 'closed') + ', effect ' + afterEsc.s.phase + (afterEsc.s.lastExit ? ' (' + afterEsc.s.lastExit + ')' : ''));
      // open again, close with its button: the build resumes where it was
      b = await (await page.$(opener)).boundingBox();
      if (b) await tapAt(page, b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(600);
      const c = await (await page.$(closer)).boundingBox();
      const s3 = await page.evaluate(STATE);
      if (c) await tapAt(page, c.x + c.width / 2, c.y + c.height / 2);
      await page.waitForTimeout(300);
      const go = await goesOn(page, s3, 2000);
      const end = await toEnd(page, bag, null);
      check('interact: closed with its button, the build resumes where it was and ends complete',
        s3.modal && go.ok && end.ok, go.why + ', paused ' + ((go.s.interact || {}).modalT || 0).toFixed(1) + ' s in total, end: exit ' + (end.g.s && end.g.s.lastExit) + ', CLS ' + (end.g.cls || 0).toFixed(4) + ', hidden ' + end.hiddenLeft + (bag.length ? ', errors ' + bag[0] : ''));
      await ctx.close();
    });
    if (args.anchor && args.anchor !== true) await guard('anchor', async () => {
      const sel = String(args.anchor);
      const { ctx, page, bag } = await openEffect('scroll', { after: 0.8 });
      const ok0 = await page.waitForFunction(visibleSel, sel, { timeout: 8000 }).then(() => true).catch(() => false);
      const s0 = await page.evaluate(STATE);
      const target = await page.$eval(sel, (a) => a.getAttribute('href'));
      const b = await (await page.$(sel)).boundingBox();
      await tapAt(page, b.x + b.width / 2, b.y + b.height / 2);
      // the view is filled within ~2.5 s after the jump; nothing above it is left hidden
      let filled = null, t0 = Date.now(), lastHidden = -1, sMid;
      while (Date.now() - t0 < 4000) {
        await page.waitForTimeout(250);
        const x = await page.evaluate(() => {
          const vh = innerHeight; let hid = 0, above = 0;
          for (const e of document.body.querySelectorAll('*')) {
            const c = getComputedStyle(e); if (c.display === 'none' || c.position === 'fixed' || e.closest('#swarm-rebuild-root')) continue;
            const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
            const paints = Array.from(e.childNodes).some((n) => n.nodeType === 3 && /\S/.test(n.data)) || /^(IMG|SVG|VIDEO|INPUT|BUTTON|SELECT|TEXTAREA)$/i.test(e.tagName);
            if (!paints || c.visibility === 'visible') continue;
            if (r.top >= 0 && r.bottom <= vh) hid++; else if (r.bottom < -Math.max(40, vh * 0.1)) above++;
          }
          return { hid, above, y: scrollY, s: window.SwarmRebuild.state() };
        });
        lastHidden = x.hid; sMid = x;
        if (x.hid === 0 && filled == null) filled = (Date.now() - t0) / 1000;
        if (filled != null && Date.now() - t0 > 1500) break;
      }
      const tgt = await page.evaluate((h) => { const e = h && h.length > 1 ? document.querySelector(h) : null; return e ? Math.round(e.getBoundingClientRect().top) : null; }, target);
      const end = await toEnd(page, bag, null);
      check('interact: an in-page link (' + target + ') jumps during the build, the new view is filled within 2.5 s, nothing above it stays hidden, the effect goes on',
        ok0 && s0.phase === 'build' && tgt != null && Math.abs(tgt) < VH * 0.5 && filled != null && filled <= 2.5 && sMid && sMid.above === 0 && running(sMid.s) && end.ok,
        'target at ' + tgt + ' px from the top, filled after ' + (filled != null ? filled.toFixed(2) + ' s' : 'never (hidden ' + lastHidden + ')') + ', hidden above ' + (sMid && sMid.above) + ', end: exit ' + (end.g.s && end.g.s.lastExit) + ', CLS ' + (end.g.cls || 0).toFixed(4));
      report.interact.anchorFill = filled;
      await ctx.close();
    });
    if (args.route && args.route !== true) await guard('route', async () => {
      const sel = String(args.route);
      const { ctx, page, bag } = await openEffect('scroll', { after: 0.8 });
      const ok0 = await page.waitForFunction(visibleSel, sel, { timeout: 8000 }).then(() => true).catch(() => false);
      const u0 = page.url();
      const b = await (await page.$(sel)).boundingBox();
      await tapAt(page, b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(900);
      const x = await page.evaluate(() => ({ s: window.SwarmRebuild.state(), hide: !!document.getElementById('swarm-rebuild-hide'), root: !!document.getElementById('swarm-rebuild-root'), cls: window.__cls,
        hidden: Array.from(document.body.querySelectorAll('*')).filter((e) => { const c = getComputedStyle(e); const r = e.getBoundingClientRect(); return c.visibility === 'hidden' && c.display !== 'none' && r.width > 0 && r.bottom > 0 && r.top < innerHeight; }).length }));
      check('interact: a client-side route change (' + sel + ') during the build shows the new page complete at once (the effect ends, nothing hidden)',
        ok0 && page.url() !== u0 && x.s.phase === 'idle' && !x.hide && !x.root && x.hidden === 0 && (x.cls || 0) < 0.01 && !bag.length, 'url ' + (page.url() !== u0 ? 'changed' : 'unchanged') + ', exit ' + (x.s.lastExit || x.s.phase) + ', hidden in view ' + x.hidden + (bag.length ? ', errors ' + bag[0] : ''));
      await ctx.close();
    });
    // ---------- what ends it: Esc; a double click / double tap on an empty spot. What does not: one click or tap on an
    // empty spot, two slow taps, taps while the page scrolls
    // a consent dialog on a backdrop is answered first (it holds the build, and Esc belongs to it)
    const clearModal = async (page) => {
      if (!(await page.evaluate(STATE)).modal || !args.consent) return;
      const b = await (await page.$(String(args.consent))).boundingBox();
      await tapAt(page, b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForFunction(() => window.SwarmRebuild.state().phase === 'build', null, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(800);
    };
    await guard('clicks and taps on an empty spot', async () => {
      const { ctx, page } = await openEffect('scroll', { after: 1 });
      await clearModal(page);
      const sp = await page.evaluate(EMPTY_SPOT);
      const s0 = await page.evaluate(STATE);
      if (sp) await tapAt(page, sp.x, sp.y);
      await page.waitForTimeout(600);
      if (MOBILE && sp) { await page.touchscreen.tap(sp.x, sp.y); await page.waitForTimeout(700); await page.touchscreen.tap(sp.x, sp.y); await page.waitForTimeout(300); }
      let s1 = await page.evaluate(STATE);
      let scrollTaps = 'n/a';
      if (MOBILE && sp && s1.phase === 'build') {
        await page.mouse.wheel(0, 300); await page.waitForTimeout(60);
        await page.touchscreen.tap(sp.x, sp.y); await page.waitForTimeout(90); await page.touchscreen.tap(sp.x, sp.y);
        await page.waitForTimeout(300);
        const s2 = await page.evaluate(STATE); scrollTaps = s2.phase === 'idle' ? 'ended it' : 'ignored'; s1 = s2;
      }
      check('interact: ' + (MOBILE ? 'one tap, two slow taps and a quick double tap while the page scrolls' : 'one click') + ' on an empty spot do not end the effect',
        !!sp && s0.phase === 'build' && running(s1) && s1.phase !== 'idle', (sp ? sp.what + ' at ' + sp.x + ',' + sp.y : 'no empty spot found') + ', effect ' + s1.phase + (s1.lastExit ? ' (' + s1.lastExit + ')' : '') + (MOBILE ? ', double tap while scrolling ' + scrollTaps : ''));
      await page.waitForTimeout(500);
      const sp2 = await page.evaluate(EMPTY_SPOT);
      if (sp2) { if (MOBILE) { await page.touchscreen.tap(sp2.x, sp2.y); await page.waitForTimeout(110); await page.touchscreen.tap(sp2.x, sp2.y); } else await page.mouse.dblclick(sp2.x, sp2.y); }
      await page.waitForTimeout(300);
      const g = await page.evaluate(gone);
      check('interact: a double ' + (MOBILE ? 'tap' : 'click') + ' on an empty spot ends the effect on purpose: the finished page at once, no layout shift',
        !!sp2 && g.s && g.s.phase === 'idle' && /dbl/.test(g.s.lastExit || '') && !g.root && !g.hide && (g.cls || 0) < 0.01, 'exit ' + (g.s && g.s.lastExit) + ', CLS ' + (g.cls || 0).toFixed(4));
      await ctx.close();
    });
    await guard('Esc', async () => {
      const { ctx, page } = await openEffect('scroll', { after: 1 });
      if ((await page.evaluate(STATE)).modal) {
        // Esc with a modal open belongs to the page; twice within 1.5 s always ends the effect
        await page.keyboard.press('Escape'); await page.waitForTimeout(300);
        const s1 = await page.evaluate(STATE);
        await page.keyboard.press('Escape'); await page.waitForTimeout(300);
        const g2 = await page.evaluate(gone);
        check('interact: with a modal open, one Esc belongs to the page, Esc twice ends the effect', s1.phase !== 'idle' && g2.s && g2.s.phase === 'idle' && !g2.root && !g2.hide,
          'after one Esc ' + s1.phase + ', after two ' + (g2.s && g2.s.phase) + ' (' + (g2.s && g2.s.lastExit) + ')');
        await ctx.close();
        return;
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      const g = await page.evaluate(gone);
      check('interact: Esc ends the effect: the finished page at once (DOM identical), no layout shift', g.s && g.s.phase === 'idle' && g.s.lastExit === 'esc' && isFinished(g, baseDom) && (g.cls || 0) < 0.01, 'exit ' + (g.s && g.s.lastExit) + ', CLS ' + (g.cls || 0).toFixed(4));
      await ctx.close();
    });
    await guard('reduced motion', async () => {
      const rc = await newCtx({ reducedMotion: 'reduce' });
      const rp = await rc.newPage();
      await rp.goto(effectUrl('scroll'), { waitUntil: 'load' });
      await rp.waitForTimeout(800);
      const g = await rp.evaluate(gone);
      check('interact: prefers-reduced-motion still switches the effect off', !g.root && !g.hide && g.s && g.s.phase === 'idle', 'overlay ' + g.root + ', hiding ' + g.hide);
      await rc.close();
    });
  }

  if (CHECKS.has('seen')) {
    // ---------- how much of the effect a visitor sees who presses Accept right at the start (also with an older module: --module)
    report.seen = {};
    const sel = String(args.consent || '');
    for (const when of [0.5, 2]) {
      const { ctx, page } = await openEffect('scroll', { after: when });
      const ok = sel ? await page.waitForFunction((s) => { const e = document.querySelector(s); return e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility === 'visible'; }, sel, { timeout: 9000 }).then(() => true).catch(() => false) : false;
      const s0 = await page.evaluate(STATE);
      const t0 = Date.now();
      if (ok) { const b = await (await page.$(sel)).boundingBox(); if (MOBILE) await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); else await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); }
      await page.waitForTimeout(300);
      const s1 = await page.evaluate(STATE);
      let r = { s: s1 };
      if (s1.phase === 'build') r = await readDown(page, 0.5, 400, 70000);
      const runFor = (Date.now() - t0) / 1000;
      const natural = r.s.phase === 'done' || (r.s.phase === 'idle' && r.s.lastExit === 'auto');
      const share = natural ? 1 : s0.layersDone / Math.max(1, s0.layersTotal);
      report.seen[when] = { atLayers: s0.layersDone, total: s0.layersTotal, share: +share.toFixed(3), effectAfterClick: natural ? +runFor.toFixed(1) : 0, exit: s1.phase === 'idle' ? s1.lastExit : 'went on' };
      check('seen: Accept at ' + when + ' s — the visitor sees ' + Math.round(share * 100) + ' % of the build', ok && share > 0.9, 'clicked at ' + s0.layersDone + '/' + s0.layersTotal + ' layers, effect ' + (s1.phase === 'idle' ? 'ended (' + s1.lastExit + ')' : 'went on for ' + runFor.toFixed(1) + ' s more'));
      await ctx.close();
    }
  }

  if (CHECKS.has('protect')) {
    report.protect = {};
    // ---------- everything above the view is final (debug probe), with fast scrolling
    {
      const { ctx, page, bag } = await openEffect('scroll', { debug: true, after: 0.4 });
      const probes = [];
      for (let k = 0; k < 14; k++) {
        await page.mouse.wheel(0, Math.round(VH * 0.9));
        await page.waitForTimeout(220);
        const p = await page.evaluate(() => window.SwarmRebuild._probe && window.SwarmRebuild._probe()).catch(() => null);
        if (p) probes.push(p);
        if (!p || p.phase !== 'build') break;
      }
      const checked = probes.reduce((a, p) => a + p.checked, 0);
      const bad = probes.filter((p) => p.notFinalN || p.overlayAboveN);
      check('protect: everything scrolled above the view is final at once (no animation left there)', probes.length > 0 && checked > 0 && bad.length === 0,
        probes.length + ' probes, ' + checked + ' layer checks' + (bad.length ? ', e.g. ' + JSON.stringify(bad[0].notFinal.concat(bad[0].overlayAbove)).slice(0, 200) : ''));
      report.protect.above = { probes: probes.length, checked, bad: bad.length };
      await readDown(page, 0.6, 300, 40000);
      await page.evaluate(() => window.SwarmRebuild.goLive());
      const g = await page.evaluate(gone);
      check('protect: fast scrolling run still ends with the original DOM', isFinished(g, baseDom) && bag.length === 0, bag.slice(0, 2).join(' | '));
      await ctx.close();
    }
    // ---------- faults: exception in a task, a stuck task, exception in the frame loop
    for (const kind of ['task', 'stall', 'loop']) {
      const t0 = Date.now();
      const { ctx, page, bag } = await openEffect('scroll', { debug: true, params: { 'rebuild-fault': kind + '@0.6' } });
      let fin;
      if (kind === 'loop') {
        await page.waitForTimeout(2200);
        fin = await page.evaluate(gone);
        check('protect: an exception in the frame loop shows the whole page at once', isFinished(fin, baseDom) && fin.s.lastExit === 'error', 'exit ' + (fin.s && fin.s.lastExit));
      } else {
        await page.waitForTimeout(900);
        let mid = await page.evaluate(STATE);
        let waited = null;
        if (kind === 'stall') {
          // no scrolling: only the task watchdog can end the stuck task
          const tf = Date.now();
          await page.waitForFunction(() => { const s = window.SwarmRebuild.state(); return s.aborts >= 1 || s.phase !== 'build'; }, null, { timeout: 14000 }).catch(() => {});
          waited = (Date.now() - tf) / 1000 + 0.3;
          mid = await page.evaluate(STATE);
        }
        const r = await readDown(page, 0.4, 500, 45000);
        const last = r.s;
        await untilIdle(page, 8000);
        fin = await page.evaluate(gone);
        const label = kind === 'task' ? 'an exception in a task' : 'a stuck task (8 s watchdog)';
        const aborts = Math.max(mid.aborts || 0, last.aborts || 0);
        check('protect: ' + label + ' finishes that part, the rest goes on to the end', mid.fault && mid.fault.fired && aborts >= 1 && isFinished(fin, baseDom) && (kind !== 'stall' || waited <= 10),
          'fault ' + JSON.stringify(mid.fault) + ', aborts ' + aborts + (waited != null ? ', watchdog after ~' + waited.toFixed(1) + ' s' : '') + ', ended ' + last.phase + ' -> ' + (fin.s && fin.s.lastExit) + ' after ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
      }
      check('protect (' + kind + '): no page errors (only warnings)', bag.filter((m) => /pageerror/.test(m)).length === 0, bag.slice(0, 2).join(' | '));
      await ctx.close();
    }
    // ---------- the script dies completely: the CSS dead-man switch shows the page by itself
    {
      const { ctx, page } = await openEffect('scroll', { debug: true, params: { 'rebuild-fault': 'die@0.6' } });
      await page.waitForTimeout(1500);
      const mid = await page.evaluate(STATE);
      const visMid = await page.evaluate(VIS_MAP);
      await page.waitForTimeout(5600);
      const vis = await page.evaluate(VIS_MAP);
      const op = await page.evaluate(() => { const r = document.getElementById('swarm-rebuild-root'); return r ? getComputedStyle(r).opacity : 'removed'; });
      const hiddenBefore = [...visMid].filter((c, k) => c !== baseVis[k]).length;
      const wrong = [...vis].filter((c, k) => c !== baseVis[k]).length;
      check('protect: the script stops for good -> the CSS safety switch shows the whole page within 6 s', mid.phase === 'dead' && hiddenBefore > 0 && wrong === 0 && vis.length === baseVis.length && (op === '0' || op === 'removed'),
        'phase ' + mid.phase + ', hidden while dead: ' + hiddenBefore + ', wrong after: ' + wrong + ' of ' + vis.length + ', overlay opacity ' + op);
      await ctx.close();
    }
    // ---------- resize while building
    {
      const { ctx, page } = await openEffect('scroll', { after: 1.0 });
      await page.setViewportSize({ width: MOBILE ? 430 : 1200, height: VH });
      await page.waitForTimeout(400);
      const g = await page.evaluate(gone);
      check('protect: a resize while building shows the finished page', !g.root && !g.hide && g.s.lastExit === 'resize', 'exit ' + (g.s && g.s.lastExit));
      await ctx.close();
    }
    // ---------- background tab (simulated): short absence continues, long absence shows the page
    {
      const hide = (on) => page2.evaluate((h) => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
        document.dispatchEvent(new Event('visibilitychange'));
        return window.__srDms ? window.__srDms.effect.getTiming().delay : null;
      }, on);
      const { ctx, page: page2 } = await openEffect('scroll', { debug: true, params: { 'rebuild-hidden-max': '2' }, after: 0.8 });
      const dHidden = await hide(true);
      await page2.waitForTimeout(800);
      const dBack = await hide(false);
      const s1 = await page2.evaluate(STATE);
      await hide(true);
      await page2.waitForTimeout(2600);
      await hide(false);
      await page2.waitForTimeout(150);
      const g = await page2.evaluate(gone);
      check('protect: background tab — safety switch paused while hidden, short absence continues, long absence shows the page',
        dHidden >= 600000 && dBack === 5000 && s1.phase === 'build' && !g.root && !g.hide && g.s.lastExit === 'hidden',
        'switch delay hidden ' + dHidden + ' ms / back ' + dBack + ' ms, after 0.8 s away: ' + s1.phase + ', after 2.6 s away: ' + (g.s && g.s.lastExit));
      await ctx.close();
    }
  }

  if (CHECKS.has('fixed')) {
    // ---------- the overlay never draws over fixed elements: overlay shown vs. hidden, module paused
    const { ctx, page } = await openEffect('scroll', { after: 0.25 });
    const samples = [], covered = [], recheck = [];
    // the page must not move between the two screenshots (edges of round or shadowed buttons show what is behind)
    const still = () => page.evaluate(() => new Promise((res) => { let y = scrollY, n = 0, k = 0; (function f() { if (scrollY === y) n++; else { n = 0; y = scrollY; } if (n >= 4 || ++k > 90) res(); else requestAnimationFrame(f); })(); }));
    const sample = async () => {
      await still();
      const targets = await page.evaluate(fixedTargets);
      if (!targets.length) return;
      await page.evaluate(() => window.SwarmRebuild._pause(true));
      await page.waitForTimeout(60);
      for (const t of targets) {
        if (t.clip.width < 2 || t.clip.height < 2) continue;
        // shown / hidden / shown again: if the two "shown" shots differ, the page itself is moving there (its own
        // transition seen through a round or shadowed edge): look again a little later
        let d = { ratio: 0 };
        for (let k = 0; k < 4; k++) {
          const a = await page.screenshot({ clip: t.clip, caret: 'initial' }); // not animations:'disabled': it would fast-forward the safety timer
          await page.evaluate(() => { const r = document.getElementById('swarm-rebuild-root'); if (r) r.style.visibility = 'hidden'; });
          const b = await page.screenshot({ clip: t.clip, caret: 'initial' });
          await page.evaluate(() => { const r = document.getElementById('swarm-rebuild-root'); if (r) r.style.visibility = ''; });
          const c = await page.screenshot({ clip: t.clip, caret: 'initial' });
          d = await pixelDiff(page, b64(a), b64(b));
          if ((await pixelDiff(page, b64(a), b64(c))).ratio <= 0.002) break;
          await page.waitForTimeout(350);
        }
        samples.push(t.name);
        if (d.ratio > 0.002) (/\(sticky\)$/.test(t.name) ? recheck : covered).push(Object.assign({ pct: (d.ratio * 100).toFixed(2) }, t));
      }
      await page.evaluate(() => window.SwarmRebuild._pause(false));
      // a sticky bar that has just been finished may still have its placeholder fading out for a moment (it gets its
      // hole once its build is over): look again half a second later
      while (recheck.length) {
        const t = recheck.shift();
        await page.waitForTimeout(500);
        await page.evaluate(() => window.SwarmRebuild._pause(true));
        await page.waitForTimeout(60);
        const a2 = await page.screenshot({ clip: t.clip, caret: 'initial' });
        await page.evaluate(() => { const r = document.getElementById('swarm-rebuild-root'); if (r) r.style.visibility = 'hidden'; });
        const b2 = await page.screenshot({ clip: t.clip, caret: 'initial' });
        await page.evaluate(() => { const r = document.getElementById('swarm-rebuild-root'); if (r) r.style.visibility = ''; });
        await page.evaluate(() => window.SwarmRebuild._pause(false));
        const st2 = await page.evaluate(STATE);
        const d2 = await pixelDiff(page, b64(a2), b64(b2));
        if (d2.ratio > 0.002 && st2.phase === 'build') covered.push(t.name + ' ' + (d2.ratio * 100).toFixed(2) + '% (still after 0.5 s)');
      }
    };
    await sample();
    for (let k = 0; k < 16; k++) {
      const s = await page.evaluate(STATE);
      if (s.phase !== 'build') break;
      await page.mouse.wheel(0, Math.round(VH * 0.33));
      await page.waitForTimeout(k % 2 ? 90 : 260);
      await sample();
    }
    const names = [...new Set(samples)];
    check('fixed: the effect never draws over fixed bars / buttons' + (names.length ? '' : ' (no fixed element on this page)'), covered.length === 0,
      samples.length + ' samples of ' + (names.join(', ') || 'none') + (covered.length ? ', covered: ' + covered.slice(0, 3).map((c) => typeof c === 'string' ? c : c.name + ' ' + c.pct + '%').join(', ') : ''));
    report.fixed = { samples: samples.length, elements: names, covered: covered.length };
    await page.evaluate(() => window.SwarmRebuild.goLive()).catch(() => {});
    await ctx.close();
  }


  if (CHECKS.has('visible')) {
    // ---------- scroll mode: only what is in view is built
    report.visible = {};
    // in the page, every frame: working agents outside the view (at the scroll position the frame was drawn for),
    // tasks whose part is completely out of view
    const SAMPLER = () => {
      const v = window.__visS = { frames: 0, work: 0, offAgents: 0, offTasks: 0, ex: [], idle: [], shown: [] };
      (function f() {
        const R = window.SwarmRebuild, m = R && R._motion && R._motion(true);
        if (m && m.phase === 'build' && !m.touring) {
          v.frames++;
          m.agents.forEach((a) => { if (!a.work) return; v.work++; if (a.y < m.sy - 2 || a.y > m.sy + m.vh + 2) { v.offAgents++; if (v.ex.length < 4) v.ex.push(Math.round(a.y - m.sy)); } });
          v.offTasks += m.offTasks || 0;
          // idle agents that can be seen, overlapping another one (cursor icons ~20 px): after the opening swarms dissolved
          if (m.bt > 0.6) {
            const sh = m.agents.filter((a) => !a.task && a.op !== 0);
            let n = 0; sh.forEach((a) => { if (sh.some((o) => o !== a && Math.abs(o.x - a.x) < 18 && Math.abs(o.y - a.y) < 18)) n++; });
            v.idle.push(n); v.shown.push(sh.length);
          }
        }
        if (!R || R.state().phase !== 'idle') requestAnimationFrame(f);
      })();
    };
    {
      // reading down at a normal pace
      const { ctx, page, bag } = await openEffect('scroll', { debug: true, waitUntil: 'domcontentloaded' });
      await page.evaluate(SAMPLER);
      await readDown(page, 0.35, 500, 90000);
      const mo = await page.evaluate(() => window.SwarmRebuild._motion());
      const s = await page.evaluate(STATE);
      const v = await page.evaluate(() => window.__visS);
      const starts = (mo && mo.starts) || [], vs = starts.map((x) => x.vis).sort((a, b) => a - b);
      const thr = s.buildVisible || 0.6;
      const under = starts.filter((x) => x.vis < thr - 0.005);
      report.visible.read = { starts: vs.length, min: vs[0], p10: vs[Math.floor(vs.length * 0.1)], median: vs[vs.length >> 1], threshold: thr, under: under.length, workSamples: v.work, offAgents: v.offAgents, offTasks: v.offTasks, skips: { above: s.aboveSkips, offView: s.offSkips, deps: s.depSkips } };
      check('visible: every part starts with at least ' + Math.round(thr * 100) + ' % of it in view (reading down)', vs.length > 0 && under.length === 0,
        vs.length + ' starts, in view at the start: min ' + Math.round((vs[0] || 0) * 100) + ' %, 10th percentile ' + Math.round((report.visible.read.p10 || 0) * 100) + ' %, median ' + Math.round((report.visible.read.median || 0) * 100) + ' %' + (under.length ? ', under: ' + JSON.stringify(under.slice(0, 3)) : ''));
      check('visible: no working agent outside the view, no task running out of view (reading down)', v.work > 0 && v.offAgents === 0 && v.offTasks === 0,
        v.frames + ' frames, ' + v.work + ' working-agent samples, outside ' + v.offAgents + (v.ex.length ? ' (' + v.ex.join(', ') + ' px)' : '') + ', tasks out of view ' + v.offTasks + '; finished out of sight: ' + s.aboveSkips + ' above, ' + s.offSkips + ' scrolled out, ' + s.depSkips + ' waited-for');
      const io = v.idle.slice().sort((a, b) => a - b), q = (a, f) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * f))] : 0;
      const many = v.idle.filter((x) => x >= 3).length / Math.max(1, v.idle.length);
      const shn = v.shown.slice().sort((a, b) => a - b);
      report.visible.idle = { frames: io.length, overlapMedian: q(io, 0.5), overlapP95: q(io, 0.95), overlapMax: io[io.length - 1] || 0, framesWith3: +many.toFixed(4), shownIdleMedian: q(shn, 0.5), shownIdleP95: q(shn, 0.95) };
      check('idle: resting agents never cluster (at most 2 overlapping in 98 % of the frames)', io.length > 0 && q(io, 0.5) === 0 && many <= 0.02,
        io.length + ' frames: overlapping idle cursors median ' + q(io, 0.5) + ', 95th percentile ' + q(io, 0.95) + ', max ' + (io[io.length - 1] || 0) + ', frames with 3 or more ' + (many * 100).toFixed(1) + ' %; idle cursors shown: median ' + q(shn, 0.5) + ' (the rest faded out)');
      check('visible: reading-down run — no errors', !bag.length && !bag.fallbacks.length, (bag.concat(bag.fallbacks)).slice(0, 3).join(' | '));
      await ctx.close();
    }
    {
      // fast scrolling: wheel bursts, Page Down twice, End; how long until everything in view is built
      const { ctx, page, bag } = await openEffect('scroll', { debug: true, after: 1.2 });
      await page.evaluate(SAMPLER);
      const dir = path.join(OUT, 'visible');
      fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      const fills = [];
      let shots = 0, s = await page.evaluate(STATE);
      const jumps = ['wheel', 'wheel', 'pgdn', 'wheel', 'wheel', 'pgdn', 'wheel', 'end'];
      for (let j = 0; j < jumps.length && s.phase === 'build'; j++) {
        const kind = jumps[j];
        if (kind === 'wheel') for (let k = 0; k < 3; k++) { await page.mouse.wheel(0, Math.round(VH * 0.6)); await page.waitForTimeout(40); }
        else if (kind === 'pgdn') { await page.keyboard.press('PageDown'); await page.waitForTimeout(80); await page.keyboard.press('PageDown'); }
        else await page.keyboard.press('End');
        const t0 = Date.now();
        await page.waitForTimeout(120);
        let first = null, left = 1, filledAt = null, marks = j < 3 ? [0.1, 0.6, 1.2, 2.0] : [];
        while (Date.now() - t0 < 6000) {
          s = await page.evaluate(STATE).catch(() => ({ phase: 'err' }));
          left = s.phase === 'build' && s.inView ? s.inView.left : 0;
          if (first == null) first = left;
          const el = (Date.now() - t0) / 1000;
          if (left === 0 && filledAt == null) filledAt = el;
          if (marks.length && el >= marks[0]) { marks.shift(); await page.screenshot({ path: path.join(dir, 'v' + String(shots++).padStart(2, '0') + '.png'), caret: 'initial' }).catch(() => {}); }
          if (filledAt != null && !marks.length) break;
          await page.waitForTimeout(40);
        }
        if (first) fills.push({ kind, parts: first, s: filledAt != null ? +filledAt.toFixed(2) : 6, filled: filledAt != null });
        if (s.phase !== 'build') break;
        await page.waitForTimeout(250);
      }
      // the fill time is measured until the view holds nothing to build (time spent on contact-sheet shots included)
      const ft = fills.filter((f) => f.parts > 0);
      const avg = ft.length ? ft.reduce((a, f) => a + f.s, 0) / ft.length : 0, max = Math.max(0, ...ft.map((f) => f.s));
      const v = await page.evaluate(() => window.__visS);
      const mo = await page.evaluate(() => window.SwarmRebuild._motion && window.SwarmRebuild._motion());
      const starts = (mo && mo.starts) || [], thr = (await page.evaluate(STATE)).buildVisible || 0.6;
      const under = starts.filter((x) => x.vis < thr - 0.005);
      report.visible.fast = { jumps: fills, avgFill: +avg.toFixed(2), maxFill: +max.toFixed(2), starts: starts.length, under: under.length, offAgents: v.offAgents, offTasks: v.offTasks };
      check('visible: after fast scrolling the view is built quickly (avg <= 2 s, max <= 3 s)', ft.length > 0 && ft.every((f) => f.filled) && avg <= 2 && max <= 3,
        ft.map((f) => f.kind + ' ' + f.parts + ' parts ' + f.s + ' s').join(', ') + ' — avg ' + avg.toFixed(2) + ' s');
      check('visible: fast scrolling — starts only in view, no working agent outside it', under.length === 0 && v.offAgents === 0 && v.offTasks === 0,
        starts.length + ' starts, ' + under.length + ' under ' + Math.round(thr * 100) + ' %, agents outside ' + v.offAgents + ', tasks out of view ' + v.offTasks);
      await page.evaluate(() => window.SwarmRebuild.goLive()).catch(() => {});
      await page.waitForTimeout(200);
      const g = await page.evaluate(gone);
      check('visible: fast scrolling run ends with the original DOM, no errors', isFinished(g, baseDom) && !bag.length && !bag.fallbacks.length, 'root ' + g.root + ', hide ' + g.hide + ', reveal ' + g.reveal + ', DOM ' + (g.dom === baseDom ? 'same' : 'differs at …' + JSON.stringify(g.dom.slice(Math.max(0, firstDiff(baseDom, g.dom) - 80), firstDiff(baseDom, g.dom) + 60))) + ' ' + (bag.concat(bag.fallbacks)).slice(0, 3).join(' | '));
      await ctx.close();
      try {
        execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
        if (shots >= 4) {
          const out = path.join(OUT, 'sheet-visible.jpg');
          execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-pattern_type', 'glob', '-i', path.join(dir, 'v*.png'), '-vf', 'scale=' + (MOBILE ? 260 : 480) + ':-1,tile=4x' + Math.ceil(shots / 4) + ':padding=4:color=white', '-frames:v', '1', out], { timeout: 60000 });
          report.visible.sheet = out;
        }
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (e) { console.log('(visible contact sheet skipped: ' + (e.message || e).toString().split('\n')[0] + ')'); }
    }
  }

  if (CHECKS.has('text')) {
    // ---------- typing in any language: never splits a character, caret on the right side
    const { ctx, page, bag } = await openEffect('scroll', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      const seg = window.Intl && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
      const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/, LTR = /[A-Za-zÀ-ɏͰ-ԯ぀-ヿ㐀-鿿가-힯]/;
      const v = window.__txt = { frames: 0, cuts: 0, splits: 0, ex: [], carets: 0, caretBad: 0, cex: [], rtlCarets: 0, scripts: {} };
      const rng = document.createRange();
      (function f() {
        const root = document.getElementById('swarm-rebuild-root');
        const R = window.SwarmRebuild;
        if (root && R && R.state().phase === 'build') {
          v.frames++;
          // typed texts: split ones (typed text node + <sr-r> rest) and right-to-left ones whose rest is a CSS highlight range
          const items = [];
          root.querySelectorAll('sr-r').forEach((r) => { const n = r.previousSibling; if (n && n.nodeType === 3) items.push({ n, k: n.data.length, full: n.data + r.textContent, par: r.parentNode }); });
          const hl = window.CSS && CSS.highlights && CSS.highlights.get('sr-rest');
          if (hl) hl.forEach((h) => { const n = h.startContainer; if (n && n.nodeType === 3 && root.contains(n)) items.push({ n, k: h.startOffset, full: n.data, par: n.parentNode }); });
          items.forEach((it) => {
            if (!it.k || it.k >= it.full.length) return; // nothing typed yet / typed completely: no cut
            v.cuts++;
            const full = it.full, k = it.k;
            if (/[؀-ۿ]/.test(full)) v.scripts.arabic = 1; if (/[֐-׿]/.test(full)) v.scripts.hebrew = 1;
            if (/[぀-ヿ一-鿿]/.test(full)) v.scripts.cjk = 1; if (/[\u{1F300}-\u{1FAFF}]/u.test(full)) v.scripts.emoji = 1; if (/[őűŐŰ]/.test(full)) v.scripts.hungarian = 1;
            let ok = true;
            if (seg) { ok = false; for (const s of seg.segment(full)) { if (s.index === k) { ok = true; break; } if (s.index > k) break; } }
            else { const c = full.charCodeAt(k - 1); ok = !(c >= 0xD800 && c <= 0xDBFF); }
            if (!ok) { v.splits++; if (v.ex.length < 4) v.ex.push(JSON.stringify(full.slice(Math.max(0, k - 3), k) + '|' + full.slice(k, k + 3))); }
          });
          if (hl) v.hlMode = (v.hlMode || 0) + 1;
          // caret: next to the last typed character of the text being typed, on its writing side
          const moving = v.lastY !== scrollY; v.lastY = scrollY; // (mid-scroll the caret of this frame may still be from the last one)
          if (!moving) root.querySelectorAll('.sr-caret').forEach((c) => {
            const m = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec(c.style.transform || '');
            if (!m) return;
            const cx = parseFloat(m[1]) - scrollX, cy = parseFloat(m[2]) - scrollY;
            // the typed text whose end is nearest to the caret (several texts can be typed on one line at once)
            let best = null;
            items.forEach((it) => {
              if (!it.k && it.par) {
                // nothing typed yet: the caret waits at the start edge of the text
                const pr = it.par.getBoundingClientRect(), rtl0 = getComputedStyle(it.par).direction === 'rtl';
                if (Math.abs(pr.top - cy) <= 4) { const want = rtl0 ? pr.right - 3 : pr.left + 1, d = Math.abs(cx - want); if (!best || d < best.d) best = { d, ch: '(start)', rtl: rtl0, want }; }
                return;
              }
              const typed = it.full.slice(0, it.k), e = it.k, s0 = seg ? (() => { let st = 0; for (const s of seg.segment(typed)) st = s.index; return st; })() : e - 1;
              rng.setStart(it.n, s0); rng.setEnd(it.n, e); const rc = rng.getBoundingClientRect();
              if (Math.abs(rc.top - cy) > 4) return;
              const ch = typed.slice(s0), rtl = RTL.test(ch) ? true : LTR.test(ch) ? false : getComputedStyle(it.n.parentNode).direction === 'rtl';
              const want = rtl ? rc.left - 3 : rc.right + 1, d = Math.abs(cx - want);
              if (!best || d < best.d) best = { d, ch, rtl, want };
            });
            if (!best) return;
            v.carets++;
            if (best.rtl) v.rtlCarets++;
            if (best.d > 4) { v.caretBad++; if (v.cex.length < 3) v.cex.push(best.ch + ' caret ' + Math.round(cx) + ' want ' + Math.round(best.want)); }
          });
        }
        if (!R || R.state().phase !== 'idle') requestAnimationFrame(f);
      })();
    });
    await readDown(page, 0.35, 500, 90000);
    const v = await page.evaluate(() => window.__txt);
    report.text = v;
    check('text: typing never splits a character (grapheme clusters: accents, emoji, flags, Arabic, CJK)', v.cuts > 0 && v.splits === 0,
      v.frames + ' frames, ' + v.cuts + ' typed / untyped cuts checked, scripts seen: ' + (Object.keys(v.scripts).join(', ') || 'latin') + (v.splits ? ', split: ' + v.ex.join(' ') : ''));
    check('text: the caret sits after the last typed character, on its writing side', v.carets > 0 && v.caretBad === 0,
      v.carets + ' caret samples (' + v.rtlCarets + ' right-to-left), off ' + v.caretBad + (v.cex.length ? ': ' + v.cex.join('; ') : ''));
    await page.evaluate(() => window.SwarmRebuild.goLive()).catch(() => {});
    await page.waitForTimeout(300);
    const g = await page.evaluate(gone);
    check('text: run ends with the original DOM, no layout shift, no errors', isFinished(g, baseDom) && g.cls < 0.01 && !bag.length && !bag.fallbacks.length, 'CLS ' + (g.cls || 0).toFixed(4) + ' ' + (bag.concat(bag.fallbacks)).slice(0, 3).join(' | '));
    await ctx.close();
  }

  if (CHECKS.has('a11y')) {
    report.a11y = {};
    // ---------- search engines render with JavaScript: they must get the finished page
    for (const [bot, ua] of [['Googlebot', 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.204 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'], ['Bingbot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/131.0.0.0 Safari/537.36']]) {
      const ctx = await newCtx({ userAgent: ua });
      const page = await ctx.newPage();
      await page.goto(args.url, { waitUntil: 'load' });
      await page.waitForTimeout(500);
      const x = await page.evaluate(() => ({ hide: !!document.getElementById('swarm-rebuild-hide'), root: !!document.getElementById('swarm-rebuild-root'), dom: document.body.outerHTML, vis: Array.from(document.body.querySelectorAll('*')).map((e) => getComputedStyle(e).visibility.charAt(0)).join(''), st: window.SwarmRebuild ? window.SwarmRebuild.state().phase : 'none' }));
      const wrong = [...x.vis].filter((c, k) => c !== baseVis[k]).length;
      check('seo: ' + bot + ' gets the finished page at once (nothing hidden, DOM identical)', !x.hide && !x.root && domSame(x.dom, baseDom) && wrong === 0, 'hiding style ' + x.hide + ', overlay ' + x.root + ', elements with another visibility ' + wrong + ', module ' + x.st);
      await ctx.close();
    }
    // ---------- during the build: overlay hidden from assistive technology, nothing focusable in it, a status message
    {
      const { ctx, page } = await openEffect('scroll', { after: 0.6 });
      const x = await page.evaluate(() => {
        const r = document.getElementById('swarm-rebuild-root'), m = document.getElementById('swarm-rebuild-root-status');
        // (copies of page parts inside the overlay are inert: not focusable, not in the accessibility tree)
        const foc = r ? Array.from(r.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"]),[contenteditable]')).filter((e) => !e.closest('[inert]')).length : -1;
        return { aria: r && r.getAttribute('aria-hidden'), foc, role: m && m.getAttribute('role'), text: m ? m.textContent : '', inBody: !!(m && document.body.contains(m)), lang: document.documentElement.lang, phase: window.SwarmRebuild.state().phase };
      });
      report.a11y.status = x.text;
      check('a11y: the overlay is aria-hidden and holds nothing focusable', x.aria === 'true' && x.foc === 0, 'aria-hidden ' + x.aria + ', focusable inside ' + x.foc);
      check('a11y: screen readers get a status message while the page is hidden (outside <body>)', x.phase === 'build' && x.role === 'status' && x.text.length > 10 && !x.inBody, '[' + (x.lang || '?') + '] "' + x.text + '"');
      await ctx.close();
    }
    // ---------- the first Tab moves the focus where it would without the effect, the focused part is shown at once, the build goes on
    {
      const bc = await newCtx();
      const bp2 = await bc.newPage();
      await bp2.goto(withParams(args.url, { rebuild: '0' }), { waitUntil: 'load' });
      await bp2.waitForTimeout(300);
      await bp2.keyboard.press('Tab');
      const want = await bp2.evaluate(() => { const e = document.activeElement; return e && e !== document.body ? e.outerHTML.slice(0, 120) : 'body'; });
      await bc.close();
      const { ctx, page } = await openEffect('scroll', { after: 0.8 });
      const s0 = await page.evaluate(STATE);
      await page.keyboard.press('Tab');
      await page.waitForTimeout(150);
      const got = await page.evaluate(() => { const e = document.activeElement; return { el: e && e !== document.body ? e.outerHTML.slice(0, 120) : 'body', vis: e ? getComputedStyle(e).visibility : '', st: window.SwarmRebuild.state() }; });
      check('a11y: the first Tab lands where it would without the effect (no focus trap), the focused part is visible at once, the build goes on',
        s0.phase === 'build' && (got.st.phase === 'build' || got.st.phase === 'done') && got.el.replace(/ style="[^"]*"/, '') === want.replace(/ style="[^"]*"/, '') && (got.el === 'body' || got.vis === 'visible'),
        'focus on ' + got.el.slice(0, 70) + (got.el === want ? ' (same as without the effect)' : ' (without the effect: ' + want.slice(0, 70) + ')') + ', ' + got.vis + ', effect ' + got.st.phase);
      // keyboard users can always leave: Esc
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      const aft = await page.evaluate(() => ({ st: window.SwarmRebuild.state(), msg: !!document.getElementById('swarm-rebuild-root-status'), hide: !!document.getElementById('swarm-rebuild-hide') }));
      check('a11y: Esc then shows the whole page; the status message is gone afterwards', aft.st.phase === 'idle' && !aft.msg && !aft.hide, 'effect ' + aft.st.phase + ' (' + (aft.st.lastExit || '') + ')');
      await ctx.close();
    }
  }

  if (CHECKS.has('manual')) {
    // ---------- the visitor takes over: debug tour interrupted by scrolling, then scroll mode (no flag)
    report.manual = {};
    for (const startMode of ['tour', 'scroll']) {
      const label = startMode === 'tour' ? 'manual (debug tour, then wheel)' : 'manual (scroll mode)';
      const { ctx, page, bag, st } = await openEffect(startMode, { after: startMode === 'tour' ? 1.5 : 0.8 });
      const hudSamples = [];
      const sampleHud = async () => { const h = await page.evaluate(hudOverlapProbe).catch(() => null); if (h) hudSamples.push(h); };
      await sampleHud();
      const before = await st();
      await page.mouse.wheel(0, Math.round(VH * 0.6));
      await page.waitForTimeout(250);
      const afterWheel = await st();
      if (startMode === 'tour') check(label + ': scrolling by hand stops the tour', before.touring === true && afterWheel.touring === false, 'touring ' + before.touring + ' -> ' + afterWheel.touring);
      // read down the page in steps of half a viewport
      const r = await readDown(page, 0.5, 450, 60000, sampleHud);
      const fin = await st();
      check(label + ': run reaches the end', fin.phase === 'done' || fin.phase === 'idle', 'phase ' + fin.phase + ', ' + (fin.layersDone || 0) + '/' + (fin.layersTotal || 0) + ' layers, ' + r.steps + ' wheel steps');
      const maxAhead = fin.maxAhead != null ? fin.maxAhead : r.s.maxAhead;
      check(label + ': never starts anything below the view', maxAhead != null && maxAhead <= 0, 'lowest start ' + maxAhead + ' viewport heights below the bottom edge (negative: inside the view)');
      const w = fin.waits || r.s.waits;
      check(label + ': empty layers scrolled into view start quickly (avg <= 1.0 s, max <= 3.0 s)', !w || (w.avg <= 1.0 && w.max <= 3.0), w ? 'n=' + w.n + ' avg ' + w.avg + ' s, max ' + w.max + ' s' : 'no layer came into view empty');
      if (startMode === 'tour') {
        const overl = hudSamples.filter((h) => h.hits.length);
        const outside = hudSamples.filter((h) => !h.inside);
        check(label + ': control bar never covers fixed bars' + (MOBILE ? ', phone links or buttons' : ''), hudSamples.length > 0 && overl.length === 0,
          hudSamples.length + ' samples' + (overl.length ? ', covered: ' + overl[0].hits.join(', ') + ' at ' + overl[0].rect.join(',') : ''));
        check(label + ': control bar stays inside the viewport', outside.length === 0, outside.length ? 'outside at ' + outside[0].rect.join(',') : '');
      }
      await page.evaluate(() => window.SwarmRebuild.goLive());
      await page.waitForTimeout(300);
      const after = await page.evaluate(gone);
      domCheck(label + ': DOM identical to original afterwards', after.dom, baseDom);
      check(label + ': no layout shift (CLS < 0.01)', after.cls < 0.01, 'CLS ' + after.cls.toFixed(4));
      check(label + ': no page errors or console errors', bag.length === 0, bag.slice(0, 3).join(' | '));
      check(label + ': no safety fallback was needed', bag.fallbacks.length === 0, bag.fallbacks.slice(0, 2).join(' | '));
      report.manual[startMode] = { steps: r.steps, maxAhead, waits: w || null, seenManual: (fin.seen && fin.seen.manual) || null, hudSamples: hudSamples.length, cls: after.cls, elapsed: fin.elapsed };
      await ctx.close();
    }
  }
  if (CHECKS.has('motion')) {
    report.motion = {};
    const med = (a) => { a = a.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };
    const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    const r3 = (x) => x == null ? null : +x.toFixed(3);
    // in the page: the motion of every frame for ms milliseconds (debug add-on)
    const sample = (page, ms) => page.evaluate((ms) => new Promise((res) => {
      const out = [], t0 = performance.now();
      (function f() {
        const R = window.SwarmRebuild, m = R && R._motion && R._motion(true);
        if (m) out.push({ t: m.t, phase: m.phase, a: m.agents, o: m.orbit });
        if (performance.now() - t0 < ms) requestAnimationFrame(f); else res(out);
      })();
    }), ms);
    // per agent: positions over time -> speeds (px/s)
    const speeds = (frames, i) => { const v = []; for (let k = 1; k < frames.length; k++) { const a = frames[k - 1].a[i], b = frames[k].a[i], dt = frames[k].t - frames[k - 1].t; if (a && b && dt > 0.004) v.push(Math.hypot(b.x - a.x, b.y - a.y) / dt); } return v; };
    const cv = (v) => { const m = mean(v); if (!m) return 0; return Math.sqrt(mean(v.map((x) => (x - m) * (x - m)))) / m; };

    // ---------- the opening: swarms around the focus element, speeds not constant, not a perfect circle
    {
      const { ctx, page, bag } = await openEffect('tour', { params: { 'rebuild-speed': SPEED || '6' }, waitBuild: false, waitUntil: 'commit' });
      const fr = (await sample(page, 1400)).filter((f) => f.phase === 'scan');
      const s = await page.evaluate(STATE);
      const n = fr.length ? fr[0].a.length : 0;
      const cvs = [], radial = [];
      for (let i = 0; i < n; i++) cvs.push(cv(speeds(fr, i)));
      // distance of every swarm (its centre) from the focus, in orbit radii: on a perfect circle all would be equal
      fr.forEach((f) => {
        if (!f.o) return;
        const g = {};
        f.a.forEach((a) => { const c = g[a.sw] || (g[a.sw] = { x: 0, y: 0, n: 0 }); c.x += a.x; c.y += a.y; c.n++; });
        Object.values(g).forEach((c) => radial.push(Math.hypot((c.x / c.n - f.o.x) / f.o.rx, (c.y / c.n - f.o.y) / f.o.ry)));
      });
      const rm = mean(radial), rsd = rm ? Math.sqrt(mean(radial.map((x) => (x - rm) * (x - rm)))) : 0;
      const sizes = s.swarms || [];
      report.motion.opening = { frames: fr.length, agents: n, focus: s.focus && s.focus.open, swarms: sizes, speedCv: r3(med(cvs)), radialMean: r3(rm), radialSd: r3(rsd) };
      check('motion: opening — swarms of different sizes around the focus element (' + ((s.focus && s.focus.open && (s.focus.open.el || s.focus.open.src)) || '?') + ')',
        fr.length >= 8 && sizes.length >= (MOBILE ? 2 : 3) && new Set(sizes).size > 1 && rm > 0.5 && rm < 1.6,
        fr.length + ' frames, swarms ' + JSON.stringify(sizes) + ', mean distance ' + r3(rm) + ' orbit radii');
      check('motion: opening — speeds change (accelerate / slow down) and the path is not a perfect circle', med(cvs) > 0.15 && rsd > 0.1,
        'speed variation (CV) ' + r3(med(cvs)) + ', spread of the swarms\' distance to the focus ' + r3(rsd) + ' orbit radii');
      check('motion: opening — no errors', !bag.length && !bag.fallbacks.length, (bag.concat(bag.fallbacks)).slice(0, 3).join(' | '));
      await ctx.close();
    }

    // ---------- the finale: spring-like pull to the focus element (fast first, a little past it, back), then slow circling;
    // mouse play (desktop); gravity sag and task difficulty from the same run
    {
      const { ctx, page, bag } = await openEffect('tour', { params: { 'rebuild-speed': SPEED || '6' } });
      await page.waitForFunction(() => window.SwarmRebuild.state().phase === 'done', null, { timeout: 120000 }).catch(() => {});
      const fr = await sample(page, 3200);
      const s = await page.evaluate(STATE);
      const T0 = fr.length ? fr[0].t : 0;
      const over = [], peakAt = [], slow = [], gathered = [];
      const n = fr.length ? fr[0].a.length : 0;
      for (let i = 0; i < n; i++) {
        const a0 = fr[0].a[i]; if (!a0) continue;
        const D0 = Math.hypot(a0.tx - a0.x, a0.ty - a0.y);
        const v = speeds(fr, i);
        if (D0 > 150) {
          // how far it went past its place (along the way it came), relative to the way
          const ux = (a0.tx - a0.x) / D0, uy = (a0.ty - a0.y) / D0;
          let e = -1e9;
          fr.forEach((f) => { const a = f.a[i]; if (a && f.t - T0 < 1.5) e = Math.max(e, ((a.x - a.tx) * ux + (a.y - a.ty) * uy) / D0); });
          over.push(e);
          let pk = 0, pt = 0; v.forEach((x, k) => { if (x > pk) { pk = x; pt = fr[k + 1].t - T0; } });
          peakAt.push(pt);
          const late = v.filter((x, k) => fr[k + 1].t - T0 > 2);
          slow.push(pk ? mean(late) / pk : null);
        }
      }
      const last = fr[fr.length - 1];
      if (last && last.o) last.a.forEach((a) => gathered.push(Math.hypot((a.x - last.o.x) / last.o.rx, (a.y - last.o.y) / last.o.ry) < 1.8));
      const g = gathered.filter(Boolean).length / Math.max(1, gathered.length);
      report.motion.finale = { frames: fr.length, focus: s.focus && s.focus.done, pulled: over.length, overshoot: r3(med(over)), peakSpeedAt: r3(med(peakAt)), lateToPeakSpeed: r3(med(slow)), gathered: r3(g) };
      check('motion: finale — gathers around the focus element (' + ((s.focus && s.focus.done && (s.focus.done.el || s.focus.done.src)) || '?') + ')', g >= 0.8, Math.round(g * 100) + ' % of the agents within the orbit after 3 s');
      check('motion: finale — pulled in like a damped spring: fast at first, a little past the target, then slow',
        over.length === 0 || (med(over) > 0.02 && med(over) < 0.4 && med(peakAt) < 0.5 && med(slow) < 0.35),
        over.length + ' agents pulled from > 150 px: overshoot ' + Math.round((med(over) || 0) * 100) + ' % of the way, top speed after ' + r3(med(peakAt)) + ' s, speed after 2 s ' + Math.round((med(slow) || 0) * 100) + ' % of the top');

      // gravity: sag of horizontal moves, none for vertical ones (only moves that start from rest, so the carried-over
      // velocity does not count), never more than the cap
      const mo = await page.evaluate(() => window.SwarmRebuild._motion());
      const mv = mo.moves.filter((r) => r.done && r.v0 < 5);
      const hz = (r) => Math.abs(r.dx) / Math.hypot(r.dx, r.dy);
      const minH = Math.min(150, VW * 0.3); // a phone screen is narrow
      const H = mv.filter((r) => Math.abs(r.dx) > minH && hz(r) > 0.85), V = mv.filter((r) => Math.abs(r.dy) > 150 && hz(r) < 0.3);
      const Hh = H.filter((r) => r.w >= 0.5), Hl = H.filter((r) => r.w < 0.3);
      const maxDev = Math.max(0, ...mv.map((r) => r.devY));
      report.motion.gravity = { moves: mv.length, horizontal: H.length, vertical: V.length, sagHorizontal: r3(med(H.map((r) => r.devY / Math.abs(r.dx)))), sagHeavy: r3(med(Hh.map((r) => r.devY / Math.abs(r.dx)))), sagLight: r3(med(Hl.map((r) => r.devY / Math.abs(r.dx)))), sagVertical: r3(med(V.map((r) => r.devMax / Math.hypot(r.dx, r.dy)))), maxSagPx: maxDev, examples: H.slice(0, 4).map((r) => ({ dx: Math.round(r.dx), dy: Math.round(r.dy), weight: r.w, sagPx: r.devY })) };
      const G = report.motion.gravity;
      check('motion: gravity — horizontal moves bend downwards, vertical ones do not, capped at 56 px',
        (H.length < 3 || G.sagHorizontal > 0.02) && (V.length === 0 || G.sagVertical < 0.01) && maxDev <= 58,
        (H.length < 3 ? '(only ' + H.length + ' horizontal moves on this page, nothing to measure) ' : '') + H.length + ' horizontal moves: sag ' + Math.round(G.sagHorizontal * 1000) / 10 + ' % of the distance (heavy ' + (G.sagHeavy == null ? '—' : Math.round(G.sagHeavy * 1000) / 10 + ' %') + ', light ' + (G.sagLight == null ? '—' : Math.round(G.sagLight * 1000) / 10 + ' %') + '); ' + V.length + ' vertical: ' + (G.sagVertical == null ? '—' : Math.round(G.sagVertical * 1000) / 10 + ' %') + '; largest ' + maxDev + ' px');
      if (Hh.length >= 2 && Hl.length >= 2) check('motion: gravity — heavier elements bend more', G.sagHeavy > G.sagLight, 'heavy ' + G.sagHeavy + ' vs light ' + G.sagLight);

      // difficulty: bigger parts take longer (at most ~4x), 2x area ~1.6-1.8x near the average
      // (compared within one kind of task: a big box is quick by nature, a small text slower, which would hide the effect)
      const tk = mo.tasks.filter((x) => !x.warp && x.type === 'build');
      const rank = (a) => { const o = a.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]); const r = []; o.forEach((p, k) => { r[p[1]] = k; }); return r; };
      const spear = (xs, ys) => { const ra = rank(xs), rw = rank(ys), nn = xs.length; return 1 - 6 * ra.reduce((acc, x, i) => acc + (x - rw[i]) * (x - rw[i]), 0) / (nn * (nn * nn - 1)); };
      const kinds = {};
      tk.forEach((x) => { (kinds[x.kind] = kinds[x.kind] || []).push(x); });
      const per = [];
      Object.entries(kinds).forEach(([k, list]) => {
        if (list.length < 6) return;
        const by = list.slice().sort((p, q) => p.area - q.area), q3 = Math.max(2, Math.floor(list.length / 3));
        per.push({ kind: k, n: list.length, rho: +spear(list.map((x) => x.area), list.map((x) => x.work)).toFixed(3), big: +(med(by.slice(-q3).map((x) => x.work)) / med(by.slice(0, q3).map((x) => x.work))).toFixed(3), area: +(med(by.slice(-q3).map((x) => x.area)) / med(by.slice(0, q3).map((x) => x.area))).toFixed(1) });
      });
      const wsum = per.reduce((a, p) => a + p.n, 0);
      const rho = wsum ? per.reduce((a, p) => a + p.rho * p.n, 0) / wsum : null, qRatio = wsum ? per.reduce((a, p) => a + p.big * p.n, 0) / wsum : null;
      const dfs = mo.tasks.map((x) => x.df);
      report.motion.difficulty = { tasks: tk.length, spearman: r3(rho), bigToSmallWork: r3(qRatio), perKind: per, dfMin: Math.min(...dfs), dfMax: Math.max(...dfs), range: s.diff };
      check('motion: difficulty — bigger parts take longer, smaller ones less, at most ~4x apart',
        per.length > 0 && rho > 0.5 && qRatio > 1.3 && Math.max(...dfs) / Math.min(...dfs) <= 4.05,
        tk.length + ' tasks, same kind compared (' + per.map((p) => p.kind + ' ' + p.n + ': biggest third ' + p.area + 'x the area, ' + p.big + 'x the time').join('; ') + '): rank correlation ' + r3(rho) + ', difficulty ' + Math.min(...dfs) + '..' + Math.max(...dfs));

      if (!MOBILE) {
        // mouse: approach a swarm, rest, then move away slowly or fast. Dodge, follow for a while, never touch;
        // the faster the pointer leaves, the shorter they follow
        await page.waitForTimeout(800);
        const trial = async (speed) => {
          const m0 = await page.evaluate(() => window.SwarmRebuild._motion(true));
          const sx = await page.evaluate(() => [scrollX, scrollY]);
          const a = m0.agents[Math.floor(Math.random() * m0.agents.length)];
          const ax = a.x - sx[0], ay = a.y - sx[1];
          const cx = m0.orbit.x - sx[0], cy = m0.orbit.y - sx[1];
          let ux = ax - cx, uy = ay - cy; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul; // outwards
          const from = [Math.min(VW - 5, Math.max(5, ax + ux * 260)), Math.min(VH - 5, Math.max(5, ay + uy * 260))];
          await page.mouse.move(from[0], from[1]);
          const before = m0.follows.length;
          for (let k = 1; k <= 12; k++) { await page.mouse.move(lerpN(from[0], ax, k / 12), lerpN(from[1], ay, k / 12)); await page.waitForTimeout(16); }
          await page.waitForTimeout(450);
          // away (away from the orbit centre, along the screen if needed)
          let x = ax, y = ay, tEnd = Date.now() + (speed < 300 ? 2600 : 700);
          let dx = ux, dy = uy; if (Math.abs(dx) < 0.2 && Math.abs(dy) < 0.2) { dx = 1; dy = 0; }
          while (Date.now() < tEnd) {
            x += dx * speed * 0.016; y += dy * speed * 0.016;
            if (x < 5 || x > VW - 5) dx = -dx; if (y < 5 || y > VH - 5) dy = -dy;
            x = Math.min(VW - 5, Math.max(5, x)); y = Math.min(VH - 5, Math.max(5, y));
            await page.mouse.move(x, y); await page.waitForTimeout(16);
          }
          await page.waitForTimeout(1800);
          const m1 = await page.evaluate(() => window.SwarmRebuild._motion(true));
          // the pointer rests far away; agents that still follow give up by themselves
          return m1.follows.slice(before).filter((f) => f.dur > 0.05);
        };
        const lerpN = (p, q, k) => p + (q - p) * k;
        const slowF = [], fastF = [];
        for (let k = 0; k < 3; k++) { slowF.push(...await trial(120)); await page.waitForTimeout(1500); fastF.push(...await trial(1300)); await page.waitForTimeout(1500); }
        const m2 = await page.evaluate(() => window.SwarmRebuild._motion(true));
        const s2 = await page.evaluate(STATE);
        const ds = mean(slowF.map((f) => f.dur)), df = mean(fastF.map((f) => f.dur));
        report.motion.mouse = { dodges: m2.dodges, minDistance: m2.minD, slow: { follows: slowF.length, avgDur: r3(ds) }, fast: { follows: fastF.length, avgDur: r3(df) } };
        check('motion: mouse — agents dodge the pointer and never touch it (min. 36 px)', m2.dodges > 0 && m2.minD != null && m2.minD >= 35, m2.dodges + ' dodges, closest ' + m2.minD + ' px');
        check('motion: mouse — they follow it for a moment; shorter when it moves away faster',
          slowF.length >= 2 && fastF.length >= 2 && ds > df * 1.25,
          'slow (120 px/s): ' + slowF.length + ' follows, avg ' + r3(ds) + ' s; fast (1300 px/s): ' + fastF.length + ' follows, avg ' + r3(df) + ' s');
        check('motion: mouse — moving the pointer does not end the effect', s2.phase === 'done', s2.phase);
        const sp = await page.evaluate(EMPTY_SPOT);
        if (sp) await page.mouse.dblclick(sp.x, sp.y);
        await page.waitForTimeout(300);
        const s3 = await page.evaluate(STATE);
        check('motion: mouse — a double click on an empty spot afterwards ends it', s3.phase === 'idle' && /dbl/.test(s3.lastExit || ''), s3.phase + ' ' + (s3.lastExit || '') + (sp ? ' at ' + sp.x + ',' + sp.y + ' (' + sp.what + ')' : ', no empty spot found'));
      } else {
        check('motion: touch device — simpler motion, no mouse play', s.lite === true && s.mouseOn === false && (s.swarms || []).length <= 2, 'lite ' + s.lite + ', mouse ' + s.mouseOn + ', swarms ' + JSON.stringify(s.swarms));
      }
      check('motion: finale run — no errors', !bag.length && !bag.fallbacks.length, (bag.concat(bag.fallbacks)).slice(0, 3).join(' | '));
      await ctx.close();
    }

    // ---------- contact sheets of the opening and the finale, as visitors see them (scroll mode)
    try {
      execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
      const dir = path.join(OUT, 'motion');
      fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      const ctx = await newCtx();
      const page = await ctx.newPage();
      await page.goto(effectUrl('scroll'), { waitUntil: 'commit' });
      let i = 0; const t0 = Date.now();
      while (Date.now() - t0 < 2200 && i < 16) { try { await page.screenshot({ path: path.join(dir, 'o' + String(i).padStart(2, '0') + '.png') }); i++; } catch (e) { await page.waitForTimeout(30); } }
      await readDown(page, 0.5, 450, 90000);
      i = 0; const t1 = Date.now();
      while (Date.now() - t1 < 3000 && i < 16) { await page.screenshot({ path: path.join(dir, 'f' + String(i).padStart(2, '0') + '.png') }); i++; await page.waitForTimeout(110); }
      await ctx.close();
      const sheets = [];
      for (const k of ['o', 'f']) {
        const out = path.join(OUT, k === 'o' ? 'sheet-opening.jpg' : 'sheet-finale.jpg');
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-pattern_type', 'glob', '-i', path.join(dir, k + '*.png'), '-vf', 'scale=' + (MOBILE ? 260 : 480) + ':-1,tile=4x4:padding=4:color=white', '-frames:v', '1', out], { timeout: 60000 });
        sheets.push(out);
      }
      fs.rmSync(dir, { recursive: true, force: true });
      report.motion.sheets = sheets;
    } catch (e) {
      console.log('(motion contact sheets skipped: ' + (e.message || e).toString().split('\n')[0] + ')');
    }
  }

  await browser.close();
  browser = null;

  // ---------- contact sheets (ffmpeg)
  if (CHECKS.has('record')) {
    try {
      execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
      const frames = timeline.filter((s) => s.frame && fs.existsSync(path.join(OUT, 'frames', s.frame)));
      const pick = (secs) => secs.map((t) => (frames.find((s) => s.wall >= t) || frames[frames.length - 1])).filter(Boolean);
      const tStart = (frames[0] || { wall: 0 }).wall;
      const total = frames.length ? frames[frames.length - 1].wall - tStart : 0;
      const sheets = [];
      for (let k = 0; k < 3; k++) {
        const ts = Array.from({ length: 6 }, (_, j) => tStart + total * (k * 6 + j) / 18);
        const list = pick(ts);
        if (list.length < 6) break;
        const inputs = [];
        list.forEach((s) => inputs.push('-i', path.join(OUT, 'frames', s.frame)));
        const out = path.join(OUT, 'sheet-' + (k + 1) + '.jpg');
        const tw = MOBILE ? 300 : 640;
        const filt = list.map((_, j) => '[' + j + ':v]scale=' + tw + ':-2[v' + j + ']').join(';') + ';' + list.map((_, j) => '[v' + j + ']').join('') + 'xstack=inputs=6:layout=0_0|w0_0|0_h0|w0_h0|0_h0+h1|w0_h0+h1[o]';
        execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...inputs, '-filter_complex', filt, '-map', '[o]', out], { timeout: 60000 });
        sheets.push(out);
      }
      // side by side with the reference video at the same build-relative times (tour mode)
      if (args.video && MODE === 'tour') {
        const crop = args.crop || '930:500:90:690';
        const times = [0.3, 0.95, 1.3, 2.0, 5.0, 9.2, 12.5, 20, 27, 35, 45, 54];
        const scanStart = (timeline.find((s) => s.phase === 'scan' && s.frame) || {}).wall || 0;
        times.forEach((t, j) => {
          const mine = frames.find((s) => s.wall - scanStart >= t) || frames[frames.length - 1];
          const ref = path.join(OUT, 'ref-' + j + '.jpg');
          execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', String(t), '-i', args.video, '-vf', 'crop=' + crop + ',scale=640:-1', '-frames:v', '1', ref], { timeout: 60000 });
          execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', ref, '-i', path.join(OUT, 'frames', mine.frame), '-filter_complex', '[0:v]scale=640:344,setsar=1[a];[1:v]scale=640:400,setsar=1[b];[a][b]vstack=inputs=2', path.join(OUT, 'compare-' + String(j).padStart(2, '0') + '-' + t + 's.jpg')], { timeout: 60000 });
          fs.unlinkSync(ref);
        });
      }
      report.sheets = sheets;
    } catch (e) {
      console.log('(contact sheets skipped: ' + (e.message || e).toString().split('\n')[0] + ')');
    }
  }

  report.results = results;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log('\n' + (failed ? failed + ' check(s) failed' : 'all checks passed') + ' — report: ' + path.join(OUT, 'report.json'));
  if (report.elapsed) console.log('build time ' + report.elapsed.toFixed(1) + ' s, ' + report.layers + ' layers, ' + report.agentsEnd + ' agents, page ' + report.pageViewportHeights + ' viewport heights');
  clearTimeout(watchdog);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  try { if (browser) await browser.close(); } catch (x) { /* ignore */ }
  process.exit(1);
});
