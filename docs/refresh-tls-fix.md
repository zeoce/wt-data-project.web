# Data-refresh TLS fix

## Diagnosis

Investigated on October 19, 2026 UTC (October 18 in Vancouver), against web repository commit `0d77b47318e66ecfbf65e29ca0b359086c9258ba`.

Run [100](https://github.com/zeoce/wt-data-project.web/actions/runs/39143902365), job `117723724129`, failed on October 18 at 16:12:07 UTC with `ERR_TLS_CERT_ALTNAME_INVALID`. The log names `controlnet.space`; its presented certificate covered GitHub domains rather than that hostname. Checkout, Node setup, and dependency installation succeeded. The failure happened before image preparation, build validation, or the commit step.

The old script downloaded metadata successfully from:

`https://raw.githubusercontent.com/ControlNet/wt-data-project.data/master/metadata.json`

The hostname entered through the metadata's `path` fields, not the metadata request itself. The old `getText(latestJoined.path)` attempted the first URL below; historical downloads subsequently used `getText(entry.path)` with the same host. All 1,971 metadata entries inspected used this custom domain, including 778 joined datasets.

| Input | Selected date | Original URL |
| --- | --- | --- |
| Latest | 2026-10-17 | `https://controlnet.space/wt-data-project.data/joined/2026-10-17.csv` |
| 1-day comparison | 2026-10-14 | `https://controlnet.space/wt-data-project.data/joined/2026-10-14.csv` |
| 7-day comparison | 2026-10-08 | `https://controlnet.space/wt-data-project.data/joined/2026-10-08.csv` |
| 30-day comparison | 2026-09-17 | `https://controlnet.space/wt-data-project.data/joined/2026-09-17.csv` |

The comparisons use the nearest available snapshot on or before each target date. Their dates are not necessarily exactly 1, 7, or 30 days earlier.

The first dataset is present at the verified canonical repository URL:

`https://raw.githubusercontent.com/ControlNet/wt-data-project.data/8112b825e3e68c4863bab6ac02fcb7a3cbbb2d0b/joined/2026-10-17.csv`

The custom-domain URL also succeeded from the investigation environment when rechecked. The historical job log establishes the hostname mismatch at failure time; it does not establish whether the upstream DNS, GitHub Pages domain binding, or certificate provisioning has since been repaired. The upstream administrator's configuration was not available for inspection.

## Where the correction belongs

The certificate/domain configuration is an upstream hosting responsibility. Its owner should check the intended GitHub Pages custom-domain binding, authoritative DNS, and certificate provisioning for `controlnet.space`, or change the metadata generator to publish canonical GitHub raw URLs and regenerate existing metadata. Editing a generated metadata file alone is temporary if the next generation restores the old base URL. No upstream configuration changes or messages were sent as part of this investigation.

This repository can safely stop depending on that custom domain now. Its browser configuration already uses the same ControlNet repository's raw GitHub endpoint. The patch makes build-time data fetching use that source too. It does not substitute another publisher, a mirror, or older data.

## Patch behavior

1. Resolve `ControlNet/wt-data-project.data`'s `master` ref once per refresh. Validate the returned 40-character commit SHA.
2. Fetch metadata at that commit over HTTPS. Validate every dataset's type, real calendar date, uniqueness, and exact URL. Only the known legacy URL, canonical `master` URL, or same-commit URL is accepted, with the filename matching its type and date.
3. Normalize dataset URLs to `raw.githubusercontent.com/ControlNet/wt-data-project.data/<commit>/...`. Both the latest and historical downloads use them. Published metadata and source information contain the resolved URLs too.
4. Permit network requests only to the exact public GitHub ref endpoint and approved files at a commit in that repository. Reject all redirects. Retain Node's normal hostname checks and explicitly require certificate-chain verification with `rejectUnauthorized: true`. No custom certificate identity function, HTTP fallback, or retry that relaxes security is used.
5. Require HTTP 200 and complete responses; impose a 30-second deadline and 20 MiB limit. Validate required CSV columns, row widths, quote closure, minimum row count, and presence of ground vehicles.
6. Finish fetching and validating all inputs before writing outputs. A download/validation failure leaves the previous outputs untouched. This is not a transactional filesystem update: a disk error during the final writes can still leave partial local outputs, but the workflow stops and will not commit them.
7. Record the commit, pinned metadata URL, SHA-256 hashes, row counts, and snapshot URLs in `source-info.json`. The hashes are provenance records, not independent upstream signatures. Trust still rests on GitHub's authenticated HTTPS endpoint and the ControlNet repository.

Files changed: `scripts/prepare-data.js`, new `scripts/upstream-data.js`, new `tests/prepare-data.test.cjs`, `package.json`, `.github/workflows/refresh-data.yaml`, `README.md`, and this guide. No dependency or lockfile changes are required. The workflow runs the new regression suite before downloading data. Generated data is deliberately excluded from the patch and should be regenerated during validation.

The new public GitHub API lookup is unauthenticated. An API outage or rate-limit response fails the refresh visibly and preserves existing data; it does not fall back to another source. Unexpected future metadata formats likewise require review rather than silently broadening the allowed URLs.

## Apply and validate

Use a clean checkout and the repository's Node 20 runtime. From the repository root, with the downloaded patch's actual path:

```sh
git switch -c fix/tls-safe-upstream-data
git apply --check /path/to/wt-refresh-tls-fix.patch
git apply /path/to/wt-refresh-tls-fix.patch
npm ci
npm run test:data
npm run prepare:data
npm run prepare:images
npm run build:pages
npm run check:dist
git diff --check
git diff --stat
```

`build:pages` has a prebuild hook that reruns data and image preparation. The commands above intentionally exercise the existing workflow sequence, including that hook. Do not bypass certificate verification to make any step pass.

Inspect `public/data/source-info.json`: the latest date must match metadata, JSON rows, and the trend manifest; every recorded snapshot URL must reference its recorded upstream commit. Inspect generated data changes before committing. At investigation time, the expected latest date was October 17, with the three comparison dates listed above; a later upstream publication will legitimately advance these dates.

After the reviewed fix is merged, start a **new** `refresh upstream data` workflow run on `main` using **Run workflow**. Rerunning failed run 100 would use the old commit and would not test this patch. The workflow's final step pushes generated data to `main`, so do not run this write-enabled workflow on an unmerged test branch. Confirm that the new run checks out the fix commit and that refresh, image preparation, build validation, and data commit all succeed. Then check the deployed site's displayed data date. A local build alone does not prove that GitHub Actions or Cloudflare deployment has succeeded.

## Validation evidence

- Eight regression tests passed on Node 20 and Node 24, including strict URL mapping, invalid origins and paths, HTTP redirects, preserved TLS errors without retry, malformed CSVs, and a historical-download failure that leaves prior outputs byte-for-byte intact.
- Live preparation retrieved upstream commit `8112b825e3e68c4863bab6ac02fcb7a3cbbb2d0b` and all four selected CSVs using verified HTTPS.
- Latest snapshot: October 17, 2026; 2,558 rows; 461,152 bytes; SHA-256 `b11cf212cd6a2b118293503ff3a573895c4849283bc4025e36e8b2808f6d86a8`.
- Historical row counts: 2,557 (October 14), 2,557 (October 8), and 2,517 (September 17).
- GitHub repository blob identities and the recorded SHA-256 hashes were checked for all four CSV downloads. This confirms that the replacement endpoints returned the intended repository files.

- Live `prepare:images` succeeded: 1,224 ground vehicles, 1,219 primary vehicle images, 5 slot-thumbnail fallbacks, and no placeholders.
- `npm run build:pages` passed, including its repeated data/image prebuild hook. Webpack reported three asset-size/performance warnings and no errors. `npm run check:dist` passed. This full build ran on Node 24.19.0. The regression suite additionally passed on Node 20.20.2, the workflow's configured major version. A separate live Node 20 run was blocked by this workspace's DNS lookup failure (`EAI_AGAIN api.github.com`); it did not reach the download or modify data. A new Actions run after merging remains the final Node 20 end-to-end check.

No remote branch was created, no change was merged, and no write-enabled workflow or deployment was triggered.

## Primary evidence

- [Failed run 100](https://github.com/zeoce/wt-data-project.web/actions/runs/39143902365)
- [Original preparation script](https://github.com/zeoce/wt-data-project.web/blob/0d77b47318e66ecfbf65e29ca0b359086c9258ba/scripts/prepare-data.js)
- [Original refresh workflow](https://github.com/zeoce/wt-data-project.web/blob/0d77b47318e66ecfbf65e29ca0b359086c9258ba/.github/workflows/refresh-data.yaml)
- [Upstream metadata at the tested commit](https://github.com/ControlNet/wt-data-project.data/blob/8112b825e3e68c4863bab6ac02fcb7a3cbbb2d0b/metadata.json)
- [Latest CSV at the tested commit](https://github.com/ControlNet/wt-data-project.data/blob/8112b825e3e68c4863bab6ac02fcb7a3cbbb2d0b/joined/2026-10-17.csv)
- [Existing browser data-source configuration](https://github.com/zeoce/wt-data-project.web/blob/0d77b47318e66ecfbf65e29ca0b359086c9258ba/src/app/config.ts)
