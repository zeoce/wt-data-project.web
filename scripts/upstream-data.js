const https = require("https");

const REPO = "ControlNet/wt-data-project.data";
const REF_URL = `https://api.github.com/repos/${REPO}/git/ref/heads/master`;
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/`;
const LEGACY_BASE = "https://controlnet.space/wt-data-project.data/";
const MAX_BYTES = 20 * 1024 * 1024;

function assertCommit(commit) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Invalid upstream commit SHA");
}

function metadataUrl(commit) {
  assertCommit(commit);
  return `${RAW_BASE}${commit}/metadata.json`;
}

function datasetPath(entry) {
  const { type, date } = entry || {};
  if (!["joined", "ts", "wk"].includes(type) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date) {
    throw new Error("Invalid dataset type or date in upstream metadata");
  }
  return `${type}/${type === "joined" ? "" : type}${date}.csv`;
}

function normalizeMetadata(metadata, commit) {
  assertCommit(commit);
  if (!Array.isArray(metadata) || metadata.length === 0) {
    throw new Error("Upstream metadata must be a non-empty array");
  }
  const seen = new Set();
  return metadata.map(entry => {
    const relativePath = datasetPath(entry);
    // Match complete URLs, not a hostname substring or an arbitrary suffix.
    const allowed = [LEGACY_BASE, `${RAW_BASE}master/`, `${RAW_BASE}${commit}/`]
      .map(base => base + relativePath);
    if (!allowed.includes(entry.path)) {
      throw new Error(`Unexpected upstream dataset URL: ${entry.path}`);
    }
    if (seen.has(relativePath)) throw new Error(`Duplicate dataset: ${relativePath}`);
    seen.add(relativePath);
    return { ...entry, path: `${RAW_BASE}${commit}/${relativePath}` };
  });
}

function assertFetchUrl(url) {
  if (url === REF_URL) return;
  if (typeof url !== "string" || !url.startsWith(RAW_BASE)) {
    throw new Error(`Unapproved upstream URL: ${url}`);
  }
  const suffix = url.slice(RAW_BASE.length);
  if (!/^[a-f0-9]{40}\/(?:metadata\.json|joined\/\d{4}-\d{2}-\d{2}\.csv|ts\/ts\d{4}-\d{2}-\d{2}\.csv|wk\/wk\d{4}-\d{2}-\d{2}\.csv)$/.test(suffix)) {
    throw new Error(`Unapproved upstream URL: ${url}`);
  }
}

function getText(url) {
  return new Promise((resolve, reject) => {
    assertFetchUrl(url);
    const request = https.get(url, {
      rejectUnauthorized: true,
      headers: { "User-Agent": "zeoce/wt-data-project.web data refresh" }
    }, response => {
      // These canonical endpoints require no redirects. Fail closed if that changes.
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`GET ${url} returned ${response.statusCode}; redirects are not followed`));
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on("data", chunk => {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) {
          response.destroy(new Error(`GET ${url} exceeded ${MAX_BYTES} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("aborted", () => reject(new Error(`GET ${url} was interrupted`)));
      response.on("end", () => {
        if (!response.complete) {
          reject(new Error(`GET ${url} was incomplete`));
          return;
        }
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
    });
    const deadline = setTimeout(() => request.destroy(new Error(`GET ${url} timed out`)), 30000);
    request.on("close", () => clearTimeout(deadline));
    request.on("error", error => {
      clearTimeout(deadline);
      reject(new Error(`GET ${url}: ${error.message}`, { cause: error }));
    });
  });
}

async function upstreamCommit() {
  const ref = JSON.parse(await getText(REF_URL));
  if (ref.ref !== "refs/heads/master" || ref.object?.type !== "commit") {
    throw new Error("Unexpected upstream Git reference response");
  }
  assertCommit(ref.object.sha);
  return ref.object.sha;
}

module.exports = { getText, metadataUrl, normalizeMetadata, upstreamCommit };
