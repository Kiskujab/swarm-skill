/*
 * next-app.cjs — prepares the Next.js test app (tests/pages/nextjs) in a temporary folder, the way SKILL.md
 * tells you to install the module in a real project: the module files from assets/ are copied into
 * components/swarm-rebuild/. Dependencies are installed there with npm (only when package.json changed).
 * Nothing is written into the skill folder.
 *
 *   const { prepareNext, buildNext, nextBin } = require('./next-app.cjs');
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SKILL = path.resolve(__dirname, '..');

function copyDir(src, dst, skip) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip && skip.includes(e.name)) continue;
    const a = path.join(src, e.name), b = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(a, b, skip); else fs.copyFileSync(a, b);
  }
}
function run(cmd, argv, opt) {
  console.log('$ ' + cmd + ' ' + argv.join(' '));
  const r = spawnSync(cmd, argv, Object.assign({ stdio: 'inherit' }, opt));
  if (r.status !== 0) throw new Error(cmd + ' ' + argv.join(' ') + ' failed (' + (r.error ? r.error.message : 'exit ' + r.status) + ')');
}
// returns the work folder with dependencies installed
function prepareNext(work) {
  work = work || path.join(os.tmpdir(), 'page-swarm-rebuild-next');
  copyDir(path.join(SKILL, 'tests', 'pages', 'nextjs'), work, ['node_modules', '.next', 'out', 'components']);
  const comp = path.join(work, 'components', 'swarm-rebuild');
  fs.mkdirSync(comp, { recursive: true });
  ['swarm-rebuild.js', 'swarm-rebuild.css', 'swarm-rebuild-debug.js'].forEach((f) => fs.copyFileSync(path.join(SKILL, 'assets', f), path.join(comp, f)));
  fs.copyFileSync(path.join(SKILL, 'assets', 'react', 'SwarmRebuild.jsx'), path.join(comp, 'SwarmRebuild.jsx'));
  const pkg = fs.readFileSync(path.join(work, 'package.json'), 'utf8');
  const stamp = path.join(work, 'node_modules', '.installed-from');
  if (!fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== pkg) {
    run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: work, timeout: 600000 });
    fs.writeFileSync(stamp, pkg);
  }
  return work;
}
const nextBin = (work) => path.join(work, 'node_modules', 'next', 'dist', 'bin', 'next');
// next build; with exportBase (a path such as /swarm-skill/tests/pages/nextjs or '') a static export into out/
function buildNext(work, exportBase) {
  const env = Object.assign({}, process.env, { NEXT_TELEMETRY_DISABLED: '1' });
  if (exportBase != null) { env.NEXT_EXPORT = '1'; env.NEXT_BASE_PATH = exportBase; fs.rmSync(path.join(work, 'out'), { recursive: true, force: true }); }
  fs.rmSync(path.join(work, '.next'), { recursive: true, force: true });
  run(process.execPath, [nextBin(work), 'build'], { cwd: work, timeout: 600000, env });
  return exportBase != null ? path.join(work, 'out') : null;
}

module.exports = { SKILL, copyDir, run, prepareNext, buildNext, nextBin };
