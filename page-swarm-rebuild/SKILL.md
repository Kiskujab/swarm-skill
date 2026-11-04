---
name: page-swarm-rebuild
description: Adds the "page rebuilds itself" effect to an existing website (plain HTML, React or Next.js) - a swarm of colourful agent cursors hides the finished page, then rebuilds it layer by layer (selection frames with size labels, typing, image reveals, clone-and-rewrite of repeated items, rulers and guides). The build follows the visitor's scrolling (agents work where the visitor looks); an optional auto-scrolling "tour" and a small collapsible control bar at the right edge exist for testing and recordings. No sound. Use when the user asks for a cursor swarm / agents rebuilding the page, a "Figma multiplayer building the site" intro, a "page builds itself" or "rebuild animation" effect, or mentions page-swarm-rebuild.
---

# page-swarm-rebuild

Presentation-only intro effect. The page's real DOM is never modified: layers are hidden and revealed with one
cascade-layered stylesheet in `<head>`, all animation happens in an overlay appended to `<html>`, and both are removed
at the end. No dependencies, no network requests (GDPR-friendly), no layout shift, no sound.

Spec of the original effect (timeline, visuals, HUD, scroll curve): `references/effekt-leiras.md` (Hungarian). Where it
and this file disagree, this file wins (product decisions were made after the description was written).

## Files

| File | Purpose |
|---|---|
| `assets/swarm-rebuild.js` | The module (classic script, sets `window.SwarmRebuild`; also importable from a bundler). |
| `assets/swarm-rebuild.css` | Overlay styles, all scoped under `#swarm-rebuild-root`. |
| `assets/react/SwarmRebuild.jsx` | React / Next.js client wrapper + `<SwarmRebuildHead />` (pre-paint snippet). |
| `assets/demo/` | Fictional dark portfolio demo (`assets/demo/index.html`, 214 layers (desktop), 6.6 viewport heights). |
| `tests/pages/dental/` | Fictional dental practice page: light theme, phone links, fixed "Call us" + booking bar on mobile. |
| `tests/pages/nextjs/` | Fictional Next.js 15 App Router app with a React counter button (hydration check). |
| `scripts/verify.cjs` | Playwright check of one page: recording, timeline, DOM/pixel identity, CLS, fps, Esc/✕/Replay, reduced motion, no-JS, manual scrolling, control-bar overlap, console errors. |
| `scripts/run-tests.cjs` | Runs `verify.cjs` on the three test pages, desktop and mobile; prints a summary table. |

## Product decisions (they override the reference video)

- **Main mode is `scroll`:** the build is driven by the visitor's scrolling; agents work on what is in view.
- **No sound.** The module has no audio code.
- **Control bar and auto-scroll tour are test / debugging tools**, not part of the product a visitor should see.
- **Always a way out without visible controls:** Esc finishes at once; `prefers-reduced-motion` skips the effect
  (WCAG 2.2.2: animation longer than 5 s must be stoppable).

**Not yet implemented in module v1.0.1** (do not promise these to the user; they are planned):
- The control bar is still shown in every mode (there is no `debug` flag yet that hides it), and `fast`/`tour` still
  auto-scroll. For a client site use `mode: 'scroll'` today; the bar can be collapsed but not removed.
- Only Esc (and the bar's ✕ / Go live) finish the effect; "any click or key finishes it" is not implemented.
- The default `mode` in code is still `'fast'`; pass `mode: 'scroll'` explicitly.

## Modes

| mode | speed | behaviour |
|---|---|---|
| `scroll` (recommended for client sites) | 3x | No auto-scroll. Agents build only what is in view and at most 0.5 viewport height below it. When the visitor scrolls onto unbuilt layers, those start first, more agents join (up to 8 above plan) and tasks run faster; tasks the visitor scrolled away from finish quickly out of sight. When the visitor reaches the bottom, whatever is left above is finished out of sight. |
| `fast` (code default) | 6x | Auto-scroll tour, about 6x the video speed (~7-10 s). Auto "Go live" 6 s after finishing. |
| `tour` | 1x | As in the reference video: ~layers/7 seconds, auto-scroll follows the work front, ends at the bottom with the ring of cursors. Stays until "Go live". For recordings and side-by-side checks. |

In `fast` and `tour`, manual scrolling (wheel, touch, arrow/page keys) stops the tour and the run continues like
`scroll` mode from where the visitor is (agents come to the visible part). Pressing `Tour` again resumes the tour
from the current position; what lies above is finished out of sight. The bar's `1×` button multiplies the speed
(1x -> 2x -> 4x).

## Workflow

### 1. Inspect the target project
- Find the framework: `package.json` (`next`, `react`, `vite`), or plain `.html` files.
- Find the root layout / main HTML file and where global CSS and scripts are loaded.
- Note anything that must never be hidden or animated: phone numbers, booking widgets, cookie banners, chat bubbles,
  fixed headers. `a[href^="tel:"]` and `position: fixed` elements are already shown instantly (also inside repeated
  rows); add others to `exclude` / `instant` or mark them `data-swarm-instant`.
- Check whether the site has its own "reduce motion" switch; pass its selector as `motionOffSelector`.
- If the page scrolls inside an inner container instead of the window, the tour cannot drive it: use `mode: 'scroll'`.
- Site-specific choices (an element to skip, a different section selector) go into the config of that site, never
  into the module.

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
  <script src="/assets/swarm-rebuild/swarm-rebuild.js" data-auto data-mode="scroll"></script>
</body>
```
(or omit `data-auto` and call `SwarmRebuild.start({ mode: 'scroll', ... })` yourself). `data-auto` reads
`data-mode`, `data-speed`, `data-agents`, `data-exclude`, `data-controls-position` and `data-once="false"`.
The snippet text is also available at runtime as `SwarmRebuild.headSnippet()`.
Working example: `tests/pages/dental/index.html`.

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
        <SwarmRebuild mode="scroll" />
      </body>
    </html>
  );
}
```
Pages Router: put `<SwarmRebuildHead />` in `pages/_document.tsx` `<Head>` and `<SwarmRebuild />` in `pages/_app.tsx`.
**React (Vite/CRA)**: paste the snippet into `index.html` `<head>` and render `<SwarmRebuild />` once in `App`.
The wrapper starts the effect after mount only and is StrictMode-safe. Working example: `tests/pages/nextjs/`.

### 3. Configure
`SwarmRebuild.start(options)` / `<SwarmRebuild {...options} />` / `window.SwarmRebuildConfig = {...}`:

| option | default | notes |
|---|---|---|
| `mode` | `'fast'` | `'scroll'` (recommended), `'fast'`, `'tour'` |
| `speed` | per mode | base time scale (1 = video timing); scroll 3, fast 6, tour 1 |
| `agents` | auto | max agents; auto = layers/8 clamped to 10..30 (mobile <= 8). Starts at 60 % and grows per section. |
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
| `rulers` | `true` | rulers on desktop (never on mobile) |
| `controlsPosition` | `'right'` | control bar: `'right'` \| `'left'` \| `'bottom'`. Desktop: compact vertical bar at that edge, collapses to a thin tab when it would cover page content; the visitor's collapse choice is kept for the session. Mobile: always a small tab in a free corner. |
| `avoid` | `a[href^="tel:"],a[href^="mailto:"],button,[role="button"],input,select,textarea,[data-swarm-avoid]` | mobile: the tab never covers these (nor fixed elements and button-like links) |
| `onDone` | `null` | callback `{elapsed, layers, agents}` or `{skipped:true}` |

URL overrides for testing: `?rebuild=1` (force), `?rebuild=0` (off), `?rebuild-mode=tour|fast|scroll`.
API: `SwarmRebuild.skip()`, `.goLive()`, `.replay()`, `.stop()`, `.state()`, `.stats()`, `.headSnippet()`, `.version`.

### 4. Run and verify with Playwright
Serve the site, then (Playwright must be installed in the project or globally: `npm i -D playwright && npx playwright install chromium`):

```bash
S=.claude/skills/page-swarm-rebuild   # or ~/.claude/skills/page-swarm-rebuild
node $S/scripts/verify.cjs --url http://localhost:3000/ --mode scroll --checks all,manual --out ./swarm-check
node $S/scripts/verify.cjs --url http://localhost:3000/ --mode fast --device mobile --checks all,manual --out ./swarm-check-mobile
# video timing + side-by-side with a reference video (optional):
node $S/scripts/verify.cjs --url http://localhost:3000/ --mode tour --checks record --video ref.mp4
```
`--checks`: `record` (one recorded run), `all` (record + reduced motion, Esc, ✕, Replay, no-JS), `manual` (a tour
interrupted by wheel scrolling, then a scroll-mode run), comma-separated to combine. `--interact "<selector>"` clicks
an element after the effect and expects its text to change (e.g. a React counter). Every run has a hard time limit
(`--timeout`, default 300 s).

All checks must pass: run to the end, HUD texts, monotonic counters, auto-scroll ends at the bottom, fps >= `--min-fps`
(default 50, measured in a separate run without screenshots), **body DOM identical** to `?rebuild=0`,
**< 0.5 % pixel difference**, overlay/styles removed, CLS < 0.01, phone links and fixed elements visible during the
build, no console errors or hydration warnings, reduced-motion skip, Esc / ✕ / Replay, page visible without JS; and for
`manual`: the tour stops on manual scrolling, the build is never more than 0.5 viewport below the view, empty layers
scrolled into view start within 1 s on average (3 s max), the control bar never covers fixed bars (on mobile also
phone links, buttons and button-like links) and stays in the viewport. Look at `swarm-check/sheet-*.jpg` with your own
eyes too (frames are in `swarm-check/frames/`).

fps depends on the machine: a cloud container without a GPU reaches ~46 fps on the demo where a laptop reaches ~59.
Compare with earlier numbers from the same machine; lower `--min-fps` there.

**Regression suite for the skill itself** (after every change to the module or the docs):
```bash
node scripts/run-tests.cjs            # demo + dental + nextjs, desktop + mobile (~15 min, needs npm access for Next.js)
node scripts/run-tests.cjs --quick --pages demo,dental --devices desktop
```
Reference numbers on the demo, desktop 1440x900 (the developer's own machine, Nov 2026): fast 8.9 s / 59 fps / CLS 0.0007;
tour 43.2 s, 27 agents / 59.6 fps / CLS 0.0021, scroll progress at 20/40/60/80/98 % of the run 0.16/0.32/0.64/0.83/1.0;
scroll 8.4 s / 59.5 fps / CLS 0.0014; DOM identical, 0.000 % pixel difference.

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
  Repeated similar siblings become a clone group: the first is built, the rest are cloned and rewritten. A row that
  holds an instant or excluded element (e.g. a phone link) is never cloned, so that element shows at once.
- **Hide/reveal**: `@layer swarm-rebuild { body * { visibility: hidden !important } }` + per-layer
  `:nth-child` path rules (`visible` for the element, `revert-layer` for its subtree, so the page's own `visibility`
  rules still apply). `visibility` never changes layout. Selectors are rebuilt if the app re-renders (MutationObserver).
- **Proxies**: typing, scaling headings and clones use deep clones with computed styles inlined, positioned in the overlay;
  the real element is revealed under the proxy at the end of each task, so the swap is invisible.
- **Scheduler**: per section, big frames are blocked first, then reading order; a token bucket keeps ~7 layers/s x speed;
  the nearest idle agent takes the next task. Tour: the camera keeps the lowest active layer in the lower third
  (base 0.09 viewport heights/s x speed, up to 3x when the next section's frames reach the bottom edge). Visitor-driven
  (scroll mode or after manual scrolling): only the view + 0.5 viewport below; visible unbuilt layers first; an agent
  far off screen enters from the nearest edge.
- **Control bar**: fixed, moved with `transform` only (never a layout shift); repositions only when its spot gets
  covered by a fixed element (and on mobile by phone links / buttons).
- **Accessibility**: `prefers-reduced-motion` skips everything; Esc or ✕ shows the finished page immediately; the
  decorative overlay is `aria-hidden`; the bar is a labelled region with real buttons. While the effect runs, content
  not yet built is also hidden from screen readers (it is `visibility: hidden`).

## Known limitations
- Content not yet built is hidden from screen readers too (see above).
- Pages that scroll an inner container (not the window): the tour cannot drive them; use `scroll` mode.
- During the build, overlay placeholders (e.g. an image frame) can pass over a fixed bar of the page for a moment
  (seen on the dental page on mobile: the hero image placeholder over the "Call us" bar). The bar itself stays usable
  (the overlay has `pointer-events: none`).
