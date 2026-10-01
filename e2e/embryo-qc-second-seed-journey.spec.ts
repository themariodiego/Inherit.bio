import http from "node:http";
import crypto from "node:crypto";
import { expect, test } from "./audited-test";
import { withEmbryoJourney } from "../scripts/ci-embryo-journey";
import { seedParticipantC, participantCPassword, type ParticipantCMail } from "./participant-c-journey";
import { provePublishedQcCrossSurface } from "./helpers/embryo-qc-cross-surface";
import { saveQcSeedReceipt } from "./helpers/embryo-qc-seed-receipt";

test.use({ baseURL: "http://localhost:3105" });
let mail: http.Server;
const messages: ParticipantCMail[] = [];
test.beforeAll(async () => {
  mail = http.createServer((request, response) => {
    let body = "";request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      if (request.method === "POST" && request.url?.includes("/emails")) messages.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: crypto.randomUUID() }));
    });
  });
  await new Promise<void>(resolve => mail.listen(8124, "127.0.0.1", resolve));
});
test.afterAll(async () => { mail?.closeAllConnections(); if (mail) await new Promise<void>(resolve => mail.close(() => resolve())); });

test("independent second synthetic QC seed publishes through both parents and the real worker", async ({ page, browser }, testInfo) => {
  test.setTimeout(300_000);
  await withEmbryoJourney(process.env, async runtime => {
    const seed = await seedParticipantC({ page, browser, ownerEmail: "qc-seed-b@e2e.local",
      parentEmail: "qc-seed-b-parent@e2e.local", password: participantCPassword, messages, runtime, qcSeed: "b" });
    try {
      expect(seed.embryos.map(row => row.status)).toEqual(["qc_pass", "qc_pass"]);
      const capture = await provePublishedQcCrossSurface({ page, ownerId: seed.owner, cohortId: seed.cohortId, read: seed.readPublication });
      saveQcSeedReceipt("b", testInfo, runtime.runtimeOwner, capture);
    } finally { await seed.closeCoParent(); }
  });
});
