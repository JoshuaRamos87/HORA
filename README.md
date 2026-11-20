# HORA — Minimalist Hourly Fine Art Gallery

A quiet, zero-build static web app that displays a full-screen museum artwork each hour from the **Art Institute of Chicago** and **The Metropolitan Museum of Art**.

## Features

- **Full-screen minimalist canvas** — uncropped artwork over a subtle color-matched ambient blur backdrop (with toggles for **Ambient**, **Fill**, and **Matte**, plus browser Fullscreen).
- **On-the-hour (`:00`) rotation** — smoothly swaps to a new piece at the top of every local clock hour and wakes cleanly after sleep/background tabs.
- **Translucent bottom up-arrow → Museum Placard drawer** — reveals title, artist, era/period, movement, origin/culture, medium, dimensions, gallery status, and short art history (Art Institute of Chicago curatorial essays, plus automatic Wikipedia/Wikidata summaries for Met works when linked).
- **Translucent top-left hamburger menu**:
  - **1 Skip Per Hour** — lets you skip once per clock hour, displaying a live countdown until `:00` once used.
  - **Include / Exclude Filters** — toggle either museum, include/exclude any of 6 art types (*Paintings*, *Drawings & Prints*, *Photography*, *Sculpture*, *Decorative Arts & Textiles*, *Ancient & World Artifacts*), and toggle **Prioritize Museum Highlights**.
  - **About & Keyboard Shortcuts** — museum attributions and quick navigation (`↑`/`I` details, `M` menu, `F` framing, `Esc` close).

## Running Locally

Because HORA uses native ES modules, serve the directory with any static HTTP server:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Deploying to GitHub Pages

1. Push this repository to GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, select **Deploy from a branch**, pick your default branch and `/ (root)`, and save.

## Tests

```bash
node --test tests/core.test.mjs
```

## Data Sources

- **Art Institute of Chicago API** (`https://api.artic.edu/api/v1`) — collection metadata CC0; curatorial descriptions CC BY 4.0.
- **The Metropolitan Museum of Art Collection API** (`https://collectionapi.metmuseum.org/public/collection/v1.1/search` & `/v1/objects/{id}`) — Open Access CC0.
- **Wikidata / Wikipedia REST API** — optional short historical context for Met artworks.
