#!/usr/bin/env node
/*
 * bench-fps.cjs — frame rate of an older module version against the current one, on the same machine,
 * runs interleaved (old, new, old, new ...) so that machine load affects both alike.
 *
 *   node scripts/bench-fps.cjs [--old-ref v1.0.1 | --old <path to an old swarm-rebuild.js>]
 *                              [--pages demo,dental] [--devices desktop,mobile] [--reps 3] [--timeout 1800]
 *
 * Modes compared (old -> new):
 *   tour      auto-scroll at 1x                    old: mode tour     new: ?rebuild-debug=1, mode tour
 *   tour6     auto-scroll at 6x (the old "fast")   old: mode fast     new: ?rebuild-debug=1, mode tour, speed 6
 *   scroll    follows the visitor, 3x              old: mode scroll   new: mode scroll (no control bar)
 *   fast      follows the visitor, 6x (new only: the old "fast" was an auto-scroll)
 * Visitor modes are driven by mouse-wheel steps (0.35 viewport every 0.5 s). The module's own frame
 * statistics (frames during the build) are used; no screenshots are taken.
 *
 * The old version is read from git (--old-ref, default v1.0.1) or from a file (--old, with its .css next to it).
 * Results: a table on stdout and <os tmp>/page-swarm-rebuild-bench/bench.json.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const { createRequire } = require('module');

const SKILL = path.resolve(__dirname, '..');
const args = {};
process.argv.slice(2).forEach((a, i, arr) => { if (a.startsWith('--')) args[a.slice(2)] = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true; });
const PAGES = String(args.pages || 'demo,dental').split(',');
const DEVICES = String(args.devices || 'desktop').split(',');
const REPS = Number(args.reps || 3);
const OUT = path.join(os.tmpdir(), 'page-swarm-rebuild-bench');
const killer = setTimeout(() => { console.error('bench: time limit reached'); process.exit(3); }, Number(args.timeout || 1800) * 1000);

function loadPlaywright() {
  for (const t of [__filename, path.join(process.cwd(), 'index.js')]) { try { return createRequire(t)('playwright'); } catch (e) { /* next */ } }
  try { return require('playwright'); } catch (e) { /* next */ }
  try { const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(); return createRequire(path.join(root, 'index.js'))('playwright'); } catch (e) { /* none */ }
  console.error('Cannot find the "playwright" package.'); process.exit(2);
}

// old module files into OUT/old/assets (the test pages are served from the current skill folder)
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'old'), { recursive: true });
let oldJs, oldCss;
if (args.old) {
  oldJs = fs.readFileSync(path.resolve(String(args.old)), 'utf8');
  oldCss = fs.readFileSync(path.resolve(String(args.old)).replace(/\.js$/, '.css'), 'utf8');
} else {
  const ref = String(args['old-ref'] || 'v1.0.1');
  const git = (f) => execFileSync('git', ['show', ref + ':page-swarm-rebuild/assets/' + f], { cwd: SKILL, encoding: 'utf8', maxBuffer: 1 << 24 });
  oldJs = git('swarm-rebuild.js'); oldCss = git('swarm-rebuild.css');
}
const oldVersion = (/swarm-rebuild v([\d.]+)/.exec(oldJs) || [])[1] || '?';
const newVersion = (/swarm-rebuild v([\d.]+)/.exec(fs.readFileSync(path.join(SKILL, 'assets', 'swarm-rebuild.js'), 'utf8')) || [])[1] || '?';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
// /new/... = the skill folder; /old/... = the same, but assets/swarm-rebuild.{js,css} are the old version
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const m = /^\/(old|new)(\/.*)$/.exec(u);
  if (!m) { res.writeHead(404); return res.end(); }
  let body = null, f = path.normalize(path.join(SKILL, m[2]));
  if (!f.startsWith(SKILL)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (m[1] === 'old' && /assets\/swarm-rebuild\.js$/.test(m[2])) body = oldJs;
  if (m[1] === 'old' && /assets\/swarm-rebuild\.css$/.test(m[2])) body = oldCss;
  if (body == null && !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  if (body != null) res.end(body); else fs.createReadStream(f).pipe(res);
});

const PAGE_PATH = { demo: '/assets/demo/index.html', dental: '/tests/pages/dental/index.html' };
const MODES = {
  tour: { old: { 'rebuild-mode': 'tour' }, new: { 'rebuild-mode': 'tour', 'rebuild-debug': '1' }, wheel: false },
  tour6: { old: { 'rebuild-mode': 'fast' }, new: { 'rebuild-mode': 'tour', 'rebuild-debug': '1', 'rebuild-speed': '6' }, wheel: false },
  scroll: { old: { 'rebuild-mode': 'scroll' }, new: { 'rebuild-mode': 'scroll' }, wheel: true },
  fast: { old: null, new: { 'rebuild-mode': 'fast' }, wheel: true }
};

server.listen(0, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:' + server.address().port;
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const rows = [];
  async function once(ver, page, device, mode) {
    const p = MODES[mode][ver];
    if (!p) return null;
    const mobile = device === 'mobile';
    const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
    const pg = await ctx.newPage();
    const u = new URL(base + '/' + ver + PAGE_PATH[page]);
    u.searchParams.set('rebuild', '1');
    Object.entries(p).forEach(([k, v]) => u.searchParams.set(k, v));
    await pg.goto(u.toString(), { waitUntil: 'domcontentloaded' });
    const end = Date.now() + 120000;
    let s = { phase: 'scan' };
    while (Date.now() < end) {
      s = await pg.evaluate(() => window.SwarmRebuild ? window.SwarmRebuild.state() : { phase: 'x' }).catch(() => ({ phase: 'err' }));
      if (s.phase === 'done' || s.phase === 'idle') break;
      if (MODES[mode].wheel && s.phase === 'build') await pg.mouse.wheel(0, Math.round((mobile ? 844 : 900) * 0.35));
      await pg.waitForTimeout(500);
    }
    const st = await pg.evaluate(() => window.SwarmRebuild.stats()).catch(() => null);
    await ctx.close();
    return st ? { fps: st.avgFps, p95: st.p95FrameMs, frames: st.frames, elapsed: s.elapsed || null } : null;
  }
  for (const device of DEVICES) {
    for (const page of PAGES) {
      for (const mode of Object.keys(MODES)) {
        const r = { device, page, mode, old: [], new: [] };
        for (let k = 0; k < REPS; k++) {
          for (const ver of ['old', 'new']) { const x = await once(ver, page, device, mode); if (x) r[ver].push(x); }
        }
        const avg = (a, f) => a.length ? +(a.reduce((s, x) => s + x[f], 0) / a.length).toFixed(1) : null;
        r.oldFps = avg(r.old, 'fps'); r.newFps = avg(r.new, 'fps'); r.oldP95 = avg(r.old, 'p95'); r.newP95 = avg(r.new, 'p95');
        r.oldRuns = r.old.map((x) => x.fps); r.newRuns = r.new.map((x) => x.fps);
        rows.push(r);
        console.log([device, page, mode, 'old', r.oldFps, JSON.stringify(r.oldRuns), 'new', r.newFps, JSON.stringify(r.newRuns), 'p95 ms', r.oldP95, '->', r.newP95].join(' '));
      }
    }
  }
  await browser.close();
  server.close();
  fs.writeFileSync(path.join(OUT, 'bench.json'), JSON.stringify({ oldVersion, newVersion, reps: REPS, rows }, null, 2));
  console.log('\n| device | page | mode | v' + oldVersion + ' fps | v' + newVersion + ' fps | p95 frame ms old -> new |');
  console.log('|---|---|---|---|---|---|');
  rows.forEach((r) => console.log('| ' + [r.device, r.page, r.mode, r.oldFps == null ? '—' : r.oldFps + ' (' + r.oldRuns.join(', ') + ')', r.newFps + ' (' + r.newRuns.join(', ') + ')', (r.oldP95 == null ? '—' : r.oldP95) + ' -> ' + r.newP95].join(' | ') + ' |'));
  console.log('\n' + path.join(OUT, 'bench.json'));
  clearTimeout(killer);
  process.exit(0);
});
