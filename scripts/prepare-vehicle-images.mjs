import fs from "fs";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "public", "data");
const JOINED_CSV = path.join(DATA_DIR, "latest-joined.csv");
const OUT_PATH = path.join(DATA_DIR, "vehicle-images.json");
const OVERRIDES_PATH = path.join(__dirname, "vehicle-image-overrides.json");
const WIKI_BASE = "https://wiki.warthunder.com";
const GROUND_URL = `${WIKI_BASE}/ground`;
const MEDIAWIKI_API = `${WIKI_BASE}/api.php`;
const DISABLE_FETCH = process.env.WT_DISABLE_IMAGE_FETCH === "1";
const CONCURRENCY = Number(process.env.WT_IMAGE_FETCH_CONCURRENCY || 8);

function getText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, requestOptions(url), response => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          getText(new URL(response.headers.location, url).toString()).then(resolve, reject);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`GET ${url} returned ${response.statusCode}`));
          response.resume();
          return;
        }
        let body = "";
        response.setEncoding("utf8");
        response.on("data", chunk => {
          body += chunk;
        });
        response.on("end", () => resolve(body));
      })
      .on("error", reject);
  });
}

function requestOptions(url) {
  return {
    headers: {
      "User-Agent": "wt-data-project.web image manifest prep (+https://github.com/zeoce/wt-data-project.web)",
      Accept: url.includes("api.php") ? "application/json" : "text/html,application/xhtml+xml"
    }
  };
}

async function getJson(url) {
  return JSON.parse(await getText(url));
}

async function existsOk(url) {
  try {
    await getText(url);
    return true;
  } catch {
    return false;
  }
}

function parseCsv(csv) {
  const lines = csv.trim().split(/\r?\n/);
  const headers = parseCsvLine(lines.shift() || "");
  return lines.map(line => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });
    return row;
  });
}

function parseCsvLine(line) {
  const out = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === "\"") {
      if (quoted && line[i + 1] === "\"") {
        current += "\"";
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9а-яё]/gi, "");
}

function displayName(row) {
  return (row.alt_name || row.wk_name || row.name || "").replace(/_/g, " ");
}

function sourceFileTitle(url) {
  try {
    return path.basename(new URL(url).pathname);
  } catch {
    return "";
  }
}

function parseGroundImages(html) {
  const byUnit = new Map();
  const unitPattern = /data-unit-id="([^"]+)"[\s\S]{0,2000}?background-image:url\(&#039;([^&]+)&#039;\)/g;
  let match;
  while ((match = unitPattern.exec(html)) !== null) {
    const unitId = decodeHtml(match[1]);
    const imageUrl = decodeHtml(match[2]);
    if (!byUnit.has(unitId) && imageUrl.includes("static.encyclopedia.warthunder.com/slots/")) {
      byUnit.set(unitId, imageUrl);
    }
  }
  return byUnit;
}

function slotEntry(row, imageUrl, matchedBy) {
  return {
    imageUrl,
    fallbackImageUrl: imageUrl,
    sourcePage: `${WIKI_BASE}/unit/${encodeURIComponent(row.name)}`,
    sourceFileTitle: sourceFileTitle(imageUrl),
    sourceUrl: imageUrl,
    sourceKind: "wiki-slot-thumbnail",
    fallbackSource: "wiki-slot-thumbnail",
    imageWidth: 160,
    imageHeight: 96,
    confidence: "medium",
    score: 40,
    matchedBy,
    attribution: "War Thunder Wiki / Gaijin Games Kft. official wiki CDN thumbnail. Referenced remotely; not redistributed in this repository.",
    matchNotes: ["fallback slot thumbnail from official Ground Vehicles page"]
  };
}

function candidateScore(row, candidate) {
  const notes = [];
  const file = normalize(candidate.sourceFileTitle);
  const vehicleKeys = [row.name, row.wk_name, row.alt_name, displayName(row)].map(normalize).filter(Boolean);
  const width = Number(candidate.imageWidth || 0);
  const height = Number(candidate.imageHeight || 0);
  const ratio = width && height ? width / height : 0;
  let score = 0;

  if (width >= 500) {
    score += 25;
    notes.push("width >= 500");
  }
  if (height >= 250) {
    score += 20;
    notes.push("height >= 250");
  }
  if (ratio >= 1.2 && ratio <= 2.2) {
    score += 20;
    notes.push("card-friendly aspect ratio");
  }
  if (vehicleKeys.some(key => key && file.includes(key))) {
    score += 20;
    notes.push("filename matches vehicle id/name");
  }
  if (/(garage|main|image|vehicle|render|preview|card|gunit|social)/i.test(candidate.sourceFileTitle)) {
    score += 15;
    notes.push("filename/source suggests vehicle render");
  }
  if (width < 300 || height < 180) {
    score -= 45;
    notes.push("small image penalty");
  }
  if (ratio > 0 && ratio < 1.05) {
    score -= 20;
    notes.push("square/icon-like penalty");
  }
  if (/(icon|flag|roundel|decal|tech[-_ ]?tree|techtree|slot|map|ammo|shell|gun|crew|medal)/i.test(candidate.sourceFileTitle)) {
    score -= 55;
    notes.push("rejected icon/support-art filename terms");
  }
  if (/(\.svg|\.gif)$/i.test(candidate.sourceFileTitle) || !/^image\/(jpeg|jpg|png|webp)$/i.test(candidate.mime || "image/jpeg")) {
    score -= 80;
    notes.push("non-raster or unsupported mime penalty");
  }

  return { score, notes };
}

function htmlMeta(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<meta name="${escaped}" content="([^"]+)"`, "i"));
  return match ? decodeHtml(match[1]) : "";
}

function vehiclePageCandidate(row, html) {
  const imageUrl = htmlMeta(html, "og:image") || htmlMeta(html, "twitter:image");
  if (!imageUrl || /default_og_image/i.test(imageUrl)) return null;
  const width = Number(htmlMeta(html, "og:image:width") || 0);
  const height = Number(htmlMeta(html, "og:image:height") || 0);
  const candidate = {
    imageUrl,
    sourcePage: `${WIKI_BASE}/unit/${encodeURIComponent(row.name)}`,
    sourceFileTitle: sourceFileTitle(imageUrl),
    sourceUrl: imageUrl,
    sourceKind: "vehicle-page-image",
    imageWidth: width,
    imageHeight: height,
    mime: /\.png$/i.test(imageUrl) ? "image/png" : "image/jpeg"
  };
  const scored = candidateScore(row, candidate);
  return {
    ...candidate,
    score: scored.score,
    matchNotes: ["official vehicle page OpenGraph image", ...scored.notes],
    confidence: scored.score >= 65 ? "high" : scored.score >= 45 ? "medium" : "low",
    attribution: "War Thunder Wiki / Gaijin Games Kft. vehicle page image. Referenced remotely; not redistributed in this repository."
  };
}

async function mediaWikiCandidate(row) {
  const titles = [row.wk_name, row.alt_name, displayName(row), row.name].filter(Boolean);
  for (const title of titles) {
    const imageListUrl = `${MEDIAWIKI_API}?action=query&format=json&prop=images&titles=${encodeURIComponent(title)}`;
    const imageList = await getJson(imageListUrl);
    const pages = imageList.query && imageList.query.pages ? Object.values(imageList.query.pages) : [];
    const fileTitles = pages.flatMap(page => page.images || []).map(image => image.title).filter(Boolean);
    if (fileTitles.length === 0) continue;

    const imageInfoUrl = `${MEDIAWIKI_API}?action=query&format=json&prop=imageinfo&iiprop=url|size|mime|mediatype|extmetadata&iiurlwidth=800&titles=${encodeURIComponent(fileTitles.slice(0, 25).join("|"))}`;
    const info = await getJson(imageInfoUrl);
    const infoPages = info.query && info.query.pages ? Object.values(info.query.pages) : [];
    const candidates = infoPages
      .map(page => {
        const imageInfo = page.imageinfo && page.imageinfo[0];
        if (!imageInfo) return null;
        const imageUrl = imageInfo.thumburl || imageInfo.url;
        const candidate = {
          imageUrl,
          sourcePage: `${WIKI_BASE}/unit/${encodeURIComponent(row.name)}`,
          sourceFileTitle: page.title || sourceFileTitle(imageUrl),
          sourceUrl: imageInfo.descriptionurl || imageInfo.url,
          sourceKind: "vehicle-page-image",
          imageWidth: imageInfo.thumbwidth || imageInfo.width || 0,
          imageHeight: imageInfo.thumbheight || imageInfo.height || 0,
          mime: imageInfo.mime || ""
        };
        const scored = candidateScore(row, candidate);
        return {
          ...candidate,
          score: scored.score,
          confidence: scored.score >= 65 ? "high" : scored.score >= 45 ? "medium" : "low",
          attribution: "War Thunder Wiki file metadata via MediaWiki API. Referenced remotely; not redistributed in this repository.",
          matchNotes: [`MediaWiki prop=images match for ${title}`, ...scored.notes]
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    if (candidates.length > 0) return candidates[0];
  }
  return null;
}

function mergePrimary(fallback, primary) {
  if (!primary || primary.confidence === "low") return fallback;
  return {
    ...fallback,
    ...primary,
    fallbackImageUrl: fallback ? fallback.fallbackImageUrl || fallback.imageUrl : "",
    fallbackSource: "wiki-slot-thumbnail",
    matchedBy: "vehicle page image"
  };
}

function loadOverrides() {
  if (!fs.existsSync(OVERRIDES_PATH)) return {};
  return JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf8"));
}

function overrideTargetId(key, rows) {
  const normalizedKey = normalize(key);
  const exact = rows.find(row => [row.name, row.wk_name, row.alt_name, displayName(row)].map(normalize).includes(normalizedKey));
  if (exact) return exact.name;
  const suffix = rows.find(row => normalize(row.name).endsWith(normalizedKey) || normalize(row.wk_name).endsWith(normalizedKey));
  return suffix ? suffix.name : key;
}

function applyOverrides(manifest, overrides, rows) {
  for (const [key, override] of Object.entries(overrides)) {
    const id = overrideTargetId(key, rows);
    const previous = manifest.images[id] || {};
    manifest.images[id] = {
      ...previous,
      ...override,
      imageUrl: override.imageUrl || previous.imageUrl,
      fallbackImageUrl: override.fallbackImageUrl || previous.fallbackImageUrl || previous.imageUrl || "",
      sourceKind: override.sourceKind || "vehicle-page-image",
      fallbackSource: previous.fallbackSource || "wiki-slot-thumbnail",
      confidence: override.confidence || "high",
      score: override.score || 100,
      matchNotes: (previous.matchNotes || []).concat(`manual override: ${override.notes || "no notes"}`)
    };
  }
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, limit) }, worker));
  return results;
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(JOINED_CSV)) {
    throw new Error("public/data/latest-joined.csv is missing. Run npm run prepare:data first.");
  }

  const rows = parseCsv(fs.readFileSync(JOINED_CSV, "utf8")).filter(row => row.cls === "Ground_vehicles");
  const manifest = {
    generatedAt: new Date().toISOString(),
    source: {
      name: "War Thunder Wiki",
      groundPage: GROUND_URL,
      mediaWikiApi: MEDIAWIKI_API,
      cdn: "https://static.encyclopedia.warthunder.com",
      note: "Best-effort manifest. Primary images prefer official vehicle-page images; official Ground Vehicles slot thumbnails remain fallbacks. Images are referenced remotely, not mirrored into this repository."
    },
    images: {},
    misses: [],
    stats: {
      totalGroundVehicles: rows.length,
      matched: 0,
      vehiclePageImages: 0,
      slotThumbnails: 0,
      placeholders: 0
    }
  };

  if (DISABLE_FETCH) {
    manifest.source.note += " Fetching was disabled with WT_DISABLE_IMAGE_FETCH=1.";
    manifest.misses = rows.map(row => ({
      id: row.name,
      name: displayName(row),
      reason: "image fetching disabled"
    }));
    manifest.stats.placeholders = rows.length;
    fs.writeFileSync(OUT_PATH, JSON.stringify(manifest, null, 2));
    console.log(`Vehicle image fetch disabled. Wrote placeholder-only manifest to ${path.relative(ROOT, OUT_PATH)}.`);
    return;
  }

  const groundHtml = await getText(GROUND_URL);
  const wikiSlots = parseGroundImages(groundHtml);
  const mediaWikiAvailable = await existsOk(`${MEDIAWIKI_API}?action=query&format=json&meta=siteinfo`);
  if (!mediaWikiAvailable) {
    manifest.source.note += " The current public wiki did not expose a working MediaWiki api.php endpoint during generation, so vehicle-page OpenGraph images were used for the primary lookup stage.";
  }

  for (const row of rows) {
    const slotUrl = wikiSlots.get(row.name) || wikiSlots.get(row.wk_name);
    if (slotUrl) {
      manifest.images[row.name] = slotEntry(row, slotUrl, "exact unit id");
    } else {
      manifest.images[row.name] = {
        imageUrl: "",
        fallbackImageUrl: "",
        sourcePage: `${WIKI_BASE}/unit/${encodeURIComponent(row.name)}`,
        sourceFileTitle: "",
        sourceUrl: "",
        sourceKind: "placeholder",
        fallbackSource: "wiki-slot-thumbnail",
        imageWidth: 0,
        imageHeight: 0,
        confidence: "low",
        score: 0,
        matchedBy: "placeholder",
        attribution: "",
        matchNotes: ["no slot thumbnail found"]
      };
    }
  }

  await mapLimit(rows, CONCURRENCY, async (row, index) => {
    try {
      let primary = null;
      if (mediaWikiAvailable) {
        primary = await mediaWikiCandidate(row);
      }
      if (!primary) {
        const html = await getText(`${WIKI_BASE}/unit/${encodeURIComponent(row.name)}`);
        primary = vehiclePageCandidate(row, html);
      }
      manifest.images[row.name] = mergePrimary(manifest.images[row.name], primary);
    } catch (error) {
      manifest.images[row.name].matchNotes.push(`primary lookup failed: ${error.message}`);
    }
    if ((index + 1) % 100 === 0) {
      console.log(`Checked vehicle page images: ${index + 1}/${rows.length}`);
    }
  });

  applyOverrides(manifest, loadOverrides(), rows);

  const entries = Object.values(manifest.images);
  manifest.stats.vehiclePageImages = entries.filter(entry => entry.sourceKind === "vehicle-page-image").length;
  manifest.stats.slotThumbnails = entries.filter(entry => entry.sourceKind === "wiki-slot-thumbnail").length;
  manifest.stats.placeholders = entries.filter(entry => entry.sourceKind === "placeholder").length;
  manifest.stats.matched = entries.filter(entry => entry.sourceKind !== "placeholder").length;
  manifest.misses = rows
    .filter(row => manifest.images[row.name].sourceKind === "placeholder")
    .map(row => ({ id: row.name, name: displayName(row), reason: "no page image or slot thumbnail found" }));

  fs.writeFileSync(OUT_PATH, JSON.stringify(manifest, null, 2));
  console.log(`Vehicle page images: ${manifest.stats.vehiclePageImages}`);
  console.log(`Slot thumbnail fallbacks: ${manifest.stats.slotThumbnails}`);
  console.log(`Placeholders: ${manifest.stats.placeholders}`);
  console.log(`Wrote ${path.relative(ROOT, OUT_PATH)}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
