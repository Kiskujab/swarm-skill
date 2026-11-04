#!/usr/bin/env node
/*
 * record-video.cjs — records the effect as a video for a portfolio or a client presentation (Playwright + ffmpeg).
 *
 *   node scripts/record-video.cjs --url http://localhost:3000/ [--out swarm-demo.mp4] [--mode tour|scroll]
 *                                 [--speed 1] [--size 1280x720] [--device desktop|mobile] [--hud] [--tail 2.5]
 *                                 [--palette page] [--timeout 300]
 *
 * tour (default) is the debug auto-scroll through the whole page (the debug add-on is loaded for it; its control bar
 * is hidden unless --hud); scroll reads down the page with the mouse wheel like a visitor. The video ends --tail
 * seconds after the swarms gathered at the end. Output: .mp4 (H.264, plays everywhere) or .webm. Needs the
 * playwright package with its Chromium, and ffmpeg for .mp4 (and for trimming the blank start).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createRequire } = require('module');

const args = {};
process.argv.slice(2).forEach((a, i, arr) => { if (a.startsWith('--')) args[a.slice(2)] = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true; });
if (!args.url) { console.error('usage: node record-video.cjs --url <page url> [--out swarm-demo.mp4] (see the header of this file)'); process.exit(2); }
const OUT = path.resolve(String(args.out || 'swarm-demo.mp4'));
const MODE = args.mode === 'scroll' ? 'scroll' : 'tour';
const MOBILE = args.device === 'mobile';
const [W, H] = String(args.size || (MOBILE ? '390x844' : '1280x720')).split('x').map(Number);
const TAIL = Number(args.tail || 2.5);
const kill = setTimeout(() => { console.error('record-video: time limit'); process.exit(3); }, Number(args.timeout || 300) * 1000);

function loadPlaywright() {
  for (const t of [__filename, path.join(process.cwd(), 'index.js'), '/opt/node-tools/node_modules/x.js']) { try { return createRequire(t)('playwright'); } catch (e) { /* next */ } }
  try { return require('playwright'); } catch (e) { console.error('the playwright package is needed: npm i -D playwright && npx playwright install chromium'); process.exit(2); }
}

(async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-video-'));
  const ctx = await browser.newContext(Object.assign({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir, size: { width: W, height: H } } }, MOBILE ? { isMobile: true, hasTouch: true } : {}));
  if (!args.hud) await ctx.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '#swarm-rebuild-root .sr-hud{display:none!important}'; document.head.appendChild(s); }); });
  const t0 = Date.now();
  const page = await ctx.newPage();
  const u = new URL(String(args.url));
  u.searchParams.set('rebuild', '1'); u.searchParams.set('rebuild-mode', MODE);
  if (MODE === 'tour') u.searchParams.set('rebuild-debug', '1');
  if (args.speed) { u.searchParams.set('rebuild-speed', String(args.speed)); u.searchParams.set('rebuild-debug', '1'); }
  if (args.palette) { u.searchParams.set('rebuild-palette', String(args.palette)); u.searchParams.set('rebuild-debug', '1'); }
  await page.goto(u.toString(), { waitUntil: 'domcontentloaded' });
  let startAt = null, doneAt = null, s = {};
  const end = Date.now() + Number(args.timeout || 300) * 1000 - 15000;
  while (Date.now() < end) {
    s = await page.evaluate(() => (window.SwarmRebuild ? window.SwarmRebuild.state() : { phase: 'none' })).catch(() => ({ phase: 'err' }));
    if (startAt == null && (s.phase === 'scan' || s.phase === 'build')) startAt = (Date.now() - t0) / 1000;
    if (s.phase === 'done' && doneAt == null) doneAt = Date.now();
    if (doneAt && Date.now() - doneAt > TAIL * 1000) break;
    if (s.phase === 'idle' && startAt != null) break;
    if (MODE === 'scroll' && s.phase === 'build') await page.mouse.wheel(0, Math.round(H * 0.3));
    await page.waitForTimeout(MODE === 'scroll' ? 450 : 100);
  }
  const video = page.video();
  await ctx.close();
  const raw = await video.path();
  await browser.close();
  const ss = Math.max(0, (startAt || 0) - 0.2).toFixed(2);
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    const enc = /\.webm$/i.test(OUT) ? ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32'] : ['-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', ss, '-i', raw].concat(enc, ['-an', OUT]), { timeout: 240000 });
  } catch (e) {
    if (!/\.webm$/i.test(OUT)) { console.error('ffmpeg is needed for .mp4 (' + (e.message || e).split('\n')[0] + '); keeping the raw .webm'); }
    fs.copyFileSync(raw, OUT.replace(/\.mp4$/i, '.webm'));
  }
  fs.rmSync(dir, { recursive: true, force: true });
  const st = fs.existsSync(OUT) ? fs.statSync(OUT) : null;
  console.log((st ? 'video: ' + OUT + ' (' + (st.size / 1024 / 1024).toFixed(1) + ' MB)' : 'no video written') + ', build ' + (s.elapsed ? s.elapsed.toFixed(1) + ' s' : '?') + ', mode ' + MODE + (args.speed ? ' x' + args.speed : ''));
  clearTimeout(kill);
  process.exit(st ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
