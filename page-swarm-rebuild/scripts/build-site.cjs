#!/usr/bin/env node
/*
 * build-site.cjs — builds the three test pages as one static site (GitHub Pages, or a local server for a
 * phone on the same Wi-Fi):
 *
 *   node scripts/build-site.cjs --out _site --base /swarm-skill        (what the GitHub Pages workflow runs)
 *   node scripts/build-site.cjs --serve 8080                           (build into a temp folder and serve it
 *                                                                        on all network interfaces)
 *
 * Site layout (same relative paths as in the skill folder, so the pages need no changes):
 *   index.html                     -> redirects to tests/
 *   tests/index.html               links to every page in every mode
 *   assets/...                     the module and the demo (assets/demo/index.html)
 *   tests/pages/<name>/...         the static test pages (dental, languages, ...)
 *   tests/pages/nextjs/...         static export of the Next.js app (npm install + next build in a temp folder)
 * --base   the path the site is served from (GitHub Pages project site: /<repo name>); only Next.js needs it.
 * --no-next  skip the Next.js export (no npm needed)
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { SKILL, copyDir, prepareNext, buildNext } = require('./next-app.cjs');

const args = {};
process.argv.slice(2).forEach((a, i, arr) => { if (a.startsWith('--')) args[a.slice(2)] = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true; });
const OUT = path.resolve(args.out || path.join(os.tmpdir(), 'page-swarm-rebuild-site'));
const BASE = args.base && args.base !== true ? String(args.base).replace(/\/$/, '') : '';

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
copyDir(path.join(SKILL, 'assets'), path.join(OUT, 'assets'));
// every static test page (the Next.js app is built separately below)
fs.readdirSync(path.join(SKILL, 'tests', 'pages')).forEach((d) => {
  const src = path.join(SKILL, 'tests', 'pages', d);
  if (d === 'nextjs' || !fs.statSync(src).isDirectory() || fs.existsSync(path.join(src, 'package.json'))) return;
  copyDir(src, path.join(OUT, 'tests', 'pages', d));
});
fs.copyFileSync(path.join(SKILL, 'tests', 'index.html'), path.join(OUT, 'tests', 'index.html'));
fs.writeFileSync(path.join(OUT, 'index.html'), '<!doctype html><meta charset="utf-8"><title>page-swarm-rebuild</title><meta http-equiv="refresh" content="0; url=tests/"><a href="tests/">Test pages</a>\n');
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
if (!args['no-next']) {
  const work = prepareNext();
  const out = buildNext(work, BASE + '/tests/pages/nextjs');
  copyDir(out, path.join(OUT, 'tests', 'pages', 'nextjs'));
}
console.log('site built: ' + OUT);

if (args.serve) {
  const port = Number(args.serve) || 8080;
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain', '.woff2': 'font/woff2' };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (BASE && p.startsWith(BASE)) p = p.slice(BASE.length) || '/';
    let f = path.normalize(path.join(OUT, p));
    if (!f.startsWith(OUT)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  server.listen(port, '0.0.0.0', () => {
    const ips = [];
    Object.values(os.networkInterfaces()).forEach((l) => (l || []).forEach((i) => { if (i.family === 'IPv4' && !i.internal) ips.push(i.address); }));
    console.log('open on this computer:  http://localhost:' + port + BASE + '/tests/');
    ips.forEach((ip) => console.log('open on a phone (same Wi-Fi):  http://' + ip + ':' + port + BASE + '/tests/'));
    console.log('Ctrl+C stops the server.');
  });
}
