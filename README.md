# iPurple.team · ATT&CK Navigator

A lightweight, black-and-purple, self-hosted take on the [MITRE ATT&CK®
Navigator](https://github.com/mitre-attack/attack-navigator), built for
**iPurple.team**. It renders the **Windows Enterprise** ATT&CK matrix as a
purple-team coverage heatmap with scoring, notes, search, and import/export —
all as static files with **no build step and no backend**, so it drops straight
onto **GitHub Pages**.

![tech: vanilla JS](https://img.shields.io/badge/stack-vanilla%20JS-8b5cf6) ![no build](https://img.shields.io/badge/build-none-6d28d9) ![ATT&CK](https://img.shields.io/badge/ATT%26CK-Windows%20Enterprise-a855f7)

---

## Features

- **Completion tracking** — set each technique/sub-technique to **Not started**,
  **Partial** (purple), or **Completed** (green); a top-level technique rolls up
  the % of its sub-techniques (partial counts as half). Items light up on a
  neutral dark canvas, with **progress bars** in each tactic header and overall
  in the status bar. Switch palette (**Red → Orange → Green** default, or
  **Purple**) in the legend bar; the partial color is set by `heatmap.partial`.
- **Add your own techniques** — create custom techniques (mapped to any tactics)
  or sub-techniques (under any parent) via the **+ Technique** button. They're
  marked with ★, fully scoreable/searchable, and travel with Export/Import.
- **Sub-techniques** — expand/collapse per technique or all at once.
- **Search** — by name, technique ID (`T1059`), or description; live highlight + dim.
- **Map iPurple articles** — attach one or more article links (title + URL) to
  any technique or sub-technique; cells show a link-count badge, the links open
  in a new tab, and they travel with Export/Import.
- **Notes** — per-technique notes for detection logic, data sources, playbook links.
- **Editable descriptions** — rewrite the description of any technique or
  sub-technique (full MITRE text is included); edits are flagged, reversible to
  the original, and travel with Export/Import.
- **Scope selection** — grey out techniques that are out of scope.
- **Layers** — export/import JSON layers (gradient + scores + comments); work
  also auto-saves to your browser's `localStorage`.
- **Fully themeable** — branding, colors, heatmap gradient, score presets, and
  menus all live in one editable file (`js/config.js`). No rebuild needed.

## Quick start (local)

Because the app fetches `data/attack-windows.json`, open it over HTTP (not
`file://`):

```bash
# from the project root
python -m http.server 8000
# then visit http://localhost:8000
```

(or `npx serve`, or any static server.)

## Deploy to GitHub Pages

1. Push this folder to a GitHub repo.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. The included workflow (`.github/workflows/deploy.yml`) builds & publishes on
   every push to `main`. The `.nojekyll` file ensures all assets are served.

> The workflow optionally re-runs `scripts/build-data.mjs` at deploy time so the
> published site tracks the latest MITRE data. Delete that step to ship the
> committed dataset as-is.

Prefer no Actions? Just commit `data/attack-windows.json` and point Pages at the
branch root — every file here is static.

## Customizing — edit `js/config.js`

| What | Where |
|------|-------|
| Name, tagline, logo text, footer | `brand` |
| Black/purple theme colors | `theme` (CSS variables) |
| Heatmap palettes (purple, red→green, …) | `heatmap.palettes` |
| Quick scoring buttons | `scorePresets` |
| Top-right menus (your own links/actions) | `menus` |

Menus accept either links — `{ label, href, external: true }` — or built-in
actions: `export`, `import`, `clear`, `selectAll`, `deselectAll`, `expandAll`,
`collapseAll`, `help`. Add your wikis, playbooks, or dashboards as links.

## Refreshing the ATT&CK data

The dataset is generated from MITRE's live STIX bundle and filtered to Windows:

```bash
node scripts/build-data.mjs           # fetch latest, build data/attack-windows.json
node scripts/build-data.mjs --local   # rebuild from ./raw/enterprise-attack.json
```

To target a different platform (e.g. Linux/macOS) or add domains, edit
`PLATFORM` / the filters near the top of `scripts/build-data.mjs`.

## Project layout

```
index.html                 app shell
css/styles.css             black & purple theme
js/config.js               ← YOUR editable config (branding, colors, menus)
js/app.js                  application logic (matrix, heatmap, search, layers)
data/attack-windows.json   generated Windows Enterprise dataset
scripts/build-data.mjs     dataset generator
.github/workflows/deploy.yml  GitHub Pages deploy
.nojekyll                  serve assets verbatim on Pages
```

## Attribution

This project is **not affiliated with or endorsed by MITRE**. ATT&CK® and
MITRE ATT&CK® are registered trademarks of The MITRE Corporation. Technique
data © The MITRE Corporation, used under the ATT&CK [Terms of
Use](https://attack.mitre.org/resources/terms-of-use/).
