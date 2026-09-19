import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { STATEMENT_CLASSES, candidateClasses, currentArtifacts, seededArtifacts } from "./consent-statement-screen";

/**
 * G5.8's activation-point half, held in both directions (see
 * `scripts/consent-statement-screen.ts`): the record in
 * `scripts/legal-anchor-requirements.json#consentDocuments` names every
 * consent document the migrations seed, at its current version, with the
 * statement classes its body carries keywords for and, for each, what a person
 * found the words to be about. A document the record does not name, a version
 * the record has fallen behind, a candidate the record does not read, or a
 * reading for a candidate the body no longer carries, all fail.
 */
const ROOT = process.cwd();
const RECORD = "scripts/legal-anchor-requirements.json";
type Reading = { class: string; finding: "present" | "present-incomplete" | "not-the-statement"; words: string };
type Documented = { artifactKey: string; version: number; readings: Reading[] };
const record = (JSON.parse(readFileSync(path.join(ROOT, RECORD), "utf8")) as {
  consentDocuments?: { measuredOn: string; method: string; classes: Record<string, string>; artifacts: Documented[] };
}).consentDocuments;
const current = currentArtifacts(seededArtifacts(ROOT));

describe("consent documents: which protective statements they carry", () => {
  it("reads the real migrations, so a passing run means something", () => {
    expect(current.length).toBeGreaterThanOrEqual(15);
    expect(Object.keys(STATEMENT_CLASSES)).toHaveLength(8);
  });

  it("the record names the classes this screen uses, by their exact patterns", () => {
    expect(record, `${RECORD} has no consentDocuments section`).toBeDefined();
    expect(record!.classes).toEqual(Object.fromEntries(Object.entries(STATEMENT_CLASSES).map(([name, pattern]) => [name, pattern.source])));
    expect(record!.measuredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("every seeded document is recorded at its current version, and nothing else is", () => {
    expect(record!.artifacts.map(a => [a.artifactKey, a.version]).sort())
      .toEqual(current.map(a => [a.artifactKey, a.version]).sort());
  });

  it("every keyword candidate in a body has a reading, and every reading has its candidate", () => {
    for (const artifact of current) {
      const documented = record!.artifacts.find(a => a.artifactKey === artifact.artifactKey)!;
      expect(documented.readings.map(r => r.class).sort(), `${artifact.artifactKey}: candidates`)
        .toEqual(candidateClasses(artifact.body));
      for (const reading of documented.readings) {
        expect(["present", "present-incomplete", "not-the-statement"], `${artifact.artifactKey}/${reading.class}`).toContain(reading.finding);
        expect(artifact.body.replace(/\s+/g, " "), `${artifact.artifactKey}/${reading.class}: the words the reading quotes are in the body`)
          .toContain(reading.words);
      }
    }
  });

  it("no consent document carries an anchor id, so none is asserted by id", () => {
    for (const artifact of current) expect(artifact.body, artifact.artifactKey).not.toMatch(/\bid="|\{#[a-z-]+\}/);
  });
});

describe("the screen, on planted migrations", () => {
  const temporary: string[] = [];
  afterAll(() => { for (const directory of temporary) rmSync(directory, { recursive: true, force: true }); });

  it("reads the three insert shapes and keeps the latest version of each key", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "consent-screen-"));
    temporary.push(root);
    mkdirSync(path.join(root, "supabase/migrations"), { recursive: true });
    writeFileSync(path.join(root, "supabase/migrations/1_a.sql"), `insert into public.consent_artifacts (
  artifact_key, version, body_sha256, body_markdown
) select 'consent.one', 1, encode(digest(convert_to('I am 18 or older. It''s mine.', 'UTF8'), 'sha256'), 'hex'), 'x';`);
    writeFileSync(path.join(root, "supabase/migrations/2_b.sql"), `insert into public.consent_artifacts(artifact_key,version,body_sha256,body_markdown)
values('consent.one',2,'${"a".repeat(64)}',$artifact$Results can be wrong. Not a diagnosis.$artifact$);
insert into public.consent_artifacts(artifact_key,version,body_sha256,body_markdown)
select key,1,'x',body from (values ('consent.two','We indemnify nobody; we sell nothing.')) a(key,body);`);
    const all = seededArtifacts(root);
    expect(all.map(a => `${a.artifactKey}@${a.version}`)).toEqual(["consent.one@1", "consent.one@2", "consent.two@1"]);
    expect(all[0]!.body).toBe("I am 18 or older. It's mine.");
    const latest = currentArtifacts(all);
    expect(latest.map(a => `${a.artifactKey}@${a.version}`)).toEqual(["consent.one@2", "consent.two@1"]);
    expect(candidateClasses(latest[0]!.body)).toEqual(["no-warranty", "not-medical"]);
    expect(candidateClasses(latest[1]!.body)).toEqual(["indemnity", "no-payment"]);
    expect(candidateClasses("Nothing protective here.")).toEqual([]);
  });
});
