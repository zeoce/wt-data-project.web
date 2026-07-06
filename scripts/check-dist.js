const fs = require("fs");
const path = require("path");

const required = [
  "dist/index.html",
  "dist/data/metadata.json"
];

const missing = required.filter(file => !fs.existsSync(path.resolve(__dirname, "..", file)));

if (missing.length > 0) {
  console.error(`Missing build artifact(s): ${missing.join(", ")}`);
  process.exit(1);
}

console.log("Build artifact check passed.");
