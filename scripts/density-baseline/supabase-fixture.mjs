import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const port = Number(process.env.INHERIT_STUB_PORT || 54321);
const nextOrigin = process.env.INHERIT_NEXT_ORIGIN || null;
const baselineCheckout = process.env.INHERIT_BASELINE_CHECKOUT;
const fixedTime =
  process.env.INHERIT_DENSITY_FIXED_TIME || "2026-08-31T12:00:00.000Z";
if (!baselineCheckout) {
  throw new Error("INHERIT_BASELINE_CHECKOUT is required");
}
const fixedNowSeconds = Math.floor(new Date(fixedTime).getTime() / 1000);
if (!Number.isFinite(fixedNowSeconds)) {
  throw new Error(`Invalid INHERIT_DENSITY_FIXED_TIME: ${fixedTime}`);
}

const userId = "11111111-1111-4111-8111-111111111111";
const fileId = "22222222-2222-4222-8222-222222222222";
const b64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const accessToken = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({
  aud: "authenticated",
  exp: fixedNowSeconds + 86400,
  iat: fixedNowSeconds,
  iss: "inherit-density-fixture",
  role: "authenticated",
  sub: userId,
  email: "density-fixture@inherit.test",
})}.fixture-signature`;

const user = {
  id: userId,
  aud: "authenticated",
  role: "authenticated",
  email: "density-fixture@inherit.test",
  email_confirmed_at: "2026-08-31T00:00:00.000Z",
  phone: "",
  confirmed_at: "2026-08-31T00:00:00.000Z",
  last_sign_in_at: "2026-08-31T00:00:00.000Z",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  created_at: "2026-08-31T00:00:00.000Z",
  updated_at: "2026-08-31T00:00:00.000Z",
};

const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(baselineCheckout, relativePath), "utf8"));
const listJson = (relativeDirectory) =>
  fs
    .readdirSync(path.join(baselineCheckout, relativeDirectory))
    .filter((name) => name.endsWith(".json"))
    .sort();

const templates = listJson("data/templates")
  .flatMap((name) => readJson(`data/templates/${name}`))
  .sort(
    (left, right) =>
      left.category.localeCompare(right.category) ||
      left.title.localeCompare(right.title),
  );
const providers = readJson("data/providers/providers.json").sort((left, right) =>
  left.name.localeCompare(right.name),
);
const samplePath = path.join(
  baselineCheckout,
  "data/samples/synthetic_23andme.txt",
);
const sampleBuffer = fs.readFileSync(samplePath);
const sampleSha256 = crypto.createHash("sha256").update(sampleBuffer).digest("hex");
const expectedSampleSha256 =
  "aa2cc50864d2447ff0ff8b32b7963142fddc122b15d3a5b7d9bc06673a84f1db";
if (sampleSha256 !== expectedSampleSha256) {
  throw new Error(
    `Baseline genome fixture hash mismatch: ${sampleSha256} != ${expectedSampleSha256}`,
  );
}
const sampleLines = sampleBuffer
  .toString("utf8")
  .split(/\r?\n/)
  .filter((line) => line && !line.startsWith("#"));
const variants = sampleLines.map((line) => {
  const [rawRsid, rawChrom, rawPos, rawGenotype] = line.split("\t");
  const genotype =
    rawGenotype.length === 2
      ? `${rawGenotype[0]}/${rawGenotype[1]}`
      : rawGenotype;
  return {
    file_id: fileId,
    rsid: Number(rawRsid.replace(/^rs/, "")),
    chrom:
      rawChrom === "X"
        ? 23
        : rawChrom === "Y"
          ? 24
          : rawChrom === "MT"
            ? 25
            : Number(rawChrom),
    pos: Number(rawPos),
    ref: null,
    alt: null,
    genotype,
  };
});

const prsDefinitions = listJson("data/prs").map((name) =>
  readJson(`data/prs/${name}`),
);
const prsRows = prsDefinitions.map((item, index) => ({
  file_id: fileId,
  pgs_id: item.pgs_id,
  raw_score: [0.38, -0.22, 0.61][index] ?? 0,
  zscore: [0.31, -0.45, 0.78][index] ?? 0,
  percentile: [62, 33, 78][index] ?? 50,
  coverage: [0.82, 0.74, 0.69][index] ?? 0.7,
  matched: Math.max(
    1,
    Math.round(item.n_variants * ([0.82, 0.74, 0.69][index] ?? 0.7)),
  ),
}));
const prsMeta = prsDefinitions.map((item) => ({
  pgs_id: item.pgs_id,
  name: item.name,
  trait: item.trait,
  n_variants: item.n_variants,
  ancestry_note: item.ancestry_note,
  citation: item.citation,
  source_url: item.source_url,
}));

const genomeFile = {
  id: fileId,
  original_name: "synthetic_23andme.txt",
  file_type: "array_23andme",
  tier: 1,
  size_bytes: sampleBuffer.length,
  sha256: sampleSha256,
  status: "annotated",
  build: "GRCh37",
  variant_count: variants.length,
  error: null,
  created_at: "2026-08-31T00:00:00.000Z",
  processing_started_at: "2026-08-31T00:00:01.000Z",
  processing_finished_at: "2026-08-31T00:00:04.000Z",
};

if (process.env.INHERIT_FIXTURE_SELF_TEST === "1") {
  console.log(
    JSON.stringify({
      fixedTime,
      accessTokenSha256: crypto
        .createHash("sha256")
        .update(accessToken)
        .digest("hex"),
      sampleSha256,
      templates: templates.length,
      providers: providers.length,
      variants: variants.length,
      prsScores: prsDefinitions.length,
    }),
  );
  process.exit(0);
}

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "http://127.0.0.1:3100",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info, prefer, accept-profile, content-profile, range",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    Vary: "Origin",
  };
}

function send(response, status, payload, extra = {}, origin) {
  const body = payload == null ? "" : JSON.stringify(payload);
  response.writeHead(status, {
    ...cors(origin),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...extra,
  });
  response.end(body);
}

function eqValue(url, name) {
  const value = url.searchParams.get(name);
  return value?.startsWith("eq.") ? decodeURIComponent(value.slice(3)) : null;
}

function inNumbers(url, name) {
  const value = url.searchParams.get(name);
  if (!value?.startsWith("in.(") || !value.endsWith(")")) return null;
  return new Set(value.slice(4, -1).split(",").map(Number));
}

function rowsFor(table, url) {
  if (table === "genome_files") {
    const status = url.searchParams.get("status") || "";
    if (status.includes("uploading") || status.includes("parsing")) return [];
    return [genomeFile];
  }
  if (table === "report_templates") {
    const slug = eqValue(url, "slug");
    return slug ? templates.filter((row) => row.slug === slug) : templates;
  }
  if (table === "providers") return providers;
  if (table === "user_variants") {
    const rsid = eqValue(url, "rsid");
    const ids = inNumbers(url, "rsid");
    if (rsid) return variants.filter((row) => row.rsid === Number(rsid));
    if (ids) return variants.filter((row) => ids.has(row.rsid));
    return variants;
  }
  if (table === "user_prs") {
    const pgs = eqValue(url, "pgs_id");
    return pgs ? prsRows.filter((row) => row.pgs_id === pgs) : prsRows;
  }
  if (table === "prs_scores") {
    const pgs = eqValue(url, "pgs_id");
    const ids = url.searchParams.get("pgs_id");
    if (pgs) return prsMeta.filter((row) => row.pgs_id === pgs);
    if (ids?.startsWith("in.(")) {
      const wanted = new Set(ids.slice(4, -1).split(","));
      return prsMeta.filter((row) => wanted.has(row.pgs_id));
    }
    return prsMeta;
  }
  if (table === "ancestry_results") {
    return [
      {
        kind: "admixture",
        result: {
          proportions: { EUR: 0.54, AFR: 0.18, EAS: 0.12, SAS: 0.1, AMR: 0.06 },
          markersUsed: 82,
          note: "Synthetic fixture.",
        },
        support_note:
          "82 of 120 ancestry markers covered in this synthetic fixture.",
      },
      {
        kind: "mtdna",
        result: { haplogroup: "H", path: ["R", "R0", "HV", "H"], matched: 5, tested: 7 },
        support_note: "Synthetic fixture marker path.",
      },
      {
        kind: "ydna",
        result: { haplogroup: null },
        support_note: "No supported Y-line call in this synthetic fixture.",
      },
    ];
  }
  if (table === "profiles") return [{ digest_opt_in: false }];
  if (table === "llm_settings") return [];
  if (table === "consent_grants") return [];
  if (table === "ref_variants") return [];
  return [];
}

const server = http.createServer((request, response) => {
  const requestOrigin = request.headers.origin;
  if (request.method === "OPTIONS") {
    response.writeHead(204, cors(requestOrigin));
    response.end();
    return;
  }
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  if (url.pathname === "/auth/v1/token" && request.method === "POST") {
    send(
      response,
      200,
      {
        access_token: accessToken,
        token_type: "bearer",
        expires_in: 86400,
        expires_at: fixedNowSeconds + 86400,
        refresh_token: "density-fixture-refresh-token",
        user,
      },
      {},
      requestOrigin,
    );
    return;
  }
  if (url.pathname === "/auth/v1/user" && request.method === "GET") {
    send(response, 200, user, {}, requestOrigin);
    return;
  }
  if (url.pathname === "/auth/v1/logout" && request.method === "POST") {
    send(response, 204, null, {}, requestOrigin);
    return;
  }
  if (url.pathname === "/auth/v1/health") {
    send(response, 200, { version: "density-fixture" }, {}, requestOrigin);
    return;
  }
  if (url.pathname === "/rest/v1/rpc/processing_time_stats") {
    send(
      response,
      200,
      [{ file_tier: 1, n: 1, p50_seconds: 3, p95_seconds: 3 }],
      { "Content-Range": "0-0/1" },
      requestOrigin,
    );
    return;
  }
  if (url.pathname.startsWith("/rest/v1/")) {
    const table = decodeURIComponent(url.pathname.slice("/rest/v1/".length));
    const rows = rowsFor(table, url);
    const wantsObject = (request.headers.accept || "").includes(
      "application/vnd.pgrst.object+json",
    );
    if (wantsObject) {
      if (rows.length === 1) {
        send(response, 200, rows[0], {}, requestOrigin);
      } else {
        send(
          response,
          406,
          {
            code: "PGRST116",
            details: `The result contains ${rows.length} rows`,
            hint: null,
            message: "Cannot coerce the result to a single JSON object",
          },
          {},
          requestOrigin,
        );
      }
      return;
    }
    const last = Math.max(0, rows.length - 1);
    send(
      response,
      200,
      rows,
      { "Content-Range": rows.length ? `0-${last}/${rows.length}` : "*/0" },
      requestOrigin,
    );
    return;
  }
  if (nextOrigin) {
    const target = new URL(request.url, nextOrigin);
    const upstream = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: request.method,
        headers: { ...request.headers, host: target.host },
      },
      (upstreamResponse) => {
        response.writeHead(
          upstreamResponse.statusCode || 502,
          upstreamResponse.headers,
        );
        upstreamResponse.pipe(response);
      },
    );
    upstream.on("error", (error) =>
      send(response, 502, { error: String(error) }, {}, requestOrigin),
    );
    request.pipe(upstream);
    return;
  }
  send(
    response,
    404,
    { error: "fixture endpoint not found", path: url.pathname },
    {},
    requestOrigin,
  );
});

server.listen(port, "127.0.0.1", () => {
  console.log(
    JSON.stringify({
      ready: true,
      port,
      fixedTime,
      templates: templates.length,
      providers: providers.length,
      variants: variants.length,
      prsScores: prsDefinitions.length,
    }),
  );
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
