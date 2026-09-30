# RootDas Pentest Book

Portfolio and field notebook of **Luiz Kelme**, a Junior SOC Analyst. It holds pentest reports, malware reversing and incident-response write-ups.
Live at **https://kelme108.github.io/portfolio/**.

Built with Jekyll using the `github-pages` gem, so GitHub Pages builds it as-is. There is no framework and no build step beyond Jekyll: one CSS file and one dependency-free JS file.

## Features

- Mobile-first layout from 320px to 2560px:
  - Fixed sidebar on desktop, accessible drawer on mobile.
  - Tested with no horizontal overflow at 10 viewports (see [docs/RESPONSIVE.md](docs/RESPONSIVE.md)).
- Light / System / Dark theme, with no flash on load.
- Command-palette search: <kbd>Ctrl</kbd>+<kbd>K</kbd> or <kbd>/</kbd>. It searches titles, tags and write-up text using `/search.json`.
- Write-up index with platform, difficulty and category filters. The filter state is kept in the URL, e.g. `/writeups/?difficulty=medium`.
- Write-up pages include:
  - Auto-generated table of contents with scroll-spy.
  - Reading progress bar and reading time.
  - Copy button and language label on every code block.
  - Scrollable tables and a lightbox for screenshots.
  - Heading anchors, prev/next navigation and related write-ups by shared tags.
- Tags, Categories and Archives pages, generated from front matter.
- Home page:
  - Hero with a terminal card.
  - Stats computed at build time.
  - "Recently Updated" and "Trending Tags" panels.
  - Incident workflow section and a toolkit section.
- SEO via `jekyll-seo-tag`, plus sitemap, RSS feed and a custom 404.

## Run locally

With Ruby 3.x installed:

```bash
bundle install
bundle exec jekyll serve --livereload
# → http://localhost:4000/portfolio/
```

Or, without installing Ruby (Docker, PowerShell):

```powershell
docker run --rm -p 4000:4000 -v "${PWD}:/srv" -v rootdas-gems:/usr/local/bundle -w /srv ruby:3.3 `
  bash -c "bundle install && bundle exec jekyll serve --host 0.0.0.0"
```

## Tests

`tests/responsive.mjs` runs Playwright and axe against the built `_site/`. It checks three things:

- Horizontal overflow on every page at 10 viewports.
- Key interactions: drawer, search, TOC, copy, lightbox, theme and filters.
- WCAG 2.1 AA with axe, in both color schemes.

```powershell
# build first (see above, replace `serve` with `build`), then:
docker run --rm -v "${PWD}:/work" -w /work/tests mcr.microsoft.com/playwright:v1.49.0-noble `
  bash -c "npm install --no-audit --no-fund && node responsive.mjs"
```

The report and screenshots go to `tests/output/`, which is git-ignored. `tests/shots.mjs` captures viewport screenshots of the key UI states.
CI runs the same suite on every push and PR (`.github/workflows/ci.yml`).

## Project structure

```
_config.yml            site settings, author, collections
_data/navigation.yml   sidebar links
_data/stack.yml        toolkit shown on Home and About
_includes/             head, sidebar, topbar, icon (inline SVG), cards, panel, tag cloud, search
_layouts/              default (app shell), writeup, project
_writeups/<platform>/  one Markdown file per write-up
_projects/             (optional) project pages — layout: project
assets/css/style.css   the only stylesheet (tokens, layout, components)
assets/js/main.js      the only script (theme, drawer, search, TOC, copy, lightbox, filters)
search.json            search index generated at build time
tests/                 Playwright + axe suite
docs/                  responsive notes, screenshots, write-up template
```

## Publishing a write-up

1. Copy [docs/writeup-template.md](docs/writeup-template.md) to `_writeups/<platform>/<slug>.md`.
2. Put screenshots in `assets/writeups/<slug>/` and reference them with `{{ '/assets/writeups/<slug>/image.png' | relative_url }}`. Always write a descriptive alt text, because it becomes the lightbox caption.
3. Fill in the front matter:
   - `difficulty` must be one of `Very Easy`, `Easy`, `Medium`, `Hard`, `Insane`.
   - `tags` feed the Tags page, the related posts and search.
4. Use `##` for sections, because they become the table of contents. Don't add a `#` title, since the layout already renders it.
5. Build locally and run the tests before pushing.

> Only publish write-ups for **retired** machines or labs that allow it. Hack The Box, for example, forbids write-ups of active machines.
