const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const { EventEmitter } = require("node:events");
const { Readable } = require("node:stream");
const { getText, metadataUrl, normalizeMetadata } = require("../scripts/upstream-data");
const { parseCsv } = require("../scripts/prepare-data");

const SHA = "a".repeat(40);
const BASE = `https://raw.githubusercontent.com/ControlNet/wt-data-project.data/${SHA}/`;
const entry = (date = "2026-10-17", type = "joined") => ({ type, date,
  path: `https://controlnet.space/wt-data-project.data/${type}/${type === "joined" ? "" : type}${date}.csv` });
const HEADER = "name,nation,cls,rb_br,rb_battles,rb_win_rate,rb_ground_frags_per_battle,rb_ground_frags_per_death";
const CSV = HEADER + "\n" + Array.from({ length: 500 }, (_, i) => `vehicle_${i},USA,Ground_vehicles,10.0,400,50,1,1`).join("\n") + "\n";

function mockTransport(t, respond) {
  const calls = [];
  t.mock.method(https, "get", (url, options, callback) => {
    calls.push(url);
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.checkServerIdentity, undefined);
    const request = new EventEmitter();
    request.destroy = error => { request.emit("error", error); request.emit("close"); };
    process.nextTick(() => {
      const result = respond(url);
      if (result.error) { request.destroy(result.error); return; }
      const response = Readable.from([Buffer.from(result.body || "")]);
      response.statusCode = result.status || 200;
      response.headers = result.headers || {};
      response.complete = result.complete !== false;
      response.on("close", () => request.emit("close"));
      callback(response);
    });
    return request;
  });
  return calls;
}

test("maps joined, ts and wk metadata to the same immutable upstream commit", () => {
  for (const type of ["joined", "ts", "wk"]) {
    const original = entry("2026-10-17", type);
    const normalized = normalizeMetadata([original], SHA)[0];
    assert.equal(normalized.path, `${BASE}${type}/${type === "joined" ? "" : type}2026-10-17.csv`);
    assert.ok(original.path.startsWith("https://controlnet.space/"));
    assert.deepEqual(normalizeMetadata([normalized], SHA), [normalized]);
  }
  const rawMaster = { ...entry(), path: BASE.replace(SHA, "master") + "joined/2026-10-17.csv" };
  assert.equal(normalizeMetadata([rawMaster], SHA)[0].path, BASE + "joined/2026-10-17.csv");
});

test("rejects untrusted origins, credentials, ports, paths, queries, fragments and date mismatches", () => {
  for (const url of [
    entry().path.replace("https:", "http:"),
    entry().path.replace("controlnet.space", "controlnet.space.evil.example"),
    entry().path.replace("controlnet.space", "controlnet.space@evil.example"),
    entry().path.replace("controlnet.space", "user@controlnet.space"),
    entry().path.replace("controlnet.space", "controlnet.space:8443"),
    entry().path.replace("/joined/", "/other/../joined/"),
    entry().path.replace("/joined/", "/%2e%2e/joined/"),
    entry().path + "?download=1", entry().path + "#fragment",
    entry().path.replace("2026-10-17", "2026-10-14"),
    BASE.replace("ControlNet", "attacker") + "joined/2026-10-17.csv"
  ]) assert.throws(() => normalizeMetadata([{ ...entry(), path: url }], SHA));
  assert.throws(() => normalizeMetadata([entry("2026-02-30")], SHA));
  assert.throws(() => normalizeMetadata([entry(), entry()], SHA));
  assert.throws(() => normalizeMetadata([], SHA));
  assert.throws(() => metadataUrl("master"));
});

test("rejects unapproved fetches before opening a connection", async t => {
  const calls = mockTransport(t, () => ({ body: "unexpected" }));
  await assert.rejects(getText(entry().path), /Unapproved/);
  await assert.rejects(getText(BASE.replace(SHA, "master") + "metadata.json"), /Unapproved/);
  assert.equal(calls.length, 0);
});

test("rejects redirects rather than following them, including HTTPS downgrades", async t => {
  const calls = mockTransport(t, () => ({ status: 302, headers: { location: "http://evil.example/data.csv" } }));
  await assert.rejects(getText(metadataUrl(SHA)), /302/);
  assert.equal(calls.length, 1);
});

test("TLS hostname errors are preserved with no insecure retry", async t => {
  const error = Object.assign(new Error("certificate hostname mismatch"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" });
  const calls = mockTransport(t, () => ({ error }));
  await assert.rejects(getText(metadataUrl(SHA)), e => e.cause?.code === error.code);
  assert.equal(calls.length, 1);
});

test("rejects HTTP errors and incomplete responses", async t => {
  let result = { status: 404 };
  mockTransport(t, () => result);
  await assert.rejects(getText(metadataUrl(SHA)), /404/);
  result = { body: "partial", complete: false };
  await assert.rejects(getText(metadataUrl(SHA)), /incomplete/);
});

test("rejects HTML, empty, undersized and malformed CSV without discarding quoted commas", () => {
  assert.equal(parseCsv(CSV).length, 500);
  assert.equal(parseCsv(CSV.replace("vehicle_0", '"vehicle, zero"'))[0].name, "vehicle, zero");
  for (const body of ["", "<html>Error</html>", HEADER + "\n", CSV + "truncated\n", CSV + '"unterminated\n']) {
    assert.throws(() => parseCsv(body));
  }
});

test("refresh pins every snapshot and leaves outputs intact when a historical download fails", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wt-refresh-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts"));
  for (const file of ["prepare-data.js", "upstream-data.js"]) {
    fs.copyFileSync(path.join(__dirname, "..", "scripts", file), path.join(root, "scripts", file));
  }
  const { main } = require(path.join(root, "scripts", "prepare-data.js"));
  const metadata = ["2026-09-17", "2026-10-08", "2026-10-14", "2026-10-17"].map(date => entry(date));
  let failHistory = false;
  const calls = mockTransport(t, url => {
    if (url.startsWith("https://api.github.com/")) return { body: JSON.stringify({ ref: "refs/heads/master", object: { type: "commit", sha: SHA } }) };
    if (url === metadataUrl(SHA)) return { body: JSON.stringify(metadata) };
    assert.ok(url.startsWith(BASE));
    if (failHistory && url.endsWith("2026-10-08.csv")) return { status: 404 };
    return { body: CSV };
  });
  await main();
  const dataDir = path.join(root, "public", "data");
  const before = Object.fromEntries(fs.readdirSync(dataDir).map(file => [file, fs.readFileSync(path.join(dataDir, file), "utf8")]));
  const source = JSON.parse(before["source-info.json"]);
  assert.equal(source.upstreamCommit, SHA);
  assert.equal(source.latestJoined.date, "2026-10-17");
  assert.deepEqual(source.trendDates, { d1: "2026-10-14", d7: "2026-10-08", d30: "2026-09-17" });
  assert.equal(source.snapshots.length, 4);
  assert.ok(source.snapshots.every(snapshot => snapshot.rows === 500 && /^[a-f0-9]{64}$/.test(snapshot.sha256)));
  assert.equal(calls.length, 6);
  failHistory = true;
  await assert.rejects(main(), /404/);
  for (const [file, content] of Object.entries(before)) {
    assert.equal(fs.readFileSync(path.join(dataDir, file), "utf8"), content);
  }
});
