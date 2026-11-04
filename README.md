# page-swarm-rebuild (Claude Code skill)

A Claude Code skill that adds a "the page rebuilds itself" intro effect to an existing website: a swarm of pastel
agent cursors hides the finished page and rebuilds it layer by layer, Figma-style (selection frames with size
labels, typing, image reveals, clone-and-rewrite of repeated items). The build follows the visitor's scrolling.
Visitors see no controls: any click or key shows the finished page at once, and reduced motion means no effect.
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

## Try it

- Online (GitHub Pages, once enabled — see below): https://kiskujab.github.io/swarm-skill/tests/
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
node scripts/run-tests.cjs                 # demo + dental + Next.js, desktop + mobile, ~35 min
node scripts/run-tests.cjs --quick         # without the 45 s tour run and the demo fast run
node scripts/bench-fps.cjs --old-ref c332016   # frame rate: 1.0.1 (commit c332016) against the working copy
```

Results go to the system temp folder (`page-swarm-rebuild-check/summary.md`); nothing is written into the repo.

## Layout

```
page-swarm-rebuild/
  SKILL.md                 instructions for Claude (English)
  assets/                  swarm-rebuild.js, swarm-rebuild.css, swarm-rebuild-debug.js (debug add-on),
                           react/SwarmRebuild.jsx, demo/
  references/              effekt-leiras.md: description of the reference video (Hungarian)
  scripts/                 verify.cjs (checks one page), run-tests.cjs (all test pages), bench-fps.cjs,
                           build-site.cjs (static site / local server), next-app.cjs (helper)
  tests/                   index.html (start page), pages/dental/ (plain HTML), pages/nextjs/ (Next.js 15 app)
.github/workflows/pages.yml  publishes the test pages to GitHub Pages
```

All test content (names, texts, images, phone numbers) is fictional.

See `CHANGELOG.md` for versions.
