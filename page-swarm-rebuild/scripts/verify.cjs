#!/usr/bin/env node
/*
 * verify.cjs — records and checks the swarm-rebuild effect on a page with Playwright.
 *
 *   node verify.cjs --url http://localhost:5500/ [--mode fast|tour|scroll] [--out ./swarm-check]
 *                   [--device desktop|mobile] [--viewport 1440x900] [--fps 10]
 *                   [--checks all|record|manual|all,manual] [--interact "<selector>"]
 *                   [--min-fps 50] [--timeout 300] [--video ref.mp4 --crop 930:500:90:690]
 *
 * Frame rate is measured in a separate run without screenshots. It depends on the machine: a cloud
 * container without a GPU reaches ~46 fps with the demo where a normal laptop reaches ~59, so lower
 * --min-fps there and compare with the same machine's earlier numbers instead.
 *
 * Needs the `playwright` package (resolved from the script dir, the cwd, NODE_PATH or a global install)
 * and a Chromium for it. ffmpeg is optional (contact sheets).
 *
 * --checks
 *   record   one recorded run in --mode: timeline, final state, fps, console errors, instant elements
 *   all      record + reduced motion, Esc, ✕, Replay, no-JS
 *   manual   visitor takes over: a tour run interrupted by wheel scrolling, then a scroll-mode run.
 *            Checks that the tour stops, the build follows the viewport (never more than 0.5 viewport
 *            below it), empty layers scrolled into view start quickly, the run still ends with the
 *            original DOM, and the control bar never covers fixed bars (and, on mobile, phone links,
 *            buttons and button-like links).
 *   Combine with a comma: --checks all,manual
 *
 * Checks of the recorded run:
 *   timeline   frames at --fps with HUD text, layer/agent counters, scroll progress -> timeline.json
 *   final      after "Go live": body DOM identical to the page loaded with ?rebuild=0,
 *              full-page screenshot diff < 0.5 %, no overlay / styles left, CLS < 0.01
 *   fps        average fps and p95 frame time reported by the module (separate run, no screenshots)
 *   console    no page errors, console errors or hydration warnings
 *   instant    phone links and position:fixed elements are visible while the build runs
 *   interact   (--interact) clicking the selector after the effect changes its text (e.g. a React counter)
 *
 * Every run has a hard time limit (--timeout seconds, default 300): the script exits with code 3
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
if (!args.url) { console.error('usage: node verify.cjs --url <page url> [--mode fast|tour|scroll] [--device desktop|mobile] [--checks all|record|manual] [--out dir]'); process.exit(2); }
const MODE = args.mode || 'fast';
const OUT = path.resolve(args.out || 'swarm-check');
const MOBILE = args.device === 'mobile';
const [VW, VH] = String(args.viewport || (MOBILE ? '390x844' : '1440x900')).split('x').map(Number);
const FPS = Number(args.fps || 10);
const CHECKS = new Set(String(args.checks || 'all').split(','));
const DO_RECORD = CHECKS.has('all') || CHECKS.has('record');
const DO_EXTRA = CHECKS.has('all');
const DO_MANUAL = CHECKS.has('manual');
const TIMEOUT_S = Number(args.timeout || 300);
fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });

let browser = null;
const watchdog = setTimeout(async () => {
  console.error('FAIL verify.cjs hit its time limit (' + TIMEOUT_S + ' s), stopping');
  try { if (browser) await browser.close(); } catch (e) { /* ignore */ }
  process.exit(3);
}, TIMEOUT_S * 1000);

function withParams(url, extra) {
  const u = new URL(url);
  Object.entries(extra).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
}
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); }
function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++; // bounded: stops at the shorter string
  return i;
}
function domCheck(name, dom, baseDom) {
  const same = dom === baseDom;
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
  });
}

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

(async () => {
  const { chromium } = loadPlaywright();
  browser = await chromium.launch();
  const newCtx = (o = {}) => browser.newContext(Object.assign(
    { viewport: { width: VW, height: VH }, deviceScaleFactor: 1 },
    MOBILE ? { isMobile: true, hasTouch: true } : {}, o));
  const report = { url: args.url, mode: MODE, device: MOBILE ? 'mobile' : 'desktop', viewport: [VW, VH], checks: [...CHECKS] };

  // ---------- baseline (effect disabled)
  const base = await newCtx();
  const bp = await base.newPage();
  await bp.goto(withParams(args.url, { rebuild: '0' }), { waitUntil: 'load' });
  await bp.waitForTimeout(600);
  const baseDom = await bp.evaluate(() => document.body.outerHTML);
  const baseShot = await bp.screenshot({ fullPage: true, caret: 'initial' });
  fs.writeFileSync(path.join(OUT, 'baseline.png'), baseShot);
  const docInfo = await bp.evaluate(() => ({ h: document.documentElement.scrollHeight, vh: innerHeight }));
  report.pageViewportHeights = +(docInfo.h / docInfo.vh).toFixed(2);
  await base.close();

  let timeline = [];
  if (DO_RECORD) {
    // ---------- recorded run
    const ctx = await newCtx();
    await ctx.addInitScript(CLS_INIT);
    const page = await ctx.newPage();
    const consoleBag = [];
    watchConsole(page, consoleBag);
    const t0 = Date.now();
    await page.goto(withParams(args.url, { rebuild: '1', 'rebuild-mode': MODE }), { waitUntil: 'domcontentloaded' });
    let doneAt = null, i = 0, instantChecked = false;
    const maxMs = (MODE === 'tour' ? 120 : 60) * 1000;
    while (Date.now() - t0 < maxMs) {
      const tick = Date.now();
      const s = await page.evaluate(() => window.SwarmRebuild ? window.SwarmRebuild.state() : { phase: 'not-loaded' }).catch(() => ({ phase: 'err' }));
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
      // scroll mode is driven by the visitor: simulate someone reading down the page
      if (MODE === 'scroll' && s.phase === 'build' && i % Math.max(1, Math.round(FPS / 2)) === 0) await page.mouse.wheel(0, Math.round(VH * 0.35));
      if (s.phase === 'done' && doneAt == null) doneAt = Date.now();
      if (doneAt && Date.now() - doneAt > 3500) break;
      if (s.phase === 'idle' && timeline.length > 5) break;
      const wait = 1000 / FPS - (Date.now() - tick);
      if (wait > 0) await page.waitForTimeout(wait);
    }
    fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify(timeline, null, 1));
    const doneState = timeline.find((s) => s.phase === 'done');
    check('effect ran to the end', !!doneState, doneState ? doneState.hud : 'last phase: ' + (timeline[timeline.length - 1] || {}).phase);
    if (doneState) {
      report.elapsed = doneState.elapsed;
      report.layers = doneState.layersTotal;
      report.agentsEnd = doneState.agents;
      check('HUD final text', /Rebuilt by \d+ agents in [\d.]+s/.test(doneState.hud) && /Go live/.test(doneState.hud) && /Replay/.test(doneState.hud), doneState.hud);
    }
    const firstBuild = timeline.find((s) => s.phase === 'build');
    const scanStates = timeline.filter((s) => s.phase === 'scan');
    check('scan phase with "Scanning page…"', scanStates.some((s) => /Scanning page/.test(s.hud)), scanStates.length + ' samples');
    if (firstBuild) check('build HUD shows agents + layers', /\d+ agents/.test(firstBuild.hud) && /\d+ \/ \d+ layers/.test(firstBuild.hud), firstBuild.hud);
    let mono = true, prev = -1;
    timeline.forEach((s) => { if (s.layersDone != null) { if (s.layersDone < prev) mono = false; prev = s.layersDone; } });
    check('layer counter never decreases', mono);
    if (MODE !== 'scroll') {
      const b = timeline.filter((s) => s.phase === 'build' || s.phase === 'done');
      const T = doneState ? doneState.elapsed : 1;
      const pts = [0.08, 0.2, 0.4, 0.6, 0.8, 0.98].map((f) => {
        const s = b.find((x) => x.buildT >= f * T) || b[b.length - 1];
        return { at: f, progress: s ? +s.scrollProgress.toFixed(2) : null };
      });
      report.scrollCurve = pts;
      const last = timeline[timeline.length - 1];
      const scrollable = report.pageViewportHeights > 1.02;
      check('auto-scroll ends at the bottom', !scrollable || (last && last.scrollProgress > 0.98), scrollable ? 'progress ' + (last && last.scrollProgress.toFixed(3)) : 'page fits in one viewport');
      const increasing = pts.every((p, k) => k === 0 || p.progress >= pts[k - 1].progress - 0.01);
      check('auto-scroll progress is monotonic', increasing, JSON.stringify(pts));
    }
    report.fpsWhileRecording = await page.evaluate(() => window.SwarmRebuild.stats());

    // ---------- final state after Go live
    const live = await page.$('#swarm-rebuild-root .sr-live');
    if (live && await live.isVisible()) await live.click(); else await page.evaluate(() => window.SwarmRebuild.goLive());
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({
      dom: document.body.outerHTML,
      root: !!document.getElementById('swarm-rebuild-root'),
      styles: !!document.getElementById('swarm-rebuild-hide') || !!document.getElementById('swarm-rebuild-reveal'),
      cls: window.__cls
    }));
    domCheck('DOM identical to original after the effect', after.dom, baseDom);
    check('overlay and styles removed', !after.root && !after.styles);
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
    await ctx.close();

    // ---------- frame rate: a separate run without screenshots (taking frames costs fps by itself)
    const fc = await newCtx();
    const fp = await fc.newPage();
    await fp.goto(withParams(args.url, { rebuild: '1', 'rebuild-mode': MODE }), { waitUntil: 'domcontentloaded' });
    const fEnd = Date.now() + maxMs;
    let fs2 = { phase: 'scan' }, wheel = 0;
    while (Date.now() < fEnd) {
      fs2 = await fp.evaluate(() => window.SwarmRebuild ? window.SwarmRebuild.state() : { phase: 'not-loaded' }).catch(() => ({ phase: 'err' }));
      if (fs2.phase === 'done' || (fs2.phase === 'idle' && wheel > 5)) break;
      if (MODE === 'scroll' && fs2.phase === 'build') { await fp.mouse.wheel(0, Math.round(VH * 0.35)); wheel++; }
      await fp.waitForTimeout(500);
    }
    report.fps = await fp.evaluate(() => window.SwarmRebuild.stats()).catch(() => null);
    report.fpsRunElapsed = fs2.elapsed || null;
    const MIN_FPS = Number(args['min-fps'] || 50);
    check('frame rate >= ' + MIN_FPS + ' fps (module-measured during build, no screenshots)', report.fps && report.fps.avgFps >= MIN_FPS, JSON.stringify(report.fps));
    await fc.close();
  }

  if (DO_EXTRA) {
    // ---------- reduced motion
    const rc = await newCtx({ reducedMotion: 'reduce' });
    const rp = await rc.newPage();
    await rp.goto(args.url, { waitUntil: 'load' });
    await rp.waitForTimeout(500);
    const r = await rp.evaluate(() => ({ root: !!document.getElementById('swarm-rebuild-root'), hide: !!document.getElementById('swarm-rebuild-hide'), vis: getComputedStyle(document.querySelector('h1,h2,p') || document.body).visibility }));
    check('prefers-reduced-motion skips the effect', !r.root && !r.hide && r.vis === 'visible');
    await rc.close();

    // ---------- Esc and ✕
    for (const how of ['Escape', 'close']) {
      const c = await newCtx();
      const p = await c.newPage();
      await p.goto(withParams(args.url, { rebuild: '1', 'rebuild-mode': 'tour' }), { waitUntil: 'load' });
      await p.waitForTimeout(2500);
      if (how === 'Escape') await p.keyboard.press('Escape');
      else {
        // the bar may start collapsed (narrow gutter / mobile): open it first, as a visitor would
        const tab = await p.$('#swarm-rebuild-root .sr-hud.sr-collapsed .sr-tab');
        if (tab) { await tab.click(); await p.waitForTimeout(150); }
        await p.click('#swarm-rebuild-root .sr-close', { timeout: 5000 });
      }
      await p.waitForTimeout(150);
      const s = await p.evaluate(() => ({ root: !!document.getElementById('swarm-rebuild-root'), hide: !!document.getElementById('swarm-rebuild-hide'), dom: document.body.outerHTML }));
      check((how === 'Escape' ? 'Esc' : '✕ button') + ' shows the finished page immediately', !s.root && !s.hide && s.dom === baseDom);
      await c.close();
    }

    // ---------- Replay
    const pc = await newCtx();
    const pp = await pc.newPage();
    await pp.goto(withParams(args.url, { rebuild: '1', 'rebuild-mode': 'fast' }), { waitUntil: 'load' });
    await pp.waitForFunction(() => window.SwarmRebuild && window.SwarmRebuild.state().phase === 'done', null, { timeout: 60000 });
    const tab2 = await pp.$('#swarm-rebuild-root .sr-hud.sr-collapsed .sr-tab');
    if (tab2) { await tab2.click(); await pp.waitForTimeout(150); }
    await pp.click('#swarm-rebuild-root .sr-replay', { timeout: 5000 });
    await pp.waitForTimeout(80);
    const rs = await pp.evaluate(() => ({ s: window.SwarmRebuild.state(), y: scrollY }));
    check('Replay restarts from the top with a new scan', rs.s.phase === 'scan' && rs.y === 0 && /Scanning page/.test(rs.s.hud), rs.s.phase + ' y=' + rs.y);
    await pc.close();

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

  if (DO_MANUAL) {
    // ---------- the visitor takes over: tour interrupted by scrolling, then scroll mode
    report.manual = {};
    for (const startMode of ['tour', 'scroll']) {
      const label = startMode === 'tour' ? 'manual (tour, then wheel)' : 'manual (scroll mode)';
      const ctx = await newCtx();
      await ctx.addInitScript(CLS_INIT);
      const page = await ctx.newPage();
      const consoleBag = [];
      watchConsole(page, consoleBag);
      await page.goto(withParams(args.url, { rebuild: '1', 'rebuild-mode': startMode }), { waitUntil: 'domcontentloaded' });
      const st = () => page.evaluate(() => window.SwarmRebuild ? window.SwarmRebuild.state() : { phase: 'not-loaded' }).catch(() => ({ phase: 'err' }));
      const hudSamples = [];
      const sampleHud = async () => { const h = await page.evaluate(hudOverlapProbe).catch(() => null); if (h) hudSamples.push(h); };
      await page.waitForFunction(() => window.SwarmRebuild && window.SwarmRebuild.state().phase === 'build', null, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(startMode === 'tour' ? 1500 : 800);
      await sampleHud();
      const before = await st();
      await page.mouse.wheel(0, Math.round(VH * 0.6));
      await page.waitForTimeout(250);
      const afterWheel = await st();
      if (startMode === 'tour') check(label + ': scrolling by hand stops the tour', before.touring === true && afterWheel.touring === false, 'touring ' + before.touring + ' -> ' + afterWheel.touring);
      // read down the page in steps of half a viewport
      let s = afterWheel, steps = 0;
      const tEnd = Date.now() + 60000;
      while (s.phase === 'build' && Date.now() < tEnd) {
        const atBottom = await page.evaluate(() => scrollY >= document.documentElement.scrollHeight - innerHeight - 2);
        if (!atBottom && steps < 80) { await page.mouse.wheel(0, Math.round(VH * 0.5)); steps++; }
        await page.waitForTimeout(450);
        await sampleHud();
        s = await st();
      }
      const last = s;
      const fin = await st();
      check(label + ': run reaches the end', fin.phase === 'done', 'phase ' + fin.phase + ', ' + (fin.layersDone || 0) + '/' + (fin.layersTotal || 0) + ' layers, ' + steps + ' wheel steps');
      const maxAhead = fin.maxAhead != null ? fin.maxAhead : last.maxAhead;
      check(label + ': never builds more than 0.5 viewport below the view', maxAhead != null && maxAhead <= 0.55, 'max ahead ' + maxAhead + ' viewport heights');
      const w = fin.waits || last.waits;
      check(label + ': empty layers scrolled into view start quickly (avg <= 1.0 s, max <= 3.0 s)', !w || (w.avg <= 1.0 && w.max <= 3.0), w ? 'n=' + w.n + ' avg ' + w.avg + ' s, max ' + w.max + ' s' : 'no layer came into view empty');
      const seen = fin.seen && fin.seen.manual;
      const overl = hudSamples.filter((h) => h.hits.length);
      const outside = hudSamples.filter((h) => !h.inside);
      check(label + ': control bar never covers fixed bars' + (MOBILE ? ', phone links or buttons' : ''), hudSamples.length > 0 && overl.length === 0,
        hudSamples.length + ' samples' + (overl.length ? ', covered: ' + overl[0].hits.join(', ') + ' at ' + overl[0].rect.join(',') : ''));
      check(label + ': control bar stays inside the viewport', outside.length === 0, outside.length ? 'outside at ' + outside[0].rect.join(',') : '');
      await page.evaluate(() => window.SwarmRebuild.goLive());
      await page.waitForTimeout(300);
      const after = await page.evaluate(() => ({ dom: document.body.outerHTML, cls: window.__cls, root: !!document.getElementById('swarm-rebuild-root') }));
      domCheck(label + ': DOM identical to original afterwards', after.dom, baseDom);
      check(label + ': no layout shift (CLS < 0.01)', after.cls < 0.01, 'CLS ' + after.cls.toFixed(4));
      check(label + ': no page errors or console errors', consoleBag.length === 0, consoleBag.slice(0, 3).join(' | '));
      report.manual[startMode] = { steps, maxAhead, waits: w || null, seenManual: seen || null, hudSamples: hudSamples.length, hudCovered: overl.length, cls: after.cls, elapsed: fin.elapsed };
      await ctx.close();
    }
  }
  await browser.close();
  browser = null;

  // ---------- contact sheets (ffmpeg)
  if (DO_RECORD) {
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
