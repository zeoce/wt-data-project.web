const fs = require("fs");
const path = require("path");
const https = require("https");

const METADATA_URL =
  "https://raw.githubusercontent.com/ControlNet/wt-data-project.data/master/metadata.json";
const DATA_DIR = path.resolve(__dirname, "..", "public", "data");

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
  const sourceInfo = {
    generatedAt: new Date().toISOString(),
    upstreamMetadataUrl: METADATA_URL,
    upstreamWebRepo: "https://github.com/ControlNet/wt-data-project.web",
    upstreamDataRepo: "https://github.com/ControlNet/wt-data-project.data",
    forkRepo: "https://github.com/zeoce/wt-data-project.web",
    latestJoined
  };

  fs.writeFileSync(path.join(DATA_DIR, "metadata.json"), JSON.stringify(metadata, null, 2));
  fs.writeFileSync(path.join(DATA_DIR, "latest-joined.csv"), latestJoinedCsv);
  fs.writeFileSync(path.join(DATA_DIR, "source-info.json"), JSON.stringify(sourceInfo, null, 2));

  console.log(`Prepared ${joined.length} metadata entries.`);
  console.log(`Latest joined data: ${latestJoined.date} -> public/data/latest-joined.csv`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
