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
- (1.2) Motion: free agents = damped springs towards places in 2–4 swarms of clearly different sizes and radii around
  a focus element (ellipse with breathing radius and changing pace). Reason: accelerating / slowing comes for free,
  nothing runs on a perfect circle, and it costs only arithmetic (no extra DOM).
- (1.2) The opening starts in swarms already: it lasts well under a second for visitors, there is no time to form them
  (making visitors wait longer on a blank page was not an option).
- (1.2) Focus element per phase: the configured one if at least half in view, else h1 / main button / logo / largest
  picture / a spot in view. The skill asks the developer (SKILL.md step 1). Demo `#reel`, dental `#booking .btn`,
  Next.js automatic.
- (1.2) Finale spring damping 0.63: measured overshoot 3–18 % (0.55 gave 31 %, 0.7 gave 3 %).
- (1.2) Mouse play only in the opening and the finale, desktop only, max 3 followers, hard minimum 36 px (the icons
  never overlap at that distance); interest drains at (1 + speed away / 220 px/s) x base.
- (1.2) Gravity sag on the way to a task and on carried clone copies only (drawing a frame or a line stays straight:
  those are gestures, not carrying).
- (1.2) Difficulty normalised weighted by task length x difficulty: a plain average made the 6x tour 9 % slower (the long
  tasks set the pace when tasks run side by side); the weighted one keeps the build time.
- (1.2) Scroll keys scroll (on the page itself, no modifier); Tab / Enter / Esc and the rest end the effect.
- (1.2) Idle swarms during the build settle when they arrive and agents at rest are not rewritten; motion trails only
  for agents at work. Reason: constant micro-motion of idle agents cost ~1 fps on the dental page without a GPU.

## Done (1.2.0, 2026-11-04)

- Task 3 (natural motion), sections A–E: swarms around a focus element, spring finale, mouse play, gravity sag,
  difficulty-based speed, scroll keys; `motion` / `focus` options; verify group `motion` with contact sheets.
- Final full suite (`run-tests.cjs --min-fps 45`): 15 runs, 1073/1074 checks; the one failure (opening "not a perfect
  circle" on dental mobile, 0.098 vs 0.1) came from a weak metric (single agents' offsets), replaced by the spread of the
  swarms' distances and re-run on demo + dental, desktop + mobile (motion group): all pass (0.21–0.36). Next.js passed
  the motion group with the old metric. CLS 0.0000 everywhere, DOM identical, 0.000 % pixels, fixed elements never
  covered, above-the-view probes 0 not final.
- fps 1.1.0 -> 1.2.0 (same container, interleaved): demo desktop tour 58.4 -> 58.4, tour 6x 52.3 -> 55.1, scroll 53.9 ->
  55.2, fast 54.0 -> 55.5; dental desktop tour 59.9 -> 59.9, tour 6x 57.8 -> 57.5, scroll 55.6 -> 54.3, fast 56.0 ->
  55.7; mobile 59–60 both. Build time within ±10 % everywhere. Motion measurements: CHANGELOG 1.2.0.

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

- GitHub Pages works: since run 11 the "Test pages" workflow deploys on every push to main (the first deploys hung at
  "updating_pages" on GitHub's side and timed out). The sample
  `nextjs.yml` workflow added on GitHub was removed: there is no package.json at the repo root, so it always fails, and it
  shares the "pages" concurrency group with `pages.yml`.
- Dental desktop scroll mode is 1.3 fps (2.3 %) slower than 1.1.0 in every repeat; turning each new motion part off
  did not change it beyond the run-to-run spread, cause not found (all other modes / pages equal or faster).
- The module grew to ~116 KB raw (~36 KB gzip) with 1.2 (motion code and its comments); a minified build is still open.
- Next.js page: no focus configured on purpose (tests the automatic choice); its finale falls back to a spot in view.
- fps in this cloud container (no GPU) is lower than on a laptop; compare only numbers from the same machine.
- Real background-tab behaviour (rAF stopped) cannot be reproduced in headless Chromium; verify simulates the
  visibility events and checks the switch timing.
- Screen readers: unbuilt content is hidden from them during the build (ends at the first key press).
- Inner scroll containers are not followed.

## Next steps (only when the user asks)

- Rounds 1 and 2 of the original plan (section 5 of the first task) are still not started.
- Ideas: a minified build of the module (size), sticky-element pixel test on more pages, a real-device check on iOS Safari,
  a real-mouse check of the mouse play (only synthetic pointer moves were tested).
