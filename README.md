# page-swarm-rebuild (Claude Code skill)

A Claude Code skill that adds a "the page rebuilds itself" intro effect to an existing website: a swarm of pastel
agent cursors hides the finished page and rebuilds it layer by layer, Figma-style (selection frames with size
labels, typing, image reveals, clone-and-rewrite of repeated items). The build follows the visitor's scrolling.
The motion is meant to look alive but stay subtle: swarms of different sizes around a focus element you choose, a
spring-like finale, paths that bend with the weight of the carried element, bigger parts taking longer, and on desktop
agents that dodge the mouse pointer and follow it for a moment.
Only what is in view is built (an element starts when 60 % of it is on screen; no agent ever works off screen), idle
agents never pile up, and text is typed correctly in any language and writing direction (accents, emoji, Arabic,
Hebrew, Japanese). Visitors see no controls and can use the page while it builds: a consent banner, menus, forms, pop-ups and links
work and the build goes on (the page may move, e.g. a banner that closes, and a pop-up with a backdrop pauses the
build). Esc or a double click / double tap on an empty spot shows the finished page at once; reduced motion, search
engines and returning visitors get the page without the effect.
It only changes what is shown: the page's DOM is untouched, there is no layout shift, no dependencies, no network
requests and no sound, and the page is never left half hidden (errors, stuck parts, a stopped script, resizing and
background tabs all end with the whole page visible). Works on plain HTML, React and Next.js sites.

This repository is the single source of truth for the skill. Rules, decisions and the current state are in
[`STATUS.md`](STATUS.md).

## Install

Copy the `page-swarm-rebuild/` folder as-is into one of:

- `~/.claude/skills/page-swarm-rebuild/` (all your projects), or
- `<project>/.claude/skills/page-swarm-rebuild/` (one project), or
- the `shiny` skills repo, replacing its `page-swarm-rebuild/` folder.

```bash
git clone https://github.com/Kiskujab/swarm-skill.git
cp -r swarm-skill/page-swarm-rebuild ~/.claude/skills/
```

Then ask Claude Code, in the website's project, e.g. "add the page-swarm-rebuild effect to this site".
`page-swarm-rebuild/SKILL.md` tells Claude how to install, configure and verify it.

The installer saves every file it touches first and can take everything out again:

```bash
node page-swarm-rebuild/scripts/project.cjs install   --project <site> --focus "#cta"   # Next.js, Vite + React or plain HTML
node page-swarm-rebuild/scripts/project.cjs uninstall --project <site>                  # remove it (later edits kept)
node page-swarm-rebuild/scripts/project.cjs restore   --project <site>                  # files exactly as before (hash-checked)
```
Backups go to `<site>/legacy/<date-time>-<action>/` (with a short `backup.txt`); `legacy/` is git-ignored and never
part of a build.

## Try it

- Online (GitHub Pages): https://kiskujab.github.io/swarm-skill/tests/
- Locally, also from a phone on the same Wi-Fi:
  ```bash
  cd page-swarm-rebuild
  node scripts/build-site.cjs --serve 8080          # prints the addresses; needs npm for the Next.js app
  node scripts/build-site.cjs --serve 8080 --no-next   # demo + dental only, no npm needed
  ```

| page | in the repo | online |
|---|---|---|
| start page (all links) | `page-swarm-rebuild/tests/index.html` | `/swarm-skill/tests/` |
| demo (portfolio) | `page-swarm-rebuild/assets/demo/index.html` | `/swarm-skill/assets/demo/index.html?rebuild=1` |
| dental practice | `page-swarm-rebuild/tests/pages/dental/index.html` | `/swarm-skill/tests/pages/dental/index.html?rebuild=1` |
| Next.js 15 app | `page-swarm-rebuild/tests/pages/nextjs/` (static export when published) | `/swarm-skill/tests/pages/nextjs/?rebuild=1` |
| law firm, accounting firm, Bootstrap shop, single-page app | `page-swarm-rebuild/tests/pages/{law,accounting,bootstrap,spa}/` | `/swarm-skill/tests/pages/<name>/index.html?rebuild=1` |
| Hungarian, Arabic (right to left), Japanese, emoji | `page-swarm-rebuild/tests/pages/lang-{hu,ar,ja,emoji}/` | `/swarm-skill/tests/pages/lang-<x>/index.html?rebuild=1` |

Add `&rebuild-mode=fast` for the fast mode, `&rebuild-mode=tour&rebuild-debug=1` for the auto-scroll tour with the
debug control bar, `?rebuild=0` for the page without the effect.

**GitHub Pages (one-time):** repository Settings -> Pages -> Build and deployment -> Source: **GitHub Actions**.
The workflow `.github/workflows/pages.yml` then publishes the test pages on every push to `main` (it can also be
started by hand under Actions -> Test pages -> Run workflow).

## Test

Needs Node 18+, Playwright with Chromium (`npm i -g playwright && npx playwright install chromium`), optionally
ffmpeg (contact sheets) and npm access (the Next.js test app installs its dependencies at run time in a temp folder).

```bash
cd page-swarm-rebuild
node scripts/run-tests.cjs                 # all 11 test pages, desktop + mobile, plus the installer test (~1.5-2 h)
node scripts/run-tests.cjs --pages core    # demo + dental + Next.js only
node scripts/run-tests.cjs --quick         # without the 45 s tour run and the demo fast run
node scripts/test-project.cjs --browser    # the installer: backup, restore of a broken project, uninstall (~1 min)
node scripts/bench-fps.cjs --old-ref 4c24a7a   # frame rate + build time: 1.2.0 (commit 4c24a7a) against the working copy
node scripts/perf.cjs --urls <url> --lighthouse <lighthouse/cli/index.js>   # LCP / CLS / TBT with and without the effect
node scripts/build-min.cjs --modules <folder with terser + csso>            # rebuild the .min files, check the size budget
node scripts/record-video.cjs --url <url> --out demo.mp4                   # a video of the effect for a portfolio
```

Results go to the system temp folder (`page-swarm-rebuild-check/summary.md`); nothing is written into the repo.

## Layout

```
page-swarm-rebuild/
  SKILL.md                 instructions for Claude (English)
  assets/                  swarm-rebuild.js, swarm-rebuild.css, swarm-rebuild-debug.js (debug add-on), their .min builds,
                           react/SwarmRebuild.jsx, demo/
  references/              effekt-leiras.md: description of the reference video (Hungarian)
  scripts/                 verify.cjs (checks one page), run-tests.cjs (all test pages), project.cjs (install / uninstall /
                           restore with backups), test-project.cjs, bench-fps.cjs, perf.cjs (Lighthouse), build-min.cjs,
                           record-video.cjs, sync-snippet.cjs, build-site.cjs (static site / local server), next-app.cjs
  tests/                   index.html (start page), pages/: dental, law, accounting, bootstrap, spa, lang-hu, lang-ar,
                           lang-ja, lang-emoji (plain HTML), nextjs (Next.js 15 app)
.github/workflows/pages.yml  publishes the test pages to GitHub Pages
```

All test content (names, texts, images, phone numbers) is fictional.

See `CHANGELOG.md` for versions.
