---
name: page-swarm-rebuild
description: Adds the "page rebuilds itself" effect to an existing website (plain HTML, React or Next.js) - a swarm of colourful agent cursors hides the finished page, then rebuilds it layer by layer (selection frames with size labels, typing, image reveals, clone-and-rewrite of repeated items, rulers and guides) while the page auto-scrolls, with a small control bar ("18 agents | 112 / 364 layers", Tour, 1x, sound, close, "Rebuilt by N agents in T s", Go live, Replay). Use when the user asks for a cursor swarm / agents rebuilding the page, a "Figma multiplayer building the site" intro, a "page builds itself" or "rebuild animation" effect, or mentions page-swarm-rebuild.
---

# page-swarm-rebuild

Presentation-only intro effect. The page's real DOM is never modified: layers are hidden and revealed with one
cascade-layered stylesheet in `<head>`, all animation happens in an overlay appended to `<html>`, and both are removed
at the end. No dependencies, no network requests (GDPR-friendly), no layout shift.

Spec of the original effect (timeline, visuals, HUD, scroll curve): `references/effekt-leiras.md` (Hungarian).

## Files

| File | Purpose |
|---|---|
| `assets/swarm-rebuild.js` | The module (classic script, sets `window.SwarmRebuild`; also importable from a bundler). |
| `assets/swarm-rebuild.css` | Overlay styles, all scoped under `#swarm-rebuild-root`. |
| `assets/react/SwarmRebuild.jsx` | React / Next.js client wrapper + `<SwarmRebuildHead />` (pre-paint snippet). |
| `assets/demo/` | Fictional dark portfolio demo used for testing (`assets/demo/index.html`). |
| `scripts/verify.cjs` | Playwright check: recording, timeline, DOM/pixel identity, CLS, fps, Esc/✕/Replay, reduced motion, no-JS, contact sheets. |

## Modes

| mode | speed | behaviour |
|---|---|---|
| `fast` (default) | 6x | Same as `tour`, about 6x faster (~6-10 s). For client sites. Auto "Go live" 6 s after finishing. |
| `tour` | 1x | As in the reference video: ~layers/7 seconds (51 s for 364 layers), auto-scroll follows the work front, ends at the bottom with the ring of cursors. Stays until "Go live". |
| `scroll` | 3x | No auto-scroll. Agents build the viewport and the next viewport height; the visitor's scrolling drives it. |

The HUD `1x` button multiplies the mode speed (1x -> 2x -> 4x). Manual scrolling (wheel, touch, keys) stops the tour; the
`Tour` button resumes it.

## Workflow

### 1. Inspect the target project
- Find the framework: `package.json` (`next`, `react`, `vite`), or plain `.html` files.
- Find the root layout / main HTML file and where global CSS and scripts are loaded.
- Note anything that must never be hidden or animated: phone numbers, booking widgets, cookie banners, chat bubbles,
  fixed headers. `a[href^="tel:"]` and `position: fixed` elements are already shown instantly; add others to `exclude`
  or mark them `data-swarm-instant`.
- Check whether the site has its own "reduce motion" switch; pass its selector as `motionOffSelector`.
- If the page scrolls inside an inner container instead of the window, the auto-scroll cannot drive it: use `mode: 'scroll'`.

### 2. Install the module

**Plain HTML** - copy `swarm-rebuild.js` and `swarm-rebuild.css` into the site (e.g. `/assets/swarm-rebuild/`), then:

```html
<head>
  ...
  <!-- must be inline and early in <head>: hides content before first paint, layout untouched -->
  <script>(function(d,w){w.__swarmRebuildSnippet=1;try{var q=new URLSearchParams(location.search).get('rebuild');if(q==='0')return;if(w.matchMedia&&w.matchMedia('(prefers-reduced-motion: reduce)').matches)return;if(q!=='1'&&sessionStorage.getItem('swarm-rebuild:seen'))return;var s=d.createElement('style');s.id='swarm-rebuild-hide';s.textContent='@layer swarm-rebuild{body *{visibility:hidden!important}}';d.head.appendChild(s);setTimeout(function(){var r=w.SwarmRebuild;if(!(r&&r.active)){var e=d.getElementById('swarm-rebuild-hide');if(e)e.remove()}},5000)}catch(e){}})(document,window);</script>
  <link rel="stylesheet" href="/assets/swarm-rebuild/swarm-rebuild.css">
</head>
<body>
  ...
  <script src="/assets/swarm-rebuild/swarm-rebuild.js" data-auto data-mode="fast"></script>
</body>
```
(or omit `data-auto` and call `SwarmRebuild.start({ mode: 'fast', ... })` yourself). The snippet text is also
available at runtime as `SwarmRebuild.headSnippet()`.

**Next.js (App Router)** - copy `swarm-rebuild.js`, `swarm-rebuild.css` and `react/SwarmRebuild.jsx` into one folder,
e.g. `components/swarm-rebuild/`. In `app/layout.tsx`:

```tsx
import SwarmRebuild, { SwarmRebuildHead } from '@/components/swarm-rebuild/SwarmRebuild';
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head><SwarmRebuildHead /></head>
      <body>
        {children}
        <SwarmRebuild mode="fast" />
      </body>
    </html>
  );
}
```
Pages Router: put `<SwarmRebuildHead />` in `pages/_document.tsx` `<Head>` and `<SwarmRebuild />` in `pages/_app.tsx`.
**React (Vite/CRA)**: paste the snippet into `index.html` `<head>` and render `<SwarmRebuild />` once in `App`.
The wrapper starts the effect after mount only and is StrictMode-safe.

### 3. Configure
`SwarmRebuild.start(options)` / `<SwarmRebuild {...options} />` / `window.SwarmRebuildConfig = {...}`:

| option | default | notes |
|---|---|---|
| `mode` | `'fast'` | `'tour'`, `'fast'`, `'scroll'` |
| `speed` | per mode | base time scale (1 = video timing) |
| `agents` | auto | max agents; auto = layers/12 clamped to 6..30 (mobile <= 8). Starts at 60 % and grows per section. |
| `colors` | pastel set | agent colours (teal, pink, peach, lavender, sky, mint, white) |
| `exclude` | `''` | selector: shown immediately, never animated |
| `instant` | `a[href^="tel:"],[data-swarm-instant]` | selector: shown immediately |
| `sectionSelector` | `header,section,footer,[data-swarm-section]` | top-level bands built one after another |
| `motionOffSelector` | `[data-motion="off"],.motion-off,.reduce-motion` | if it matches, the effect is skipped |
| `skipIf` | `null` | function -> `true` skips |
| `monogram` | first letter of `<title>` | faint letter shown while scanning |
| `once` | `true` | once per browser session (`sessionStorage`); `?rebuild=1` forces, `?rebuild=0` disables |
| `autoExit` | `tour`: none, others: 6 | seconds after finishing to "Go live" automatically |
| `groupMin` | `3` | min. repeated siblings for clone-and-rewrite (2 for big cards) |
| `rulers` | `true` | rulers on desktop |
| `sound` | `false` | tiny WebAudio clicks, toggle in the HUD |
| `onDone` | `null` | callback `{elapsed, layers, agents}` or `{skipped:true}` |

URL overrides for testing: `?rebuild=1` (force), `?rebuild=0` (off), `?rebuild-mode=tour`.
API: `SwarmRebuild.skip()`, `.goLive()`, `.replay()`, `.stop()`, `.state()`, `.stats()`.

### 4. Run and verify with Playwright
Serve the site, then (Playwright must be installed in the project or globally: `npm i -D playwright && npx playwright install chromium`):

```bash
node .claude/skills/page-swarm-rebuild/scripts/verify.cjs --url http://localhost:3000/ --mode fast --out ./swarm-check
# video timing + side-by-side with a reference video (optional):
node .claude/skills/page-swarm-rebuild/scripts/verify.cjs --url http://localhost:3000/ --mode tour --checks record --video ref.mp4
```
All checks must pass: run to the end, HUD texts, monotonic counters, auto-scroll ends at the bottom, >= 50 fps,
**body DOM identical** to `?rebuild=0`, **< 0.5 % pixel difference**, overlay/styles removed, CLS < 0.01,
reduced-motion skip, Esc / ✕ / Replay, page visible without JS. Look at `swarm-check/sheet-*.jpg` with your own eyes too
(frames are in `swarm-check/frames/`). For Next.js also check the browser console for hydration warnings.

Typical fixes: a section is too dense or a widget behaves oddly -> add it to `exclude`; a sticky/fixed bar flickers ->
`data-swarm-instant`; the page uses its own scroll-reveal animations (elements start at opacity 0) -> those elements are
skipped by the scan and appear when the page animates them, which is expected.

### 5. Report
Tell the user: mode and options chosen, files added/changed, verify results (build time, layers, agents, fps, DOM/pixel
diff), anything excluded and why, and how to turn it off (`?rebuild=0`, remove the snippet + script).

## How it works (for debugging)
- **Scan**: walks `body`, measures each element once (hide sheet briefly disabled in the same task, so nothing paints),
  classifies layers: `text` (heading / number sub-types), `media`, `icon`, `button`, `box`, `line`, `control`.
  Elements hidden by the page itself, fixed elements and overflow-clipped parts are left out (shown instantly / at section end).
  Repeated similar siblings become a clone group: the first is built, the rest are cloned and rewritten.
- **Hide/reveal**: `@layer swarm-rebuild { body * { visibility: hidden !important } }` + per-layer
  `:nth-child` path rules (`visible` for the element, `revert-layer` for its subtree, so the page's own `visibility`
  rules still apply). `visibility` never changes layout. Selectors are rebuilt if the app re-renders (MutationObserver).
- **Proxies**: typing, scaling headings and clones use deep clones with computed styles inlined, positioned in the overlay;
  the real element is revealed under the proxy at the end of each task, so the swap is invisible.
- **Scheduler**: per section, big frames are blocked first, then reading order; a token bucket keeps ~7 layers/s x speed;
  the nearest idle agent takes the next task; the camera keeps the lowest active layer in the lower third
  (base 0.09 viewport heights/s x speed, up to 3x when the next section's frames reach the bottom edge).
- **Accessibility**: `prefers-reduced-motion` skips everything; Esc or ✕ shows the finished page immediately; the
  decorative overlay is `aria-hidden`; the HUD is a labelled region with real buttons. While the effect runs, hidden
  content is also hidden from screen readers (it is `visibility: hidden`), which is why `fast` is the default.
