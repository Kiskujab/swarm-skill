# page-swarm-rebuild (Claude Code skill)

A Claude Code skill that adds a "the page rebuilds itself" intro effect to an existing website: a swarm of pastel
agent cursors hides the finished page and rebuilds it layer by layer, Figma-style (selection frames with size
labels, typing, image reveals, clone-and-rewrite of repeated items). The build follows the visitor's scrolling.
It only changes what is shown: the page's DOM is untouched, there is no layout shift, no dependencies, no network
requests and no sound. Works on plain HTML, React and Next.js sites.

This repository is the single source of truth for the skill.

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

## Test

Needs Node 18+, Playwright with Chromium (`npm i -g playwright && npx playwright install chromium`), optionally
ffmpeg (contact sheets) and npm access (the Next.js test app installs its dependencies at run time in a temp folder).

```bash
cd page-swarm-rebuild
node scripts/run-tests.cjs                 # demo + dental + Next.js, desktop + mobile, ~15 min
node scripts/run-tests.cjs --quick         # without the 45 s tour run
```

Results go to the system temp folder (`page-swarm-rebuild-check/summary.md`); nothing is written into the repo.

## Layout

```
page-swarm-rebuild/
  SKILL.md                 instructions for Claude (English)
  assets/                  the module: swarm-rebuild.js, swarm-rebuild.css, react/SwarmRebuild.jsx, demo/
  references/              effekt-leiras.md: description of the reference video (Hungarian)
  scripts/                 verify.cjs (Playwright checks for one page), run-tests.cjs (all test pages)
  tests/pages/             fictional test pages: dental/ (plain HTML), nextjs/ (Next.js 15 app)
```

All test content (names, texts, images, phone numbers) is fictional.

See `CHANGELOG.md` for versions.
