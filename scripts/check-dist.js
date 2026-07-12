const fs = require("fs");
const path = require("path");

const required = [
  "dist/index.html",
  "dist/index.css",
  "dist/bundle.js",
  "dist/manifest.webmanifest",
  "dist/sw.js",
  "dist/data/metadata.json",
  "dist/data/latest-joined.csv",
  "dist/data/latest-joined.json",
  "dist/data/source-info.json",
  "dist/data/vehicle-images.json",
  "dist/data/vehicle-trends.json"
];

const missing = required.filter(file => !fs.existsSync(path.resolve(__dirname, "..", file)));

if (missing.length > 0) {
  console.error(`Missing build artifact(s): ${missing.join(", ")}`);
  process.exit(1);
}

const readJson = file => JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", file), "utf8"));
const metadata = readJson("dist/data/metadata.json");
const rows = readJson("dist/data/latest-joined.json");
const source = readJson("dist/data/source-info.json");
const images = readJson("dist/data/vehicle-images.json");
const trends = readJson("dist/data/vehicle-trends.json");
const latestMetadata = metadata.filter(entry => entry.type === "joined").slice(-1)[0];
const semanticErrors = [];

if (!Array.isArray(rows) || rows.length < 500) semanticErrors.push("latest-joined.json does not contain the expected vehicle rows");
if (!source.latestJoined || source.latestJoined.date !== latestMetadata.date) semanticErrors.push("source-info latest date does not match metadata");
if (!images.images || Object.keys(images.images).length < 500) semanticErrors.push("vehicle image manifest is unexpectedly small");
if (!trends.vehicles || Object.keys(trends.vehicles).length < 500 || trends.latestDate !== latestMetadata.date) semanticErrors.push("vehicle trend manifest is incomplete or stale");
if (fs.statSync(path.resolve(__dirname, "..", "dist/bundle.js")).size < 100000) semanticErrors.push("bundle.js is unexpectedly small");

const html = fs.readFileSync(path.resolve(__dirname, "..", "dist/index.html"), "utf8");
if (/googletagmanager|getloli\.controlnet/i.test(html)) semanticErrors.push("removed third-party tracking references remain in index.html");

if (semanticErrors.length > 0) {
  console.error(`Build artifact validation failed: ${semanticErrors.join("; ")}`);
  process.exit(1);
}

console.log("Build artifact check passed.");
