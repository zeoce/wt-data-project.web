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

The build command runs `prepare:data` first, then webpack in production mode, and emits the static app into `dist/`. The checked-in `wasm-utils/pkg/wasm_utils.js` package provides the data filtering helper, so Cloudflare Pages does not need a Rust toolchain. If a generated `.wasm` file is added to `wasm-utils/pkg/` later, webpack will copy it into the Pages artifact. The `wrangler.toml` file sets `pages_build_output_dir = "dist"` so Wrangler and Cloudflare Pages use the same output directory.

Cloudflare Pages should deploy the generated `dist/` directory. Do not use the legacy `web` branch force-push workflow from the upstream project.

### Local Build And Data Preparation

```sh
npm ci
npm run prepare:data
npm run build:production
npm run check:dist
```

`prepare:data` downloads upstream metadata from `ControlNet/wt-data-project.data`, writes `public/data/metadata.json`, and writes the latest joined CSV to `public/data/latest-joined.csv`. Webpack copies these files into `dist/data/`, so the deployed app can load `/data/metadata.json` and show an in-app data status.

### Cloudflare Pages Troubleshooting

- Blank app shell: confirm `dist/index.html`, `dist/bundle.js`, `dist/index.css`, and `dist/config/params.json` are present and served with the expected content types.
- Missing data status or Ground RB panel error: confirm `dist/data/metadata.json`, `dist/data/latest-joined.csv`, and `dist/data/source-info.json` exist. Run `npm run prepare:data` before building.
- Custom domain issue: in Cloudflare DNS, `wt.mealspin.ca` should be a proxied `CNAME` to the Pages project domain, and the Pages project should list `wt.mealspin.ca` as an active custom domain.
- Stale blank page after a fix: hard refresh the browser or purge Cloudflare cache for `bundle.js`.
- Cloudflare build command: keep `npm run build:pages`; the npm `prebuild:pages` hook prepares data automatically.

### Data, Source, And License Transparency

This fork preserves upstream attribution and AGPL source availability:

- Upstream web repo: <https://github.com/ControlNet/wt-data-project.web>
- Upstream data repo: <https://github.com/ControlNet/wt-data-project.data>
- Fork/source repo: <https://github.com/zeoce/wt-data-project.web>

The app displays the prepared data date from `/data/metadata.json`. Thunderskill-derived data is sample-based, and joined data may contain imperfect vehicle matching, so low-sample rows should be treated as directional rather than definitive.

## Features

Mouse tooltip in heatmap.
![brheatmap-tooltip](https://github.com/ControlNet/wt-data-project.web/blob/main/img/brheatmap-tooltip.gif)

Click to check the data trends.
![brheatmap-click](https://github.com/ControlNet/wt-data-project.web/blob/main/img/brheatmap-click.gif)

View raw data.
![brheatmap-raws](https://github.com/ControlNet/wt-data-project.web/blob/main/img/brheatmap-raws.gif)

## Todo List
<div id="todo-list-section">
This repo is still in progress.

 - [x] Battle rating heatmap 
    - [x] Interactive trend graph
        - [x] Compatible for "battles" data
        - [x] Mouse tooltip
        - [ ] Adjustable date range
    - [x] Display table with selected data  
    - [x] Mouse tooltip
    - [ ] New measurement: average repair fees
    - [x] Improve color map
    - [ ] Use N/A to represent missing data rather than 0
 - [x] Trend graph
    - [ ] Mouse tooltip
 - [ ] Dark mode
 - [ ] Other animated graphs
</div>

## Acknowledge

- [kroeden](https://github.com/kroeden) for making logo.
- [Gaijin](https://warthunder.com/) for developing War Thunder.
- [thunderskill](http://thunderskill.com/en) for WT statistics data.
- [FlareFlo](https://github.com/FlareFlo) for providing vehicle name matching.
