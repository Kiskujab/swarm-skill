# Changelog

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
