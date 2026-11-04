#!/usr/bin/env node
/*
 * project.cjs — installs the effect into a project, removes it again, and restores the original files.
 * Before it changes or adds anything, every file it touches is saved in the project's legacy/ folder.
 * No dependencies (Node 16+).
 *
 *   node project.cjs install   --project <dir> [--type auto|html|next-app|next-pages|vite-react]
 *                              [--html index.html,about.html] [--dest <folder>] [--focus "<selector>"]
 *                              [--mode scroll|fast] [--dry]
 *   node project.cjs uninstall --project <dir> [--purge]      remove everything the install added
 *   node project.cjs restore   --project <dir> [--backup <name>|latest] [--dry]
 *                                                            put back the files exactly as they were before
 *   node project.cjs list      --project <dir>               the backups in legacy/
 *
 * install   detects the project (Next.js App Router / Pages Router, Vite + React, plain HTML), copies the module
 *           files, inserts the head snippet, the stylesheet, the script tag / component and the focus setting.
 *           Every insertion is wrapped in "swarm-rebuild:start" / "swarm-rebuild:end" markers. legacy/ is added
 *           to .gitignore (so git-based deploys never ship it).
 * uninstall removes exactly what the install inserted (other edits made since are kept), deletes the files it
 *           copied, and checks every file against the backup (hash). --purge also deletes legacy/.
 * restore   writes the backed-up files back byte for byte and deletes the files the install created; the
 *           result is checked with SHA-256 against the backup.
 *
 * Backups: legacy/<YYYYMMDD-HHMMSS>-<action>/ with backup.txt (what, when, which files, how to restore; at most
 * 1000 characters), manifest.json and files/<path>.orig (the .orig suffix keeps bundlers, TypeScript and test
 * runners away from the copies). node_modules, .git and build output (.next, dist, build, out) are never saved.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SKILL = path.resolve(__dirname, '..');
const VERSION = (/var VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(SKILL, 'assets', 'swarm-rebuild.js'), 'utf8')) || [])[1] || '?';
const NEVER = ['node_modules', '.git', '.next', 'dist', 'build', 'out', 'legacy', '.vercel', '.netlify', '.turbo', '.cache'];
const M = { html: ['<!-- swarm-rebuild:start -->', '<!-- swarm-rebuild:end -->'], js: ['// swarm-rebuild:start', '// swarm-rebuild:end'], jsx: ['{/* swarm-rebuild:start */}', '{/* swarm-rebuild:end */}'], hash: ['# swarm-rebuild:start', '# swarm-rebuild:end'] };

const args = { _: [] };
process.argv.slice(2).forEach((a, i, arr) => {
  if (a.startsWith('--')) args[a.slice(2)] = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true;
  else if (!(i > 0 && arr[i - 1].startsWith('--') && args[arr[i - 1].slice(2)] === a)) args._.push(a);
});
const CMD = args._[0];
const ROOT = path.resolve(String(args.project || '.'));
const DRY = !!args.dry;

function die(msg) { console.error('project.cjs: ' + msg); process.exit(1); }
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const abs = (r) => path.join(ROOT, r);
const exists = (r) => fs.existsSync(abs(r));
const read = (r) => fs.readFileSync(abs(r), 'utf8');
function guard(r) {
  const parts = r.split('/');
  if (r.startsWith('..') || path.isAbsolute(r)) die('refusing a path outside the project: ' + r);
  if (parts.some((p) => NEVER.includes(p) && p !== 'legacy')) die('refusing to touch ' + r + ' (dependencies / build output)');
}
function stamp() {
  const d = new Date(), z = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + '-' + z(d.getHours()) + z(d.getMinutes()) + z(d.getSeconds());
}
function walk(dir, out, depth) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (NEVER.includes(e.name) || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth < 6) walk(p, out, depth + 1); } else out.push(rel(p));
  }
  return out;
}
const first = (list) => list.find((r) => exists(r)) || null;

// ------------------------------------------------------------------ backups
function backupsList() {
  const d = abs('legacy');
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((n) => fs.existsSync(path.join(d, n, 'manifest.json'))).sort()
    .map((n) => Object.assign({ name: n }, JSON.parse(fs.readFileSync(path.join(d, n, 'manifest.json'), 'utf8'))));
}
// saves the files that are about to change (and notes the ones about to be created)
function makeBackup(action, plan, extra) {
  const name = stamp() + '-' + action;
  let dir = abs(path.join('legacy', name)), k = 1;
  while (fs.existsSync(dir)) dir = abs(path.join('legacy', name + '-' + (++k)));
  const files = [];
  plan.change.forEach((r) => {
    guard(r);
    const buf = fs.readFileSync(abs(r));
    files.push({ path: r, sha256: sha(buf), bytes: buf.length });
    if (!DRY) { const to = path.join(dir, 'files', r + '.orig'); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, buf); }
  });
  const manifest = Object.assign({ action, time: new Date().toISOString(), skill: 'page-swarm-rebuild ' + VERSION, project: ROOT, files, created: plan.create.map((c) => ({ path: c })) }, extra || {});
  const lines = [
    'page-swarm-rebuild ' + VERSION + ' - backup before "' + action + '"',
    'When: ' + manifest.time,
    'Saved here (files/*.orig, unchanged bytes): ' + (files.map((f) => f.path).join(', ') || 'none'),
    'Created by the ' + action + ': ' + (plan.create.join(', ') || 'none'),
    'Restore exactly this state: node <skill>/scripts/project.cjs restore --project <this project> --backup ' + path.basename(dir),
    'Remove the effect but keep later edits: node <skill>/scripts/project.cjs uninstall --project <this project>',
    'This folder is in .gitignore and never part of a build; delete it when you no longer need it.'
  ];
  let txt = lines.join('\n') + '\n';
  if (txt.length > 1000) { // keep backup.txt short: list fewer file names
    lines[2] = 'Saved here (files/*.orig, unchanged bytes): ' + files.length + ' files, see manifest.json';
    lines[3] = 'Created by the ' + action + ': ' + plan.create.length + ' files, see manifest.json';
    txt = lines.join('\n') + '\n';
  }
  if (!DRY) {
    fs.mkdirSync(dir, { recursive: true });
    // if legacy/ is ever uploaded to an Apache server by hand, it is not served
    const ht = abs(path.join('legacy', '.htaccess'));
    if (!fs.existsSync(ht)) fs.writeFileSync(ht, '<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\n  Deny from all\n</IfModule>\n');
    fs.writeFileSync(path.join(dir, 'backup.txt'), txt.slice(0, 1000));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
  return { dir, manifest };
}

// ----------------------------------------------------------------- inserts
// An insertion is a marked block put at an index of a file; nothing else in the file changes, so removing the
// block gives back the original bytes.
let curFile = null;
const INSERTED = {};
function block(kind, body, lead, trail) {
  const s = (lead || '') + M[kind][0] + body + M[kind][1] + (trail || '');
  if (curFile) (INSERTED[curFile] = INSERTED[curFile] || []).push(s); // the exact text, so uninstall can take it out again
  return s;
}
function insertAt(text, idx, str) { return text.slice(0, idx) + str + text.slice(idx); }
function afterImports(src) {
  // index right after the last import statement (single- or multi-line), else 0 (after leading directives)
  const re = /^import\s*['"][^'"\n]+['"][^\S\n]*;?[^\S\n]*\n|^import\b[^;]*?\bfrom\s*['"][^'"\n]+['"][^\S\n]*;?[^\S\n]*\n/gm;
  let m, end = -1;
  while ((m = re.exec(src))) end = m.index + m[0].length;
  if (end >= 0) return end;
  const d = /^(?:\s*(['"])use (?:client|strict)\1;?\s*\n)+/.exec(src);
  return d ? d[0].length : 0;
}
function snippet() {
  const s = fs.readFileSync(path.join(SKILL, 'assets', 'react', 'SwarmRebuild.jsx'), 'utf8');
  const m = /SWARM_REBUILD_HEAD_SNIPPET =\s*\n?\s*"((?:[^"\\]|\\.)*)"/.exec(s);
  if (!m) die('cannot read the head snippet from SwarmRebuild.jsx');
  return JSON.parse('"' + m[1] + '"');
}
function jsxProps() {
  const p = [];
  if (args.focus && args.focus !== true) p.push('focus="' + String(args.focus).replace(/"/g, '&quot;') + '"');
  if (args.mode && args.mode !== true) p.push('mode="' + args.mode + '"');
  return p.length ? ' ' + p.join(' ') : '';
}

// --------------------------------------------------------------- detection
function detect() {
  let pkg = null;
  if (exists('package.json')) { try { pkg = JSON.parse(read('package.json')); } catch (e) { die('package.json is not valid JSON'); } }
  const deps = pkg ? Object.assign({}, pkg.dependencies, pkg.devDependencies) : {};
  const want = args.type && args.type !== true && args.type !== 'auto' ? args.type : null;
  const appLayout = first(['app/layout.tsx', 'app/layout.jsx', 'app/layout.js', 'app/layout.ts', 'src/app/layout.tsx', 'src/app/layout.jsx', 'src/app/layout.js']);
  const doc = first(['pages/_document.tsx', 'pages/_document.jsx', 'pages/_document.js', 'src/pages/_document.tsx', 'src/pages/_document.jsx', 'src/pages/_document.js']);
  const app = first(['pages/_app.tsx', 'pages/_app.jsx', 'pages/_app.js', 'src/pages/_app.tsx', 'src/pages/_app.jsx', 'src/pages/_app.js']);
  const main = first(['src/main.jsx', 'src/main.tsx', 'src/main.js', 'src/index.jsx', 'src/index.tsx']);
  let type = want;
  if (!type) {
    if (deps.next && appLayout) type = 'next-app';
    else if (deps.next && doc && app) type = 'next-pages';
    else if (deps.next) die('Next.js project without app/layout or pages/_document + pages/_app: install by hand (SKILL.md step 2)');
    else if (deps.vite && deps.react && main && exists('index.html')) type = 'vite-react';
    else type = 'html';
  }
  return { type, pkg, appLayout, doc, app, main };
}

// ----------------------------------------------------------------- install
function install() {
  if (backupsList().some((b) => b.action === 'install' && !b.removed) || hasMarkers()) die('the effect is already installed here (run uninstall first)');
  const d = detect(), ops = [], create = [];
  const assets = path.join(SKILL, 'assets');
  const copy = (from, toRel) => { create.push(toRel); ops.push({ copy: from, to: toRel }); };
  const edit = (r, fn) => ops.push({ edit: r, fn });
  let dest;
  if (d.type === 'html') {
    dest = args.dest && args.dest !== true ? String(args.dest).replace(/\/$/, '') : 'swarm-rebuild';
    const pages = args.html && args.html !== true ? String(args.html).split(',') : walk(ROOT, [], 0).filter((r) => /\.html?$/i.test(r) && !r.startsWith(dest + '/'));
    if (!pages.length) die('no HTML file found (use --html)');
    // plain HTML: the minified files (built by scripts/build-min.cjs); bundlers (Next.js, Vite) minify the sources themselves
    const min = ['swarm-rebuild.min.js', 'swarm-rebuild.min.css', 'swarm-rebuild-debug.min.js'].every((f) => fs.existsSync(path.join(assets, f)));
    const JS = min ? 'swarm-rebuild.min.js' : 'swarm-rebuild.js', CSS = min ? 'swarm-rebuild.min.css' : 'swarm-rebuild.css';
    [JS, CSS, min ? 'swarm-rebuild-debug.min.js' : 'swarm-rebuild-debug.js'].forEach((f) => copy(path.join(assets, f), dest + '/' + f));
    pages.forEach((r) => {
      const src = read(r);
      if (!/<head[^>]*>/i.test(src) || !/<\/body>/i.test(src)) die(r + ': no <head> or </body>; add the snippet by hand (SKILL.md step 2)');
      const base = path.posix.relative(path.posix.dirname(r), dest) || '.';
      edit(r, (t) => {
        const cs = /<meta[^>]+charset[^>]*>[^\S\n]*\n?/i.exec(t), h = /<head[^>]*>[^\S\n]*\n?/i.exec(t);
        const at = cs && cs.index > h.index ? cs.index + cs[0].length : h.index + h[0].length; // after <meta charset> (it must stay in the first 1024 bytes)
        t = insertAt(t, at, block('html', '\n<script>' + snippet() + '</script>\n<link rel="stylesheet" href="' + base + '/' + CSS + '">\n', '', '\n'));
        const b = t.search(/<\/body>(?![\s\S]*<\/body>)/i);
        const attrs = ' data-auto' + (args.mode && args.mode !== true ? ' data-mode="' + args.mode + '"' : '') + (args.focus && args.focus !== true ? ' data-focus="' + String(args.focus).replace(/"/g, '&quot;') + '"' : '');
        return insertAt(t, b, block('html', '<script src="' + base + '/' + JS + '"' + attrs + '></script>', '', '\n'));
      });
    });
  } else {
    const inSrc = /^src\//.test(d.appLayout || d.doc || d.main || '');
    dest = args.dest && args.dest !== true ? String(args.dest).replace(/\/$/, '') : d.type === 'vite-react' ? 'src/swarm-rebuild' : (inSrc ? 'src/' : '') + 'components/swarm-rebuild';
    ['swarm-rebuild.js', 'swarm-rebuild.css', 'swarm-rebuild-debug.js'].forEach((f) => copy(path.join(assets, f), dest + '/' + f));
    copy(path.join(assets, 'react', 'SwarmRebuild.jsx'), dest + '/SwarmRebuild.jsx');
    const imp = (file, what) => { const r = path.posix.relative(path.posix.dirname(file), dest + '/SwarmRebuild'); return 'import ' + what + " from '" + (r.startsWith('.') ? r : './' + r) + "';"; };
    if (d.type === 'next-app') {
      const f = d.appLayout, src = read(f);
      if (!/<\/body>/.test(src) || !/<html\b/.test(src)) die(f + ': no <html> / </body> in the layout; add the components by hand (SKILL.md step 2)');
      edit(f, (t) => {
        t = insertAt(t, afterImports(t), block('js', '\n' + imp(f, 'SwarmRebuild, { SwarmRebuildHead }') + '\n', '', '\n'));
        const h = /<head\b[^>]*>/.exec(t);
        if (h) t = insertAt(t, h.index + h[0].length, block('jsx', '<SwarmRebuildHead />'));
        else { const m = /<html\b[^>]*>/.exec(t); t = insertAt(t, m.index + m[0].length, block('jsx', '<head><SwarmRebuildHead /></head>')); }
        return insertAt(t, t.lastIndexOf('</body>'), block('jsx', '<SwarmRebuild' + jsxProps() + ' />'));
      });
    } else if (d.type === 'next-pages') {
      const doc = read(d.doc), app = read(d.app);
      if (!/<Head\b[^>]*>/.test(doc)) die(d.doc + ': no <Head> element; add <SwarmRebuildHead /> by hand');
      if (!/<Component\b[^>]*\/>/.test(app)) die(d.app + ': no <Component ... />; add <SwarmRebuild /> by hand');
      edit(d.doc, (t) => {
        t = insertAt(t, afterImports(t), block('js', '\n' + imp(d.doc, '{ SwarmRebuildHead }') + '\n', '', '\n'));
        const h = /<Head\b[^>]*>/.exec(t);
        return insertAt(t, h.index + h[0].length, block('jsx', '<SwarmRebuildHead />'));
      });
      edit(d.app, (t) => {
        t = insertAt(t, afterImports(t), block('js', '\n' + imp(d.app, 'SwarmRebuild') + '\n', '', '\n'));
        const c = /<Component\b[^>]*\/>/.exec(t);
        if (/^\s*return\s*<Component/m.test(t) || /\(\s*<Component\b[^>]*\/>\s*\)/.test(t)) die(d.app + ': <Component /> is the only element; wrap it in a fragment and add <SwarmRebuild /> by hand');
        return insertAt(t, c.index + c[0].length, block('jsx', '<SwarmRebuild' + jsxProps() + ' />'));
      });
    } else if (d.type === 'vite-react') {
      edit('index.html', (t) => {
        const cs = /<meta[^>]+charset[^>]*>[^\S\n]*\n?/i.exec(t), h = /<head[^>]*>[^\S\n]*\n?/i.exec(t);
        if (!h) die('index.html: no <head>');
        const at = cs && cs.index > h.index ? cs.index + cs[0].length : h.index + h[0].length;
        return insertAt(t, at, block('html', '\n<script>' + snippet() + '</script>\n', '', '\n'));
      });
      edit(d.main, (t) => {
        // its own small React root (never attached to the page): the effect starts after mount, no change to <App />
        t = insertAt(t, afterImports(t), block('js', '\n' + imp(d.main, 'SwarmRebuild') + "\nimport { createRoot as swarmRebuildRoot } from 'react-dom/client';\n", '', '\n'));
        return t + block('js', '\nswarmRebuildRoot(document.createElement(\'div\')).render(<SwarmRebuild' + jsxProps() + ' />);\n', t.endsWith('\n') ? '' : '\n', '\n');
      });
    } else die('unknown --type ' + d.type);
  }
  // legacy/ never goes into git (so never into a git-based deploy)
  const gi = exists('.gitignore') ? read('.gitignore') : null;
  if (gi == null) { create.push('.gitignore'); ops.push({ write: '.gitignore', text: block('hash', '\nlegacy/\n', '', '\n') }); }
  else if (!/^\/?legacy\/?$/m.test(gi)) edit('.gitignore', (t) => t + block('hash', '\nlegacy/\n', t.endsWith('\n') || !t ? '' : '\n', '\n'));
  // the plan: back up everything that changes, refuse to overwrite files we would create
  const change = [...new Set(ops.filter((o) => o.edit).map((o) => o.edit))];
  create.forEach((r) => { guard(r); if (exists(r)) die(r + ' already exists (remove it or use --dest)'); });
  const result = {};
  ops.filter((o) => o.edit).forEach((o) => { curFile = o.edit; result[o.edit] = o.fn(result[o.edit] != null ? result[o.edit] : read(o.edit)); curFile = null; });
  const inserted = INSERTED;
  const { dir } = makeBackup('install', { change, create }, { type: d.type, dest, inserted });
  if (DRY) { console.log('dry run, nothing written. type ' + d.type + ', would change: ' + change.join(', ') + '; would create: ' + create.join(', ')); return; }
  ops.forEach((o) => {
    if (o.copy) { fs.mkdirSync(path.dirname(abs(o.to)), { recursive: true }); fs.copyFileSync(o.copy, abs(o.to)); }
    if (o.write) fs.writeFileSync(abs(o.write), o.text);
  });
  Object.keys(result).forEach((r) => fs.writeFileSync(abs(r), result[r]));
  // remember what we created (hashes), for uninstall
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  man.created = create.map((r) => ({ path: r, sha256: sha(fs.readFileSync(abs(r))) }));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(man, null, 2) + '\n');
  console.log('installed (' + d.type + '): changed ' + change.join(', ') + '; created ' + create.join(', '));
  console.log('backup: ' + rel(dir) + ' (restore: node ' + rel(__filename) + ' restore --project ' + ROOT + ')');
}
function hasMarkers() {
  return walk(ROOT, [], 0).concat(exists('.gitignore') ? ['.gitignore'] : []).some((r) => /\.(html?|jsx?|tsx?|mjs)$|^\.gitignore$/.test(r) && /swarm-rebuild:start/.test(read(r)));
}

// --------------------------------------------------------------- uninstall
function strip(text, inserted) {
  let t = text;
  (inserted || []).slice().reverse().forEach((s) => { const i = t.lastIndexOf(s); if (i >= 0) t = t.slice(0, i) + t.slice(i + s.length); });
  // anything still marked (edited by hand since): remove the marked block itself
  return t.replace(/<!-- swarm-rebuild:start -->[\s\S]*?<!-- swarm-rebuild:end -->\n?|\/\/ swarm-rebuild:start[\s\S]*?\/\/ swarm-rebuild:end\n?|\{\/\* swarm-rebuild:start \*\/\}[\s\S]*?\{\/\* swarm-rebuild:end \*\/\}|# swarm-rebuild:start[\s\S]*?# swarm-rebuild:end\n?/g, '');
}
function uninstall() {
  const ins = backupsList().filter((b) => b.action === 'install' && !b.removed).pop();
  const files = ins ? ins.files.map((f) => f.path) : walk(ROOT, [], 0).filter((r) => /\.(html?|jsx?|tsx?|mjs)$/.test(r) && /swarm-rebuild:start/.test(read(r)));
  if (!ins && exists('.gitignore') && /swarm-rebuild:start/.test(read('.gitignore'))) files.push('.gitignore');
  const created = ins ? ins.created.map((c) => c.path).filter(exists) : [];
  const change = files.filter(exists).filter((r) => /swarm-rebuild:start/.test(read(r)));
  if (!change.length && !created.length) die('nothing to remove (no install found)');
  const { dir } = makeBackup('uninstall', { change: change.concat(created), create: [] }, { install: ins ? ins.name : null });
  if (DRY) { console.log('dry run: would clean ' + change.join(', ') + ' and delete ' + created.join(', ')); return; }
  change.forEach((r) => fs.writeFileSync(abs(r), strip(read(r), ins && ins.inserted && ins.inserted[r])));
  created.forEach((r) => { fs.rmSync(abs(r), { force: true }); pruneDirs(path.posix.dirname(r)); });
  // check against the backup taken before the install
  const report = [];
  if (ins) ins.files.forEach((f) => {
    const now = exists(f.path) ? sha(fs.readFileSync(abs(f.path))) : null;
    report.push(f.path + (now === f.sha256 ? ': identical to before the install' : ': differs from before the install (changed by hand since, kept)'));
  });
  if (ins) { const mf = path.join(ROOT, 'legacy', ins.name, 'manifest.json'), m = JSON.parse(fs.readFileSync(mf, 'utf8')); m.removed = new Date().toISOString(); fs.writeFileSync(mf, JSON.stringify(m, null, 2) + '\n'); }
  console.log('removed. cleaned ' + change.join(', ') + '; deleted ' + created.join(', '));
  report.forEach((l) => console.log('  ' + l));
  if (args.purge) { fs.rmSync(abs('legacy'), { recursive: true, force: true }); console.log('legacy/ deleted (--purge)'); }
  else console.log('backups kept in legacy/ (latest: ' + rel(dir) + '); --purge deletes them');
}
function pruneDirs(r) {
  while (r && r !== '.' && r !== '') {
    const p = abs(r);
    if (!fs.existsSync(p) || fs.readdirSync(p).length) return;
    fs.rmdirSync(p);
    r = path.posix.dirname(r);
  }
}

// ----------------------------------------------------------------- restore
function restore() {
  const all = backupsList();
  if (!all.length) die('no backup in ' + rel(abs('legacy')) + '/');
  const want = args.backup && args.backup !== true && args.backup !== 'latest' ? String(args.backup) : null;
  const b = want ? all.find((x) => x.name === want) : all.filter((x) => x.action === 'install').pop() || all[all.length - 1];
  if (!b) die('no backup named ' + want + ' (see: list)');
  const dir = abs(path.join('legacy', b.name));
  if (DRY) { console.log('dry run: would restore ' + b.files.map((f) => f.path).join(', ') + ' and delete ' + b.created.map((c) => c.path).join(', ')); return; }
  b.files.forEach((f) => {
    guard(f.path);
    const buf = fs.readFileSync(path.join(dir, 'files', f.path + '.orig'));
    if (sha(buf) !== f.sha256) die('backup of ' + f.path + ' is damaged (hash mismatch); nothing restored for it');
    fs.mkdirSync(path.dirname(abs(f.path)), { recursive: true });
    fs.writeFileSync(abs(f.path), buf);
  });
  b.created.forEach((c) => { guard(c.path); if (exists(c.path)) fs.rmSync(abs(c.path), { force: true }); pruneDirs(path.posix.dirname(c.path)); });
  const bad = b.files.filter((f) => sha(fs.readFileSync(abs(f.path))) !== f.sha256).map((f) => f.path).concat(b.created.filter((c) => exists(c.path)).map((c) => c.path + ' (still there)'));
  if (b.action === 'install') { const mf = path.join(dir, 'manifest.json'), m = JSON.parse(fs.readFileSync(mf, 'utf8')); m.removed = new Date().toISOString(); fs.writeFileSync(mf, JSON.stringify(m, null, 2) + '\n'); }
  if (bad.length) die('restore incomplete: ' + bad.join(', '));
  console.log('restored from ' + b.name + ': ' + b.files.length + ' files identical to the backup (SHA-256), ' + b.created.length + ' created files removed');
}

function list() {
  const all = backupsList();
  if (!all.length) { console.log('no backups'); return; }
  all.forEach((b) => console.log(b.name + '  ' + b.action + (b.removed ? ' (undone ' + b.removed + ')' : '') + '  files: ' + b.files.map((f) => f.path).join(', ')));
}

if (!fs.existsSync(ROOT) || !fs.statSync(ROOT).isDirectory()) die('no such project folder: ' + ROOT);
({ install, uninstall, restore, list }[CMD] || (() => die('usage: project.cjs install|uninstall|restore|list --project <dir> (see the header of this file)')))();
