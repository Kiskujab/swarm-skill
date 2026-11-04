#!/usr/bin/env node
/*
 * verify.cjs — records and checks the swarm-rebuild effect on a page with Playwright.
 *
 *   node verify.cjs --url http://localhost:5500/ [--mode fast|tour|scroll] [--out ./swarm-check]
 *                   [--viewport 1440x900] [--fps 10] [--checks all|record]
 *                   [--video ref.mp4 --crop 930:500:90:690]   (side-by-side contact sheets, tour mode)
 *
 * Needs the `playwright` package (resolved from the script dir, the cwd, or NODE_PATH)
 * and a Chromium for it (`npx playwright install chromium`). ffmpeg is optional (contact sheets).
 *
 * Checks:
 *   timeline   frames at --fps with HUD text, layer/agent counters, scroll progress -> timeline.json
 *   final      after "Go live": body DOM identical to the page loaded with ?rebuild=0,
 *              full-page screenshot diff < 0.5 %, no overlay / styles left, CLS ~ 0
 *   fps        average fps and p95 frame time reported by the module
 *   reduced    prefers-reduced-motion: no overlay, content visible immediately
 *   esc/close  Esc and the ✕ button show the finished page at once
 *   replay     "Replay" restarts from the top with "Scanning page…"
 *   nojs       with JavaScript disabled the page looks like the original
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createRequire } = require('module');

function loadPlaywright() {
  const tries = [__filename, path.join(process.cwd(), 'index.js')];
  for (const t of tries) { try { return createRequire(t)('playwright'); } catch (e) { /* next */ } }
  try { return require('playwright'); } catch (e) { /* fall through */ }
  console.error('Cannot find the "playwright" package. Install it: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const args = {};
process.argv.slice(2).forEach((a, i, arr) => { if (a.startsWith('--')) args[a.slice(2)] = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true; });
if (!args.url) { console.error('usage: node verify.cjs --url <page url> [--mode fast|tour|scroll] [--out dir]'); process.exit(2); }
const MODE = args.mode || 'fast';
const OUT = path.resolve(args.out || 'swarm-check');
const [VW, VH] = String(args.viewport || '1440x900').split('x').map(Number);
const FPS = Number(args.fps || 10);
const CHECKS = args.checks || 'all';
fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });

function withParams(url, extra) {
  const u = new URL(url);
  Object.entries(extra).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
}
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); }

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

(async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const newCtx = (o = {}) => browser.newContext(Object.assign({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 }, o));
  const report = { url: args.url, mode: MODE, viewport: [VW, VH] };

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

  // ---------- recorded run
  const ctx = await newCtx();
  await ctx.addInitScript(() => {
    window.__cls = 0;
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch (e) { /* ignore */ }
  });
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(withParams(args.url, { rebuild: '1', 'rebuild-mode': MODE }), { waitUntil: 'domcontentloaded' });
  const timeline = [];
  let doneAt = null, i = 0;
  const maxMs = (MODE === 'tour' ? 120 : 60) * 1000;
  while (Date.now() - t0 < maxMs) {
    const tick = Date.now();
    const s = await page.evaluate(() => window.SwarmRebuild ? window.SwarmRebuild.state() : { phase: 'not-loaded' }).catch(() => ({ phase: 'err' }));
    s.wall = (tick - t0) / 1000;
    if (CHECKS === 'all' || CHECKS === 'record') {
      const f = path.join(OUT, 'frames', 'f' + String(++i).padStart(4, '0') + '.jpg');
      await page.screenshot({ path: f, type: 'jpeg', quality: 70, caret: 'initial' });
      s.frame = path.basename(f);
    }
    timeline.push(s);
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
  // counters monotonic
  let mono = true, prev = -1;
  timeline.forEach((s) => { if (s.layersDone != null) { if (s.layersDone < prev) mono = false; prev = s.layersDone; } });
  check('layer counter never decreases', mono);
  // scroll curve (tour/fast)
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
  report.fps = await page.evaluate(() => window.SwarmRebuild.stats());
  check('frame rate >= 50 fps (module-measured during build)', report.fps && report.fps.avgFps >= 50, JSON.stringify(report.fps));

  // ---------- final state after Go live
  const live = await page.$('#swarm-rebuild-root .sr-live');
  if (live) await live.click(); else await page.evaluate(() => window.SwarmRebuild.goLive());
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    dom: document.body.outerHTML,
    root: !!document.getElementById('swarm-rebuild-root'),
    styles: !!document.getElementById('swarm-rebuild-hide') || !!document.getElementById('swarm-rebuild-reveal'),
    cls: window.__cls
  }));
  let di = 0; while (di < baseDom.length && baseDom[di] === after.dom[di]) di++;
  check('DOM identical to original after the effect', after.dom === baseDom, after.dom === baseDom ? '' : 'first difference: …' + JSON.stringify(after.dom.slice(Math.max(0, di - 60), di + 40)));
  check('overlay and styles removed', !after.root && !after.styles);
  check('no layout shift (CLS < 0.01)', after.cls < 0.01, 'CLS ' + after.cls.toFixed(4));
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(200);
  const afterShot = await page.screenshot({ fullPage: true, caret: 'initial' });
  fs.writeFileSync(path.join(OUT, 'after.png'), afterShot);
  const d1 = await pixelDiff(page, b64(baseShot), b64(afterShot));
  check('looks identical to original (< 0.5 % pixels differ)', d1.ratio < 0.005 && d1.sizeA[1] === d1.sizeB[1], (d1.ratio * 100).toFixed(3) + ' %');
  await ctx.close();

  if (CHECKS === 'all') {
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
      if (how === 'Escape') await p.keyboard.press('Escape'); else await p.click('#swarm-rebuild-root .sr-close');
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
    await pp.click('#swarm-rebuild-root .sr-replay');
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
    const cmp = await (await newCtx()).newPage();
    const d2 = await pixelDiff(cmp, b64(baseShot), b64(noJsShot));
    check('page visible without JavaScript', d2.ratio < 0.02, (d2.ratio * 100).toFixed(2) + ' % differs from the JS baseline');
  }
  await browser.close();

  // ---------- contact sheets (ffmpeg)
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    const frames = timeline.filter((s) => s.frame);
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
      const filt = list.map((_, j) => '[' + j + ':v]scale=640:-1[v' + j + ']').join(';') + ';' + list.map((_, j) => '[v' + j + ']').join('') + 'xstack=inputs=6:layout=0_0|w0_0|0_h0|w0_h0|0_h0+h1|w0_h0+h1[o]';
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...inputs, '-filter_complex', filt, '-map', '[o]', out]);
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
        execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', String(t), '-i', args.video, '-vf', 'crop=' + crop + ',scale=640:-1', '-frames:v', '1', ref]);
        execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', ref, '-i', path.join(OUT, 'frames', mine.frame), '-filter_complex', '[0:v]scale=640:344,setsar=1[a];[1:v]scale=640:400,setsar=1[b];[a][b]vstack=inputs=2', path.join(OUT, 'compare-' + String(j).padStart(2, '0') + '-' + t + 's.jpg')]);
        fs.unlinkSync(ref);
      });
    }
    report.sheets = sheets;
  } catch (e) {
    console.log('(contact sheets skipped: ' + (e.message || e).toString().split('\n')[0] + ')');
  }

  report.results = results;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log('\n' + (failed ? failed + ' check(s) failed' : 'all checks passed') + ' — report: ' + path.join(OUT, 'report.json'));
  if (report.elapsed) console.log('build time ' + report.elapsed.toFixed(1) + ' s, ' + report.layers + ' layers, ' + report.agentsEnd + ' agents, page ' + report.pageViewportHeights + ' viewport heights');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
