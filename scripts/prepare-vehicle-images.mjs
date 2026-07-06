import fs from "fs";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "public", "data");
const JOINED_CSV = path.join(DATA_DIR, "latest-joined.csv");
const OUT_PATH = path.join(DATA_DIR, "vehicle-images.json");
const WIKI_BASE = "https://wiki.warthunder.com";
const GROUND_URL = `${WIKI_BASE}/ground`;
const DISABLE_FETCH = process.env.WT_DISABLE_IMAGE_FETCH === "1";

function getText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent": "wt-data-project.web image manifest prep (+https://github.com/zeoce/wt-data-project.web)"
          }
        },
        response => {
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
        }
      )
      .on("error", reject);
  });
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

function buildSearchIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    const keys = [row.name, row.wk_name, row.alt_name, displayName(row)].map(normalize).filter(Boolean);
    for (const key of keys) {
      if (!index.has(key)) index.set(key, row.name);
    }
  }
  return index;
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
      cdn: "https://static.encyclopedia.warthunder.com",
      note: "Best-effort manifest built from official War Thunder Wiki unit ids and CDN slot thumbnails. Images are referenced remotely, not mirrored into this repository."
    },
    images: {},
    misses: [],
    stats: {
      totalGroundVehicles: rows.length,
      matched: 0,
      fallbacks: 0
    }
  };

  if (DISABLE_FETCH) {
    manifest.source.note += " Fetching was disabled with WT_DISABLE_IMAGE_FETCH=1.";
    manifest.misses = rows.map(row => ({
      id: row.name,
      name: displayName(row),
      reason: "image fetching disabled"
    }));
    manifest.stats.fallbacks = rows.length;
    fs.writeFileSync(OUT_PATH, JSON.stringify(manifest, null, 2));
    console.log(`Vehicle image fetch disabled. Wrote empty manifest to ${path.relative(ROOT, OUT_PATH)}.`);
    return;
  }

  const groundHtml = await getText(GROUND_URL);
  const wikiImages = parseGroundImages(groundHtml);
  const searchIndex = buildSearchIndex(rows);

  for (const row of rows) {
    const unitCandidates = [row.name, row.wk_name].filter(Boolean);
    let matchId = unitCandidates.find(candidate => wikiImages.has(candidate));
    let matchedBy = matchId ? "exact unit id" : "";
    let confidence = "high";

    if (!matchId) {
      const normalizedKeys = unitCandidates.concat([row.alt_name, displayName(row)]).map(normalize).filter(Boolean);
      for (const [unitId] of wikiImages) {
        if (normalizedKeys.includes(normalize(unitId))) {
          matchId = unitId;
          matchedBy = "normalized unit id";
          confidence = "medium";
          break;
        }
      }
    }

    if (!matchId) {
      const nameKey = [row.alt_name, displayName(row), row.wk_name].map(normalize).find(key => searchIndex.get(key) === row.name);
      if (nameKey && wikiImages.has(row.name)) {
        matchId = row.name;
        matchedBy = "normalized joined name";
        confidence = "medium";
      }
    }

    if (matchId) {
      const imageUrl = wikiImages.get(matchId);
      manifest.images[row.name] = {
        imageUrl,
        sourcePage: `${WIKI_BASE}/unit/${encodeURIComponent(matchId)}`,
        sourceFileTitle: sourceFileTitle(imageUrl),
        sourceUrl: imageUrl,
        attribution: "War Thunder Wiki / Gaijin Games Kft. official wiki CDN thumbnail. Referenced remotely; not redistributed in this repository.",
        matchedBy,
        confidence
      };
    } else {
      manifest.misses.push({
        id: row.name,
        name: displayName(row),
        reason: "no matching official wiki slot thumbnail found"
      });
    }
  }

  manifest.stats.matched = Object.keys(manifest.images).length;
  manifest.stats.fallbacks = manifest.misses.length;
  fs.writeFileSync(OUT_PATH, JSON.stringify(manifest, null, 2));
  console.log(`Vehicle images matched: ${manifest.stats.matched}`);
  console.log(`Vehicle image fallbacks: ${manifest.stats.fallbacks}`);
  console.log(`Wrote ${path.relative(ROOT, OUT_PATH)}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
