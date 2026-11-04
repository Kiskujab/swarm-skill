#!/usr/bin/env node
/*
 * build-min.cjs — builds the minified files visitors download (the readable sources stay as they are):
 *   assets/swarm-rebuild.min.js, assets/swarm-rebuild-debug.min.js, assets/swarm-rebuild.min.css
 * and prints raw / minified / gzip sizes against the size budget.
 *
 *   node scripts/build-min.cjs [--modules <folder with node_modules containing terser and csso>] [--check]
 *
 * Needs terser and csso (npm i terser csso, anywhere; pass that folder with --modules). --check rebuilds in memory
 * and fails when the committed .min files are out of date or over budget.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const args = {};
process.argv.slice(2).forEach((a, i, arr) => { if (a.startsWith('--')) args[a.slice(2)] = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true; });
const A = path.resolve(__dirname, '..', 'assets');
// size budget for what a visitor downloads (module + stylesheet, minified, gzip)
const BUDGET = { js: 30 * 1024, css: 2 * 1024 }; // 1.3.0: 27.5 + 1.6 KB
const paths = [process.cwd(), __dirname].concat(args.modules && args.modules !== true ? [path.resolve(String(args.modules))] : []);
function need(name) {
  try { return require(require.resolve(name, { paths })); } catch (e) { console.error('build-min: ' + name + ' not found (npm i terser csso, then --modules <that folder>)'); process.exit(2); }
}
const terser = need('terser'), csso = need('csso');
const gz = (b) => zlib.gzipSync(b, { level: 9 }).length;
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

(async () => {
  const out = [];
  for (const f of ['swarm-rebuild.js', 'swarm-rebuild-debug.js']) {
    const src = fs.readFileSync(path.join(A, f), 'utf8');
    const r = await terser.minify(src, { ecma: 2015, compress: { passes: 2 }, mangle: true, format: { comments: /^!/ } });
    out.push({ file: f.replace(/\.js$/, '.min.js'), code: r.code + '\n', raw: Buffer.byteLength(src) });
  }
  const css = fs.readFileSync(path.join(A, 'swarm-rebuild.css'), 'utf8');
  out.push({ file: 'swarm-rebuild.min.css', code: csso.minify(css, { comments: 'exclamation' }).css + '\n', raw: Buffer.byteLength(css) });
  let stale = 0;
  out.forEach((o) => {
    const p = path.join(A, o.file);
    o.min = Buffer.byteLength(o.code); o.gzip = gz(Buffer.from(o.code));
    if (args.check) { if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== o.code) { stale++; console.log('out of date: assets/' + o.file); } }
    else fs.writeFileSync(p, o.code);
    console.log(o.file.padEnd(28) + ' source ' + kb(o.raw).padStart(9) + '   minified ' + kb(o.min).padStart(9) + '   gzip ' + kb(o.gzip).padStart(8));
  });
  const js = out[0].gzip, cs = out[2].gzip;
  const over = js > BUDGET.js || cs > BUDGET.css;
  console.log('visitor download (module + stylesheet, gzip): ' + kb(js + cs) + '  (budget: js ' + kb(BUDGET.js) + ', css ' + kb(BUDGET.css) + (over ? ' — OVER BUDGET' : ' — within budget') + '); the debug add-on is never loaded for visitors');
  process.exit(stale || over ? 1 : 0);
})();
