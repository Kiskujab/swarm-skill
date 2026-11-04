# Changelog

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
