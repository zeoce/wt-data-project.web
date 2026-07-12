# wt-data-project.web
A visualization web application for wt-data-project.

<div align="center">
   <img src="https://github.com/ControlNet/wt-data-project.web/raw/dev/img/logo400.png" alt="">
</div>

<table>
    <tr>
        <th>Repository</th>
        <th>Info</th>
    </tr>
    <tr>
        <td><a href="https://github.com/ControlNet/wt-data-project.data">wt-data-project.data</a></td>
        <td>
            <img src="https://img.shields.io/github/forks/ControlNet/wt-data-project.data?style=flat-square" alt="">
            <img src="https://img.shields.io/github/stars/ControlNet/wt-data-project.data?style=flat-square" alt="">
            <img src="https://img.shields.io/github/last-commit/ControlNet/wt-data-project.data/master?style=flat-square" alt="">
        </td>
    </tr>
    <tr>
        <td><a href="https://github.com/ControlNet/wt-data-project.web">wt-data-project.web</a></td>
        <td>
            <img src="https://img.shields.io/github/forks/ControlNet/wt-data-project.web?style=flat-square" alt="">
            <img src="https://img.shields.io/github/stars/ControlNet/wt-data-project.web?style=flat-square" alt="">
            <img src="https://img.shields.io/github/last-commit/ControlNet/wt-data-project.web?style=flat-square" alt="">
            <img src="https://img.shields.io/github/actions/workflow/status/ControlNet/wt-data-project.web/build.yaml?style=flat-square" alt="">
            <img src="https://img.shields.io/website?style=flat-square&up_message=online&url=https%3A%2F%2Fwt.mealspin.ca" alt="">
        </td>
    </tr>
    <tr>
        <td><a href="https://github.com/ControlNet/wt-data-project.visualization">wt-data-project.visualization</a></td>
        <td>
            <img src="https://img.shields.io/github/forks/ControlNet/wt-data-project.visualization?style=flat-square" alt="">
            <img src="https://img.shields.io/github/stars/ControlNet/wt-data-project.visualization?style=flat-square" alt="">
            <img src="https://img.shields.io/github/last-commit/ControlNet/wt-data-project.visualization/master?style=flat-square" alt="">
        </td>
    </tr>
</table>

## Webpage: [wt.mealspin.ca](https://wt.mealspin.ca)

## Cloudflare Pages

This fork is prepared for Cloudflare Pages deployment.

Recommended Pages settings:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Install command | `npm ci` |
| Build command | `npm run build:pages` |
| Build output directory | `dist` |
| Node.js version | `20` from `.node-version` |

The build command runs `prepare:data`, prepares the optional vehicle image manifest, then webpack in production mode, and emits the static app into `dist/`. The checked-in `wasm-utils/pkg/wasm_utils.js` package provides the data filtering helper, so Cloudflare Pages does not need a Rust toolchain. If a generated `.wasm` file is added to `wasm-utils/pkg/` later, webpack will copy it into the Pages artifact. The `wrangler.toml` file sets `pages_build_output_dir = "dist"` so Wrangler and Cloudflare Pages use the same output directory.

Cloudflare Pages should deploy the generated `dist/` directory. Do not use the legacy `web` branch force-push workflow from the upstream project.

### Local Build And Data Preparation

```sh
npm ci
npm run prepare:data
npm run prepare:images
npm run build:production
npm run check:dist
```

`prepare:data` downloads upstream metadata from `ControlNet/wt-data-project.data`, keeps the latest joined CSV for legacy compatibility, emits a Brotli-friendly `public/data/latest-joined.json` browser snapshot, and generates `public/data/vehicle-trends.json` from the nearest available 1-, 7-, and 30-day joined snapshots.

`prepare:images` builds `public/data/vehicle-images.json` from the official War Thunder Wiki. It first records slot thumbnails from the Ground Vehicles page as fallbacks, then checks each vehicle page for a higher-quality vehicle-page image. If a MediaWiki-compatible `api.php` endpoint is available, the script can score page-embedded image files from `prop=images` and `prop=imageinfo`; the current public wiki may not expose that endpoint, so the script also supports the official vehicle page OpenGraph image as the primary source. The manifest stores remote image URLs, fallback URLs, dimensions, source type, confidence, scores, and match notes; it does not download or redistribute image files.

Set `WT_DISABLE_IMAGE_FETCH=1` before running `prepare:images` if the wiki endpoint is down or you need an offline build. Missing or disabled image matches fall back to the local placeholder art in the card gallery.

Manual image corrections can be added to `scripts/vehicle-image-overrides.json` by stable vehicle id. Overrides are applied after automatic matching:

```json
{
  "us_xm_803": {
    "sourceFileTitle": "custom-source-note.jpg",
    "imageUrl": "https://example.com/attributed-image.jpg",
    "focalX": 42,
    "focalY": 50,
    "zoom": 1.18,
    "notes": "Better front/side render"
  }
}
```

`focalX` and `focalY` describe the vehicle subject's percentage position inside the source image. The card renderer shifts that point toward the center, while `zoom` controls the crop. Image URLs are optional when an override only corrects framing.

### Tests And Maintenance

```sh
npm run build:pages
npm run check:dist
npm run test:ui
npm run prune:css
```

`check:dist` validates all required static assets and cross-checks the latest metadata, source, image, and trend manifests. The Playwright suite covers startup, responsive cards, mobile navigation and spacing, workspace drawers, shareable filters, the sticky Vehicle column, and PWA assets. The service worker caches the shell for repeat visits and uses network-first caching for `/data/` so daily snapshots do not become silently stale.

### Scheduled Data Refresh

`.github/workflows/refresh-data.yaml` refreshes upstream data every day at `13:00 UTC`, which is 6am in Vancouver during daylight time. The workflow can also be run manually from GitHub Actions. It runs `prepare:data`, `prepare:images`, `build:pages`, and `check:dist`, then commits the regenerated `public/data/*` files directly to `main` only when upstream data has changed. A successful commit to `main` triggers Cloudflare Pages to rebuild and publish the refreshed dataset.

GitHub cron schedules are UTC-only, so the run time will be one hour different during standard time unless the cron is adjusted.

### Cloudflare Pages Troubleshooting

- Blank app shell: confirm `dist/index.html`, `dist/bundle.js`, `dist/index.css`, and `dist/config/params.json` are present and served with the expected content types.
- Missing data status or Ground RB panel error: confirm `dist/data/metadata.json`, `dist/data/latest-joined.csv`, and `dist/data/source-info.json` exist. Run `npm run prepare:data` before building.
- Missing vehicle card images: confirm `dist/data/vehicle-images.json` exists. Run `npm run prepare:images`, or set `WT_DISABLE_IMAGE_FETCH=1` to intentionally build with placeholders.
- Custom domain issue: in Cloudflare DNS, `wt.mealspin.ca` should be a proxied `CNAME` to the Pages project domain, and the Pages project should list `wt.mealspin.ca` as an active custom domain.
- Stale blank page after a fix: hard refresh the browser or purge Cloudflare cache for `bundle.js`.
- Cloudflare build command: keep `npm run build:pages`; the npm `prebuild:pages` hook prepares data automatically.

### Data, Source, And License Transparency

This fork preserves upstream attribution and AGPL source availability:

- Upstream web repo: <https://github.com/ControlNet/wt-data-project.web>
- Upstream data repo: <https://github.com/ControlNet/wt-data-project.data>
- Fork/source repo: <https://github.com/zeoce/wt-data-project.web>

The app displays the prepared data date from `/data/metadata.json`. Thunderskill-derived data is sample-based, and joined data may contain imperfect vehicle matching, so low-sample rows should be treated as directional rather than definitive.

The Ground RB card gallery uses `public/data/vehicle-images.json` for best-effort vehicle images from the official War Thunder Wiki. Vehicle-page images are preferred when they score as high or medium confidence, official wiki slot thumbnails are retained as fallbacks, and missing, disabled, or failed images fall back to generated placeholder panels. The current upstream `joined` and `wk` CSV snapshots still do not include rank fields or finer vehicle-type labels.

## Features

- Ground RB card and sortable table views with responsive filters and presets.
- Best-effort official wiki imagery with per-vehicle focal-point overrides and resilient fallbacks.
- Responsive workspace drawer for details, comparisons, confidence, and historical trends.
- Shareable URLs for filters, sort, view, selected vehicle, and up to four compared vehicles.
- Favourite-only browsing plus user-saved filter presets with JSON import/export.
- Ground RB lineup recommendations by nation, BR ceiling, sample floor, and performance.
- Daily change feed and compact 1-, 7-, and 30-day vehicle trend snapshots.
- Accessible battle-rating heatmap with sticky mobile BR labels and row focus.
- Dark mode by default, installable PWA shell, network-first data caching, and daily upstream refreshes.

## Acknowledge

- [kroeden](https://github.com/kroeden) for making logo.
- [Gaijin](https://warthunder.com/) for developing War Thunder.
- [thunderskill](http://thunderskill.com/en) for WT statistics data.
- [FlareFlo](https://github.com/FlareFlo) for providing vehicle name matching.
