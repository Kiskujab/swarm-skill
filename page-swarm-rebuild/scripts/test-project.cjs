#!/usr/bin/env node
/*
 * test-project.cjs — tests scripts/project.cjs (backup, restore, uninstall) on small sample projects in a
 * temporary folder: plain HTML (two pages, a sub-folder), Next.js App Router, Next.js Pages Router, Vite + React.
 *
 *   node scripts/test-project.cjs [--build] [--browser] [--keep]
 *
 * For every project: SHA-256 of every file before; install (markers present, backup with backup.txt <= 1000
 * characters and .orig copies, legacy/ in .gitignore); the project is then broken on purpose (changed files
 * overwritten, a created file deleted, another one changed) and restore must give back every file with the same
 * hash as before; install again + uninstall must give back the same hashes as well (with --purge also without
 * legacy/); an edit made by hand after the install survives an uninstall.
 * --build    also builds the Next.js App Router sample with legacy/ present (npm, uses the cached test app's
 *            node_modules when there is one): the build must pass and contain nothing from legacy/
 * --browser  also opens the plain HTML sample after the install (the effect runs) and after the uninstall
 *            (no trace of it, DOM identical to the original)
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const args = {};
process.argv.slice(2).forEach((a) => { if (a.startsWith('--')) args[a.slice(2)] = true; });
const TOOL = path.join(__dirname, 'project.cjs');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-project-test-'));
const kill = setTimeout(() => { console.error('FAIL time limit'); process.exit(3); }, 600000);
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); }
function tool(dir, ...argv) {
  const r = spawnSync(process.execPath, [TOOL, ...argv, '--project', dir], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
function write(dir, files) { Object.entries(files).forEach(([r, t]) => { const p = path.join(dir, r); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); }); }
function hashes(dir, withLegacy) {
  const out = {};
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name === 'out' || (!withLegacy && e.name === 'legacy' && d === dir)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else out[path.relative(dir, p)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    }
  })(dir);
  return out;
}
function same(a, b) {
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  const diff = [...new Set(ka.concat(kb))].filter((k) => a[k] !== b[k]);
  return { ok: diff.length === 0, diff };
}

const SAMPLES = {
  html: {
    'index.html': '<!doctype html>\n<html lang="hu">\n<head>\n<meta charset="utf-8">\n<title>Próba Kft.</title>\n<link rel="stylesheet" href="style.css">\n</head>\n<body>\n<header><h1>Próba Kft.</h1><a class="btn" href="tel:+3615550100">Hívás</a></header>\n<main><section><h2>Szolgáltatások</h2><p>Árvíztűrő tükörfúrógép.</p></section></main>\n</body>\n</html>\n',
    'rolunk/index.html': '<!doctype html><html><head><meta charset="utf-8"><title>Rólunk</title></head><body><p>Rólunk</p></body></html>',
    'style.css': 'body{font:16px/1.5 sans-serif;margin:0}h1{margin:0}\n',
    '.gitignore': 'node_modules\n*.log' // no newline at the end on purpose
  },
  'next-app': {
    'package.json': JSON.stringify({ name: 'sample-next-app', private: true, scripts: { build: 'next build' }, dependencies: { next: '15.5.29', react: '19.2.9', 'react-dom': '19.2.9' } }, null, 2) + '\n',
    'app/layout.jsx': "import './globals.css';\n\nexport const metadata = { title: 'Sample' };\n\nexport default function RootLayout({ children }) {\n  return (\n    <html lang=\"en\">\n      <body>\n        {children}\n      </body>\n    </html>\n  );\n}\n",
    'app/page.jsx': "export default function Page() {\n  return <main><h1>Hello</h1><p>Sample page.</p><a className=\"btn\" href=\"#x\">Start</a></main>;\n}\n",
    'app/globals.css': 'body{margin:0;font-family:sans-serif}\n'
  },
  'next-pages': {
    'package.json': JSON.stringify({ name: 'sample-next-pages', private: true, dependencies: { next: '15.5.29', react: '19.2.9', 'react-dom': '19.2.9' } }, null, 2) + '\n',
    'pages/_document.js': "import { Html, Head, Main, NextScript } from 'next/document';\n\nexport default function Document() {\n  return (\n    <Html lang=\"en\">\n      <Head>\n        <meta name=\"theme-color\" content=\"#fff\" />\n      </Head>\n      <body>\n        <Main />\n        <NextScript />\n      </body>\n    </Html>\n  );\n}\n",
    'pages/_app.js': "import '../styles.css';\n\nexport default function App({ Component, pageProps }) {\n  return (\n    <>\n      <Component {...pageProps} />\n    </>\n  );\n}\n",
    'pages/index.js': "export default function Home() { return <h1>Home</h1>; }\n",
    'styles.css': 'body{margin:0}\n'
  },
  'vite-react': {
    'package.json': JSON.stringify({ name: 'sample-vite', private: true, type: 'module', dependencies: { react: '19.2.9', 'react-dom': '19.2.9' }, devDependencies: { vite: '6.0.0', '@vitejs/plugin-react': '4.3.4' } }, null, 2) + '\n',
    'index.html': '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <title>Vite App</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.jsx"></script>\n  </body>\n</html>\n',
    'src/main.jsx': "import { StrictMode } from 'react'\nimport { createRoot } from 'react-dom/client'\nimport App from './App.jsx'\n\ncreateRoot(document.getElementById('root')).render(\n  <StrictMode>\n    <App />\n  </StrictMode>,\n)\n",
    'src/App.jsx': "export default function App() { return <h1>Vite</h1>; }\n"
  }
};

(async () => {
  for (const [name, files] of Object.entries(SAMPLES)) {
    const dir = path.join(WORK, name);
    write(dir, files);
    const before = hashes(dir);
    // ---- install
    const a = tool(dir, 'install', '--focus', '.btn');
    const leg = path.join(dir, 'legacy');
    const bk = fs.existsSync(leg) ? fs.readdirSync(leg).filter((n) => fs.existsSync(path.join(leg, n, 'manifest.json'))) : [];
    const man = bk.length ? JSON.parse(fs.readFileSync(path.join(leg, bk[0], 'manifest.json'), 'utf8')) : null;
    const txt = bk.length ? fs.readFileSync(path.join(leg, bk[0], 'backup.txt'), 'utf8') : '';
    const changed = man ? man.files.map((f) => f.path) : [];
    const marked = changed.filter((r) => /swarm-rebuild:start/.test(fs.readFileSync(path.join(dir, r), 'utf8')));
    const origs = man ? man.files.every((f) => fs.existsSync(path.join(leg, bk[0], 'files', f.path + '.orig'))) : false;
    const gi = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    check(name + ': install (' + (man && man.type) + ') backs up every file it changes first', a.code === 0 && man && changed.length > 0 && marked.length === changed.length && origs && man.created.length >= 3,
      a.code ? a.out.trim() : 'changed ' + changed.join(', ') + '; created ' + (man ? man.created.map((c) => c.path).join(', ') : ''));
    check(name + ': backup.txt (what, when, files, how to restore) is at most 1000 characters', txt.length > 0 && txt.length <= 1000 && /restore/.test(txt) && /When:/.test(txt), txt.length + ' characters');
    check(name + ': legacy/ is in .gitignore, and nothing from node_modules / .git / build output was saved', /^legacy\/$/m.test(gi) && !changed.some((r) => /(^|\/)(node_modules|\.git|\.next|dist|build|out)\//.test(r)));
    if (name === 'html') {
      const idx = fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), sub = fs.readFileSync(path.join(dir, 'rolunk/index.html'), 'utf8');
      check('html: snippet after <meta charset>, stylesheet and script tag with the focus (relative paths per page)',
        idx.indexOf('swarm-rebuild-hide') > idx.indexOf('charset') && /href="swarm-rebuild\/swarm-rebuild(\.min)?.css"/.test(idx) && /src="swarm-rebuild\/swarm-rebuild(\.min)?.js" data-auto data-focus=".btn"/.test(idx) && /src="..\/swarm-rebuild\/swarm-rebuild(\.min)?.js"/.test(sub));
    }
    const again = tool(dir, 'install');
    check(name + ': a second install is refused (no double insertion)', again.code !== 0, again.out.trim().split('\n')[0]);
    // ---- break the project on purpose, then restore
    changed.forEach((r) => fs.writeFileSync(path.join(dir, r), 'broken!\n'));
    const created = man ? man.created.map((c) => c.path) : [];
    if (created[0]) fs.rmSync(path.join(dir, created[0]), { force: true });
    if (created[1]) fs.appendFileSync(path.join(dir, created[1]), '\n// garbage\n');
    const r = tool(dir, 'restore');
    const s1 = same(before, hashes(dir));
    check(name + ': restore after breaking the project gives back every file (SHA-256 identical)', r.code === 0 && s1.ok, r.code ? r.out.trim() : s1.ok ? Object.keys(before).length + ' files identical' : 'differs: ' + s1.diff.join(', '));
    // ---- install again, edit by hand, uninstall: the hand edit stays, everything else as before
    tool(dir, 'install');
    const editFile = changed.find((x) => x !== '.gitignore');
    const extra = editFile.endsWith('.html') ? '<!-- my own later edit -->\n' : '// my own later edit\n';
    fs.appendFileSync(path.join(dir, editFile), extra);
    const u = tool(dir, 'uninstall');
    const now = hashes(dir), want = Object.assign({}, before);
    want[editFile] = crypto.createHash('sha256').update(Buffer.concat([Buffer.from(files[editFile]), Buffer.from(extra)])).digest('hex');
    const s2 = same(want, now);
    check(name + ': uninstall removes everything the install added and keeps a later hand edit', u.code === 0 && s2.ok && !/swarm-rebuild/.test(JSON.stringify(Object.keys(now))), u.code ? u.out.trim() : s2.ok ? 'all other files identical to before the install' : 'differs: ' + s2.diff.join(', '));
    // ---- clean install + uninstall --purge: exactly the original project (also no legacy/)
    fs.writeFileSync(path.join(dir, editFile), files[editFile]);
    tool(dir, 'install');
    const u2 = tool(dir, 'uninstall', '--purge');
    const s3 = same(before, hashes(dir, true));
    check(name + ': install + uninstall --purge = the original project, byte for byte', u2.code === 0 && s3.ok && !fs.existsSync(leg), s3.ok ? '' : 'differs: ' + s3.diff.join(', '));
  }

  if (args.build) {
    // Next.js App Router sample, installed, with legacy/ present: builds, nothing from legacy/ in the output
    const dir = path.join(WORK, 'next-app');
    tool(dir, 'install');
    const cache = path.join(os.tmpdir(), 'page-swarm-rebuild-next', 'node_modules');
    if (fs.existsSync(cache)) fs.symlinkSync(cache, path.join(dir, 'node_modules'), 'dir');
    else spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit' });
    // a TypeScript-looking file in the backup must not be picked up by the build either
    const b = spawnSync(process.execPath, [path.join(dir, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], { cwd: dir, encoding: 'utf8', env: Object.assign({}, process.env, { NEXT_TELEMETRY_DISABLED: '1' }) });
    let leaked = [];
    (function walk(d) { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/legacy|\.orig$/.test(e.name) || (/\.(js|html|json)$/.test(e.name) && /legacy\/\d{8}-/.test(fs.readFileSync(p, 'utf8')))) leaked.push(path.relative(dir, p)); } })(path.join(dir, '.next'));
    check('next-app: builds with the effect installed and legacy/ present; nothing from legacy/ in the build', b.status === 0 && leaked.length === 0, b.status ? (b.stdout + b.stderr).split('\n').slice(-8).join(' | ') : leaked.length ? 'leaked: ' + leaked.slice(0, 3).join(', ') : '.next has no file from legacy/');
    tool(dir, 'uninstall', '--purge');
  }

  if (args.browser) {
    const { chromium } = require(require.resolve('playwright', { paths: [process.cwd(), __dirname, '/opt/node-tools/node_modules'] }));
    const http = require('http');
    const dir = path.join(WORK, 'html');
    const base = await fs.promises.readFile(path.join(dir, 'index.html'), 'utf8');
    const srv = http.createServer((q, s) => { let f = path.join(dir, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.css') ? 'text/css' : 'text/javascript' }); fs.createReadStream(f).pipe(s); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const url = 'http://127.0.0.1:' + srv.address().port + '/index.html';
    const br = await chromium.launch();
    const p = await br.newPage();
    const base0 = await (async () => { await p.goto(url + '?rebuild=0'); return p.evaluate(() => document.body.outerHTML); })();
    tool(dir, 'install', '--focus', '.btn'); // (the DOM above was read before the install)
    await p.goto(url + '?rebuild=1');
    await p.waitForTimeout(900);
    const st = await p.evaluate(() => window.SwarmRebuild && window.SwarmRebuild.state().phase);
    check('html: after the install the effect runs on the page', st === 'build' || st === 'done' || st === 'scan', 'phase ' + st);
    tool(dir, 'uninstall', '--purge');
    await p.goto(url + '?rebuild=1');
    await p.waitForTimeout(600);
    const g = await p.evaluate(() => ({ api: typeof window.SwarmRebuild, hide: !!document.getElementById('swarm-rebuild-hide'), dom: document.body.outerHTML }));
    const after = await fs.promises.readFile(path.join(dir, 'index.html'), 'utf8');
    check('html: after the uninstall no trace on the page, DOM as before the install', g.api === 'undefined' && !g.hide && g.dom.replace(/\s+/g, ' ') === base0.replace(/\s+/g, ' ') && after === base, 'module ' + g.api + ', hide style ' + g.hide);
    await br.close(); srv.close();
  }
  if (!args.keep) fs.rmSync(WORK, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok).length;
  console.log('\n' + (failed ? failed + ' check(s) failed' : 'all ' + results.length + ' checks passed') + (args.keep ? ' — samples kept in ' + WORK : ''));
  clearTimeout(kill);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
