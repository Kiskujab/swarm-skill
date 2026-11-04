#!/usr/bin/env node
/*
 * perf.cjs — Lighthouse metrics with and without the effect (same machine, interleaved runs, medians).
 *
 *   node scripts/perf.cjs --urls http://localhost:3000/,http://localhost:3000/about.html [--runs 3]
 *                         [--presets mobile,desktop] [--lighthouse <path to lighthouse/cli/index.js>] [--out perf.json]
 *
 * Lighthouse is not a dependency of the skill: install it anywhere (npm i lighthouse) and pass --lighthouse, or have
 * it resolvable from the current folder. Chrome: CHROME_PATH, else Playwright's Chromium.
 * Reported per page, preset and variant ("off" = ?rebuild=0, "on" = ?rebuild=1, the effect as a first-time visitor
 * gets it, without scrolling): performance score, FCP, LCP, CLS, TBT, Speed Index, accessibility and SEO scores.
 * Note: the effect hides the page until it is built, so LCP / Speed Index include the build of the first view
 * (that is what a first-time visitor sees); returning visitors (same session) and crawlers never get the effect.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const args = {};
process.argv.slice(2).forEach((a, i, arr) => { if (a.startsWith('--')) args[a.slice(2)] = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true; });
if (!args.urls) { console.error('usage: node perf.cjs --urls <url,url> [--runs 3] [--presets mobile,desktop] [--lighthouse <cli>]'); process.exit(2); }
const URLS = String(args.urls).split(',');
const RUNS = Number(args.runs || 3);
const PRESETS = String(args.presets || 'mobile,desktop').split(',');
let LH = args.lighthouse && args.lighthouse !== true ? String(args.lighthouse) : null;
if (!LH) { try { LH = require.resolve('lighthouse/cli/index.js', { paths: [process.cwd(), __dirname] }); } catch (e) { console.error('Lighthouse not found: npm i lighthouse, then --lighthouse node_modules/lighthouse/cli/index.js'); process.exit(2); } }
let CHROME = process.env.CHROME_PATH;
if (!CHROME) { try { CHROME = require(require.resolve('playwright', { paths: [process.cwd(), __dirname, '/opt/node-tools/node_modules'] })).chromium.executablePath(); } catch (e) { /* lighthouse finds one */ } }
const kill = setTimeout(() => { console.error('perf.cjs: time limit'); process.exit(3); }, Number(args.timeout || 3600) * 1000);

function lighthouse(url, preset) {
  const out = path.join(require('os').tmpdir(), 'swarm-perf-' + process.pid + '.json');
  const argv = [LH, url, '--quiet', '--output=json', '--output-path=' + out, '--only-categories=performance,accessibility,seo', '--chrome-flags=--headless=new --no-sandbox'];
  if (preset === 'desktop') argv.push('--preset=desktop');
  const r = spawnSync(process.execPath, argv, { encoding: 'utf8', timeout: 180000, env: Object.assign({}, process.env, CHROME ? { CHROME_PATH: CHROME } : {}) });
  if (!fs.existsSync(out)) return { error: (r.stderr || r.stdout || 'no report').split('\n').slice(-3).join(' ') };
  const j = JSON.parse(fs.readFileSync(out, 'utf8')); fs.unlinkSync(out);
  const a = j.audits, n = (k) => (a[k] && a[k].numericValue != null ? a[k].numericValue : null);
  return { perf: j.categories.performance.score, a11y: j.categories.accessibility.score, seo: j.categories.seo.score, fcp: n('first-contentful-paint'), lcp: n('largest-contentful-paint'), cls: n('cumulative-layout-shift'), tbt: n('total-blocking-time'), si: n('speed-index'), lcpEl: (a['largest-contentful-paint-element'] && JSON.stringify(a['largest-contentful-paint-element'].details || '').match(/"snippet":"([^"]{0,80})/) || [])[1] || null };
}
const med = (xs) => { xs = xs.filter((x) => x != null).sort((p, q) => p - q); return xs.length ? xs[xs.length >> 1] : null; };
const withQ = (u, v) => { const x = new URL(u); x.searchParams.set('rebuild', v); return x.toString(); };

const results = [];
for (const url of URLS) {
  for (const preset of PRESETS) {
    const runs = { off: [], on: [] };
    for (let k = 0; k < RUNS; k++) for (const v of ['off', 'on']) { const r = lighthouse(withQ(url, v === 'on' ? '1' : '0'), preset); runs[v].push(r); if (r.error) console.error('  ' + v + ': ' + r.error); }
    const row = { url, preset };
    for (const v of ['off', 'on']) {
      const ok = runs[v].filter((r) => !r.error);
      row[v] = { runs: ok.length, perf: med(ok.map((r) => r.perf)), fcp: med(ok.map((r) => r.fcp)), lcp: med(ok.map((r) => r.lcp)), cls: med(ok.map((r) => r.cls)), tbt: med(ok.map((r) => r.tbt)), si: med(ok.map((r) => r.si)), a11y: med(ok.map((r) => r.a11y)), seo: med(ok.map((r) => r.seo)), lcpEl: (ok[0] || {}).lcpEl };
    }
    results.push(row);
    const f = (x, d) => (x == null ? '—' : (+x).toFixed(d));
    console.log(url.replace(/^https?:\/\/[^/]+/, '') + ' [' + preset + ']  perf ' + f(row.off.perf * 100, 0) + ' -> ' + f(row.on.perf * 100, 0) + ', FCP ' + f(row.off.fcp, 0) + ' -> ' + f(row.on.fcp, 0) + ' ms, LCP ' + f(row.off.lcp, 0) + ' -> ' + f(row.on.lcp, 0) + ' ms, CLS ' + f(row.off.cls, 4) + ' -> ' + f(row.on.cls, 4) + ', TBT ' + f(row.off.tbt, 0) + ' -> ' + f(row.on.tbt, 0) + ' ms, SI ' + f(row.off.si, 0) + ' -> ' + f(row.on.si, 0) + ' ms, a11y ' + f(row.off.a11y * 100, 0) + ' -> ' + f(row.on.a11y * 100, 0) + ', SEO ' + f(row.off.seo * 100, 0) + ' -> ' + f(row.on.seo * 100, 0));
  }
}
if (args.out) fs.writeFileSync(String(args.out), JSON.stringify(results, null, 2));
clearTimeout(kill);
