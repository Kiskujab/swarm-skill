---
name: page-swarm-rebuild
description: Adds the "page rebuilds itself" effect to an existing website (plain HTML, React or Next.js) - a swarm of colourful agent cursors hides the finished page, then rebuilds it layer by layer (selection frames with size labels, typing, image reveals, clone-and-rewrite of repeated items, rulers and guides), following the visitor's scrolling. Visitors see no controls; any click or key shows the finished page at once; reduced motion means no effect. No sound. A separate debug add-on (control bar, auto-scrolling tour, test hooks) exists for testing and recordings. Use when the user asks for a cursor swarm / agents rebuilding the page, a "Figma multiplayer building the site" intro, a "page builds itself" or "rebuild animation" effect, or mentions page-swarm-rebuild.
---

# page-swarm-rebuild

Presentation-only intro effect. The page's real DOM is never modified: layers are hidden and revealed with one
cascade-layered stylesheet in `<head>`, all animation happens in an overlay appended to `<html>`, and both are removed
at the end. No dependencies, no network requests (GDPR-friendly), no layout shift, no sound, and the page is never left
half hidden (see Protection).

Spec of the original effect (timeline, visuals, HUD, scroll curve): `references/effekt-leiras.md` (Hungarian). Where it
and this file disagree, this file wins (product decisions were made after the description was written).

## Files

| File | Purpose |
|---|---|
| `assets/swarm-rebuild.js` | The module (classic script, sets `window.SwarmRebuild`; also importable from a bundler). |
| `assets/swarm-rebuild.css` | Overlay styles, all scoped under `#swarm-rebuild-root`. |
| `assets/swarm-rebuild-debug.js` | Debug add-on: control bar, auto-scroll tour, test hooks. Never loaded for visitors; fetched only with `?rebuild-debug=1` / `debug: true`. Install it next to the module anyway (it is how you test on the live site). |
| `assets/react/SwarmRebuild.jsx` | React / Next.js client wrapper + `<SwarmRebuildHead />` (pre-paint snippet); the debug add-on is a separate lazy chunk. |
| `assets/demo/` | Fictional dark portfolio demo (`assets/demo/index.html`, 214 layers (desktop), 6.6 viewport heights, sticky header). |
| `tests/index.html` | Links to every test page in every mode (also the GitHub Pages start page). |
| `tests/pages/dental/` | Fictional dental practice: light theme, phone links, fixed "Call us" + booking bar (mobile), fixed notice (desktop). |
| `tests/pages/nextjs/` | Fictional Next.js 15 App Router app: React counter (hydration check), fixed Help button. |
| `scripts/verify.cjs` | Playwright check of one page (see step 4). |
| `scripts/run-tests.cjs` | Runs `verify.cjs` on the three test pages, desktop and mobile; prints a summary table. |
| `scripts/bench-fps.cjs` | Frame rate of an older module version against the current one, same machine, interleaved runs. |
| `scripts/build-site.cjs` | Builds the three test pages as one static site (GitHub Pages) or serves it on the local network. |
| `scripts/next-app.cjs` | Helper: prepares / builds the Next.js test app in a temp folder. |

## Product decisions (they override the reference video)

- **Main mode is `scroll`** (the default): the build follows the visitor's scrolling; agents work on what is in view.
- **Visitors never see a control bar and never get an automatic scroll.** The bar and the tour live in the debug
  add-on, loaded only with `?rebuild-debug=1` or `debug: true`. `mode: 'tour'` without the add-on falls back to
  `scroll`.
- **Always a way out without visible controls:** Esc, any other key (a lone Shift/Ctrl/Alt/Meta excepted) and any
  click or tap show the finished page at once, with no animation and no layout shift. `prefers-reduced-motion` means
  no effect at all (WCAG 2.2.2).
- **The click that ends the effect never does something the visitor did not see:** if it lands on content that was not
  finished yet (hidden, or still being built), it is swallowed (`preventDefault` + `stopPropagation`, on mouse already at
  `pointerdown`, so no focus, no link, no button action). If it lands on finished content (visible, nothing inside it or
  revealing it still in progress — e.g. a phone link, which is shown from the start, or a built button), it goes through
  as a normal click and the effect ends at the same time. Reason: swallowing every click would make a visible "Call us"
  link fail on the first tap; letting every click through would follow links the visitor never saw.
  Touch scrolling and the scrollbar never end the effect (scrolling is how the build is driven).
- **No sound.** The module has no audio code.

## Modes

| mode | speed | behaviour |
|---|---|---|
| `scroll` (default) | 3x | No auto-scroll. Agents build only what is in view and at most 0.5 viewport height below it. When the visitor scrolls onto unbuilt layers, those start first, more agents join (up to 8 above plan) and tasks run faster. What scrolls above the view is finished at once (see Protection). At the bottom, whatever is left above is finished out of sight. |
| `fast` | 6x | Same as `scroll`, twice as fast. |
| `tour` (debug only) | 1x | Auto-scroll as in the reference video: ~layers/7 seconds, the camera follows the work front, ends at the bottom with the ring of cursors. For recordings and side-by-side checks. `?rebuild-speed=6` gives the old "fast" (a 6x auto-scroll, ~9 s on the demo). Manual scrolling hands over to the visitor; the bar's `Tour` button resumes. |

After the build the cursors form a ring around the largest visible image and the overlay disappears after `autoExit`
seconds (3 s; with the debug add-on 6 s, never in tour mode).

## Protection (the page is never left half hidden)

- **Above the view:** everything that scrolls more than 0.1 viewport (min. 40 px) above the top edge is put in its final
  state at once, without animation; running tasks there are completed and their agents get new work. The band keeps
  things that are still visible from jumping. Copies of a clone group are handled one by one.
- **Errors and stuck work:** an exception in a task completes just that part; a task running longer than 8 s is
  completed by a watchdog; an exception elsewhere, a frame loop that stopped (2.5 s without a frame while the tab is
  visible), a scan that does not finish (6 s) or no progress for 10 s while layers in view wait show the whole page.
- **Script death:** a CSS dead-man switch (a Web Animation on `<html>` that sets `--sr-v: visible` / `--sr-o: 0`) shows
  the page and hides the overlay 5 s after the script stops refreshing it — no JavaScript needed for that. Elements the
  page hides itself keep their own visibility (`revert-layer` rules). The head snippet starts the same switch, so a module
  that never loads (blocked, failed) cannot keep the page hidden either.
- **Resize:** a new width (rotation, window resize, zoom) shows the finished page at once. Height-only changes (mobile
  URL bar) are ignored.
- **Background tab:** the switch is paused while the tab is hidden; back within 30 s the build continues, later the
  finished page is shown. Returning via the back/forward cache shows the finished page.
- **Content added after the scan** (e.g. a cookie banner inserted by a script) is shown at once, not animated; more than
  300 added elements (a client-side page change) show the finished page.
- **Fixed elements:** the overlay never draws over `position: fixed` elements (and sticky ones once they are built):
  they are cut out of it with `clip-path: inset()`: each one is covered by the narrowest strip from it to a viewport
  edge, so a corner button removes a strip along that edge (an even-odd `path()` only when the strips would hide more
  than 40 % of the screen; a path clip is much slower without a GPU).

## Workflow

### 1. Inspect the target project
- Find the framework: `package.json` (`next`, `react`, `vite`), or plain `.html` files.
- Find the root layout / main HTML file and where global CSS and scripts are loaded.
- Note anything that must never be hidden or animated: phone numbers, booking widgets, cookie banners, chat bubbles,
  fixed headers. `a[href^="tel:"]` and `position: fixed` elements are already shown instantly (also inside repeated
  rows); add others to `exclude` / `instant` or mark them `data-swarm-instant`.
- Check whether the site has its own "reduce motion" switch; pass its selector as `motionOffSelector`.
- Site-specific choices (an element to skip, a different section selector) go into the config of that site, never
  into the module.

### 2. Install the module

**Plain HTML** - copy `swarm-rebuild.js`, `swarm-rebuild.css` and `swarm-rebuild-debug.js` into one folder of the site
(e.g. `/assets/swarm-rebuild/`), then:

```html
<head>
  ...
  <!-- must be inline and early in <head>: hides content before first paint (layout untouched), starts the safety switch -->
  <script>(function(d,w){w.__swarmRebuildSnippet=1;try{var q=new URLSearchParams(location.search).get('rebuild');if(q==='0')return;if(w.matchMedia&&w.matchMedia('(prefers-reduced-motion: reduce)').matches)return;if(q!=='1'&&sessionStorage.getItem('swarm-rebuild:seen'))return;var s=d.createElement('style');s.id='swarm-rebuild-hide';s.textContent='@layer swarm-rebuild{body *{visibility:var(--sr-v,hidden)!important}#swarm-rebuild-root{opacity:var(--sr-o,1)!important}}';d.head.appendChild(s);try{w.__srDms=d.documentElement.animate([{'--sr-v':'visible','--sr-o':'0'}],{duration:1,delay:5000,fill:'forwards'})}catch(e){}setTimeout(function(){var r=w.SwarmRebuild;if(!(r&&r.active)){var e=d.getElementById('swarm-rebuild-hide');if(e)e.remove()}},5000)}catch(e){}})(document,window);</script>
  <link rel="stylesheet" href="/assets/swarm-rebuild/swarm-rebuild.css">
</head>
<body>
  ...
  <script src="/assets/swarm-rebuild/swarm-rebuild.js" data-auto></script>
</body>
```
(or omit `data-auto` and call `SwarmRebuild.start({ ... })` yourself). `data-auto` reads `data-mode`, `data-speed`,
`data-agents`, `data-exclude`, `data-controls-position`, `data-debug`, `data-debug-src` and `data-once="false"`.
The snippet text is also available at runtime as `SwarmRebuild.headSnippet()`. The debug add-on is fetched from the
module's own URL with `-debug` added (`debugSrc` overrides). Working example: `tests/pages/dental/index.html`.

**Next.js (App Router)** - copy `swarm-rebuild.js`, `swarm-rebuild.css`, `swarm-rebuild-debug.js` and
`react/SwarmRebuild.jsx` into one folder, e.g. `components/swarm-rebuild/`. In `app/layout.tsx`:

```tsx
import SwarmRebuild, { SwarmRebuildHead } from '@/components/swarm-rebuild/SwarmRebuild';
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head><SwarmRebuildHead /></head>
      <body>
        {children}
        <SwarmRebuild />
      </body>
    </html>
  );
}
```
Pages Router: put `<SwarmRebuildHead />` in `pages/_document.tsx` `<Head>` and `<SwarmRebuild />` in `pages/_app.tsx`.
**React (Vite/CRA)**: paste the snippet into `index.html` `<head>` and render `<SwarmRebuild />` once in `App`.
The wrapper starts the effect after mount only, is StrictMode-safe and imports the debug add-on only when asked.
Working example: `tests/pages/nextjs/`.

### 3. Configure
`SwarmRebuild.start(options)` / `<SwarmRebuild {...options} />` / `window.SwarmRebuildConfig = {...}`:

| option | default | notes |
|---|---|---|
| `mode` | `'scroll'` | `'scroll'`, `'fast'`; `'tour'` only with the debug add-on |
| `speed` | per mode | base time scale (1 = video timing); scroll 3, fast 6, tour 1 |
| `agents` | auto | max agents; auto = layers/8 clamped to 10..30 (mobile <= 8). Starts at 60 % and grows per section. |
| `colors` | pastel set | agent colours (teal, pink, peach, lavender, sky, mint, white) |
| `exclude` | `''` | selector: shown immediately, never animated |
| `instant` | `a[href^="tel:"],[data-swarm-instant]` | selector: shown immediately |
| `sectionSelector` | `header,section,footer,[data-swarm-section]` | top-level bands |
| `motionOffSelector` | `[data-motion="off"],.motion-off,.reduce-motion` | if it matches, the effect is skipped |
| `skipIf` | `null` | function -> `true` skips |
| `monogram` | first letter of `<title>` | faint letter shown while scanning |
| `once` | `true` | once per browser session (`sessionStorage`); `?rebuild=1` forces, `?rebuild=0` disables |
| `autoExit` | 3 (debug: 6, tour: never) | seconds after the build until the overlay disappears |
| `groupMin` | `3` | min. repeated siblings for clone-and-rewrite (2 for big cards) |
| `rulers` | `true` | rulers on desktop (never on mobile) |
| `debug` | `false` | load the debug add-on (control bar, tour, test hooks); same as `?rebuild-debug=1` |
| `debugSrc` | next to the module | URL of `swarm-rebuild-debug.js` (script-tag installs) |
| `controlsPosition` | `'right'` | debug bar: `'right'` \| `'left'` \| `'bottom'`; collapses to a thin tab when it would cover content; mobile: a small tab in a free corner |
| `avoid` | `a[href^="tel:"],a[href^="mailto:"],button,[role="button"],input,select,textarea,[data-swarm-avoid]` | mobile debug tab never covers these (nor fixed elements and button-like links) |
| `onDone` | `null` | callback `{elapsed, layers, agents}` or `{skipped: true, reason}` |

URL parameters: `?rebuild=1` (force), `?rebuild=0` (off), `?rebuild-mode=scroll|fast|tour`, `?rebuild-debug=1`
(debug add-on). With the debug add-on only: `?rebuild-speed=<n>`, `?rebuild-fault=task|stall|loop|die@<s>` (fault
injection for tests), `?rebuild-hidden-max=<s>`.
API: `SwarmRebuild.skip()`, `.goLive()`, `.replay()`, `.stop()`, `.state()` (`phase` scan / build / done, `loading`
while the debug add-on is fetched, `idle` with `lastExit` after the end),
`.stats()`, `.headSnippet()`, `.defaults`, `.version`; test hooks `._pause(on)`, `._probe()` (debug add-on).

### 4. Run and verify with Playwright
Serve the site, then (Playwright must be installed in the project or globally: `npm i -D playwright && npx playwright install chromium`):

```bash
S=.claude/skills/page-swarm-rebuild   # or ~/.claude/skills/page-swarm-rebuild
node $S/scripts/verify.cjs --url http://localhost:3000/ --mode tour --speed 6 --checks all,manual --out ./swarm-check
node $S/scripts/verify.cjs --url http://localhost:3000/ --mode tour --speed 6 --device mobile --checks all,manual --out ./swarm-check-mobile
node $S/scripts/verify.cjs --url http://localhost:3000/ --mode scroll --checks record --out ./swarm-check-scroll
# video timing + side-by-side with a reference video (optional):
node $S/scripts/verify.cjs --url http://localhost:3000/ --mode tour --checks record --video ref.mp4
```
`--checks` (comma list): `record` (one recorded run in `--mode`), `extra` (reduced motion, debug ✕ and Replay, no-JS),
`product` (no bar / no auto-scroll / add-on not loaded without the flag in all three modes, the flag shows the bar,
default mode scroll, Esc / letter / Tab end the effect at once without layout shift while a lone Shift does not, a click
or tap on unfinished content ends it without navigating, a click on finished content (`--interact`) works and ends it),
`protect` (everything above the view final during fast scrolling, faults `task` / `stall` / `loop` / `die`, resize,
background tab), `fixed` (pixel test: overlay shown vs. hidden, module paused, at ~17 moments of a visitor run, for every
fixed and finished sticky element in view), `manual` (debug tour interrupted by wheel scrolling, then a scroll-mode run),
`all` = record,extra,product,protect,fixed. `--interact "<selector>"` also clicks an element after the effect and
expects its text to change (e.g. a React counter). Every run has a hard time limit (`--timeout`, default 400 s).

All checks must pass: run to the end, monotonic counters, auto-scroll ends at the bottom (tour), fps >= `--min-fps`
(default 50, separate run without screenshots), **body DOM identical** to `?rebuild=0`, **< 0.5 % pixel difference**,
overlay/styles removed, CLS < 0.01, phone links and fixed elements visible during the build, no console errors or
hydration warnings, plus every product / protect / fixed / manual check. Look at `swarm-check/sheet-*.jpg` with your own
eyes too (frames are in `swarm-check/frames/`).

fps depends on the machine: a cloud container without a GPU reaches ~45-55 fps on the demo where a laptop reaches ~59.
Compare with earlier numbers from the same machine (`scripts/bench-fps.cjs` compares two versions); lower `--min-fps` there.

**Regression suite for the skill itself** (after every change to the module or the docs):
```bash
node scripts/run-tests.cjs            # demo + dental + nextjs, desktop + mobile (~35 min, needs npm access for Next.js)
node scripts/run-tests.cjs --quick --pages demo,dental --devices desktop
node scripts/bench-fps.cjs --old-ref c332016   # fps of an older version (c332016 = 1.0.1) against the working copy
```
Reference numbers on the demo, desktop 1440x900 (the developer's own machine, Nov 2026, module 1.0.0): fast (now
`tour` at speed 6) 8.9 s / 59 fps / CLS 0.0007; tour 43.2 s, 27 agents / 59.6 fps / CLS 0.0021, scroll progress at
20/40/60/80/98 % of the run 0.16/0.32/0.64/0.83/1.0; scroll 8.4 s / 59.5 fps / CLS 0.0014; DOM identical, 0.000 % pixel
difference. The demo has 214 layers since 1.0.1 (212 before).

Typical fixes: a section is too dense or a widget behaves oddly -> add it to `exclude`; a bar should never be animated ->
`data-swarm-instant`; the page uses its own scroll-reveal animations (elements start at opacity 0) -> those elements are
skipped by the scan and appear when the page animates them, which is expected.

### 5. Report
Tell the user: mode and options chosen, files added/changed, verify results (build time, layers, agents, fps, DOM/pixel
diff), anything excluded and why, how to test on the live site (`?rebuild=1`, `?rebuild-debug=1`) and how to turn it
off (`?rebuild=0`, remove the snippet + script).

## How it works (for debugging)
- **Scan**: walks `body`, measures each element once (hide sheet briefly disabled in the same task, so nothing paints),
  classifies layers: `text` (heading / number sub-types), `media`, `icon`, `button`, `box`, `line`, `control`.
  Elements hidden by the page itself, fixed elements and overflow-clipped parts are left out (shown instantly / at
  section end / when they scroll above the view). Repeated similar siblings become a clone group: the first is built,
  the rest are cloned and rewritten. A row that holds an instant or excluded element (e.g. a phone link) is never
  cloned, so that element shows at once.
- **Hide/reveal**: `@layer swarm-rebuild { body * { visibility: var(--sr-v, hidden) !important } }` + per-layer
  `:nth-child` path rules (`visible` for the element, `revert-layer` for its subtree, so the page's own `visibility`
  rules still apply; elements the page hides itself get `revert-layer` too). `visibility` never changes layout.
  Selectors are rebuilt if the app re-renders (MutationObserver).
- **Proxies**: typing, scaling headings and clones use deep clones with computed styles inlined, positioned in the
  overlay; the real element is revealed under the proxy at the end of each task, so the swap is invisible. While
  typing, the untyped rest of each text node is kept as hidden text, so every word already sits in its final line (no
  reflow, no layout shift inside the overlay).
- **Scheduler**: per section, big frames are blocked first, then reading order; a token bucket keeps ~7 layers/s x
  speed; the nearest idle agent takes the next task. Visitor-driven: only the view + 0.5 viewport below; visible
  unbuilt layers first; an agent far off screen enters from the nearest edge. Tour (debug): the camera keeps the lowest
  active layer in the lower third (base 0.09 viewport heights/s x speed, up to 3x when the next section's frames reach
  the bottom edge).
- **Every overlay element a task creates is recorded on the task**, so a failed, stuck or out-of-sight task can be
  completed and cleaned up on its own.
- **Debug control bar**: fixed, moved with `transform` only (never a layout shift); repositions only when its spot
  gets covered by a fixed element (and on mobile by phone links / buttons). Its styles come with the add-on.
- **Accessibility**: `prefers-reduced-motion` skips everything; Esc / any key / click shows the finished page
  immediately; the overlay is `aria-hidden`. While the effect runs, content not yet built is also hidden from screen
  readers (it is `visibility: hidden`).

## Known limitations
- Content not yet built is hidden from screen readers too (see above); any key ends the effect, so keyboard and
  screen-reader users get the page at their first key press.
- Pages that scroll an inner container (not the window): the build follows the window only; use `fast` or exclude it.
- The overlay is not drawn in the strip between a fixed element and the nearest viewport edge (e.g. along the bottom
  edge next to a floating button), so agents passing there disappear for a moment. Fixed elements that cover more than half of the viewport are not cut out (they are treated as
  backgrounds).
- Tools that fast-forward all animations (e.g. Playwright `screenshot({ animations: 'disabled' })`) also fast-forward
  the safety switch: the page is then shown at once (fails safe).
