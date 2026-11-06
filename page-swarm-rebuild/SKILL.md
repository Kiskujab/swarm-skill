---
name: page-swarm-rebuild
description: Adds the "page rebuilds itself" effect to an existing website (plain HTML, React or Next.js) - a swarm of colourful agent cursors hides the finished page, then rebuilds it layer by layer (selection frames with size labels, typing, image reveals, clone-and-rewrite of repeated items, rulers and guides), following the visitor's scrolling, with natural motion (swarms around a focus element, a spring-like finale, gravity-bent paths, mouse curiosity). Visitors see no controls and can use the page while it builds (consent banners, menus, forms, pop-ups work and the build goes on); Esc or a double click / tap on an empty spot shows the finished page at once; reduced motion means no effect. No sound. A separate debug add-on (control bar, auto-scrolling tour, test hooks) exists for testing and recordings. Use when the user asks for a cursor swarm / agents rebuilding the page, a "Figma multiplayer building the site" intro, a "page builds itself" or "rebuild animation" effect, or mentions page-swarm-rebuild.
---

# page-swarm-rebuild

Version 1.4.0 (module, add-on, stylesheet and this file; see `CHANGELOG.md` in the repository; `SwarmRebuild.version`).

Presentation-only intro effect. The page's real DOM is never modified: layers are hidden and revealed with one
cascade-layered stylesheet in `<head>`, all animation happens in an overlay appended to `<html>`, and both are removed
at the end. No dependencies, no network requests (GDPR-friendly), no layout shift, no sound, and the page is never left
half hidden (see Protection).

Spec of the original effect (timeline, visuals, HUD, scroll curve): `references/effekt-leiras.md` (Hungarian). Where it
and this file disagree, this file wins (product decisions were made after the description was written).

## Files

| File | Purpose |
|---|---|
| `assets/swarm-rebuild.js` | The module, readable source (classic script, sets `window.SwarmRebuild`; also importable from a bundler). |
| `assets/swarm-rebuild.min.js`, `swarm-rebuild-debug.min.js`, `swarm-rebuild.min.css` | Minified builds for plain HTML sites (`scripts/build-min.cjs`; the installer uses them; bundlers minify the sources themselves). |
| `assets/swarm-rebuild.css` | Overlay styles, all scoped under `#swarm-rebuild-root`. |
| `assets/swarm-rebuild-debug.js` | Debug add-on: control bar, auto-scroll tour, test hooks. Never loaded for visitors; fetched only with `?rebuild-debug=1` / `debug: true`. Install it next to the module anyway (it is how you test on the live site). |
| `assets/react/SwarmRebuild.jsx` | React / Next.js client wrapper + `<SwarmRebuildHead />` (pre-paint snippet); the debug add-on is a separate lazy chunk. |
| `assets/demo/` | Fictional dark portfolio demo (`assets/demo/index.html`, 214 layers (desktop), 6.6 viewport heights, sticky header). |
| `tests/index.html` | Links to every test page in every mode (also the GitHub Pages start page). |
| `tests/pages/dental/` | Fictional dental practice: light theme, phone links, fixed "Call us" + booking bar (mobile), fixed notice (desktop). |
| `tests/pages/lang-*/` | Fictional pages in Hungarian, Arabic (right to left), Japanese and an emoji-rich one (typing in any language). |
| `tests/pages/law/`, `accounting/`, `bootstrap/`, `spa/` | Fictional real-world patterns: web fonts, sticky header, consent banners, iframe, lazy images, dark mode, long page, scroll-reveal, Bootstrap (npm), single-page app, videos. |
| `tests/pages/bakery/` | Fictional bakery-café used while it builds: consent banner in four forms (`?banner=top` in the page flow, `modal` on a backdrop, `bottom` fixed, `late` added by a script), drop-down and hamburger menu, language switcher, order form, newsletter pop-up, chat widget, in-page links (`interact` group). |
| `tests/pages/nextjs/` | Fictional Next.js 15 App Router app: React counter (hydration check), fixed Help button. |
| `scripts/verify.cjs` | Playwright check of one page (see step 4). |
| `scripts/run-tests.cjs` | Runs `verify.cjs` on the three test pages, desktop and mobile; prints a summary table. |
| `scripts/bench-fps.cjs` | Frame rate of an older module version against the current one, same machine, interleaved runs. |
| `scripts/build-site.cjs` | Builds the three test pages as one static site (GitHub Pages) or serves it on the local network. |
| `scripts/next-app.cjs` | Helper: prepares / builds the Next.js test app in a temp folder. |
| `scripts/build-min.cjs` | Builds the `.min` files and checks the size budget (needs terser and csso from npm). |
| `scripts/perf.cjs` | Lighthouse metrics (LCP, CLS, TBT, Speed Index, accessibility, SEO) with and without the effect. |
| `scripts/sync-snippet.cjs` | Copies the module's head snippet into the React wrapper, SKILL.md and the test pages. |
| `scripts/record-video.cjs` | Records the effect as an .mp4 / .webm for a portfolio (the debug tour, control bar hidden). |
| `scripts/project.cjs` | Installs the effect into a project with a backup in `legacy/`, removes it again, restores the originals. |
| `scripts/test-project.cjs` | Tests the installer: backup, restore after a broken project (hash-identical), uninstall. |

## Product decisions (they override the reference video)

- **Main mode is `scroll`** (the default): the build follows the visitor's scrolling, and only what is in view is ever
  built: an element starts when at least 60 % of it is on screen (`buildVisible`), nothing is built below or above the
  view, and no working agent ever leaves the screen.
- **Visitors never see a control bar and never get an automatic scroll.** The bar and the tour live in the debug
  add-on, loaded only with `?rebuild-debug=1` or `debug: true`. `mode: 'tour'` without the add-on falls back to
  `scroll`.
- **Visitors can use the page while it builds.** Clicks, taps and keys on the page's own elements never end the
  effect: a consent / cookie banner, a pop-up or modal (newsletter, notification), a hamburger or drop-down menu, a
  language switcher, form fields and buttons, a chat widget, links and buttons in general — with the mouse, by touch
  and with the keyboard (Tab, Enter, Space, typing). The action works as usual and the build goes on. Reason: most
  real sites open with a consent banner, and visitors press "Accept" at once; in 1.3.0 that click ended the effect after
  ~10 % of it. Parts that are not built yet are hidden (`visibility: hidden`), so they cannot be hit by mistake: a click
  there does nothing. Keyboard focus that lands on a part not built yet builds that part at once, so the focus is
  always visible.
- **Ending it is deliberate (`exitOn`, default `'intent'`), always possible without visible controls:**
  - **Esc** ends it at once (the finished page, no animation, no layout shift) — unless the page itself uses that Esc:
    the focus is in an open dialog, menu, list box or expanded control, an open modal is on screen, or the page handled
    the key (`preventDefault`). Then the page's dialog closes and the build goes on; a second Esc within 1.5 s always
    ends the effect. This is also the way out for keyboard and screen-reader users (the status message says so).
  - **A double click / double tap on an empty spot** (not a link, button, field, label, dialog or fixed bar, and not on
    text: a double click on text selects a word, which is normal use) ends it. A single click or tap never does, nor do
    two slow taps or taps while the page is scrolling (a tap that stops a fling). The double tap does not zoom.
  - `exitOn: 'esc'` = only Esc; `exitOn: 'any'` = the behaviour of 1.3.0 (any click, tap or key except scroll keys ends
    it; a click on unfinished content is swallowed).
  - `prefers-reduced-motion` means no effect at all (WCAG 2.2.2); a new width (rotation, resize) shows the finished page.
- **Scroll keys scroll:** Space, the arrows, Page Up / Down and Home / End drive the build exactly like the mouse wheel.
  Touch scrolling and the scrollbar never end the effect (scrolling is how the build is driven).
- **The page's own surfaces are never built and never covered:** `position: fixed` elements, dialogs (`<dialog>`,
  `role="dialog"` / `"alertdialog"`, `aria-modal`), `[data-swarm-surface]` and elements named like a consent banner
  (id / class / aria-label with consent, gdpr, ccpa, cookie-banner, cookie-bar, cookie-notice ...; not `cookie-card`)
  are shown at once, also a bar at the top in the page flow; everything a script adds during the build (a consent
  manager that injects itself late, a chat widget) is shown at once and cut out of the overlay when fixed. Options
  `surface` (selector) and `surfaceNames` (false = no name matching).
- **A modal with a backdrop pauses the build** (`pauseOnModal`): a fixed layer over the whole screen with its own colour
  or blur that holds a dialog (consent wall, newsletter pop-up), or an open modal `<dialog>`. The overlay is hidden and
  the build waits; when it closes, everything goes on where it was. A consent wall at load holds the opening until it
  is answered.
- **The page may move while it builds:** a consent bar at the top closes and the content moves up, a menu or accordion
  opens, a font or image loads late. A few elements are checked every 0.15 s (every 0.05 s right after a click or key);
  when one moved, every part is measured again: parts waiting to be built use the new place, a part being built at that
  moment is finished at once (never animated at a stale place), parts the page removed are dropped. The overlay only
  reads the layout, so nothing jumps and there is no layout shift (CLS 0 in every interact check).
- **Client-side navigation (SPA):** a new URL (`pushState`, `popstate`; a hash change does not count) or most of the
  unbuilt content removed ends the effect: the new page is shown complete at once, nothing stays hidden. Reason: the
  new view was never scanned; restarting would hide it again after the visitor asked for it.
- **No sound.** The module has no audio code.

## Modes

| mode | speed | behaviour |
|---|---|---|
| `scroll` (default) | 3x | No auto-scroll. Agents build only what is in view: an element starts when at least `buildVisible` (60 %) of its height is on screen; an element taller than the screen when it fills 60 % of the screen, so it is built from the top down as it comes in. Nothing is built outside the view and a working agent never leaves it (a frame taller than the screen is pulled from the screen edge). After a fast scroll (wheel, keys, Home / End) the visible part is filled in ~1-2 s: those layers start first, more agents join (up to 8 above plan) and tasks run faster. What leaves the view is final at once (see Protection). |
| `fast` | 6x | Same as `scroll`, twice as fast. |
| `tour` (debug only) | 1x | Auto-scroll as in the reference video: ~layers/7 seconds, the camera follows the work front, ends at the bottom with the ring of cursors. For recordings and side-by-side checks. `?rebuild-speed=6` gives the old "fast" (a 6x auto-scroll, ~9 s on the demo). Manual scrolling hands over to the visitor; the bar's `Tour` button resumes. |

After the build the swarms gather around the focus element and the overlay disappears after `autoExit` seconds (3 s;
with the debug add-on 6 s, never in tour mode).

## Motion

All of it is subtle by default and set with `motion` (see Configure); `?rebuild-motion=arc:0,...` switches parts off for
A/B tests (debug add-on).

- **Focus element** (`focus`): the opening and the finale swarm around it. Ask the developer (step 1). In each phase the
  first of these that is at least half in view is used: the configured element(s), `[data-swarm-focus]`, `h1`, a main
  button (`a.btn`, `.button`, `.cta`, `button[type=submit]` ...), the logo; then the largest picture in view; then a spot in
  the view. So a focus far down the page (e.g. a closing call to action) serves the finale, and the opening uses the
  main heading.
- **Swarms:** free agents fly in 2-4 swarms of clearly different sizes (phones: 2). Every agent is pulled by a damped
  spring towards its place in its swarm; the swarm centres move on an ellipse around the focus element whose radius
  breathes and whose pace changes, so agents speed up and slow down by themselves and never run on a perfect circle.
  The opening already starts in swarms (it lasts well under a second for visitors).
- **Resting agents** (during the build, an agent without work): it leaves its swarm for its own spot in view, at least
  72 px from every other resting agent (never a cluster of overlapping cursors), drifts slowly and fades out after
  1.4 s; it fades in where it rests when it gets its next task. At the finale all of them come back and gather in
  swarms around the focus. Measured: at most 2 overlapping resting cursors in 99.6-100 % of the frames (1.2: a median
  of 6 and up to 20 on the demo).
- **Finale:** a stiff, under-damped spring (damping 0.63, `motion.spring`) pulls every agent to the focus: fastest at
  the start, about 5-20 % past its place, then back; after ~1 s the spring softens and the swarms circle slowly.
- **Mouse** (opening and finale, desktop only; never on touch, never with reduced motion): an agent near the pointer
  moves out of its way (harder when the pointer comes fast); up to 3 curious agents then follow it on a small circle,
  1.3-2 s when it rests, shorter the faster it moves away (interest drains at `(1 + speed / 220 px/s)` times the base
  rate). Never closer than 36 px (a hard limit, so the icons never overlap); the overlay ignores pointer events, so
  clicks are never disturbed.
- **Gravity:** an agent carries the element it works on, so its way there (and a carried clone copy) bends downwards:
  sag = 0.2 x horizontal distance x weight x horizontality², weight = sqrt(area) / 320 px clamped to 0.2..1, at most
  56 px and a fifth of the horizontal distance. A vertical move hardly bends. The way to a task also starts with the
  agent's current velocity (cubic Hermite curve), so there are no sudden stops or turns.
- **Difficulty:** every task's work (not the way there) is scaled by a difficulty from the element's area (for typing:
  the box typed into): near the page average 2x the area ~ 1.6-1.8x the time, squashed (tanh) so the hardest task takes
  at most ~4x the easiest. It is normalised (weighted by task length and difficulty, because parallel tasks make the
  long ones set the pace) so the whole build takes as long as before; only the split between small and big changes.
- **Lite** (`motion.lite: 'auto'`): on phones 2 swarms and no mouse play; when the frame rate stays
  under 38 fps for two seconds during the build, also one trail ghost instead of three.

## Languages and writing directions

The module assumes no language. Typing goes by user-perceived characters (grapheme clusters, `Intl.Segmenter`, with
a fallback that joins combining marks, ZWJ sequences, skin tones, variation selectors and flag pairs): an accented
letter, an emoji family, a flag or a letter with Arabic / Hebrew marks is never split. Untyped text stays in place as
hidden text, and browsers shape across that boundary, so Arabic letters keep their joined forms and nothing reflows.
Right-to-left elements (`direction: rtl`, e.g. `<html dir="rtl">`): frames grow from the right edge, lines are drawn
from right to left, the agent types on the left side and the caret sits left of the last typed letter; a
left-to-right run inside right-to-left text (a number, an e-mail address, a Latin name) is typed as a whole, like a
pasted word. CJK text (no spaces) and long words wrap exactly as on the page. The overlay itself is always laid out
left to right (`direction: ltr` on its root) so a right-to-left page never mirrors it. Numbers in any script
(`\p{Nd}`) count as numbers. Test pages: `tests/pages/lang-hu` (ő / ű, very long words), `lang-ar` (right to left,
Arabic-Indic digits, a Hebrew quote), `lang-ja` (Japanese), `lang-emoji`. Known limit: vertical writing modes
(`writing-mode: vertical-rl`) are typed but the frames still grow left to right.

## Performance, search engines, accessibility

- **Size** (what a visitor downloads; the debug add-on never): module 70 KB minified / 27.5 KB gzip, stylesheet
  6 KB / 1.6 KB; budget 30 KB + 2 KB gzip (`node scripts/build-min.cjs --check`). Rebuild the `.min` files after every
  change to the module (`--modules <folder with terser and csso>`).
- **Lighthouse** (`scripts/perf.cjs`, median of 3, mobile / desktop presets, the test machine without GPU):

  | page | LCP ms off -> on | CLS off -> on | TBT ms off -> on | Speed Index ms off -> on | perf score |
  |---|---|---|---|---|---|
  | demo, mobile | 2106 -> 2207 | 0 -> 0 | 12 -> 10 | 968 -> 1669 | 99 -> 99 |
  | demo, desktop | 483 -> 573 | 0 -> 0 | 0 -> 0 | 266 -> 681 | 100 -> 100 |
  | dental, mobile | 1956 -> 2035 | 0 -> 0 | 0 -> 0 | 754 -> 1763 | 99 -> 99 |
  | dental, desktop | 442 -> 490 | 0 -> 0 | 0 -> 0 | 201 -> 767 | 100 -> 100 |
  | law (web fonts), mobile | 2094 -> 2222 | 0.030 -> 0 | 0 -> 0 | 1895 -> 2386 | 98 -> 97 |
  | accounting (long page), mobile | 1707 -> 1973 | 0 -> 0 | 0 -> 0 | 1652 -> 1697 | 99 -> 98 |

  No blocking time and no layout shift (the law page's own font swap shift is even hidden). LCP grows by 50-270 ms
  and Speed Index by up to ~1 s: the first view is built in front of the visitor, so it is visually complete later -
  that is the effect itself. Only first-time visitors (once per session) pay it; returning visitors and crawlers get
  the page at once. Accessibility / SEO scores move by a point either way only because Lighthouse sees less of the
  page while it is hidden.
- **Search engines and link previews:** crawlers (user agent with bot / crawl / spider, Googlebot, Bingbot,
  facebookexternalhit, link previews ...) never get the effect, neither in the head snippet nor in the module: they
  see the finished page with the identical DOM (`a11y` check). Without JavaScript the page is never hidden, and the
  effect never removes content (it only uses `visibility`).
- **Accessibility:** the overlay is `aria-hidden` and its copies are `inert` (nothing focusable); while the content
  is hidden, screen readers get one status message in the page's language (`<html lang>`: en, hu, de, fr, es, it, pt,
  nl, pl, cs, sv, ru, uk, tr, ar, he, ja, zh, ko; `a11yText` overrides), placed outside `<body>` and removed at the end;
  Tab moves the focus exactly where it would without the effect (no focus trap) and the focused part is built at once;
  Esc ends the effect; `prefers-reduced-motion` means no effect.

## Compatibility (tested on the local test pages; real sites cannot be reached from the test machine)

| pattern | result | what to know |
|---|---|---|
| Plain HTML, multi-page sites | works | installer adds the snippet / script to every page |
| Next.js App Router, Pages Router | works | test app built and verified; StrictMode-safe |
| React + Vite | works (installer tested, page not built here) | own detached root, starts after mount |
| Bootstrap 5 (npm), utility CSS | works | `tests/pages/bootstrap` |
| Single-page apps (client routes) | works on the first view | content rendered before the scan is built; content added later is shown at once; a route change (new URL, or most of the content replaced) shows the new page complete and ends the effect (`--route` check) |
| Sticky header | works | built first, then cut out of the overlay |
| Fixed bars, chat bubbles, back-to-top | works | shown at once, never covered (pixel-tested) |
| Cookie / consent banners: fixed bar, bar at the top in the page flow, dialog on a backdrop, added by a script later | works | shown at once, never covered, the first click / tap / Enter works and the build goes on; a bar that closes and moves the content is followed (no jump, CLS 0); a backdrop pauses the build (`interact` checks on `tests/pages/bakery` in all four forms, `law`, `accounting`) |
| Menus, language switchers, forms, chat widgets used during the build | works | the action works, the build goes on; focus builds the focused part at once (`interact`) |
| Web fonts (`@font-face`) | works | the scan waits for `document.fonts.ready` (at most 0.7 s) |
| Lazy-loaded images | works | sizes come from the layout; give images `width` / `height` (the page itself needs them against layout shift anyway) |
| iframes (maps, players), `<video>`, background video | works | revealed as one picture, their content is not animated; videos keep playing underneath |
| Carousels, tabs, menus, modals, accordions | works | parts not shown at the scan (`display: none`) are final at once, so a slide that comes in during the build is complete; a menu or accordion that pushes the content is followed (re-measure) |
| Scroll-reveal libraries (AOS-like, opacity 0 until in view) | works | sections in the page flow are built like the rest (the page fades them in about when they are built); small or floating ones at opacity 0 (tooltips) are final at once |
| Dark mode (system setting, toggle) | works | the overlay takes the page background; verify with `--color-scheme dark` |
| Very long pages | works | demo 6.6, accounting 6.8, law (phone) 8.3 viewport heights |
| Right-to-left, CJK, emoji, any language | works | see Languages |
| Inner scroll containers (app shells, chat panes) | limited | only the window scroll is followed: use `fast`, or `exclude` the container |
| Canvas / WebGL scenes | limited | revealed as one picture, not animated |
| Web components (shadow DOM) | limited | hidden and shown with their host element, the inside is not animated piece by piece |
| Pages that move or change their own DOM all the time (tickers, live counters) | limited | works, but "DOM identical" checks need `--dom-volatile` for the changing attributes |
| Vertical writing modes | limited | text is typed, frames still grow horizontally |

## Protection (the page is never left half hidden)

- **Above the view:** everything that scrolls more than 0.1 viewport (min. 40 px) above the top edge is put in its final
  state at once, without animation; running tasks there are completed and their agents get new work. The band keeps
  things that are still visible from jumping. Copies of a clone group are handled one by one. In the visitor modes also
  an unbuilt element across the top edge with less than `buildVisible` of it in view is final at once (it can only
  leave the view; building it would happen mostly out of sight).
- **Out of view (visitor modes):** a running task whose part scrolled completely out of view (also below it, when the
  visitor scrolls back up) is completed at once; one mostly out of view is fast-forwarded. Something a visible part
  waits for (the master card of a row of copies, a frame) is built first when it is in view too, else finished at once.
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
  300 added elements, a new URL or most of the unbuilt content removed (a client-side page change) show the finished page.
- **Layout changes by the page** (a banner closes, a menu opens): re-measured, see Product decisions; a part being built
  at that moment is finished at once, so nothing is ever animated at a stale place.
- **A modal with a backdrop** pauses the build and hides the overlay; the watchdogs pause with it.
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
- **Ask the developer for the focus element** the swarms gather around at the start and the end: the logo, the main
  heading or the main button (call to action). Suggest one from the page (usually the main call to action near the end
  of the page for the finale, since the opening falls back to the main heading anyway) and, if there is no answer, use
  the suggestion. Store it in the site's config as `focus: '<selector>'` (or `data-focus` on the script tag, or
  `data-swarm-focus` on the element). Example: the demo uses `focus: '#reel'` ("Make it feel real").
- Site-specific choices (an element to skip, a different section selector) go into the config of that site, never
  into the module.

### 2. Install the module

**Always with a backup first.** Use the installer; it saves every file it will change in the project's `legacy/`
folder before it writes anything, and can take everything out again:

```bash
S=.claude/skills/page-swarm-rebuild   # or ~/.claude/skills/page-swarm-rebuild
node $S/scripts/project.cjs install --project . --focus "#cta"     # detects Next.js (App / Pages Router), Vite + React, plain HTML
node $S/scripts/project.cjs uninstall --project .                  # removes exactly what it added (later edits are kept)
node $S/scripts/project.cjs restore --project .                    # the files exactly as before the install (SHA-256 checked)
node $S/scripts/project.cjs list --project .                       # the backups
```
`--dry` shows what would change. Every insertion is marked `swarm-rebuild:start` / `swarm-rebuild:end`. If the project
does not fit (no `</body>` in the layout, a custom document...), the installer stops without changing anything; then
install by hand as below, **after** saving the files you will change into `legacy/<YYYYMMDD-HHMMSS>-manual/files/<path>.orig`
with a `backup.txt` (see Backup and removal).

**Plain HTML** - copy `swarm-rebuild.min.js`, `swarm-rebuild.min.css` and `swarm-rebuild-debug.min.js` (or the readable
`.js` / `.css` files while developing) into one folder of the site
(e.g. `/assets/swarm-rebuild/`), then:

```html
<head>
  ...
  <!-- must be inline and early in <head>: hides content before first paint (layout untouched), starts the safety switch -->
  <script>(function(d,w){w.__swarmRebuildSnippet=1;try{var q=new URLSearchParams(location.search).get('rebuild');if(q==='0')return;if(/bot\b|crawl|spider|slurp|mediapartners|inspectiontool|facebookexternalhit|embedly|preview|whatsapp|telegram|discord|semrush|ahrefs|yandex|baidu|duckduck|petal|bytespider/i.test(navigator.userAgent||''))return;if(w.matchMedia&&w.matchMedia('(prefers-reduced-motion: reduce)').matches)return;if(q!=='1'&&sessionStorage.getItem('swarm-rebuild:seen'))return;var s=d.createElement('style');s.id='swarm-rebuild-hide';s.textContent='@layer swarm-rebuild{body *{visibility:var(--sr-v,hidden)!important}#swarm-rebuild-root{opacity:var(--sr-o,1)!important}}';d.head.appendChild(s);try{w.__srDms=d.documentElement.animate([{'--sr-v':'visible','--sr-o':'0'}],{duration:1,delay:5000,fill:'forwards'})}catch(e){}setTimeout(function(){var r=w.SwarmRebuild;if(!(r&&r.active)){var e=d.getElementById('swarm-rebuild-hide');if(e)e.remove()}},5000)}catch(e){}})(document,window);</script>
  <link rel="stylesheet" href="/assets/swarm-rebuild/swarm-rebuild.min.css">
</head>
<body>
  ...
  <script src="/assets/swarm-rebuild/swarm-rebuild.min.js" data-auto></script>
</body>
```
(or omit `data-auto` and call `SwarmRebuild.start({ ... })` yourself). `data-auto` reads `data-mode`, `data-speed`,
`data-agents`, `data-exclude`, `data-controls-position`, `data-debug`, `data-debug-src`, `data-focus` and `data-once="false"`.
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

### Backup and removal (never lose anything)

- Before any change (install, uninstall), the files about to change are saved in
  `legacy/<YYYYMMDD-HHMMSS>-<action>/files/<path>.orig` with `manifest.json` (SHA-256 of every file) and `backup.txt`
  (at most 1000 characters: what, when, which files, how to restore). node_modules, .git and build output (.next,
  dist, build, out) are never saved (only the files the skill touches are).
- `restore` writes the saved files back byte for byte and deletes what the install created, then checks the hashes.
  `uninstall` removes only the marked insertions and the copied files, so edits made since are kept; it reports per
  file whether it is identical to before the install. `uninstall --purge` also deletes `legacy/`.
- **legacy/ never ships:** it is added to `.gitignore` (git-based deploys - Vercel, Netlify, GitHub Pages - never see
  it); the `.orig` suffix keeps TypeScript, ESLint, Next.js, Vite and test runners away from the copies (they only
  pick up `.ts/.tsx/.js/.jsx`); Next.js and Vite only bundle what is imported and only serve `public/`; a
  `legacy/.htaccess` denies access if the folder is ever uploaded to an Apache host by hand. For hand uploads (FTP,
  rsync) leave it out: `rsync -a --exclude legacy/ ./ host:/www/`.
- Tested by `scripts/test-project.cjs` (`--build` also builds a Next.js sample with legacy/ present, `--browser` opens
  an HTML sample after install and uninstall): on four sample projects the project is broken on purpose after the
  install, and restore gives back every file with the same hash.

### 3. Configure
`SwarmRebuild.start(options)` / `<SwarmRebuild {...options} />` / `window.SwarmRebuildConfig = {...}`:

| option | default | notes |
|---|---|---|
| `mode` | `'scroll'` | `'scroll'`, `'fast'`; `'tour'` only with the debug add-on |
| `speed` | per mode | base time scale (1 = video timing); scroll 3, fast 6, tour 1 |
| `agents` | auto | max agents; auto = layers/8 clamped to 10..30 (mobile <= 8). Starts at 60 % and grows per section. |
| `colors` | pastel set | agent colours (teal, pink, peach, lavender, sky, mint, white) |
| `palette` | `'pastel'` | `'page'`: agent colours from the page's own buttons, links and headings (one brand colour gives a family of neighbouring hues; made readable on the page background; falls back to pastel); `data-palette`, `?rebuild-palette=page` (debug) |
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
| `buildVisible` | `0.6` | scroll / fast: share of an element (of the screen for taller ones) that must be in view before it starts (0.1..1). Measured: every start 60-100 % in view (median 100 %), the same build time with 0.5..0.8; higher values leave a part at the bottom edge empty longer while the visitor rests |
| `a11yText` | in the page's language | the status message screen readers get while the page is hidden |
| `exitOn` | `'intent'` | what ends the effect: `'intent'` = Esc (not when the page uses it for its own dialog / menu; Esc twice always) or a double click / double tap on an empty spot; `'esc'` = only Esc; `'any'` = any click, tap or key except scroll keys (1.3.0) |
| `surface` | `dialog,[role="dialog"],[role="alertdialog"],[aria-modal="true"],[data-swarm-surface]` | the page's own surfaces: shown at once, never built, never covered (also in the page flow, when small enough and holding a control) |
| `surfaceNames` | `true` | also elements whose id / class / aria-label reads like a consent banner (consent, gdpr, ccpa, cookie-banner, cookie-bar, cookie-notice ...); `false` = off |
| `pauseOnModal` | `true` | a modal with a backdrop (or an open modal `<dialog>`) pauses the build and hides the overlay until it closes |
| `focus` | `null` (auto) | selector or element the opening / finale swarms gather around (see Motion); ask the developer |
| `motion` | see below | merged key by key: `swarms` (true), `mouse` (true), `arc` (1 = gravity sag, 0 = straight), `difficulty` (1, 0 = all tasks alike), `spring` (1 = finale overshoot, 0 = none), `lite` (`'auto'` \| true \| false) |
| `onDone` | `null` | callback `{elapsed, layers, agents}` or `{skipped: true, reason}` |

URL parameters: `?rebuild=1` (force), `?rebuild=0` (off), `?rebuild-mode=scroll|fast|tour`, `?rebuild-debug=1`
(debug add-on). With the debug add-on only: `?rebuild-speed=<n>`, `?rebuild-fault=task|stall|loop|die@<s>` (fault
injection for tests), `?rebuild-hidden-max=<s>`, `?rebuild-motion=arc:0,difficulty:0,mouse:false,lite:true` (motion
A/B), `?rebuild-focus=<selector>`, `?rebuild-visible=<share>`.
API: `SwarmRebuild.skip()`, `.goLive()`, `.replay()`, `.stop()`, `.state()` (`phase` scan / build / done, `loading`
while the debug add-on is fetched, `idle` with `lastExit` after the end),
`.stats()`, `.headSnippet()`, `.defaults`, `.version`; test hooks `._pause(on)`, `._probe()` and `._motion()` (debug
add-on: paths of all moves, work time of every task, agent positions, mouse follows).

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
Other verify options: `--consent "<selector>"` (a consent banner's button must work at the first click during the
build and the build must go on), `--menu "<toggle>|<panel>"` / `--menu-mobile`, `--field "<selector>"`,
`--popup "<open>|<close>"`, `--anchor "<in-page link>"`, `--route "<client-side route link>"`, `--late` (the banner is added
by a script later) for the `interact` group, `--module <file>` (serve another module file, e.g. an older version, for
comparisons), `--color-scheme dark`, `--dom-volatile "class,style"` (attributes the page changes by itself), `--settle "<js>"`
(stop a carousel before the "looks identical" screenshots; videos are always paused at their first frame).
`--checks` (comma list): `record` (one recorded run in `--mode`), `extra` (reduced motion, debug ✕ and Replay, no-JS),
`product` (no bar / no auto-scroll / add-on not loaded without the flag in all three modes, the flag shows the bar,
default mode scroll, scroll keys scroll and drive the build, Esc ends the effect at once without layout shift while
letters / Tab / Enter / Ctrl+arrow / a lone Shift do not, a click or tap on unfinished content does nothing (no
navigation) and the build goes on, a click on finished content (`--interact`) works and the build goes on),
`interact` (the visitor uses the page while it builds: the consent button clicked / tapped at 0.5 s, 2 s and the middle
of the build works at once, the choice is stored, the build goes on and ends with the same DOM as the page after the
same click without the effect, CLS 0; Tab to the button + Enter / Space; menu, form field, pop-up with a backdrop
(the build waits, Esc closes the pop-up and not the effect), in-page link (view filled within 2.5 s), client-side route
(the new page complete at once); one click / tap, slow taps, taps while scrolling do not end it; a double click / tap on
an empty spot and Esc do; reduced motion still switches it off), `seen` (how much of the build a visitor sees who
presses Accept at 0.5 s / 2 s; with `--module` also for an older version),
`protect` (everything above the view final during fast scrolling, faults `task` / `stall` / `loop` / `die`, resize,
background tab), `visible` (scroll mode builds only what is in view: every start >= `buildVisible` in view, no
working agent outside the view, no task out of view, fill time after wheel bursts / Page Down / End <= 2 s on average,
contact sheet `sheet-visible.jpg`), `fixed` (pixel test: overlay shown vs. hidden, module paused, at ~17 moments of a visitor run, for every
fixed and finished sticky element in view), `motion` (opening swarms around the focus with changing speed and no
perfect circle, the finale's spring pull with overshoot and slow circling, mouse play on desktop: dodge, never closer than
36 px, shorter follows when the pointer leaves faster, moves do not end the effect; gravity sag of horizontal moves and
none of vertical ones; difficulty: bigger parts take longer, at most ~4x; contact sheets `sheet-opening.jpg` /
`sheet-finale.jpg`), `manual` (debug tour interrupted by wheel scrolling, then a scroll-mode run),
`a11y` (crawlers get the finished page, overlay aria-hidden with nothing focusable, status message, the first Tab lands
where it would without the effect with the focused part visible, Esc then ends it), `text` (typing in any language: every frame, the typed part of every text ends on a character boundary, and the
caret sits after the last typed character on its writing side), `all` = record,extra,product,interact,protect,fixed,visible,text,a11y,motion. `--interact "<selector>"` also clicks an element after the effect and
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
node scripts/bench-fps.cjs --old-ref 5be439c   # fps + build time of an older version (5be439c = 1.1.0, c332016 = 1.0.1)
```
Reference numbers on the demo, desktop 1440x900 (the developer's own machine, Nov 2026, module 1.0.0): fast (now
`tour` at speed 6) 8.9 s / 59 fps / CLS 0.0007; tour 43.2 s, 27 agents / 59.6 fps / CLS 0.0021, scroll progress at
20/40/60/80/98 % of the run 0.16/0.32/0.64/0.83/1.0; scroll 8.4 s / 59.5 fps / CLS 0.0014; DOM identical, 0.000 % pixel
difference. The demo has 214 layers since 1.0.1 (212 before).

Typical fixes: a section is too dense or a widget behaves oddly -> add it to `exclude`; a bar should never be animated ->
`data-swarm-instant`; the page uses its own scroll-reveal animations (elements start at opacity 0) -> those elements are
skipped by the scan and appear when the page animates them, which is expected.

### Demo video (portfolio, client presentation)
```bash
node $S/scripts/record-video.cjs --url http://localhost:3000/ --out swarm-demo.mp4            # whole page, 1x tour
node $S/scripts/record-video.cjs --url http://localhost:3000/ --speed 3 --palette page --out short.mp4
node $S/scripts/record-video.cjs --url http://localhost:3000/ --device mobile --mode scroll --out phone.mp4
```
The tour is a debug / recording tool only; visitors never get it.

### 5. Report
Tell the user: mode and options chosen, files added/changed, verify results (build time, layers, agents, fps, DOM/pixel
diff), anything excluded and why, how to test on the live site (`?rebuild=1`, `?rebuild-debug=1`) and how to turn it
off (`?rebuild=0` for one visit; `project.cjs uninstall` removes it for good; `restore` gives back the original files),
and where the backup is (`legacy/<stamp>-install/backup.txt`).

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
  speed; the nearest idle agent takes the next task. Visitor-driven: only layers with >= `buildVisible` in view (a row
  of copies: only the copies in view, the rest later); an agent far off screen enters from the nearest edge; working
  agents are kept on screen. Tour (debug): the camera keeps the lowest
  active layer in the lower third (base 0.09 viewport heights/s x speed, up to 3x when the next section's frames reach
  the bottom edge).
- **Motion**: free agents = damped springs (semi-implicit Euler, sub-steps of 17 ms) towards places in swarms; task
  agents follow their phase's curve; when a task lets an agent go, its measured velocity carries on (no stop).
- **Every overlay element a task creates is recorded on the task**, so a failed, stuck or out-of-sight task can be
  completed and cleaned up on its own.
- **Debug control bar**: fixed, moved with `transform` only (never a layout shift); repositions only when its spot
  gets covered by a fixed element (and on mobile by phone links / buttons). Its styles come with the add-on.
- **Accessibility**: `prefers-reduced-motion` skips everything; Esc shows the finished page immediately; Tab focus
  builds the focused part at once; the overlay is `aria-hidden`. While the effect runs, content not yet built is also hidden from screen
  readers (it is `visibility: hidden`).

## Known limitations
- Content not yet built is hidden from screen readers too (see above); the status message tells them to press Esc,
  which shows the page at once, and Tab focus builds the focused part at once.
- A modal with a backdrop that is open at load (a consent wall) holds the opening until it is answered; behind it the
  page's background is empty (it is not built yet) instead of the dimmed page.
- A layout change while a part is being built finishes that part at once (a small pop instead of an animation at a
  stale place).
- Pages that scroll an inner container (not the window): the build follows the window only; use `fast` or exclude it.
- The overlay is not drawn in the strip between a fixed element and the nearest viewport edge (e.g. along the bottom
  edge next to a floating button), so agents passing there disappear for a moment. Fixed elements that cover more than half of the viewport are not cut out (they are treated as
  backgrounds).
- Tools that fast-forward all animations (e.g. Playwright `screenshot({ animations: 'disabled' })`) also fast-forward
  the safety switch: the page is then shown at once (fails safe).
