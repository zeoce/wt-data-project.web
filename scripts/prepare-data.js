const fs = require("fs");
const path = require("path");
const https = require("https");

const METADATA_URL =
  "https://raw.githubusercontent.com/ControlNet/wt-data-project.data/master/metadata.json";
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
  out.push(current);
  return out;
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

function getText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, response => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          getText(response.headers.location).then(resolve, reject);
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

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const metadataText = await getText(METADATA_URL);
  const metadata = JSON.parse(metadataText);
  const joined = metadata.filter(entry => entry.type === "joined");
  if (joined.length === 0) {
    throw new Error("metadata.json did not include joined data entries");
  }

  const latestJoined = joined[joined.length - 1];
  const latestJoinedCsv = await getText(latestJoined.path);
  const latestRows = parseCsv(latestJoinedCsv);
  const trendEntries = {
    d1: nearestSnapshot(joined, latestJoined.date, 1),
    d7: nearestSnapshot(joined, latestJoined.date, 7),
    d30: nearestSnapshot(joined, latestJoined.date, 30)
  };
  const uniqueTrendEntries = Array.from(new Map(Object.values(trendEntries).map(entry => [entry.date, entry])).values());
  const historicalRows = new Map();
  await Promise.all(uniqueTrendEntries.map(async entry => {
    historicalRows.set(entry.date, parseCsv(await getText(entry.path)));
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
    upstreamMetadataUrl: METADATA_URL,
    upstreamWebRepo: "https://github.com/ControlNet/wt-data-project.web",
    upstreamDataRepo: "https://github.com/ControlNet/wt-data-project.data",
    forkRepo: "https://github.com/zeoce/wt-data-project.web",
    latestJoined,
    trendDates: trendManifest.dates
  };

  fs.writeFileSync(path.join(DATA_DIR, "metadata.json"), JSON.stringify(metadata, null, 2));
  fs.writeFileSync(path.join(DATA_DIR, "latest-joined.csv"), latestJoinedCsv);
  fs.writeFileSync(path.join(DATA_DIR, "latest-joined.json"), JSON.stringify(latestRows));
  fs.writeFileSync(path.join(DATA_DIR, "vehicle-trends.json"), JSON.stringify(trendManifest));
  fs.writeFileSync(path.join(DATA_DIR, "source-info.json"), JSON.stringify(sourceInfo, null, 2));

  console.log(`Prepared ${joined.length} metadata entries.`);
  console.log(`Latest joined data: ${latestJoined.date} -> public/data/latest-joined.csv`);
  console.log(`Prepared compact JSON and vehicle trends for ${Object.values(trendManifest.dates).join(", ")}.`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
