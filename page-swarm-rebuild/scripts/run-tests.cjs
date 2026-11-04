#!/usr/bin/env node
/*
 * run-tests.cjs — runs verify.cjs on the three test pages of the skill, desktop and mobile.
 *
 *   node scripts/run-tests.cjs [--pages demo,dental,nextjs] [--devices desktop,mobile]
 *                              [--quick] [--min-fps 50] [--out <dir>] [--timeout 3600]
 *
 * Test pages (all fictional, all paths relative to the skill folder):
 *   demo     assets/demo/index.html              dark portfolio, 214 layers, 6.6 viewport heights, sticky header
 *   dental   tests/pages/dental/index.html       light small-business page; fixed "Call us" bar (mobile),
 *                                                fixed cookie-style notice (desktop)
 *   nextjs   tests/pages/nextjs/                 Next.js 15 App Router app, React counter (hydration), fixed Help button
 *
 * Per page and device: one full run (--mode tour --speed 6, i.e. the old "fast" baseline, with
 * --checks all,manual: record, extra, product, protect, fixed, manual) plus recorded runs of what visitors get
 * (scroll; on the demo also fast, and the 1x tour on desktop).
 *
 * The Next.js app is copied to a temporary folder, the module files from assets/ are copied into its
 * components/swarm-rebuild/ (as SKILL.md tells you to install it), its dependencies are installed there
 * with npm, then it is built and started. Nothing is written into the skill folder.
 *
 * --quick   skip the long 1x tour run (about 45 s) and the fast run on the demo
 * --out     results folder (default: <os tmp>/page-swarm-rebuild-check); summary.md / summary.json there
 *
 * All servers are started on free ports and stopped at the end (also on Ctrl+C and on the time limit).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const SKILL = path.resolve(__dirname, '..');
const args = {};
process.argv.slice(2).forEach((a, i, arr) => { if (a.startsWith('--')) args[a.slice(2)] = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true; });
const PAGES = String(args.pages || 'demo,dental,nextjs').split(',');
const DEVICES = String(args.devices || 'desktop,mobile').split(',');
const OUT = path.resolve(args.out || path.join(os.tmpdir(), 'page-swarm-rebuild-check'));
const MIN_FPS = args['min-fps'] || '50';
const TOTAL_S = Number(args.timeout || 3600);
fs.mkdirSync(OUT, { recursive: true });

const children = new Set();
let staticServer = null;
function cleanup() {
  children.forEach((c) => { try { process.kill(-c.pid, 'SIGTERM'); } catch (e) { try { c.kill('SIGTERM'); } catch (x) { /* gone */ } } });
  children.clear();
  if (staticServer) { try { staticServer.close(); } catch (e) { /* ignore */ } staticServer = null; }
}
process.on('exit', cleanup);
['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, () => { cleanup(); process.exit(130); }));
const watchdog = setTimeout(() => { console.error('run-tests: time limit reached (' + TOTAL_S + ' s), stopping'); cleanup(); process.exit(3); }, TOTAL_S * 1000);

function freePort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
async function startStatic(root) {
  const port = await freePort();
  staticServer = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let f = path.normalize(path.join(root, p));
    if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => staticServer.listen(port, '127.0.0.1', r));
  return 'http://127.0.0.1:' + port;
}
function waitHttp(url, ms) {
  const end = Date.now() + ms;
  return new Promise((res, rej) => {
    (function poll() {
      const r = http.get(url, (x) => { x.resume(); if (x.statusCode < 500) res(); else retry(); });
      r.on('error', retry);
      r.setTimeout(3000, () => { r.destroy(); });
      function retry() { if (Date.now() > end) rej(new Error('server did not answer: ' + url)); else setTimeout(poll, 500); }
    })();
  });
}
const { prepareNext, buildNext, nextBin } = require('./next-app.cjs');

async function startNext() {
  const work = prepareNext();
  buildNext(work);
  const port = await freePort();
  const c = spawn(process.execPath, [nextBin(work), 'start', '-p', String(port), '-H', '127.0.0.1'], { cwd: work, detached: true, stdio: 'ignore', env: Object.assign({}, process.env, { NEXT_TELEMETRY_DISABLED: '1' }) });
  children.add(c);
  const url = 'http://127.0.0.1:' + port + '/';
  await waitHttp(url, 60000);
  return url;
}

function verify(name, url, device, label, checks, extra) {
  const out = path.join(OUT, [name, device, label].join('-'));
  fs.rmSync(path.join(out, 'frames'), { recursive: true, force: true });
  const mode = label === 'tour6' ? 'tour' : label;
  const long = checks.indexOf('all') >= 0 || checks.indexOf('manual') >= 0;
  const argv = [path.join(__dirname, 'verify.cjs'), '--url', url, '--mode', mode, '--device', device, '--checks', checks, '--out', out, '--min-fps', String(MIN_FPS), '--timeout', long ? '900' : '300']
    .concat(label === 'tour6' ? ['--speed', '6'] : []).concat(extra || []);
  console.log('\n=== ' + name + ' / ' + device + ' / ' + label + ' (' + checks + ')');
  fs.rmSync(path.join(out, 'report.json'), { force: true });
  // async: the static server lives in this process and must keep answering
  return new Promise((resolve) => {
    const c = spawn(process.execPath, argv, { stdio: 'inherit', detached: true });
    children.add(c);
    const kill = setTimeout(() => { try { process.kill(-c.pid, 'SIGKILL'); } catch (e) { /* gone */ } }, long ? 960000 : 360000);
    c.on('exit', (code) => {
      clearTimeout(kill);
      children.delete(c);
      let rep = null;
      try { rep = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8')); } catch (e) { /* no report */ }
      resolve({ name, device, mode: label, checks, exit: code, report: rep, out });
    });
  });
}

(async () => {
  const base = await startStatic(SKILL);
  const urls = {
    demo: base + '/assets/demo/index.html',
    dental: base + '/tests/pages/dental/index.html'
  };
  if (PAGES.includes('nextjs')) urls.nextjs = await startNext();

  const plan = [];
  for (const device of DEVICES) {
    if (PAGES.includes('demo')) {
      plan.push(['demo', device, 'tour6', 'all,manual']);
      if (device === 'desktop' && !args.quick) plan.push(['demo', device, 'tour', 'record']);
      plan.push(['demo', device, 'scroll', 'record']);
      if (!args.quick) plan.push(['demo', device, 'fast', 'record']);
    }
    if (PAGES.includes('dental')) {
      plan.push(['dental', device, 'tour6', 'all,manual']);
      plan.push(['dental', device, 'scroll', 'record']);
    }
    if (PAGES.includes('nextjs')) {
      plan.push(['nextjs', device, 'tour6', 'all,manual', ['--interact', '[data-testid=counter]']]);
      plan.push(['nextjs', device, 'scroll', 'record', ['--interact', '[data-testid=counter]']]);
    }
  }
  const runs = [];
  // the installer (backup, restore, uninstall) on sample projects
  if (!args['no-project']) {
    console.log('\n=== installer (scripts/test-project.cjs --browser)');
    const tp = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'test-project.cjs'), '--browser'], { encoding: 'utf8', timeout: 600000 });
    const out = (tp.stdout || '') + (tp.stderr || '');
    process.stdout.write(out);
    const res = out.split('\n').filter((l) => /^(PASS|FAIL) /.test(l)).map((l) => ({ name: l.slice(5), ok: l.startsWith('PASS') }));
    runs.push({ name: 'installer', device: '-', mode: 'install/restore/uninstall', checks: 'project', exit: tp.status, report: { results: res } });
  }
  for (const [n, d, m, c, x] of plan) runs.push(await verify(n, urls[n], d, m, c, x)); // one at a time: fps is measured
  cleanup();

  // ---------- summary
  const rows = runs.map((r) => {
    const rep = r.report || {};
    const res = rep.results || [];
    const failed = res.filter((x) => !x.ok);
    return {
      page: r.name, device: r.device, mode: r.mode, checks: r.checks,
      passed: res.length - failed.length, total: res.length, failed: failed.map((x) => x.name + (x.detail ? ' — ' + x.detail : '')),
      exit: r.exit,
      build_s: rep.elapsed != null ? +rep.elapsed.toFixed(1) : null,
      layers: rep.layers || null, agents: rep.agentsEnd || null,
      fps: rep.fps ? rep.fps.avgFps : null, cls: rep.cls != null ? +rep.cls.toFixed(4) : null,
      pixel_pct: rep.pixelDiff != null ? +(rep.pixelDiff * 100).toFixed(3) : null,
      viewport_heights: rep.pageViewportHeights || null,
      scroll_curve: rep.scrollCurve ? rep.scrollCurve.map((p) => p.progress) : null,
      manual: rep.manual || null, fixed: rep.fixed || null, protect: rep.protect || null, motion: rep.motion || null
    };
  });
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(rows, null, 2));
  const md = ['| page | device | mode | checks | passed | build s | layers | agents | fps | CLS | pixel % | scroll curve 8/20/40/60/80/98 % |', '|---|---|---|---|---|---|---|---|---|---|---|---|']
    .concat(rows.map((r) => '| ' + [r.page, r.device, r.mode, r.checks, r.passed + '/' + r.total, r.build_s, r.layers, r.agents, r.fps, r.cls, r.pixel_pct, r.scroll_curve ? r.scroll_curve.join(' / ') : ''].map((v) => v == null ? '' : v).join(' | ') + ' |'));
  const fails = rows.filter((r) => r.failed.length || r.exit !== 0);
  md.push('');
  fails.forEach((r) => { md.push('**' + r.page + ' / ' + r.device + ' / ' + r.mode + '** (exit ' + r.exit + ')'); r.failed.forEach((f) => md.push('- ' + f)); });
  rows.filter((r) => r.manual).forEach((r) => {
    Object.entries(r.manual).forEach(([k, v]) => md.push('- manual ' + k + ' ' + r.page + '/' + r.device + ': max ahead ' + v.maxAhead + ' vh, waits ' + (v.waits ? 'avg ' + v.waits.avg + ' s / max ' + v.waits.max + ' s (n=' + v.waits.n + ')' : 'none') + ', CLS ' + (v.cls != null ? v.cls.toFixed(4) : '?')));
  });
  rows.filter((r) => r.fixed).forEach((r) => md.push('- fixed ' + r.page + '/' + r.device + ': ' + r.fixed.samples + ' pixel samples of ' + (r.fixed.elements.join(', ') || 'no fixed element') + ', covered ' + r.fixed.covered));
  rows.filter((r) => r.protect && r.protect.above).forEach((r) => md.push('- above the view ' + r.page + '/' + r.device + ': ' + r.protect.above.probes + ' probes, ' + r.protect.above.checked + ' layer checks, not final ' + r.protect.above.bad));
  rows.filter((r) => r.motion).forEach((r) => {
    const m = r.motion, o = m.opening || {}, f = m.finale || {}, g = m.gravity || {}, d = m.difficulty || {}, ms = m.mouse;
    const pc = (x) => x == null ? '—' : Math.round(x * 1000) / 10 + ' %';
    md.push('- motion ' + r.page + '/' + r.device + ': opening swarms ' + JSON.stringify(o.swarms) + ' around ' + ((o.focus && (o.focus.el || o.focus.src)) || '?') + ', speed CV ' + o.speedCv +
      '; finale around ' + ((f.focus && (f.focus.el || f.focus.src)) || '?') + ' (' + (f.focus && f.focus.src) + '), overshoot ' + pc(f.overshoot) + ', gathered ' + pc(f.gathered) +
      '; sag horizontal ' + pc(g.sagHorizontal) + ' (heavy ' + pc(g.sagHeavy) + ', light ' + pc(g.sagLight) + '), vertical ' + pc(g.sagVertical) + ', max ' + g.maxSagPx + ' px' +
      '; difficulty rho ' + d.spearman + ', big/small ' + d.bigToSmallWork + 'x' +
      (ms ? '; mouse min ' + ms.minDistance + ' px, follow slow ' + ms.slow.avgDur + ' s / fast ' + ms.fast.avgDur + ' s' : ''));
    if (m.sheets) md.push('  sheets: ' + m.sheets.join(', '));
  });
  fs.writeFileSync(path.join(OUT, 'summary.md'), md.join('\n') + '\n');
  console.log('\n' + md.join('\n'));
  console.log('\nresults: ' + OUT);
  clearTimeout(watchdog);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); cleanup(); process.exit(1); });
