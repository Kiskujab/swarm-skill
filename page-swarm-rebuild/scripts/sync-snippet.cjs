#!/usr/bin/env node
/*
 * sync-snippet.cjs — writes the module's current head snippet (SwarmRebuild.headSnippet()) into every place that
 * carries a copy: the React wrapper, SKILL.md and the test pages. Run it after changing the snippet in the module.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const SKILL = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(SKILL, 'assets', 'swarm-rebuild.js'), 'utf8');
const get = (re) => { const m = re.exec(src); if (!m) throw new Error('not found: ' + re); return m[1]; };
const HIDE_CSS = new Function('LAYER', 'ROOT_ID', 'return ' + get(/var HIDE_CSS = ([^;]+);/))(get(/var LAYER = '([^']+)'/), get(/var ROOT_ID = '([^']+)'/));
const DMS_MS = +get(/var DMS_MS = (\d+);/);
const SNIPPET = new Function('HIDE_CSS', 'DMS_MS', 'return ' + get(/var SNIPPET = ("[^\n]*");\n/))(HIDE_CSS, DMS_MS);
new Function(SNIPPET); // must parse
const RE = /<script>\(function\(d,w\)\{w\.__swarmRebuildSnippet=1;[^\n]*?\}\)\(document,window\);<\/script>/g;
const files = [path.join(SKILL, 'SKILL.md'), path.join(SKILL, 'assets', 'demo', 'index.html')];
const pages = path.join(SKILL, 'tests', 'pages');
fs.readdirSync(pages).forEach((d) => { const f = path.join(pages, d, 'index.html'); if (fs.existsSync(f)) files.push(f); });
let n = 0;
files.forEach((f) => {
  const t = fs.readFileSync(f, 'utf8'), u = t.replace(RE, () => '<script>' + SNIPPET + '</script>');
  if (u !== t) { fs.writeFileSync(f, u); n++; console.log('updated ' + path.relative(SKILL, f)); }
});
const jsx = path.join(SKILL, 'assets', 'react', 'SwarmRebuild.jsx');
const j = fs.readFileSync(jsx, 'utf8'), k = j.replace(/(SWARM_REBUILD_HEAD_SNIPPET =\s*\n?\s*)"(?:[^"\\]|\\.)*"/, (m, a) => a + JSON.stringify(SNIPPET));
if (k !== j) { fs.writeFileSync(jsx, k); n++; console.log('updated assets/react/SwarmRebuild.jsx'); }
console.log(n + ' file(s) updated');
