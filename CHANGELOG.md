# Changelog

## 1.4.0 — 2026-11-06 — visitors can use the page while it builds

Why 1.4.0 and not 1.3.1: the default behaviour changes (what ends the effect) and there are new options; the old
behaviour stays available with `exitOn: 'any'`.

Module (`assets/`)
- **Clicks, taps and keys on the page no longer end the effect.** A consent banner, a pop-up, a menu, a language
  switcher, form fields, a chat widget, links and buttons work as usual with the mouse, by touch and with the keyboard
  (Tab, Enter, Space, typing), and the build goes on. In 1.3.0 every click or key ended it: on a page that opens with a
  consent banner, a visitor who pressed "Accept" right away saw about 5-15 % of the effect (measured below).
- **Ending it is deliberate** (new option `exitOn`, default `'intent'`): Esc ends it (not when the page uses that Esc for
  its own open dialog, menu or list; a second Esc within 1.5 s always ends it), and so does a double click / double tap
  on an empty spot (not on a control, a dialog, a fixed bar or text; a double tap does not zoom). One click or tap,
  two slow taps and taps while the page scrolls never end it. `'esc'` = only Esc, `'any'` = 1.3.0.
- **Keyboard focus on a part that is not built yet builds that part at once**, so the focus ring is always visible;
  the screen-reader message (19 languages) now says "press Escape".
- **The page's own surfaces are never built:** dialogs (`<dialog>`, `role="dialog"`, `aria-modal`),
  `[data-swarm-surface]` and elements named like a consent banner (consent, gdpr, cookie-banner, cookie-bar ...; not
  `cookie-card`), also a bar at the top in the page flow, are shown at once and cut out of the overlay (new options
  `surface`, `surfaceNames`). Fixed elements hidden at the scan (a pop-up shown later) are cut out when they appear.
- **Layout changes made by the page are followed:** a consent bar at the top that closes and moves the content up, a
  menu or accordion that pushes the content, a late font or image. A few elements are checked every 0.15 s (0.05 s right
  after a click or key); when one moved, all parts are measured again; a part being built at that moment is finished
  at once, parts removed by the page are dropped. The reveal rules are renewed in the same task as the DOM change
  (before the next paint). CLS stays 0.
- **A modal with a backdrop pauses the build** (new option `pauseOnModal`): the overlay is hidden, the build and the
  watchdogs wait, and everything goes on where it was when it closes. A consent wall at load holds the opening.
- **Client-side navigation:** a new URL (not a hash change) or most of the unbuilt content removed shows the new page
  complete at once.

Verify (`scripts/verify.cjs`)
- New group `interact` (options `--consent`, `--menu`, `--menu-mobile`, `--field`, `--popup`, `--anchor`, `--route`,
  `--late`) and `seen`; `--module <file>` serves another module file (e.g. 1.3.0) for comparisons. `product`, `a11y`
  and `motion` follow the new rules (only Esc / a double click end the effect; Tab lands where it would without it).

Test pages
- New `tests/pages/bakery`: a bakery-café with a consent banner in four forms (`?banner=top|modal|bottom|late`),
  drop-down and hamburger menu, language switcher, order form, newsletter pop-up with a backdrop, chat widget added
  later, in-page links; on the landing page and in the Pages build.

Size: module 30.8 KB gzip (budget raised from 30 to 32 KB for the interaction handling), stylesheet 1.6 KB.

## 1.3.0 — 2026-11-05 — visible-only build, any language, safe install

Module (`assets/`)
- **Scroll mode builds only what is in view.** An element starts when at least `buildVisible` (new option, 0.6) of its
  height is on screen (of the screen for taller elements, so they build from the top down); the "view + half a viewport
  ahead" rule is gone. Running tasks that scroll out of view are completed at once (also below the view), mostly hidden
  ones are fast-forwarded, working agents are kept on screen, rows of copies copy only the members in view (the rest
  later; a far-away master card no longer makes an invisible trip). Unbuilt parts across the top edge with less than the
  start share in view are final at once. Measured with the same probe, demo desktop: 1.2.0 started 58 of 120 parts
  under 60 % in view (many at 0 %) and had working agents off screen in 42 % of the samples; 1.3.0: every start
  60-100 % in view (median 100 %), no agent off screen; after fast scrolls the view is filled in 0.4-2.4 s (average
  1.1-1.5 s).
- **Resting agents never cluster:** an agent without work rests at its own spot in view (72 px from the others),
  drifts slowly and fades out after 1.4 s; it fades in with its next task; swarms stay for the opening and the finale.
  Overlapping idle cursors per frame: 1.2.0 median 6 (up to 20) on the demo, 1.3.0 median 0 (3 or more in at most
  0.4 % of the frames).
- **Any language and writing direction:** typing by grapheme clusters (`Intl.Segmenter`, with a fallback): accents,
  emoji ZWJ sequences, skin tones, flags, Arabic / Hebrew marks are never split. Right-to-left elements: frames grow
  from the right, lines from right to left, the caret sits left of the last typed letter, left-to-right runs (numbers,
  e-mail addresses) inside RTL text are typed as a whole; the overlay is always laid out left to right. Numbers in any
  script count as numbers. Nothing assumes English (the screen-reader message comes in 19 languages).
- **Real-world pages:** parts not shown at the scan (carousel slides, tabs, menus, modals) are final at once, so they
  appear complete when the page shows them; scroll-reveal sections (opacity 0 until in view) are built like the rest.
- **Search engines and accessibility:** crawlers (Googlebot, Bingbot, link previews ...) never get the effect (head
  snippet and module); screen readers get a status message in the page's language while the content is hidden (new
  option `a11yText`), outside `<body>`, removed at the end.
- **Brand colours:** new option `palette: 'page'` takes the agent colours from the page's buttons, links and headings.
- **Minified builds** `swarm-rebuild.min.js`, `swarm-rebuild-debug.min.js`, `swarm-rebuild.min.css`: a visitor
  downloads 28.3 KB + 1.6 KB gzip (the readable source would be 42.4 KB); budget 30 + 2 KB.
- Performance: the grapheme / direction work is done only for texts that are typed (it cost 1.8 fps in the 6x tour).

Scripts
- `project.cjs` install / uninstall / restore / list: every file is backed up to `legacy/<date-time>-<action>/` first
  (`backup.txt`, `manifest.json`, `.orig` copies); insertions are marked, uninstall removes exactly them and keeps later
  edits, restore gives back the original bytes (SHA-256 checked); legacy/ is git-ignored and never built.
  `test-project.cjs`: four sample projects (HTML, Next.js App / Pages Router, Vite + React) broken on purpose and
  restored hash-identical, uninstall, a Next.js build with legacy/ present, the effect in a browser after install and no
  trace after uninstall.
- `verify.cjs`: new groups `visible` (start share, agents off screen, fill time after fast scrolls, idle clusters,
  contact sheet), `text` (no split characters, caret side), `a11y` (crawlers, aria-hidden overlay, status message, no
  focus trap); options `--consent`, `--color-scheme`, `--dom-volatile`, `--settle`; the reference page is read once
  before its screenshot, videos are paused for screenshots, the fixed-element pixel test waits for scrolling to stop.
- `perf.cjs` (Lighthouse with / without the effect), `build-min.cjs` (minified files + size budget),
  `record-video.cjs` (an .mp4 of the effect for a portfolio), `sync-snippet.cjs` (head snippet copies).
- `run-tests.cjs`: 11 test pages (new: law, accounting, Bootstrap 5, single-page app, Hungarian, Arabic, Japanese,
  emoji) plus the installer test.

Measurements: see STATUS.md ("Task 4" and the final suite).

## 1.2.0 — 2026-11-04 — more natural motion

Module (`assets/`)
- **Swarms instead of a perfect circle.** Free agents (opening, waiting for work, finale) are moved by damped springs
  towards places in 2–4 swarms of clearly different sizes (phones: 2). The swarm centres circle an ellipse around a
  **focus element** whose radius breathes and whose pace changes, so agents speed up and slow down by themselves. The
  opening starts in swarms already (it is well under a second for visitors). Idle swarms during the build glide between
  spots in view and settle there (resting agents cost no repaint).
- **Focus element:** new option `focus` (selector or element; also `data-focus`, `[data-swarm-focus]`). Per phase the
  first one at least half in view is used, then `h1`, a main button, the logo, the largest picture, a spot in view. The
  skill now asks the developer for it (SKILL.md step 1). The demo uses `#reel` ("Make it feel real"), the dental page
  `#booking .btn` (via `data-focus`), the Next.js page the automatic choice.
- **Finale:** a stiff, under-damped spring (damping 0.63) pulls the agents to the focus: fastest at the start, measured
  overshoot 8–17 % of the way, then back; after ~1 s the swarms circle slowly. Replaces the ring.
- **Mouse** (opening and finale, desktop only, never on touch / phones / reduced motion): agents near the pointer move
  out of its way; up to 3 curious ones follow it on a small circle for 1.3–2 s, shorter the faster it moves away; never
  closer than 36 px. Measured: 1.4–1.5 s when the pointer leaves at 120 px/s, 0.9–1.1 s at 1300 px/s; closest 36 px.
- **Gravity:** the way to a task (and a carried clone copy) bends downwards with the weight of the element
  (sqrt(area) / 320 px, 0.2..1) and the square of the horizontal share: sag 0.2 x horizontal distance x weight x
  horizontality², max 56 px. Vertical moves stay straight. The way to a task starts with the agent's current velocity
  (cubic Hermite curve), so no sudden stops.
- **Difficulty:** each task's work is scaled by a difficulty from its area (typing: the box): 2x area ~1.6–1.8x near
  the page average, squashed so the hardest is at most 4x the easiest, normalised (weighted by task length and
  difficulty, because parallel tasks make the long ones set the pace) so the build time stays the same. A plain average
  made the 6x tour 9 % slower (9.2 -> 10.0 s); the weighted one keeps it at 9.2 s. Typing time now depends on the box,
  not the letter count (its page average is kept).
- **Scroll keys scroll:** Space, arrows, Page Up / Down, Home / End (focus on the page, no Ctrl / Alt / Meta) drive the
  build like the wheel; Tab, Enter, Esc and all other keys still end the effect (keyboard users reach the content at
  once). In the debug tour, a scroll key hands over to the visitor like the wheel.
- **Lite:** phones get 2 swarms and no mouse play; when the frame rate stays below 38 fps for two
  seconds, also one trail ghost instead of three (`motion.lite`).
- New option `motion` (`swarms`, `mouse`, `arc`, `difficulty`, `spring`, `lite`); debug parameters
  `?rebuild-motion=key:value,...` and `?rebuild-focus=`; debug hook `SwarmRebuild._motion()`; `state()` reports
  `focus`, `swarms`, `lite`, `mouseOn`, `mouse`, `diff`.
- Version 1.1.0 -> 1.2.0.

Tests and tools
- verify.cjs: new check group `motion` (in `all`): opening swarms around the focus with changing speed and no perfect
  circle; finale overshoot, early top speed, slow end; mouse dodge / follow / distance / no exit (desktop) or lite (touch);
  gravity sag horizontal vs vertical and heavy vs light; difficulty (rank correlation, big/small ratio, max 4x);
  contact sheets `sheet-opening.jpg` and `sheet-finale.jpg`. `product`: scroll keys drive the build; Enter and Ctrl+arrow
  end it.
- bench-fps.cjs: compares 1.1+ versions with the same parameters, serves the old debug add-on, reports build time.
- run-tests.cjs: motion summary lines; longer time limit for the long runs.
- tests/index.html: a "motion extras off (compare)" link per page.

Measurements (same cloud container, no GPU, interleaved with 1.1.0 = commit 5be439c, `bench-fps.cjs`)

| device | page | mode | fps 1.1.0 -> 1.2.0 | build time s 1.1.0 -> 1.2.0 |
|---|---|---|---|---|
| desktop | demo | tour | 58.4 -> 58.4 | 44.0 -> 43.3 |
| desktop | demo | tour 6x | 52.3 -> 55.1 | 9.1 -> 9.2 |
| desktop | demo | scroll | 53.9 -> 55.2 | 9.2 -> 9.0 |
| desktop | demo | fast | 54.0 -> 55.5 | 8.2 -> 8.2 |
| desktop | dental | tour | 59.9 -> 59.9 | 33.4 -> 30.8 |
| desktop | dental | tour 6x | 57.8 -> 57.5 | 7.0 -> 7.0 |
| desktop | dental | scroll | 55.6 -> 54.3 (5 runs each) | 7.0 -> 6.4 |
| desktop | dental | fast | 56.0 -> 55.7 (5 runs each) | 6.1 -> 6.1 |
| mobile | demo / dental | all four | 59–60 -> 59–60 | within ±5 % (dental tour 46.6 -> 44.3) |

- Build time within ±10 % everywhere (largest: dental scroll -8 %, dental tour -8 %: small parts finish sooner).
- fps: equal or higher except dental desktop scroll, -1.3 fps (-2.3 %), seen in every repeat; switching off each new
  part (`?rebuild-motion=`) did not change it beyond the run-to-run spread (±1.5 fps), so the cause is not found.
  Two real costs were found and removed on the way: trails on idle agents and their constant micro-motion (~1 fps).
- CLS 0.0000 in all 15 suite runs, body DOM identical, 0.000 % pixel difference, fixed elements never covered (8–17
  pixel samples per page), above-the-view probes 0 not final.
- Motion (verify `motion`, demo / dental / Next.js): finale overshoot 3–18 % of the way, top speed within 0.15 s;
  gravity sag of horizontal moves 3.5–7.6 % of the distance (heavy elements 9.6–14.5 %, light 3.5–4 %), vertical
  moves 0 %, never more than 56 px; difficulty: rank correlation area ~ work 0.75–0.89 within one kind of task;
  mouse: closest 36 px, follow 1.38–1.68 s when the pointer leaves at 120 px/s, 0.84–0.99 s at 1300 px/s.
- Size for visitors: 116.5 + 7.5 KB raw, 36.5 + 2.0 KB gzip (1.1.0: 95.9 + 7.5 KB, 28.9 + 2.0 KB gzip); the debug
  add-on 31.5 KB (8.8 KB gzip), not loaded for visitors.

## 1.1.0 — 2026-11-04 — product behaviour, protection, test pages online

Module (`assets/`)
- **Visitors see no controls and get no automatic scroll.** The control bar, the auto-scroll tour and the test hooks
  moved to a separate add-on, `swarm-rebuild-debug.js`, loaded only with `?rebuild-debug=1` / `debug: true`
  (script-tag installs fetch it next to the module; the React wrapper imports it as a lazy chunk). Its styles come
  with it, so `swarm-rebuild.css` is 7.5 KB instead of 17.9 KB.
- **Default mode is `scroll`.** `fast` now follows the visitor too (6x); `tour` exists only with the debug add-on
  (without it, it falls back to `scroll`); the old "fast" is `tour` at speed 6 (`?rebuild-speed=6`, debug).
- **Ways out without controls:** Esc, any other key (not a lone modifier) and any click / tap show the finished page at
  once, with no layout shift. A click on unfinished content is swallowed (no navigation, no action); a click on
  finished content goes through. Touch scrolling and the scrollbar do not end the effect. Reduced motion: no effect.
- **Above the view:** whatever scrolls more than 0.1 viewport (min. 40 px) above the top edge is final at once, without
  animation, including single copies of a clone group; agents working there are freed at once.
- **Protection:** an exception in a task completes that part; an 8 s task watchdog; loop / scan / stall watchdogs show
  the whole page; a CSS dead-man switch (Web Animation on `<html>`) shows the page 5 s after the script stops, also
  from the head snippet when the module never loads; elements the page hides itself keep their visibility then;
  resize to a new width, a return after 30 s in a background tab and a back/forward-cache return show the finished page;
  content added after the scan is shown at once.
- **Fixed elements are never covered:** the overlay is clipped around `position: fixed` elements (and finished sticky
  ones). The clip is always a cheap `inset()`: each fixed element is covered by the narrowest strip from it to a
  viewport edge (an even-odd `path()` only if the strips would hide more than 40 % of the screen — a path clip cost
  ~25 % fps without a GPU). Fixes the hero placeholder passing over the dental page's "Call us" bar.
- **CLS:** typing keeps the untyped rest of every text node as hidden text, so words never jump to the next line, and
  the image icon in placeholders is centred with a transform. The fast-run CLS of 0.004 came from a word wrapping during
  typing (the same in 1.0.0, it depended on frame timing); five recorded runs now measure 0.0000.
- autoExit default: 3 s for visitors (debug: 6 s, tour: never).
- `state()` returns `{ phase: 'loading' }` while the debug add-on is being fetched (it said `idle` before).
- Measured in the same cloud container, interleaved with 1.0.1: fps equal or higher in every mode (demo desktop scroll
  50.1 -> 54.0, tour at 6x 50.3 -> 51.8; dental desktop tour at 6x 55.2 -> 57.7; mobile 59–60 both). Visitors download
  95.9 + 7.5 KB (30.9 KB gzip) instead of 88.2 + 17.9 KB (29.4 KB gzip): the protection code is a bit larger than
  the control bar and tour that moved out.
- New API: `defaults`, `state().lastExit`, `_pause()`; debug: `_probe()`, `?rebuild-fault=`, `?rebuild-speed=`,
  `?rebuild-hidden-max=`. `data-auto` also reads `data-debug` and `data-debug-src`.
- Version 1.0.1 -> 1.1.0.

Tests and tools (`scripts/`, `tests/`)
- verify.cjs: new check groups `product`, `protect`, `fixed` (in `all`), `extra` split out; `--speed`; the recorded run
  is a visitor run in `scroll` / `fast` and a debug run in `tour`; default `--mode scroll`, `--timeout 400`.
- run-tests.cjs: the full run per page and device is `tour --speed 6` with `all,manual`, plus visitor runs
  (`scroll`, demo also `fast`); summary lists fixed-element samples and above-the-view probes.
- New: `bench-fps.cjs` (old tag vs. working copy, interleaved), `build-site.cjs` (static site / local server),
  `next-app.cjs` (shared Next.js helper), `tests/index.html` (links to every page in every mode).
- Test pages: dental has a fixed cookie-style notice on desktop; the Next.js app a fixed Help button and a static
  export mode (`NEXT_EXPORT=1`, `NEXT_BASE_PATH`); the demo starts in the default mode.
- `.github/workflows/pages.yml` publishes the test pages to GitHub Pages.

## 1.0.1 — 2026-11-04 — baseline reconciled in swarm-skill

First version in this repository. It merges the two copies that existed before:
`Kiskujab/swarm-demo` (module, CSS, demo, React wrapper — Nov 3, after the three follow-up fixes) and
`Kiskujab/shiny/page-swarm-rebuild` (SKILL.md, references, verify script — Nov 2, before those fixes).

Module (`assets/`)
- Taken from swarm-demo: no sound, agents follow the viewport (tour hands over to the visitor on manual scrolling),
  control bar at the right edge (compact, collapsible, small tab on mobile, `controlsPosition: right | left | bottom`).
- Fix: a phone link (or another `instant` / `exclude` element) inside a repeated row (e.g. a contact list) stayed
  hidden until the clone animation reached it. Such rows are no longer cloned, so the link shows at once.
  The demo now counts 214 layers instead of 212 (its contact rows are built one by one).
- Version 1.0.0 -> 1.0.1.

SKILL.md
- Brought up to date with the module: no sound, `controlsPosition` and `avoid` options, visitor-driven building
  (view + 0.5 viewport below), agent count layers/8 clamped 10..30, `data-auto` attributes.
- Product decisions written down (scroll is the main mode, control bar and tour are test tools only, no sound,
  Esc / reduced motion as the way out) together with what module 1.0.1 does not do yet.
- New sections: test pages, regression suite, reference numbers, known limitations.

references/effekt-leiras.md
- Note at the top on where the skill differs from the video; sound marked as dropped; viewport-following noted.
- ffmpeg `-vsync 0` replaced with `-fps_mode passthrough`.

scripts/verify.cjs
- New `--checks manual`: a tour interrupted by wheel scrolling, then a scroll-mode run; checks that the tour stops,
  the build never runs more than 0.5 viewport below the view, empty layers start quickly, the run ends with the
  original DOM, and the control bar never covers fixed bars (mobile: also phone links, buttons, button-like links).
- New: `--device mobile`, `--interact <selector>`, `--min-fps`, console error / hydration check, "phone links and
  fixed elements visible during the build" check, fps measured in a separate run without screenshots.
- Hard time limit per run (`--timeout`, default 300 s); the DOM-difference loop is bounded; the collapsed bar is
  opened before clicking ✕ / Replay.

scripts/run-tests.cjs (new)
- Runs verify.cjs on the demo, the dental page and the Next.js app, desktop and mobile, on free ports; installs the
  Next.js app's dependencies in a temp folder; stops all servers at the end; writes summary.md / summary.json.

tests/pages/ (new, rebuilt — the originals only existed in a temp folder on the developer's machine)
- `dental/`: fictional dental practice, long enough for manual scrolling, fixed "Call us" + booking bar on mobile.
- `nextjs/`: fictional Next.js 15 App Router app with a React counter button.
