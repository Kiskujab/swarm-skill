#!/usr/bin/env node
/*
 * verify.cjs — records and checks the swarm-rebuild effect on a page with Playwright.
 *
 *   node verify.cjs --url http://localhost:5500/ [--mode scroll|fast|tour] [--speed 6] [--out ./swarm-check]
 *                   [--device desktop|mobile] [--viewport 1440x900] [--fps 10]
 *                   [--checks all|record|extra|product|protect|fixed|manual (comma list)]
 *                   [--interact "<selector>"] [--min-fps 50] [--timeout 400] [--video ref.mp4 --crop 930:500:90:690]
 *
 * --mode / --speed   the recorded run. scroll and fast are what visitors get (no control bar, the page follows
 *                    their scrolling, simulated here by reading down with the mouse wheel). tour is the debug
 *                    auto-scroll (?rebuild-debug=1); "--mode tour --speed 6" is the old "fast" baseline.
 * --checks
 *   record   one recorded run: timeline, final state, fps, console errors, instant elements
 *   extra    reduced motion, ✕ and Replay of the debug bar, no-JS
 *   product  what visitors get: no control bar / no auto-scroll without the flag, the flag shows the bar,
 *            default mode is scroll, Esc / any key / click / tap show the finished page at once without
 *            layout shift, a click on unfinished content does not navigate, a click on finished content works
 *   protect  the page is never left half hidden: everything scrolled above the view is final; an exception
 *            in a task, a stuck task, an exception in the frame loop, a dead script (CSS dead-man switch),
 *            a resize and a background tab all end with the whole page visible
 *   fixed    the overlay never draws over position:fixed elements (and finished sticky ones): pixel test
 *            at many moments of a visitor run (overlay shown vs. hidden, the module paused)
 *   manual   the visitor takes over: a debug tour interrupted by wheel scrolling, then a scroll-mode run
 *   all      record,extra,product,protect,fixed
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
if (CHECKS.has('all')) ['record', 'extra', 'product', 'protect', 'fixed'].forEach((c) => CHECKS.add(c));
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
function domSame(dom, baseDom) { return dom === baseDom; }
function domCheck(name, dom, baseDom) {
  const same = domSame(dom, baseDom);
  const di = same ? 0 : firstDiff(baseDom, dom);
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
const isFinished = (g, baseDom) => !g.root && !g.hide && !g.reveal && g.dom === baseDom;
// per-element visibility, in document order (the page loaded with the effect off is the reference)
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
    { viewport: { width: VW, height: VH }, deviceScaleFactor: 1 },
    MOBILE ? { isMobile: true, hasTouch: true } : {}, o));
  const report = { url: args.url, mode: MODE, speed: SPEED, device: MOBILE ? 'mobile' : 'desktop', viewport: [VW, VH], checks: [...CHECKS] };
  // opens a page with the effect; waits until the build runs (or the given phase)
  async function openEffect(mode, o = {}) {
    const ctx = await newCtx(o.ctx || {});
    await ctx.addInitScript(CLS_INIT);
    const page = await ctx.newPage();
    const bag = [];
    bag.fallbacks = [];
    watchConsole(page, bag);
    await page.goto(effectUrl(mode, o), { waitUntil: o.waitUntil || 'domcontentloaded' });
    if (o.waitBuild !== false) {
      await page.waitForFunction(() => window.SwarmRebuild && window.SwarmRebuild.state().phase === 'build', null, { timeout: 20000 }).catch(() => {});
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

  // ---------- baseline (effect disabled)
  const base = await newCtx();
  const bp = await base.newPage();
  await bp.goto(withParams(args.url, { rebuild: '0' }), { waitUntil: 'load' });
  await bp.waitForTimeout(600);
  const baseDom = await bp.evaluate(() => document.body.outerHTML);
  const baseVis = await bp.evaluate(VIS_MAP);
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
    let doneAt = null, i = 0, instantChecked = false;
    const maxMs = (MODE === 'tour' && !SPEED ? 120 : 75) * 1000;
    while (Date.now() - t0 < maxMs) {
      const tick = Date.now();
      const s = await page.evaluate(STATE).catch(() => ({ phase: 'err' }));
      s.wall = (tick - t0) / 1000;
      const f = path.join(OUT, 'frames', 'f' + String(++i).padStart(4, '0') + '.jpg');
      await page.screenshot({ path: f, type: 'jpeg', quality: 70, caret: 'initial' }).catch(() => {});
      s.frame = path.basename(f);
      timeline.push(s);
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
    const noJsShot = await np.screenshot({ fullPage: true, caret: 'initial' });
    fs.writeFileSync(path.join(OUT, 'nojs.png'), noJsShot);
    await nc.close();
    const cc = await newCtx();
    const cmp = await cc.newPage();
    const d2 = await pixelDiff(cmp, b64(baseShot), b64(noJsShot));
    check('page visible without JavaScript', d2.ratio < 0.02, (d2.ratio * 100).toFixed(2) + ' % differs from the JS baseline');
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
    // ---------- ways out: Esc, any key, click / tap; a lone modifier key does nothing
    const exits = [['Escape', 'Esc'], ['a', 'a letter key'], ['Tab', 'Tab']];
    for (const [key, label] of exits) {
      const { ctx, page } = await openEffect('scroll', { after: 1.2 });
      const s0 = await page.evaluate(STATE);
      if (key === 'a') { await page.keyboard.press('Shift'); await page.waitForTimeout(120); const s1 = await page.evaluate(STATE); check('product: a lone Shift does not end the effect', s1.phase === 'build', s1.phase); }
      await page.keyboard.press(key);
      await page.waitForTimeout(120);
      const g = await page.evaluate(gone);
      check('product: ' + label + ' shows the finished page at once, without layout shift', s0.phase === 'build' && isFinished(g, baseDom) && g.cls < 0.01, 'exit ' + (g.s && g.s.lastExit) + ', CLS ' + (g.cls || 0).toFixed(4));
      await ctx.close();
    }
    {
      // click (or tap) on content that is still hidden: no navigation, no action, finished page
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
      if (pt) { if (MOBILE) await page.touchscreen.tap(pt.x, pt.y); else await page.mouse.click(pt.x, pt.y); }
      else { if (MOBILE) await page.touchscreen.tap(VW / 2, VH / 2); else await page.mouse.click(VW / 2, VH / 2); }
      await page.waitForTimeout(700);
      const g = await page.evaluate(gone).catch(() => null);
      const sameUrl = page.url() === urlBefore;
      check('product: ' + (MOBILE ? 'a tap' : 'a click') + ' on unfinished content shows the page and does not navigate', g && isFinished(g, baseDom) && sameUrl && !popup && g.cls < 0.01,
        (pt ? 'hit the spot of hidden ' + pt.what : 'no hidden link in view, clicked the middle') + ', url ' + (sameUrl ? 'unchanged' : 'changed to ' + page.url()) + ', exit ' + (g && g.s && g.s.lastExit));
      await ctx.close();
    }
    if (args.interact) {
      // click on content that is already finished: the click goes through (and the effect ends)
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
      const g = await page.evaluate(gone);
      check('product: a click on finished content works and ends the effect (' + sel + ')', ok && s0.phase === 'build' && before !== now && !g.root && !g.hide, JSON.stringify(before) + ' -> ' + JSON.stringify(now) + ', was ' + s0.phase);
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
    const samples = [], covered = [];
    const sample = async () => {
      const targets = await page.evaluate(fixedTargets);
      if (!targets.length) return;
      await page.evaluate(() => window.SwarmRebuild._pause(true));
      await page.waitForTimeout(60);
      for (const t of targets) {
        if (t.clip.width < 2 || t.clip.height < 2) continue;
        const a = await page.screenshot({ clip: t.clip, caret: 'initial' }); // not animations:'disabled': it would fast-forward the safety timer
        await page.evaluate(() => { const r = document.getElementById('swarm-rebuild-root'); if (r) r.style.visibility = 'hidden'; });
        const b = await page.screenshot({ clip: t.clip, caret: 'initial' }); // not animations:'disabled': it would fast-forward the safety timer
        await page.evaluate(() => { const r = document.getElementById('swarm-rebuild-root'); if (r) r.style.visibility = ''; });
        const d = await pixelDiff(page, b64(a), b64(b));
        samples.push(t.name);
        if (d.ratio > 0.002) covered.push(t.name + ' ' + (d.ratio * 100).toFixed(2) + '%');
      }
      await page.evaluate(() => window.SwarmRebuild._pause(false));
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
      samples.length + ' samples of ' + (names.join(', ') || 'none') + (covered.length ? ', covered: ' + covered.slice(0, 3).join(', ') : ''));
    report.fixed = { samples: samples.length, elements: names, covered: covered.length };
    await page.evaluate(() => window.SwarmRebuild.goLive()).catch(() => {});
    await ctx.close();
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
      check(label + ': never builds more than 0.5 viewport below the view', maxAhead != null && maxAhead <= 0.55, 'max ahead ' + maxAhead + ' viewport heights');
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
