const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const { getText, metadataUrl, normalizeMetadata, upstreamCommit } = require("./upstream-data");
const DATA_DIR = path.resolve(__dirname, "..", "public", "data");

function parseCsvLine(line) {
  const out = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
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
  if (quoted) throw new Error("Unterminated quoted field in joined CSV");
  out.push(current);
  return out;
}

function parseCsv(csv) {
  const lines = csv.trim().split(/\r?\n/);
  const headers = parseCsvLine(lines.shift() || "");
  const required = ["name", "nation", "cls", "rb_br", "rb_battles", "rb_win_rate",
    "rb_ground_frags_per_battle", "rb_ground_frags_per_death"];
  if (new Set(headers).size !== headers.length || required.some(header => !headers.includes(header))) {
    throw new Error("Joined CSV is missing required columns or has duplicate headers");
  }
  if (lines.length < 500) throw new Error("Joined CSV contains fewer than 500 vehicle rows");
  return lines.map(line => {
    const values = parseCsvLine(line);
    if (values.length !== headers.length) throw new Error("Joined CSV row has the wrong number of columns");
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });
    return row;
  });
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9а-яё]/gi, "");
}

function rowKeys(row) {
  return [row.name, row.wk_name, row.alt_name].map(normalize).filter(Boolean);
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function snapshotMetrics(row) {
  if (!row) return null;
  return {
    battles: numeric(row.rb_battles),
    winRate: numeric(row.rb_win_rate),
    fragsPerBattle: numeric(row.rb_ground_frags_per_battle),
    fragsPerDeath: numeric(row.rb_ground_frags_per_death),
    br: numeric(row.rb_br)
  };
}

function nearestSnapshot(joined, latestDate, daysAgo) {
  const target = new Date(`${latestDate}T00:00:00Z`).getTime() - daysAgo * 86400000;
  return joined
    .filter(entry => new Date(`${entry.date}T00:00:00Z`).getTime() <= target)
    .sort((a, b) => Math.abs(new Date(`${a.date}T00:00:00Z`).getTime() - target) - Math.abs(new Date(`${b.date}T00:00:00Z`).getTime() - target))[0] || joined[0];
}

function indexRows(rows) {
  const index = new Map();
  rows.forEach(row => rowKeys(row).forEach(key => {
    if (!index.has(key)) index.set(key, row);
  }));
  return index;
}

function findHistorical(index, row) {
  for (const key of rowKeys(row)) {
    if (index.has(key)) return index.get(key);
  }
  return null;
}

function roundDelta(current, previous) {
  if (current === null || previous === null || current === undefined || previous === undefined) return null;
  return Math.round((current - previous) * 100) / 100;
}

async function main() {
  const commit = await upstreamCommit();
  const resolvedMetadataUrl = metadataUrl(commit);
  const metadataText = await getText(resolvedMetadataUrl);
  const metadata = normalizeMetadata(JSON.parse(metadataText), commit);
  const joined = metadata.filter(entry => entry.type === "joined").sort((a, b) => a.date.localeCompare(b.date));
  if (joined.length === 0) {
    throw new Error("metadata.json did not include joined data entries");
  }

  const latestJoined = joined[joined.length - 1];
  const snapshots = new Map();
  const downloadSnapshot = async entry => {
    const csv = await getText(entry.path);
    const rows = parseCsv(csv);
    if (!rows.some(row => row.cls === "Ground_vehicles")) throw new Error(`No ground vehicles in ${entry.path}`);
    snapshots.set(entry.date, { date: entry.date, url: entry.path,
      sha256: createHash("sha256").update(csv).digest("hex"), rows: rows.length });
    return { csv, rows };
  };
  const { csv: latestJoinedCsv, rows: latestRows } = await downloadSnapshot(latestJoined);
  const trendEntries = {
    d1: nearestSnapshot(joined, latestJoined.date, 1),
    d7: nearestSnapshot(joined, latestJoined.date, 7),
    d30: nearestSnapshot(joined, latestJoined.date, 30)
  };
  const uniqueTrendEntries = Array.from(new Map(Object.values(trendEntries).map(entry => [entry.date, entry])).values());
  const historicalRows = new Map();
  await Promise.all(uniqueTrendEntries.map(async entry => {
    historicalRows.set(entry.date, (await downloadSnapshot(entry)).rows);
  }));
  const historicalIndexes = new Map(Array.from(historicalRows.entries()).map(([date, rows]) => [date, indexRows(rows)]));
  const trendManifest = {
    generatedAt: new Date().toISOString(),
    latestDate: latestJoined.date,
    dates: Object.fromEntries(Object.entries(trendEntries).map(([label, entry]) => [label, entry.date])),
    vehicles: {},
    changes: []
  };
  latestRows.filter(row => row.cls === "Ground_vehicles").forEach(row => {
    const latest = snapshotMetrics(row);
    const history = {};
    Object.entries(trendEntries).forEach(([label, entry]) => {
      history[label] = snapshotMetrics(findHistorical(historicalIndexes.get(entry.date), row));
    });
    const d7 = history.d7;
    const d30 = history.d30;
    const trend = {
      name: row.alt_name || row.wk_name || row.name,
      nation: row.nation,
      latest,
      history,
      delta7: {
        winRate: roundDelta(latest.winRate, d7 && d7.winRate),
        battles: roundDelta(latest.battles, d7 && d7.battles),
        fragsPerBattle: roundDelta(latest.fragsPerBattle, d7 && d7.fragsPerBattle),
        fragsPerDeath: roundDelta(latest.fragsPerDeath, d7 && d7.fragsPerDeath),
        br: roundDelta(latest.br, d7 && d7.br)
      },
      delta30: {
        winRate: roundDelta(latest.winRate, d30 && d30.winRate),
        battles: roundDelta(latest.battles, d30 && d30.battles),
        fragsPerBattle: roundDelta(latest.fragsPerBattle, d30 && d30.fragsPerBattle),
        fragsPerDeath: roundDelta(latest.fragsPerDeath, d30 && d30.fragsPerDeath),
        br: roundDelta(latest.br, d30 && d30.br)
      },
      isNew: !d7
    };
    trendManifest.vehicles[row.name] = trend;
    trendManifest.changes.push({ id: row.name, ...trend });
  });
  trendManifest.changes = trendManifest.changes
    .sort((a, b) => {
      if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
      return Math.abs((b.delta7 && b.delta7.winRate) || 0) - Math.abs((a.delta7 && a.delta7.winRate) || 0);
    })
    .slice(0, 30);
  const sourceInfo = {
    generatedAt: new Date().toISOString(),
    upstreamMetadataUrl: resolvedMetadataUrl,
    upstreamCommit: commit,
    upstreamMetadataSha256: createHash("sha256").update(metadataText).digest("hex"),
    snapshots: [...snapshots.values()].sort((a, b) => a.date.localeCompare(b.date)),
    upstreamWebRepo: "https://github.com/ControlNet/wt-data-project.web",
    upstreamDataRepo: "https://github.com/ControlNet/wt-data-project.data",
    forkRepo: "https://github.com/zeoce/wt-data-project.web",
    latestJoined,
    trendDates: trendManifest.dates
  };

  // Do not replace existing outputs until every input has downloaded and validated.
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, "metadata.json"), JSON.stringify(metadata, null, 2));
  fs.writeFileSync(path.join(DATA_DIR, "latest-joined.csv"), latestJoinedCsv);
  fs.writeFileSync(path.join(DATA_DIR, "latest-joined.json"), JSON.stringify(latestRows));
  fs.writeFileSync(path.join(DATA_DIR, "vehicle-trends.json"), JSON.stringify(trendManifest));
  fs.writeFileSync(path.join(DATA_DIR, "source-info.json"), JSON.stringify(sourceInfo, null, 2));

  console.log(`Prepared ${joined.length} metadata entries.`);
  console.log(`Upstream commit: ${commit}`);
  console.log(`Latest joined data: ${latestJoined.date} -> public/data/latest-joined.csv`);
  console.log(`Prepared compact JSON and vehicle trends for ${Object.values(trendManifest.dates).join(", ")}.`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { main, parseCsv };
