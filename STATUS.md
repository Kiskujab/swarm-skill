# STATUS — page-swarm-rebuild

Working notes so that work can continue after a context reset. Keep this file current at the end of every task.

## Rules

- **Principle: we develop the skill, not the demo.** Every change goes into the skill first (module, CSS, SKILL.md,
  verify script, docs); the test pages only provide evidence. The goal is a skill that works on any real website.
  A good demo with a bad skill is worth nothing. If something has to be fixed on the demo or a test page, first ask:
  is this a skill bug? If yes, fix it in the skill.
- **Single source of truth: this repository** (`Kiskujab/swarm-skill`). Do not write to `shiny` or `swarm-demo`;
  the user copies the skill into `shiny` when it is complete.
- Site-specific settings go into the site's config, never into the module.
- After every change: run verify on all three test pages, desktop and mobile (`node page-swarm-rebuild/scripts/run-tests.cjs`).
  The old baselines must not get worse: DOM identical, CLS < 0.01, fps measured against the same machine.
- No running processes left behind: debug scripts get time limits; at the end check what is still running.
- No temp files, node_modules, recordings, build output or dbg files in the repo (see `.gitignore`).
- Commit with clear messages and push to `main` at the end of every task.
- SKILL.md, code and comments in English. The user is addressed in plain, short Hungarian, without emoji; technical
  terms explained in one sentence.
- Do not copy the content of the original reference video page; test content is fictional.
- No model identifiers in commits or files.
- When the user is not around: decide yourself, note the decision and the reason.

## Decisions (with reasons)

- Main and default mode `scroll`; `fast` = scroll at 6x; `tour` (auto-scroll) is a debug/recording tool only.
- Control bar + tour + test hooks in a separate file (`swarm-rebuild-debug.js`), loaded lazily only with
  `?rebuild-debug=1` / `debug: true`: visitors never download it. Its CSS is inside the add-on.
- Exit: Esc, any key except a lone modifier, any click / tap. The ending click is swallowed only when it lands on
  unfinished content (would act on something unseen); on finished content it goes through (a visible phone link must
  work at the first tap). Mouse is handled at `pointerdown` (also blocks focus / mousedown handlers), touch at `click`
  (touchstart can be a scroll). Touch scrolling and the scrollbar do not end the effect.
- Above the view (0.1 viewport, min. 40 px band): final at once; clone groups per copy.
- Watchdogs: task 8 s, frame loop 2.5 s, scan 6 s, no progress 10 s. Dead-man switch: Web Animation on `<html>`
  (5 s, refreshed every 0.4 s; 600 s while the tab is hidden), also started by the head snippet. Elements the page
  hides itself get `revert-layer` rules so the switch never shows them.
- Resize: a new width shows the finished page (layout changed; re-animating stale positions risks half-hidden parts).
  Height-only changes (mobile URL bar) are ignored. Background > 30 s, bfcache return: finished page.
- Fixed elements: holes in the overlay with `clip-path: inset()` — each fixed element is covered by the narrowest strip
  to a viewport edge; an even-odd `path()` only if > 40 % of the screen would be lost. Reason: a path clip cost
  ~25 % fps (dental desktop 59.7 -> 44.8) in the GPU-less container; inset is free. Sticky elements get a hole once
  they are completely built.
- autoExit for visitors 3 s (6 s with debug), so the cursor ring does not linger.
- Test pages online via GitHub Pages from this (public) repo, built by a workflow (no build output committed).

## Done (1.1.0, 2026-11-04)

- Everything in sections A–F of task 2 (see CHANGELOG 1.1.0): product behaviour, protection, fixed elements,
  CLS cause found and fixed (word wrap while typing), fps old vs new measured (`scripts/bench-fps.cjs`), Pages workflow
  and local server, docs.
- Full suite (`run-tests.cjs --min-fps 45`, cloud container): 15 runs, 457/457 checks. Demo desktop: tour 44.3 s,
  scroll curve 0.16/0.32/0.64/0.83/1.0 (= baseline), tour at 6x 9.2 s (baseline 8.9), scroll 9.2 s, fast 8.0 s;
  CLS 0.0000 everywhere; DOM identical, 0.000 % pixels. Fixed-element pixel test 8–17 samples per page, never covered;
  above-the-view probes: 0 not final out of 101–1123 layer checks.
- fps v1.0.1 -> v1.1.0, same container, interleaved (demo desktop): tour 57.0 -> 57.9, tour 6x 50.3 -> 51.8,
  scroll 50.1 -> 54.0; dental desktop: tour 59.7 -> 59.9, tour 6x 55.2 -> 57.7, scroll 55.0 -> 55.8; mobile 59–60 both.
- Sizes for visitors (js + css): 1.0.1 88.2 + 17.9 KB raw (29.4 KB gzip); 1.1.0 95.9 + 7.5 KB raw (30.9 KB gzip);
  the debug add-on (30.6 KB raw, 8.5 KB gzip) is not loaded for visitors. Minified numbers not measured (no minifier
  available in the container).
- Bugs found by the new checks and fixed: a clone-start typo masked by the new safety net (now every normal run must
  need no safety fallback), `state()` reported `idle` while the debug add-on was loading (now `loading`).

## Known issues / not verified

- GitHub Pages must be switched on by the user (Settings -> Pages -> Source: GitHub Actions); the workflow has not
  run yet when this was written.
- fps in this cloud container (no GPU) is lower than on a laptop; compare only numbers from the same machine.
- Real background-tab behaviour (rAF stopped) cannot be reproduced in headless Chromium; verify simulates the
  visibility events and checks the switch timing.
- Screen readers: unbuilt content is hidden from them during the build (ends at the first key press).
- Inner scroll containers are not followed.

## Next steps (only when the user asks)

- Rounds 1 and 2 of the original plan (section 5 of the first task) are still not started.
- Ideas: a minified build of the module (size), sticky-element pixel test on more pages, a real-device check on iOS Safari.
