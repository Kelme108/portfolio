# Responsive design notes

## Breakpoints

| Name | Width | What changes |
|---|---|---|
| base | < 480px | Single column. Hero CTAs full width. Post meta in a 2×2 grid. |
| sm | ≥ 480px | CTAs sit inline. |
| — | ≥ 600px | Post hero: cover beside title, meta in 4 columns. Timelines go to 2 columns. Prev/next side by side. |
| md | ≥ 768px | Stats in 4 columns. Filter chips wrap instead of scrolling horizontally. |
| lg | ≥ 1100px | Fixed sidebar column. The top bar and off-canvas drawer go away. |
| xl | ≥ 1280px | TOC becomes a sticky right column (open). The Home "Recently Updated / Trending Tags" panel moves beside the grid. |

Cards don't use viewport breakpoints. They use a container query (`@container (min-width: 560px)`): a card switches to a horizontal layout (cover on the left) only when *its own* width allows it.

## Layout decisions

- **No `overflow-x: hidden` on `html`/`body`.** It hid the real overflow bugs. The causes are fixed at the source instead:
  - Every grid uses `minmax(min(100%, Npx), 1fr)` and `minmax(0, 1fr)`.
  - `pre` blocks scroll inside their own box.
  - Tables are wrapped in `.table-scroll`.
  - Long strings use `overflow-wrap: anywhere`.
- **App shell.** The layout is a CSS Grid of `nav | main` at ≥ 1100px and a single column with a sticky top bar below that. This replaces the old `padding-left: 17rem`.
- **Drawer.** Below 1100px, the sidebar is an off-canvas drawer. It has `aria-expanded`, a focus trap and `inert` on the background. Esc and backdrop clicks close it, and it locks body scroll. Without JS, the nav renders inline, so it's never unreachable. The old CSS hid the nav below 991px with no replacement.
- **Fluid type and spacing.** Sizes use `clamp()`, and the gutter is `clamp(1rem, 4vw, 2.5rem)`. Inputs use 16px so iOS doesn't zoom on focus.
- **Touch and safe areas.** Tap targets are at least 44px. `env(safe-area-inset-*)` is applied to the top bar, drawer, main and floating buttons.
- **Preferences.** The site supports `prefers-color-scheme` plus a Light/System/Dark toggle with no flash on load. It also handles `prefers-reduced-motion`, `prefers-contrast`, `forced-colors`, and has a print stylesheet.

## Test results

Run `tests/responsive.mjs` against the built `_site/` (see the README). Results from the last run:

- **Layout:** 120/120 page × viewport combinations have no horizontal overflow and no JS errors.
  - Pages: home, write-ups, all 4 write-ups, about, tags, categories, archives, projects, 404.
  - Viewports: 320×640, 375×812, 414×896, 600×960, 768×1024, 1024×768, 1280×800, 1440×900, 1920×1080, 740×360 (landscape).
- **Interactions:** 11/11 pass.
  - Mobile drawer: opens, traps focus, closes on Esc and on backdrop click.
  - Search palette.
  - TOC collapsed on mobile and open on desktop.
  - Copy buttons.
  - Table wrapping.
  - Lightbox.
  - Theme persistence.
  - Filters with URL state.
- **axe-core (WCAG 2.1 A/AA):** 0 violations. Checked on 12 pages × 2 widths (375, 1280) × 2 color schemes.

Screenshots are in [`screenshots/`](screenshots/).

## Known limitations

- Pagination is not implemented. `jekyll-paginate` only works with `_posts`, and write-ups are a collection. The Home page shows the latest `home_writeups` items (see `_config.yml`), and `/writeups/` lists everything with filters. Revisit this at around 30+ write-ups.
- Screenshots in the write-ups are large PNGs, some up to ~0.9 MB. They lazy-load, but converting them to WebP would noticeably improve mobile LCP.
- Images embedded with raw `<img>` in `unified.md` have no `alt` text, so the lightbox falls back to "Screenshot". Descriptive alts should be added.
