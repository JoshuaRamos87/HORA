# HORA — Minimalist Hourly Fine Art Gallery

A quiet, zero-build static web app that displays a full-screen museum artwork each hour from the **Art Institute of Chicago** and **The Metropolitan Museum of Art**.

## Features

- **Full-screen minimalist canvas** — uncropped artwork over a subtle color-matched ambient blur backdrop (with toggles for **Ambient**, **Fill**, and **Matte**, plus browser Fullscreen).
- **On-the-hour (`:00`) rotation** — smoothly swaps to a new piece at the top of every local clock hour and wakes cleanly after sleep/background tabs.
- **Translucent bottom up-arrow → Museum Placard drawer** — reveals title, artist, era/period, movement, origin/culture, medium, dimensions, gallery status, and short art history (Art Institute of Chicago curatorial essays, plus automatic Wikipedia/Wikidata summaries for Met works when linked).
- **Translucent top-left hamburger menu**:
  - **5 Skips Per Hour** — lets you skip up to 5 times per clock hour with visual progress pips, a 2-second burst guard, and a live countdown until `:00`.
  - **Display Framing & Theme** — switch between **Ambient**, **Fill**, and **Matte** framing, and choose **System** (default, follows OS appearance live), **Light** (warm archival museum wall), or **Dark** (obsidian & brass) themes.
  - **Include / Exclude Filters + Instant Preview** — toggle either museum, any of 6 art types (*Paintings*, *Drawings & Prints*, *Photography*, *Sculpture*, *Decorative Arts & Textiles*, *Ancient & World Artifacts*), any of 14 **Art History Eras** neatly grouped under collapsible **Western & Modern**, **Japan** (*Classical & Feudal*, *Edo Period*, *Meiji & Modern*), and **China** (*Early Imperial*, *Song & Yuan*, *Ming & Qing*) sections with one-tap **Only** and **Enable All** controls, and **Prioritize Museum Highlights**, then tap **Apply & Refresh Artwork** to preview matching art immediately without spending a skip.
  - **Rate-Limit Friendly Caching** — caches session pools per category, batch-fetches up to 10 Art Institute of Chicago artworks per request via `?ids=`, and automatically routes around HTTP `429` responses.
  - **About & Keyboard Shortcuts** — museum attributions and quick navigation (`↑`/`I` details, `M` menu, `F` framing, `Esc` close).

- **Zoom & Inspection** — Instagram-style two-finger pinch-to-zoom (up to `4×`) on mobile that springs cleanly back to `100%` on release without zooming the page, plus a translucent bottom-right desktop zoom bar (`100%–400%`) with slider, drag-to-pan, double-click zoom, trackpad pinch, and `+`/`-`/`0` shortcuts.
- **Installable Phone App (PWA)** — full-screen standalone mode on iOS and Android, custom home-screen icons, notch/safe-area support, and offline shell + current-artwork caching via `sw.js`.

## Installing on Your Phone (PWA)

- **Android (Chrome / Edge):** Open the live site, tap the browser’s **Install app** prompt (or open HORA’s menu → **Gallery → Install App**).
- **iPhone / iPad (Safari):** Open the live site in Safari, tap **Share** (`↑`), and choose **Add to Home Screen**.

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
